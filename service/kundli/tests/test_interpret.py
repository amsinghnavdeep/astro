from __future__ import annotations

import json
import logging

import httpx
import pytest

from service.kundli.interpret import (
    GeminiClient,
    InterpretationValidationError,
    interpret,
)


class FakeResponse:
    def __init__(self, status_code: int, payload: dict, text: str | None = None) -> None:
        self.status_code = status_code
        self._payload = payload
        self.text = text if text is not None else json.dumps(payload)

    def json(self) -> dict:
        return self._payload


def response_for(result: dict, status_code: int = 200) -> FakeResponse:
    return FakeResponse(
        status_code,
        {'candidates': [{'content': {'parts': [{'text': json.dumps(result)}]}}]},
    )


def valid_result(question: str | None = None) -> dict:
    return {
        'coreNature': ['A warm paragraph.', 'A factual paragraph.', 'A blessing paragraph.'],
        'houseHighlights': [{'title': 'Lagna', 'text': 'Your supplied Lagna facts guide this reading.'}],
        'answers': [{'question': question, 'answer': 'The supplied dasha and house facts guide this answer.'}] if question else [],
        'remedies': [{'title': 'Steady practice', 'text': 'Keep a regular mantra practice.'}],
        'closingBlessing': 'May Guru guide your path with grace.',
        'emailHighlights': [{'label': 'Good news', 'text': 'Your chart has supportive signatures.'}],
        'emailGoodNews': 'There is encouraging support in the supplied chart facts.',
    }


def test_429_rotates_from_key_one_to_key_two(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[str] = []

    def fake_post(url: str, headers: dict, **kwargs: object) -> FakeResponse:
        del url, kwargs
        calls.append(headers['X-Goog-Api-Key'])
        if len(calls) == 1:
            return FakeResponse(429, {'error': {'status': 'RESOURCE_EXHAUSTED'}}, 'RESOURCE_EXHAUSTED')
        return response_for(valid_result())

    monkeypatch.setattr(httpx, 'post', fake_post)
    client = GeminiClient(keys=['first-secret-key', 'second-secret-key'])
    generated = client._generate('prompt')

    assert generated.text
    assert calls == ['first-secret-key', 'second-secret-key']


def test_model_not_found_uses_fallback_model(monkeypatch: pytest.MonkeyPatch) -> None:
    models: list[str] = []

    def fake_post(url: str, headers: dict, **kwargs: object) -> FakeResponse:
        del headers, kwargs
        models.append(url.split('/models/')[1].split(':', 1)[0])
        if len(models) == 1:
            return FakeResponse(404, {'error': {'status': 'NOT_FOUND', 'message': 'model not found'}})
        return response_for(valid_result())

    monkeypatch.setattr(httpx, 'post', fake_post)
    client = GeminiClient(keys=['model-key'])
    client._generate('prompt')

    assert models == ['gemini-2.5-flash', 'gemini-2.0-flash']


def test_all_keys_rate_limited_then_backoff_cycle_succeeds(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = 0
    delays: list[float] = []

    def fake_post(url: str, headers: dict, **kwargs: object) -> FakeResponse:
        nonlocal calls
        del url, headers, kwargs
        calls += 1
        if calls <= 2:
            return FakeResponse(429, {'error': {'status': 'RESOURCE_EXHAUSTED'}}, 'RESOURCE_EXHAUSTED')
        return response_for(valid_result())

    monkeypatch.setattr(httpx, 'post', fake_post)
    client = GeminiClient(keys=['one-key', 'two-key'], sleep_fn=delays.append)
    client._generate('prompt')

    assert calls == 3
    assert delays == [1.0]


def test_malformed_json_retries_once_on_same_key(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[str] = []

    def fake_post(url: str, headers: dict, **kwargs: object) -> FakeResponse:
        del url, kwargs
        calls.append(headers['X-Goog-Api-Key'])
        if len(calls) == 1:
            return response_for_text('not-json')
        return response_for(valid_result('Will I find a new role?'))

    monkeypatch.setattr(httpx, 'post', fake_post)
    client = GeminiClient(keys=['only-secret-key'])
    result = interpret(
        {'lagna': 'Pisces'},
        'career',
        ['Will I find a new role?'],
        client=client,
    )

    assert result['answers'][0]['question'] == 'Will I find a new role?'
    assert calls == ['only-secret-key', 'only-secret-key']


def test_still_malformed_json_raises_after_one_retry(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(httpx, 'post', lambda *args, **kwargs: response_for_text('still-not-json'))
    client = GeminiClient(keys=['only-secret-key'])

    with pytest.raises(InterpretationValidationError, match='after one retry'):
        interpret({'lagna': 'Pisces'}, 'kundli', [], client=client)


def response_for_text(text: str) -> FakeResponse:
    return FakeResponse(200, {'candidates': [{'content': {'parts': [{'text': text}]}}]})


def test_key_is_masked_in_errors_and_logs(monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture) -> None:
    secret = 'super-secret-key-1234'

    def fake_post(url: str, headers: dict, **kwargs: object) -> FakeResponse:
        del url, headers, kwargs
        return FakeResponse(500, {'error': {'message': secret}}, secret)

    monkeypatch.setattr(httpx, 'post', fake_post)
    client = GeminiClient(keys=[secret])
    with caplog.at_level(logging.WARNING):
        with pytest.raises(Exception) as caught:
            client._generate('prompt')

    message = str(caught.value)
    assert secret not in message
    assert secret[-4:] in message
    assert secret not in caplog.text


def test_service_prompts_include_milan_facts_and_prashna_focus(monkeypatch: pytest.MonkeyPatch) -> None:
    prompts: list[str] = []

    def fake_post(url: str, headers: dict, json: dict, **kwargs: object) -> FakeResponse:
        del url, headers, kwargs
        prompt = json['contents'][0]['parts'][0]['text']
        prompts.append(prompt)
        question = 'Will I travel?' if 'Will I travel?' in prompt else 'Is this a good match?'
        return response_for(valid_result(question))

    monkeypatch.setattr(httpx, 'post', fake_post)
    client = GeminiClient(keys=['prompt-key'])
    interpret(
        {
            'person': {'lagna': 'Pisces'},
            'partner': {'lagna': 'Cancer'},
            'matchScore': {'total': 27, 'outOf': 36},
        },
        'milan',
        ['Is this a good match?'],
        client=client,
    )
    interpret({'lagna': 'Pisces'}, 'prashna', ['Will I travel?'], client=client)

    assert 'compatibility' in prompts[0].lower()
    assert 'matchScore' in prompts[0]
    assert 'person' in prompts[0] and 'partner' in prompts[0]
    assert 'single customer question directly' in prompts[1]
    assert 'Will I travel?' in prompts[1]


def test_round_robin_starting_index_advances(monkeypatch: pytest.MonkeyPatch) -> None:
    used: list[str] = []

    def fake_post(url: str, headers: dict, **kwargs: object) -> FakeResponse:
        del url, kwargs
        used.append(headers['X-Goog-Api-Key'])
        return response_for(valid_result())

    monkeypatch.setattr(httpx, 'post', fake_post)
    client = GeminiClient(keys=['key-a', 'key-b', 'key-c'])
    client._generate('first')
    client._generate('second')

    assert used == ['key-a', 'key-b']
