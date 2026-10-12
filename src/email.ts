import { env } from './env.js';

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export async function sendLoginEmail(to: string, link: string): Promise<void> {
  const apiKey = env.email.apiKey;
  if (!apiKey) throw new Error('RESEND_API_KEY is not configured');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: env.email.from,
      to,
      subject: 'Your Kaalera sign-in link',
      html: `<div style="font-family:system-ui,sans-serif;max-width:520px;margin:auto">
        <h2>Sign in to Kaalera</h2>
        <p>Click the button to continue your consultation. The link works once and expires in 15 minutes.</p>
        <p><a href="${escapeHtml(link)}" style="display:inline-block;background:#111;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Sign in</a></p>
        <p style="color:#666;font-size:13px">If you didn't ask for this, ignore this email.</p>
      </div>`,
    }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text().catch(() => '')}`);
}
