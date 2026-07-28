from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

from service.kundli.chart import compute, compute_pair, transits


SAMPLE_BIRTH = {
    'fullName': 'Nav',
    'gender': 'Male',
    'dateOfBirth': '1 July 1995',
    'timeOfBirth': '10:40 AM',
    'placeOfBirth': 'Mississauga',
    'latitude': 43.59,
    'longitude': -79.64,
    'timezone': 'Asia/Kolkata',
}

LONDON_BIRTH = {
    'fullName': 'Fixture London',
    'gender': 'Female',
    'dateOfBirth': '14 November 1987',
    'timeOfBirth': '9:15 PM',
    'placeOfBirth': 'London',
    'latitude': 51.5,
    'longitude': -0.12,
    'timezone': 'Europe/London',
}

SOUTHERN_BIRTH = {
    'fullName': 'Fixture Southern',
    'gender': 'Other',
    'dateOfBirth': '31 December 2000',
    'timeOfBirth': '11:45 PM',
    'placeOfBirth': 'Dunedin',
    'latitude': -45.87,
    'longitude': 170.5,
    'timezone': 'Pacific/Auckland',
}


def test_sample_matches_generator_schema_and_known_positions() -> None:
    chart = compute(SAMPLE_BIRTH)
    expected_keys = {
        'ayanamsa', 'lagna', 'lagnaDegree', 'lagnaNakshatra', 'lagnaPada',
        'lagnaNakLord', 'navamsaLagna', 'antardashaTitle', 'planets', 'navamsa',
        'dasha', 'antardasha', 'doshas', 'signatures',
    }
    assert set(chart) == expected_keys
    assert chart['lagna'] == 'Pisces'
    assert chart['planets'][0]['sign'] == 'Gemini'
    assert chart['planets'][1]['sign'] == 'Cancer'
    assert 'Venus' in chart['antardashaTitle']
    assert len(chart['planets']) == 9
    assert len(chart['navamsa']) == 9
    assert len(chart['doshas']) == 3
    assert sum(period['active'] for period in chart['dasha']) == 1
    assert sum(period['active'] for period in chart['antardasha']) == 1


def test_second_known_birth_has_stable_sidereal_positions() -> None:
    chart = compute(LONDON_BIRTH)
    assert chart['lagna'] == 'Cancer'
    assert chart['planets'][0]['sign'] == 'Libra'
    assert chart['planets'][1]['sign'] == 'Leo'
    assert 'Mars' in chart['antardashaTitle']


def test_southern_hemisphere_edge_timezone_and_pair_score() -> None:
    southern = compute(SOUTHERN_BIRTH)
    assert southern['lagna'] == 'Leo'
    assert southern['planets'][0]['sign'] == 'Sagittarius'
    assert southern['planets'][1]['sign'] == 'Aquarius'

    pair = compute_pair(SAMPLE_BIRTH, LONDON_BIRTH)
    score = pair['matchScore']
    assert set(score) >= {'varna', 'vashya', 'tara', 'yoni', 'grahaMaitri', 'gana', 'bhakoot', 'nadi', 'total', 'outOf'}
    assert 0 <= score['total'] <= 36
    assert score['outOf'] == 36


def test_transits_return_monthly_major_positions() -> None:
    result = transits(SAMPLE_BIRTH, '2025-01-15', months=2)
    assert result['from'] == '2025-01-15'
    assert len(result['months']) == 3
    for row in result['months']:
        assert set(row) == {'date', 'Saturn', 'Jupiter', 'Rahu', 'Ketu'}
        for body in ('Saturn', 'Jupiter', 'Rahu', 'Ketu'):
            assert set(row[body]) == {'sign', 'degree'}


def test_cli_accepts_report_data_file_shape() -> None:
    repo = Path(__file__).resolve().parents[3]
    sample = json.loads((repo / 'scripts/kundli/data.sample.json').read_text())
    process = subprocess.run(
        [sys.executable, '-m', 'service.kundli.chart', json.dumps(sample)],
        cwd=repo,
        check=True,
        capture_output=True,
        text=True,
    )
    chart = json.loads(process.stdout)
    assert chart['lagna'] == 'Pisces'
    assert [planet['name'] for planet in chart['planets']] == [
        'Sun', 'Moon', 'Mars', 'Mercury', 'Jupiter', 'Venus', 'Saturn', 'Rahu', 'Ketu',
    ]
