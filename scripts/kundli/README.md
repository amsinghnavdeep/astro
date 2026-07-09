# Kundli PDF generator + email sender

The report layout is a **fixed template**. Every heading, the cover, the North-Indian
square chart diagrams, the tables, and all static copy live in `generate_report.py`
and `send_email.py` and are identical for every customer. The AI/backend only ever
**fills the values** inside `data.json` — it must **never add, remove, or rename keys**,
and it must not touch the design. The same `data.json` drives both the PDF and the email.

```bash
python scripts/kundli/generate_report.py scripts/kundli/data.sample.json   # writes Kundli_Report.pdf + report.html
python scripts/kundli/send_email.py       scripts/kundli/data.sample.json   # emails the PDF via Resend
python scripts/kundli/send_email.py --dry-run scripts/kundli/data.sample.json   # preview payload, no send
```

Both output files are written next to the input JSON.

## Fixed JSON schema (fill values only)

`data.sample.json` is the canonical, complete example. Provide **every** key below with an
accurate value. Numbers, signs, degrees, nakshatras, dates, houses, etc. must be **accurate**
(taken from the computed chart) — the template renders exactly what you supply.

### `person`
`fullName`, `gender` (`Male` | `Female` | `Other`), `dateOfBirth`, `timeOfBirth`,
`placeOfBirth`, `latitude`, `longitude`, `timezone`, `timezoneOffset`, `universalTime`

### `pandit`
`name`, `referenceNumber`, `customerEmail`

### `chart`
- `ayanamsa`, `lagna`, `lagnaDegree`, `lagnaNakshatra`, `lagnaPada`, `lagnaNakLord`
- `navamsaLagna` — the D-9 ascendant sign
- `antardashaTitle` — short label for the active mahadasha, e.g. `current Shukra (Venus) Mahadasha`
- `planets[]` (all nine grahas): `{ name, sign, degree, nakshatra, pada, house, nakLord, motion }`
- `navamsa[]` (all nine grahas): `{ name, sign }` — the D-9 sign of each graha
- `dasha[]` (full Vimshottari sequence): `{ maha, start, end, length, active }`
- `antardasha[]` (sub-periods of the active mahadasha): `{ period, from, to, active }`
- `doshas[]`: `{ name, present (bool), note }`
- `signatures[]`: short chart-signature phrases (strings) shown as pills

### `interpretation` (AI-written prose)
- `coreNature[]` — paragraphs on the person's core nature (array of strings)
- `houseHighlights[]`: `{ title, text }`
- `answers[]`: `{ question, answer }` — **always exactly 3** questions/answers; `answer` may
  contain multiple paragraphs separated by a blank line
- `remedies[]`: `{ title, text }`
- `closingBlessing` — one closing blessing paragraph (string)
- `emailHighlights[]`: `{ label, text }` — the 3 bullets shown in the email
- `emailGoodNews` — the reassuring "good news" paragraph in the email (string)

Notes:
- Sign values may be given as English (`Gemini`) — the template appends the Sanskrit name
  (`Gemini (Mithuna)`) automatically. Supplying `Gemini (Mithuna)` is also fine.
- `sign`/planet names drive the chart diagrams; keep them spelled normally.

## Rendering / validation
- PDF rendering uses headless Chrome from `CHROME_BIN`, falling back to `/opt/.devin/chrome`
  and `/opt/.devin/playwright_browsers`.
- Validation (`pypdf`) fails only if the PDF is empty, below the structural page minimum,
  has blank pages, or is missing required section markers. It prints `VALIDATION PASS` on success.
- The rendered report is customer-facing: never expose JSON, template, or validation mechanics,
  and do not name the ephemeris engine (describe it as "a professional astronomical ephemeris").

## Email sender
`send_email.py` mails the finished `Kundli_Report.pdf` through Resend, reading the same
`data.json`. Recipient comes from `pandit.customerEmail`; the email body is built from the
`interpretation.emailHighlights`, `interpretation.emailGoodNews`, `pandit`, and `person` values.
It requires `RESEND_API_KEY`. Send-only (restricted) keys are supported — the domain preflight
is skipped gracefully when the key cannot read the domains endpoint.
