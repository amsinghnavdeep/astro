/** Keyword landing pages: one main search term per page, server-rendered with FAQ data. */
import { renderMarkdown } from '../markdown.js';
import type { Post } from '../blog.js';
import { breadcrumbLd, ctaBlock, esc, faqLd, layout, organizationLd, TOPIC_LINKS } from './layout.js';

export interface Topic {
  slug: string;
  title: string;
  h1: string;
  description: string;
  kicker: string;
  body: string;
  faqs: [string, string][];
  posts: string[];
  cta?: [href: string, label: string];
}

export const TOPICS: Topic[] = [
  {
    slug: 'kundli',
    title: 'Free Kundli Online — Janam Kundli by Date of Birth | Kaalera',
    h1: 'Free Kundli online, read by an AI astrologer',
    kicker: 'Janam Kundli',
    description: 'Make your Janam Kundli free from your date, time and place of birth, then ask Kaal, an AI Vedic astrologer, for dated predictions and simple remedies.',
    body: `A **Kundli** (Janam Kundli or Janam Patri) is the Vedic map of the sky at the exact moment you were born. It records your **Lagna** (ascendant), the sign and **nakshatra** of your Moon, where each of the nine grahas sits across the twelve houses, and the **Vimshottari dasha** periods that time the chapters of your life.

## What Kaalera does with your Kundli
- Calculates it from your date, time and place of birth, using sidereal (Lahiri) positions.
- Lets you save several Kundlis — yours, your partner's, your children's — and switch between them.
- Kaal reads it and answers your question with **dated predictions**, one short line on the main issue, and one or two simple remedies.

## What you need
1. Date of birth.
2. Time of birth — as exact as possible (see [why birth time matters](/blog/why-exact-birth-time-matters)).
3. Place of birth.

Your first question is free.`,
    faqs: [
      ['Is the Kundli really free?', 'Yes. Creating and saving a Kundli is free, and your first question to Kaal is free. More questions are sold in small packs.'],
      ['What if I do not know my exact birth time?', 'Give the closest time you know. The Moon sign and most planet signs stay the same, but the ascendant and houses can change, so time-sensitive predictions become less precise.'],
      ['Which system does Kaalera use?', 'Vedic (sidereal) astrology with Lahiri ayanamsa, whole-sign houses and the Vimshottari dasha system.'],
    ],
    posts: ['what-is-a-kundli', 'why-exact-birth-time-matters', 'mahadasha-explained'],
  },
  {
    slug: 'marriage-prediction',
    title: 'Marriage Prediction by Date of Birth — When Will I Get Married? | Kaalera',
    h1: 'Marriage prediction by date of birth',
    kicker: 'When will I get married?',
    description: 'Ask Kaal when marriage is likely, from your date, time and place of birth. Dated windows from your 7th house, Venus, Jupiter and dasha periods, plus simple remedies.',
    body: `In Vedic astrology, marriage timing is read mainly from the **7th house** and its lord, **Venus** (the natural significator of partnership) and, traditionally for women, **Jupiter**. The timing itself comes from the **dasha** running at the time and from slow transits — especially Jupiter and Saturn — touching the 7th house, its lord or the Moon.

## What Kaal tells you
- The most likely **date windows** for marriage, not a vague "soon".
- One short line on what is delaying or helping it.
- One or two simple remedies.

## Common questions people ask Kaal
- When will I get married?
- Love or arranged marriage?
- Is my current relationship likely to lead to marriage?
- Is Manglik dosha a problem for me? (see [Manglik dosha](/manglik-dosha))`,
    faqs: [
      ['Can astrology tell the exact date of marriage?', 'No honest astrologer can promise an exact day. Kaal gives the most likely windows, usually a few months wide, based on dashas and transits.'],
      ['Does a late marriage mean something is wrong?', 'Not necessarily. Saturn influence on the 7th house often points to marriage after a delay, and often to a stable one.'],
      ['Can Kaal match two Kundlis?', 'Yes. Save both Kundlis and ask Kaal about compatibility.'],
    ],
    posts: ['manglik-dosha-marriage', 'what-is-a-kundli', 'best-questions-to-ask-an-astrologer'],
  },
  {
    slug: 'career-astrology',
    title: 'Career Prediction by Date of Birth — Job Astrology | Kaalera',
    h1: 'Career prediction and job astrology',
    kicker: 'Career astrology',
    description: 'Ask Kaal about job changes, promotions, business or study abroad. Dated career predictions from your 10th house, Saturn and dasha periods, with simple remedies.',
    body: `Career is read from the **10th house** (work and status), its lord, and planets that influence it. **Saturn** shows discipline and long-term work, the **Sun** authority and government, **Mercury** business and communication. Income is checked from the **2nd** and **11th** houses. The **dasha** and Saturn and Jupiter transits show *when* change is likely.

## What people ask Kaal
- When will I get a new job or promotion?
- Should I start a business or stay in a job?
- Is there a chance of working abroad?
- Which field suits me?

Kaal answers with dated windows, one line on the main block, and one or two simple remedies.`,
    faqs: [
      ['Can astrology tell me which career to choose?', 'It can show strengths and the kind of work that tends to suit you. Use it alongside your skills and interests, not instead of them.'],
      ['Is this financial advice?', 'No. Kaal gives astrological guidance only. For money or investment decisions, speak to a qualified professional.'],
      ['How far ahead can Kaal predict?', 'Kaal usually looks at the next few years and names the strongest windows.'],
    ],
    posts: ['mahadasha-explained', 'sade-sati-explained', 'how-accurate-is-ai-astrology'],
  },
  {
    slug: 'sade-sati',
    title: 'Sade Sati Check — Is Saturn’s 7.5 Years Running for You? | Kaalera',
    h1: 'Sade Sati check',
    kicker: 'Saturn’s 7½ years',
    description: 'Check whether Sade Sati is running for you, which phase you are in and when it ends. Kaal reads it from your Moon sign and gives simple remedies.',
    body: `**Sade Sati** is the roughly **7½-year** period when Saturn moves through the sign before your Moon sign, your Moon sign, and the sign after it. Saturn spends about 2½ years in each sign, so there are three phases. It comes around about every 30 years.

## The three phases
1. **Rising** — Saturn in the 12th from the Moon: expenses, sleep, distance from home.
2. **Peak** — Saturn over the Moon: pressure on the mind, health and responsibilities.
3. **Setting** — Saturn in the 2nd from the Moon: money and family matters, then easing.

Sade Sati is not automatically bad. Its effect depends on Saturn's strength in your Kundli and the dasha running. Many people build their most lasting results in it.

Ask Kaal whether it is running for you, which phase, the end date, and one or two remedies.`,
    faqs: [
      ['How do I know if Sade Sati is running?', 'It depends on your Moon sign, which needs your date, time and place of birth. Kaal checks it for you.'],
      ['What is Dhaiya (Ardh Sade Sati)?', 'A 2½-year Saturn period when it moves through the 4th or the 8th sign from your Moon.'],
      ['What are common remedies?', 'Traditional remedies include Saturday discipline, service to elders and workers, and Hanuman or Shani prayers. Kaal suggests one or two that fit you.'],
    ],
    posts: ['sade-sati-explained', 'mahadasha-explained', 'rahu-ketu-shadow-planets'],
  },
  {
    slug: 'manglik-dosha',
    title: 'Manglik Dosha Check — Am I Manglik? | Kaalera',
    h1: 'Manglik dosha check',
    kicker: 'Mangal dosha',
    description: 'Find out whether you are Manglik, how strong it is, whether it is cancelled, and what it means for marriage. Kaal checks it from your birth details.',
    body: `**Manglik (Mangal) dosha** is said to be present when **Mars** sits in the **1st, 2nd, 4th, 7th, 8th or 12th house**, counted from the ascendant (many astrologers also check from the Moon and Venus). These houses touch home, family and partnership, so Mars there is linked with friction in marriage.

## Why it is often less serious than people fear
- It is very common — a large share of people have Mars in one of these houses.
- Classical texts list many **cancellations**, for example Mars in its own or exalted sign, or the partner also being Manglik.
- Strength varies a lot from one person to another.

Ask Kaal whether you are Manglik, whether it is cancelled, and one or two remedies.`,
    faqs: [
      ['Can two Manglik people marry?', 'Yes. Traditionally, when both partners are Manglik the dosha is considered balanced.'],
      ['Does Manglik dosha end at 28?', 'Some traditions say its effect softens after about 28, the age linked with Mars maturing. It is a traditional view, not a fixed rule.'],
      ['What are common remedies?', 'Common traditional remedies include Hanuman prayers on Tuesdays and Mangal Shanti puja. Kaal suggests what fits your case.'],
    ],
    posts: ['manglik-dosha-marriage', 'what-is-a-kundli', 'best-questions-to-ask-an-astrologer'],
  },
  {
    slug: 'ai-astrologer',
    title: 'AI Astrologer — Ask an Astrologer Online, Astrology Chat | Kaalera',
    h1: 'Ask Kaal, the AI astrologer',
    kicker: 'AI astrology chat',
    description: 'Chat with Kaal, an AI Vedic astrologer, about career, marriage, health or money. Dated, to-the-point predictions with simple remedies. First question free.',
    body: `**Kaal** is Kaalera's AI Vedic astrologer. You add your birth details once, then chat like you would with an astrologer online — but answers come in minutes, any time of day, in your language.

## How it works
1. Add your date, time and place of birth.
2. Ask your question in English, Hindi, Hinglish or another language.
3. Kaal studies your Kundli, dashas and the current sky, then replies with dated predictions, one short issue line and one or two remedies.

## Why people use it
- **Dated answers** instead of vague statements.
- **Short and clear** — no long lectures.
- **Private** — your chats are only visible to you.
- Your **first question is free**, then small packs of questions.

Kaal does not give political or religious debate, and is not a substitute for medical, legal or financial advice.`,
    faqs: [
      ['Is an AI astrologer accurate?', 'Kaal uses the same calculations as a Vedic astrologer. Like any astrology, predictions are guidance, not guarantees. Read our honest take: How accurate is AI astrology?'],
      ['Which languages does Kaal answer in?', 'English by default, and also Hindi, Hinglish and several other languages you can pick in the chat.'],
      ['Is there an API for developers?', 'Yes. The Kaalera API lets you add Kaal to your own app. See the Developers page.'],
    ],
    posts: ['what-is-kaalera', 'ai-astrologer-vs-human-astrologer', 'how-accurate-is-ai-astrology'],
  },
  {
    slug: 'kaal-vs-chatgpt',
    title: 'Kaal vs ChatGPT for Vedic Astrology — Tested on 5 Birth Details | Kaalera',
    h1: 'Kaal vs ChatGPT: we tested 5 birth details',
    kicker: 'Honest test',
    description: 'We gave ChatGPT and Kaal the same 5 birth details and checked the ascendant, Moon sign, nakshatra and current dasha against an exact astronomical calculation.',
    body: `Anyone can paste their birth details into ChatGPT. So we tested what it gets right, using the same question for 5 people born in different cities and years.

## How we tested
- **Question, word for word:** "I was born on [date] at [time] (local time) in [city]. Using Vedic (sidereal, Lahiri) astrology, tell me my ascendant (lagna) with degree, Moon sign, Sun sign, birth nakshatra with pada, and my current Vimshottari mahadasha and antardasha with the date the mahadasha ends. Then: when will I get a better job?"
- **ChatGPT:** the free version at chatgpt.com, signed out, web search on, one try per person, on 13 October 2026.
- **Exact values:** calculated with the Swiss Ephemeris (sidereal, Lahiri). Kaal reads from this same calculation, so Kaal's values match it by design.

## Results
| Birth details | Exact value | ChatGPT said |
|---|---|---|
| 14 May 1990, 10:30, Delhi | Cancer 9° ascendant · Moon Sagittarius · Purva Ashadha 2 · **Mars–Moon until 23 Nov 2026** | Signs and nakshatra right, no ascendant degree · **said Rahu period had already started** |
| 2 Nov 1985, 06:15, Mumbai | Libra 9° ascendant · Moon Gemini · Mrigashira 3 · **Saturn–Mercury, Saturn until 17 Jan 2041** | Did not give any values; sent us to another calculator |
| 20 Feb 1995, 22:40, Toronto | Libra 4° ascendant · Moon Libra · Vishakha 1 · **Saturn–Rahu, Saturn until 22 Jan 2030** | Signs and nakshatra right · **main pick Mercury–Venus**, no end date |
| 8 Aug 1978, 14:05, London | Libra 20° ascendant · Moon Virgo · Hasta 1 · **Jupiter–Rahu, Jupiter until 4 Oct 2027** | Moon, Sun and nakshatra right, no ascendant · **said Jupiter ended in 2021, now Saturn–Mercury** |
| 25 Dec 2001, 03:30, Bengaluru | Libra 25° ascendant · Moon Aries · Ashwini 1 · **Venus–Mercury, Venus until 25 Dec 2027** | **Ascendant wrong (Taurus)** · rest right · Venus ends "about 2028" |

## Score across the 5
| Item | ChatGPT right | Wrong | Not given |
|---|---|---|---|
| Moon sign | 4 | 0 | 1 |
| Sun sign | 4 | 0 | 1 |
| Nakshatra and pada | 4 | 0 | 1 |
| Ascendant sign | 2 | 1 | 2 |
| Current mahadasha and antardasha | 1 | 3 | 1 |
| Exact mahadasha end date | 0 | 0 | 5 |

## What this means
- **ChatGPT is good at the Moon sign, Sun sign and nakshatra.** We won't pretend otherwise.
- **The ascendant and the dasha are where it slips.** It got the current period right for 1 person out of 5 and never gave an exact end date. Those are the parts that set the timing of a prediction: a period a few years off moves every date in the reading.
- **To its credit, ChatGPT said so.** It called its own degrees and dasha dates estimates and suggested checking them in a calculator.
- **Kaal starts from the exact numbers,** shows them in a Kundli card above the first answer, and gives dated windows from them.

## Limits of this test
- 5 people and one try each is a small test. Another ChatGPT version, a paid plan or a different prompt can give different results.
- This checks the calculation, not whether predictions come true. Astrology is guidance, not a guarantee.
- You can repeat it: ask ChatGPT the question above with your own details, then compare with the Kundli card Kaal shows you.`,
    faqs: [
      ['Can ChatGPT make a Kundli?', 'In our test it got the Moon sign, Sun sign and nakshatra right for 4 of 5 people, but the ascendant and the current dasha were often missing or wrong, and it gave no exact dasha end dates.'],
      ['Why does the dasha matter?', 'Vimshottari dasha periods set the timing in Vedic astrology. If the current period is wrong, the dates of every prediction move with it.'],
      ['How does Kaal get exact values?', 'Every reading starts from a Kundli calculated from your exact birth date, time and place, and Kaal shows the key values in a card before the first answer so you can check them.'],
    ],
    posts: ['how-accurate-is-ai-astrology', 'ai-astrologer-vs-human-astrologer', 'what-is-a-kundli'],
  },
  {
    slug: 'astrology-api',
    title: 'Astrology API for Apps — Add an AI Vedic Astrologer | Kaalera',
    h1: 'Astrology API: add Kaal to your app',
    kicker: 'For businesses and developers',
    description: 'Building an astrology app, horoscope chatbot or Kundli feature? Kaalera\'s API gives your users Kaal\'s readings with dated predictions and remedies, over simple HTTPS calls.',
    body: `Building an astrology app from scratch means calculating exact Kundlis, reading dasha periods and transits, and writing clear predictions. Kaalera's API gives you all of that in a few HTTPS calls, so you can focus on your product.

## What you get
- **Kaal's readings in your app:** send a person's birth date, time and place with a question, and get back a clear answer with **dated predictions**, the main **issue** and simple **remedies**, the same as on kaalera.com.
- **Follow-up questions** in the same consultation, so your users can keep asking.
- **Answers in your users' language.**
- **Simple auth:** one Bearer key (\`kal_live_...\`) from your [Developers dashboard](/developers).

## Pricing
Business & API pricing is **10% below our website prices**, in USD, taxes & fees included:
- **$10.35** to start a consultation (first question included);
- **$7.25** per follow-up question.

You top up a prepaid USD wallet, with a first recharge of **$115**. Every call is paid from the wallet; there are no free or test API calls. Auto-recharge keeps it topped up.

## Get started
1. Sign in at [Developers](/developers) and recharge your wallet.
2. Create an API key.
3. Follow the [quickstart](/docs/quickstart) to make your first call.`,
    faqs: [
      ['Is there a free trial or test API?', 'No. Every API call is paid from your prepaid USD wallet. Once your wallet is topped up you can try the API straight away.'],
      ['Can I build a horoscope chatbot with it?', 'Yes. Start a consultation with the user\'s birth details, then send each chat message as a follow-up question. Kaal answers with dated predictions and remedies.'],
      ['Which astrology system does Kaal use?', 'Vedic (sidereal) astrology with Lahiri ayanamsa, whole-sign houses and the Vimshottari dasha system.'],
      ['How much does it cost?', 'Business & API pricing is 10% below website prices: $10.35 to start a consultation and $7.25 per follow-up, taxes & fees included, from a prepaid USD wallet with a $115 first recharge.'],
    ],
    posts: ['build-ai-astrology-app-kaalera-api', 'add-horoscope-chatbot-to-your-app', 'astrology-api-use-cases'],
    cta: ['/developers', 'Get your API key'],
  },
];

