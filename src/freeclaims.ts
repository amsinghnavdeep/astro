import type { D1Database } from '@cloudflare/workers-types';
import type { Context } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { randomToken, sha256 } from './auth.js';
import disposableList from './disposable-domains.txt';

const DEVICE_COOKIE = 'kaalera_device';
const DEVICE_RE = /^[A-Za-z0-9_-]{16,64}$/;
const IP_FREE_PER_DAY = 5;
const DAY_MS = 86_400_000;

const disposable = new Set(
  disposableList.split('\n').map((s) => s.trim().toLowerCase()).filter((s) => s && !s.startsWith('#')),
);

/** True for throwaway-inbox domains (and their subdomains). */
export function isDisposable(email: string): boolean {
  const parts = (email.split('@')[1] ?? '').toLowerCase().split('.');
  for (let i = 0; i < parts.length - 1; i++) if (disposable.has(parts.slice(i).join('.'))) return true;
  return false;
}

export function ensureDeviceCookie(c: Context, secure: boolean): void {
  if (DEVICE_RE.test(getCookie(c, DEVICE_COOKIE) ?? '')) return;
  setCookie(c, DEVICE_COOKIE, randomToken(), { httpOnly: true, sameSite: 'Lax', path: '/', secure, maxAge: 365 * 86_400 });
}

export type FreeKeys = { devices: string[]; ip: string | null };

export async function freeKeys(c: Context): Promise<FreeKeys> {
  const ids = [getCookie(c, DEVICE_COOKIE), c.req.header('x-kaalera-device')].filter((v): v is string => !!v && DEVICE_RE.test(v));
  const ip = c.req.header('cf-connecting-ip');
  return {
    devices: await Promise.all([...new Set(ids)].map((d) => sha256(`device:${d}`))),
    ip: ip ? await sha256(`ip:${ip}`) : null,
  };
}

/** The free reading was already used on this device, or this connection hit its daily cap. */
export async function freeBlocked(db: D1Database, k: FreeKeys): Promise<boolean> {
  if (k.devices.length) {
    const hit = await db.prepare(`SELECT 1 FROM free_claims WHERE kind = 'device' AND key_hash IN (${k.devices.map(() => '?').join(', ')}) LIMIT 1`)
      .bind(...k.devices).first();
    if (hit) return true;
  }
  if (!k.ip) return false;
  const n = await db.prepare(`SELECT COUNT(*) AS n FROM free_claims WHERE kind = 'ip' AND key_hash = ? AND created_at > ?`)
    .bind(k.ip, Date.now() - DAY_MS).first<{ n: number }>();
  return (n?.n ?? 0) >= IP_FREE_PER_DAY;
}

export async function recordFreeClaims(db: D1Database, userId: string, k: FreeKeys): Promise<void> {
  const now = Date.now();
  const ins = (kind: string, key: string, orIgnore = false) =>
    db.prepare(`INSERT ${orIgnore ? 'OR IGNORE ' : ''}INTO free_claims (kind, key_hash, user_id, created_at) VALUES (?, ?, ?, ?)`).bind(kind, key, userId, now);
  const stmts = [...k.devices.map((d) => ins('device', d, true)), ...(k.ip ? [ins('ip', k.ip)] : [])];
  if (stmts.length) await db.batch(stmts);
}
