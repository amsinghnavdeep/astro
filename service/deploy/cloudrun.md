# Cloud Run deployment guide

> **Run these commands yourself later.** This document prepares the Phase 7
> deployment but no GCP commands or deployment were run while building this
> change.

## 1. Prerequisites

Install the Google Cloud CLI, then authenticate interactively:

```bash
gcloud auth login
gcloud auth application-default login
gcloud config set project YOUR_GCP_PROJECT_ID
```

Set shell variables for the deployment:

```bash
export PROJECT_ID="YOUR_GCP_PROJECT_ID"
export REGION="us-central1"
export REPOSITORY="kundli"
export SERVICE="kundli-service"
export IMAGE="$REGION-docker.pkg.dev/$PROJECT_ID/$REPOSITORY/$SERVICE:latest"
```

Enable the required APIs:

```bash
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com
```

## 2. Create an Artifact Registry repository

Run once per project/region:

```bash
gcloud artifacts repositories create "$REPOSITORY" \
  --repository-format=docker \
  --location="$REGION" \
  --description="Siddh Jyotish Kundli service images"
```

If the repository already exists, keep using it rather than recreating it.

## 3. Build and push the image

Authenticate Docker for the regional Artifact Registry host, then run these
commands from the repository root:

```bash
gcloud auth configure-docker "$REGION-docker.pkg.dev"

docker build \
  -f service/Dockerfile \
  -t "$IMAGE" \
  .

docker push "$IMAGE"
```

The image contains the `service/` package, `scripts/kundli/`, Python
dependencies, Chromium, and Devanagari-capable fonts. No application secrets
are baked into the image. If you prefer Cloud Build, use an equivalent
Cloud Build configuration whose Docker build step uses
`-f service/Dockerfile` with the repository root as its context.

## 4. Create Secret Manager secrets

Create these three secrets. The values below are shell variables only; do not
paste real values into this document or commit them:

- `GEMINI_API_KEYS`: comma-separated Gemini keys used by the interpretation
  module. Multiple keys allow quota rotation.
- `RESEND_API_KEY`: the Resend key used by the reusable email sender.
- `KUNDLI_SERVICE_TOKEN`: a private bearer token shared by the Worker and this
  service. Generate it locally with:

```bash
export KUNDLI_SERVICE_TOKEN="$(openssl rand -hex 32)"
```

Create each secret from a local shell variable:

```bash
export GEMINI_API_KEYS_VALUE="set-this-locally-without-committing-it"
export RESEND_API_KEY_VALUE="set-this-locally-without-committing-it"

printf '%s' "$GEMINI_API_KEYS_VALUE" | \
  gcloud secrets create GEMINI_API_KEYS --data-file=-
printf '%s' "$RESEND_API_KEY_VALUE" | \
  gcloud secrets create RESEND_API_KEY --data-file=-
printf '%s' "$KUNDLI_SERVICE_TOKEN" | \
  gcloud secrets create KUNDLI_SERVICE_TOKEN --data-file=-
```

For an existing secret, add a new version instead:

```bash
printf '%s' "$GEMINI_API_KEYS_VALUE" | \
  gcloud secrets versions add GEMINI_API_KEYS --data-file=-
```

The Cloud Run runtime service account must be allowed to read these secrets.
Create a dedicated account and grant only Secret Manager accessor access:

```bash
export RUNTIME_SA="kundli-runner@$PROJECT_ID.iam.gserviceaccount.com"

gcloud iam service-accounts create kundli-runner \
  --display-name="Kundli Cloud Run runtime"

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:$RUNTIME_SA" \
  --role="roles/secretmanager.secretAccessor"
```

## 5. Deploy Cloud Run

The recommended deployment keeps the service private at the Cloud Run IAM
layer and requires the Worker to call it with both an identity token and the
application `KUNDLI_SERVICE_TOKEN` bearer token:

```bash
gcloud run deploy "$SERVICE" \
  --image="$IMAGE" \
  --region="$REGION" \
  --platform=managed \
  --service-account="$RUNTIME_SA" \
  --min-instances=1 \
  --max-instances=10 \
  --memory=1Gi \
  --cpu=1 \
  --concurrency=1 \
  --timeout=300 \
  --no-allow-unauthenticated \
  --set-env-vars="KUNDLI_STATE_DIR=/tmp/kundli-state" \
  --set-secrets="GEMINI_API_KEYS=GEMINI_API_KEYS:latest,RESEND_API_KEY=RESEND_API_KEY:latest,KUNDLI_SERVICE_TOKEN=KUNDLI_SERVICE_TOKEN:latest"
```

Chromium is memory-sensitive, so `1Gi`, one CPU, and concurrency `1` are
deliberately conservative starting values. Tune them after observing latency
and memory metrics. A concurrency of `2` may be reasonable once the workload
is characterized.

`--no-allow-unauthenticated` means the Worker also needs
`roles/run.invoker` on this service and must send a Google identity token. Cloud
Run accepts that identity token in `X-Serverless-Authorization`, leaving the
regular `Authorization` header available for the application's
`KUNDLI_SERVICE_TOKEN` check. If the Worker cannot use Cloud Run IAM, the
alternative is `--allow-unauthenticated` while retaining the application-level
`KUNDLI_SERVICE_TOKEN`. That is easier to call but exposes the endpoint to the
internet, so the shared application token must remain private and rotation
should be planned.

The Phase 6 idempotency store is on-disk. `/tmp/kundli-state` is writable but
the Cloud Run filesystem is ephemeral and instance-local. This prevents most
same-instance duplicate work, but cross-instance idempotency needs a shared
store such as Cloud SQL, Firestore, or a KV service in a later phase.

## 6. Find the URL and check health

```bash
export SERVICE_URL="$(gcloud run services describe "$SERVICE" \
  --region="$REGION" \
  --format='value(status.url)')"
echo "$SERVICE_URL"
```

For the recommended private deployment, use a Google identity token for the
Cloud Run IAM layer:

```bash
curl -sS \
  -H "X-Serverless-Authorization: Bearer $(gcloud auth print-identity-token)" \
  "$SERVICE_URL/health"
# {"status":"ok"}
```

If the service was intentionally deployed with
`--allow-unauthenticated`, the health check is simply:

```bash
curl -sS "$SERVICE_URL/health"
```

## 7. Authenticated dry run

This calls Gemini and builds the PDF but does not send the email. Set
`KUNDLI_SERVICE_TOKEN` locally to the same value stored in Secret Manager.
For a private Cloud Run service, include both the Cloud Run identity token and
the service bearer token:

```bash
curl -sS -X POST "$SERVICE_URL/generate" \
  -H "X-Serverless-Authorization: Bearer $(gcloud auth print-identity-token)" \
  -H "Authorization: Bearer $KUNDLI_SERVICE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "orderId": "cloudrun-dry-run-001",
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
      "referenceNumber": "cloudrun-reference-001",
      "customerEmail": "customer@example.com"
    },
    "dryRun": true
  }'
```

The Phase 6 application reads the shared application token from the regular
`Authorization: Bearer <KUNDLI_SERVICE_TOKEN>` header. Cloud Run's
`X-Serverless-Authorization` identity-token header keeps the two layers
separate. Do not put the service token in a URL or log it.

## Cost considerations

Cloud Run has a free tier with monthly request, CPU, memory, and egress limits,
subject to the current Google Cloud pricing and region. `--min-instances=1`
keeps one warm instance running and therefore incurs a small always-warm CPU
and memory cost even when there are no orders. It avoids cold starts and is
useful while Chromium and Python dependencies initialize. If cost is more
important than latency, reduce min instances later and measure the impact.
