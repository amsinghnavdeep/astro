/** Opt-in email reminders when a predicted window from Kaal's answer opens. */
import type { D1Database } from '@cloudflare/workers-types';
import { sendReminderEmail } from './email.js';
import { env } from './env.js';

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
export const MAX_REMINDERS_PER_THREAD = 12;

/** First day of the window, e.g. "Nov 2026 – Jan 2027" → 2026-11-01, "Jun–Sep 2027" → 2027-06-01. */
export function windowStart(when: string): string | null {
  const year = when.match(/\b(20\d{2})\b/)?.[1];
  if (!year) return null;
  const m = when.toLowerCase().match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/);
  let month = m ? MONTHS.indexOf(m[1]) : /\blate\b/i.test(when) ? 8 : /\bmid\b/i.test(when) ? 5 : 0;
  return `${year}-${String(month + 1).padStart(2, '0')}-01`;
}

export async function addReminder(
  db: D1Database, userId: string, threadId: string, area: string, when: string, today = new Date().toISOString().slice(0, 10),
): Promise<{ remindOn: string } | { error: string }> {
  const start = windowStart(when);
  if (!start) return { error: 'This window has no date to remind you about.' };
  if (start.slice(0, 7) <= today.slice(0, 7)) return { error: 'This window has already started. Ask Kaal about it now.' };
  const n = await db.prepare('SELECT COUNT(*) AS n FROM reminders WHERE thread_id = ?').bind(threadId).first<{ n: number }>();
  if ((n?.n ?? 0) >= MAX_REMINDERS_PER_THREAD) return { error: 'You have the most reminders for this consultation.' };
  await db.prepare(
    'INSERT INTO reminders (id, user_id, thread_id, area, when_text, remind_on, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING',
  ).bind(crypto.randomUUID(), userId, threadId, area.slice(0, 80), when.slice(0, 60), start, new Date().toISOString()).run();
  return { remindOn: start };
}

export async function listReminders(db: D1Database, threadId: string): Promise<{ area: string; when: string; remindOn: string }[]> {
  const r = await db.prepare('SELECT area, when_text, remind_on FROM reminders WHERE thread_id = ?').bind(threadId)
    .all<{ area: string; when_text: string; remind_on: string }>();
  return r.results.map((x) => ({ area: x.area, when: x.when_text, remindOn: x.remind_on }));
}

/** Daily job: email every reminder whose window opens today or earlier and hasn't been sent. */
export async function sendDueReminders(db: D1Database, today = new Date().toISOString().slice(0, 10)): Promise<number> {
  const due = (await db.prepare(
    `SELECT r.id, r.thread_id, r.area, r.when_text, u.email, t.full_name FROM reminders r
     JOIN users u ON u.id = r.user_id JOIN threads t ON t.id = r.thread_id
     WHERE r.sent_at IS NULL AND r.remind_on <= ? LIMIT 200`,
  ).bind(today).all<{ id: string; thread_id: string; area: string; when_text: string; email: string; full_name: string }>()).results;
  let sent = 0;
  for (const r of due) {
    const claim = await db.prepare('UPDATE reminders SET sent_at = ? WHERE id = ? AND sent_at IS NULL').bind(new Date().toISOString(), r.id).run();
    if (!claim.meta?.changes) continue;
    try {
      await sendReminderEmail({ to: r.email, name: r.full_name, area: r.area, when: r.when_text, link: `${env.siteUrl}/?t=${r.thread_id}` });
      sent++;
    } catch (err) {
      console.error('Reminder email failed:', err);
      await db.prepare('UPDATE reminders SET sent_at = NULL WHERE id = ?').bind(r.id).run();
    }
  }
  return sent;
}
