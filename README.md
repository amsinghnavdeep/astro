# 🪔 Kundli — AI-Computed Vedic Astrology, as a Business

> A no-database, no-accounts, near-zero-fixed-cost product that sells
> **precisely-computed Janma Kundli (Vedic birth chart) reports** and
> **follow-up astrology answers** — powered by Devin playbooks, Stripe, and a
> single Astro app.

This README is both the **project documentation** and the **business plan**.

---

## 1. The idea in one paragraph

A customer enters their birth details and pays **$2,100**. We run a Devin
playbook that computes their exact planetary positions with the Swiss Ephemeris
and writes an original, professional astrology report, delivered as a PDF plus
an interactive chart. The customer also receives an **encrypted reference
number**. Later, they can pay **$1,100** to ask **two precise follow-up
questions** — we decrypt the reference, resume their *same* Devin session (which
still holds their computed chart), and email back precise answers with no new
report. **No database. No user accounts. No standing backend server.**

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
   (form + pay)          │  • /api/checkout/new     ($2100)         │
                         │  • /api/checkout/followup($1100)         │
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

### Flow A — First-timer ($2,100 → full Kundli)
1. UI collects **name, DOB, exact time (AM/PM), place**, email, optional questions.
2. `POST /api/checkout/new` → Stripe Checkout ($2,100), details saved in metadata.
3. On `checkout.session.completed`, the webhook runs the **`!kundli`** playbook →
   `session_id`.
4. Playbook computes the chart (Swiss Ephemeris) and produces **PDF + interactive HTML**.
5. Backend emails the **PDF** + the **encrypted reference number**.

### Flow B — Returning customer ($1,100 → 2 questions)
1. UI collects **reference number + 2 questions** + email.
2. `POST /api/checkout/followup` → we validate the reference decrypts, then
   Stripe Checkout ($1,100).
3. On success, the webhook **decrypts the reference → session_id**, and resumes
   that session with the **`!kundli_followup`** playbook.
4. Playbook reuses the already-computed chart and answers **only** those
   questions (dasha/transit timing), **no new PDF**.
5. Backend emails the precise answers.

---

## 4. The two Devin playbooks

| Playbook | Macro | Purpose | Output |
|---|---|---|---|
| Generate a Vedic Astrology (Kundli) Birth Chart | `!kundli` | Full chart + report | PDF + interactive HTML |
| Answer Follow-Up Questions on an Existing Chart | `!kundli_followup` | Resume session, answer 2 Qs | precise text answers |

Both compute planetary positions with the **Swiss Ephemeris** (sidereal zodiac,
Lahiri ayanamsa, whole-sign houses) — never guessed or hard-coded. The follow-up
playbook reuses the original session's chart and produces no new report.

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
│     ├─ index.astro           # first-timer landing + form ($2100)
│     ├─ returning.astro       # returning-user form ($1100)
│     ├─ success.astro         # post-payment status/polling page
│     └─ api/
│        ├─ checkout/new.ts      # start $2100 checkout
│        ├─ checkout/followup.ts # start $1100 checkout
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
| `PRICE_KUNDLI_USD` / `PRICE_FOLLOWUP_USD` | prices in dollars (default 2100 / 1100) |
| `PUBLIC_SITE_URL` | site URL for Stripe redirects |
| `DEVIN_API_KEY` | Devin API key (server only) |
| `DEVIN_KUNDLI_PLAYBOOK` / `DEVIN_FOLLOWUP_PLAYBOOK` | playbook ids |
| `REFERENCE_SECRET` | base64 of 32 random bytes — reference encryption key |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | Stripe keys |
| `RESEND_API_KEY` / `EMAIL_FROM` | email delivery |

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
| Full Kundli (`!kundli`) | **$2,100** | compute-heavy session | high once ACU/report is measured |
| Follow-up 2 Qs (`!kundli_followup`) | **$1,100** | resumes session, lighter | very high |

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
