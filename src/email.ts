import { env } from './env.js';
import type { Currency } from './currency.js';

export const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

async function sendEmail(to: string, subject: string, html: string, replyTo?: string, headers?: Record<string, string>): Promise<void> {
  const apiKey = env.email.apiKey;
  if (!apiKey) throw new Error('RESEND_API_KEY is not configured');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env.email.from, to, subject, html, ...(replyTo ? { reply_to: replyTo } : {}), ...(headers ? { headers } : {}) }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text().catch(() => '')}`);
}

const layout = (title: string, inner: string): string =>
  `<div style="font-family:system-ui,sans-serif;max-width:520px;margin:auto"><h2>${escapeHtml(title)}</h2>${inner}</div>`;
const button = (href: string, label: string): string =>
  `<p><a href="${escapeHtml(href)}" style="display:inline-block;background:#111;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">${escapeHtml(label)}</a></p>`;

export async function sendLoginEmail(to: string, link: string): Promise<void> {
  await sendEmail(to, 'Your Kaalera sign-in link', layout('Sign in to Kaalera',
    '<p>Click the button to continue your consultation. The link works once and expires in 15 minutes.</p>'
    + button(link, 'Sign in')
    + '<p style="color:#666;font-size:13px">If you didn\'t ask for this, ignore this email.</p>'));
}

export async function sendSupportEmail(o: { to: string; subject: string; title: string; body: string; link?: string; replyTo?: string }): Promise<void> {
  await sendEmail(o.to, o.subject, layout(o.title,
    `<p style="white-space:pre-wrap">${escapeHtml(o.body)}</p>${o.link ? button(o.link, 'View ticket') : ''}`), o.replyTo);
}

const usd = (cents: number): string => `$${(cents / 100).toFixed(2)}`;
const money = (cents: number, currency: Currency): string =>
  new Intl.NumberFormat(currency === 'inr' ? 'en-IN' : 'en-US', {
    style: 'currency', currency: currency.toUpperCase(), minimumFractionDigits: 2,
  }).format(cents / 100);

export async function sendReceiptEmail(o: {
  to: string; item: string; baseCents: number; feeCents: number; feePercent: number; totalCents: number; currency: Currency;
  last4: string | null; auto: boolean; ref: string; manageUrl: string; billedTo?: string | null;
}): Promise<void> {
  const row = (k: string, v: string, b = false) =>
    `<tr><td style="padding:4px 0;color:#555">${escapeHtml(k)}</td><td style="padding:4px 0;text-align:right${b ? ';font-weight:600' : ''}">${escapeHtml(v)}</td></tr>`;
  await sendEmail(o.to, `Kaalera receipt — ${money(o.totalCents, o.currency)}`, layout('Payment received',
    `<p>Thank you. ${o.auto ? 'This was charged automatically to your saved card.' : 'Your payment went through.'}</p>
    <table style="width:100%;border-collapse:collapse">${row(o.item, money(o.baseCents, o.currency))}${o.feeCents ? row(`Taxes & fees (${o.feePercent}%)`, money(o.feeCents, o.currency)) : ''}
    ${row(`Total (${o.currency.toUpperCase()})`, money(o.totalCents, o.currency), true)}${o.last4 ? row('Card', `•••• ${o.last4}`) : ''}${row('Date', new Date().toUTCString().slice(5, 16))}${row('Reference', o.ref)}${o.billedTo ? row('Billed to', o.billedTo) : ''}</table>
    <p style="color:#666;font-size:13px">All sales are final — no refunds. Automatic billing is ${o.auto ? 'on' : 'on by default'}; you can change it on your Account page.</p>`
    + button(o.manageUrl, 'Manage billing')));
}

export async function sendSubscriptionTrialEndingEmail(o: {
  to: string; plan: string; monthlyCents: number; taxFeePercent: number; currency: Currency; trialEnd: string; manageUrl: string;
}): Promise<void> {
  const chargeDate = new Date(o.trialEnd).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  const monthly = o.taxFeePercent > 0
    ? `${money(o.monthlyCents, o.currency)}/month + ${o.taxFeePercent}% taxes &amp; fees (${money(o.monthlyCents + Math.round((o.monthlyCents * o.taxFeePercent) / 100), o.currency)} total)`
    : `${money(o.monthlyCents, o.currency)}/month`;
  await sendEmail(o.to, 'Your Kaalera trial ends soon', layout('Your trial ends soon',
    `<p>Your ${escapeHtml(o.plan)} plan trial ends on <b>${escapeHtml(chargeDate)}</b>. Your card will then be charged <b>${monthly}</b>.</p>
    <p>Cancel anytime from your account.</p>` + button(o.manageUrl, 'Manage subscription')));
}

export async function sendContactEmails(o: { owner: string; name: string; email: string; topic: string; message: string }): Promise<void> {
  await sendEmail(o.owner, `[Kaalera contact] ${o.topic} — ${o.name}`, layout(`Contact form: ${o.topic}`,
    `<p><strong>${escapeHtml(o.name)}</strong> &lt;${escapeHtml(o.email)}&gt;</p><p style="white-space:pre-wrap">${escapeHtml(o.message)}</p>`), o.email);
  await sendEmail(o.email, 'We got your message — Kaalera', layout('Thanks for contacting Kaalera',
    `<p>Hi ${escapeHtml(o.name)}, we received your message and will reply to this email, usually within 2 working days.</p>
    <p style="color:#666;font-size:13px">For help with a consultation or payment, you can also raise a ticket at kaalera.com/support.</p>`));
}

export async function sendReminderEmail(o: { to: string; name: string; area: string; when: string; link: string }): Promise<void> {
  await sendEmail(o.to, `Your ${o.area.toLowerCase()} window opens now — Kaalera`, layout(`${o.area}: your window is open`,
    `<p>Kaal predicted <b>${escapeHtml(o.area)}</b> for ${escapeHtml(o.name)} in <b>${escapeHtml(o.when)}</b>. That window starts this month.</p>
    <p>Ask Kaal what to do now to make the most of it.</p>` + button(o.link, 'Ask Kaal')
    + '<p style="color:#666;font-size:13px">You asked for this reminder. Astrological guidance only, not professional advice.</p>'));
}

export async function sendPayoutRequestEmail(o: { to: string; code: string; cents: number; method: string; payTo: string; account: string; link: string }): Promise<void> {
  await sendEmail(o.to, `Influencer payout request: ${o.code} ${usd(o.cents)}`, layout('Influencer payout request',
    `<p>Code: <b>${escapeHtml(o.code)}</b><br>Amount: <b>${usd(o.cents)}</b><br>Send by: ${escapeHtml(o.method)}<br>Send to: <b>${escapeHtml(o.payTo)}</b><br>Kaalera account: ${escapeHtml(o.account)}</p>`
    + '<p>Send the money yourself, then mark it as paid. You need to be signed in to Kaalera as the owner.</p>'
    + button(o.link, 'Mark as paid')));
}

export async function sendPayoutSentEmail(o: { to: string; code: string; cents: number; method: string }): Promise<void> {
  await sendEmail(o.to, `Your Kaalera payout of ${usd(o.cents)} was sent`, layout('Your payout was sent',
    `<p>We sent <b>${usd(o.cents)}</b> for code ${escapeHtml(o.code)} by ${escapeHtml(o.method)}. Thank you for sharing Kaalera.</p>`));
}

const unsubHeaders = (url: string): Record<string, string> => ({ 'List-Unsubscribe': `<${url}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' });
const unsubFooter = (url: string, why: string): string =>
  `<p style="color:#888;font-size:12px">${escapeHtml(why)} <a href="${escapeHtml(url)}" style="color:#888">Unsubscribe</a></p>`;

