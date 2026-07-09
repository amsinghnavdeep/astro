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
DEFAULT_SUBJECT = 'Your Janma Kundli is Ready — Siddh Jyotish'
WHATSAPP_NUMBER = '+91 7051300168'
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
        'subject': optional_string(data.get('subject'), 'subject') or DEFAULT_SUBJECT,
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
        'highlights': parse_items(as_list(interpretation.get('emailHighlights'), 'interpretation.emailHighlights'), 'interpretation.emailHighlights', [('label', 'label'), ('text', 'text')]),
        'goodNews': as_string(interpretation.get('emailGoodNews'), 'interpretation.emailGoodNews'),
    }


def greeting_for(person: dict[str, str]) -> tuple[str, str]:
    """Return (formal greeting line, affectionate address word)."""
    if person['gender'] == 'Male':
        return f'Namaste Shri {person["fullName"]} ji,', 'Beta'
    if person['gender'] == 'Female':
        return f'Namaste Smt. {person["fullName"]} ji,', 'Beti'
    return f'Namaste {person["fullName"]} ji,', 'Dear one'


def render_highlights(items: list[dict[str, str]]) -> str:
    return ''.join(
        f'<li style="margin-bottom:7px;"><b style="color:{BRAND["maroon_deep"]};">{escape(item["label"])}:</b> '
        f'{escape(item["text"])}</li>'
        for item in items
    )


def build_html(email: dict[str, Any]) -> str:
    greeting, child = greeting_for(email['person'])
    reference = email['pandit']['referenceNumber']
    pandit_name = email['pandit']['name']
    highlights = render_highlights(email['highlights'])
    return f'''<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>{escape(email['subject'])}</title>
</head>
<body style="margin:0;padding:0;background:{BRAND['cream']};color:{BRAND['text']};font-family:Mukta,system-ui,-apple-system,'Segoe UI',Arial,sans-serif;line-height:1.6;-webkit-text-size-adjust:100%;">
  <div style="max-width:640px;margin:0 auto;padding:26px 14px 40px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;background:{BRAND['card']};border:1px solid {BRAND['border']};border-radius:20px;overflow:hidden;box-shadow:0 12px 30px rgba(90,49,0,0.08);">
      <tr>
        <td style="background:linear-gradient(150deg,#8a2222,{BRAND['maroon']} 55%,{BRAND['maroon_deep']});padding:30px 28px;text-align:center;">
          <div style="font-size:26px;line-height:1;margin-bottom:8px;">🪔</div>
          <div style="text-transform:uppercase;letter-spacing:3px;font-size:11px;color:#f0d9a6;margin-bottom:8px;">Siddh Jyotish</div>
          <div style="font-family:Marcellus,'Cormorant Garamond',Georgia,serif;font-size:27px;color:#fdeecb;">Your Janma Kundli is Ready</div>
        </td>
      </tr>
      <tr>
        <td style="padding:24px 28px 8px;">
          <p style="margin:0 0 12px;color:{BRAND['maroon_deep']};font-size:14px;">{escape(greeting)}</p>
          <p style="margin:0 0 14px;">{escape(child)}, with folded hands I send you blessings. I am <b>{escape(pandit_name)}</b>, and it has been my joy to personally study your <b>Janma Kundli</b> (Vedic birth chart) and prepare your complete life reading. Your full report is attached as a PDF keepsake — <b>Kundli_Report.pdf</b>.</p>

          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;margin:6px 0 18px;">
            <tr><td style="background:{BRAND['maroon']};border-radius:14px;padding:14px 16px;">
              <div style="text-transform:uppercase;letter-spacing:1px;font-size:10px;color:#f0d9a6;font-weight:700;margin-bottom:6px;">Your reference number (keep it safe)</div>
              <div style="font-family:'Courier New',monospace;font-size:13px;font-weight:700;color:#ffffff;word-break:break-all;">{escape(reference)}</div>
            </td></tr>
          </table>

          <p style="margin:0 0 6px;font-weight:700;color:{BRAND['maroon']};">A few highlights from your chart:</p>
          <ul style="margin:0 0 14px;padding-left:20px;">{highlights}</ul>

          <p style="margin:0 0 16px;">{escape(email['goodNews'])}</p>

          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;margin:2px 0 16px;">
            <tr><td style="background:#f5fbf6;border:1px solid #cfe9d8;border-left:5px solid {BRAND['green']};border-radius:14px;padding:14px 16px;">
              <div style="font-family:Marcellus,Georgia,serif;font-size:15px;color:{BRAND['green']};margin-bottom:6px;">🪔 Personal guidance &amp; energised remedies</div>
              <div style="color:{BRAND['maroon_deep']};font-size:13px;">For an authentic energised gemstone (Pukhraj / Opal) or to arrange a Griha Pravesh, Santaan Gopal or Mangal-shanti pooja, please WhatsApp me personally at <b>{escape(WHATSAPP_NUMBER)}</b> and I will guide you at every step.</div>
            </td></tr>
          </table>

          <p style="margin:0 0 18px;">To ask a follow-up question later, visit <a href="{RETURNING_URL}" style="color:{BRAND['saffron']};font-weight:700;">{RETURNING_URL}</a>, paste your reference number above, and I will personally look into your chart again.</p>

          <p style="margin:0;font-family:Marcellus,Georgia,serif;font-size:16px;color:{BRAND['maroon']};">With blessings,</p>
          <p style="margin:2px 0 0;font-family:Marcellus,Georgia,serif;font-size:19px;font-weight:700;color:{BRAND['maroon']};">{escape(pandit_name)}</p>
          <p style="margin:2px 0 6px;color:{BRAND['muted']};font-size:12px;">Siddh Jyotish</p>
        </td>
      </tr>
      <tr>
        <td style="padding:14px 28px 22px;border-top:1px solid #f0e6cd;text-align:center;color:{BRAND['muted']};font-size:10px;">
          Siddh Jyotish · Vedic Astrology &amp; Jyotish · {escape(WHATSAPP_NUMBER)} · siddhjyotish.com
        </td>
      </tr>
    </table>
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
    if status in (401, 403):
        # A send-only (restricted) Resend key cannot read the domains endpoint.
        # That is expected in production, so skip the preflight rather than fail.
        print(f'NOTE: skipping domain preflight (restricted key, HTTP {status}).', file=sys.stderr)
        return
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
