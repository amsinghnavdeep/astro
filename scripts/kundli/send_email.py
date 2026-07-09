#!/usr/bin/env python3
from __future__ import annotations

import base64
import json
import os
import sys
import urllib.error
import urllib.request
from html import escape
from pathlib import Path
from typing import Any

API_URL = 'https://api.resend.com/emails'
DOMAINS_URL = 'https://api.resend.com/domains'
USER_AGENT = 'Siddh-Jyotish-Mailer/1.0'
DEFAULT_FROM = 'Siddh Jyotish <namaste@siddhjyotish.com>'
DEFAULT_SUBJECT_TEMPLATE = 'Your Janam Patrika from {pandit} at Siddh Jyotish'
WHATSAPP_URL = 'https://wa.me/917051300168'
RETURNING_URL = 'https://siddhjyotish.com/returning'
VERIFIED_DOMAIN = 'siddhjyotish.com'
BRAND = {
    'maroon': '#7a1e1e',
    'maroon_deep': '#5c1414',
    'saffron': '#e0812f',
    'marigold': '#f3a838',
    'gold': '#c9a227',
    'gold_soft': '#e6c766',
    'indigo': '#1b1440',
    'green': '#1f7a4d',
    'cream': '#fbf4e6',
    'card': '#fffdf8',
    'text': '#2b2116',
    'muted': '#6b5d47',
    'border': '#ecdcb8',
}


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


