# Kundli service

This directory documents the FastAPI service that runs the deterministic chart,
Gemini interpretation, PDF, and email pipeline.

## Run locally with Docker

From the repository root:

```bash
docker build -f service/Dockerfile -t kundli-service .
```

Run it with local development secrets. Do not commit these values:

```bash
docker run --rm \
  -e KUNDLI_SERVICE_TOKEN='replace-with-a-local-token' \
  -e GEMINI_API_KEYS='replace-with-one-or-more-gemini-keys' \
  -e RESEND_API_KEY='replace-with-a-resend-key' \
  -e KUNDLI_STATE_DIR=/tmp/kundli-state \
  -p 8080:8080 \
  kundli-service
```

The image listens on `$PORT` and defaults to port `8080`. Chromium is installed
inside the image and `CHROME_BIN=/usr/bin/chromium` is configured for the
existing PDF generator.

Health check:

```bash
curl -sS http://localhost:8080/health
# {"status":"ok"}
```

The `/generate` endpoint requires the application bearer token. A dry run still
requires a working Gemini key because it computes the interpretation, but it
does not send an email:

```bash
curl -sS http://localhost:8080/generate \
  -H "Authorization: Bearer replace-with-a-local-token" \
  -H "Content-Type: application/json" \
  -d '{
    "orderId": "local-dry-run-001",
    "serviceType": "kundli",
    "person": {
      "fullName": "Nav",
      "gender": "Male",
      "dateOfBirth": "1 July 1995",
      "timeOfBirth": "10:40 AM",
      "placeOfBirth": "Mississauga",
      "latitude": 43.59,
      "longitude": -79.64,
      "timezone": "America/Toronto"
    },
    "partner": null,
    "questions": ["What is the main guidance for this year?"],
    "extras": {},
    "pandit": {
      "name": "Siddh Jyotish",
      "referenceNumber": "local-reference-001",
      "customerEmail": "customer@example.com"
    },
    "dryRun": true
  }'
```

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `KUNDLI_SERVICE_TOKEN` | Yes for `/generate` | Shared bearer token used by the Worker to authenticate the service. |
| `GEMINI_API_KEYS` | Yes for interpretation | Comma-separated Gemini API keys. `interpret.py` rotates keys on quota errors. |
| `GEMINI_API_KEY` | No (fallback) | Single-key fallback supported by `interpret.py` when `GEMINI_API_KEYS` is empty. |
| `RESEND_API_KEY` | Yes for a real email | Resend API key used by `scripts/kundli/send_email.py`; dry runs do not send but the sender itself still requires this key if invoked directly. |
| `KUNDLI_STATE_DIR` | No | Writable idempotency-state directory. The image defaults to `/tmp/kundli-state`. |
| `PORT` | No | HTTP port supplied by Cloud Run; defaults to `8080`. |
| `CHROME_BIN` | No | Chromium executable. The image sets this to `/usr/bin/chromium`. |

The sender currently has no separate environment variable for the From address.
It uses the default `Siddh Jyotish <namaste@siddhjyotish.com>` unless an
optional `from` field is present in the assembled data. Subject overrides are
also data fields, not environment variables.

## Deploying

Deployment commands are intentionally kept separate. See
[`cloudrun.md`](cloudrun.md) and run those commands yourself later after
choosing the GCP project, region, service account, and secret values.
