/** Owner emails (admin Email tab and owner email API): one-off, list and bulk sends via Resend. */
import type { D1Database } from '@cloudflare/workers-types';
import { env } from './env.js';
import { escapeHtml as h } from './email.js';
import { renderMarkdown } from './markdown.js';
import { randomToken, sha256 } from './auth.js';
import { unsubUrl } from './engagement.js';

export const FROM_IDS = ['kaal', 'hello', 'support', 'contact'] as const;
export type FromId = (typeof FROM_IDS)[number];
export const fromAddress = (id: FromId): string => `${id === 'kaal' ? 'Kaal from Kaalera' : 'Kaalera'} <${id}@kaalera.com>`;

export const AUDIENCES = {
  emails: 'Emails I type below',
  all: 'All users',
  paid: 'Paying customers',
  free: 'Free only (never paid)',
  business: 'Business accounts',
  optin: 'Marketing opt-in',
} as const;
export type AudienceId = keyof typeof AUDIENCES;
export type Kind = 'service' | 'promo';
export const MAX_RECIPIENTS = 2000;

export interface Draft { from: FromId; kind: Kind; audience: AudienceId; emails: string; subject: string; body: string }
export interface Recipient { id: string | null; email: string; name: string }
export interface BroadcastRow { id: string; from_addr: string; subject: string; kind: Kind; audience: string; total: number; sent: number; failed: number; error: string | null; via: string; created_by: string; created_at: string }

const EMAIL_RE = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;
export const parseEmails = (s: string): string[] =>
  [...new Set(s.split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter((e) => EMAIL_RE.test(e)))];

const DAY = 86_400_000;
const CONSENT = `(u.email_unsub = 0 AND u.account_type = 'personal' AND (
  EXISTS (SELECT 1 FROM payments p WHERE p.user_id = u.id AND p.kind != 'api_credits' AND p.created_at >= ?)
  OR EXISTS (SELECT 1 FROM email_leads l WHERE l.email = u.email AND l.marketing_opt_in = 1)))`;
const GROUP_WHERE: Record<Exclude<AudienceId, 'emails'>, string> = {
  all: '1 = 1',
  paid: 'EXISTS (SELECT 1 FROM payments p WHERE p.user_id = u.id)',
  free: 'NOT EXISTS (SELECT 1 FROM payments p WHERE p.user_id = u.id)',
  business: "u.account_type = 'business'",
  optin: 'EXISTS (SELECT 1 FROM email_leads l WHERE l.email = u.email AND l.marketing_opt_in = 1)',
};

type URow = { id: string; email: string; name: string; consent: number };

/** Who gets it. Promotions only reach Personal accounts with consent (paid in 2 years or opted in) who haven't unsubscribed. */
export async function resolveRecipients(db: D1Database, d: Pick<Draft, 'kind' | 'audience' | 'emails'>): Promise<{ to: Recipient[]; skipped: number }> {
  const since = new Date(Date.now() - 730 * DAY).toISOString();
  const sel = `SELECT u.id, u.email, u.name, ${CONSENT} AS consent FROM users u`;
  let rows: URow[];
  let typed: string[] = [];
  if (d.audience === 'emails') {
    typed = parseEmails(d.emails).slice(0, MAX_RECIPIENTS);
    rows = [];
    for (let i = 0; i < typed.length; i += 50) {
      const part = typed.slice(i, i + 50);
      rows.push(...(await db.prepare(`${sel} WHERE u.email IN (${part.map(() => '?').join(',')})`).bind(since, ...part).all<URow>()).results);
    }
  } else {
    rows = (await db.prepare(`${sel} WHERE ${GROUP_WHERE[d.audience]} ORDER BY u.created_at LIMIT ${MAX_RECIPIENTS + 1}`).bind(since).all<URow>()).results;
  }
  const known = new Map(rows.map((r) => [r.email.toLowerCase(), r]));
  const all: (Recipient & { consent: boolean })[] = d.audience === 'emails'
    ? typed.map((e) => { const r = known.get(e); return { id: r?.id ?? null, email: e, name: r?.name ?? '', consent: !!r?.consent }; })
    : rows.map((r) => ({ id: r.id, email: r.email, name: r.name, consent: !!r.consent }));
  const to = (d.kind === 'promo' ? all.filter((r) => r.id && r.consent) : all).slice(0, MAX_RECIPIENTS)
    .map(({ id, email, name }) => ({ id, email, name }));
  return { to, skipped: all.length - to.length };
}