export async function sendExpiryEmail(o: { to: string; what: string; when: string; link: string; cta: string }): Promise<void> {
  await sendEmail(o.to, `Reminder: ${o.what} expire ${o.when} — Kaalera`, layout(`Your ${o.what} expire ${o.when}`,
    `<p>You still have <b>${escapeHtml(o.what)}</b> on your Kaalera account. They expire <b>${escapeHtml(o.when)}</b> and can't be used after that.</p>`
    + button(o.link, o.cta)
    + '<p style="color:#666;font-size:13px">This is an account notice about your purchase.</p>'));
}

export async function sendEarnedEmail(o: { to: string; code: string; cents: number; availableCents: number; minCents: number; dashboard: string; unsubUrl: string }): Promise<void> {
  const left = o.minCents - o.availableCents;
  await sendEmail(o.to, `You just earned ${usd(o.cents)} with Kaalera`, layout(`You just earned ${usd(o.cents)}`,
    `<p>Someone who signed up with your link (code <b>${escapeHtml(o.code)}</b>) just paid for their first consultation. Your commission is <b>${usd(o.cents)}</b>.</p>
    <p>It becomes available after the 30-day hold. ${left > 0 ? `You need ${usd(left)} more available to request your ${usd(o.minCents)} payout.` : 'You can request a payout now.'}</p>`
    + button(o.dashboard, 'See your dashboard')
    + unsubFooter(o.unsubUrl, 'You get this as a Kaalera influencer.')), undefined, unsubHeaders(o.unsubUrl));
}

