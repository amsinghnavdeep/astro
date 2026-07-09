#!/usr/bin/env python3
from __future__ import annotations

import base64
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

API_URL = 'https://api.resend.com/emails'
DOMAINS_URL = 'https://api.resend.com/domains'
USER_AGENT = 'Siddh-Jyotish-Mailer/1.0'
DEFAULT_FROM = 'Siddh Jyotish <namaste@siddhjyotish.com>'
VERIFIED_DOMAIN = 'siddhjyotish.com'


def fail(message: str) -> None:
    print(f'ERROR: {message}', file=sys.stderr)
    raise SystemExit(1)


def read_json(path: Path) -> dict[str, Any]:
    try:
        payload = json.loads(path.read_text(encoding='utf-8'))
    except Exception as exc:  # pragma: no cover - defensive
        fail(f'Unable to read JSON: {exc}')
    if not isinstance(payload, dict):
        fail('Top-level JSON must be an object.')
    return payload


def as_string(value: Any, path: str) -> str:
    if not isinstance(value, str) or not value.strip():
        fail(f'{path} must be a non-empty string.')
    return value.strip()


def optional_string(value: Any, path: str) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        fail(f'{path} must be a string when provided.')
    value = value.strip()
    if not value:
        fail(f'{path} must be a non-empty string when provided.')
    return value


def parse_email_input(data: dict[str, Any], base_dir: Path) -> dict[str, Any]:
    to = as_string(data.get('to'), 'to')
    sender = optional_string(data.get('from'), 'from') or DEFAULT_FROM
    subject = as_string(data.get('subject'), 'subject')
    html = as_string(data.get('html'), 'html')
    pdf_path_value = as_string(data.get('pdfPath'), 'pdfPath')
    pdf_path = Path(pdf_path_value).expanduser()
    if not pdf_path.is_absolute():
        pdf_path = (base_dir / pdf_path).resolve()
    if not pdf_path.exists() or not pdf_path.is_file():
        fail(f'pdfPath does not exist or is not a file: {pdf_path}')
    if pdf_path.stat().st_size <= 0:
        fail(f'pdfPath is empty: {pdf_path}')
    return {
        'to': to,
        'from': sender,
        'subject': subject,
        'html': html,
        'pdfPath': pdf_path,
    }


def build_payload(email: dict[str, Any], pdf_bytes: bytes) -> dict[str, Any]:
    return {
        'from': email['from'],
        'to': [email['to']],
        'subject': email['subject'],
        'html': email['html'],
        'attachments': [
            {
                'filename': 'Kundli_Report.pdf',
                'content': base64.b64encode(pdf_bytes).decode('ascii'),
            }
        ],
    }


def headers(api_key: str) -> dict[str, str]:
    return {
        'Authorization': f'Bearer {api_key}',
        'User-Agent': USER_AGENT,
        'Accept': 'application/json',
    }


def request_json(url: str, api_key: str, method: str = 'GET', body: dict[str, Any] | None = None) -> tuple[int, str]:
    payload = None if body is None else json.dumps(body).encode('utf-8')
    request = urllib.request.Request(url, data=payload, headers=headers(api_key), method=method)
    if body is not None:
        request.add_header('Content-Type', 'application/json')
    try:
        with urllib.request.urlopen(request) as response:
            return response.status, response.read().decode('utf-8')
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode('utf-8', errors='replace')
    except urllib.error.URLError as exc:  # pragma: no cover - network issues
        fail(f'Network error calling {url}: {exc}')


def ensure_verified_domain(api_key: str) -> None:
    status, body = request_json(DOMAINS_URL, api_key, 'GET')
    if status != 200:
        fail(f'Domains preflight failed: HTTP {status}: {body.strip()}')

    try:
        payload = json.loads(body)
    except json.JSONDecodeError as exc:
        fail(f'Domains preflight returned invalid JSON: {exc}')

    entries: list[Any]
    if isinstance(payload, dict):
        data = payload.get('data')
        entries = data if isinstance(data, list) else []
    elif isinstance(payload, list):
        entries = payload
    else:
        entries = []

    verified = False
    statuses: list[str] = []
    for item in entries:
        if not isinstance(item, dict):
            continue
        name = str(item.get('name') or item.get('domain') or '').strip().lower()
        status_text = str(item.get('status') or '').strip().lower()
        if name:
            statuses.append(f'{name}:{status_text or "unknown"}')
        if name == VERIFIED_DOMAIN and status_text == 'verified':
            verified = True

    if not verified:
        listed = ', '.join(statuses) if statuses else 'no domains returned'
        fail(f'Resend domain {VERIFIED_DOMAIN} is not verified. Domains preflight saw: {listed}')


def send_email(api_key: str, payload: dict[str, Any]) -> str:
    status, body = request_json(API_URL, api_key, 'POST', payload)
    if status != 200:
        fail(f'Email send failed: HTTP {status}: {body.strip()}')

    try:
        response = json.loads(body)
    except json.JSONDecodeError as exc:
        fail(f'Email send returned invalid JSON: {exc}')

    email_id = response.get('id')
    if not isinstance(email_id, str) or not email_id.strip():
        fail('Email send succeeded but no id was returned.')
    return email_id.strip()


def main() -> None:
    args = sys.argv[1:]
    dry_run = False
    if args and args[0] == '--dry-run':
        dry_run = True
        args = args[1:]

    if len(args) != 1:
        fail('Usage: python scripts/kundli/send_email.py [--dry-run] email.json')

    input_path = Path(args[0]).expanduser().resolve()
    if not input_path.exists():
        fail(f'Input file not found: {input_path}')

    api_key = os.environ.get('RESEND_API_KEY')
    if not api_key:
        fail('RESEND_API_KEY is not set.')

    email = parse_email_input(read_json(input_path), input_path.parent)
    pdf_bytes = email['pdfPath'].read_bytes()
    payload = build_payload(email, pdf_bytes)

    ensure_verified_domain(api_key)

    if dry_run:
        print(
            json.dumps(
                {
                    'url': API_URL,
                    'method': 'POST',
                    'headers': {'User-Agent': USER_AGENT},
                    'payload': payload,
                },
                indent=2,
                ensure_ascii=False,
            )
        )
        return

    email_id = send_email(api_key, payload)
    print(email_id)


if __name__ == '__main__':
    main()
