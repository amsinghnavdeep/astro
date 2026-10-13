/** D1 persistence for consultations plus the Devin bridge (create / deliver / sync). */
import type { D1Database } from '@cloudflare/workers-types';
import { env } from './env.js';
import {
  createChatSession, getSession, listSessionMessages, postSessionMessage, wrapCustomerMessage,
  type ChatPersona,
} from './devin.js';
import { refundApiCredit, spendApiCredit } from './api.js';
import { apiPrice, getPrices } from './settings.js';
import { grantCredits, refundCredit, spendCredit } from './credits.js';

export interface Thread {
  id: string; user_id: string; full_name: string; gender: string; date_of_birth: string;
  time_of_birth: string; place_of_birth: string; timezone: string; language: string;
  source: 'web' | 'api'; api_key_id: string | null; chart_text: string;
  first_question: string | null; devin_session_id: string | null; devin_cursor: string | null;
  status: 'awaiting_payment' | 'starting' | 'active' | 'failed'; is_free: number;
  questions_allowed: number; questions_used: number; acus_consumed: number;
  last_synced_at: number; created_at: string; expires_at: number | null;
  kundli_id?: string | null;
}
export interface Message {
  id: string; thread_id: string; role: 'user' | 'pandit'; body: string;
  devin_event_id: string | null; created_at: string;
}

const SYNC_INTERVAL_MS = 3000;
const MAX_UNANSWERED = 2;
const DAY_MS = 86_400_000;
const nowIso = (): string => new Date().toISOString();

export const isExpired = (t: Thread, now = Date.now()): boolean => t.expires_at !== null && now >= t.expires_at;
export const questionsLeft = (t: Thread): number => Math.max(0, t.questions_allowed - t.questions_used);

const personaOf = (t: Thread): ChatPersona => ({
  pandit: 'Kaal', language: t.language, fullName: t.full_name, gender: t.gender, dateOfBirth: t.date_of_birth,
  timeOfBirth: t.time_of_birth, placeOfBirth: t.place_of_birth, timezone: t.timezone, chartContext: t.chart_text,
});

export const listThreads = async (db: D1Database, userId: string): Promise<Thread[]> =>
  (await db.prepare("SELECT * FROM threads WHERE user_id = ? AND source = 'web' ORDER BY created_at DESC").bind(userId).all<Thread>()).results;

export const getThread = (db: D1Database, userId: string, id: string): Promise<Thread | null> =>
  db.prepare('SELECT * FROM threads WHERE id = ? AND user_id = ?').bind(id, userId).first<Thread>();

export const getThreadById = (db: D1Database, id: string): Promise<Thread | null> =>
  db.prepare('SELECT * FROM threads WHERE id = ?').bind(id).first<Thread>();

export const listMessages = async (db: D1Database, threadId: string): Promise<Message[]> =>
  (await db.prepare('SELECT * FROM messages WHERE thread_id = ? ORDER BY created_at, rowid').bind(threadId).all<Message>()).results;

