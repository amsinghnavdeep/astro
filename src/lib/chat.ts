/**
 * "Ask Pandit ji" live chat: D1 persistence, credit ledger and the sync loop
 * that pulls the astrologer's replies from the thread's Devin session.
 */
import type { D1Database } from '@cloudflare/workers-types';
import {
  createChatSession,
  getSession,
  listSessionMessages,
  postSessionMessage,
  wrapCustomerMessage,
  type ChatPersona,
} from './devin';

export interface ChatThread {
  id: string;
  user_id: string;
  full_name: string;
  gender: string;
  date_of_birth: string;
  time_of_birth: string;
  place_of_birth: string;
  timezone: string;
  pandit: string;
  chart_text: string;
  devin_session_id: string | null;
  devin_cursor: string | null;
  status: 'starting' | 'active' | 'failed';
  acus_consumed: number;
  last_synced_at: number;
  created_at: string;
  updated_at: string;
}

export interface ChatMessage {
  id: string;
  thread_id: string;
  role: 'user' | 'pandit';
  body: string;
  devin_event_id: string | null;
  created_at: string;
}

const SYNC_INTERVAL_MS = 3000;
const MAX_UNANSWERED = 3;

const nowIso = (): string => new Date().toISOString();

export function personaOf(t: ChatThread): ChatPersona {
  return {
    pandit: t.pandit,
    fullName: t.full_name,
    gender: t.gender,
    dateOfBirth: t.date_of_birth,
    timeOfBirth: t.time_of_birth,
    placeOfBirth: t.place_of_birth,
    timezone: t.timezone,
    chartContext: t.chart_text,
  };
}

// ---------- credits ----------

export async function creditBalance(db: D1Database, userId: string): Promise<number> {
  const row = await db
    .prepare('SELECT COALESCE(SUM(delta), 0) AS balance FROM chat_credit_ledger WHERE user_id = ?')
    .bind(userId)
    .first<{ balance: number }>();
  return row?.balance ?? 0;
}

/** Idempotent on `ref`: returns false if this ref was already applied. */
export async function addCredits(
  db: D1Database,
  userId: string,
  delta: number,
  reason: string,
  ref: string,
): Promise<boolean> {
  const res = await db
    .prepare(
      `INSERT INTO chat_credit_ledger (id, user_id, delta, reason, ref, created_at)
       VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(ref) DO NOTHING`,
    )
    .bind(crypto.randomUUID(), userId, delta, reason, ref, nowIso())
    .run();
  return (res.meta?.changes ?? 0) > 0;
}

/** Atomically debit one credit only if the balance allows it. */
export async function spendCredit(db: D1Database, userId: string, ref: string): Promise<boolean> {
  const res = await db
    .prepare(
      `INSERT INTO chat_credit_ledger (id, user_id, delta, reason, ref, created_at)
       SELECT ?, ?, -1, 'question', ?, ?
       WHERE (SELECT COALESCE(SUM(delta), 0) FROM chat_credit_ledger WHERE user_id = ?) >= 1
       ON CONFLICT(ref) DO NOTHING`,
    )
    .bind(crypto.randomUUID(), userId, ref, nowIso(), userId)
    .run();
  return (res.meta?.changes ?? 0) > 0;
}

export async function refundCredit(db: D1Database, userId: string, ref: string): Promise<void> {
  await addCredits(db, userId, 1, 'refund', `refund:${ref}`);
}

// ---------- threads & messages ----------

export async function listThreads(db: D1Database, userId: string): Promise<ChatThread[]> {
  const res = await db
    .prepare('SELECT * FROM chat_threads WHERE user_id = ? ORDER BY created_at DESC')
    .bind(userId)
    .all<ChatThread>();
  return res.results;
}

export async function getThread(db: D1Database, userId: string, id: string): Promise<ChatThread | null> {
  return db
    .prepare('SELECT * FROM chat_threads WHERE id = ? AND user_id = ?')
    .bind(id, userId)
    .first<ChatThread>();
}