def as_object(value: Any, path: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        fail(f'{path} must be an object.')
    return value


def as_list(value: Any, path: str) -> list[Any]:
    if not isinstance(value, list):
        fail(f'{path} must be an array.')
    return value


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


def scalar_text(value: Any, path: str) -> str:
    if isinstance(value, str) and value.strip():
        return value.strip()
    if isinstance(value, (int, float)):
        return str(value)
    fail(f'{path} must be a string or number.')


def parse_items(items: list[Any], path: str, field_map: list[tuple[str, str]]) -> list[dict[str, str]]:
    parsed: list[dict[str, str]] = []
    for index, item in enumerate(items):
        obj = as_object(item, f'{path}[{index}]')
        parsed.append({key: as_string(obj.get(source), f'{path}[{index}].{source}') for key, source in field_map})
    return parsed


def parse_email_data(data: dict[str, Any], base_dir: Path) -> dict[str, Any]:
    person = as_object(data.get('person'), 'person')
    pandit = as_object(data.get('pandit'), 'pandit')
    chart = as_object(data.get('chart'), 'chart')
    interpretation = as_object(data.get('interpretation'), 'interpretation')

    pdf_path = base_dir / 'Kundli_Report.pdf'
    if not pdf_path.exists() or not pdf_path.is_file():
        fail(f'Missing Kundli_Report.pdf next to the data file: {pdf_path}')
    if pdf_path.stat().st_size <= 0:
        fail(f'Kundli_Report.pdf is empty: {pdf_path}')

    return {
        'from': optional_string(data.get('from'), 'from') or DEFAULT_FROM,
        'subject': optional_string(data.get('subject'), 'subject') or DEFAULT_SUBJECT_TEMPLATE.format(pandit=as_string(pandit.get('name'), 'pandit.name')),
        'to': as_string(pandit.get('customerEmail'), 'pandit.customerEmail'),
        'pdfPath': pdf_path,
        'person': {
            'fullName': as_string(person.get('fullName'), 'person.fullName'),
            'gender': as_string(person.get('gender'), 'person.gender'),
        },
        'pandit': {
            'name': as_string(pandit.get('name'), 'pandit.name'),
            'referenceNumber': as_string(pandit.get('referenceNumber'), 'pandit.referenceNumber'),
        },
        'answers': parse_items(as_list(interpretation.get('answers'), 'interpretation.answers'), 'interpretation.answers', [('question', 'question'), ('answer', 'answer')]),
        'concerns': parse_items(as_list(interpretation.get('concerns'), 'interpretation.concerns'), 'interpretation.concerns', [('title', 'title'), ('text', 'text')]),
        'remedies': parse_items(as_list(interpretation.get('remedies'), 'interpretation.remedies'), 'interpretation.remedies', [('title', 'title'), ('text', 'text')]),
        'doshas': [
            {
                'name': as_string(item.get('name'), f'chart.doshas[{index}].name'),
                'present': bool(item.get('present')),
                'note': as_string(item.get('note'), f'chart.doshas[{index}].note'),
            }
            for index, item in enumerate(as_list(chart.get('doshas'), 'chart.doshas'))
        ],
    }


def greeting_for(person: dict[str, str]) -> str:
    if person['gender'] == 'Male':
        prefix = 'Shri'
    elif person['gender'] == 'Female':
        prefix = 'Smt.'
    else:
        prefix = ''
    if prefix:
        return f'Namaste {prefix} {person["fullName"]} ji,'
    return f'Namaste {person["fullName"]} ji,'


def render_cards(items: list[dict[str, str]], title_key: str, text_key: str, class_name: str) -> str:
    if not items:
        return '<p class="empty-note">No items were shared in this section.</p>'
    return ''.join(
        f'<article class="{class_name}"><h3>{escape(item[title_key])}</h3><p>{escape(item[text_key])}</p></article>'
        for item in items
    )


def render_doshas(items: list[dict[str, Any]]) -> str:
    if not items:
        return '<p class="empty-note">No doshas were listed for this reading.</p>'
    return ''.join(
        f'<article class="dosha-card {"present" if item["present"] else "absent"}"><h3>{escape(item["name"])}</h3><b>{"Present" if item["present"] else "Not present"}</b><p>{escape(item["note"])}</p></article>'
        for item in items
    )


def build_html(email: dict[str, Any]) -> str:
    greeting = greeting_for(email['person'])
    reference = email['pandit']['referenceNumber']
    return f'''<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>{escape(email['subject'])}</title>
  <style>
    body {{
      margin: 0;
      padding: 0;
      background: {BRAND['cream']};
      color: {BRAND['text']};
      font-family: Mukta, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      line-height: 1.6;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }}
    .wrap {{ max-width: 720px; margin: 0 auto; padding: 24px 16px 40px; }}
    .card {{
      background: {BRAND['card']};
      border: 1px solid {BRAND['border']};
      border-radius: 22px;
      box-shadow: 0 12px 28px rgba(90, 49, 0, 0.07);
      overflow: hidden;
    }}
    .hero {{
      padding: 22px 22px 18px;
      background: linear-gradient(145deg, #fff8eb, #fdf4de 64%, #f8ebc8);
      border-bottom: 1px solid rgba(201, 162, 39, 0.35);
    }}
    .diya {{ font-size: 26px; margin-bottom: 6px; }}
    .brand {{
      text-transform: uppercase;
      letter-spacing: 1.8px;
      font-size: 10px;
      color: {BRAND['saffron']};
      font-weight: 700;
      margin-bottom: 8px;
    }}
    h1, h2, h3 {{
      margin: 0 0 0.45rem;
      color: {BRAND['maroon']};
      font-family: Marcellus, 'Cormorant Garamond', Georgia, serif;
      font-weight: 400;
      line-height: 1.15;
    }}
    h1 {{ font-size: 30px; }}
    h2 {{ font-size: 20px; }}
    h3 {{ font-size: 15px; }}
    p {{ margin: 0 0 0.75rem; }}
    .greeting {{ font-size: 15px; margin-top: 10px; }}
    .intro {{ color: {BRAND['maroon_deep']}; }}
    .reference-box {{
      margin: 18px 0 16px;
      padding: 14px 16px;
      border: 1px dashed {BRAND['gold']};
      border-radius: 18px;
      background: #fff8e6;
    }}
    .reference-label {{
      text-transform: uppercase;
      letter-spacing: 1px;
      font-size: 9px;
      color: {BRAND['muted']};
      font-weight: 700;
      margin-bottom: 6px;
    }}
    .reference-token {{
      font-size: 16px;
      font-weight: 700;
      color: {BRAND['maroon_deep']};
      word-break: break-all;
      overflow-wrap: anywhere;
    }}
    .section {{ padding: 18px 22px 0; }}
    .section h2 {{ margin-bottom: 10px; }}
    .grid {{ display: grid; gap: 12px; }}
    .grid.two {{ grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); }}
    .panel {{
      background: #fffdf8;
      border: 1px solid {BRAND['border']};
      border-radius: 18px;
      padding: 14px 15px;
    }}
    .panel h3 {{ color: {BRAND['saffron']}; }}
    .dosha-card {{
      background: #fffdf8;
      border: 1px solid {BRAND['border']};
      border-radius: 16px;
      padding: 12px 13px;
    }}
    .dosha-card.present {{ border-color: rgba(31, 122, 77, 0.42); background: #f4fff8; }}
    .dosha-card.absent {{ border-color: rgba(122, 30, 30, 0.25); background: #fff8f5; }}
    .dosha-card b {{ display: inline-block; margin-bottom: 6px; color: {BRAND['maroon_deep']}; }}
    .callout {{
      margin: 18px 22px 0;
      padding: 16px;
      border-radius: 18px;
      border: 1px solid rgba(201, 162, 39, 0.3);
      background: linear-gradient(180deg, #fffaf0, #fff3d2);
    }}
    .cta {{ display: flex; flex-wrap: wrap; gap: 10px; margin-top: 12px; }}
    .btn {{
      display: inline-block;
      text-decoration: none;
      border-radius: 999px;
      padding: 10px 16px;
      font-weight: 700;
    }}
    .btn.primary {{ background: linear-gradient(180deg, {BRAND['gold_soft']}, {BRAND['gold']}); color: {BRAND['indigo']}; }}
    .btn.secondary {{ background: {BRAND['maroon']}; color: white; }}
    .signature {{ margin-top: 14px; color: {BRAND['muted']}; }}
    .pdf-line {{ margin-top: 10px; font-weight: 700; }}
    .empty-note {{ color: {BRAND['muted']}; font-style: italic; margin: 0; }}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <div class="hero">
        <div class="diya">🪔</div>
        <div class="brand">Siddh Jyotish</div>
        <h1>{escape(email['subject'])}</h1>
        <p class="greeting">{escape(greeting)}</p>
        <p class="intro">I have prepared your Janam Patrika and the guidance for your path ahead. Please find the reading below, written with care for you.</p>
        <div class="reference-box">
          <div class="reference-label">Your key to ask me more at <a href="{RETURNING_URL}">{RETURNING_URL}</a></div>
          <div class="reference-token">{escape(reference)}</div>
        </div>
      </div>

      <div class="section">
        <h2>Your direct answers</h2>
        <div class="grid">{render_cards(email['answers'], 'question', 'answer', 'panel')}</div>
      </div>

      <div class="section">
        <h2>Concerns &amp; doshas</h2>
        <div class="grid two">{render_cards(email['concerns'], 'title', 'text', 'panel')}{render_doshas(email['doshas'])}</div>
      </div>

      <div class="section">
        <h2>Remedies</h2>
        <div class="grid">{render_cards(email['remedies'], 'title', 'text', 'panel')}</div>
      </div>

      <div class="callout">
        <p>When you are ready for more guidance, return with the same key and I will study your chart again for you.</p>
        <div class="cta">
          <a class="btn primary" href="{RETURNING_URL}">Ask follow-up questions</a>
          <a class="btn secondary" href="{WHATSAPP_URL}">WhatsApp +91 7051300168</a>
        </div>
        <p class="pdf-line">Your full report is attached as a PDF.</p>
        <p class="signature">With care,<br />{escape(email['pandit']['name'])}<br />Siddh Jyotish</p>
      </div>
    </div>
  </div>
</body>
</html>
'''


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


def build_payload(email: dict[str, Any], pdf_bytes: bytes) -> dict[str, Any]:
    html_body = build_html(email)
    return {
        'from': email['from'],
        'to': [email['to']],
        'subject': email['subject'],
        'html': html_body,
        'attachments': [
            {
                'filename': 'Kundli_Report.pdf',
                'content': base64.b64encode(pdf_bytes).decode('ascii'),
            }
        ],
    }


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
        fail('Usage: python scripts/kundli/send_email.py [--dry-run] data.json')

    input_path = Path(args[0]).expanduser().resolve()
    if not input_path.exists():
        fail(f'Input file not found: {input_path}')

    api_key = os.environ.get('RESEND_API_KEY')
    if not api_key:
        fail('RESEND_API_KEY is not set.')

    email = parse_email_data(read_json(input_path), input_path.parent)
    ensure_verified_domain(api_key)

    payload = build_payload(email, email['pdfPath'].read_bytes())

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
