# Ask Pandit ji — sample app

Standalone sample of a paid, Devin-powered Vedic astrology chat.

- Customer signs in (demo: email only; a new account gets `CHAT_FREE_CREDITS` questions).
- Saves a birth profile → the server computes the chart with Swiss Ephemeris (WASM, sidereal/Lahiri,
  whole-sign) + Vimshottari antardashas + 36 months of Jupiter/Saturn/Rahu sign changes.
- One Devin session per profile acts as the astrologer: opening reading, then free-form past/future
  questions with timing and explanation. 1 credit per message; refunded if delivery fails.
- Devin sessions are created with `secret_ids: []`, `knowledge_ids: []` and an ACU cap; customer text
  is wrapped as untrusted input.

## Run

```bash
npm install
DEVIN_API_KEY=... DEVIN_ORG_ID=... npm start   # http://localhost:8787
```

Optional env: `PORT`, `CHAT_FREE_CREDITS` (3), `CHAT_MAX_ACU_PER_SESSION` (20), `CHAT_MAX_MESSAGE_CHARS` (600),
`DEVIN_CHAT_PLAYBOOK`, `DEVIN_CHAT_MODE`, `DB_FILE` (`data/db.json`).

## Layout

- `src/server.ts` — Hono API + static UI
- `src/chat.ts` — credit ledger, threads, Devin bridge (create / deliver / sync replies)
- `src/devin.ts` — Devin v3 API client and the astrologer prompt
- `src/kundli/` + `src/engine/` — chart computation (Swiss Ephemeris WASM)
- `src/store.ts` — JSON-file store (swap for Postgres/D1)
- `public/` + `src/web/app.ts` — UI

"Buy" buttons are a demo checkout that grants credits instantly; swap in Stripe Checkout + webhook.
