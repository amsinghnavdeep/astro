-- Starter blog posts (editable or removable in /admin).
INSERT INTO blog_posts (id, slug, title, summary, cover_url, body, status, created_at, updated_at, published_at) VALUES ('2118b3d5-b9ed-50ae-a243-5f491adc58f8', 'what-is-a-kundli', 'What is a Kundli, and what can it tell you?', 'A plain-English guide to the Janam Kundli: the ascendant, Moon sign, nakshatra, houses and dashas, and what they can and cannot tell you.', NULL, 'A **Kundli** (also called Janam Kundli or Janam Patri) is a snapshot of the sky at the exact minute and place you were born, drawn the Vedic way. Astrologers use it to describe your nature and to time the main events of your life.

## The building blocks
- **Lagna (ascendant):** the sign rising on the eastern horizon at birth. It sets the order of the twelve houses and changes about every two hours, which is why birth time matters.
- **Moon sign (Rashi) and nakshatra:** where the Moon was. The Moon moves fast, so it is central to Vedic readings and to Sade Sati.
- **Nine grahas:** Sun, Moon, Mars, Mercury, Jupiter, Venus, Saturn, Rahu and Ketu.
- **Twelve houses:** each rules an area of life — the 7th partnership, the 10th career, the 2nd and 11th money, and so on.
- **Dashas:** planetary periods that time *when* things happen. See [Mahadasha explained](/blog/mahadasha-explained).

## What it can tell you
- Your strengths, tendencies and the areas of life that need care.
- Likely **windows** for marriage, career moves, travel or property.
- Which periods are heavier and what simple remedies are traditionally used.

## What it cannot do
It cannot guarantee events or replace your own choices, and it is not medical, legal or financial advice.

## Try it
[Make your free Kundli](/kundli) and ask Kaal one question free.', 'published', '2026-09-28T09:00:00.000Z', '2026-09-28T09:00:00.000Z', '2026-09-28T09:00:00.000Z') ON CONFLICT(slug) DO NOTHING;
INSERT INTO blog_posts (id, slug, title, summary, cover_url, body, status, created_at, updated_at, published_at) VALUES ('3965a610-8354-5ac5-94e1-64ff412e545b', 'sade-sati-explained', 'Sade Sati: Saturn’s 7.5 years explained', 'What Sade Sati really is, its three phases, why it is not always bad, and simple traditional remedies.', NULL, '**Sade Sati** means “seven and a half”. It is the period when **Saturn** moves through three signs in a row: the sign before your Moon sign, your Moon sign, and the sign after it. Saturn takes about 2½ years per sign, so the whole period lasts about 7½ years, and it returns roughly every 30 years.

## The three phases
1. **Rising phase** (Saturn 12th from the Moon): more expenses, travel or distance from home, restless sleep.
2. **Peak phase** (Saturn over the Moon): emotional pressure, heavier responsibilities, health needs attention.
3. **Setting phase** (Saturn 2nd from the Moon): money and family matters, then gradual relief.

## Is Sade Sati always bad?
No. Saturn rewards patience and hard work. If Saturn is well placed in your Kundli, or a supportive dasha is running, Sade Sati can bring a promotion, a home or a settled life — just through effort. It feels hardest when Saturn is weak or the dasha is also difficult.

## Related periods
- **Dhaiya (small panoti):** 2½ years when Saturn is 4th or 8th from the Moon.

## Simple traditional remedies
- Keep Saturdays disciplined: punctual, honest work.
- Serve elders, workers or the needy.
- Hanuman Chalisa or Shani prayers on Saturdays.

Want to know if it is running for you and when it ends? Use the [Sade Sati check](/sade-sati).', 'published', '2026-09-29T09:00:00.000Z', '2026-09-29T09:00:00.000Z', '2026-09-29T09:00:00.000Z') ON CONFLICT(slug) DO NOTHING;
INSERT INTO blog_posts (id, slug, title, summary, cover_url, body, status, created_at, updated_at, published_at) VALUES ('9b586e76-60f4-5ecf-b0de-3eec8169919b', 'mahadasha-explained', 'Mahadasha: why life changes in phases', 'How the 120-year Vimshottari dasha system times the chapters of your life, and how to read your current period.', NULL, 'Ever noticed that life seems to move in chapters? Vedic astrology explains this with **dashas** — planetary periods that decide which planet''s results come forward at each stage of life.

## The Vimshottari system
The most widely used system is **Vimshottari**, a 120-year cycle. The starting planet depends on the nakshatra of your Moon at birth. The periods are:

| Planet | Years |
|---|---|
| Ketu | 7 |
| Venus | 20 |
| Sun | 6 |
| Moon | 10 |
| Mars | 7 |
| Rahu | 18 |
| Jupiter | 16 |
| Saturn | 19 |
| Mercury | 17 |

## Mahadasha, antardasha, pratyantar
Each **mahadasha** (major period) is split into nine **antardashas** (sub-periods), and those into smaller **pratyantar dashas**. Big events usually line up when the mahadasha, antardasha and transits all point the same way.

## How to read your current dasha
- What houses does the dasha planet rule and sit in? Those areas come forward.
- Is the planet strong or weak? That shapes whether results come easily or through effort.
- The change from one mahadasha to the next is often felt as a turning point.

Kaal checks your running dasha for every question — [ask Kaal](/ai-astrologer) what your current period brings.', 'published', '2026-09-30T09:00:00.000Z', '2026-09-30T09:00:00.000Z', '2026-09-30T09:00:00.000Z') ON CONFLICT(slug) DO NOTHING;
INSERT INTO blog_posts (id, slug, title, summary, cover_url, body, status, created_at, updated_at, published_at) VALUES ('e68e6ad6-68b6-584c-ae3d-e201c80c0c4b', 'rahu-ketu-shadow-planets', 'Rahu and Ketu: the shadow planets', 'What Rahu and Ketu are, why they always sit opposite each other, their 18-month transits, and how they show desire and detachment.', NULL, '**Rahu** and **Ketu** are not physical planets. They are the two points where the Moon''s path crosses the Sun''s path — the **lunar nodes**. Eclipses happen near them, which is why they are called shadow planets.

## Key facts
- They are always exactly **opposite** each other.
- They move **backwards** through the zodiac and change sign about every **18 months**.
- A full cycle through all twelve signs takes about **18½ years**.

## What they represent
- **Rahu:** desire, ambition, the foreign and the new, obsession, sudden rises.
- **Ketu:** detachment, past skills, spirituality, sudden endings or losses.

The house Rahu sits in shows where you are hungry to grow; the house Ketu sits in shows what comes naturally but may feel empty.

## Rahu and Ketu dashas
Rahu mahadasha lasts 18 years and Ketu 7 years. Rahu periods often bring big changes, foreign links and fast growth with some confusion; Ketu periods turn people inward.

## Simple traditional remedies
- For Rahu: Durga or Saraswati prayers, avoiding shortcuts and intoxicants.
- For Ketu: Ganesha prayers, meditation, helping animals.

Kaal reads where your nodes sit and what they mean for you — [ask Kaal](/ai-astrologer).', 'published', '2026-10-01T09:00:00.000Z', '2026-10-01T09:00:00.000Z', '2026-10-01T09:00:00.000Z') ON CONFLICT(slug) DO NOTHING;
INSERT INTO blog_posts (id, slug, title, summary, cover_url, body, status, created_at, updated_at, published_at) VALUES ('28c736ec-a9d0-5e65-bc64-503a27fcbdf4', 'manglik-dosha-marriage', 'Manglik dosha: what it really means for marriage', 'How Manglik dosha is defined, why it is so common, the classical cancellations, and calm, practical remedies.', NULL, 'Few astrology words cause as much worry as **Manglik**. Here is what it actually means.

## The definition
Manglik (Mangal) dosha is said to be present when **Mars** is in the **1st, 2nd, 4th, 7th, 8th or 12th house**. Many astrologers count from the ascendant, and also check from the Moon and Venus. Mars is energetic and fiery; in houses linked to home and partnership it is associated with arguments or delays in marriage.

## Why it is so common
Six of the twelve houses qualify, so a large share of people have some form of it. Being Manglik does not mean your marriage will fail.

## Classical cancellations
Traditional texts list many cases where the dosha is cancelled or weakened, for example:
- Mars in its own sign (Aries, Scorpio) or exalted (Capricorn).
- Both partners being Manglik.
- Strong Jupiter or Venus influence.

## Practical remedies
- Hanuman Chalisa on Tuesdays.
- Mangal Shanti puja, if your family follows it.
- Most of all: patience and calm communication in the relationship.

Check yours with the [Manglik dosha check](/manglik-dosha), or read about [marriage prediction](/marriage-prediction).', 'published', '2026-10-02T09:00:00.000Z', '2026-10-02T09:00:00.000Z', '2026-10-02T09:00:00.000Z') ON CONFLICT(slug) DO NOTHING;
INSERT INTO blog_posts (id, slug, title, summary, cover_url, body, status, created_at, updated_at, published_at) VALUES ('f1ef8e0e-2da7-5c6d-80cc-52c0079a3e1c', 'why-exact-birth-time-matters', 'Why your exact birth time matters', 'How a few minutes of birth time can change your ascendant, houses and dasha dates, and what to do if you are unsure.', NULL, 'Your date and place of birth fix where the planets were. Your **time** of birth fixes how they are arranged around you.

## What depends on time
- **Ascendant (Lagna):** changes about every two hours, so a small error near a sign change shifts every house.
- **Houses:** the 7th (marriage), 10th (career) and others are counted from the ascendant.
- **Dasha dates:** the starting point comes from the Moon''s exact position, which moves about half a degree an hour. A large time error can move dasha dates by months.
- The **Navamsa (D9)** and other divisional readings are very time-sensitive.

## What stays the same
For an error of an hour or less, the Moon sign and the signs of most planets usually stay the same, so the broad picture holds.

## If you are not sure
1. Check your birth certificate or hospital record.
2. Ask a parent or relative who was there.
3. If you only know roughly (“early morning”), give your best guess. Kaal will tell you when a prediction depends on an exact time.

Ready? [Make your free Kundli](/kundli).', 'published', '2026-10-03T09:00:00.000Z', '2026-10-03T09:00:00.000Z', '2026-10-03T09:00:00.000Z') ON CONFLICT(slug) DO NOTHING;
INSERT INTO blog_posts (id, slug, title, summary, cover_url, body, status, created_at, updated_at, published_at) VALUES ('0b578bc3-0316-5f66-ae86-cfa4bf52754f', 'what-is-kaalera', 'What is Kaalera? Meet Kaal, the AI Vedic astrologer', 'Kaalera is an AI astrology service where Kaal, an AI Vedic astrologer, answers your questions with dated predictions and simple remedies.', NULL, '**Kaalera** is an AI astrology service. Its astrologer, **Kaal**, is an AI that reads your Vedic Kundli and answers your questions in a chat — about career, marriage, health, money, family or travel.

## What makes Kaal different
- **Dated predictions.** Instead of “good times are coming”, Kaal names windows such as “March to June 2027”.
- **Short answers.** A few dated points, one line on the main issue, and one or two simple remedies.
- **Past events.** Kaal can point out likely past turning points, so you can judge how well it reads you.
- **Your language.** English by default, plus Hindi, Hinglish and more.
- **Many Kundlis.** Save yours and your family''s and switch between them in the chat.

## How it works
1. Add your date, time and place of birth.
2. Ask a question.
3. Kaal works through your Kundli, dashas and the live sky, then replies.

## Pricing
Personal plans include 7 days free and 2 consultations. Extra consultations are available at pay-per-use prices.

## What Kaal will not do
No political or religious debate, and no medical, legal or financial advice — astrology is guidance, not a guarantee.

## For developers
Kaalera also has an **AI astrology agent API**, so you can put Kaal inside your own app. Read [how to build an AI astrology app with Kaalera](/blog/build-ai-astrology-app-kaalera-api).

[Ask Kaal your first question](/ai-astrologer).', 'published', '2026-10-04T09:00:00.000Z', '2026-10-04T09:00:00.000Z', '2026-10-04T09:00:00.000Z') ON CONFLICT(slug) DO NOTHING;
INSERT INTO blog_posts (id, slug, title, summary, cover_url, body, status, created_at, updated_at, published_at) VALUES ('082a298e-2420-5ab6-8c29-745a5535d929', 'build-ai-astrology-app-kaalera-api', 'How to build an AI astrology app with the Kaalera API', 'A step-by-step guide to adding an AI Vedic astrologer to your app with the Kaalera API: keys, credits, consultations and follow-ups, with real code.', NULL, 'Want an astrology chat inside your own app, without building an astrology engine or prompt pipeline? The **Kaalera API** gives you **Kaal**, an AI Vedic astrologer, over simple REST calls.

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

Full reference: [API docs](/docs) · [Quickstart](/docs/quickstart).', 'published', '2026-10-05T09:00:00.000Z', '2026-10-05T09:00:00.000Z', '2026-10-05T09:00:00.000Z') ON CONFLICT(slug) DO NOTHING;
INSERT INTO blog_posts (id, slug, title, summary, cover_url, body, status, created_at, updated_at, published_at) VALUES ('88e93891-6760-5972-a2e9-b08a0d876b39', 'ai-astrologer-vs-human-astrologer', 'AI astrologer vs human astrologer: what’s different', 'An honest comparison of AI and human astrologers: speed, cost, consistency, depth and when you might want each.', NULL, 'Both an AI astrologer and a human one start from the same thing: your Kundli. The difference is in how the reading is delivered.

## Where an AI astrologer helps
- **Speed and availability:** answers in minutes, at any hour.
- **Consistency:** the same calculations every time, no rushed sessions.
- **Dated answers:** Kaal is built to give month/year windows instead of vague statements.
- **Cost:** a question costs a few dollars, not a long paid session.
- **Privacy:** you can ask sensitive questions without speaking to anyone.

## Where a human astrologer helps
- Long, open-ended conversations and emotional support.
- Rituals and pujas performed in person.
- Traditions or methods a family has followed for generations.

## The honest bottom line
Astrology is guidance, not a guarantee, whoever reads it. Many people use an AI astrologer for quick, specific questions and a human astrologer for big ceremonies.

Try it yourself: [ask Kaal](/ai-astrologer) — Personal plans include 7 days free and 2 consultations.', 'published', '2026-10-06T09:00:00.000Z', '2026-10-06T09:00:00.000Z', '2026-10-06T09:00:00.000Z') ON CONFLICT(slug) DO NOTHING;
INSERT INTO blog_posts (id, slug, title, summary, cover_url, body, status, created_at, updated_at, published_at) VALUES ('4693a930-e4d8-5842-8fa1-594adcfa42ba', 'how-accurate-is-ai-astrology', 'How accurate is AI astrology? An honest answer', 'What AI astrology gets right, where its limits are, and how to judge any astrologer’s accuracy for yourself.', NULL, 'People ask us this a lot, so here is a straight answer.

## What is exact
The **calculations** are exact: planet positions, ascendant, nakshatras and dasha dates come from astronomical formulas. Given the right birth time, an AI computes them as precisely as any software an astrologer uses.

## What is interpretation
Turning those positions into predictions is **interpretation**, based on classical Vedic rules. That is true for human and AI astrologers alike. No astrologer — human or AI — can guarantee that an event will happen.

## What affects accuracy most
1. **Birth time.** A wrong time can shift houses and dasha dates. See [why birth time matters](/blog/why-exact-birth-time-matters).
2. **The question.** “When will I change jobs?” gets a sharper answer than “Will my life be good?”.
3. **Free will and circumstances.** Astrology shows tendencies and timing, not fixed fate.

## How to judge it yourself
Kaal points out likely **past** turning points. Check them against your own life. If the past matches, you can weigh the future windows with more confidence.

Kaal''s readings are guidance for reflection only, not medical, legal or financial advice. [Try a free question](/ai-astrologer).', 'published', '2026-10-07T09:00:00.000Z', '2026-10-07T09:00:00.000Z', '2026-10-07T09:00:00.000Z') ON CONFLICT(slug) DO NOTHING;
INSERT INTO blog_posts (id, slug, title, summary, cover_url, body, status, created_at, updated_at, published_at) VALUES ('be414935-d2fc-5656-bcd9-06d733b32ecc', 'best-questions-to-ask-an-astrologer', 'Best questions to ask an astrologer', 'Get sharper predictions by asking specific, time-bound questions. Examples for career, marriage, money, health and family.', NULL, 'The quality of an answer depends on the question. Specific, time-bound questions get the clearest predictions.

## Career
- When is the best window to change jobs in the next two years?
- Is a promotion likely this year, and in which months?
- Job or business — which suits me better right now?
- Is there a chance of working abroad?

## Marriage and relationships
- When is marriage most likely for me?
- Will my current relationship lead to marriage?
- Is Manglik dosha a problem in my case? ([check it](/manglik-dosha))

## Money and property
- When is a good time to buy a house?
- Which period brings the strongest income growth?

## Health and family
- Which months need extra care for health? (Always see a doctor for medical issues.)
- When is a good time to plan a child?

## Tips
- Ask one thing at a time.
- Give a time frame: “in the next 12 months”.
- Follow up on the window that matters most.

[See Personal plans](/ai-astrologer).', 'published', '2026-10-08T09:00:00.000Z', '2026-10-08T09:00:00.000Z', '2026-10-08T09:00:00.000Z') ON CONFLICT(slug) DO NOTHING;
INSERT INTO blog_posts (id, slug, title, summary, cover_url, body, status, created_at, updated_at, published_at) VALUES ('199ff92c-b263-583a-b105-97ddca73bd55', 'add-horoscope-chatbot-to-your-app', 'Add a horoscope chatbot to your website or app', 'How to add a personalised astrology chatbot to your product with the Kaalera API, and why it beats generic daily horoscopes.', NULL, 'Daily sun-sign horoscopes are the same for millions of people. A **personal astrology chatbot** answers each user from their own birth details — that is what keeps them coming back.

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

Start here: [Developers](/developers) · [Quickstart](/docs/quickstart) · [Build guide](/blog/build-ai-astrology-app-kaalera-api).', 'published', '2026-10-09T09:00:00.000Z', '2026-10-09T09:00:00.000Z', '2026-10-09T09:00:00.000Z') ON CONFLICT(slug) DO NOTHING;
INSERT INTO blog_posts (id, slug, title, summary, cover_url, body, status, created_at, updated_at, published_at) VALUES ('cf6f5378-a4af-5ee9-bb30-a4c1318df5eb', 'astrology-api-use-cases', 'Astrology API use cases: dating, wellness and matrimony apps', 'Where an AI astrology agent API fits: matrimony and dating, wellness and meditation, horoscope and spiritual apps, and community products.', NULL, 'An **AI astrology agent API** lets any product offer personal readings without hiring astrologers or building an astrology engine. Here is where it fits best.

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

See [Developers](/developers) and the [API docs](/docs).', 'published', '2026-10-10T09:00:00.000Z', '2026-10-10T09:00:00.000Z', '2026-10-10T09:00:00.000Z') ON CONFLICT(slug) DO NOTHING;
