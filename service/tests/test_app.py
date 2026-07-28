from __future__ import annotations

import json
import os
from pathlib import Path
from unittest.mock import Mock

import pytest
from fastapi.testclient import TestClient

from service import app as app_module


REPO = Path(__file__).resolve().parents[2]
SAMPLE = json.loads((REPO / 'scripts/kundli/data.sample.json').read_text())
CHART = SAMPLE['chart']
INTERPRETATION = SAMPLE['interpretation']
PERSON = {
    'fullName': 'Nav',
    'gender': 'Male',
    'dateOfBirth': '1 July 1995',
    'timeOfBirth': '10:40 AM',
    'placeOfBirth': 'Mississauga',
    'latitude': 43.59,
    'longitude': -79.64,
    'timezone': 'Asia/Kolkata',
}
PANDIT = {
    'name': 'Guru Shivprasad Vyas',
    'referenceNumber': 'ref-test-123',
    'customerEmail': 'customer@example.com',
}


def request_body(order_id: str = 'order-test-1', **overrides: object) -> dict:
    body = {
        'orderId': order_id,
        'serviceType': 'kundli',
        'person': PERSON,
        'partner': None,
        'questions': ['What is my next step?'],
        'extras': {},
        'pandit': PANDIT,
        'dryRun': False,
    }
    body.update(overrides)
    return body


@pytest.fixture
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.setenv('KUNDLI_SERVICE_TOKEN', 'service-test-token')
    monkeypatch.setenv('KUNDLI_STATE_DIR', str(tmp_path / 'state'))
    return TestClient(app_module.app)


def patch_chart_and_interpret(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(app_module.chart_module, 'compute', Mock(return_value=CHART))
    monkeypatch.setattr(app_module.interpret_module, 'interpret', Mock(return_value=INTERPRETATION))


def stub_pdf(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_build(data_path: Path, workdir: Path) -> Path:
        pdf = workdir / 'Kundli_Report.pdf'
        pdf.write_bytes(b'%PDF-1.7 mocked')
        return pdf

    monkeypatch.setattr(app_module, '_build_pdf', fake_build)


def test_health(client: TestClient) -> None:
    response = client.get('/health')
    assert response.status_code == 200
    assert response.json() == {'status': 'ok'}


def test_generate_requires_bearer_token(client: TestClient) -> None:
    response = client.post('/generate', json=request_body(dryRun=True))
    assert response.status_code == 401


def test_generate_dry_run_uses_real_pdf_when_chrome_is_available(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    patch_chart_and_interpret(monkeypatch)
    chrome_available = bool(os.getenv('CHROME_BIN')) or Path('/opt/.devin/chrome').exists()
    if not chrome_available:
        stub_pdf(monkeypatch)
    response = client.post(
        '/generate',
        headers={'Authorization': 'Bearer service-test-token'},
        json=request_body(dryRun=True),
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload['dryRun'] is True
    assert payload['emailId'] is None
    assert payload['data']['person']['latitude'] == '43.59°N'
    assert payload['data']['person']['longitude'] == '79.64°W'
    assert set(payload['data']) == {'person', 'pandit', 'chart', 'interpretation'}
    assert 'note' in payload


def test_real_generate_sends_once_and_marks_done(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    patch_chart_and_interpret(monkeypatch)
    stub_pdf(monkeypatch)
    send = Mock(return_value='re_test_123')
    monkeypatch.setattr(app_module, '_send_email', send)
    response = client.post(
        '/generate',
        headers={'Authorization': 'Bearer service-test-token'},
        json=request_body(),
    )
    assert response.status_code == 200
    assert response.json() == {
        'orderId': 'order-test-1',
        'serviceType': 'kundli',
        'emailId': 're_test_123',
        'dryRun': False,
        'idempotent': False,
        'pdfBytes': len(b'%PDF-1.7 mocked'),
    }
    send.assert_called_once()


def test_idempotency_skips_interpretation_and_email_on_second_call(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    patch_chart_and_interpret(monkeypatch)
    stub_pdf(monkeypatch)
    interpret = app_module.interpret_module.interpret
    send = Mock(return_value='re_idempotent')
    monkeypatch.setattr(app_module, '_send_email', send)
    headers = {'Authorization': 'Bearer service-test-token'}

    first = client.post('/generate', headers=headers, json=request_body('order-idempotent'))
    second = client.post('/generate', headers=headers, json=request_body('order-idempotent'))

    assert first.status_code == 200
    assert second.status_code == 200
    assert second.json()['idempotent'] is True
    assert second.json()['emailId'] == 're_idempotent'
    assert interpret.call_count == 1
    send.assert_called_once()


def test_milan_assembled_data_contains_partner_chart_and_match_score(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    partner_chart = dict(CHART, lagna='Cancer')
    pair = {'person': CHART, 'partner': partner_chart, 'matchScore': {'total': 27, 'outOf': 36}}
    monkeypatch.setattr(app_module.chart_module, 'compute_pair', Mock(return_value=pair))
    monkeypatch.setattr(app_module.interpret_module, 'interpret', Mock(return_value=INTERPRETATION))
    stub_pdf(monkeypatch)
    body = request_body(
        'order-milan',
        serviceType='milan',
        partner={**PERSON, 'fullName': 'Partner'},
        dryRun=True,
    )

    response = client.post(
        '/generate',
        headers={'Authorization': 'Bearer service-test-token'},
        json=body,
    )
    assert response.status_code == 200
    data = response.json()['data']
    assert data['partnerChart']['lagna'] == 'Cancer'
    assert data['matchScore'] == {'total': 27, 'outOf': 36}
    assert data['partner']['fullName'] == 'Partner'


def test_bad_body_returns_422(client: TestClient) -> None:
    response = client.post(
        '/generate',
        headers={'Authorization': 'Bearer service-test-token'},
        json={'orderId': 'missing-fields'},
    )
    assert response.status_code == 422


def test_annual_data_contains_transits(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    patch_chart_and_interpret(monkeypatch)
    monkeypatch.setattr(app_module.chart_module, 'transits', Mock(return_value={'from': '2025-01-01', 'months': []}))
    stub_pdf(monkeypatch)
    response = client.post(
        '/generate',
        headers={'Authorization': 'Bearer service-test-token'},
        json=request_body('order-annual', serviceType='annual', dryRun=True, extras={'fromDate': '2025-01-01'}),
    )
    assert response.status_code == 200
    assert response.json()['data']['transits']['from'] == '2025-01-01'
