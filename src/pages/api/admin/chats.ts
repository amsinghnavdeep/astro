/**
 * Protected admin API for the Pandit chat.
 *
 *   GET  /api/admin/chats                    → per-thread usage + ACU unit economics
 *   POST /api/admin/chats {email, credits}   → grant (or, if negative, remove) credits
 */
export const prerender = false;
import type { APIRoute } from 'astro';
import { z } from 'zod';
import { authorized } from '../../../lib/adminAuth';
import { findUserByEmail } from '../../../lib/auth';
import { addCredits, creditBalance } from '../../../lib/chat';

export const GET: APIRoute = async ({ request, locals }) => {
  if (!authorized(request)) return json({ error: 'Unauthorized' }, 401);
  const db = locals.runtime.env.SIDDH_DB;
  if (!db) return json({ error: 'Database not configured' }, 500);
  const res = await db
    .prepare(
      `SELECT t.id, u.email, t.full_name, t.pandit, t.status, t.devin_session_id, t.acus_consumed, t.created_at,
              SUM(CASE WHEN m.role = 'user' THEN 1 ELSE 0 END) AS questions,
              SUM(CASE WHEN m.role = 'pandit' THEN 1 ELSE 0 END) AS answers
       FROM chat_threads t JOIN users u ON u.id = t.user_id
       LEFT JOIN chat_messages m ON m.thread_id = t.id
       GROUP BY t.id ORDER BY t.created_at DESC LIMIT 500`,
    )
    .all();
  const threads = res.results as { acus_consumed: number; questions: number }[];
  const totalAcus = threads.reduce((s, t) => s + (t.acus_consumed || 0), 0);
  const totalQuestions = threads.reduce((s, t) => s + (t.questions || 0), 0) + threads.length;
  return json({
    threads,
    totals: {
      threads: threads.length,
      creditsUsed: totalQuestions,
      acus: totalAcus,
      acusPerCredit: totalQuestions ? totalAcus / totalQuestions : 0,
    },
  });
};

export const POST: APIRoute = async ({ request, locals }) => {
  if (!authorized(request)) return json({ error: 'Unauthorized' }, 401);
  const db = locals.runtime.env.SIDDH_DB;
  if (!db) return json({ error: 'Database not configured' }, 500);
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  const parsed = z
    .object({ email: z.string().email(), credits: z.number().int().min(-1000).max(1000).refine((n) => n !== 0) })
    .safeParse(payload);
  if (!parsed.success) return json({ error: 'Invalid input', issues: parsed.error.issues }, 400);
  const user = await findUserByEmail(db, parsed.data.email);
  if (!user) return json({ error: 'User not found' }, 404);
  await addCredits(db, user.id, parsed.data.credits, 'admin', `admin:${crypto.randomUUID()}`);
  return json({ email: user.email, credits: await creditBalance(db, user.id) });
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
