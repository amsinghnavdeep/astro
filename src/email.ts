import { env } from './env.js';

export const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

async function sendEmail(to: string, subject: string, html: string, replyTo?: string): Promise<void> {
  const apiKey = env.email.apiKey;
  if (!apiKey) throw new Error('RESEND_API_KEY is not configured');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env.email.from, to, subject, html, ...(replyTo ? { reply_to: replyTo } : {}) }),
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

export async function sendReceiptEmail(o: {
  to: string; item: string; baseCents: number; feeCents: number; feePercent: number; totalCents: number;
  last4: string | null; auto: boolean; ref: string; manageUrl: string;
}): Promise<void> {
  const row = (k: string, v: string, b = false) =>
    `<tr><td style="padding:4px 0;color:#555">${escapeHtml(k)}</td><td style="padding:4px 0;text-align:right${b ? ';font-weight:600' : ''}">${escapeHtml(v)}</td></tr>`;
  await sendEmail(o.to, `Kaalera receipt — ${usd(o.totalCents)}`, layout('Payment received',
    `<p>Thank you. ${o.auto ? 'This was charged automatically to your saved card.' : 'Your payment went through.'}</p>
    <table style="width:100%;border-collapse:collapse">${row(o.item, usd(o.baseCents))}${o.feeCents ? row(`Taxes & fees (${o.feePercent}%)`, usd(o.feeCents)) : ''}
    ${row('Total (USD)', usd(o.totalCents), true)}${o.last4 ? row('Card', `•••• ${o.last4}`) : ''}${row('Date', new Date().toUTCString().slice(5, 16))}${row('Reference', o.ref)}</table>
    <p style="color:#666;font-size:13px">All sales are final — no refunds. Auto-charge is ${o.auto ? 'on' : 'on by default'} for future questions; you can turn it off any time.</p>`
    + button(o.manageUrl, 'Manage auto-charge')));
}

export async function sendContactEmails(o: { owner: string; name: string; email: string; topic: string; message: string }): Promise<void> {
  await sendEmail(o.owner, `[Kaalera contact] ${o.topic} — ${o.name}`, layout(`Contact form: ${o.topic}`,
    `<p><strong>${escapeHtml(o.name)}</strong> &lt;${escapeHtml(o.email)}&gt;</p><p style="white-space:pre-wrap">${escapeHtml(o.message)}</p>`), o.email);
  await sendEmail(o.email, 'We got your message — Kaalera', layout('Thanks for contacting Kaalera',
    `<p>Hi ${escapeHtml(o.name)}, we received your message and will reply to this email, usually within 2 working days.</p>
    <p style="color:#666;font-size:13px">For help with a consultation or payment, you can also raise a ticket at kaalera.com/support.</p>`));
}
