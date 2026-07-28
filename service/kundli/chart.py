#!/usr/bin/env python3
"""Deterministic sidereal Vedic chart calculations for Kundli reports."""
from __future__ import annotations

import calendar
import json
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import swisseph as swe

SIGNS = [
    'Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo',
    'Libra', 'Scorpio', 'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces',
]
SIGN_LORDS = [
    'Mars', 'Venus', 'Mercury', 'Moon', 'Sun', 'Mercury',
    'Venus', 'Mars', 'Jupiter', 'Saturn', 'Saturn', 'Jupiter',
]
NAKSHATRAS = [
    ('Ashwini', 'Ketu'), ('Bharani', 'Venus'), ('Krittika', 'Sun'),
    ('Rohini', 'Moon'), ('Mrigashira', 'Mars'), ('Ardra', 'Rahu'),
    ('Punarvasu', 'Jupiter'), ('Pushya', 'Saturn'), ('Ashlesha', 'Mercury'),
    ('Magha', 'Ketu'), ('Purva Phalguni', 'Venus'), ('Uttara Phalguni', 'Sun'),
    ('Hasta', 'Moon'), ('Chitra', 'Mars'), ('Swati', 'Rahu'),
    ('Vishakha', 'Jupiter'), ('Anuradha', 'Saturn'), ('Jyeshtha', 'Mercury'),
    ('Mula', 'Ketu'), ('Purva Ashadha', 'Venus'), ('Uttara Ashadha', 'Sun'),
    ('Shravana', 'Moon'), ('Dhanishta', 'Mars'), ('Shatabhisha', 'Rahu'),
    ('Purva Bhadrapada', 'Jupiter'), ('Uttara Bhadrapada', 'Saturn'), ('Revati', 'Mercury'),
]
NAKSHATRA_SPAN = 360.0 / 27.0
PADA_SPAN = NAKSHATRA_SPAN / 4.0

PLANETS = [
    ('Sun', swe.SUN), ('Moon', swe.MOON), ('Mars', swe.MARS),
    ('Mercury', swe.MERCURY), ('Jupiter', swe.JUPITER), ('Venus', swe.VENUS),
    ('Saturn', swe.SATURN), ('Rahu', swe.MEAN_NODE),
]
DASHA_YEARS = {
    'Ketu': 7, 'Venus': 20, 'Sun': 6, 'Moon': 10, 'Mars': 7,
    'Rahu': 18, 'Jupiter': 16, 'Saturn': 19, 'Mercury': 17,
}
DASHA_ORDER = ['Ketu', 'Venus', 'Sun', 'Moon', 'Mars', 'Rahu', 'Jupiter', 'Saturn', 'Mercury']
SANSKRIT_LORDS = {
    'Ketu': 'Ketu', 'Venus': 'Shukra', 'Sun': 'Surya', 'Moon': 'Chandra',
    'Mars': 'Mangala', 'Rahu': 'Rahu', 'Jupiter': 'Guru', 'Saturn': 'Shani',
    'Mercury': 'Budha',
}


def _configure_swiss() -> None:
    try:
        swe.set_ephe_path(None)
    except (TypeError, ValueError):
        swe.set_ephe_path('')
    swe.set_sid_mode(swe.SIDM_LAHIRI)


def _parse_date(value: Any) -> date:
    if not isinstance(value, str) or not value.strip():
        raise ValueError('dateOfBirth must be a non-empty string')
    text = value.strip()
    for fmt in ('%Y-%m-%d', '%d %B %Y', '%d %b %Y'):
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            continue
    raise ValueError(f'Unsupported dateOfBirth format: {value}')


def _parse_time(value: Any) -> tuple[int, int, int]:
    if not isinstance(value, str) or not value.strip():
        raise ValueError('timeOfBirth must be a non-empty string')
    text = value.strip().upper()
    for fmt in ('%I:%M %p', '%I:%M:%S %p', '%H:%M', '%H:%M:%S'):
        try:
            parsed = datetime.strptime(text, fmt)
            return parsed.hour, parsed.minute, parsed.second
        except ValueError:
            continue
    raise ValueError(f'Unsupported timeOfBirth format: {value}')