export async function insertThread(db: D1Database, t: Thread): Promise<void> {
  await db.prepare(
    `INSERT INTO threads (id, user_id, full_name, gender, date_of_birth, time_of_birth, place_of_birth, timezone,
      language, source, api_key_id, chart_text, first_question, devin_session_id, devin_cursor, status, is_free, questions_allowed, questions_used,
      acus_consumed, last_synced_at, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    t.id, t.user_id, t.full_name, t.gender, t.date_of_birth, t.time_of_birth, t.place_of_birth, t.timezone,
    t.language, t.source, t.api_key_id, t.chart_text, t.first_question, t.devin_session_id, t.devin_cursor, t.status, t.is_free, t.questions_allowed,
    t.questions_used, t.acus_consumed, t.last_synced_at, t.created_at, t.expires_at,
  ).run();
}

export const insertMessage = (db: D1Database, m: Message) =>
  db.prepare(
    'INSERT INTO messages (id, thread_id, role, body, devin_event_id, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(devin_event_id) DO NOTHING',
  ).bind(m.id, m.thread_id, m.role, m.body, m.devin_event_id, m.created_at).run();

/** Atomically claims the account's one free consultation. */
export async function claimFreeConsultation(db: D1Database, userId: string): Promise<boolean> {
  const r = await db.prepare('UPDATE users SET free_used = 1 WHERE id = ? AND free_used = 0').bind(userId).run();
  return (r.meta?.changes ?? 0) > 0;
}

export async function releaseFreeConsultation(db: D1Database, userId: string): Promise<void> {
  await db.prepare('UPDATE users SET free_used = 0 WHERE id = ?').bind(userId).run();
}

/**
 * Opens the Devin session for a thread whose first question is already counted.
 * Claims the 'starting' state first so concurrent callers (webhook + redirect) start it once.
 */
export async function startThreadSession(db: D1Database, t: Thread): Promise<Thread> {
  const claim = await db.prepare(
    "UPDATE threads SET status = 'starting' WHERE id = ? AND status IN ('awaiting_payment', 'failed') AND devin_session_id IS NULL",
  ).bind(t.id).run();
  if ((claim.meta?.changes ?? 0) === 0 && t.status !== 'starting') return (await getThreadById(db, t.id)) ?? t;
  try {
    const s = await createChatSession(personaOf(t), {
      threadId: t.id, userId: t.user_id, firstQuestion: t.first_question ?? undefined, isFree: !!t.is_free,
    });
    const expiresAt = Date.now() + env.chat.consultationDays * DAY_MS;
    await db.prepare("UPDATE threads SET devin_session_id = ?, status = 'active', expires_at = ? WHERE id = ?")
      .bind(s.session_id, expiresAt, t.id).run();
  } catch (err) {
    await db.prepare("UPDATE threads SET status = 'failed' WHERE id = ?").bind(t.id).run();
    throw err;
  }
  return (await getThreadById(db, t.id))!;
}

export function pendingCount(messages: Message[]): number {
  let count = 0;
  for (let i = messages.length - 1; i >= 0 && messages[i].role === 'user'; i -= 1) count += 1;
  return count;
}

export type SendError = 'no_questions' | 'expired' | 'too_many_pending' | 'thread_unavailable' | 'delivery_failed';

export async function sendCustomerMessage(
  db: D1Database, t: Thread, text: string, language?: string, context?: string,
): Promise<{ message?: Message; error?: SendError }> {
  if (t.status !== 'active' || !t.devin_session_id) return { error: 'thread_unavailable' };
  if (isExpired(t)) return { error: 'expired' };
  if (pendingCount(await listMessages(db, t.id)) >= MAX_UNANSWERED) return { error: 'too_many_pending' };
  const id = crypto.randomUUID();
  const ref = `question:${id}`;
  let fromCredits = false;
  let spent = t.source === 'api'
    ? await spendApiCredit(db, t.user_id, ref, t.api_key_id, t.id, apiPrice(await getPrices(db)).questionCents)
    : ((await db.prepare(
        "UPDATE threads SET questions_used = questions_used + 1 WHERE id = ? AND status = 'active' AND questions_used < questions_allowed AND (expires_at IS NULL OR expires_at > ?)",
      ).bind(t.id, Date.now()).run()).meta?.changes ?? 0) > 0;
  if (!spent && t.source === 'web' && (await spendCredit(db, 'chat', t.user_id, ref, { threadId: t.id }))) {
    await db.prepare('UPDATE threads SET questions_used = questions_used + 1, questions_allowed = questions_allowed + 1 WHERE id = ?').bind(t.id).run();
    spent = fromCredits = true;
  }
  if (!spent) return { error: 'no_questions' };
  const lang = language ?? t.language;
  if (lang !== t.language) await db.prepare('UPDATE threads SET language = ? WHERE id = ?').bind(lang, t.id).run();
  const message: Message = { id, thread_id: t.id, role: 'user', body: text, devin_event_id: null, created_at: nowIso() };
  await insertMessage(db, message);
  try {
    await postSessionMessage(t.devin_session_id, (context ? `${context}\n\n` : '') + wrapCustomerMessage(text, lang), { retryOnInitializing: true });
  } catch (err) {
    console.error('Chat delivery failed:', err);
    await db.prepare('DELETE FROM messages WHERE id = ?').bind(id).run();
    if (t.source === 'api') await refundApiCredit(db, t.user_id, ref);
    else if (fromCredits) {
      await refundCredit(db, 'chat', t.user_id, ref);
      await db.prepare('UPDATE threads SET questions_used = questions_used - 1, questions_allowed = questions_allowed - 1 WHERE id = ?').bind(t.id).run();
    } else await db.prepare('UPDATE threads SET questions_used = questions_used - 1 WHERE id = ?').bind(t.id).run();
    return { error: 'delivery_failed' };
  }
  return { message };
}

/** Pull new astrologer replies (only `source: devin`), throttled per thread. */
export async function syncThread(db: D1Database, t: Thread): Promise<void> {
  if (!t.devin_session_id || Date.now() - t.last_synced_at < SYNC_INTERVAL_MS) return;
  const claim = await db.prepare('UPDATE threads SET last_synced_at = ? WHERE id = ? AND last_synced_at = ?')
    .bind(Date.now(), t.id, t.last_synced_at).run();
  if ((claim.meta?.changes ?? 0) === 0) return;
  let cursor = t.devin_cursor;
  let gotNew = false;
  for (let page = 0; page < 5; page += 1) {
    const { items, endCursor, hasNextPage } = await listSessionMessages(t.devin_session_id, cursor);
    for (const item of items) {
      if (item.source !== 'devin' || !item.message?.trim()) continue;
      const r = await insertMessage(db, {
        id: crypto.randomUUID(), thread_id: t.id, role: 'pandit', body: item.message.trim(),
        devin_event_id: item.event_id, created_at: new Date(item.created_at * 1000).toISOString(),
      });
      if ((r.meta?.changes ?? 0) > 0) gotNew = true;
    }
    if (endCursor) cursor = endCursor;
    if (!hasNextPage) break;
  }
  let acus = t.acus_consumed;
  if (gotNew) {
    try {
      const s = await getSession(t.devin_session_id);
      if (typeof s.acus_consumed === 'number') acus = s.acus_consumed;
    } catch { /* best-effort */ }
  }
  await db.prepare('UPDATE threads SET devin_cursor = ?, acus_consumed = ? WHERE id = ?').bind(cursor, acus, t.id).run();
}

export interface PaymentInfo {
  stripeSessionId: string; userId: string; threadId: string; kind: 'consultation' | 'topup';
  credits: number;
  amountCents: number; currency: string;
}

/**
 * Idempotent on the Stripe Checkout Session id. Returns the thread when this call
 * applied the payment (so the caller can start the Devin session), else null.
 */
export async function applyPayment(db: D1Database, p: PaymentInfo): Promise<Thread | null> {
  const t = await getThreadById(db, p.threadId);
  if (!t || t.user_id !== p.userId) throw new Error(`Payment ${p.stripeSessionId} references unknown thread ${p.threadId}`);
  const ins = await db.prepare(
    `INSERT INTO payments (stripe_session_id, user_id, thread_id, kind, amount_cents, currency, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(stripe_session_id) DO NOTHING`,
  ).bind(p.stripeSessionId, p.userId, p.threadId, p.kind, p.amountCents, p.currency, nowIso()).run();
  if ((ins.meta?.changes ?? 0) === 0) return null;
  await grantCredits(db, 'chat', p.userId, p.credits, `stripe:${p.stripeSessionId}`);
  if (p.kind === 'consultation' && t.questions_allowed < 1
    && (await spendCredit(db, 'chat', p.userId, `first:${t.id}`, { threadId: t.id }))) {
    await db.prepare('UPDATE threads SET questions_allowed = 1 WHERE id = ?').bind(t.id).run();
  }
  return getThreadById(db, p.threadId);
}

export const publicThread = (t: Thread, chatCredits = 0) => ({
  id: t.id, fullName: t.full_name, gender: t.gender, dateOfBirth: t.date_of_birth, timeOfBirth: t.time_of_birth,
  placeOfBirth: t.place_of_birth, language: t.language, status: t.status, isFree: !!t.is_free,
  questionsLeft: questionsLeft(t) + (t.source === 'web' && !isExpired(t) ? chatCredits : 0), questionsAllowed: t.questions_allowed,
  expired: isExpired(t), expiresAt: t.expires_at ? new Date(t.expires_at).toISOString() : null, createdAt: t.created_at,
  kundliId: t.kundli_id ?? null,
});

export const publicMessage = (m: Message) => ({ id: m.id, role: m.role, body: m.body, createdAt: m.created_at });
