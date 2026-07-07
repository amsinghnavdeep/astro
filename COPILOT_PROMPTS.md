# Copilot Build Prompts — Siddh Jyotish (combined frontend + backend)

These are **copy-paste prompts** for GitHub Copilot / Copilot Chat to build the
whole app **one file at a time**, in order. Copilot is not very smart, so each
prompt is fully specified: exact file path, exact behavior, exact signatures,
and acceptance checks. **Do them in the given order** — later files import
earlier ones.

> Conventions for every prompt below:
> - The project is **Astro (SSR, Node adapter) + TypeScript**, `"type": "module"`.
> - All secrets are server-side only. Never put secrets in client code.
> - There is **no database and no user accounts**. Stripe Checkout `metadata`
>   holds per-order data; the encrypted **reference number** holds the Devin
>   `session_id`.
> - Use `fetch` (Node 18+ global). Use `zod` for validation. Return JSON from API
>   routes with `new Response(JSON.stringify(...), { status, headers })`.
> - After each prompt, run `npm run build` and fix any TypeScript errors before
>   moving on.

---

## Prompt 0 — Initialize the project

```
Create a new Astro project configured for server-side rendering with the Node
adapter, using TypeScript in strict mode and ES modules.

Do exactly this:
1. Create package.json with "type": "module", "private": true, and scripts:
   "dev": "astro dev", "build": "astro build", "preview": "node ./dist/server/entry.mjs",
   "typecheck": "tsc --noEmit".
2. Install dependencies: astro@^4, @astrojs/node@^8, stripe@^16, resend@^4, zod@^3.
   Install devDependencies: typescript@^5, @astrojs/check@^0.9.
3. Create astro.config.mjs that:
   - imports defineConfig from 'astro/config' and node from '@astrojs/node'
   - sets output: 'server'
   - sets adapter: node({ mode: 'standalone' })
   - sets server: { port: Number(process.env.PORT) || 4321, host: true }
4. Create tsconfig.json extending "astro/tsconfigs/strict" with
   compilerOptions.types = ["astro/client"] and strictNullChecks true, and
   exclude ["dist"].
5. Create .gitignore ignoring node_modules/, dist/, .env, .env.*, .astro/, *.log,
   but NOT ignoring .env.example.

Acceptance: `npm run build` succeeds on an empty src with a single placeholder page.
```

---

## Prompt 1 — Environment/config module

```
Create src/lib/env.ts.

Export a single typed object `env` that reads configuration from process.env.
Requirements:
- Helper `required(name)` throws "Missing required environment variable: <name>"
  if the value is empty/undefined; returns the value otherwise.
- Helper `optional(name, fallback='')` returns process.env[name] ?? fallback.
- Helper `usdToCents(name, fallbackDollars)` reads a dollar amount, multiplies by
  100, rounds to an integer, and throws on non-finite or <= 0 values.
- The `env` object has these fields:
  - siteUrl: optional('PUBLIC_SITE_URL', 'http://localhost:4321')
  - pricing.kundliCents = usdToCents('PRICE_KUNDLI_USD', 2100)
  - pricing.followupCents = usdToCents('PRICE_FOLLOWUP_USD', 1100)
  - devin.apiKey: a GETTER that returns required('DEVIN_API_KEY')
  - devin.apiBase: optional('DEVIN_API_BASE', 'https://api.devin.ai/v1')
  - devin.kundliPlaybook: optional('DEVIN_KUNDLI_PLAYBOOK')
  - devin.followupPlaybook: optional('DEVIN_FOLLOWUP_PLAYBOOK')
  - referenceSecret: a GETTER that returns required('REFERENCE_SECRET')
  - stripe.secretKey: GETTER -> required('STRIPE_SECRET_KEY')
  - stripe.webhookSecret: GETTER -> required('STRIPE_WEBHOOK_SECRET')
  - email.apiKey: GETTER -> required('RESEND_API_KEY')
  - email.from: optional('EMAIL_FROM', 'Kundli <onboarding@resend.dev>')

Use getters for secrets so the app can start/build without them and only throws
when a secret is actually used at request time. Mark the object `as const`.
```

Also create `.env.example` listing every variable above with comments, including
how to generate `REFERENCE_SECRET`:
```
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

---

## Prompt 2 — Reference number (AES-256-GCM)

```
Create src/lib/reference.ts. This encrypts/decrypts the Devin session id into the
customer-facing "reference number". Use Node's built-in 'node:crypto'.

