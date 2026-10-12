/** Customer support tickets: customers raise them on /support, the owner replies from /admin. */
import { Hono } from 'hono';
import { z } from 'zod';
import type { D1Database } from '@cloudflare/workers-types';
import { env } from './env.js';
import { sendSupportEmail } from './email.js';
import type { AppEnv } from './types.js';

export const TOPICS = ['prediction', 'payment', 'account', 'api', 'other'] as const;
export const TOPIC_LABEL: Record<(typeof TOPICS)[number], string> = {
  prediction: 'Prediction or answer', payment: 'Payment or refund', account: 'Account or sign-in', api: 'API', other: 'Something else',
};

export interface Ticket {
  id: number; user_id: string | null; email: string; name: string | null; topic: string; subject: string;
  thread_id: string | null; status: 'open' | 'answered' | 'closed'; created_at: string; updated_at: string;
}
export interface TicketMessage { id: string; ticket_id: number; author: 'customer' | 'support'; body: string; created_at: string }

export const ticketNumber = (id: number): string => `KAL-${1000 + id}`;
const nowIso = (): string => new Date().toISOString();
const DAILY_LIMIT = 5;

export const listTicketMessages = async (db: D1Database, ticketId: number): Promise<TicketMessage[]> =>
  (await db.prepare('SELECT * FROM ticket_messages WHERE ticket_id = ? ORDER BY created_at, rowid').bind(ticketId).all<TicketMessage>()).results;

export async function addTicketMessage(
  db: D1Database, ticketId: number, author: TicketMessage['author'], body: string, status: Ticket['status'],
): Promise<TicketMessage> {
  const m: TicketMessage = { id: crypto.randomUUID(), ticket_id: ticketId, author, body, created_at: nowIso() };
  await db.batch([
    db.prepare('INSERT INTO ticket_messages (id, ticket_id, author, body, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(m.id, m.ticket_id, m.author, m.body, m.created_at),
    db.prepare('UPDATE tickets SET status = ?, updated_at = ? WHERE id = ?').bind(status, m.created_at, ticketId),
  ]);
  return m;
}

export const publicTicketMessage = (m: TicketMessage) => ({ id: m.id, author: m.author, body: m.body, createdAt: m.created_at });
const publicTicket = (t: Ticket, messages: TicketMessage[]) => ({
  id: t.id, number: ticketNumber(t.id), topic: t.topic, subject: t.subject, status: t.status, threadId: t.thread_id,
  createdAt: t.created_at, updatedAt: t.updated_at, messages: messages.map(publicTicketMessage),
});

/** Best-effort email; never fails the request. Skipped in local dev (DEV_LOGIN_LINKS=true). */
export async function notify(o: { to: string | undefined; subject: string; title: string; body: string; link?: string; replyTo?: string }): Promise<void> {
  if (!o.to) return;
  if (env.devLoginLinks) {
    console.log(`[dev] email skipped -> ${o.to}: ${o.subject}`);
    return;
  }
  try {
    await sendSupportEmail({ ...o, to: o.to });
  } catch (err) {
    console.error('Support email failed:', err);
  }
}

const ticketBody = z.object({
  email: z.string().trim().email().max(200).optional(),
  name: z.string().trim().max(80).optional(),
  topic: z.enum(TOPICS),
  subject: z.string().trim().min(3).max(140),
  message: z.string().trim().min(10).max(4000),
  threadId: z.string().trim().max(64).optional(),
});

export const support = new Hono<AppEnv>();

support.post('/tickets', async (c) => {
  const user = c.get('user');
  const p = ticketBody.safeParse(await c.req.json().catch(() => null));
  if (!p.success) return c.json({ error: 'Choose a topic, add a subject (3+ characters) and describe the issue (10+ characters).' }, 400);
  const email = (user?.email ?? p.data.email ?? '').toLowerCase();
  if (!email) return c.json({ error: 'Enter your email so we can reply.' }, 400);
  const db = c.env.DB;
  const recent = await db.prepare('SELECT COUNT(*) AS n FROM tickets WHERE email = ? AND created_at > ?')
    .bind(email, new Date(Date.now() - 86_400_000).toISOString()).first<{ n: number }>();
  if ((recent?.n ?? 0) >= DAILY_LIMIT) return c.json({ error: 'You have raised several tickets today. We will reply to those first.' }, 429);
  let threadId: string | null = null;
  if (user && p.data.threadId) {
    const t = await db.prepare('SELECT id FROM threads WHERE id = ? AND user_id = ?').bind(p.data.threadId, user.id).first<{ id: string }>();
    threadId = t?.id ?? null;
  }
  const now = nowIso();
  const row = await db.prepare(
    `INSERT INTO tickets (user_id, email, name, topic, subject, thread_id, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?) RETURNING id`,
  ).bind(user?.id ?? null, email, p.data.name || user?.name || null, p.data.topic, p.data.subject, threadId, now, now).first<{ id: number }>();
  const id = row!.id;
  await addTicketMessage(db, id, 'customer', p.data.message, 'open');
  const num = ticketNumber(id);
  await Promise.all([
    notify({
      to: env.support.email, subject: `New ticket ${num}: ${p.data.subject}`, title: `New ticket ${num}`,
      body: `From: ${email}\nTopic: ${TOPIC_LABEL[p.data.topic]}\n\n${p.data.message}`, link: `${env.siteUrl}/support`, replyTo: email,
    }),
    notify({
      to: email, subject: `We received your ticket ${num}`, title: `Ticket ${num} received`,
      body: `Thanks for writing to Kaalera. Our team will analyse the issue and reply to you by email.\n\nYour message:\n${p.data.message}`,
      link: `${env.siteUrl}/support`,
    }),
  ]);
  return c.json({ ticket: { id, number: num } }, 201);
});

support.get('/tickets', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'account_required' }, 401);
  const db = c.env.DB;
  const rows = (await db.prepare('SELECT * FROM tickets WHERE user_id = ? OR email = ? ORDER BY updated_at DESC LIMIT 50')
    .bind(user.id, user.email).all<Ticket>()).results;
  const tickets = await Promise.all(rows.map(async (t) => publicTicket(t, await listTicketMessages(db, t.id))));
  return c.json({ tickets });
});

support.post('/tickets/:id/messages', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'account_required' }, 401);
  const id = Number(c.req.param('id'));
  const db = c.env.DB;
  const t = Number.isInteger(id)
    ? await db.prepare('SELECT * FROM tickets WHERE id = ? AND (user_id = ? OR email = ?)').bind(id, user.id, user.email).first<Ticket>()
    : null;
  if (!t) return c.json({ error: 'Not found' }, 404);
  const p = z.object({ message: z.string().trim().min(2).max(4000) }).safeParse(await c.req.json().catch(() => null));
  if (!p.success) return c.json({ error: 'Write a message first.' }, 400);
  const m = await addTicketMessage(db, t.id, 'customer', p.data.message, 'open');
  await notify({
    to: env.support.email, subject: `Reply on ${ticketNumber(t.id)}: ${t.subject}`, title: `Customer replied on ${ticketNumber(t.id)}`,
    body: `From: ${t.email}\n\n${p.data.message}`, link: `${env.siteUrl}/support`, replyTo: t.email,
  });
  return c.json({ message: publicTicketMessage(m) }, 201);
});