const STYLE: [RegExp, string][] = [
  [/<h([2-6])>/g, '<h$1 style="font-family:Georgia,\'Times New Roman\',serif;color:#1a1424;font-size:20px;line-height:1.3;margin:26px 0 10px">'],
  [/<p>/g, '<p style="margin:0 0 16px">'],
  [/<(ul|ol)>/g, '<$1 style="margin:0 0 16px;padding-left:22px">'],
  [/<li>/g, '<li style="margin:0 0 6px">'],
  [/<a href=/g, '<a style="color:#c4620a;font-weight:600" href='],
  [/<strong>/g, '<strong style="color:#1a1424">'],
  [/<blockquote>/g, '<blockquote style="margin:0 0 16px;padding:12px 16px;border-left:3px solid #e8871e;background:#fbf4ea;border-radius:0 10px 10px 0">'],
  [/<hr>/g, '<hr style="border:0;border-top:1px solid #ece6dc;margin:24px 0">'],
];
const BUTTON_RE = /^\s*\[button:\s*([^\]]+)\]\((https?:\/\/[^\s)]+)\)\s*$/i;

/** Body text (## heading, **bold**, - list, [text](link), [button: Text](link), {{name}}) inside the Kaalera email design. */
export function renderEmail(d: Pick<Draft, 'kind' | 'subject' | 'body'>, r: { name: string; unsub?: string }): { subject: string; html: string } {
  const first = r.name.trim().split(/\s+/)[0] || 'there';
  const buttons: string[] = [];
  const src = d.body.split(/\r?\n/).map((l) => {
    const m = BUTTON_RE.exec(l);
    if (!m) return l;
    buttons.push(`<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 22px"><tr><td style="background:#e8871e;border-radius:10px"><a href="${h(m[2])}" style="display:inline-block;padding:13px 26px;color:#1a0f02;font:700 15px system-ui,-apple-system,'Segoe UI',sans-serif;text-decoration:none">${h(m[1].trim())}</a></td></tr></table>`);
    return `\n@@BTN${buttons.length - 1}@@\n`;
  }).join('\n');
  let body = renderMarkdown(src, 1);
  for (const [re, rep] of STYLE) body = body.replace(re, rep);
  body = body.replace(/<p[^>]*>@@BTN(\d+)@@<\/p>/g, (_, i) => buttons[Number(i)]).replaceAll('{{name}}', h(first));
  const footer = d.kind === 'promo'
    ? `You get this because you are a Kaalera customer or asked for offers.${r.unsub ? ` <a href="${h(r.unsub)}" style="color:#8a8494">Unsubscribe</a>` : ''}`
    : 'This is a service message about your Kaalera account.';
  const subject = d.subject.replaceAll('{{name}}', first);
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${h(subject)}</title></head>
<body style="margin:0;padding:0;background:#f4efe6">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4efe6"><tr><td align="center" style="padding:28px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 6px 24px rgba(40,20,0,.08)">
<tr><td style="background:#0b0a12;background-image:linear-gradient(135deg,#2b1a3d 0%,#0b0a12 55%,#3a2310 100%);padding:26px 32px">
<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="vertical-align:middle"><img src="${env.siteUrl}/email-logo.png" width="44" height="44" alt="Kaalera" style="display:block;border:0"></td>
<td style="vertical-align:middle;padding-left:12px"><div style="font:600 24px Georgia,'Times New Roman',serif;color:#f3efe8;letter-spacing:.4px">Kaalera</div>
<div style="font:12px system-ui,-apple-system,'Segoe UI',sans-serif;color:#f5b85c;letter-spacing:1px;text-transform:uppercase;margin-top:2px">Ask Kaal about your future</div></td></tr></table></td></tr>
<tr><td style="height:4px;background:#e8871e;background-image:linear-gradient(90deg,#f5b85c,#e8871e,#c4620a)"></td></tr>
<tr><td style="padding:34px 32px 18px;color:#2a2433;font:16px/1.7 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif">${body}</td></tr>
<tr><td style="padding:18px 32px 26px;border-top:1px solid #ece6dc;color:#8a8494;font:12px/1.6 system-ui,-apple-system,'Segoe UI',sans-serif">
<a href="${env.siteUrl}" style="color:#c4620a;text-decoration:none;font-weight:600">kaalera.com</a> · Astrology is guidance, not a guarantee.<br>${footer}</td></tr>
</table></td></tr></table></body></html>`;
  return { subject, html };
}

async function resend(path: string, payload: unknown): Promise<string | null> {
  const key = env.email.apiKey;
  if (!key) return 'RESEND_API_KEY is not configured';
  const res = await fetch(`https://api.resend.com${path}`, {
    method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
  return res.ok ? null : `Resend ${res.status}: ${(await res.text().catch(() => '')).slice(0, 300)}`;
}