Import { env } from './env'.

Constants: VERSION='v1', ALGO='aes-256-gcm', IV_BYTES=12.

Private getKey(): Buffer:
- decode env.referenceSecret from base64 into a Buffer
- if length !== 32 throw an error explaining it must decode to 32 bytes.

export function encodeReference(sessionId: string): string
- generate 12 random bytes iv
- createCipheriv(ALGO, key, iv), update(sessionId,'utf8') + final()
- get the 16-byte auth tag; concat ciphertext + authTag into payload
- return `${VERSION}.${iv.toString('base64url')}.${payload.toString('base64url')}`

export function decodeReference(reference: string): string
- trim and split on '.'; require exactly 3 parts and parts[0] === VERSION
- iv = base64url decode parts[1]; payload = base64url decode parts[2]
- validate iv length === 12 and payload length > 16, else throw "Malformed reference token."
- authTag = last 16 bytes of payload; ciphertext = the rest
- createDecipheriv, setAuthTag, update+final, return utf8 string
- if decryption throws (tampered), let it throw

Acceptance: decodeReference(encodeReference("devin-abc")) === "devin-abc", and a
mutated token throws.
```

---

## Prompt 3 — Devin API client

```
Create src/lib/devin.ts. A minimal server-side client for the Devin REST API.
Import { env } from './env'.

Export interface BirthDetails { fullName, dateOfBirth, timeOfBirth, placeOfBirth,
email: string; questions?: string[] }.
Export interface DevinSession { session_id: string; url?: string;
status_enum?: string; status?: string; structured_output?: Record<string,unknown> | null }.

Private async devinFetch<T>(path, init): calls fetch(`${env.devin.apiBase}${path}`,
{ ...init, headers: { Authorization: `Bearer ${env.devin.apiKey}`,
'Content-Type':'application/json', ...init.headers } }). If !res.ok, read text and
throw `Devin API <status> on <path>: <body>`. Otherwise return res.json() as T.

Private buildKundliPrompt(d: BirthDetails): string that instructs Devin to generate
a full Vedic Janma Kundli for the given name/DOB/time/place, lists any questions,
and asks it to keep the birth details in session context and deliver PDF + HTML.

export async function createKundliSession(d): builds body = { prompt: buildKundliPrompt(d) };
if env.devin.kundliPlaybook is set, add body.playbook_id = env.devin.kundliPlaybook;
POST '/sessions' with JSON body; return DevinSession.

export async function askFollowup(sessionId: string, questions: string[]): builds a
prompt telling Devin to reuse the existing chart, produce NO new PDF, and answer only
the listed questions with dasha/transit timing; POST `/session/${sessionId}/message`
with body { message: prompt }.

export async function getSession(sessionId): GET `/session/${sessionId}` -> DevinSession.

Note: confirm exact Devin endpoints/field names against https://docs.devin.ai
before shipping; adjust paths if the API differs.
```

---

## Prompt 4 — Stripe + Email + Validation helpers

```
Create src/lib/stripe.ts:
- import Stripe from 'stripe' and { env } from './env'
- keep a module-level `let client: Stripe | null`
- export function stripe(): Stripe that lazily creates
  new Stripe(env.stripe.secretKey, { apiVersion: '2024-06-20' }) and caches it.

Create src/lib/email.ts:
- import { Resend } from 'resend' and { env } from './env'
- lazy singleton resend() like above using env.email.apiKey
- export async function sendEmail({ to, subject, html, attachments? }) that calls
  resend().emails.send({ from: env.email.from, to, subject, html, attachments })
  where attachments is { filename, content: Buffer }[]
- export function kundliDeliveryHtml(fullName, reference): string — a small inline-
  styled HTML email that greets the user, says the PDF is attached, and shows the
  reference in a <pre> block with a note that it is encrypted and unique.
- export function followupAnswersHtml(answers): string — inline-styled HTML wrapping
  the answers text in a white-space:pre-wrap div.
- include a private escapeHtml() and use it on all interpolated user text.

Create src/lib/validation.ts using zod:
- birthDetailsSchema: fullName(1..120), dateOfBirth(1..40), timeOfBirth(1..20),
  placeOfBirth(1..160), email (email, max 200), questions: array of string(1..300),
  max 6, optional default [].
- followupSchema: reference string(10..4000), email, questions: array of string(1..300)
  with EXACTLY length 2.
