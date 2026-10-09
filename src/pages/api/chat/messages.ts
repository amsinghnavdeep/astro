/**
 * Pandit chat messages.
 *
 *   GET  /api/chat/messages?threadId=…  → syncs replies from Devin, returns the
 *                                         conversation + pending count + credits
 *   POST /api/chat/messages {threadId, text} → ask a question (1 credit)
 */
export const prerender = false;
import type { APIRoute } from 'astro';
import { z } from 'zod';
import { env } from '../../../lib/env';
import {
  creditBalance,
  getThread,
  listMessages,
  pendingCount,
  publicMessage,
  publicThread,
  sendCustomerMessage,
  syncThread,
} from '../../../lib/chat';

const ERRORS: Record<string, { status: number; message: string }> = {
  no_credits: { status: 402, message: 'no_credits' },
  too_many_pending: { status: 429, message: 'Please wait for Pandit ji to answer your previous questions first.' },
  thread_unavailable: { status: 409, message: 'This consultation is unavailable. Please start a new one.' },
  delivery_failed: { status: 503, message: 'Your question could not be delivered. Your credit was refunded — please try again.' },
};

export const GET: APIRoute = async ({ request, locals }) => {
  if (!locals.user) return json({ error: 'account_required' }, 401);
  const db = locals.runtime.env.SIDDH_DB;
  if (!db) return json({ error: 'Database not configured' }, 500);

  const threadId = new URL(request.url).searchParams.get('threadId') ?? '';
  const thread = await getThread(db, locals.user.id, threadId);
  if (!thread) return json({ error: 'Not found' }, 404);

  try {
    await syncThread(db, thread);
  } catch (err) {
    console.error('Chat sync failed:', err);
  }
  const messages = await listMessages(db, thread.id);
  return json({
    thread: publicThread(thread),
    messages: messages.map(publicMessage),
    pending: thread.status === 'failed' ? 0 : pendingCount(messages),
    credits: await creditBalance(db, locals.user.id),
  });
};

export const POST: APIRoute = async ({ request, locals }) => {
  if (!locals.user) return json({ error: 'account_required' }, 401);
  const db = locals.runtime.env.SIDDH_DB;
  if (!db) return json({ error: 'Database not configured' }, 500);

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  const parsed = z
    .object({ threadId: z.string().min(1).max(64), text: z.string().trim().min(2).max(env.chat.maxMessageChars) })
    .safeParse(payload);
  if (!parsed.success) {
    return json({ error: `Please write a question of up to ${env.chat.maxMessageChars} characters.` }, 400);
  }

  const thread = await getThread(db, locals.user.id, parsed.data.threadId);
  if (!thread) return json({ error: 'Not found' }, 404);

  const result = await sendCustomerMessage(db, thread, parsed.data.text);
  const credits = await creditBalance(db, locals.user.id);
  if (!result.ok) {
    const e = ERRORS[result.error];
    return json({ error: e.message, credits }, e.status);
  }
  return json({ message: publicMessage(result.message), credits });
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
