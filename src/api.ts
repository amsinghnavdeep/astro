/** Developer API: hashed keys and a prepaid credit ledger (1 credit = 1 question). */
import type { D1Database } from '@cloudflare/workers-types';
import { randomToken, sha256 } from './auth.js';

export interface ApiKey {
  id: string; user_id: string; name: string; prefix: string;
  created_at: string; last_used_at: string | null; revoked_at: string | null;
}
export interface LedgerEntry {
  id: string; delta: number; reason: string; ref: string;
  api_key_id: string | null; thread_id: string | null; created_at: string;
}

const nowIso = (): string => new Date().toISOString();

export async function createApiKey(db: D1Database, userId: string, name: string): Promise<{ key: string; record: ApiKey }> {
  const key = `kal_live_${randomToken()}`;
  const record: ApiKey = {
    id: crypto.randomUUID(), user_id: userId, name, prefix: key.slice(0, 14),
    created_at: nowIso(), last_used_at: null, revoked_at: null,
  };
  await db.prepare('INSERT INTO api_keys (id, user_id, name, prefix, key_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(record.id, userId, name, record.prefix, await sha256(key), record.created_at).run();
  return { key, record };
}

export const listApiKeys = async (db: D1Database, userId: string): Promise<ApiKey[]> =>
  (await db.prepare(
    'SELECT id, user_id, name, prefix, created_at, last_used_at, revoked_at FROM api_keys WHERE user_id = ? ORDER BY created_at DESC',
  ).bind(userId).all<ApiKey>()).results;

export async function revokeApiKey(db: D1Database, userId: string, id: string): Promise<boolean> {
  const r = await db.prepare('UPDATE api_keys SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL')
    .bind(nowIso(), id, userId).run();
  return (r.meta?.changes ?? 0) > 0;
}

export async function authenticateApiKey(db: D1Database, raw: string): Promise<{ userId: string; keyId: string } | null> {
  if (!raw.startsWith('kal_')) return null;
  const row = await db.prepare('SELECT id, user_id FROM api_keys WHERE key_hash = ? AND revoked_at IS NULL')
    .bind(await sha256(raw)).first<{ id: string; user_id: string }>();
  if (!row) return null;
  await db.prepare('UPDATE api_keys SET last_used_at = ? WHERE id = ?').bind(nowIso(), row.id).run();
  return { userId: row.user_id, keyId: row.id };
}

export async function apiBalance(db: D1Database, userId: string): Promise<number> {
  const r = await db.prepare('SELECT COALESCE(SUM(delta), 0) AS n FROM api_credit_ledger WHERE user_id = ?')
    .bind(userId).first<{ n: number }>();
  return r?.n ?? 0;
}

/** Atomic: only inserts the -1 row when the balance is at least 1. */
export async function spendApiCredit(
  db: D1Database, userId: string, ref: string, keyId: string | null, threadId: string | null,
): Promise<boolean> {
  const r = await db.prepare(
    `INSERT INTO api_credit_ledger (id, user_id, delta, reason, ref, api_key_id, thread_id, created_at)
     SELECT ?, ?, -1, 'question', ?, ?, ?, ?
     WHERE (SELECT COALESCE(SUM(delta), 0) FROM api_credit_ledger WHERE user_id = ?) >= 1
     ON CONFLICT(ref) DO NOTHING`,
  ).bind(crypto.randomUUID(), userId, ref, keyId, threadId, nowIso(), userId).run();
  return (r.meta?.changes ?? 0) > 0;
}

export async function refundApiCredit(db: D1Database, userId: string, ref: string): Promise<void> {
  await db.prepare(
    `INSERT INTO api_credit_ledger (id, user_id, delta, reason, ref, created_at)
     SELECT ?, ?, 1, 'refund', ?, ? WHERE EXISTS (SELECT 1 FROM api_credit_ledger WHERE ref = ? AND user_id = ?)
     ON CONFLICT(ref) DO NOTHING`,
  ).bind(crypto.randomUUID(), userId, `refund:${ref}`, nowIso(), ref, userId).run();
}

export async function grantApiCredits(db: D1Database, userId: string, credits: number, ref: string): Promise<boolean> {
  const r = await db.prepare(
    `INSERT INTO api_credit_ledger (id, user_id, delta, reason, ref, created_at) VALUES (?, ?, ?, 'purchase', ?, ?)
     ON CONFLICT(ref) DO NOTHING`,
  ).bind(crypto.randomUUID(), userId, credits, ref, nowIso()).run();
  return (r.meta?.changes ?? 0) > 0;
}

export const listApiLedger = async (db: D1Database, userId: string, limit = 50): Promise<LedgerEntry[]> =>
  (await db.prepare(
    'SELECT id, delta, reason, ref, api_key_id, thread_id, created_at FROM api_credit_ledger WHERE user_id = ? ORDER BY created_at DESC LIMIT ?',
  ).bind(userId, limit).all<LedgerEntry>()).results;
