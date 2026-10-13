/** Prices the owner can change from /admin. Stored in D1; env values are the defaults. */
import type { D1Database } from '@cloudflare/workers-types';
import { env } from './env.js';
import { TAX_FEE_PERCENT_DEFAULT } from './disclaimer.js';

export interface Prices {
  chatPackCents: number;
  extraQuestionCents: number;
  chatPackQuestions: number;
  freeQuestions: number;
  apiCreditCents: number;
  apiMinRechargeCents: number;
  taxFeePercent: number;
}
type PriceKey = keyof Prices;

export const PRICE_LIMITS: Record<PriceKey, [number, number]> = {
  chatPackCents: [100, 100_000],
  extraQuestionCents: [100, 100_000],
  chatPackQuestions: [1, 20],
  freeQuestions: [0, 5],
  apiCreditCents: [100, 100_000],
  apiMinRechargeCents: [0, 1_000_000],
  taxFeePercent: [0, 50],
};
const DB_KEY: Record<PriceKey, string> = {
  chatPackCents: 'chat_pack_cents',
  extraQuestionCents: 'extra_question_cents',
  chatPackQuestions: 'chat_pack_questions',
  freeQuestions: 'free_questions',
  apiCreditCents: 'api_credit_cents',
  apiMinRechargeCents: 'api_min_recharge_cents',
  taxFeePercent: 'tax_fee_percent',
};
const FIELDS = Object.keys(DB_KEY) as PriceKey[];
const API_PACK_SIZES = [10, 20, 100];
/** Starting an API consultation (with its first question) uses this many credits; each follow-up uses 1. */
export const API_START_CREDITS = 2;
const CACHE_MS = 15_000;

const defaults = (): Prices => ({
  chatPackCents: 1000,
  extraQuestionCents: 500,
  chatPackQuestions: 1,
  freeQuestions: env.chat.freeQuestions,
  apiCreditCents: 500,
  apiMinRechargeCents: 5000,
  taxFeePercent: TAX_FEE_PERCENT_DEFAULT,
});

let cache: { at: number; prices: Prices } | null = null;

export async function getPrices(db: D1Database): Promise<Prices> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.prices;
  const rows = (await db.prepare('SELECT key, value FROM settings').all<{ key: string; value: string }>()).results;
  const prices = defaults();
  for (const f of FIELDS) {
    const row = rows.find((r) => r.key === DB_KEY[f]);
    const n = row ? Number(row.value) : NaN;
    const [min, max] = PRICE_LIMITS[f];
    if (Number.isInteger(n) && n >= min && n <= max) prices[f] = n;
  }
  cache = { at: Date.now(), prices };
  return prices;
}

export async function setPrices(db: D1Database, patch: Partial<Prices>, by: string): Promise<Prices> {
  const current = await getPrices(db);
  const now = new Date().toISOString();
  const stmts = FIELDS.filter((f) => patch[f] !== undefined && patch[f] !== current[f]).flatMap((f) => [
    db.prepare(`INSERT INTO settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`)
      .bind(DB_KEY[f], String(patch[f]), now, by),
    db.prepare('INSERT INTO settings_audit (key, old_value, new_value, changed_by, changed_at) VALUES (?, ?, ?, ?, ?)')
      .bind(DB_KEY[f], String(current[f]), String(patch[f]), by, now),
  ]);
  if (stmts.length) await db.batch(stmts);
  cache = null;
  return getPrices(db);
}

export const priceHistory = async (db: D1Database) =>
  (await db.prepare('SELECT key, old_value, new_value, changed_by, changed_at FROM settings_audit ORDER BY id DESC LIMIT 50')
    .all<{ key: string; old_value: string | null; new_value: string; changed_by: string; changed_at: string }>()).results;

export const apiPacks = (p: Prices) =>
  API_PACK_SIZES.map((credits) => ({ id: `api${credits}`, credits, cents: credits * p.apiCreditCents }));

/** API keys only work once the account has paid at least this much for API credits in total. */
export async function apiActivated(db: D1Database, userId: string, p: Prices): Promise<boolean> {
  if (p.apiMinRechargeCents <= 0) return true;
  const row = await db.prepare("SELECT COALESCE(SUM(amount_cents), 0) AS cents FROM payments WHERE user_id = ? AND kind = 'api_credits'")
    .bind(userId).first<{ cents: number }>();
  return (row?.cents ?? 0) >= p.apiMinRechargeCents;
}

export const taxesAndFees = (cents: number, percent: number): number => Math.round((cents * percent) / 100);
