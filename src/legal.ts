/** Server-rendered Terms, Privacy and Contact pages. Plain HTML forms; no client script needed. */
import { breadcrumbLd, esc, layout } from './seo/layout.js';

const UPDATED = '2026-10-13';
const page = (site: string, path: string, title: string, description: string, body: string) =>
  layout({ site, path, title: `${title} — Kaalera`, description, jsonLd: [breadcrumbLd(site, [['Home', '/'], [title, path]])] },
    `<article class="w-article w-legal"><h1>${esc(title)}</h1><p class="w-meta">Last updated ${UPDATED}</p>${body}</article>`);

export const termsPage = (site: string): string => page(site, '/terms', 'Terms & Conditions',
  'Kaalera terms: astrology guidance only, USD prices including taxes & fees, auto-charge, expiry, no refunds, Business &amp; API rules.', `
<p>These terms apply to kaalera.com, the Kaal chat and the Kaalera API. By creating an account or paying, you agree to them.</p>
<h2>1. Guidance only</h2>
<p>Kaal gives astrological readings for personal reflection and entertainment. Readings are not medical, legal, financial, psychological or other professional advice, and predictions are not guaranteed. Do not make important decisions on a reading alone; consult a qualified professional. Kaal only answers astrology questions and declines other tasks, political and religious debate, and predictions of death.</p>
<h2>2. Accounts</h2>
<p>You must be 18 or older and give a real email address. One free question is offered per person; we may limit or refuse free questions per account, device or connection, and block temporary email addresses. Keep your sign-in links and API keys private; you are responsible for activity on your account.</p>
<h2>3. Prices and payment</h2>
<p>All prices are in US dollars. Prices shown on the site include a flat taxes &amp; fees charge (currently 15%); the total is shown before you pay. Card payments are processed by Stripe; we never see or store your full card number. Prices may change; changes apply to new purchases only.</p>
<h2>4. Auto-charge (chat) — on by default</h2>
<p>When you pay, your card is saved with Stripe. When a consultation runs out of questions and you send another, that question is charged automatically to the saved card at the extra-question price plus taxes &amp; fees, as shown before you pay, up to 10 automatic charges per day. You can turn auto-charge off at any time in your account menu; it stops future charges immediately. Every charge is emailed to you.</p>
<h2>5. API and auto-recharge — on by default</h2>
<p>The API is prepaid from a USD wallet; there is no free or test API. Business &amp; API prices are 10% below the standard website prices (currently $9 to start a consultation and $6.30 per follow-up). API keys activate after your API wallet recharges total at least the published minimum (currently $100). After your first recharge your card is saved, and when your wallet drops below $10 we add your chosen top-up automatically (default $100 + taxes &amp; fees), up to your monthly limit (default $500). You can change or turn off auto-recharge on the Developers page at any time. If a top-up fails, API requests return an insufficient-balance error until you recharge.</p>
<h2>6. Expiry</h2>
<p>Chat questions expire 3 months after purchase and API wallet balance 6 months after purchase. A consultation closes 7 days after it starts and then stays readable.</p>
<h2>7. No refunds</h2>
<p>All sales are final. We do not refund purchases, automatic charges, unused or expired questions or wallet balance, except where the law requires it. If a question cannot be delivered, its charge is returned automatically as a question or to your API wallet.</p>
<h2>8. Acceptable use</h2>
<p>No abuse, scraping, automated sign-ups, attempts to get free questions by evasion, harassment, or unlawful content. We may suspend accounts that break these terms.</p>
<h2>9. Liability</h2>
<p>The service is provided "as is". To the extent the law allows, our total liability is limited to the amount you paid us in the 3 months before the claim, and we are not liable for decisions you make based on a reading.</p>
<h2>10. Law</h2>
<p>These terms are governed by the laws of Ontario, Canada. We may update them; the date above shows the latest version.</p>
<h2>Contact</h2>
<p><a href="/contact">Contact us</a> or email <a href="mailto:hello@kaalera.com">hello@kaalera.com</a>. See also our <a href="/privacy">Privacy Policy</a>.</p>`);

