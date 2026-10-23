import type { D1Database } from '@cloudflare/workers-types';

export interface User { id: string; email: string; name: string; free_used: number; created_at: string; account_type?: string; currency?: 'usd' | 'inr' | null; business_name?: string | null; tax_id?: string | null }

const LOGIN_TTL_MS = 15 * 60_000;
const SESSION_TTL_MS = 30 * 86_400_000;

export function randomToken(): string {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function sha256(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/** Returns a raw single-use token, or null when this email asked for too many links recently. */
export async function createLoginToken(db: D1Database, email: string, name: string | undefined): Promise<string | null> {
  const now = Date.now();
  const recent = await db.prepare('SELECT COUNT(*) AS n FROM login_tokens WHERE email = ? AND created_at > ?')
    .bind(email, now - LOGIN_TTL_MS).first<{ n: number }>();
  if ((recent?.n ?? 0) >= 3) return null;
  const token = randomToken();
  await db.prepare('INSERT INTO login_tokens (token_hash, email, name, expires_at, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(await sha256(token), email, name ?? null, now + LOGIN_TTL_MS, now).run();
  return token;
}

/** Consumes a login token and returns a new session token for the (possibly new) user. */
export async function redeemLoginToken(db: D1Database, token: string): Promise<string | null> {
  const row = await db.prepare(
    'UPDATE login_tokens SET used = 1 WHERE token_hash = ? AND used = 0 AND expires_at > ? RETURNING email, name',
  ).bind(await sha256(token), Date.now()).first<{ email: string; name: string | null }>();
  if (!row) return null;
  await db.prepare('INSERT INTO users (id, email, name, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(email) DO NOTHING')
    .bind(crypto.randomUUID(), row.email, row.name || row.email.split('@')[0], new Date().toISOString()).run();
  const user = await db.prepare('SELECT id FROM users WHERE email = ?').bind(row.email).first<{ id: string }>();
  const session = randomToken();
  await db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .bind(await sha256(session), user!.id, Date.now() + SESSION_TTL_MS).run();
  return session;
}

export async function userForSession(db: D1Database, session: string | undefined): Promise<User | null> {
  if (!session) return null;
  return db.prepare('SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?')
    .bind(await sha256(session), Date.now()).first<User>();
}

export async function destroySession(db: D1Database, session: string | undefined): Promise<void> {
  if (session) await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(session)).run();
}