export async function sendInfluencerDigestEmail(o: {
  to: string; code: string; period: string; clicks: number; signups: number; earnedCents: number; availableCents: number; minCents: number;
  shareLink: string; idea: string; dashboard: string; unsubUrl: string;
}): Promise<void> {
  const left = o.minCents - o.availableCents;
  const row = (k: string, v: string) => `<tr><td style="padding:4px 0;color:#555">${escapeHtml(k)}</td><td style="padding:4px 0;text-align:right;font-weight:600">${escapeHtml(v)}</td></tr>`;
  await sendEmail(o.to, `${o.period} with Kaalera: ${usd(o.earnedCents)} earned`, layout(`${o.period}: your Kaalera results`,
    `<table style="width:100%;border-collapse:collapse">${row('Link clicks', String(o.clicks))}${row('Sign-ups', String(o.signups))}${row('Earned', usd(o.earnedCents))}${row('Ready to pay out', usd(o.availableCents))}</table>
    <p>${left > 0 ? `<b>${usd(left)} more</b> and you can request your ${usd(o.minCents)} payout.` : '<b>You can request a payout now.</b>'}</p>
    <p><b>Post idea:</b> ${escapeHtml(o.idea)}</p>
    <p>Your link: <a href="${escapeHtml(o.shareLink)}">${escapeHtml(o.shareLink)}</a></p>`
    + button(o.dashboard, 'Open your dashboard')
    + unsubFooter(o.unsubUrl, 'You get this as a Kaalera influencer.')), undefined, unsubHeaders(o.unsubUrl));
}

export async function sendFestivalEmail(o: { to: string; name: string; festival: string; percent: number; endsOn: string; link: string; unsubUrl: string }): Promise<void> {
  const ends = new Date(`${o.endsOn}T00:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' });
  await sendEmail(o.to, `${o.festival}: ${o.percent}% off your Kaal consultation`, layout(`Happy ${o.festival}${o.name ? `, ${o.name}` : ''}`,
    `<p>For ${escapeHtml(o.festival)}, every Kaal consultation and extra question is <b>${o.percent}% off</b> until ${escapeHtml(ends)}.</p>
    <p>Ask Kaal what the coming months hold for your career, marriage, money or health, with dates and simple remedies.</p>`
    + button(o.link, 'Ask Kaal')
    + unsubFooter(o.unsubUrl, 'You get this because you are a Kaalera customer or asked for offers.')), undefined, unsubHeaders(o.unsubUrl));
}
