/** Prepaid credit pools with per-purchase expiry; spending uses the oldest unexpired credits first. */
import type { D1Database } from '@cloudflare/workers-types';
import { env } from './env.js';

export type Pool = 'api' | 'chat';
const TABLE: Record<Pool, string> = { api: 'api_credit_ledger', chat: 'chat_credit_ledger' };
const DAY = 86_400_000;
const lifeMs = (pool: Pool): number => (pool === 'api' ? env.api.creditDays : env.chat.creditDays) * DAY;
const nowIso = (): string => new Date().toISOString();

export interface CreditLot { credits: number; expiresAt: string }

/** Unexpired credits per purchase (and per returned credit), oldest first. */
export async function creditLots(db: D1Database, pool: Pool, userId: string, now = Date.now()): Promise<CreditLot[]> {
  const rows = (await db.prepare(`SELECT delta, created_at FROM ${TABLE[pool]} WHERE user_id = ? ORDER BY created_at, rowid`)
    .bind(userId).all<{ delta: number; created_at: string }>()).results;
  const life = lifeMs(pool);
  const lots: { exp: number; rem: number }[] = [];
  for (const r of rows) {
    const at = Date.parse(r.created_at);
    if (r.delta > 0) {
      lots.push({ exp: at + life, rem: r.delta });
      continue;
    }
    let need = -r.delta;
    for (const l of lots) {
      if (need <= 0) break;
      if (l.exp <= at || l.rem <= 0) continue;
      const take = Math.min(l.rem, need);
      l.rem -= take;
      need -= take;
    }
  }
  return lots.filter((l) => l.rem > 0 && l.exp > now).map((l) => ({ credits: l.rem, expiresAt: new Date(l.exp).toISOString() }));
}

export const creditBalance = async (db: D1Database, pool: Pool, userId: string): Promise<number> =>
  (await creditLots(db, pool, userId)).reduce((n, l) => n + l.credits, 0);

export async function spendCredit(
  db: D1Database, pool: Pool, userId: string, ref: string, o: { keyId?: string | null; threadId?: string | null } = {},
): Promise<boolean> {
  if ((await creditBalance(db, pool, userId)) < 1) return false;
  const r = await db.prepare(
    `INSERT INTO ${TABLE[pool]} (id, user_id, delta, reason, ref, api_key_id, thread_id, created_at)
     SELECT ?, ?, -1, 'question', ?, ?, ?, ?
     WHERE (SELECT COALESCE(SUM(delta), 0) FROM ${TABLE[pool]} WHERE user_id = ?) >= 1
     ON CONFLICT(ref) DO NOTHING`,
  ).bind(crypto.randomUUID(), userId, ref, o.keyId ?? null, o.threadId ?? null, nowIso(), userId).run();
  return (r.meta?.changes ?? 0) > 0;
}

export async function refundCredit(db: D1Database, pool: Pool, userId: string, ref: string): Promise<void> {
  await db.prepare(
    `INSERT INTO ${TABLE[pool]} (id, user_id, delta, reason, ref, created_at)
     SELECT ?, ?, 1, 'refund', ?, ? WHERE EXISTS (SELECT 1 FROM ${TABLE[pool]} WHERE ref = ? AND user_id = ?)
     ON CONFLICT(ref) DO NOTHING`,
  ).bind(crypto.randomUUID(), userId, `refund:${ref}`, nowIso(), ref, userId).run();
}

export async function grantCredits(db: D1Database, pool: Pool, userId: string, credits: number, ref: string): Promise<boolean> {
  const r = await db.prepare(
    `INSERT INTO ${TABLE[pool]} (id, user_id, delta, reason, ref, created_at) VALUES (?, ?, ?, 'purchase', ?, ?)
     ON CONFLICT(ref) DO NOTHING`,
  ).bind(crypto.randomUUID(), userId, credits, ref, nowIso()).run();
  return (r.meta?.changes ?? 0) > 0;
}