- export inferred types BirthDetailsInput and FollowupInput.
```

---

## Prompt 5 — Checkout endpoint: new order ($2100)

```
Create src/pages/api/checkout/new.ts. Add `export const prerender = false;` at top.
Import type { APIRoute } from 'astro', stripe from '../../../lib/stripe',
{ env } from '../../../lib/env', { birthDetailsSchema } from '../../../lib/validation'.

Export const POST: APIRoute = async ({ request }) => { ... }:
1. Parse request.json() in try/catch; on failure return 400 {error:'Invalid JSON body'}.
2. birthDetailsSchema.safeParse(body); if !success return 400 with the zod issues.
3. Create a Stripe Checkout Session:
   - mode: 'payment', customer_email: d.email
   - line_items: one item, quantity 1, price_data with currency 'usd',
     unit_amount: env.pricing.kundliCents, product_data name/description for the Kundli report.
   - metadata: { kind:'kundli', fullName, dateOfBirth, timeOfBirth, placeOfBirth,
     email, questions: JSON.stringify(d.questions ?? []).slice(0,480) }
   - success_url: `${env.siteUrl}/success?session_id={CHECKOUT_SESSION_ID}`
   - cancel_url: `${env.siteUrl}/?canceled=1`
4. Return 200 JSON { url: session.url }.
Add a small json(body,status=200) helper that sets Content-Type: application/json.
```

---

## Prompt 6 — Checkout endpoint: follow-up ($1100)

```
Create src/pages/api/checkout/followup.ts (prerender=false). Same imports plus
{ followupSchema } from '../../../lib/validation' and { decodeReference } from
'../../../lib/reference'.

POST handler:
1. Parse JSON (400 on failure).
2. followupSchema.safeParse; 400 with issues on failure.
3. try decodeReference(reference); if it throws, return 400 {error:'That reference
   number is invalid.'} — validate BEFORE charging.
4. Create Checkout Session: mode 'payment', customer_email, one line item at
   env.pricing.followupCents, metadata { kind:'followup', email,
   reference: reference.slice(0,480), questions: JSON.stringify(questions).slice(0,480) },
   success_url `${env.siteUrl}/success?session_id={CHECKOUT_SESSION_ID}`,
   cancel_url `${env.siteUrl}/returning?canceled=1`.
5. Return { url: session.url }.
```

---

## Prompt 7 — Stripe webhook (payment → trigger Devin → email)

```
Create src/pages/api/stripe/webhook.ts (prerender=false). This is the core
fulfillment endpoint. Import stripe, env, { createKundliSession, askFollowup } from
devin, { encodeReference, decodeReference } from reference, { sendEmail,
kundliDeliveryHtml } from email.

POST handler ({ request }):
1. Read the raw body as text: const raw = await request.text();
   read the signature header: request.headers.get('stripe-signature').
2. Verify: let event = stripe().webhooks.constructEvent(raw, sig, env.stripe.webhookSecret);
   wrap in try/catch, return 400 on failure. IMPORTANT: signature verification needs
   the RAW body, so do NOT call request.json() first.
3. Only handle event.type === 'checkout.session.completed'. For anything else return 200.
4. const session = event.data.object; const m = session.metadata ?? {}.
5. If m.kind === 'kundli':
   - parse questions = JSON.parse(m.questions || '[]')
   - const devinSession = await createKundliSession({ fullName:m.fullName,
     dateOfBirth:m.dateOfBirth, timeOfBirth:m.timeOfBirth, placeOfBirth:m.placeOfBirth,
     email:m.email, questions })
   - const reference = encodeReference(devinSession.session_id)
   - email the customer now with the reference (the PDF itself is delivered when the
     Devin session finishes — see note below). await sendEmail({ to:m.email,
     subject:'Your Kundli reference number', html: kundliDeliveryHtml(m.fullName, reference) })
6. If m.kind === 'followup':
   - const sessionId = decodeReference(m.reference)
   - const questions = JSON.parse(m.questions || '[]')
   - await askFollowup(sessionId, questions)
7. Return 200 {received:true}. Wrap the body in try/catch; log errors and still return
   200 so Stripe does not retry forever on a permanent error (but return 500 on transient
   errors you WANT retried).

NOTE (explain in a code comment): a Devin session takes minutes and can produce
attachments asynchronously. For v1 we email the reference immediately; delivering the
final PDF/answers requires either (a) polling the session from /api/status and emailing
when complete, or (b) having the playbook itself send the final email. Leave a TODO.
```

---

## Prompt 8 — Status endpoint (for the success page)

```
Create src/pages/api/status.ts (prerender=false). Import stripe, { getSession } from
devin.

GET handler ({ url }):
1. const checkoutId = url.searchParams.get('session_id'); if missing return 400.
2. Retrieve the Checkout Session from Stripe: stripe().checkout.sessions.retrieve(checkoutId).
3. Read payment_status and metadata.kind. If payment_status !== 'paid', return
   { state:'unpaid' }.
4. Return { state:'paid', kind: metadata.kind }. (Optional: if you stored the Devin
   session id, call getSession and include its status_enum so the page can show progress.)
Return JSON. Do NOT expose secrets or full metadata.
```

---

## Prompt 9 — Shared layout + styles

```
Create src/layouts/Base.astro: an HTML skeleton with <slot/>, a warm "Indian
heritage" theme (deep saffron/gold #b8860b accents, cream background #faf5e6, dark
text), responsive meta viewport, a simple centered container (max-width 640px), and
a footer line "No account needed · Your reading is private". Accept a `title` prop.
Keep all CSS in a <style> block in this file.
```

---

## Prompt 10 — Home / first-timer page ($2100)

```
Create src/pages/index.astro using the Base layout.