export function topicPage(site: string, t: Topic, published: Post[]): string {
  const related = t.posts.map((s) => published.find((p) => p.slug === s)).filter((p): p is Post => !!p);
  const others = TOPIC_LINKS.filter(([href]) => href !== `/${t.slug}`);
  const main = `
<section class="w-hero">
  <p class="w-kicker">${esc(t.kicker)}</p>
  <h1>${esc(t.h1)}</h1>
  <p class="w-lead">${esc(t.description)}</p>
  <a class="w-cta big" href="${esc(t.cta?.[0] ?? '/?ask=1')}">${esc(t.cta?.[1] ?? 'Ask Kaal — first question free')}</a>
</section>
<article class="w-prose">${renderMarkdown(t.body)}</article>
<section class="w-faq"><h2>Frequently asked questions</h2>
${t.faqs.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('\n')}
</section>
${related.length ? `<section class="w-more"><h2>Read more</h2><div class="w-grid">${related.map((p) => `
  <div class="w-card"><h2><a href="/blog/${esc(p.slug)}">${esc(p.title)}</a></h2><p>${esc(p.summary)}</p></div>`).join('')}</div></section>` : ''}
<section class="w-more"><h2>More from Kaalera</h2><ul class="w-links">${others.map(([href, label]) => `<li><a href="${href}">${esc(label)}</a></li>`).join('')}<li><a href="/blog">Blog</a></li><li><a href="/developers">Astrology API</a></li></ul></section>
${ctaBlock()}`;
  return layout({
    site, path: `/${t.slug}`, title: t.title, description: t.description,
    jsonLd: [organizationLd(site), faqLd(t.faqs), breadcrumbLd(site, [['Home', '/'], [t.h1, `/${t.slug}`]])],
  }, main);
}
