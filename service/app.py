#!/usr/bin/env python3
"""FastAPI orchestration service for deterministic Kundli fulfillment."""
from __future__ import annotations

import hashlib
import json
import logging
import os
import secrets
import subprocess
import sys
import tempfile
import fcntl
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, ConfigDict, Field, model_validator

from service.kundli import chart as chart_module
from service.kundli import interpret as interpret_module

LOGGER = logging.getLogger(__name__)
ROOT = Path(__file__).resolve().parents[1]
GENERATOR = ROOT / 'scripts' / 'kundli' / 'generate_report.py'
EMAIL_SENDER = ROOT / 'scripts' / 'kundli' / 'send_email.py'
DEFAULT_STATE_DIR = Path(tempfile.gettempdir()) / 'kundli-service-state'


class PersonRequest(BaseModel):
    model_config = ConfigDict(extra='allow')

    fullName: str = Field(min_length=1)
    gender: str = Field(min_length=1)
    dateOfBirth: str = Field(min_length=1)
    timeOfBirth: str = Field(min_length=1)
    placeOfBirth: str = Field(min_length=1)
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    timezone: str = Field(min_length=1)
    timezoneOffset: str | None = None


class PanditRequest(BaseModel):
    model_config = ConfigDict(extra='allow')

    name: str = Field(min_length=1)
    referenceNumber: str = Field(min_length=1)
    customerEmail: str = Field(min_length=1)


class GenerateRequest(BaseModel):
    model_config = ConfigDict(extra='allow')

    orderId: str = Field(min_length=1)
    serviceType: str = Field(min_length=1)
    person: PersonRequest
    partner: PersonRequest | None = None
    questions: list[str] = Field(default_factory=list)
    extras: dict[str, Any] = Field(default_factory=dict)
    pandit: PanditRequest
    dryRun: bool = False

    @model_validator(mode='after')
    def validate_service_inputs(self) -> 'GenerateRequest':
        if self.serviceType.strip().lower() == 'milan' and self.partner is None:
            raise ValueError('partner is required for milan')
        if any(not question.strip() for question in self.questions):
            raise ValueError('questions must contain non-empty strings')
        return self


app = FastAPI(title='Siddh Jyotish Kundli Service', version='1.0.0')


def _state_dir() -> Path:
    configured = os.getenv('KUNDLI_STATE_DIR', '').strip()
    path = Path(configured) if configured else DEFAULT_STATE_DIR
    path.mkdir(parents=True, exist_ok=True)
    return path


def _state_path(order_id: str) -> Path:
    digest = hashlib.sha256(order_id.encode('utf-8')).hexdigest()
    return _state_dir() / f'{digest}.json'


def _read_state(path: Path) -> dict[str, Any] | None:
    try:
        value = json.loads(path.read_text(encoding='utf-8'))
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return None
    return value if isinstance(value, dict) else None


def _write_state(path: Path, state: dict[str, Any]) -> None:
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding='utf-8')
    temporary.replace(path)


def _claim_order(order_id: str) -> tuple[str, dict[str, Any] | None]:
    path = _state_path(order_id)
    lock_path = path.with_suffix('.lock')
    with lock_path.open('a+', encoding='utf-8') as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
        current = _read_state(path)
        if current and current.get('status') in {'done', 'in-progress'}:
            return str(current['status']), current
        state = {
            'orderId': order_id,
            'status': 'in-progress',
            'startedAt': datetime.now(timezone.utc).isoformat(),
        }
        _write_state(path, state)
        return 'claimed', state


def _mark_failed(order_id: str, error_type: str) -> None:
    _write_state(_state_path(order_id), {
        'orderId': order_id,
        'status': 'failed',
        'errorType': error_type,
        'failedAt': datetime.now(timezone.utc).isoformat(),
    })


def _mask_coordinate(value: float, positive: str, negative: str) -> str:
    direction = positive if value >= 0 else negative
    return f'{abs(value):g}°{direction}'