export async function insertThread(db: D1Database, t: ChatThread): Promise<void> {
  await db
    .prepare(
      `INSERT INTO chat_threads (id, user_id, full_name, gender, date_of_birth, time_of_birth,
        place_of_birth, timezone, pandit, chart_text, devin_session_id, devin_cursor, status,
        acus_consumed, last_synced_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      t.id, t.user_id, t.full_name, t.gender, t.date_of_birth, t.time_of_birth,
      t.place_of_birth, t.timezone, t.pandit, t.chart_text, t.devin_session_id, t.devin_cursor,
      t.status, t.acus_consumed, t.last_synced_at, t.created_at, t.updated_at,
    )
    .run();
}

async function updateThread(
  db: D1Database,
  id: string,
  fields: Partial<Pick<ChatThread, 'devin_session_id' | 'devin_cursor' | 'status' | 'acus_consumed' | 'last_synced_at'>>,
): Promise<void> {
  const keys = Object.keys(fields) as (keyof typeof fields)[];
  if (!keys.length) return;
  const sets = [...keys.map((k) => `${k} = ?`), 'updated_at = ?'].join(', ');
  await db
    .prepare(`UPDATE chat_threads SET ${sets} WHERE id = ?`)
    .bind(...keys.map((k) => fields[k] ?? null), nowIso(), id)
    .run();
}

export async function listMessages(db: D1Database, threadId: string): Promise<ChatMessage[]> {
  const res = await db
    .prepare('SELECT * FROM chat_messages WHERE thread_id = ? ORDER BY created_at ASC, id ASC')
    .bind(threadId)
    .all<ChatMessage>();
  return res.results;
}

async function insertMessage(db: D1Database, m: ChatMessage): Promise<void> {
  await db
    .prepare(
      `INSERT INTO chat_messages (id, thread_id, role, body, devin_event_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(devin_event_id) DO NOTHING`,
    )
    .bind(m.id, m.thread_id, m.role, m.body, m.devin_event_id, m.created_at)
    .run();
}

async function deleteMessage(db: D1Database, id: string): Promise<void> {
  await db.prepare('DELETE FROM chat_messages WHERE id = ?').bind(id).run();
}

/** Customer messages still waiting for the Pandit's reply (plus the opening reading). */
export function pendingCount(messages: ChatMessage[]): number {
  let count = 0;
  for (let i = messages.length - 1; i >= 0 && messages[i].role === 'user'; i -= 1) count += 1;
  const hasPandit = messages.some((m) => m.role === 'pandit');
  return hasPandit ? count : count + 1;
}

// ---------- Devin bridge ----------

/** Start the thread's Devin session (opening reading is requested in the prompt). */
export async function startThreadSession(db: D1Database, t: ChatThread): Promise<void> {
  try {
    const session = await createChatSession(personaOf(t), { threadId: t.id, userId: t.user_id });
    await updateThread(db, t.id, { devin_session_id: session.session_id, status: 'active' });
  } catch (err) {
    console.error('Chat session creation failed:', err);
    await updateThread(db, t.id, { status: 'failed' });
    throw err;
  }
}

function transcriptOf(messages: ChatMessage[], maxChars = 12000): string {
  const lines: string[] = [];
  let used = 0;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    const line = `${m.role === 'user' ? 'CUSTOMER' : 'PANDIT'}: ${m.body}`;
    if (used + line.length > maxChars) break;
    lines.unshift(line);
    used += line.length;
  }
  return lines.join('\n\n');
}

/**
 * Deliver a customer message. If the session can no longer accept messages
 * (ACU cap reached, expired), start a fresh session seeded with the transcript.
 */
async function deliver(db: D1Database, t: ChatThread, text: string, history: ChatMessage[]): Promise<void> {
  const wrapped = wrapCustomerMessage(text);
  if (t.devin_session_id) {
    try {
      await postSessionMessage(t.devin_session_id, wrapped, { retryOnInitializing: true });
      return;
    } catch (err) {
      console.error('Chat message delivery failed; starting a continuation session:', err);
    }
  }
  const session = await createChatSession(personaOf(t), {
    threadId: t.id,
    userId: t.user_id,
    resumeTranscript: transcriptOf(history),
  });
  await updateThread(db, t.id, { devin_session_id: session.session_id, devin_cursor: null, status: 'active' });
  await postSessionMessage(session.session_id, wrapped, { retryOnInitializing: true });
}

export type SendResult =
  | { ok: true; message: ChatMessage }
  | { ok: false; error: 'no_credits' | 'too_many_pending' | 'thread_unavailable' | 'delivery_failed' };

export async function sendCustomerMessage(
  db: D1Database,
  t: ChatThread,
  text: string,
): Promise<SendResult> {
  if (t.status === 'failed' && !t.devin_session_id) return { ok: false, error: 'thread_unavailable' };
  const history = await listMessages(db, t.id);
  if (pendingCount(history) >= MAX_UNANSWERED) return { ok: false, error: 'too_many_pending' };

  const message: ChatMessage = {
    id: crypto.randomUUID(),
    thread_id: t.id,
    role: 'user',
    body: text,
    devin_event_id: null,
    created_at: nowIso(),
  };
  if (!(await spendCredit(db, t.user_id, `msg:${message.id}`))) return { ok: false, error: 'no_credits' };
  await insertMessage(db, message);
  try {
    await deliver(db, t, text, history);
  } catch (err) {
    console.error('Chat delivery failed:', err);
    await deleteMessage(db, message.id);
    await refundCredit(db, t.user_id, `msg:${message.id}`);
    return { ok: false, error: 'delivery_failed' };
  }
  return { ok: true, message };
}

/**
 * Pull new astrologer replies from Devin into D1 (throttled per thread).
 * Only `source: devin` messages are stored; our own prompts are never shown.
 */
export async function syncThread(db: D1Database, t: ChatThread): Promise<void> {
  if (!t.devin_session_id || Date.now() - t.last_synced_at < SYNC_INTERVAL_MS) return;
  await updateThread(db, t.id, { last_synced_at: Date.now() });

  let cursor = t.devin_cursor;
  let gotNew = false;
  for (let page = 0; page < 5; page += 1) {
    const { items, endCursor, hasNextPage } = await listSessionMessages(t.devin_session_id, cursor);
    for (const item of items) {
      if (item.source !== 'devin' || !item.message?.trim()) continue;
      gotNew = true;
      await insertMessage(db, {
        id: crypto.randomUUID(),
        thread_id: t.id,
        role: 'pandit',
        body: item.message.trim(),
        devin_event_id: item.event_id,
        created_at: new Date(item.created_at * 1000).toISOString(),
      });
    }
    if (endCursor) cursor = endCursor;
    if (!hasNextPage) break;
  }
  const fields: Parameters<typeof updateThread>[2] = {};
  if (cursor !== t.devin_cursor) fields.devin_cursor = cursor;
  if (gotNew) {
    try {
      const s = await getSession(t.devin_session_id);
      if (typeof s.acus_consumed === 'number') fields.acus_consumed = s.acus_consumed;
    } catch {
      // ACU tracking is best-effort.
    }
  }
  await updateThread(db, t.id, fields);
}

export function publicThread(t: ChatThread) {
  return {
    id: t.id,
    fullName: t.full_name,
    gender: t.gender,
    dateOfBirth: t.date_of_birth,
    timeOfBirth: t.time_of_birth,
    placeOfBirth: t.place_of_birth,
    pandit: t.pandit,
    status: t.status,
    createdAt: t.created_at,
  };
}

export function publicMessage(m: ChatMessage) {
  return { id: m.id, role: m.role, body: m.body, createdAt: m.created_at };
}
