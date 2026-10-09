/**
 * Pandit chat threads (one per saved birth profile).
 *
 *   GET  /api/chat/threads  → the user's threads, credit balance and packs
 *   POST /api/chat/threads  → save a birth profile, compute the chart and start
 *                             the astrologer session (costs 1 credit: the
 *                             opening reading)
 */
export const prerender = false;
import type { APIRoute } from 'astro';
import { z } from 'zod';
import { env } from '../../../lib/env';
import { randomPandit } from '../../../lib/pandits';
import { computeChart, chartToChatContext } from '../../../lib/kundli/chart';
import {
  creditBalance,
  insertThread,
  listThreads,
  publicThread,
  refundCredit,
  spendCredit,
  startThreadSession,
  type ChatThread,
} from '../../../lib/chat';

const MAX_THREADS = 10;

const profileSchema = z.object({
  fullName: z.string().trim().min(1).max(120),
  gender: z.enum(['Male', 'Female', 'Other']),
  dateOfBirth: z.string().trim().min(1).max(40),
  timeOfBirth: z.string().trim().min(1).max(20),
  placeOfBirth: z.string().trim().min(2).max(160),
  timezone: z.string().trim().min(1).max(64),
});

export const GET: APIRoute = async ({ locals }) => {
  if (!locals.user) return json({ error: 'account_required' }, 401);
  const db = locals.runtime.env.SIDDH_DB;
  if (!db) return json({ error: 'Database not configured' }, 500);
  const [threads, credits] = await Promise.all([
    listThreads(db, locals.user.id),
    creditBalance(db, locals.user.id),
  ]);
  return json({
    threads: threads.map(publicThread),
    credits,
    packs: env.chat.packs.map(({ id, credits: c, cents }) => ({ id, credits: c, cents, currency: 'usd' })),
  });
};

export const POST: APIRoute = async ({ request, locals }) => {
  if (!locals.user) return json({ error: 'account_required' }, 401);
  const db = locals.runtime.env.SIDDH_DB;
  if (!db) return json({ error: 'Database not configured' }, 500);
  const userId = locals.user.id;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  const parsed = profileSchema.safeParse(payload);
  if (!parsed.success) return json({ error: 'Please complete all birth details.', issues: parsed.error.issues }, 400);
  const p = parsed.data;

  if ((await listThreads(db, userId)).length >= MAX_THREADS) {
    return json({ error: `You can save up to ${MAX_THREADS} birth profiles.` }, 400);
  }

  let chartText: string;
  try {
    const chart = await computeChart(p);
    chartText = await chartToChatContext(chart);
  } catch (err) {
    console.error('Chat chart computation failed:', err);
    return json({ error: 'We could not compute this chart. Please check the date, time and birthplace (City, State, Country).' }, 400);
  }

  const id = crypto.randomUUID();
  const ref = `thread:${id}`;
  if (!(await spendCredit(db, userId, ref))) return json({ error: 'no_credits' }, 402);

  const now = new Date().toISOString();
  const thread: ChatThread = {
    id,
    user_id: userId,
    full_name: p.fullName,
    gender: p.gender,
    date_of_birth: p.dateOfBirth,
    time_of_birth: p.timeOfBirth,
    place_of_birth: p.placeOfBirth,
    timezone: p.timezone,
    pandit: randomPandit(),
    chart_text: chartText,
    devin_session_id: null,
    devin_cursor: null,
    status: 'starting',
    acus_consumed: 0,
    last_synced_at: 0,
    created_at: now,
    updated_at: now,
  };
  await insertThread(db, thread);
  try {
    await startThreadSession(db, thread);
  } catch {
    await refundCredit(db, userId, ref);
    return json({ error: 'Our astrologer is unavailable right now. Your credit was refunded — please try again shortly.' }, 503);
  }
  return json({ thread: publicThread({ ...thread, status: 'active' }), credits: await creditBalance(db, userId) });
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