Content:
- Hero: headline "Your Janma Kundli, computed precisely", subtext explaining a full
  Vedic birth chart PDF for $2,100, no account needed.
- A <form id="kundli-form"> with fields: fullName (text), dateOfBirth (text,
  placeholder "30 Jan 2000"), timeOfBirth (text, placeholder "11:30 AM" — add helper
  text warning AM/PM matters), placeOfBirth (text, "City, State, Country"), email
  (email), and 0–3 optional question textboxes. A submit button "Pay $2,100 & Generate".
- A link to /returning: "Already have a reference number? Ask follow-up questions →".

Client script (inline <script>): on submit, preventDefault, gather fields into a JSON
object (questions = non-empty question inputs as an array), POST to /api/checkout/new
with header Content-Type application/json. On 200, read {url} and set
window.location.href = url. On error, show the error message in a #error div.
Disable the button while submitting.
```

---

## Prompt 11 — Returning-user page ($1100)

```
Create src/pages/returning.astro using the Base layout.

Content:
- Heading "Ask 2 follow-up questions — $1,100".
- <form id="followup-form"> with: reference (textarea, "Paste your reference number"),
  email, and EXACTLY two question inputs (both required). Submit "Pay $1,100 & Get Answers".

Client script: gather { reference, email, questions:[q1,q2] }, POST /api/checkout/followup,
redirect to {url} on success, show #error on failure. Require both questions to be non-empty
before submitting.
```

---

## Prompt 12 — Success page (poll status)

```
Create src/pages/success.astro using the Base layout.

- Read session_id from the URL query on the client.
- Show "Payment received 🎉". Then poll GET /api/status?session_id=... every 4 seconds.
- While state is 'unpaid', show "Confirming payment…".
- When state is 'paid' and kind is 'kundli', show: "Your report is being generated.
  We've emailed your reference number now; the full PDF arrives by email shortly."
- When kind is 'followup', show: "We're preparing your answers and will email them shortly."
- Include a visible copy of any reference the page has (if returned by the API).
- Stop polling after ~5 minutes.
```

---

## Prompt 13 — Local testing checklist (give this to the human)

```
1. cp .env.example .env and fill values. Generate REFERENCE_SECRET as documented.
2. npm install && npm run build && npm run dev.
3. Stripe test mode: use test keys. Run `stripe listen --forward-to
   localhost:4321/api/stripe/webhook` and put the printed signing secret in
   STRIPE_WEBHOOK_SECRET. Use test card 4242 4242 4242 4242.
4. Submit the home form → complete Stripe test checkout → confirm the webhook fires,
   a Devin session is created, and the reference email is sent (check Resend logs).
5. Copy the reference, go to /returning, submit 2 questions, pay, confirm askFollowup runs.
6. Verify decodeReference(encodeReference(x)) === x and that a tampered reference is rejected.
```

---

### Reminders for Copilot (paste at the top of any session)
- This is Astro SSR with `output: 'server'`; every API route needs `export const prerender = false;`.
- Never read `request.json()` before verifying the Stripe webhook signature — it needs the raw body.
- Secrets come only from `env` (src/lib/env.ts); never hardcode them and never send them to the client.
- After each file, run `npm run build` and fix all TypeScript errors before continuing.
