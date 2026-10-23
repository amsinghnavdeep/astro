POSTS = [
("build-ai-astrology-app-kaalera-api", "How to build an AI astrology app with the Kaalera API",
 "A step-by-step guide to adding an AI astrologer to your app with the Kaalera API: keys, wallet, consultations and follow-ups, with real code.",
"""Want an astrology chat inside your own app, without building an astrology engine or prompt pipeline? The **Kaalera API** gives you **Kaal**, an AI astrologer, over simple REST calls.

## How it fits together
**Your app → Kaalera API → Kaal → answer back to your app.** You send birth details and a question; Kaalera computes the Kundli, Kaal writes the reading, and you poll for the answer.

## 1. Get an API key
Sign in at [kaalera.com/developers](/developers) and create a key. It starts with `kal_live_` and is shown once — keep it on your server.

## 2. Recharge your wallet
The API is prepaid from a USD wallet, at Business & API base prices 10% below the website: **$9 + taxes & fees** to start a consultation and **$6.30 + taxes & fees** per follow-up. Your first recharge must be at least **$100 + taxes & fees**, which activates your keys. There are no free or test API calls.

## 3. Start a consultation
```bash
curl -X POST https://kaalera.com/v1/consultations \\
  -H "Authorization: Bearer $KAALERA_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"fullName":"Asha Verma","gender":"Female","dateOfBirth":"2 Sep 1990",
       "timeOfBirth":"5:24 PM","placeOfBirth":"Jaipur, Rajasthan, India",
       "timezone":"Asia/Kolkata","latitude":26.9124,"longitude":75.7873,
       "question":"When is a good window for a career change?"}'
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
Polling is free. Show Kaal's Markdown in your chat UI.

## 5. Ask follow-ups
`POST /v1/consultations/:id/questions` with `{"question": "..."}`. Kaal remembers the Kundli and earlier answers.

## Tips
- Keep the key server-side; call the API from your backend.
- Pass `language` (for example `Hindi` or `Hinglish`) to answer in your users' language.
- Kaal's answers end with suggested next questions — show them as tappable chips to drive engagement.

Full reference: [API docs](/docs) · [Quickstart](/docs/quickstart)."""),
("ai-astrologer-vs-human-astrologer", "AI astrologer vs human astrologer: what’s different",
 "An honest comparison of AI and human astrologers: speed, cost, consistency, depth and when you might want each.",
"""Both an AI astrologer and a human one start from the same thing: your Kundli. The difference is in how the reading is delivered.

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

Try it yourself: [ask Kaal](/ai-astrologer) — Personal plans include 7 days free and 2 consultations."""),
("how-accurate-is-ai-astrology", "How accurate is AI astrology? An honest answer",
 "What AI astrology gets right, where its limits are, and how to judge any astrologer’s accuracy for yourself.",
"""People ask us this a lot, so here is a straight answer.

## What is exact
The **calculations** are exact: planet positions, ascendant, nakshatras and dasha dates come from astronomical formulas. Given the right birth time, an AI computes them as precisely as any software an astrologer uses.

## What is interpretation
Turning those positions into predictions is **interpretation**, based on classical rules. That is true for human and AI astrologers alike. No astrologer — human or AI — can guarantee that an event will happen.

## What affects accuracy most
1. **Birth time.** A wrong time can shift houses and dasha dates. See [why birth time matters](/blog/why-exact-birth-time-matters).
2. **The question.** “When will I change jobs?” gets a sharper answer than “Will my life be good?”.
3. **Free will and circumstances.** Astrology shows tendencies and timing, not fixed fate.

## How to judge it yourself
Kaal points out likely **past** turning points. Check them against your own life. If the past matches, you can weigh the future windows with more confidence.

Kaal's readings are guidance for reflection only, not medical, legal or financial advice. [Try a free question](/ai-astrologer)."""),
("best-questions-to-ask-an-astrologer", "Best questions to ask an astrologer",
 "Get sharper predictions by asking specific, time-bound questions. Examples for career, marriage, money, health and family.",
"""The quality of an answer depends on the question. Specific, time-bound questions get the clearest predictions.

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

[See Personal plans](/ai-astrologer)."""),
("add-horoscope-chatbot-to-your-app", "Add a horoscope chatbot to your website or app",
 "How to add a personalised astrology chatbot to your product with the Kaalera API, and why it beats generic daily horoscopes.",
"""Daily sun-sign horoscopes are the same for millions of people. A **personal astrology chatbot** answers each user from their own birth details — that is what keeps them coming back.

## What you get with Kaalera
- **Kaal**, an AI astrologer, behind a REST API.
- Answers with **dated predictions**, a short issue line, remedies and suggested next questions.
- Many languages, including English, Hindi and Hinglish.
- Prepaid USD wallet, 10% below website base prices: $9 + taxes & fees to start a consultation, $6.30 + taxes & fees per follow-up.

## Architecture
1. Your app collects name, date, time and place of birth.
2. Your **backend** calls `POST /v1/consultations` with your API key.
3. Poll `GET /v1/consultations/:id` and stream Kaal's Markdown into your chat UI.
4. Send follow-ups with `POST /v1/consultations/:id/questions`.

Keep your key on the server — never in the browser or mobile app bundle.

## Monetise it
Charge your users per question or by subscription, and show Kaal's suggested next questions as buttons.

Start here: [Developers](/developers) · [Quickstart](/docs/quickstart) · [Build guide](/blog/build-ai-astrology-app-kaalera-api)."""),
("astrology-api-use-cases", "Astrology API use cases: dating, wellness and matrimony apps",
 "Where an AI astrology agent API fits: matrimony and dating, wellness and meditation, horoscope and spiritual apps, and community products.",
"""An **AI astrology agent API** lets any product offer personal readings without hiring astrologers or building an astrology engine. Here is where it fits best.

## Matrimony and dating
- Marriage timing questions for each member.
- Compatibility conversations using both partners' details.
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
- Prepaid USD wallet, 10% below website base prices: $9 + taxes & fees to start a consultation, $6.30 + taxes & fees per follow-up.
- No political or religious debate; health, legal and money questions carry disclaimers.

See [Developers](/developers) and the [API docs](/docs)."""),
]
