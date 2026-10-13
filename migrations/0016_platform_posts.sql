-- Platform blog posts + current API pricing in the developer posts.
INSERT INTO blog_posts (id, slug, title, summary, cover_url, body, status, created_at, updated_at, published_at) VALUES ('e135cbc9-2092-545c-b52f-a45ae7f65039', 'meet-kaal-ai-vedic-astrologer', 'Meet Kaal, Kaalera''s AI Vedic astrologer', 'What Kaal is, what you can ask, and what you get back: dated predictions, the main issue in your Kundli and simple remedies, in your own language.', NULL, '**Kaal** is Kaalera''s AI Vedic astrologer. You give your birth date, time and place, ask a question about your life, and Kaal reads your Kundli and answers.

## What you can ask
- **Career:** when will my career grow, is a job change coming?
- **Marriage and love:** when will I get married, is this relationship right?
- **Money, health, family, travel and property.**
- **The past:** why was last year so hard? Kaal can explain which period you were in.

## What you get back
- **Predictions with dates:** windows like "Mar 2027 – Nov 2027", not a vague "soon".
- **The issue:** one plain line on what in your Kundli is behind it.
- **Remedies:** one or two simple ones, such as a mantra and its day, a fast or a charity.
- **What to ask next:** follow-up questions picked for you.

## Your Kundli, shown up front
Before the first answer, Kaal shows your **exact Kundli card**: ascendant with degree, Moon sign, nakshatra and pada, Sun sign, and your current dasha period with its end date. Compare it with your family Kundli. See [Kaal vs ChatGPT](/kaal-vs-chatgpt) for why exact values matter.

## In your language
Kaal answers in English by default, and in the language you choose.

## Price
Your first question is free. After that, a consultation is **$11.50** and each extra question **$8.05**, taxes & fees included. No subscription.

[Ask Kaal now](/)', 'published', '2026-10-13T12:00:00.000Z', '2026-10-13T12:00:00.000Z', '2026-10-13T12:00:00.000Z') ON CONFLICT(slug) DO NOTHING;
INSERT INTO blog_posts (id, slug, title, summary, cover_url, body, status, created_at, updated_at, published_at) VALUES ('8d05eda0-c2ab-54af-ae93-eaf0256b4253', 'how-kaal-reads-your-kundli', 'How Kaal reads your Kundli, step by step', 'From your birth details to dated predictions: the exact Kundli, the dasha periods, the transits ahead and the past events Kaal checks first.', NULL, 'Here is what happens between your question and Kaal''s answer.

## 1. Your exact Kundli
Kaal starts from your **birth date, local time and place**. It works out your Kundli exactly, the Vedic way (sidereal, Lahiri ayanamsa, whole-sign houses): your **Lagna**, the nine grahas, the twelve houses and your **nakshatra**. Nothing is guessed. That is why [your birth time matters](/blog/why-exact-birth-time-matters).

## 2. Your dasha periods
Vedic astrology times life events with the **Vimshottari dasha** periods. Kaal reads your current mahadasha and antardasha and when each one ends. See [Mahadasha explained](/blog/mahadasha-explained).

## 3. The sky ahead
Kaal checks where the slow planets, like Saturn, Jupiter, Rahu and Ketu, will move through your houses in the coming years.

## 4. Past events
For timing questions, Kaal may point to a past period ("around mid-2021 you likely changed jobs or cities") so you can see whether the reading fits your life.

## 5. Your answer
You get **dated predictions**, the main **issue**, and one or two **remedies**, in plain words. You can tap **Remind me** on any dated window and Kaal will email you when it opens.

## What Kaal will not do
Kaal does not predict death or guarantee events. For health, legal or money decisions, astrology complements professional advice; it does not replace it.

[Get your free first answer](/)', 'published', '2026-10-13T12:01:00.000Z', '2026-10-13T12:01:00.000Z', '2026-10-13T12:01:00.000Z') ON CONFLICT(slug) DO NOTHING;
INSERT INTO blog_posts (id, slug, title, summary, cover_url, body, status, created_at, updated_at, published_at) VALUES ('1c0c36d4-f9b8-5489-8a3a-016a9838c069', 'kaalera-api-pricing', 'Kaalera API: what you get and what it costs', 'Add Kaal''s AI Vedic astrology to your app. What the API returns, Business & API pricing 10% below the website, and how the prepaid USD wallet works.', NULL, 'The **Kaalera API** lets businesses and developers add Kaal, our AI Vedic astrologer, to their own app, website or chatbot.

## What you get
- **Consultations:** send a person''s birth date, time and place with a question. Kaal answers with dated predictions, the main issue and remedies.
- **Follow-ups:** keep asking in the same consultation, which is ideal for a chat screen.
- **Your users'' language:** answers in the language you choose.
- **One Bearer key** (`kal_live_...`) from your [Developers dashboard](/developers).

## Pricing
Business & API pricing is always **10% below our website prices**, in USD, taxes & fees included:

| | Website | Business & API |
|---|---|---|
| Start a consultation | $11.50 | **$10.35** |
| Each follow-up question | $8.05 | **$7.25** |

## The prepaid wallet
- Your first recharge is **$115** (taxes & fees included). It unlocks your API keys.
- Recharge options are $115, $287.50 and $575.
- Every call is paid from the wallet. **There are no free or test API calls.** Once your wallet has money in it, you can try the API straight away.
- Auto-recharge tops your wallet up when it runs low, so your app never stops.

## Start
1. Sign in at [Developers](/developers) and recharge.
2. Create a key.
3. Follow the [quickstart](/docs/quickstart).

More: [Astrology API for apps](/astrology-api) · [Use cases](/blog/astrology-api-use-cases)', 'published', '2026-10-13T12:02:00.000Z', '2026-10-13T12:02:00.000Z', '2026-10-13T12:02:00.000Z') ON CONFLICT(slug) DO NOTHING;
INSERT INTO blog_posts (id, slug, title, summary, cover_url, body, status, created_at, updated_at, published_at) VALUES ('dbf0be30-d657-5abe-ba18-1826b1c0d2d4', 'family-kundlis-and-reminders', 'One account for the whole family: saved Kundlis and reminders', 'Save Kundlis for your partner, children and parents, switch between them, ask about anyone mid-consultation, and get an email when a predicted window opens.', NULL, 'Most people don''t only ask about themselves. Kaalera is built for families.

## Save every Kundli once
Add the birth details of your partner, children and parents. Each one is saved to your account, so you never type them again. A newborn can be added without a name.

## Switch in one tap
Pick whose Kundli Kaal should read before you ask. Each consultation stays tied to that person.

## Ask about someone else mid-consultation
Talking about your marriage and want to check your partner''s side? Choose "Asking about" and Kaal reads their saved Kundli too, in the same consultation.

## Remind me
Every dated window in Kaal''s answer has a **Remind me** button. Tap it and Kaal emails you on the day the window opens, for example "your career window opens this month", so you can ask what to do next.

## Private by default
Your Kundlis and consultations are private to your account. We don''t sell your details.

[Add your family''s Kundlis](/)', 'published', '2026-10-13T12:03:00.000Z', '2026-10-13T12:03:00.000Z', '2026-10-13T12:03:00.000Z') ON CONFLICT(slug) DO NOTHING;
UPDATE blog_posts SET summary = 'A step-by-step guide to adding an AI Vedic astrologer to your app with the Kaalera API: keys, wallet, consultations and follow-ups, with real code.', body = 'Want an astrology chat inside your own app, without building an astrology engine or prompt pipeline? The **Kaalera API** gives you **Kaal**, an AI Vedic astrologer, over simple REST calls.

## How it fits together
**Your app → Kaalera API → Kaal → answer back to your app.** You send birth details and a question; Kaalera computes the Kundli, Kaal writes the reading, and you poll for the answer.

## 1. Get an API key
Sign in at [kaalera.com/developers](/developers) and create a key. It starts with `kal_live_` and is shown once — keep it on your server.

## 2. Recharge your wallet
The API is prepaid from a USD wallet, at Business & API prices 10% below the website: **$10.35** to start a consultation and **$7.25** per follow-up, taxes & fees included. Your first recharge must be at least **$115** (incl. taxes & fees), which activates your keys. There are no free or test API calls.

## 3. Start a consultation
```bash
curl -X POST https://kaalera.com/v1/consultations \
  -H "Authorization: Bearer $KAALERA_API_KEY" \
  -H "Content-Type: application/json" \
  -d ''{"fullName":"Asha Verma","gender":"Female","dateOfBirth":"2 Sep 1990",
       "timeOfBirth":"5:24 PM","placeOfBirth":"Jaipur, Rajasthan, India",
       "timezone":"Asia/Kolkata","latitude":26.9124,"longitude":75.7873,
       "question":"When is a good window for a career change?"}''
```
The response contains the consultation `id`.

## 4. Poll for the answer
```js
const res = await fetch(`https://kaalera.com/v1/consultations/${id}`, {
  headers: { Authorization: `Bearer ${process.env.KAALERA_API_KEY}` },
});
const { consultation } = await res.json();
// consultation.messages holds the user and kaal messages (Markdown)
```
Polling is free. Show Kaal''s Markdown in your chat UI.

## 5. Ask follow-ups
`POST /v1/consultations/:id/questions` with `{"question": "..."}`. Kaal remembers the Kundli and earlier answers.

## Tips
- Keep the key server-side; call the API from your backend.
- Pass `language` (for example `Hindi` or `Hinglish`) to answer in your users'' language.
- Kaal''s answers end with suggested next questions — show them as tappable chips to drive engagement.

Full reference: [API docs](/docs) · [Quickstart](/docs/quickstart).', updated_at = '2026-10-13T12:00:00.000Z' WHERE slug = 'build-ai-astrology-app-kaalera-api' AND body = 'Want an astrology chat inside your own app, without building an astrology engine or prompt pipeline? The **Kaalera API** gives you **Kaal**, an AI Vedic astrologer, over simple REST calls.

## How it fits together
**Your app → Kaalera API → Kaal → answer back to your app.** You send birth details and a question; Kaalera computes the Kundli, Kaal writes the reading, and you poll for the answer.

## 1. Get an API key
Sign in at [kaalera.com/developers](/developers) and create a key. It starts with `kal_live_` and is shown once — keep it on your server.

## 2. Recharge credits
The API is prepaid, in USD. **1 credit = $5.** Starting a consultation uses **2 credits**; each follow-up uses **1**. Your first recharge must be at least **$50**, which activates your keys. There is no free or test API.

## 3. Start a consultation
```bash
curl -X POST https://kaalera.com/v1/consultations \
  -H "Authorization: Bearer $KAALERA_API_KEY" \
  -H "Content-Type: application/json" \
  -d ''{"fullName":"Asha Verma","gender":"Female","dateOfBirth":"2 Sep 1990",
       "timeOfBirth":"5:24 PM","placeOfBirth":"Jaipur, Rajasthan, India",
       "timezone":"Asia/Kolkata","latitude":26.9124,"longitude":75.7873,
       "question":"When is a good window for a career change?"}''
```
The response contains the consultation `id`.

## 4. Poll for the answer
```js
const res = await fetch(`https://kaalera.com/v1/consultations/${id}`, {
  headers: { Authorization: `Bearer ${process.env.KAALERA_API_KEY}` },
});
const { consultation } = await res.json();
// consultation.messages holds the user and kaal messages (Markdown)
```
Polling is free. Show Kaal''s Markdown in your chat UI.

## 5. Ask follow-ups
`POST /v1/consultations/:id/questions` with `{"question": "..."}`. Kaal remembers the Kundli and earlier answers.

## Tips
- Keep the key server-side; call the API from your backend.
- Pass `language` (for example `Hindi` or `Hinglish`) to answer in your users'' language.
- Kaal''s answers end with suggested next questions — show them as tappable chips to drive engagement.

Full reference: [API docs](/docs) · [Quickstart](/docs/quickstart).';
UPDATE blog_posts SET summary = 'How to add a personalised astrology chatbot to your product with the Kaalera API, and why it beats generic daily horoscopes.', body = 'Daily sun-sign horoscopes are the same for millions of people. A **personal astrology chatbot** answers each user from their own birth details — that is what keeps them coming back.

## What you get with Kaalera
- **Kaal**, an AI Vedic astrologer, behind a REST API.
- Answers with **dated predictions**, a short issue line, remedies and suggested next questions.
- Many languages, including English, Hindi and Hinglish.
- Prepaid USD wallet, 10% below website prices: $10.35 to start a consultation, $7.25 per follow-up (taxes & fees included).

## Architecture
1. Your app collects name, date, time and place of birth.
2. Your **backend** calls `POST /v1/consultations` with your API key.
3. Poll `GET /v1/consultations/:id` and stream Kaal''s Markdown into your chat UI.
4. Send follow-ups with `POST /v1/consultations/:id/questions`.

Keep your key on the server — never in the browser or mobile app bundle.

## Monetise it
Charge your users per question or by subscription, and show Kaal''s suggested next questions as buttons.

Start here: [Developers](/developers) · [Quickstart](/docs/quickstart) · [Build guide](/blog/build-ai-astrology-app-kaalera-api).', updated_at = '2026-10-13T12:00:00.000Z' WHERE slug = 'add-horoscope-chatbot-to-your-app' AND body = 'Daily sun-sign horoscopes are the same for millions of people. A **personal astrology chatbot** answers each user from their own birth details — that is what keeps them coming back.

## What you get with Kaalera
- **Kaal**, an AI Vedic astrologer, behind a REST API.
- Answers with **dated predictions**, a short issue line, remedies and suggested next questions.
- Many languages, including English, Hindi and Hinglish.
- Prepaid USD credits: 1 credit = $5; a new consultation uses 2, each follow-up 1.

## Architecture
1. Your app collects name, date, time and place of birth.
2. Your **backend** calls `POST /v1/consultations` with your API key.
3. Poll `GET /v1/consultations/:id` and stream Kaal''s Markdown into your chat UI.
4. Send follow-ups with `POST /v1/consultations/:id/questions`.

Keep your key on the server — never in the browser or mobile app bundle.

## Monetise it
Charge your users per question or by subscription, and show Kaal''s suggested next questions as buttons.

Start here: [Developers](/developers) · [Quickstart](/docs/quickstart) · [Build guide](/blog/build-ai-astrology-app-kaalera-api).';
UPDATE blog_posts SET summary = 'Where an AI astrology agent API fits: matrimony and dating, wellness and meditation, horoscope and spiritual apps, and community products.', body = 'An **AI astrology agent API** lets any product offer personal readings without hiring astrologers or building an astrology engine. Here is where it fits best.

## Matrimony and dating
- Marriage timing questions for each member.
- Compatibility conversations using both partners'' details.
- Manglik dosha explanations in plain language.

## Wellness and meditation
- Monthly guidance on stressful periods and good windows to start new habits.
- Simple remedies such as mantras and fasting days.

## Horoscope and spiritual apps
- Replace generic daily horoscopes with personal, dated answers.
- Offer paid follow-up questions as an upsell.

## Communities and creators
- Astrology Q&A for your members in Hindi, Hinglish or English.

## Why Kaalera
- One REST API: create a consultation, poll, ask follow-ups.
- Prepaid USD wallet, 10% below website prices: $10.35 to start a consultation, $7.25 per follow-up (taxes & fees included).
- No political or religious debate; health, legal and money questions carry disclaimers.

See [Developers](/developers) and the [API docs](/docs).', updated_at = '2026-10-13T12:00:00.000Z' WHERE slug = 'astrology-api-use-cases' AND body = 'An **AI astrology agent API** lets any product offer personal readings without hiring astrologers or building an astrology engine. Here is where it fits best.

## Matrimony and dating
- Marriage timing questions for each member.
- Compatibility conversations using both partners'' details.
- Manglik dosha explanations in plain language.

## Wellness and meditation
- Monthly guidance on stressful periods and good windows to start new habits.
- Simple remedies such as mantras and fasting days.

## Horoscope and spiritual apps
- Replace generic daily horoscopes with personal, dated answers.
- Offer paid follow-up questions as an upsell.

## Communities and creators
- Astrology Q&A for your members in Hindi, Hinglish or English.

## Why Kaalera
- One REST API: create a consultation, poll, ask follow-ups.
- Prepaid USD credits: $5 per credit, 2 to start a consultation, 1 per follow-up.
- No political or religious debate; health, legal and money questions carry disclaimers.

See [Developers](/developers) and the [API docs](/docs).';