def _coordinate(value: Any, name: str) -> float:
    if isinstance(value, (int, float)):
        return float(value)
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f'{name} must be a number')
    text = value.strip().upper().replace('°', '').replace(' ', '')
    direction = 1.0
    if text[-1:] in ('N', 'E', 'S', 'W'):
        if text[-1] in ('S', 'W'):
            direction = -1.0
        text = text[:-1]
    return direction * float(text)


def _birth_context(birth: dict[str, Any]) -> tuple[datetime, float, float, float, date]:
    local_date = _parse_date(birth.get('dateOfBirth'))
    hour, minute, second = _parse_time(birth.get('timeOfBirth'))
    timezone_name = birth.get('timezone')
    if not isinstance(timezone_name, str) or not timezone_name.strip():
        raise ValueError('timezone must be an IANA timezone name')
    local = datetime(local_date.year, local_date.month, local_date.day, hour, minute, second, tzinfo=ZoneInfo(timezone_name))
    utc = local.astimezone(timezone.utc)
    ut_hour = utc.hour + utc.minute / 60.0 + utc.second / 3600.0 + utc.microsecond / 3_600_000_000.0
    jd = swe.julday(utc.year, utc.month, utc.day, ut_hour, swe.GREG_CAL)
    latitude = _coordinate(birth.get('latitude'), 'latitude')
    longitude = _coordinate(birth.get('longitude'), 'longitude')
    return utc, jd, latitude, longitude, local_date


def _normalize(degrees: float) -> float:
    return degrees % 360.0


def _format_degree(degrees: float) -> str:
    total_seconds = int(round((_normalize(degrees) % 30.0) * 3600.0))
    if total_seconds >= 30 * 3600:
        total_seconds = 30 * 3600 - 1
    deg, remainder = divmod(total_seconds, 3600)
    minutes, seconds = divmod(remainder, 60)
    return f'{deg}°{minutes:02d}\'{seconds:02d}"'


