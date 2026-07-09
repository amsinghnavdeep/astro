#!/usr/bin/env python3
"""Siddh Jyotish — Janma Kundli PDF report generator.

This renders a FIXED, brand-consistent report template. The AI/backend only ever
fills the *values* inside ``data.json`` — it must never add, remove or rename keys.
Every heading, the cover, the North-Indian square chart diagrams, the tables, the
footers and all static copy live here in the template and stay identical for every
customer. Supply the data; the layout is not yours to change.

Usage:
    python scripts/kundli/generate_report.py data.json
It writes ``Kundli_Report.pdf`` (and ``report.html``) next to the input JSON and
prints ``VALIDATION PASS`` when the rendered PDF passes the mechanical gate.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from html import escape
from pathlib import Path
from typing import Any

PDF_NAME = 'Kundli_Report.pdf'
HTML_NAME = 'report.html'
MIN_PAGE_COUNT = 6
WHATSAPP_NUMBER = '+91 7051300168'
WHATSAPP_URL = 'https://wa.me/917051300168'
RETURNING_URL = 'https://siddhjyotish.com/returning'
CONTACT_EMAIL = 'namaste@siddhjyotish.com'
SITE = 'siddhjyotish.com'

BRAND = {
    'maroon': '#7a1e1e',
    'maroon_deep': '#5c1414',
    'saffron': '#e0812f',
    'marigold': '#f3a838',
    'gold': '#c9a227',
    'gold_soft': '#e6c766',
    'green': '#1f7a4d',
    'cream': '#fbf4e6',
    'page': '#fffdf9',
    'card': '#fffdf8',
    'text': '#2b2116',
    'muted': '#6b5d47',
    'border': '#ecdcb8',
    'indigo': '#1b1440',
}

SIGNS = [
    ('Aries', 'Mesha'), ('Taurus', 'Vrishabha'), ('Gemini', 'Mithuna'),
    ('Cancer', 'Karka'), ('Leo', 'Simha'), ('Virgo', 'Kanya'),
    ('Libra', 'Tula'), ('Scorpio', 'Vrischika'), ('Sagittarius', 'Dhanu'),
    ('Capricorn', 'Makara'), ('Aquarius', 'Kumbha'), ('Pisces', 'Meena'),
]

PLANET_ABBR = {
    'sun': 'Su', 'moon': 'Mo', 'mars': 'Ma', 'mercury': 'Me', 'jupiter': 'Ju',
    'venus': 'Ve', 'saturn': 'Sa', 'rahu': 'Ra', 'ketu': 'Ke',
}

# Terms coloured inline in prose, to mirror the reference report. Signs render in
# green; jyotish vocabulary in saffron. This only *adds* colour to the AI-written
# words — it never changes them.
_GREEN_TERMS = [en for en, _ in SIGNS] + [hi for _, hi in SIGNS] + ['Lagna', 'Rasi', 'Navamsa']
_SAFFRON_TERMS = [
    'Mahadasha', 'Antardasha', 'dasha', 'nakshatra', 'bhagya', 'santaan', 'muhurat',
    'griha pravesh', 'Shukla Paksha', 'Chaturmas', 'Kaal Sarp', 'Sade Sati', 'Manglik',
    'Mangal', 'karaka', 'abhimantrit', 'vakri', 'upaay', 'Revati',
]


# --------------------------------------------------------------------------- #
# Tolerant readers — inputs are always fully provided, so these never raise;
# they simply coerce whatever value is present into display text.
# --------------------------------------------------------------------------- #
def text(value: Any) -> str:
    if value is None:
        return ''
    if isinstance(value, bool):
        return 'Yes' if value else 'No'
    if isinstance(value, (int, float)):
        return str(value)
    return str(value).strip()


def truthy(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in {'true', 'yes', 'present', '1'}
    return bool(value)


def obj(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def arr(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def read_json(path: Path) -> dict[str, Any]:
    try:
        payload = json.loads(path.read_text(encoding='utf-8'))
    except Exception as exc:  # pragma: no cover - defensive
        print(f'ERROR: Unable to read JSON: {exc}', file=sys.stderr)
        raise SystemExit(1)
    return payload if isinstance(payload, dict) else {}


# --------------------------------------------------------------------------- #
# Small formatting helpers
# --------------------------------------------------------------------------- #
def sign_index(name: str) -> int:
    low = (name or '').lower()
    for i, (en, hi) in enumerate(SIGNS):
        if en.lower() in low or hi.lower() in low:
            return i
    return -1


def sign_display(name: str) -> str:
    """'Gemini' -> 'Gemini (Mithuna)'. If already qualified, leave as-is."""
    name = text(name)
    if not name or '(' in name:
        return name
    idx = sign_index(name)
    if idx >= 0:
        en, hi = SIGNS[idx]
        return f'{en} ({hi})'
    return name


def planet_abbr(name: str) -> str:
    return PLANET_ABBR.get((name or '').strip().lower(), (name or '')[:2].title())


def highlight(raw: str) -> str:
    """Escape prose and colour a small, curated set of jyotish terms."""
    out = escape(text(raw))
    try:
        for terms, color, weight in (
            (_SAFFRON_TERMS, BRAND['saffron'], '600'),
            (_GREEN_TERMS, BRAND['green'], '600'),
        ):
            for term in sorted(terms, key=len, reverse=True):
                pattern = re.compile(r'(?<![\w>])(' + re.escape(escape(term)) + r')(?![\w<])', re.IGNORECASE)
                out = pattern.sub(
                    lambda m: f'<span style="color:{color};font-weight:{weight}">{m.group(1)}</span>',
                    out,
                    count=1,
                )
    except Exception:
        return escape(text(raw))
    return out


def paragraphs(raw: str) -> str:
    blocks = [b.strip() for b in re.split(r'\n\s*\n', text(raw)) if b.strip()]
    return ''.join(f'<p>{highlight(b)}</p>' for b in blocks) or '<p></p>'


# --------------------------------------------------------------------------- #
# North-Indian square chart (fixed geometry)
# --------------------------------------------------------------------------- #
# Centroid of each of the 12 fixed houses in a 0..300 square (house positions are
# fixed in the North-Indian style; the sign number rotates with the Lagna).
_OFF = 8.0
_D = 300.0
_HOUSE_CENTROID = {
    1: (150, 75), 2: (75, 25), 3: (25, 75), 4: (75, 150),
    5: (25, 225), 6: (75, 275), 7: (150, 225), 8: (225, 275),
    9: (275, 225), 10: (225, 150), 11: (275, 75), 12: (225, 25),
}


def _pt(x: float, y: float) -> str:
    return f'{x + _OFF:.1f},{y + _OFF:.1f}'


def render_chart(lagna_sign: str, placements: dict[int, list[str]], center_label: str, subtitle: str) -> str:
    li = sign_index(lagna_sign)
    g = BRAND['gold']
    maroon = BRAND['maroon']
    saffron = BRAND['saffron']
    md = BRAND['maroon_deep']

    lines = [
        # outer square
        f'<rect x="{_OFF}" y="{_OFF}" width="{_D}" height="{_D}" fill="{BRAND["card"]}" '
        f'stroke="{maroon}" stroke-width="2.4" />',
        # diagonals
        f'<line x1="{_pt(0,0).split(",")[0]}" y1="{_pt(0,0).split(",")[1]}" x2="{_pt(300,300).split(",")[0]}" y2="{_pt(300,300).split(",")[1]}" stroke="{g}" stroke-width="1.3" />',
        f'<line x1="{_pt(300,0).split(",")[0]}" y1="{_pt(300,0).split(",")[1]}" x2="{_pt(0,300).split(",")[0]}" y2="{_pt(0,300).split(",")[1]}" stroke="{g}" stroke-width="1.3" />',
        # central diamond (side midpoints)
        f'<polygon points="{_pt(150,0)} {_pt(300,150)} {_pt(150,300)} {_pt(0,150)}" '
        f'fill="none" stroke="{g}" stroke-width="1.3" />',
    ]

    cells: list[str] = []
    for house in range(1, 13):
        cx, cy = _HOUSE_CENTROID[house]
        cx += _OFF
        cy += _OFF
        rashi = ((li + house - 1) % 12) + 1 if li >= 0 else house
        planets = placements.get(house, [])
        # sign number (small, saffron) sits just above the planet cluster
        n = len(planets)
        num_y = cy - 8 - (6 if n else 0)
        cells.append(
            f'<text x="{cx:.1f}" y="{num_y:.1f}" text-anchor="middle" '
            f'font-size="10.5" fill="{saffron}" font-weight="600">{rashi}</text>'
        )
        if planets:
            # wrap up to 3 abbreviations per line
            rows = [planets[i:i + 3] for i in range(0, len(planets), 3)]
            start = cy + 4
            for ri, row in enumerate(rows):
                cells.append(
                    f'<text x="{cx:.1f}" y="{start + ri * 13:.1f}" text-anchor="middle" '
                    f'font-size="11" fill="{md}" font-weight="700" '
                    f'font-family="Marcellus, Georgia, serif">{escape(" ".join(row))}</text>'
                )

    return (
        f'<svg viewBox="0 0 {_D + 2 * _OFF:.0f} {_D + 2 * _OFF:.0f}" class="kundli" '
        f'role="img" aria-label="{escape(center_label)}">'
        + ''.join(lines) + ''.join(cells) + '</svg>'
    )


def d1_placements(planets: list[dict[str, Any]]) -> dict[int, list[str]]:
    houses: dict[int, list[str]] = {i: [] for i in range(1, 13)}
    houses[1].append('La')
    for p in planets:
        m = re.search(r'\d+', text(p.get('house')))
        if m:
            h = int(m.group())
            if 1 <= h <= 12:
                houses[h].append(planet_abbr(text(p.get('name'))))
    return houses


def d9_placements(navamsa: list[dict[str, Any]], d9_lagna: str) -> dict[int, list[str]]:
    houses: dict[int, list[str]] = {i: [] for i in range(1, 13)}
    li = sign_index(d9_lagna)
    houses[1].append('La')
    for p in navamsa:
        si = sign_index(text(p.get('sign')))
        if li >= 0 and si >= 0:
            h = ((si - li) % 12) + 1
            houses[h].append(planet_abbr(text(p.get('name'))))
    return houses


# --------------------------------------------------------------------------- #
# Section builders
# --------------------------------------------------------------------------- #
def footer_html(pandit_name: str) -> str:
    return (
        '<div class="foot-end">'
        f'<div>Siddh Jyotish · Vedic Astrology &amp; Jyotish — {escape(CONTACT_EMAIL)} · '
        f'WhatsApp {escape(WHATSAPP_NUMBER)} · {escape(SITE)}</div>'
        f'<div>Prepared with care by {escape(pandit_name)}. Computed with a professional astronomical '
        'ephemeris (sidereal zodiac, Lahiri ayanamsa, whole-sign houses).</div>'
        '</div>'
    )


def render_report(data: dict[str, Any]) -> str:
    person = obj(data.get('person'))
    pandit = obj(data.get('pandit'))
    chart = obj(data.get('chart'))
    interp = obj(data.get('interpretation'))

    name = text(person.get('fullName'))
    gender = text(person.get('gender')).lower()
    pandit_name = text(pandit.get('name'))
    reference = text(pandit.get('referenceNumber'))

    if gender == 'male':
        addr_name, child = f'Shri {name}', 'Beta'
    elif gender == 'female':
        addr_name, child = f'Smt. {name}', 'Beti'
    else:
        addr_name, child = name, 'Dear one'

    lagna = text(chart.get('lagna'))
    planets = arr(chart.get('planets'))
    navamsa = arr(chart.get('navamsa'))
    d9_lagna = text(chart.get('navamsaLagna'))

    foot = ''
    footer = footer_html(pandit_name)

    # ---- Cover ---------------------------------------------------------- #
    born_line = f"Born {text(person.get('dateOfBirth'))} · {text(person.get('timeOfBirth'))} · {text(person.get('placeOfBirth'))}"
    cover = f'''
    <section class="cover">
      <div class="diya">🪔</div>
      <div class="cover-brand">Siddh Jyotish Presents</div>
      <h1 class="cover-title">Janma Kundli</h1>
      <div class="cover-rule"></div>
      <div class="cover-sub">Vedic Birth-Chart Report &amp; Life Reading</div>
      <div class="cover-name">{escape(addr_name)}</div>
      <div class="cover-born">{escape(born_line)}</div>
      <div class="cover-rule"></div>
      <div class="cover-prep">— Reading personally prepared by —</div>
      <div class="cover-pandit">{escape(pandit_name)}</div>
    </section>'''

    # ---- Page 2: Namaste letter + birth details ------------------------ #
    details_rows = [
        ('Name', f"{name} ({text(person.get('gender'))})", 'Date', text(person.get('dateOfBirth'))),
        ('Time', text(person.get('timeOfBirth')), 'Place',
         f"{text(person.get('placeOfBirth'))} ({text(person.get('latitude'))}, {text(person.get('longitude'))})"),
        ('Timezone used', f"{text(person.get('timezone'))} ({text(person.get('timezoneOffset'))})",
         'Universal Time', text(person.get('universalTime'))),
        ('Ayanamsa', text(chart.get('ayanamsa')), 'House system', 'Whole-sign (sidereal)'),
    ]
    details_html = ''.join(
        f'<tr><th>{escape(a)}</th><td>{escape(b)}</td><th>{escape(c)}</th><td>{escape(d)}</td></tr>'
        for a, b, c, d in details_rows
    )
    letter = f'''
    <section class="page">
      <h2 class="head">🪔 Namaste, {escape(addr_name)}</h2>
      <p>{escape(child)}, with folded hands I welcome you. I am <b>{escape(pandit_name)}</b>, and it has been
        my joy to sit quietly with your <span style="color:{BRAND['saffron']}">Janma Kundli</span> (birth chart)
        and read what the grahas (planets) wrote in the sky at the moment you took your first breath. Please read
        this as a letter from a well-wisher who has studied your stars closely — <i>hum aapke saath hain</i>,
        we are with you on this journey.</p>
      <p>Every placement below is computed precisely from a professional astronomical ephemeris for your exact
        birth moment converted to Universal Time — nothing here is guessed. The interpretation that follows is my
        own reading of those real placements.</p>
      <div class="accent-card gold">
        <h3>Your Birth Details</h3>
        <table class="kv">{details_html}</table>
        <p class="note">Note: the local birth time was converted to Universal Time using the
          {escape(text(person.get('timezone')))} offset ({escape(text(person.get('timezoneOffset')))}) confirmed for the
          birthplace on that date.</p>
      </div>
      {foot}
    </section>'''

    # ---- Page 3: Two charts + legend ----------------------------------- #
    d1_svg = render_chart(lagna, d1_placements(planets), 'D-1', 'Rasi')
    d9_svg = render_chart(d9_lagna, d9_placements(navamsa, d9_lagna), 'D-9', 'Navamsa')
    charts = f'''
    <section class="page">
      <h2 class="head">🪔 Your Two Sacred Charts</h2>
      <p>Below are your <span style="color:{BRAND['saffron']}">Lagna Chart (D-1 / Rasi)</span> — the main birth
        chart — and your <span style="color:{BRAND['saffron']}">Navamsa Chart (D-9)</span>, the chart of the soul,
        marriage and inner strength that every astrologer reads beside the D-1. Both are drawn in the traditional
        North-Indian style.</p>
      <div class="chart-row">
        <div class="chart-cell">{d1_svg}<div class="chart-cap">Lagna Chart (D-1 / Rasi)</div></div>
        <div class="chart-cell">{d9_svg}<div class="chart-cap">Navamsa Chart (D-9)</div></div>
      </div>
      <div class="accent-card gold legend">
        <p>In the North-Indian chart the house positions are fixed; the <b>number</b> printed in each house is the
          sign occupying it (1=Aries, 2=Taurus … 12=Pisces). <b>La</b> marks your Lagna (ascendant). Planet
          abbreviations: <b>Su</b>=Sun, <b>Mo</b>=Moon, <b>Ma</b>=Mars, <b>Me</b>=Mercury, <b>Ju</b>=Jupiter,
          <b>Ve</b>=Venus, <b>Sa</b>=Saturn, <b>Ra</b>=Rahu, <b>Ke</b>=Ketu. Your Lagna is
          <b>{escape(sign_display(lagna))}</b>.</p>
      </div>
      {foot}
    </section>'''

    # ---- Page 4: Graha table + Navamsa placements + signatures --------- #
    lagna_row = (
        '<tr class="lagna-row">'
        '<td>Lagna (Ascendant)</td>'
        f'<td>{escape(sign_display(lagna))}</td>'
        f'<td>{escape(text(chart.get("lagnaDegree")))}</td>'
        '<td>1</td>'
        f'<td>{escape(text(chart.get("lagnaNakshatra")))}</td>'
        f'<td>{escape(text(chart.get("lagnaPada")))}</td>'
        f'<td>{escape(text(chart.get("lagnaNakLord")))}</td>'
        '<td>—</td></tr>'
    )
    graha_rows = lagna_row + ''.join(
        '<tr>'
        f'<td>{escape(text(p.get("name")))}</td>'
        f'<td>{escape(sign_display(text(p.get("sign"))))}</td>'
        f'<td>{escape(text(p.get("degree")))}</td>'
        f'<td>{escape(text(p.get("house")))}</td>'
        f'<td>{escape(text(p.get("nakshatra")))}</td>'
        f'<td>{escape(text(p.get("pada")))}</td>'
        f'<td>{escape(text(p.get("nakLord")))}</td>'
        f'<td>{escape(text(p.get("motion")))}</td>'
        '</tr>'
        for p in planets
    )
    nav_rows = (
        f'<tr><td>D9 Lagna</td><td>{escape(sign_display(d9_lagna))}</td></tr>'
        + ''.join(
            f'<tr><td>{escape(text(p.get("name")))}</td><td>{escape(sign_display(text(p.get("sign"))))}</td></tr>'
            for p in navamsa
        )
    )
    sig_pills = ''.join(
        f'<span class="pill">{escape(text(s))}</span>' for s in arr(chart.get('signatures'))
    )
    grahas = f'''
    <section class="page">
      <h2 class="head">🪔 Grahas at Your Birth</h2>
      <p>These are the exact positions of the nine grahas and your <span style="color:{BRAND['saffron']}">Lagna</span>
        (ascendant — the sign rising on the eastern horizon at your birth). Each planet's
        <span style="color:{BRAND['saffron']}">nakshatra</span> (lunar mansion) and pada (quarter) are given, as an
        astrologer requires.</p>
      <table class="grid-table">
        <thead><tr><th>Body</th><th>Sign (Rasi)</th><th>Degree</th><th>House</th><th>Nakshatra</th><th>Pada</th><th>Nak. Lord</th><th>Motion</th></tr></thead>
        <tbody>{graha_rows}</tbody>
      </table>
      <div class="two-col">
        <div>
          <h3 class="sub">Navamsa (D-9) Placements</h3>
          <table class="kv2">{nav_rows}</table>
        </div>
        <div class="accent-card green sig-card">
          <h3>Chart Signatures</h3>
          <div class="pills">{sig_pills}</div>
        </div>
      </div>
      {foot}
    </section>'''

    # ---- Page 5: Vimshottari Dasha ------------------------------------- #
    maha_rows = ''.join(
        f'<tr class="{"active" if truthy(d.get("active")) else ""}">'
        f'<td>{escape(text(d.get("maha")))} Mahadasha</td>'
        f'<td>{escape(text(d.get("start")))}</td>'
        f'<td>{escape(text(d.get("end")))}</td>'
        f'<td>{escape(text(d.get("length")))}</td>'
        '</tr>'
        for d in arr(chart.get('dasha'))
    )
    antar_rows = ''.join(
        f'<tr class="{"active" if truthy(a.get("active")) else ""}">'
        f'<td>{escape(text(a.get("period")))}</td>'
        f'<td>{escape(text(a.get("from")))}</td>'
        f'<td>{escape(text(a.get("to")))}</td>'
        '</tr>'
        for a in arr(chart.get('antardasha'))
    )
    dasha = f'''
    <section class="page">
      <h2 class="head">🪔 Vimshottari Dasha — Your Planetary Timeline</h2>
      <p>The <span style="color:{BRAND['saffron']}">Vimshottari Dasha</span> is the great 120-year cycle of
        planetary periods (<span style="color:{BRAND['saffron']}">Mahadasha</span>) that governs the timing of life
        events. The green row is running now.</p>
      <div class="two-col">
        <div>
          <h3 class="sub">Mahadasha sequence</h3>
          <table class="grid-table"><thead><tr><th>Mahadasha</th><th>From</th><th>To</th><th>Length</th></tr></thead>
            <tbody>{maha_rows}</tbody></table>
        </div>
        <div>
          <h3 class="sub">Antardashas in {escape(text(chart.get('antardashaTitle')))}</h3>
          <table class="grid-table"><thead><tr><th>Period</th><th>From</th><th>To</th></tr></thead>
            <tbody>{antar_rows}</tbody></table>
        </div>
      </div>
      {foot}
    </section>'''

    # ---- Page 6: Who You Are + house highlights ------------------------ #
    core = ''.join(f'<p>{highlight(text(c))}</p>' for c in arr(interp.get('coreNature')))
    house_items = ''.join(
        f'<li><b>{highlight(text(h.get("title")))}:</b> {highlight(text(h.get("text")))}</li>'
        for h in arr(interp.get('houseHighlights'))
    )
    core_page = f'''
    <section class="page">
      <h2 class="head">🪔 Who You Are — Your Core Nature</h2>
      {core}
      <div class="accent-card cream">
        <h3>House-by-House Highlights</h3>
        <ul class="bullets">{house_items}</ul>
      </div>
      {foot}
    </section>'''

    # ---- Page 7+: Questions answered ----------------------------------- #
    q_blocks = ''
    accent_cycle = ['saffron', 'green', 'gold']
    for i, a in enumerate(arr(interp.get('answers'))):
        acc = accent_cycle[i % len(accent_cycle)]
        q_blocks += (
            f'<div class="q-head">{i + 1} · {escape(text(a.get("question")))}</div>'
            f'<div class="q-card {acc}">{paragraphs(text(a.get("answer")))}</div>'
        )
    questions = f'''
    <section class="page">
      <h2 class="head">🪔 Your Questions — Answered</h2>
      <p>{escape(child)}, I have looked carefully at the houses, their lords, the karakas (significators) and above
        all the <span style="color:{BRAND['saffron']}">dasha</span> (timing) before replying. Remember, jyotish shows
        the strong currents of time — your own effort and prayers steer the boat.</p>
      {q_blocks}
      {foot}
    </section>'''

    # ---- Page 9: Doshas, remedies, blessings --------------------------- #
    dosha_items = ''.join(
        f'<li><b>{highlight(text(dd.get("name")))}:</b> {highlight(text(dd.get("note")))}</li>'
        for dd in arr(chart.get('doshas'))
    )
    remedy_items = ''.join(
        f'<li><b>{highlight(text(r.get("title")))}</b> — {highlight(text(r.get("text")))}</li>'
        for r in arr(interp.get('remedies'))
    )
    remedies_page = f'''
    <section class="page">
      <h2 class="head">🪔 Doshas, Remedies &amp; Blessings</h2>
      <div class="accent-card maroon">
        <h3>What I checked for you (and the good news)</h3>
        <ul class="bullets">{dosha_items}</ul>
      </div>
      <div class="accent-card gold">
        <h3>Upaay — Practical Remedies, Each for a Reason</h3>
        <ul class="bullets">{remedy_items}</ul>
      </div>
      <div class="accent-card green">
        <h3>🪔 With care, from your Pandit</h3>
        <p>{escape(child)}, remedies and poojas give their full fruit only when they are genuine and properly
          <span style="color:{BRAND['saffron']}">abhimantrit</span> (energised with mantra). For an authentic
          energised gemstone or to arrange a pooja, please <b>WhatsApp me personally at {escape(WHATSAPP_NUMBER)}</b>
          and I will guide you at every step.</p>
      </div>
      {foot}
    </section>'''

    # ---- Page 10: Reference + blessing --------------------------------- #
    closing = f'''
    <section class="page">
      <div class="accent-card maroon ref-card">
        <div class="ref-label">Your reference number:</div>
        <div class="ref-token">{escape(reference)}</div>
      </div>
      <p>{highlight(text(interp.get('closingBlessing')))}</p>
      <p>For any further questions, visit <b>{escape(RETURNING_URL)}</b>, keep your reference number safe, paste it in
        the form and ask — I will personally look into your chart again. <i>Hum aapke saath hain.</i></p>
      <div class="blessing">With blessings,</div>
      <div class="sign-name">{escape(pandit_name)}</div>
      <div class="sign-org">Siddh Jyotish</div>
      {foot}
    </section>'''

    body = cover + letter + charts + grahas + dasha + core_page + questions + remedies_page + closing + footer
    return _document(name, body)


# --------------------------------------------------------------------------- #
# Document shell + CSS (static; never customer-specific)
# --------------------------------------------------------------------------- #
def _document(name: str, body: str) -> str:
    css = _CSS
    for key, val in BRAND.items():
        css = css.replace(f'@{key}@', val)
    return (
        '<!doctype html><html lang="en"><head><meta charset="utf-8" />'
        '<meta name="viewport" content="width=device-width, initial-scale=1" />'
        f'<title>{escape(name)} — Janma Kundli Report</title>'
        f'<style>{css}</style></head><body>{body}</body></html>'
    )


_CSS = r'''
  @page { size: Letter; margin: 15mm 14mm 15mm; }
  @page cover { margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    background: @page@;
    color: @text@;
    font-family: Mukta, system-ui, -apple-system, "Segoe UI", sans-serif;
    font-size: 11.6px;
    line-height: 1.62;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  h1, h2, h3 { font-family: Marcellus, "Cormorant Garamond", Georgia, serif; font-weight: 400; margin: 0; color: @maroon@; }
  p { margin: 0 0 10px; }
  b { font-weight: 700; }
  .page { break-before: page; page-break-before: always; }
  .head {
    font-size: 23px; color: @maroon@; padding-bottom: 8px; margin-bottom: 12px;
    border-bottom: 2px solid @gold@;
  }
  .sub { font-size: 15px; color: @maroon@; margin: 4px 0 6px; }

  /* Cover */
  .cover {
    page: cover; break-after: page; page-break-after: always;
    height: 100vh; width: 100%;
    background: radial-gradient(120% 90% at 50% 30%, #8a2222 0%, @maroon@ 45%, @maroon_deep@ 100%);
    color: #f7e9cf; text-align: center;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    padding: 40px;
  }
  .cover .diya { font-size: 40px; margin-bottom: 12px; }
  .cover-brand { text-transform: uppercase; letter-spacing: 4px; font-size: 13px; color: #f0d9a6; margin-bottom: 14px; }
  .cover-title { font-size: 52px; color: #fdeecb; letter-spacing: 1px; }
  .cover-rule {
    width: 190px; height: 0; margin: 22px 0;
    border-top: 2px solid transparent;
    border-image: linear-gradient(90deg, transparent, @gold_soft@, @gold@, @gold_soft@, transparent) 1;
  }
  .cover-sub { text-transform: uppercase; letter-spacing: 3px; font-size: 12px; color: #e7c98f; }
  .cover-name { font-size: 34px; color: #fdeecb; font-family: Marcellus, Georgia, serif; margin-top: 22px; }
  .cover-born { font-size: 12px; color: #e9cfa0; margin-top: 8px; }
  .cover-prep { color: @saffron@; font-size: 13px; margin-top: 8px; }
  .cover-pandit { font-family: Marcellus, Georgia, serif; font-size: 22px; color: #fdeecb; margin-top: 4px; }

  /* Accent cards */
  .accent-card {
    background: @card@; border: 1px solid @border@; border-radius: 14px;
    padding: 15px 18px; margin: 14px 0;
    break-inside: avoid; page-break-inside: avoid;
  }
  .accent-card h3 { font-size: 16px; color: @maroon@; margin-bottom: 8px; }
  .accent-card.gold { border-left: 5px solid @gold@; }
  .accent-card.green { border-left: 5px solid @green@; background: #f5fbf6; }
  .accent-card.maroon { border-left: 5px solid @maroon@; }
  .accent-card.cream { background: #fbeecb; border: 1px solid @border@; }
  .accent-card.cream h3 { font-size: 15px; }
  .note { color: @muted@; font-size: 10.4px; margin: 8px 0 0; }
  .legend p { margin: 0; font-size: 10.6px; }

  /* Birth-details key/value table */
  table.kv { width: 100%; border-collapse: collapse; }
  table.kv th, table.kv td { padding: 8px 10px; text-align: left; vertical-align: top; border-bottom: 1px solid #f0e6cd; font-size: 11px; }
  table.kv th { color: @maroon_deep@; font-weight: 700; width: 15%; white-space: nowrap; }
  table.kv td { width: 35%; }
  table.kv tr:last-child th, table.kv tr:last-child td { border-bottom: none; }

  /* Charts */
  .chart-row { display: flex; gap: 20px; margin: 6px 0 4px; }
  .chart-cell { flex: 1 1 0; text-align: center; }
  svg.kundli { width: 100%; max-width: 320px; height: auto; display: block; margin: 0 auto; }
  .chart-cap { font-family: Marcellus, Georgia, serif; font-size: 15px; color: @maroon@; margin-top: 8px; }

  /* Data tables */
  table.grid-table { width: 100%; border-collapse: collapse; margin: 6px 0; font-size: 10.8px; break-inside: avoid; }
  table.grid-table th { background: @maroon@; color: #fdeecb; text-align: left; padding: 7px 8px; font-weight: 700; font-size: 10px; letter-spacing: 0.3px; font-family: Mukta, sans-serif; }
  table.grid-table td { padding: 6px 8px; border-bottom: 1px solid #f0e6cd; }
  table.grid-table tbody tr:nth-child(even) { background: #fbf5e6; }
  table.grid-table tr.lagna-row td { background: #fde7c9; font-weight: 700; }
  table.grid-table tr.active td { background: #e8f5ec; color: @green@; font-weight: 700; }

  table.kv2 { width: 100%; border-collapse: collapse; font-size: 11px; }
  table.kv2 td { padding: 6px 8px; border-bottom: 1px solid #f0e6cd; }
  table.kv2 td:first-child { font-weight: 700; color: @maroon_deep@; width: 45%; }
  table.kv2 tr:nth-child(even) { background: #fbf5e6; }

  .two-col { display: flex; gap: 18px; align-items: flex-start; margin-top: 8px; }
  .two-col > div { flex: 1 1 0; min-width: 0; }
  .sig-card { margin-top: 26px; }
  .pills { display: flex; flex-wrap: wrap; gap: 7px; }
  .pill { background: #eaf6ee; color: @green@; border: 1px solid #cfe9d8; border-radius: 999px; padding: 5px 11px; font-size: 10.4px; font-weight: 600; }

  /* Bullets */
  ul.bullets { margin: 4px 0 0; padding-left: 18px; }
  ul.bullets li { margin-bottom: 7px; }

  /* Questions */
  .q-head {
    background: #fbeecb; border-radius: 10px; padding: 10px 14px; margin: 14px 0 0;
    font-family: Marcellus, Georgia, serif; font-size: 16px; color: @maroon_deep@;
    break-inside: avoid; page-break-inside: avoid;
  }
  .q-card {
    background: @card@; border: 1px solid @border@; border-radius: 12px; padding: 14px 16px; margin: 8px 0 4px;
    break-inside: avoid; page-break-inside: avoid;
  }
  .q-card.saffron { border-left: 5px solid @saffron@; }
  .q-card.green { border-left: 5px solid @green@; }
  .q-card.gold { border-left: 5px solid @gold@; }
  .q-card p:last-child { margin-bottom: 0; }

  /* Closing */
  .ref-card { text-align: left; }
  .ref-label { font-family: Marcellus, Georgia, serif; color: @maroon_deep@; font-size: 13px; margin-bottom: 6px; }
  .ref-token { font-family: "Courier New", monospace; font-weight: 700; color: @maroon_deep@; word-break: break-all; font-size: 12px; }
  .blessing { font-family: Marcellus, Georgia, serif; font-size: 16px; color: @maroon@; margin-top: 14px; }
  .sign-name { font-family: Marcellus, Georgia, serif; font-size: 20px; color: @maroon@; font-weight: 700; }
  .sign-org { color: @muted@; font-size: 11px; }

  /* Footer */
  .foot-end {
    break-inside: avoid; page-break-inside: avoid;
    margin-top: 26px; padding-top: 10px; text-align: center;
    color: @muted@; font-size: 9.4px; line-height: 1.5;
    border-top: 1px solid #eadfc4;
  }
'''


# --------------------------------------------------------------------------- #
# Chrome rendering + validation
# --------------------------------------------------------------------------- #
def find_chrome_binary() -> str:
    env_bin = os.environ.get('CHROME_BIN')
    if env_bin and Path(env_bin).exists():
        return env_bin

    def newest_executable(root: Path) -> Path | None:
        real, wrapper = [], []
        for path in root.rglob('*'):
            if not path.is_file() or not os.access(path, os.X_OK):
                continue
            n = path.name.lower()
            if n in {'chrome', 'chromium', 'chrome-headless-shell'}:
                real.append(path)
            elif 'chrome' in n or 'chromium' in n:
                wrapper.append(path)
        candidates = real or wrapper
        return max(candidates, key=lambda p: p.stat().st_mtime) if candidates else None

    for root in (Path('/opt/.devin/chrome'), Path('/opt/.devin/playwright_browsers')):
        if root.exists():
            candidate = newest_executable(root)
            if candidate:
                return str(candidate)
    print('ERROR: Unable to find Chrome binary. Set CHROME_BIN.', file=sys.stderr)
    raise SystemExit(1)


def run_chrome(chrome_bin: str, html_path: Path, pdf_path: Path) -> None:
    chrome_dir = Path('/tmp/chrome-pdf')
    chrome_dir.mkdir(parents=True, exist_ok=True)
    cmd = [
        chrome_bin, '--headless=new', '--disable-gpu', '--no-sandbox',
        '--disable-dev-shm-usage', f'--user-data-dir={chrome_dir}',
        '--no-pdf-header-footer', f'--print-to-pdf={pdf_path}', str(html_path),
    ]
    print('Rendering PDF with:', ' '.join(cmd))
    subprocess.run(cmd, check=True)


def validate_pdf(pdf_path: Path, data: dict[str, Any]) -> int:
    try:
        from pypdf import PdfReader
    except Exception as exc:  # pragma: no cover
        print(f'ERROR: pypdf is required for validation: {exc}', file=sys.stderr)
        raise SystemExit(1)

    if not pdf_path.exists() or pdf_path.stat().st_size <= 0:
        print('ERROR: PDF was not created or is empty.', file=sys.stderr)
        raise SystemExit(1)

    reader = PdfReader(str(pdf_path))
    pages = [(p.extract_text() or '').strip() for p in reader.pages]
    page_count = len(pages)
    if page_count < MIN_PAGE_COUNT:
        print(f'ERROR: PDF page count {page_count} is below the structural minimum {MIN_PAGE_COUNT}.', file=sys.stderr)
        raise SystemExit(1)

    blank = [i + 1 for i, t in enumerate(pages) if not t]
    if blank:
        print(f'ERROR: Blank pages detected: {", ".join(map(str, blank))}.', file=sys.stderr)
        raise SystemExit(1)

    all_text = '\n'.join(pages).lower()
    lagna = text(obj(data.get('chart')).get('lagna')).lower()
    markers = [lagna, 'janma kundli', 'lagna chart', 'navamsa', 'grahas', 'vimshottari', 'remedies', 'answered']
    missing = [m for m in markers if m and m not in all_text]
    if missing:
        print('ERROR: Missing validation markers: ' + ', '.join(missing), file=sys.stderr)
        raise SystemExit(1)

    print(f'VALIDATION PASS: {page_count} pages, no blank pages, required markers found.')
    return page_count


def main() -> None:
    if len(sys.argv) != 2:
        print('Usage: python scripts/kundli/generate_report.py data.json', file=sys.stderr)
        raise SystemExit(1)

    input_path = Path(sys.argv[1]).expanduser().resolve()
    if not input_path.exists():
        print(f'ERROR: Input file not found: {input_path}', file=sys.stderr)
        raise SystemExit(1)

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
