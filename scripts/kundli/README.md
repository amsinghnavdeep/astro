# Kundli PDF generator

Run the report generator with a single JSON payload:

```bash
python scripts/kundli/generate_report.py scripts/kundli/data.sample.json
```

It writes:

- `Kundli_Report.pdf`
- `report.html`

Both files are generated in the same directory as the input JSON.

## JSON schema

The input JSON keeps deterministic chart data separate from AI-written prose.

### `person`
- `fullName`
- `gender` (`Male` | `Female` | `Other`)
- `dateOfBirth`
- `timeOfBirth`
- `placeOfBirth`
- `timezone`

### `pandit`
- `name`
- `referenceNumber`
- `customerEmail`

### `chart`
- `ayanamsa`
- `lagna`
- `planets[]`: `{ name, sign, degree, nakshatra, pada, house }`
- `navamsa[]`: `{ name, sign, house }`
- `dasha[]`: `{ maha, start, end, active }`
- `doshas[]`: `{ name, present, note }`

### `interpretation`
- `summary`
- `personality`
- `houseHighlights[]`: `{ title, text }`
- `predictions[]`: `{ period, text }`
- `concerns[]`: `{ title, text }`
- `remedies[]`: `{ title, text }`
- `answers[]`: `{ question, answer }`

## Notes

- The PDF output is customer-facing. Keep the on-page copy warm and devotional, and do not expose JSON, template, or validation mechanics in the rendered report.
- PDF rendering uses headless Chrome from `CHROME_BIN`, with fallbacks under `/opt/.devin/chrome` and `/opt/.devin/playwright_browsers`.
- Validation uses `pypdf` and fails if the PDF is empty, missing required markers, or contains blank pages.