export async function sendTest(d: Draft, to: string, name: string): Promise<string | null> {
  const e = renderEmail(d, { name, unsub: d.kind === 'promo' ? `${env.siteUrl}/unsubscribe` : undefined });
  return resend('/emails', { from: fromAddress(d.from), to, subject: `[Test] ${e.subject}`, html: e.html });
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function sendBroadcast(db: D1Database, d: Draft, to: Recipient[], by: string, via: 'admin' | 'api'): Promise<{ id: string; sent: number; failed: number; error: string | null }> {
  const id = crypto.randomUUID();
  const audience = d.audience === 'emails' ? `${to.length} typed` : d.audience;
  await db.prepare(`INSERT INTO email_broadcasts (id, from_addr, subject, body, kind, audience, total, via, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(id, fromAddress(d.from), d.subject, d.body, d.kind, audience, to.length, via, by, new Date().toISOString()).run();
  let sent = 0;
  let failed = 0;
  let error: string | null = null;
  for (let i = 0; i < to.length; i += 100) {
    const part = to.slice(i, i + 100);
    const items = await Promise.all(part.map(async (r) => {
      const unsub = d.kind === 'promo' && r.id ? await unsubUrl(db, r.id) : undefined;
      const e = renderEmail(d, { name: r.name, unsub });
      return {
        from: fromAddress(d.from), to: [r.email], subject: e.subject, html: e.html,
        ...(unsub ? { headers: { 'List-Unsubscribe': `<${unsub}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } } : {}),
      };
    }));
    const err = await resend('/emails/batch', items);
    if (err) { failed += part.length; error = err; } else sent += part.length;
    if (i + 100 < to.length) await pause(600);
  }
  await db.prepare('UPDATE email_broadcasts SET sent = ?, failed = ?, error = ? WHERE id = ?').bind(sent, failed, error, id).run();
  return { id, sent, failed, error };
}

export async function broadcastLog(db: D1Database, limit = 50): Promise<BroadcastRow[]> {
  return (await db.prepare(`SELECT id, from_addr, subject, kind, audience, total, sent, failed, error, via, created_by, created_at
    FROM email_broadcasts ORDER BY created_at DESC LIMIT ?`).bind(limit).all<BroadcastRow>()).results;
}

const TOKEN_KEY = 'owner_email_api_token';
/** New owner email API token; only its hash is stored, the token is shown once. */
export async function rotateApiToken(db: D1Database, by: string): Promise<string> {
  const raw = `kle_${randomToken()}`;
  await db.prepare(`INSERT INTO settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`)
    .bind(TOKEN_KEY, await sha256(raw), new Date().toISOString(), by).run();
  return raw;
}
export async function apiTokenInfo(db: D1Database): Promise<{ updated_at: string } | null> {
  return db.prepare('SELECT updated_at FROM settings WHERE key = ?').bind(TOKEN_KEY).first<{ updated_at: string }>();
}
export async function checkApiToken(db: D1Database, raw: string): Promise<boolean> {
  if (!/^kle_[A-Za-z0-9_-]{20,}$/.test(raw)) return false;
  const row = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(TOKEN_KEY).first<{ value: string }>();
  return !!row && row.value === (await sha256(raw));
}