def _offset_text(local: datetime) -> str:
    value = local.strftime('%z')
    return f'{value[:3]}:{value[3:]}' if len(value) == 5 else value


def _person_data(person: PersonRequest) -> dict[str, Any]:
    local_date = datetime.strptime(person.dateOfBirth.strip(), '%Y-%m-%d') if len(person.dateOfBirth.strip()) == 10 and person.dateOfBirth.strip()[4] == '-' else None
    if local_date is None:
        for fmt in ('%d %B %Y', '%d %b %Y'):
            try:
                local_date = datetime.strptime(person.dateOfBirth.strip(), fmt)
                break
            except ValueError:
                continue
    if local_date is None:
        raise ValueError('Unsupported dateOfBirth format')
    parsed_time = None
    for fmt in ('%I:%M %p', '%I:%M:%S %p', '%H:%M', '%H:%M:%S'):
        try:
            parsed_time = datetime.strptime(person.timeOfBirth.strip().upper(), fmt)
            break
        except ValueError:
            continue
    if parsed_time is None:
        raise ValueError('Unsupported timeOfBirth format')
    local = datetime(
        local_date.year, local_date.month, local_date.day,
        parsed_time.hour, parsed_time.minute, parsed_time.second,
        tzinfo=ZoneInfo(person.timezone),
    )
    utc = local.astimezone(timezone.utc)
    data = person.model_dump()
    data['latitude'] = _mask_coordinate(person.latitude, 'N', 'S')
    data['longitude'] = _mask_coordinate(person.longitude, 'E', 'W')
    data['timezoneOffset'] = person.timezoneOffset or _offset_text(local)
    data['universalTime'] = f'{utc.hour:02d}:{utc.minute:02d} UT'
    return data


def _request_data(request: GenerateRequest) -> dict[str, Any]:
    return {
        'person': _person_data(request.person),
        'pandit': request.pandit.model_dump(),
        'chart': {},
        'interpretation': {},
    }


def _build_pdf(data_path: Path, workdir: Path) -> Path:
    if not GENERATOR.exists():
        raise RuntimeError('Kundli PDF generator is unavailable')
    try:
        subprocess.run(
            [sys.executable, str(GENERATOR), str(data_path)],
            cwd=workdir,
            check=True,
            capture_output=True,
            text=True,
        )
    except (OSError, subprocess.CalledProcessError) as exc:
        raise RuntimeError(f'PDF generation failed ({type(exc).__name__})') from exc
    pdf_path = workdir / 'Kundli_Report.pdf'
    if not pdf_path.exists() or pdf_path.stat().st_size <= 0:
        raise RuntimeError('PDF generation produced no usable PDF')
    return pdf_path


def _send_email(data_path: Path) -> str:
    if not EMAIL_SENDER.exists():
        raise RuntimeError('Kundli email sender is unavailable')
    try:
        result = subprocess.run(
            [sys.executable, str(EMAIL_SENDER), str(data_path)],
            cwd=data_path.parent,
            check=True,
            capture_output=True,
            text=True,
        )
    except (OSError, subprocess.CalledProcessError) as exc:
        raise RuntimeError(f'Email delivery failed ({type(exc).__name__})') from exc
    lines = [line.strip() for line in result.stdout.splitlines() if line.strip()]
    if not lines:
        raise RuntimeError('Email sender returned no message id')
    return lines[-1]


