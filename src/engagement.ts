/** Cron emails: credit expiry notices, influencer motivation emails and festival offers. Every send is logged once in email_log. */
import type { D1Database } from '@cloudflare/workers-types';
import { env } from './env.js';
import { creditLots, type Pool } from './credits.js';
import { activeDeal } from './festivals.js';
import { PAYOUT_MIN_CENTS } from './partners.js';
import { sendEarnedEmail, sendExpiryEmail, sendFestivalEmail, sendInfluencerDigestEmail } from './email.js';

const DAY = 86_400_000;
const iso = (ms: number): string => new Date(ms).toISOString();
const usd = (cents: number): string => `$${(cents / 100).toFixed(2)}`;
const plural = (n: number, w: string): string => `${n} ${w}${n === 1 ? '' : 's'}`;
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

const POST_IDEAS = [
  'Ask Kaal one question about your year, then share the dated answer in a story with your link.',
  'Ask your followers "Want to know your best months for career this year?" and reply with your link.',
  'Pin your link in your bio and in your top comment this week.',
  'Make a short reel: "I asked an AI astrologer when I\'ll get married", show the answer, link in bio.',
  'Share your link in family WhatsApp groups: the first question is free and your link adds one more.',
  'Post the festival dates coming up and tell people Kaalera gives 10% off during festivals.',
];

async function once(db: D1Database, userId: string, kind: string, ref: string, send: () => Promise<void>): Promise<boolean> {
  const r = await db.prepare('INSERT INTO email_log (user_id, kind, ref, sent_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING')
    .bind(userId, kind, ref, iso(Date.now())).run();
  if (!r.meta?.changes) return false;
  try {
    await send();
    return true;
  } catch (err) {
    console.error(`Email ${kind} failed:`, err);
    await db.prepare('DELETE FROM email_log WHERE user_id = ? AND kind = ? AND ref = ?').bind(userId, kind, ref).run();
    return false;
  }
}

export async function unsubUrl(db: D1Database, userId: string): Promise<string> {
  const fresh = Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) => b.toString(16).padStart(2, '0')).join('');
  await db.prepare('UPDATE users SET unsub_token = COALESCE(unsub_token, ?) WHERE id = ?').bind(fresh, userId).run();
  const t = (await db.prepare('SELECT unsub_token FROM users WHERE id = ?').bind(userId).first<{ unsub_token: string }>())?.unsub_token ?? fresh;
  return `${env.siteUrl}/unsubscribe?t=${t}`;
}

export const validUnsubToken = (t: string): boolean => /^[a-f0-9]{48}$/.test(t);

export async function unsubscribe(db: D1Database, token: string): Promise<boolean> {
  if (!validUnsubToken(token)) return false;
  return !!(await db.prepare('UPDATE users SET email_unsub = 1 WHERE unsub_token = ?').bind(token).run()).meta?.changes;
}

/** Paid questions and API wallet credit expiring in 7 days or tomorrow, and open consultations closing tomorrow. */
export async function sendExpiryReminders(db: D1Database, now = Date.now()): Promise<number> {
  let sent = 0;
  const pools: [Pool, number, string][] = [['chat', env.chat.creditDays, 'chat_credit_ledger'], ['api', env.api.creditDays, 'api_credit_ledger']];
  for (const [pool, life, table] of pools) {
    for (const lead of [7, 1]) {
      const users = (await db.prepare(
        `SELECT DISTINCT l.user_id, u.email FROM ${table} l JOIN users u ON u.id = l.user_id
         WHERE l.delta > 0 AND l.created_at > ? AND l.created_at <= ? LIMIT 500`,
      ).bind(iso(now + (lead - 1 - life) * DAY), iso(now + (lead - life) * DAY)).all<{ user_id: string; email: string }>()).results;
      for (const u of users) {
        const due = (await creditLots(db, pool, u.user_id, now)).filter((l) => {
          const left = Date.parse(l.expiresAt) - now;
          return left > (lead - 1) * DAY && left <= lead * DAY;
        });
        if (!due.length) continue;
        const n = due.reduce((a, l) => a + l.credits, 0);
        const what = pool === 'chat' ? plural(n, 'paid question') : `${usd(n)} of API wallet credit`;
        const ok = await once(db, u.user_id, `exp_${pool}_${lead}`, due[0].expiresAt.slice(0, 10), () => sendExpiryEmail({
          to: u.email, what, when: lead === 1 ? 'tomorrow' : 'in 7 days',
          link: pool === 'chat' ? `${env.siteUrl}/?app=1` : `${env.siteUrl}/developers`, cta: pool === 'chat' ? 'Ask Kaal now' : 'Open Developers',
        }));
        if (ok) sent++;
      }
    }
  }
  const closing = (await db.prepare(
    `SELECT t.id, t.user_id, t.full_name, u.email, t.questions_allowed - t.questions_used AS left FROM threads t JOIN users u ON u.id = t.user_id
     WHERE t.status = 'active' AND t.api_key_id IS NULL AND t.questions_used < t.questions_allowed AND t.expires_at > ? AND t.expires_at <= ? LIMIT 500`,
  ).bind(now, now + DAY).all<{ id: string; user_id: string; full_name: string; email: string; left: number }>()).results;
  for (const t of closing) {
    const ok = await once(db, t.user_id, 'exp_thread', t.id, () => sendExpiryEmail({
      to: t.email, what: `${plural(t.left, 'question')} in ${t.full_name}'s consultation`, when: 'tomorrow',
      link: `${env.siteUrl}/?t=${t.id}`, cta: 'Ask Kaal now',
    }));
    if (ok) sent++;
  }
  return sent;
}

