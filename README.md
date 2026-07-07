# 🪔 Siddh Jyotish — AI-Computed Vedic Astrology, as a Business

> **Brand:** Siddh Jyotish (`siddhjyotish.com`, alias `sidhjyotish.com`).
> *Siddh* = "accomplished/proven"; paired with *Jyotish* (Vedic astrology) to
> signal proven, precise astrology from a living lineage of scholars.

> A no-database, no-accounts, near-zero-fixed-cost product that sells
> **precisely-computed Janma Kundli (Vedic birth chart) reports** and
> **follow-up astrology answers** — powered by Devin playbooks, Stripe, and a
> single Astro app.

This README is both the **project documentation** and the **business plan**.

---

## 1. The idea in one paragraph

A customer enters their birth details and pays **$31** (which includes **3
questions**). We run a Devin playbook that computes their exact planetary
positions with the Swiss Ephemeris and writes an original, professional
astrology report, delivered as a PDF plus an interactive chart. The customer
also receives an **encrypted reference number**. Later, they can pay for
**1–3 precise follow-up questions** — priced **$8 / $11 / $13** for 1 / 2 / 3
questions — we decrypt the reference, resume their *same* Devin session (which
still holds their computed chart), and email back precise answers with no new
report. Every question is capped at **18 words**. **No database. No user
accounts. No standing backend server.**

---

## 2. Why this architecture is unusual (and good)

Most SaaS needs a database, auth, and a backend. This product needs **none** of
them, because the only piece of state — the customer's computed chart — lives
inside the Devin session that produced it. We simply hand the customer an
**encrypted pointer to that session** (the "reference number").

```
                         ┌─────────────────────────────────────────┐
                         │            ONE Astro app                 │
                         │  (UI pages + /api serverless functions)   │
   Browser  ───────────► │                                          │
   (form + pay)          │  • /api/checkout/new     ($31)           │
                         │  • /api/checkout/followup($8-13)         │
                         │  • /api/stripe/webhook                   │
                         │  • /api/status                           │
                         └───────┬───────────────┬──────────────┬───┘
                                 │               │              │
                        Stripe (pay +     Devin API      Email (Resend)
                        metadata "store")  (playbooks)    (deliver PDF +
                                 │               │         reference)
                                 ▼               ▼
                       payment_intent    session_id  ──encrypt──►  reference #
                       = idempotency                 (the ONLY state)
```

- **The Astro app *is* the server.** UI and backend are the same deployment;
  `src/pages/api/*` are serverless functions. There is no separate backend to
  run or pay for.
- **Stripe is the "database."** Birth details and questions ride in the Checkout
  Session `metadata`; the Stripe `payment_intent` id gives us idempotency for
  webhook retries. We persist nothing ourselves.
- **The reference number is the state.** `AES-256-GCM(session_id)` → an
  authenticated, tamper-proof token emailed to the customer.

### Why not delete server-side code entirely?

Three secrets can **never** touch the browser, or the business breaks:

| Secret | If leaked… |
|---|---|
| `DEVIN_API_KEY` | anyone runs sessions and burns **your** ACUs (the real cost) |
| `STRIPE_SECRET_KEY` / webhook secret | fake "paid" events trigger free reports |
| `REFERENCE_SECRET` | references can be forged to read others' charts |

So *some* server-side execution is mandatory — but it can be **serverless on a
free tier**, so fixed cost ≈ **$0**. Removing the "backend" does **not** reduce
Devin cost; ACUs are billed per session run regardless of who triggers it.

---

## 3. User flows

### Flow A — First-timer ($31 → full Kundli, includes 3 questions)
1. UI collects **name, DOB, exact time (AM/PM), place**, email, and up to 3
   questions (max 18 words each, included in the price).
2. `POST /api/checkout/new` → Stripe Checkout ($31), details saved in metadata.
3. On `checkout.session.completed`, the webhook runs the **`!kundli`** playbook →
   `session_id` (3 included questions ride along in metadata).
4. Backend immediately emails the **encrypted reference number** (their receipt for
   buying follow-ups later).