def _sign_index(longitude: float) -> int:
    return int(_normalize(longitude) // 30.0) % 12


def _nakshatra(longitude: float) -> tuple[str, int, str]:
    position = _normalize(longitude)
    index = min(26, int(position // NAKSHATRA_SPAN))
    within = position - index * NAKSHATRA_SPAN
    pada = min(4, int(within // PADA_SPAN) + 1)
    name, lord = NAKSHATRAS[index]
    return name, pada, lord


def _navamsa_sign(longitude: float) -> str:
    sign = _sign_index(longitude)
    pada_index = int((_normalize(longitude) % 30.0) // PADA_SPAN)
    if sign in (0, 3, 6, 9):  # movable signs
        start = sign
    elif sign in (1, 4, 7, 10):  # fixed signs
        start = (sign + 8) % 12
    else:  # dual signs
        start = (sign + 4) % 12
    return SIGNS[(start + pada_index) % 12]


def _sidereal_position(jd: float, body: int) -> tuple[float, float]:
    flags = swe.FLG_MOSEPH | swe.FLG_SIDEREAL | swe.FLG_SPEED
    values, _ = swe.calc_ut(jd, body, flags)
    return _normalize(values[0]), values[3]


def _ascendant(jd: float, latitude: float, longitude: float) -> float:
    cusps, ascmc = swe.houses_ex(jd, latitude, longitude, b'W', swe.FLG_SIDEREAL)
    del cusps
    return _normalize(ascmc[0])


def _planet_record(name: str, longitude: float, speed: float, lagna_sign: int) -> dict[str, str]:
    sign_index = _sign_index(longitude)
    nakshatra, pada, nak_lord = _nakshatra(longitude)
    return {
        'name': name,
        'sign': SIGNS[sign_index],
        'degree': _format_degree(longitude),
        'nakshatra': nakshatra,
        'pada': str(pada),
        'house': str((sign_index - lagna_sign) % 12 + 1),
        'nakLord': nak_lord,
        'motion': 'Retrograde' if speed < 0 else 'Direct',
    }


def _date_string(value: date) -> str:
    return value.isoformat()


def _add_years(value: date, years: float) -> date:
    return value + timedelta(days=years * 365.2425)


def _dasha_data(birth_date: date, moon_longitude: float) -> tuple[list[dict[str, Any]], dict[str, Any] | None]:
    nak_index = min(26, int(_normalize(moon_longitude) // NAKSHATRA_SPAN))
    starting_lord = NAKSHATRAS[nak_index][1]
    start_index = DASHA_ORDER.index(starting_lord)
    within = _normalize(moon_longitude) - nak_index * NAKSHATRA_SPAN
    remaining_fraction = 1.0 - within / NAKSHATRA_SPAN
    periods: list[dict[str, Any]] = []
    cursor = birth_date
    for offset in range(9):
        lord = DASHA_ORDER[(start_index + offset) % 9]
        years = DASHA_YEARS[lord] * (remaining_fraction if offset == 0 else 1.0)
        end = _add_years(cursor, years)
        periods.append({
            'maha': lord,
            'start': _date_string(cursor),
            'end': _date_string(end),
            'length': f'{DASHA_YEARS[lord]} yrs' if offset else f'{years:.2f} yrs',
            'active': False,
        })
        cursor = end
    today = date.today()
    active_period: dict[str, Any] | None = None
    for period in periods:
        start = date.fromisoformat(period['start'])
        end = date.fromisoformat(period['end'])
        if start <= today < end:
            period['active'] = True
            active_period = period
            break
    return periods, active_period


def _antardasha(active: dict[str, Any] | None) -> list[dict[str, Any]]:
    if not active:
        return []
    maha = active['maha']
    start = date.fromisoformat(active['start'])
    end = date.fromisoformat(active['end'])
    maha_years = DASHA_YEARS[maha]
    start_index = DASHA_ORDER.index(maha)
    result: list[dict[str, Any]] = []
    cursor = start
    for offset in range(9):
        lord = DASHA_ORDER[(start_index + offset) % 9]
        duration = maha_years * DASHA_YEARS[lord] / 120.0
        next_date = min(end, _add_years(cursor, duration))
        result.append({
            'period': f'{maha} – {lord}',
            'from': _date_string(cursor),
            'to': _date_string(next_date),
            'active': False,
        })
        cursor = next_date
    today = date.today()
    for period in result:
        if date.fromisoformat(period['from']) <= today < date.fromisoformat(period['to']):
            period['active'] = True
    return result


def _planet_longitudes(jd: float) -> dict[str, tuple[float, float]]:
    positions = {name: _sidereal_position(jd, body) for name, body in PLANETS}
    rahu, _ = positions['Rahu']
    positions['Ketu'] = ((_normalize(rahu + 180.0)), positions['Rahu'][1])
    return positions


def _transit_position(jd: float, body: int) -> dict[str, str]:
    longitude, _ = _sidereal_position(jd, body)
    return {'sign': SIGNS[_sign_index(longitude)], 'degree': _format_degree(longitude)}


def _month_start(value: date, offset: int) -> date:
    month = value.month - 1 + offset
    year = value.year + month // 12
    month = month % 12 + 1
    return date(year, month, min(value.day, calendar.monthrange(year, month)[1]))


def _ordinal(value: int) -> str:
    if value % 100 in (11, 12, 13):
        suffix = 'th'
    else:
        suffix = {1: 'st', 2: 'nd', 3: 'rd'}.get(value % 10, 'th')
    return f'{value}{suffix}'


def _doshas(positions: dict[str, tuple[float, float]], lagna_sign: int, moon_sign: int) -> list[dict[str, Any]]:
    mars_sign = _sign_index(positions['Mars'][0])
    mars_lagna_house = (mars_sign - lagna_sign) % 12 + 1
    mars_moon_house = (mars_sign - moon_sign) % 12 + 1
    mangal_houses = {1, 2, 4, 7, 8, 12}
    mangal_present = mars_lagna_house in mangal_houses or mars_moon_house in mangal_houses

    rahu = positions['Rahu'][0]
    ketu = positions['Ketu'][0]
    classical = [positions[name][0] for name in ('Sun', 'Moon', 'Mars', 'Mercury', 'Jupiter', 'Venus', 'Saturn')]
    distances = [_normalize(value - rahu) for value in classical]
    in_first_arc = all(distance <= 180.0 for distance in distances)
    in_second_arc = all(distance >= 180.0 for distance in distances)
    kaal_present = in_first_arc or in_second_arc

    today = datetime.now(timezone.utc)
    jd_today = swe.julday(today.year, today.month, today.day, today.hour + today.minute / 60.0, swe.GREG_CAL)
    saturn_today, _ = _sidereal_position(jd_today, swe.SATURN)
    saturn_sign = _sign_index(saturn_today)
    sade_distance = (saturn_sign - moon_sign) % 12
    sade_present = sade_distance in (11, 0, 1)

    return [
        {
            'name': 'Mangal (Kuja) Dosha',
            'present': mangal_present,
            'note': f'Mars is in the {_ordinal(mars_lagna_house)} house from Lagna and the {_ordinal(mars_moon_house)} house from the natal Moon.',
        },
        {
            'name': 'Kaal Sarp Yoga',
            'present': kaal_present,
            'note': 'All seven classical planets lie on one side of the Rahu–Ketu axis.' if kaal_present else 'The seven classical planets are not all on one side of the Rahu–Ketu axis.',
        },
        {
            'name': 'Sade Sati',
            'present': sade_present,
            'note': f'Transiting Saturn is in the {_ordinal(sade_distance + 1)} sign from the natal Moon as of today.',
        },
    ]


def _signatures(planets: list[dict[str, str]], lagna: str, doshas: list[dict[str, Any]]) -> list[str]:
    by_name = {planet['name']: planet for planet in planets}
    signatures = [f'{lagna} Lagna']
    signatures.append(f'Moon in {by_name["Moon"]["sign"]}, house {by_name["Moon"]["house"]}')
    signatures.append(f'Jupiter in {by_name["Jupiter"]["sign"]}, house {by_name["Jupiter"]["house"]}')
    for dosha in doshas:
        signatures.append(f'{dosha["name"]}: {"present" if dosha["present"] else "not present"}')
    return signatures


def compute(birth_dict: dict[str, Any]) -> dict[str, Any]:
    """Compute the chart object consumed by the Kundli report generator."""
    _configure_swiss()
    _utc, jd, latitude, longitude, birth_date = _birth_context(birth_dict)
    lagna_longitude = _ascendant(jd, latitude, longitude)
    lagna_sign_index = _sign_index(lagna_longitude)
    lagna = SIGNS[lagna_sign_index]
    lagna_nakshatra, lagna_pada, lagna_lord = _nakshatra(lagna_longitude)
    positions = _planet_longitudes(jd)

    planets = [
        _planet_record(name, positions[name][0], positions[name][1], lagna_sign_index)
        for name in ('Sun', 'Moon', 'Mars', 'Mercury', 'Jupiter', 'Venus', 'Saturn', 'Rahu', 'Ketu')
    ]
    navamsa = [
        {'name': planet['name'], 'sign': _navamsa_sign(positions[planet['name']][0])}
        for planet in planets
    ]
    dasha, active_maha = _dasha_data(birth_date, positions['Moon'][0])
    antardasha = _antardasha(active_maha)
    active_lord = active_maha['maha'] if active_maha else dasha[0]['maha']
    doshas = _doshas(positions, lagna_sign_index, _sign_index(positions['Moon'][0]))

    return {
        'ayanamsa': f'Lahiri {_format_degree(swe.get_ayanamsa_ut(jd))}',
        'lagna': lagna,
        'lagnaDegree': _format_degree(lagna_longitude),
        'lagnaNakshatra': lagna_nakshatra,
        'lagnaPada': str(lagna_pada),
        'lagnaNakLord': lagna_lord,
        'navamsaLagna': _navamsa_sign(lagna_longitude),
        'antardashaTitle': f'current {SANSKRIT_LORDS[active_lord]} ({active_lord}) Mahadasha',
        'planets': planets,
        'navamsa': navamsa,
        'dasha': dasha,
        'antardasha': antardasha,
        'doshas': doshas,
        'signatures': _signatures(planets, lagna, doshas),
    }


def _moon_nakshatra_index(chart: dict[str, Any]) -> int:
    moon = next(planet for planet in chart['planets'] if planet['name'] == 'Moon')
    return next(index for index, (name, _lord) in enumerate(NAKSHATRAS) if name == moon['nakshatra'])


def _moon_sign_index(chart: dict[str, Any]) -> int:
    moon = next(planet for planet in chart['planets'] if planet['name'] == 'Moon')
    return SIGNS.index(moon['sign'])


def _varna(sign_index: int) -> int:
    if sign_index % 3 == 0:
        return 1
    if sign_index % 3 == 1:
        return 2
    return 3


def _koota_score(person: dict[str, Any], partner: dict[str, Any]) -> dict[str, dict[str, int] | int]:
    p_moon_sign = _moon_sign_index(person)
    q_moon_sign = _moon_sign_index(partner)
    p_nak = _moon_nakshatra_index(person)
    q_nak = _moon_nakshatra_index(partner)
    p_gana = p_nak % 3
    q_gana = q_nak % 3
    p_nadi = p_nak % 3
    q_nadi = q_nak % 3
    tara_p = ((q_nak - p_nak) % 9) in (0, 1, 3, 5, 7)
    tara_q = ((p_nak - q_nak) % 9) in (0, 1, 3, 5, 7)
    bhakoot_distance = (q_moon_sign - p_moon_sign) % 12 + 1
    bhakoot_bad = bhakoot_distance in (2, 5, 6, 8, 9, 12)
    kootas: dict[str, dict[str, int] | int] = {
        'varna': {'score': 1 if _varna(p_moon_sign) == _varna(q_moon_sign) else 0, 'max': 1},
        'vashya': {'score': 2 if p_moon_sign % 4 == q_moon_sign % 4 else 1, 'max': 2},
        'tara': {'score': 3 if tara_p and tara_q else 1 if tara_p or tara_q else 0, 'max': 3},
        'yoni': {'score': 4 if p_nak % 14 == q_nak % 14 else 2 if p_nak % 7 == q_nak % 7 else 0, 'max': 4},
        'grahaMaitri': {'score': 5 if SIGN_LORDS[p_moon_sign] == SIGN_LORDS[q_moon_sign] else 3, 'max': 5},
        'gana': {'score': 6 if p_gana == q_gana else 3, 'max': 6},
        'bhakoot': {'score': 0 if bhakoot_bad else 7, 'max': 7},
        'nadi': {'score': 0 if p_nadi == q_nadi else 8, 'max': 8},
    }
    total = sum(value['score'] for value in kootas.values() if isinstance(value, dict))
    kootas['total'] = total
    kootas['outOf'] = 36
    return kootas


def compute_pair(person_birth: dict[str, Any], partner_birth: dict[str, Any]) -> dict[str, Any]:
    person_chart = compute(person_birth)
    partner_chart = compute(partner_birth)
    return {
        'person': person_chart,
        'partner': partner_chart,
        'matchScore': _koota_score(person_chart, partner_chart),
    }


def transits(birth_dict: dict[str, Any], from_date: str | date, months: int = 12) -> dict[str, Any]:
    del birth_dict  # reserved for future natal-relative transit annotations
    if months < 0 or months > 120:
        raise ValueError('months must be between 0 and 120')
    start = _parse_date(from_date) if isinstance(from_date, str) else from_date
    _configure_swiss()
    rows = []
    for offset in range(months + 1):
        current = _month_start(start, offset)
        jd = swe.julday(current.year, current.month, current.day, 12.0, swe.GREG_CAL)
        rows.append({
            'date': current.isoformat(),
            'Saturn': _transit_position(jd, swe.SATURN),
            'Jupiter': _transit_position(jd, swe.JUPITER),
            'Rahu': _transit_position(jd, swe.MEAN_NODE),
            'Ketu': {
                'sign': SIGNS[(_sign_index(_sidereal_position(jd, swe.MEAN_NODE)[0]) + 6) % 12],
                'degree': _format_degree(_sidereal_position(jd, swe.MEAN_NODE)[0] + 180.0),
            },
        })
    return {'from': start.isoformat(), 'months': rows}


def _cli() -> None:
    if len(sys.argv) != 2:
        raise SystemExit('Usage: python -m service.kundli.chart \'{birth json}\'')
    raw = sys.argv[1]
    try:
        payload = json.loads(raw)
        if not isinstance(payload, dict):
            raise ValueError('birth JSON must be an object')
        birth = payload.get('person') if isinstance(payload.get('person'), dict) else payload
        result = compute(birth)
    except Exception as exc:
        raise SystemExit(f'ERROR: {exc}') from exc
    print(json.dumps(result, indent=2, ensure_ascii=False))


if __name__ == '__main__':
    _cli()
