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