5. Playbook computes the chart (Swiss Ephemeris), produces **PDF + interactive HTML**,
   and — minutes later, when done — **emails the finished PDF to the customer itself**
   (using the `RESEND_API_KEY` Devin secret). This closes the async gap without polling.

### Flow B — Returning customer ($8 / $11 / $13 → 1 / 2 / 3 questions)
1. UI collects **reference number + 1–3 questions** (max 18 words each) + email.
2. `POST /api/checkout/followup` → we validate the reference decrypts, price by
   question count ($8 / $11 / $13), then Stripe Checkout.
3. On success, the webhook **decrypts the reference → session_id**, and resumes
   that session (the original `!kundli` context; see [follow-up playbook
   limitation](#environment-variables-env)).
4. Playbook reuses the already-computed chart and answers **only** those 1–3
   questions (dasha/transit timing), **no new PDF**.
5. Backend emails the precise answers.

---

## 4. The two Devin playbooks

| Playbook | Macro | Purpose | Output |
|---|---|---|---|
| Generate a Vedic Astrology (Kundli) Birth Chart | `!kundli` | Full chart + report, **emails the PDF** | PDF + interactive HTML |
| Answer Follow-Up Questions on an Existing Chart | `!kundli_followup` | Resume session, answer 1–3 Qs | precise text answers |

Both compute planetary positions with the **Swiss Ephemeris** (sidereal zodiac,
Lahiri ayanamsa, whole-sign houses) — never guessed or hard-coded. The follow-up
playbook reuses the original session's chart and produces no new report.

> **Async PDF delivery (no polling):** the `!kundli` report takes minutes, but the
> Stripe webhook must respond in seconds. So the backend sends the reference email
> instantly, and the **`!kundli` playbook emails the finished PDF itself** once it
> completes. For this the playbook session needs a **Devin secret named
> `RESEND_API_KEY`** (Settings → Secrets, org scope) — this is separate from the
> app's own `RESEND_API_KEY` env var. The customer's email is passed into the
> session prompt by the backend.

---

## 5. Tech stack

- **[Astro](https://astro.build) (SSR, Node adapter)** — UI + API in one app.
- **Stripe Checkout** — hosted payment, no accounts; metadata as our store.
- **Devin REST API** — runs/ resumes playbook sessions.
- **Resend** — transactional email + PDF delivery.
- **AES-256-GCM** (Node `crypto`) — the encrypted reference number.
- **TypeScript**, **Zod** — type-safe, validated inputs.

---

## 6. Project structure

```
astro/
├─ src/
│  ├─ lib/
│  │  ├─ env.ts          # type-safe env/config (server-only secrets)
│  │  ├─ reference.ts    # AES-256-GCM encode/decode of the reference number
│  │  ├─ devin.ts        # Devin API client (create / resume / get session)
│  │  ├─ stripe.ts       # Stripe client factory
│  │  ├─ email.ts        # Resend client + email templates
│  │  └─ validation.ts   # Zod schemas for form input
│  └─ pages/
│     ├─ index.astro           # first-timer landing + form ($31)
│     ├─ returning.astro       # returning-user form ($8/$11/$13)
│     ├─ success.astro         # post-payment status/polling page
│     └─ api/
│        ├─ checkout/new.ts      # start $31 checkout
│        ├─ checkout/followup.ts # start $8/$11/$13 checkout
│        ├─ stripe/webhook.ts    # payment → trigger/resume Devin + email
│        └─ status.ts            # poll session state for the success page
├─ astro.config.mjs
├─ .env.example
└─ README.md
```

---

## 7. Getting started

```bash
npm install
cp .env.example .env      # fill in the values below
npm run dev               # http://localhost:4321
```

### Environment variables (`.env`)

| Var | What it is |
|---|---|
| `PRICE_KUNDLI_USD` | Kundli price in dollars (default 31, includes 3 questions) |
| `PRICE_FOLLOWUP_1_USD` / `PRICE_FOLLOWUP_2_USD` / `PRICE_FOLLOWUP_3_USD` | follow-up prices for 1 / 2 / 3 questions (default 8 / 11 / 13) |
| `PUBLIC_SITE_URL` | site URL for Stripe redirects |
| `DEVIN_API_KEY` | Devin **service-user** key (prefix `cog_`, server only) — v3 API |
| `DEVIN_ORG_ID` | Devin org id (prefix `org-`), required by v3 org-scoped endpoints |
| `DEVIN_KUNDLI_PLAYBOOK` | Playbook id for the `!kundli` chart-generation playbook (used at session creation) |
| `DEVIN_FOLLOWUP_PLAYBOOK` | Playbook id for the `!kundli_followup` Q&A playbook (documented only — see note below) |
| `REFERENCE_SECRET` | base64 of 32 random bytes — reference encryption key |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | Stripe keys |
| `RESEND_API_KEY` / `EMAIL_FROM` | email delivery |

> **Follow-up playbook limitation:** The Devin v3 message API does not accept a
> `playbook_id`, so `DEVIN_FOLLOWUP_PLAYBOOK` is not applied when resuming a
> session for follow-up questions. Follow-ups reuse the original `!kundli`
> session's context. If the API adds playbook-on-resume support in the future,
> `askFollowup()` in `src/lib/devin.ts` should be updated to pass it.

Generate a reference key:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

### Deploy (serverless, free tier)
Deploy the app to Vercel / Netlify / Cloudflare. Set the same env vars in the
dashboard. Point a Stripe webhook at `/api/stripe/webhook`. That's the entire
infra — no DB, no server to manage.

---

## 8. Business plan

### 8.1 Value proposition
Precise, ephemeris-accurate Vedic astrology + genuinely personalized written
analysis, delivered fast and privately (no account, no data retention on our
side). Premium positioning: this is a high-touch report, not a $5 app horoscope.

### 8.2 Pricing & unit economics
| Product | Price | Variable cost (Devin ACUs + Stripe + email) | Gross margin |
|---|---|---|---|
| Full Kundli (`!kundli`, incl. 3 questions) | **$31** | compute-heavy session | high once ACU/report is measured |
| Follow-up 1–3 Qs (`!kundli_followup`) | **$8 / $11 / $13** | resumes session, lighter | very high |

> **Action item:** measure real ACU cost per report on a few live runs to lock
> in margin. Fixed cost is ~$0 (serverless free tier), so profitability is
> driven entirely by (price − per-session ACU cost − ~3% Stripe fee).

### 8.3 Revenue model
- One-time purchases (no subscription needed for v1).
- Natural **repeat revenue**: every full report seeds a $1,100 follow-up funnel
  via the reference number in the delivery email.
- Optional future tiers: bundles (report + N questions), gifting, expedited.

### 8.4 Go-to-market
- SEO / content on Vedic astrology topics; targeted social (Instagram/YouTube).
- Diaspora communities (matches the existing brand's audience).
- Referral: share-your-reading incentives.

### 8.5 Cost structure
- **Fixed:** ~$0 (serverless free tier, no DB, no accounts).
- **Variable:** Devin ACUs per session, ~2.9%+30¢ Stripe fee, email (Resend free
  tier covers early volume).

### 8.6 Key risks & mitigations
| Risk | Mitigation |
|---|---|
| Devin session expires before follow-up | reference/session model chosen; playbook can recompute from birth details if context lost |
| ACU cost per report unknown | measure before scaling ad spend |
| Payment fraud / webhook spoofing | verify Stripe signatures server-side |
| Reference lost (email only) | also show reference on the success page |
| Astrology claims / consumer expectations | clear "for guidance" framing in report + site |
| Regulatory (payments, consumer, data) | Stripe handles PCI; we store no PII beyond the transaction |

### 8.7 Roadmap
1. **v1 (this repo):** two products, encrypted reference, email delivery.
2. **v1.1:** success-page live status while the report computes; downloadable PDF on-page.
3. **v2:** more question bundles, gifting, multi-language reports.
4. **v3:** optional Devin-Automation trigger path (Stripe → Devin webhook) for
   an even more code-less operation.

---

## 9. Status

🚧 **In active development.** Architecture, playbooks, core libraries, and
checkout endpoints are in place; webhook delivery, UI pages, and end-to-end
wiring are being finished. See the open PR for progress.