def _assemble(request: GenerateRequest) -> tuple[dict[str, Any], dict[str, Any]]:
    person = request.person.model_dump()
    partner = request.partner.model_dump() if request.partner else None
    service_type = request.serviceType.strip().lower()

    if service_type == 'milan' and partner:
        pair = chart_module.compute_pair(person, partner)
        chart = pair['person']
        interpretation_chart: dict[str, Any] = pair
    else:
        chart = chart_module.compute(person)
        interpretation_chart = chart

    optional_blocks: dict[str, Any] = {}
    if service_type in {'annual', 'monthly'}:
        from_date = request.extras.get('fromDate') or request.extras.get('from_date') or datetime.now(timezone.utc).date().isoformat()
        month_count = int(request.extras.get('months', 12))
        annual = chart_module.transits(person, from_date, months=month_count)
        optional_blocks['transits'] = annual
        interpretation_chart = {'chart': interpretation_chart, 'transits': annual}

    interpretation = interpret_module.interpret(
        interpretation_chart,
        service_type,
        request.questions,
        request.extras,
        request.pandit.model_dump(),
    )
    data = _request_data(request)
    data['chart'] = chart
    data['interpretation'] = interpretation
    if service_type == 'milan' and partner:
        data['partner'] = _person_data(request.partner)
        data['partnerChart'] = interpretation_chart['partner']
        data['matchScore'] = interpretation_chart['matchScore']
    data.update(optional_blocks)
    return data, interpretation_chart


def _result_from_done(state: dict[str, Any]) -> dict[str, Any]:
    result = state.get('result')
    if isinstance(result, dict):
        response = dict(result)
        response['idempotent'] = True
        return response
    raise RuntimeError('Stored completion record is invalid')


def _authorize(authorization: str | None) -> None:
    expected = os.getenv('KUNDLI_SERVICE_TOKEN', '')
    supplied = ''
    if authorization and authorization.startswith('Bearer '):
        supplied = authorization[7:].strip()
    if not expected or not supplied or not secrets.compare_digest(supplied, expected):
        raise HTTPException(status_code=401, detail='Unauthorized')


@app.get('/health')
def health() -> dict[str, str]:
    return {'status': 'ok'}


@app.post('/generate')
def generate(request: GenerateRequest, authorization: str | None = Header(default=None)) -> dict[str, Any]:
    _authorize(authorization)
    state_path = _state_path(request.orderId)
    if request.dryRun:
        existing = _read_state(state_path)
        if existing and existing.get('status') == 'done':
            return _result_from_done(existing)
    else:
        status, state = _claim_order(request.orderId)
        if status == 'done' and state:
            return _result_from_done(state)
        if status == 'in-progress':
            raise HTTPException(status_code=409, detail='Order generation is already in progress')

    workdir: Path | None = None
    try:
        data, _interpretation_chart = _assemble(request)
        workdir = Path(tempfile.mkdtemp(prefix=f'kundli-{hashlib.sha256(request.orderId.encode()).hexdigest()[:12]}-'))
        data_path = workdir / 'data.json'
        data_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')
        pdf_path = _build_pdf(data_path, workdir)
        pdf_bytes = pdf_path.stat().st_size
        if request.dryRun:
            return {
                'orderId': request.orderId,
                'serviceType': request.serviceType,
                'emailId': None,
                'dryRun': True,
                'idempotent': False,
                'pdfBytes': pdf_bytes,
                'data': data,
                'note': 'Dry run completed; no email was sent.',
            }
        email_id = _send_email(data_path)
        result = {
            'orderId': request.orderId,
            'serviceType': request.serviceType,
            'emailId': email_id,
            'dryRun': False,
            'idempotent': False,
            'pdfBytes': pdf_bytes,
        }
        _write_state(_state_path(request.orderId), {
            'orderId': request.orderId,
            'status': 'done',
            'result': result,
            'pdfPath': str(pdf_path),
            'completedAt': datetime.now(timezone.utc).isoformat(),
        })
        return result
    except HTTPException:
        raise
    except Exception as exc:
        LOGGER.exception('Kundli pipeline failed for order type=%s', type(exc).__name__)
        if not request.dryRun:
            _mark_failed(request.orderId, type(exc).__name__)
        raise HTTPException(status_code=500, detail='Kundli generation failed') from exc
