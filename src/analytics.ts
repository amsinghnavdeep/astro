/** Aggregate funnel counts and typed-email leads. No per-user analytics rows; admin sees totals only. */
import type { D1Database } from '@cloudflare/workers-types';

export const EVENTS = [
  'home_view', 'email_typed', 'signup', 'kundli_added', 'free_question', 'checkout_opened',
  'first_payment', 'repeat_payment', 'reminder_set',
] as const;
export type FunnelEvent = (typeof EVENTS)[number];
export const CLIENT_EVENTS: FunnelEvent[] = ['home_view'];

const today = () => new Date().toISOString().slice(0, 10);

export async function track(db: D1Database, event: FunnelEvent): Promise<void> {
  await db.prepare('INSERT INTO event_counts (day, event, n) VALUES (?, ?, 1) ON CONFLICT (day, event) DO UPDATE SET n = n + 1')
    .bind(today(), event).run();
}

export const trackSafe = (db: D1Database, event: FunnelEvent): Promise<void> =>
  track(db, event).catch((err) => console.error('Track failed:', err));

export async function funnel(db: D1Database, days: number): Promise<{ days: number; totals: Record<string, number>; daily: { day: string; event: string; n: number }[] }> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const rows = (await db.prepare('SELECT day, event, n FROM event_counts WHERE day >= ? ORDER BY day').bind(since).all<{ day: string; event: string; n: number }>()).results;
  const totals: Record<string, number> = Object.fromEntries(EVENTS.map((e) => [e, 0]));
  for (const r of rows) totals[r.event] = (totals[r.event] ?? 0) + r.n;
  const leads = await db.prepare('SELECT COUNT(*) AS typed, SUM(signed_up) AS joined, SUM(marketing_opt_in) AS optin FROM email_leads WHERE created_at >= ?')
    .bind(since).first<{ typed: number; joined: number | null; optin: number | null }>();
  totals.leads_abandoned = (leads?.typed ?? 0) - (leads?.joined ?? 0);
  totals.leads_opted_in = leads?.optin ?? 0;
  return { days, totals, daily: rows };
}

/** Saves an email typed into the sign-in form. Returns true only the first time it is seen. */
export async function saveLead(db: D1Database, email: string, optIn: boolean): Promise<boolean> {
  const now = new Date().toISOString();
  const r = await db.prepare(
    `INSERT INTO email_leads (email, marketing_opt_in, created_at, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (email) DO UPDATE SET marketing_opt_in = MAX(marketing_opt_in, excluded.marketing_opt_in), updated_at = excluded.updated_at`,
  ).bind(email, optIn ? 1 : 0, now, now).run();
  const fresh = await db.prepare('SELECT created_at = updated_at AS fresh FROM email_leads WHERE email = ?').bind(email).first<{ fresh: number }>();
  return !!r.success && !!fresh?.fresh;
}

export const markLeadSignedUp = (db: D1Database, email: string): Promise<unknown> =>
  db.prepare('UPDATE email_leads SET signed_up = 1, updated_at = ? WHERE email = ?').bind(new Date().toISOString(), email).run();

export async function trackPayment(db: D1Database, userId: string): Promise<void> {
  const n = await db.prepare('SELECT COUNT(*) AS n FROM payments WHERE user_id = ?').bind(userId).first<{ n: number }>().catch(() => null);
  await trackSafe(db, (n?.n ?? 0) <= 1 ? 'first_payment' : 'repeat_payment');
}
