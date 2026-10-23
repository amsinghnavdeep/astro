/** Owner-editable Kaal answer style: current text in `settings`, every save in `kaal_prompt_history`. */
import type { D1Database } from '@cloudflare/workers-types';
import { DEFAULT_KAAL_PROMPTS, type KaalPrompts } from './devin.js';

export type KaalKey = keyof KaalPrompts;
export const KAAL_FIELDS: { key: KaalKey; label: string; help: string }[] = [
  { key: 'style', label: 'How Kaal answers', help: 'Every answer: empathy, Answer, Why, Predictions, Issue, Remedy, length, Ask me next.' },
  { key: 'freeHook', label: 'Trial consultation extras', help: 'Added only to a trial consultation: From your past, Kaal sees more.' },
  { key: 'opening', label: 'First message greeting', help: 'How Kaal opens a new consultation.' },
];
export const KAAL_MIN_CHARS = 20;
export const KAAL_MAX_CHARS = 8000;
const dbKey = (k: KaalKey) => `kaal_${k}`;
export const isKaalKey = (k: string): k is KaalKey => KAAL_FIELDS.some((f) => f.key === k);

export interface KaalField { key: KaalKey; label: string; help: string; body: string; isOriginal: boolean; updatedAt: string | null; updatedBy: string | null }
export interface KaalVersion { id: number; key: KaalKey; body: string; changed_by: string; changed_at: string }

async function rows(db: D1Database) {
  const r = await db.prepare("SELECT key, value, updated_at, updated_by FROM settings WHERE key LIKE 'kaal\\_%' ESCAPE '\\'")
    .all<{ key: string; value: string; updated_at: string; updated_by: string }>();
  return new Map(r.results.map((x) => [x.key, x]));
}

/** Prompts for a NEW consultation; existing sessions keep the text they started with. */
export async function getKaalPrompts(db: D1Database): Promise<KaalPrompts> {
  try {
    const m = await rows(db);
    const pick = (k: KaalKey) => m.get(dbKey(k))?.value || DEFAULT_KAAL_PROMPTS[k];
    return { style: pick('style'), freeHook: pick('freeHook'), opening: pick('opening') };
  } catch (err) {
    console.error('Kaal prompts unavailable, using defaults:', err);
    return DEFAULT_KAAL_PROMPTS;
  }
}

export async function kaalFields(db: D1Database): Promise<KaalField[]> {
  const m = await rows(db);
  return KAAL_FIELDS.map((f) => {
    const r = m.get(dbKey(f.key));
    return { ...f, body: r?.value || DEFAULT_KAAL_PROMPTS[f.key], isOriginal: !r, updatedAt: r?.updated_at ?? null, updatedBy: r?.updated_by ?? null };
  });
}

/** Saves a new version; null (or the built-in text) restores the original. Returns false if nothing changed. */
export async function setKaalPrompt(db: D1Database, key: KaalKey, body: string | null, by: string): Promise<boolean> {
  const text = body === null || body === DEFAULT_KAAL_PROMPTS[key] ? null : body;
  const cur = (await rows(db)).get(dbKey(key))?.value ?? null;
  if (cur === text) return false;
  const now = new Date().toISOString();
  await db.batch([
    text === null
      ? db.prepare('DELETE FROM settings WHERE key = ?').bind(dbKey(key))
      : db.prepare(`INSERT INTO settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`)
        .bind(dbKey(key), text, now, by),
    db.prepare('INSERT INTO kaal_prompt_history (key, body, changed_by, changed_at) VALUES (?, ?, ?, ?)').bind(key, text ?? '', by, now),
  ]);
  return true;
}

export async function kaalHistory(db: D1Database, limit = 100): Promise<KaalVersion[]> {
  return (await db.prepare('SELECT id, key, body, changed_by, changed_at FROM kaal_prompt_history ORDER BY id DESC LIMIT ?')
    .bind(limit).all<KaalVersion>()).results;
}

export async function kaalVersion(db: D1Database, id: number): Promise<KaalVersion | null> {
  return db.prepare('SELECT id, key, body, changed_by, changed_at FROM kaal_prompt_history WHERE id = ?').bind(id).first<KaalVersion>();
}