export const privacyPage = (site: string): string => page(site, '/privacy', 'Privacy Policy',
  'What Kaalera collects (email, birth details, chats, payment records), why, who processes it, and how to delete it.', `
<h2>What we collect</h2>
<ul>
<li><strong>Account:</strong> your name and email.</li>
<li><strong>Kundlis:</strong> names, dates, times and places of birth you save, for you and the people you ask about.</li>
<li><strong>Consultations:</strong> your questions and Kaal's answers.</li>
<li><strong>Payments:</strong> what you bought, amounts, dates, Stripe payment IDs and your card's last 4 digits. Stripe holds the card itself.</li>
<li><strong>Abuse prevention:</strong> your IP address and a random device ID cookie, used to limit free questions and rate-limit requests.</li>
<li><strong>Sign-in form:</strong> the email address you type into the sign-in or sign-up form, saved when you leave the email box even if you don't finish. We use it to count unfinished sign-ups and only email you offers if you tick the box to receive them.</li>
<li><strong>Usage counts:</strong> daily totals of steps such as sign-ups, free questions and payments. These totals contain no names, emails, birth details or chat text.</li>
<li><strong>Site analytics:</strong> Cloudflare Web Analytics counts page views, referring sites, country, device type and page speed without cookies and without your chats, birth details or email.</li>
<li><strong>API:</strong> hashed API keys and credit usage.</li>
</ul>
<h2>Why</h2>
<p>To give you readings, take payments and auto-charges you agreed to, send sign-in links and receipts, answer support requests, and prevent fraud. We do not sell your data and we do not use advertising trackers.</p>
<h2>Who processes it</h2>
<p>Trusted service providers process data for us under contract: Stripe for payments, and providers for hosting, email delivery and generating readings. They may process data outside Canada.</p>
<h2>Cookies</h2>
<p>A sign-in session cookie, a device ID cookie for free-question limits, and a saved light/dark theme preference. No advertising or analytics cookies.</p>
<h2>How long we keep it</h2>
<p>While your account is open. Payment records are kept as long as tax and accounting law requires.</p>
<p>Emails typed into the sign-in form by people who never finish signing up are deleted after 90 days.</p>
<h2>Your rights</h2>
<p>You can ask to see, correct or delete your data by emailing <a href="mailto:hello@kaalera.com">hello@kaalera.com</a> from your account email. We reply within 30 days. Deleting your account removes your Kundlis and consultations; unused questions and credits are lost.</p>
<h2>Children</h2>
<p>Kaalera is for adults 18+. You may save a child's birth details as a parent or guardian.</p>
<h2>Changes and law</h2>
<p>We follow Canadian privacy law (PIPEDA). We will update the date above when this policy changes.</p>`);

export const CONTACT_TOPICS = ['General', 'Payments', 'API / business', 'Press', 'Other'] as const;

export const contactPage = (site: string, state: 'form' | 'sent' | 'error' = 'form'): string => page(site, '/contact', 'Contact us',
  'Contact Kaalera — questions about readings, payments, the AI astrology API, business or press. Email hello@kaalera.com.',
  state === 'sent'
    ? '<p class="w-notice">Thank you — your message was sent. We reply by email, usually within 2 working days.</p><p><a href="/">Back to Kaal</a></p>'
    : `${state === 'error' ? '<p class="w-error" role="alert">Please check your name, email and message (10–4000 characters), or try again in an hour.</p>' : ''}
<p>Email <a href="mailto:hello@kaalera.com">hello@kaalera.com</a> or use the form. For a problem with your account or a consultation, <a href="/support">raise a support ticket</a> so your history is attached.</p>
<form class="w-form" method="post" action="/api/contact">
  <label>Name<input name="name" required maxlength="100" autocomplete="name"></label>
  <label>Email<input name="email" type="email" required maxlength="200" autocomplete="email"></label>
  <label>Topic<select name="topic">${CONTACT_TOPICS.map((t) => `<option>${esc(t)}</option>`).join('')}</select></label>
  <label>Message<textarea name="message" required minlength="10" maxlength="4000" rows="6"></textarea></label>
  <label class="w-hp" aria-hidden="true">Website<input name="website" tabindex="-1" autocomplete="off"></label>
  <button class="w-cta big" type="submit" data-busy="Sending…">Send message</button>
</form>`);