async function influencerNumbers(db: D1Database, code: string, sinceMs: number, now = Date.now()) {
  const [clicks, signups, earned, avail] = await Promise.all([
    db.prepare('SELECT COALESCE(SUM(n), 0) AS n FROM partner_clicks WHERE code = ? AND day >= ?').bind(code, iso(sinceMs).slice(0, 10)).first<{ n: number }>(),
    db.prepare('SELECT COUNT(*) AS n FROM users WHERE referred_code = ? AND created_at >= ?').bind(code, iso(sinceMs)).first<{ n: number }>(),
    db.prepare('SELECT COALESCE(SUM(commission_cents), 0) AS n FROM commissions WHERE code = ? AND created_at >= ?').bind(code, iso(sinceMs)).first<{ n: number }>(),
    db.prepare("SELECT COALESCE(SUM(commission_cents), 0) AS n FROM commissions WHERE code = ? AND status = 'pending' AND payout_id IS NULL AND available_at <= ?")
      .bind(code, iso(now)).first<{ n: number }>(),
  ]);
  return { clicks: clicks?.n ?? 0, signups: signups?.n ?? 0, earnedCents: earned?.n ?? 0, availableCents: avail?.n ?? 0 };
}

/** Mondays: weekly results to influencers with activity that week. 1st of the month: a monthly summary to the quiet ones. */
export async function sendInfluencerDigests(db: D1Database, now = new Date()): Promise<number> {
  const weekly = now.getUTCDay() === 1;
  const monthly = now.getUTCDate() === 1;
  if (!weekly && !monthly) return 0;
  const infs = (await db.prepare(
    "SELECT i.code, i.user_id, u.email FROM influencers i JOIN users u ON u.id = i.user_id WHERE i.status = 'active' AND u.email_unsub = 0 LIMIT 1000",
  ).all<{ code: string; user_id: string; email: string }>()).results;
  const idea = POST_IDEAS[Math.floor(now.getTime() / (7 * DAY)) % POST_IDEAS.length];
  let sent = 0;
  for (const i of infs) {
    const week = await influencerNumbers(db, i.code, now.getTime() - 7 * DAY, now.getTime());
    const active = week.clicks + week.signups + week.earnedCents > 0;
    let kind: string, ref: string, period: string, nums = week;
    if (weekly && active) {
      kind = 'inf_week'; ref = now.toISOString().slice(0, 10); period = 'This week';
    } else if (monthly) {
      kind = 'inf_month'; ref = now.toISOString().slice(0, 7); period = 'This month';
      nums = await influencerNumbers(db, i.code, now.getTime() - 30 * DAY, now.getTime());
    } else continue;
    const unsub = await unsubUrl(db, i.user_id);
    const ok = await once(db, i.user_id, kind, ref, () => sendInfluencerDigestEmail({
      to: i.email, code: i.code, period, ...nums, minCents: PAYOUT_MIN_CENTS,
      shareLink: `${env.siteUrl}/?code=${i.code}`, idea, dashboard: `${env.siteUrl}/influencers`, unsubUrl: unsub,
    }));
    if (ok) { sent++; await pause(600); }
  }
  return sent;
}

/** Instant "you just earned" email when a referred customer makes their first paid consultation. */
export async function notifyEarned(db: D1Database, code: string, cents: number): Promise<void> {
  const i = await db.prepare('SELECT i.user_id, u.email, u.email_unsub FROM influencers i JOIN users u ON u.id = i.user_id WHERE i.code = ?')
    .bind(code).first<{ user_id: string; email: string; email_unsub: number }>();
  if (!i || i.email_unsub || cents <= 0) return;
  const nums = await influencerNumbers(db, code, Date.now());
  await sendEarnedEmail({
    to: i.email, code, cents, availableCents: nums.availableCents, minCents: PAYOUT_MIN_CENTS,
    dashboard: `${env.siteUrl}/influencers`, unsubUrl: await unsubUrl(db, i.user_id),
  });
}

/** During a festival deal: email website customers who paid in the last 2 years and people who opted in to offers. CASL: nobody else. API-only customers are excluded. */
export async function sendFestivalEmails(db: D1Database, now = Date.now()): Promise<number> {
  const deal = await activeDeal(db, iso(now).slice(0, 10));
  if (!deal) return 0;
  const users = (await db.prepare(
    `SELECT u.id, u.email, u.name FROM users u WHERE u.email_unsub = 0 AND u.account_type = 'personal'
       AND (EXISTS (SELECT 1 FROM payments p WHERE p.user_id = u.id AND p.kind != 'api_credits' AND p.created_at >= ?)
         OR EXISTS (SELECT 1 FROM email_leads l WHERE l.email = u.email AND l.marketing_opt_in = 1))
       AND NOT EXISTS (SELECT 1 FROM email_log e WHERE e.user_id = u.id AND e.kind = 'festival' AND e.ref = ?)
     LIMIT 800`,
  ).bind(iso(now - 730 * DAY), deal.id).all<{ id: string; email: string; name: string }>()).results;
  let sent = 0;
  for (const u of users) {
    const unsub = await unsubUrl(db, u.id);
    const ok = await once(db, u.id, 'festival', deal.id, () => sendFestivalEmail({
      to: u.email, name: u.name.split(' ')[0] ?? '', festival: deal.name, percent: deal.percent, endsOn: deal.endsOn,
      link: `${env.siteUrl}/?app=1`, unsubUrl: unsub,
    }));
    if (ok) { sent++; await pause(600); }
  }
  return sent;
}
