/** Server-rendered Affiliates (friend referral) and Influencers program pages. */
import { breadcrumbLd, esc, layout } from './seo/layout.js';

const page = (site: string, path: string, title: string, description: string, body: string) =>
  layout({ site, path, title: `${title} — Kaalera`, description, jsonLd: [breadcrumbLd(site, [['Home', '/'], [title, path]])] },
    `<article class="w-article w-legal"><h1>${esc(title)}</h1>${body}</article>`);

export const affiliatesPage = (site: string): string => page(site, '/affiliates', 'Affiliates: share Kaalera, get 2 free questions',
  'Share your Kaalera link. Your friend gets 2 free questions with Kaal, and you get 2 free questions when they make their first payment.', `
<p class="w-lead">Share Kaalera with a friend. <strong>You both get 2 free questions</strong> with Kaal, the AI astrologer.</p>
<h2>How it works</h2>
<ol>
<li>Sign in and open <strong>Affiliates</strong> in the menu to get your personal link.</li>
<li>Send it on WhatsApp or anywhere you like.</li>
<li>Your friend signs up through your link and gets <strong>2 free questions</strong> instead of 1.</li>
<li>When your friend makes their first payment, you get <strong>2 free questions</strong>.</li>
</ol>
<h2>Rules</h2>
<ul>
<li>Up to 10 rewards (20 questions) a month.</li>
<li>Reward questions expire 3 months after they are given.</li>
<li>You can't refer yourself. One free offer per person, device and connection; temporary email addresses are not accepted.</li>
<li>Rewards are free questions, not cash. For cash rewards, see the <a href="/influencers">Influencer program</a>.</li>
</ul>
<div id="partner-app" data-kind="affiliates"></div>
<p class="p-signed-out"><a class="w-cta" href="/">Sign in to get your link</a></p>
<script type="module" src="/partner.js"></script>`);

export const influencersPage = (site: string): string => page(site, '/influencers', 'Influencer program: earn 10% with your own code',
  'Get your own Kaalera share link. Everyone who signs up through it counts under you: they get 2 free questions with Kaal, and you earn 10% of their first paid consultation.', `
<p class="w-lead">Get your own <strong>share link</strong>, like kaalera.com/?code=PRIYA. Everyone who signs up through it counts under you: they get <strong>2 free questions</strong> with Kaal, and you earn <strong>10%</strong> of their first paid consultation.</p>
<h2>How it works</h2>
<ol>
<li>Sign in, open <strong>Influencers</strong> in the menu and pick your code, like <strong>PRIYA</strong> or <strong>ASTROWITHRAJ</strong>. That gives you your share link.</li>
<li>Put your link in your bio, videos and posts. Followers can also type your code when they sign up.</li>
<li>Everyone who signs up through your link gets 2 free questions instead of 1, and their payments count under you.</li>
<li>You earn 10% of each referred customer's first paid consultation: the opening and any extra questions in it, before taxes &amp; fees.</li>
</ol>
<h2>Payouts</h2>
<ul>
<li>Earnings are held 30 days. Once at least $50 is available, tap <strong>Request payout</strong> on your dashboard.</li>
<li>We send it in USD by PayPal or Interac e-Transfer to the email you give, and email you when it's sent.</li>
<li>Your dashboard shows clicks, sign-ups, paying customers, earnings and payouts. Customer names and emails are never shown.</li>
</ul>
<h2>Rules</h2>
<ul>
<li>Codes must be unique and not offensive. No self-referral.</li>
<li>Free consultations, later consultations and API purchases do not earn commission.</li>
<li>We may pause a code that breaks our <a href="/terms">Terms</a>.</li>
</ul>
<div id="partner-app" data-kind="influencers"></div>
<p class="p-signed-out"><a class="w-cta" href="/">Sign in to create your code</a></p>
<script type="module" src="/partner.js"></script>`);
