/** Hindu festival deals: a % off chat prices during each festival's window (dates from Drik Panchang, New Delhi). */
import type { D1Database } from '@cloudflare/workers-types';
import { getPrices, type Prices } from './settings.js';

export interface Deal { id: string; name: string; percent: number; endsOn: string }
export interface Festival { id: string; name: string; festival_date: string; starts_on: string; ends_on: string; percent: number; enabled: number }
export type ChatPrices = Prices & { deal: Deal | null; fullPackCents: number; fullExtraQuestionCents: number };

const DAY = 86_400_000;
const today = (): string => new Date().toISOString().slice(0, 10);
const off = (cents: number, percent: number): number => Math.round((cents * (100 - percent)) / 100);
const shift = (day: string, days: number): string => new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);

export async function activeDeal(db: D1Database, day = today()): Promise<Deal | null> {
  const f = await db.prepare('SELECT id, name, percent, ends_on FROM festivals WHERE enabled = 1 AND percent > 0 AND starts_on <= ? AND ends_on >= ? ORDER BY starts_on LIMIT 1')
    .bind(day, day).first<{ id: string; name: string; percent: number; ends_on: string }>();
  return f ? { id: f.id, name: f.name, percent: f.percent, endsOn: f.ends_on } : null;
}

/** Website chat prices with any running festival discount applied (API prices are never discounted). */
export async function chatPrices(db: D1Database): Promise<ChatPrices> {
  const [p, deal] = await Promise.all([getPrices(db), activeDeal(db)]);
  return {
    ...p, deal, fullPackCents: p.chatPackCents, fullExtraQuestionCents: p.extraQuestionCents,
    chatPackCents: deal ? off(p.chatPackCents, deal.percent) : p.chatPackCents,
    extraQuestionCents: deal ? off(p.extraQuestionCents, deal.percent) : p.extraQuestionCents,
  };
}

export const listFestivals = async (db: D1Database): Promise<Festival[]> =>
  (await db.prepare('SELECT * FROM festivals ORDER BY festival_date').all<Festival>()).results;

export async function updateFestival(db: D1Database, id: string, o: { enabled?: boolean; percent?: number; festivalDate?: string }): Promise<boolean> {
  const date = o.festivalDate ?? null;
  const r = await db.prepare(
    `UPDATE festivals SET enabled = COALESCE(?, enabled), percent = COALESCE(?, percent),
       festival_date = COALESCE(?, festival_date), starts_on = COALESCE(?, starts_on), ends_on = COALESCE(?, ends_on) WHERE id = ?`,
  ).bind(o.enabled === undefined ? null : o.enabled ? 1 : 0, o.percent ?? null, date, date && shift(date, -1), date && shift(date, 1), id).run();
  return !!r.meta?.changes;
}
