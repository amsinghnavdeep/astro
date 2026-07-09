#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from datetime import datetime, timezone
from html import escape
from pathlib import Path
from string import Template
from typing import Any

PDF_NAME = 'Kundli_Report.pdf'
HTML_NAME = 'report.html'
# Structural floor only: a real report always has at least the cover, the
# chart page, and a reading page. The substantive quality gate is the marker
# and blank-page checks below — NOT a fixed page count, since a correct report
# can legitimately paginate to 4 pages when the interpretation is more concise.
MIN_PAGE_COUNT = 3
WHATSAPP_URL = 'https://wa.me/917051300168'
BRAND = {
    'maroon': '#7a1e1e',
    'maroon_deep': '#5c1414',
    'saffron': '#e0812f',
    'marigold': '#f3a838',
    'gold': '#c9a227',
    'gold_soft': '#e6c766',
    'green': '#1f7a4d',
    'cream': '#fbf4e6',
    'card': '#fffdf8',
    'text': '#2b2116',
    'muted': '#6b5d47',
    'border': '#ecdcb8',
    'indigo': '#1b1440',
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


def as_bool(value: Any, path: str) -> bool:
    if not isinstance(value, bool):
        fail(f'{path} must be a boolean.')
    return value


def scalar_text(value: Any, path: str) -> str:
    if isinstance(value, str) and value.strip():
        return value.strip()
    if isinstance(value, (int, float)):
        return str(value)
    fail(f'{path} must be a string or number.')


def parse_person(data: dict[str, Any]) -> dict[str, str]:
    person = as_object(data.get('person'), 'person')
    return {
        'fullName': as_string(person.get('fullName'), 'person.fullName'),
        'gender': as_string(person.get('gender'), 'person.gender'),
        'dateOfBirth': as_string(person.get('dateOfBirth'), 'person.dateOfBirth'),
        'timeOfBirth': as_string(person.get('timeOfBirth'), 'person.timeOfBirth'),
        'placeOfBirth': as_string(person.get('placeOfBirth'), 'person.placeOfBirth'),
        'timezone': as_string(person.get('timezone'), 'person.timezone'),
    }


def parse_pandit(data: dict[str, Any]) -> dict[str, str]:
    pandit = as_object(data.get('pandit'), 'pandit')
    return {
        'name': as_string(pandit.get('name'), 'pandit.name'),
        'referenceNumber': as_string(pandit.get('referenceNumber'), 'pandit.referenceNumber'),
        'customerEmail': as_string(pandit.get('customerEmail'), 'pandit.customerEmail'),
    }


def parse_planet(value: Any, path: str) -> dict[str, str]:
    planet = as_object(value, path)
    return {
        'name': as_string(planet.get('name'), f'{path}.name'),
        'sign': as_string(planet.get('sign'), f'{path}.sign'),
        'degree': as_string(planet.get('degree'), f'{path}.degree'),
        'nakshatra': as_string(planet.get('nakshatra'), f'{path}.nakshatra'),
        'pada': scalar_text(planet.get('pada'), f'{path}.pada'),
        'house': scalar_text(planet.get('house'), f'{path}.house'),
    }


def parse_navamsa(value: Any, path: str) -> dict[str, str]:
    item = as_object(value, path)
    return {
        'name': as_string(item.get('name'), f'{path}.name'),
        'sign': as_string(item.get('sign'), f'{path}.sign'),
        'house': scalar_text(item.get('house'), f'{path}.house'),
    }


def parse_dasha(value: Any, path: str) -> dict[str, Any]:
    item = as_object(value, path)
    return {
        'maha': as_string(item.get('maha'), f'{path}.maha'),
        'start': as_string(item.get('start'), f'{path}.start'),
        'end': as_string(item.get('end'), f'{path}.end'),
        'active': as_bool(item.get('active'), f'{path}.active'),
    }


def parse_dosha(value: Any, path: str) -> dict[str, Any]:
    item = as_object(value, path)
    return {
        'name': as_string(item.get('name'), f'{path}.name'),
        'present': as_bool(item.get('present'), f'{path}.present'),
        'note': as_string(item.get('note'), f'{path}.note'),
    }


def parse_interpretation(data: dict[str, Any]) -> dict[str, Any]:
    interpretation = as_object(data.get('interpretation'), 'interpretation')
    return {
        'summary': as_string(interpretation.get('summary'), 'interpretation.summary'),
        'personality': as_string(interpretation.get('personality'), 'interpretation.personality'),
        'houseHighlights': [
            {
                'title': as_string(item.get('title'), f'interpretation.houseHighlights[{i}].title'),
                'text': as_string(item.get('text'), f'interpretation.houseHighlights[{i}].text'),
            }
            for i, item in enumerate(as_list(interpretation.get('houseHighlights'), 'interpretation.houseHighlights'))
        ],
        'predictions': [
            {
                'period': as_string(item.get('period'), f'interpretation.predictions[{i}].period'),
                'text': as_string(item.get('text'), f'interpretation.predictions[{i}].text'),
            }
            for i, item in enumerate(as_list(interpretation.get('predictions'), 'interpretation.predictions'))
        ],
        'concerns': [
            {
                'title': as_string(item.get('title'), f'interpretation.concerns[{i}].title'),
                'text': as_string(item.get('text'), f'interpretation.concerns[{i}].text'),
            }
            for i, item in enumerate(as_list(interpretation.get('concerns'), 'interpretation.concerns'))
        ],
        'remedies': [
            {
                'title': as_string(item.get('title'), f'interpretation.remedies[{i}].title'),
                'text': as_string(item.get('text'), f'interpretation.remedies[{i}].text'),
            }
            for i, item in enumerate(as_list(interpretation.get('remedies'), 'interpretation.remedies'))
        ],
        'answers': [
            {
                'question': as_string(item.get('question'), f'interpretation.answers[{i}].question'),
                'answer': as_string(item.get('answer'), f'interpretation.answers[{i}].answer'),
            }
            for i, item in enumerate(as_list(interpretation.get('answers'), 'interpretation.answers'))
        ],
    }


def parse_chart(data: dict[str, Any]) -> dict[str, Any]:
    chart = as_object(data.get('chart'), 'chart')
    return {
        'ayanamsa': as_string(chart.get('ayanamsa'), 'chart.ayanamsa'),
        'lagna': as_string(chart.get('lagna'), 'chart.lagna'),
        'planets': [parse_planet(item, f'chart.planets[{i}]') for i, item in enumerate(as_list(chart.get('planets'), 'chart.planets'))],
        'navamsa': [parse_navamsa(item, f'chart.navamsa[{i}]') for i, item in enumerate(as_list(chart.get('navamsa'), 'chart.navamsa'))],
        'dasha': [parse_dasha(item, f'chart.dasha[{i}]') for i, item in enumerate(as_list(chart.get('dasha'), 'chart.dasha'))],
        'doshas': [parse_dosha(item, f'chart.doshas[{i}]') for i, item in enumerate(as_list(chart.get('doshas'), 'chart.doshas'))],
    }


def wrap_text(text: str, max_chars: int = 15) -> list[str]:
    words = text.split()
    lines: list[str] = []
    current = ''
    for word in words:
        candidate = word if not current else f'{current} {word}'
        if len(candidate) <= max_chars:
            current = candidate
        else:
            if current:
                lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines or ['']


def render_svg(title: str, lagna: str, items: list[dict[str, str]], chart_type: str) -> str:
    house_map: dict[int, list[str]] = {i: [] for i in range(1, 13)}
    for item in items:
        match = re.search(r'\d+', str(item.get('house', '')))
        if match:
            house = int(match.group())
            if 1 <= house <= 12:
                house_map[house].append(item['name'])

    house_positions = {
        1: (210, 84),
        2: (130, 120),
        3: (290, 120),
        4: (338, 196),
        5: (338, 252),
        6: (338, 308),
        7: (210, 384),
        8: (130, 348),
        9: (82, 308),
        10: (82, 252),
        11: (82, 196),
        12: (130, 308),
    }

    cells: list[str] = []
    for house in range(1, 13):
        x, y = house_positions[house]
        base_label = f'{house}' if house != 1 else f'1 · Lagna {lagna}'
        text_lines = wrap_text(base_label)
        text_lines.extend(wrap_text(' / '.join(house_map[house])))
        spans = []
        for index, line in enumerate(text_lines[:4]):
            dy = 0 if index == 0 else 13
            spans.append(f'<tspan x="{x}" dy="{dy}">{escape(line)}</tspan>')
        cell_class = 'chart-cell chart-cell-lagna' if house == 1 else 'chart-cell'
        cells.append(
            f'<g class="{cell_class}"><rect x="{x - 46}" y="{y - 26}" rx="12" ry="12" width="92" height="52" />'
            f'<text x="{x}" y="{y - 5}" text-anchor="middle">{"".join(spans)}</text></g>'
        )

    center_label = 'D-1' if chart_type == 'd1' else 'D-9'
    center_sub = 'Lagna chart' if chart_type == 'd1' else 'Navamsa chart'
    return f'''
    <svg class="chart-svg" viewBox="0 0 420 420" role="img" aria-label="{escape(title)}">
      <defs>
        <linearGradient id="chart-ring-{chart_type}" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="{BRAND['gold_soft']}" />
          <stop offset="100%" stop-color="{BRAND['gold']}" />
        </linearGradient>
      </defs>
      <rect x="14" y="14" width="392" height="392" rx="24" fill="{BRAND['card']}" stroke="{BRAND['border']}" stroke-width="2" />
      <polygon points="210,28 392,210 210,392 28,210" fill="#fffaf0" stroke="url(#chart-ring-{chart_type})" stroke-width="3.5" />
      <polygon points="210,84 346,210 210,336 74,210" fill="none" stroke="{BRAND['gold']}" stroke-width="2" opacity="0.7" />
      <line x1="28" y1="210" x2="392" y2="210" stroke="{BRAND['gold']}" stroke-width="1.6" opacity="0.72" />
      <line x1="210" y1="28" x2="210" y2="392" stroke="{BRAND['gold']}" stroke-width="1.6" opacity="0.72" />
      <line x1="74" y1="74" x2="346" y2="346" stroke="{BRAND['border']}" stroke-width="1.4" opacity="0.95" />
      <line x1="346" y1="74" x2="74" y2="346" stroke="{BRAND['border']}" stroke-width="1.4" opacity="0.95" />
      <text class="chart-title" x="210" y="48" text-anchor="middle">{escape(title)}</text>
      <text class="chart-lagna" x="210" y="66" text-anchor="middle">{escape(f'Lagna: {lagna}')}</text>
      <circle cx="210" cy="210" r="26" fill="#fff5dc" stroke="{BRAND['marigold']}" stroke-width="2" />
      <text class="chart-center-label" x="210" y="205" text-anchor="middle">{escape(center_label)}</text>
      <text class="chart-center-sub" x="210" y="221" text-anchor="middle">{escape(center_sub)}</text>
      {''.join(cells)}
    </svg>
    '''


def render_report(data: dict[str, Any]) -> str:
    person = parse_person(data)
    pandit = parse_pandit(data)
    chart = parse_chart(data)
    interp = parse_interpretation(data)

    planetary_rows = ''.join(
        '<tr>'
        f'<td>{escape(item["name"])}</td>'
        f'<td>{escape(item["sign"])}</td>'
        f'<td>{escape(item["degree"])}</td>'
        f'<td>{escape(item["nakshatra"])}</td>'
        f'<td>{escape(item["pada"])}</td>'
        f'<td>{escape(item["house"])}</td>'
        '</tr>'
        for item in chart['planets']
    )

    navamsa_rows = ''.join(
        '<tr>'
        f'<td>{escape(item["name"])}</td>'
        f'<td>{escape(item["sign"])}</td>'
        f'<td>{escape(item["house"])}</td>'
        '</tr>'
        for item in chart['navamsa']
    )

    dasha_rows = ''.join(
        '<tr>'
        f'<td>{escape(item["maha"])}</td>'
        f'<td>{escape(item["start"])}</td>'
        f'<td>{escape(item["end"])}</td>'
        f'<td>{"Yes" if item["active"] else "No"}</td>'
        '</tr>'
        for item in chart['dasha']
    )

    dosha_cards = ''.join(
        f'<article class="mini-card {"present" if item["present"] else "absent"}"><h4>{escape(item["name"])}</h4><b>{"Present" if item["present"] else "Not present"}</b><p>{escape(item["note"])}</p></article>'
        for item in chart['doshas']
    )

    house_cards = ''.join(
        f'<article class="panel"><h3>{escape(item["title"])}</h3><p>{escape(item["text"])}</p></article>'
        for item in interp['houseHighlights']
    )
    prediction_cards = ''.join(
        f'<article class="panel"><h3>{escape(item["period"])}</h3><p>{escape(item["text"])}</p></article>'
        for item in interp['predictions']
    )
    concern_cards = ''.join(
        f'<article class="panel"><h3>{escape(item["title"])}</h3><p>{escape(item["text"])}</p></article>'
        for item in interp['concerns']
    )
    remedy_cards = ''.join(
        f'<article class="panel remedy"><h3>{escape(item["title"])}</h3><p>{escape(item["text"])}</p></article>'
        for item in interp['remedies']
    )
    answer_cards = ''.join(
        f'<article class="qa"><h3>Q. {escape(item["question"])}</h3><p><strong>A.</strong> {escape(item["answer"])}</p></article>'
        for item in interp['answers']
    )

    generated_on = datetime.now(timezone.utc).strftime('%d %b %Y')
    title = f"{person['fullName']} — Janma Kundli Report"

    html = Template(
        r'''<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>$title</title>
  <style>
    @page { size: A4; margin: 18mm 16mm; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; }
    body {
      background: $cream;
      color: $text;
      font-family: Mukta, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 12.25px;
      line-height: 1.55;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    h1, h2, h3, h4 {
      margin: 0 0 0.45rem;
      color: $maroon;
      font-family: Marcellus, "Cormorant Garamond", Georgia, serif;
      font-weight: 400;
      line-height: 1.1;
    }
    h1 { font-size: 31px; }
    h2 { font-size: 20px; }
    h3 { font-size: 15px; }
    h4 { font-size: 13px; }
    p { margin: 0 0 0.72rem; }
    .page { margin: 0; }
    .page-break { break-before: page; page-break-before: always; }
    .card {
      background: $card;
      border: 1px solid $border;
      border-radius: 20px;
      box-shadow: 0 8px 26px rgba(90, 49, 0, 0.05);
      padding: 16px;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .hero-banner {
      padding: 18px;
      border-radius: 24px;
      background: linear-gradient(145deg, #fff8eb, #fdf4de 64%, #f8ebc8);
      border: 1px solid rgba(201, 162, 39, 0.42);
      box-shadow: 0 14px 30px rgba(90, 49, 0, 0.08);
    }
    .diya { font-size: 26px; margin-bottom: 6px; }
    .brand-line {
      text-transform: uppercase;
      letter-spacing: 1.8px;
      font-size: 10px;
      color: $saffron;
      font-weight: 700;
      margin-bottom: 8px;
    }
    .title-row {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      align-items: end;
    }
    .title-row > div:first-child { flex: 1 1 auto; min-width: 0; }
    .title-row > div:last-child { flex: 0 0 auto; }
    .meta-grid {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-top: 14px;
    }
    .meta {
      border: 1px solid $border;
      background: rgba(255, 255, 255, 0.72);
      border-radius: 14px;
      padding: 10px 12px;
    }
    .meta label {
      display: block;
      text-transform: uppercase;
      letter-spacing: 1px;
      font-size: 9px;
      color: $muted;
      margin-bottom: 4px;
      font-weight: 700;
    }
    .meta strong { color: $maroon_deep; }
    .intro {
      margin-top: 14px;
      font-size: 13.3px;
      max-width: 66ch;
    }
    .signature { margin-top: 12px; font-size: 11px; color: $muted; }
    .section-head {
      display: flex;
      justify-content: space-between;
      align-items: end;
      gap: 16px;
      margin-bottom: 12px;
    }
    .section-head small { color: $muted; }
    .chart-grid {
      display: flex;
      flex-wrap: wrap;
      gap: 14px;
      align-items: start;
    }
    .chart-grid > .chart-shell { flex: 1 1 320px; min-width: 0; }
    .chart-shell { break-inside: avoid; page-break-inside: avoid; }
    .chart-caption {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      align-items: baseline;
      margin-bottom: 8px;
      color: $muted;
    }
    .chart-caption b { color: $maroon; }
    .chart-svg { width: 100%; height: auto; display: block; max-height: 235px; }
    .chart-title { font-family: Marcellus, Georgia, serif; font-size: 16px; fill: $maroon; }
    .chart-lagna, .chart-center-sub { font-family: Mukta, system-ui, sans-serif; fill: $muted; font-size: 10px; }
    .chart-center-label { font-family: Mukta, system-ui, sans-serif; fill: $maroon_deep; font-size: 13px; font-weight: 700; }
    .chart-cell rect { fill: #fffdf8; stroke: $border; stroke-width: 1.2; }
    .chart-cell text { font-family: Mukta, system-ui, sans-serif; fill: $text; font-size: 9px; }
    .chart-cell-lagna rect { fill: #fff3d2; stroke: $gold; stroke-width: 1.6; }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 10px;
      font-size: 11.2px;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    th, td {
      border: 1px solid $border;
      padding: 7px 8px;
      text-align: left;
      vertical-align: top;
    }
    th {
      background: #fff4d6;
      color: $maroon_deep;
      font-size: 10px;
      letter-spacing: 0.7px;
      text-transform: uppercase;
    }
    .grid-2 {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
    }
    .grid-2 > * { flex: 1 1 320px; min-width: 0; }
    .panel {
      background: $card;
      border: 1px solid $border;
      border-radius: 18px;
      padding: 14px 15px;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .panel h3 { color: $saffron; }
    .remedy { border-left: 4px solid $green; }
    .mini-card {
      background: #fffdf8;
      border: 1px solid $border;
      border-radius: 16px;
      padding: 12px 13px;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .mini-card.present { border-color: rgba(31, 122, 77, 0.42); background: #f4fff8; }
    .mini-card.absent { border-color: rgba(122, 30, 30, 0.25); background: #fff8f5; }
    .mini-card b { display: inline-block; color: $maroon_deep; margin-bottom: 6px; }
    .qa { background: $card; border: 1px solid $border; border-radius: 16px; padding: 12px 13px; }
    .qa h3 { color: $maroon_deep; }
    .answer-list { display: grid; gap: 12px; }
    .closing-box {
      max-width: 520px;
      margin: 0 auto;
      text-align: center;
    }
    .reference {
      margin: 14px auto 18px;
      display: inline-block;
      padding: 12px 16px;
      border-radius: 16px;
      border: 1px dashed $gold;
      background: #fff8e6;
      font-size: 15px;
      font-weight: 700;
      color: $maroon_deep;
    }
    .cta-row {
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      gap: 10px;
      margin-top: 18px;
    }
    .btn {
      display: inline-block;
      padding: 10px 16px;
      border-radius: 999px;
      text-decoration: none;
      font-weight: 700;
      border: 1px solid transparent;
    }
    .btn-primary { background: linear-gradient(180deg, $gold_soft, $gold); color: $indigo; }
    .btn-secondary { background: $maroon; color: white; }
    .footer-note { color: $muted; font-size: 11px; margin-top: 12px; }
  </style>
</head>
<body>
  <section class="page page-break">
    <div class="hero-banner card">
      <div class="diya">🪔</div>
      <div class="brand-line">Siddh Jyotish · Janma Kundli Report</div>
      <div class="title-row">
        <div>
          <h1>$full_name</h1>
          <p class="subtle">Prepared by $pandit_name</p>
        </div>
        <div>
          <p class="subtle" style="text-align:right;margin:0;">Reference number</p>
          <div style="text-align:right;font-size:18px;font-weight:700;color:$maroon_deep;">$reference_number</div>
        </div>
      </div>
      <p class="intro">Namaste. This is your personal Janma Kundli — your Vedic birth chart, studied and prepared for you with care. Within these pages you will find your planetary placements, the charts that shape your life, and guidance on the path ahead.</p>
      <div class="meta-grid">
        <div class="meta"><label>Name</label><strong>$full_name</strong></div>
        <div class="meta"><label>Gender</label><strong>$gender</strong></div>
        <div class="meta"><label>Date of birth</label><strong>$date_of_birth</strong></div>
        <div class="meta"><label>Time of birth</label><strong>$time_of_birth</strong></div>
        <div class="meta"><label>Place of birth</label><strong>$place_of_birth</strong></div>
        <div class="meta"><label>Timezone</label><strong>$timezone</strong></div>
      </div>
      <div class="signature">Customer email: $customer_email · Generated $generated_on UTC</div>
    </div>
  </section>

  <section class="page page-break">
    <div class="section-head">
      <div>
        <h2>D-1 Lagna Chart · D-9 Navamsa Chart</h2>
        <small>Your birth chart in the traditional North-Indian style.</small>
      </div>
      <small>Lagna sign: <strong>$lagna</strong> · Ayanamsa: $ayanamsa</small>
    </div>
    <div class="chart-grid">
      <div class="chart-shell card">
        <div class="chart-caption"><b>D-1 Lagna Chart</b><span>Your birth (Rashi) chart</span></div>
        $d1_svg
      </div>
      <div class="chart-shell card">
        <div class="chart-caption"><b>D-9 Navamsa Chart</b><span>The chart of destiny &amp; marriage</span></div>
        $d9_svg
      </div>
    </div>

    <div class="card" style="margin-top:14px;">
      <h3>Planetary positions</h3>
      <table>
        <thead>
          <tr><th>Planet</th><th>Sign</th><th>Degree</th><th>Nakshatra</th><th>Pada</th><th>House</th></tr>
        </thead>
        <tbody>$planetary_rows</tbody>
      </table>
    </div>

    <div class="grid-2" style="margin-top:14px;">
      <div class="card">
        <h3>Dasha timeline</h3>
        <table>
          <thead><tr><th>Maha dasha</th><th>Start</th><th>End</th><th>Active</th></tr></thead>
          <tbody>$dasha_rows</tbody>
        </table>
      </div>
      <div class="card">
        <h3>Doshas</h3>
        <div class="grid-2">$dosha_cards</div>
      </div>
    </div>
  </section>

  <section class="page">
    <div class="section-head">
      <div>
        <h2>Your Reading · Nature &amp; the houses of your life</h2>
        <small>What your chart reveals about you.</small>
      </div>
    </div>
    <div class="grid-2">
      <article class="panel" style="grid-column:1/-1;">
        <h3>Summary</h3>
        <p>$summary</p>
      </article>
      <article class="panel" style="grid-column:1/-1;">
        <h3>Personality</h3>
        <p>$personality</p>
      </article>
    </div>
    <div style="margin-top:14px;">
      <h3>House highlights</h3>
      <div class="grid-2">$house_cards</div>
    </div>
  </section>

  <section class="page">
    <div class="section-head">
      <div>
        <h2>Your Reading · Predictions, concerns, remedies &amp; answers</h2>
        <small>The road ahead and how to walk it with confidence.</small>
      </div>
    </div>
    <div>
      <h3>Predictions</h3>
      <div class="grid-2">$prediction_cards</div>
    </div>
    <div style="margin-top:14px;">
      <h3>Concerns</h3>
      <div class="grid-2">$concern_cards</div>
    </div>
    <div style="margin-top:14px;">
      <h3>Remedies</h3>
      <div class="grid-2">$remedy_cards</div>
    </div>
    <div style="margin-top:14px;">
      <h3>Answers</h3>
      <div class="answer-list">$answer_cards</div>
    </div>
  </section>

  <section class="page">
    <div class="closing-box card">
      <div class="diya">🪔</div>
      <h2>Your key to ask me more</h2>
      <div class="reference">$reference_number</div>
      <p class="subtle">This reference number is your open door back to me — use it at siddhjyotish.com/returning whenever a new question arises, and I will study your chart again for you.</p>
      <div class="cta-row">
        <a class="btn btn-primary" href="https://siddhjyotish.com/returning">Ask follow-up questions</a>
        <a class="btn btn-secondary" href="$whatsapp_url">WhatsApp support</a>
      </div>
      <p class="footer-note">Prepared for you with devotion at Siddh Jyotish. May the grace of the grahas light your path. 🙏</p>
    </div>
  </section>
</body>
</html>
'''
    ).substitute(
        title=escape(title),
        full_name=escape(person['fullName']),
        pandit_name=escape(pandit['name']),
        reference_number=escape(pandit['referenceNumber']),
        customer_email=escape(pandit['customerEmail']),
        generated_on=escape(generated_on),
        gender=escape(person['gender']),
        date_of_birth=escape(person['dateOfBirth']),
        time_of_birth=escape(person['timeOfBirth']),
        place_of_birth=escape(person['placeOfBirth']),
        timezone=escape(person['timezone']),
        lagna=escape(chart['lagna']),
        ayanamsa=escape(chart['ayanamsa']),
        d1_svg=render_svg('D-1 Lagna Chart', chart['lagna'], chart['planets'], 'd1'),
        d9_svg=render_svg('D-9 Navamsa Chart', chart['lagna'], chart['navamsa'], 'd9'),
        planetary_rows=planetary_rows,
        dasha_rows=dasha_rows,
        dosha_cards=dosha_cards,
        summary=escape(interp['summary']),
        personality=escape(interp['personality']),
        house_cards=house_cards,
        prediction_cards=prediction_cards,
        concern_cards=concern_cards,
        remedy_cards=remedy_cards,
        answer_cards=answer_cards,
        whatsapp_url=WHATSAPP_URL,
        cream=BRAND['cream'],
        text=BRAND['text'],
        maroon=BRAND['maroon'],
        maroon_deep=BRAND['maroon_deep'],
        saffron=BRAND['saffron'],
        marigold=BRAND['marigold'],
        gold=BRAND['gold'],
        gold_soft=BRAND['gold_soft'],
        green=BRAND['green'],
        card=BRAND['card'],
        muted=BRAND['muted'],
        border=BRAND['border'],
        indigo=BRAND['indigo'],
    )
    return html


def find_chrome_binary() -> str:
    env_bin = os.environ.get('CHROME_BIN')
    if env_bin:
        path = Path(env_bin)
        if path.exists():
            return str(path)

    def newest_executable(root: Path) -> Path | None:
        real_candidates: list[Path] = []
        wrapper_candidates: list[Path] = []
        for path in root.rglob('*'):
            if not path.is_file() or not os.access(path, os.X_OK):
                continue
            name = path.name.lower()
            if name in {'chrome', 'chromium', 'chrome-headless-shell'}:
                real_candidates.append(path)
            elif 'chrome' in name or 'chromium' in name:
                wrapper_candidates.append(path)
        candidates = real_candidates or wrapper_candidates
        if not candidates:
            return None
        return max(candidates, key=lambda item: item.stat().st_mtime)

    for root in (Path('/opt/.devin/chrome'), Path('/opt/.devin/playwright_browsers')):
        if not root.exists():
            continue
        candidate = newest_executable(root)
        if candidate:
            return str(candidate)

    fail('Unable to find Chrome binary. Set CHROME_BIN or install a browser under /opt/.devin/chrome.')
    raise AssertionError('unreachable')


def run_chrome(chrome_bin: str, html_path: Path, pdf_path: Path) -> None:
    chrome_dir = Path('/tmp/chrome-pdf')
    chrome_dir.mkdir(parents=True, exist_ok=True)
    cmd = [
        chrome_bin,
        '--headless=new',
        '--disable-gpu',
        '--no-sandbox',
        '--disable-dev-shm-usage',
        f'--user-data-dir={chrome_dir}',
        '--no-pdf-header-footer',
        f'--print-to-pdf={pdf_path}',
        str(html_path),
    ]
    print('Rendering PDF with:', ' '.join(cmd))
    subprocess.run(cmd, check=True)


def validate_pdf(pdf_path: Path, data: dict[str, Any]) -> int:
    try:
        from pypdf import PdfReader
    except Exception as exc:  # pragma: no cover - dependency issue
        fail(f'pypdf is required for validation: {exc}')

    if not pdf_path.exists() or pdf_path.stat().st_size <= 0:
        fail('PDF was not created or is empty.')

    reader = PdfReader(str(pdf_path))
    page_count = len(reader.pages)
    if page_count < MIN_PAGE_COUNT:
        fail(f'PDF page count {page_count} is below the structural minimum of {MIN_PAGE_COUNT}.')

    extracted_pages: list[str] = []
    blank_pages: list[int] = []
    for index, page in enumerate(reader.pages, start=1):
        text = (page.extract_text() or '').strip()
        extracted_pages.append(text)
        if not text:
            blank_pages.append(index)

    if blank_pages:
        fail(f'Blank pages detected: {", ".join(map(str, blank_pages))}.')

    all_text = '\n'.join(extracted_pages).lower()
    lagna = str(as_object(data.get('chart'), 'chart').get('lagna', '')).lower()
    required_markers = [lagna, 'planetary', 'd-1 lagna chart', 'd-9 navamsa chart', 'predictions', 'remedies', 'answers']
    missing = [marker for marker in required_markers if marker and marker not in all_text]
    if missing:
        fail('Missing validation markers: ' + ', '.join(missing))

    print(f'VALIDATION PASS: {page_count} pages, no blank pages, required markers found.')
    return page_count


def main() -> None:
    if len(sys.argv) != 2:
        fail('Usage: python scripts/kundli/generate_report.py data.json')

    input_path = Path(sys.argv[1]).expanduser().resolve()
    if not input_path.exists():
        fail(f'Input file not found: {input_path}')

    data = read_json(input_path)
    html = render_report(data)

    output_dir = input_path.parent
    html_path = output_dir / HTML_NAME
    pdf_path = output_dir / PDF_NAME
    html_path.write_text(html, encoding='utf-8')

    chrome_bin = find_chrome_binary()
    run_chrome(chrome_bin, html_path, pdf_path)
    page_count = validate_pdf(pdf_path, data)
    print(f'Created {pdf_path} with {page_count} pages.')


if __name__ == '__main__':
    main()
