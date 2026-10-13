/**
 * Affiliates: a friend who signs up with ?ref= gets 1 bonus question on top of the free one;
 * the referrer gets 2 questions when that friend first pays (max 10 rewards a month).
 * Influencers: a customer who signs up with ?code= gets the same bonus; the influencer earns a
 * percentage of the pre-fee revenue of that customer's first paid consultation only.
 */
import type { D1Database } from '@cloudflare/workers-types';
import type { Context } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { grantCredits } from './credits.js';
import type { FreeKeys } from './freeclaims.js';
import { stripe } from './stripe.js';

const REF_COOKIE = 'kaalera_ref';
const CODE_RE = /^[A-Z0-9]{3,20}$/;
const RESERVED = ['KAAL', 'KAALERA', 'ADMIN', 'SUPPORT', 'FREE', 'TEST', 'STAFF', 'OFFICIAL', 'HELP'];
const BLOCKED = ['FUCK', 'SHIT', 'SEX', 'PORN', 'NAZI', 'RAPE', 'BITCH', 'CUNT', 'DICK'];
export const FRIEND_BONUS_QUESTIONS = 1;
export const REFERRER_REWARD_QUESTIONS = 2;
export const REFERRAL_MONTHLY_MAX = 10;
export const PAYOUT_MIN_CENTS = 5000;
export const PAYOUT_HOLD_DAYS = 30;
const DAY = 86_400_000;
const nowIso = (): string => new Date().toISOString();

type Partnered = { id: string; email: string; referred_by?: string | null; referred_code?: string | null; ref_code?: string | null; created_at: string };

export const normCode = (v: string): string => v.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');

/** Remember the first ?ref= / ?code= a visitor arrives with (30 days) and count influencer clicks. */
export async function captureReferral(c: Context, db: D1Database, raw: { ref?: string; code?: string }, secure: boolean): Promise<boolean> {
  if (getCookie(c, REF_COOKIE)) return false;
  const kind = raw.code ? 'code' : raw.ref ? 'ref' : null;
  const v = normCode(raw.code ?? raw.ref ?? '');
  if (!kind || !CODE_RE.test(v)) return false;
  setCookie(c, REF_COOKIE, `${kind}:${v}`, { httpOnly: true, sameSite: 'Lax', path: '/', secure, maxAge: 30 * 86_400 });
  if (kind === 'code') {
    await db.prepare('INSERT INTO partner_clicks (code, day, n) VALUES (?, ?, 1) ON CONFLICT(code, day) DO UPDATE SET n = n + 1')
      .bind(v, nowIso().slice(0, 10)).run();
  }
  return true;
}

/** Attach a brand-new account to the referrer or influencer from the cookie. Self-referral is ignored. */
export async function attributeSignup(c: Context, db: D1Database, user: Partnered, keys: FreeKeys): Promise<void> {
  const raw = getCookie(c, REF_COOKIE);
  if (!raw || user.referred_by || user.referred_code || Date.now() - Date.parse(user.created_at) > 15 * 60_000) return;
  const [kind, v] = raw.split(':');
  if (kind === 'ref') {
    const r = await db.prepare('SELECT id FROM users WHERE ref_code = ?').bind(v).first<{ id: string }>();
    if (!r || r.id === user.id || (await sharesDevice(db, r.id, keys))) return;
    await db.prepare('UPDATE users SET referred_by = ? WHERE id = ? AND referred_by IS NULL AND referred_code IS NULL').bind(r.id, user.id).run();
  } else if (kind === 'code') {
    const inf = await db.prepare("SELECT user_id FROM influencers WHERE code = ? AND status = 'active'").bind(v).first<{ user_id: string }>();
    if (!inf || inf.user_id === user.id || (await sharesDevice(db, inf.user_id, keys))) return;
    await db.prepare('UPDATE users SET referred_code = ? WHERE id = ? AND referred_by IS NULL AND referred_code IS NULL').bind(v, user.id).run();
  }
}

async function sharesDevice(db: D1Database, otherUserId: string, k: FreeKeys): Promise<boolean> {
  const hashes = [...k.devices, ...(k.ip ? [k.ip] : [])];
  if (!hashes.length) return false;
  return !!(await db.prepare(`SELECT 1 FROM free_claims WHERE user_id = ? AND key_hash IN (${hashes.map(() => '?').join(', ')}) LIMIT 1`)
    .bind(otherUserId, ...hashes).first());
}

/** Called once when a referred customer claims their free consultation. */
export async function grantFriendBonus(db: D1Database, user: Partnered): Promise<void> {
  if (!user.referred_by && !user.referred_code) return;
  await grantCredits(db, 'chat', user.id, FRIEND_BONUS_QUESTIONS, `bonus:${user.id}`);
}

/** Called once per newly recorded website payment (applyPayment is idempotent per payment). */
export async function onChatPayment(
  db: D1Database, p: { userId: string; threadId: string; kind: 'consultation' | 'topup'; amountCents: number }, taxFeePercent: number,
): Promise<void> {
  const u = await db.prepare('SELECT referred_by, referred_code FROM users WHERE id = ?').bind(p.userId)
    .first<{ referred_by: string | null; referred_code: string | null }>();
  if (!u) return;
  if (u.referred_by) {
    const month = new Date();
    month.setUTCDate(1);
    month.setUTCHours(0, 0, 0, 0);
    const n = await db.prepare('SELECT COUNT(*) AS n FROM referral_rewards WHERE referrer_id = ? AND created_at >= ?')
      .bind(u.referred_by, month.toISOString()).first<{ n: number }>();
    if ((n?.n ?? 0) < REFERRAL_MONTHLY_MAX) {
      const r = await db.prepare('INSERT INTO referral_rewards (friend_id, referrer_id, created_at) VALUES (?, ?, ?) ON CONFLICT(friend_id) DO NOTHING')
        .bind(p.userId, u.referred_by, nowIso()).run();
      if (r.meta?.changes) await grantCredits(db, 'chat', u.referred_by, REFERRER_REWARD_QUESTIONS, `refreward:${p.userId}`);
    }
  }
  if (u.referred_code) {
    const inf = await db.prepare('SELECT percent FROM influencers WHERE code = ?').bind(u.referred_code).first<{ percent: number }>();
    if (!inf) return;
    const base = Math.round((p.amountCents * 100) / (100 + taxFeePercent));
    const fee = Math.round((base * inf.percent) / 100);
    if (p.kind === 'consultation') {
      const now = Date.now();
      const ins = await db.prepare(
        `INSERT INTO commissions (customer_id, code, thread_id, base_cents, commission_cents, created_at, available_at)
         VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(customer_id) DO NOTHING`,
      ).bind(p.userId, u.referred_code, p.threadId, base, fee, new Date(now).toISOString(), new Date(now + PAYOUT_HOLD_DAYS * DAY).toISOString()).run();
      if (ins.meta?.changes) return;
    }
    await db.prepare(
      "UPDATE commissions SET base_cents = base_cents + ?, commission_cents = commission_cents + ? WHERE customer_id = ? AND thread_id = ? AND status = 'pending'",
    ).bind(base, fee, p.userId, p.threadId).run();
  }
}

const randomRef = (): string => {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => a[b % a.length]).join('');
};

export async function ensureRefCode(db: D1Database, userId: string): Promise<string> {
  for (let i = 0; i < 5; i++) {
    const cur = await db.prepare('SELECT ref_code FROM users WHERE id = ?').bind(userId).first<{ ref_code: string | null }>();
    if (cur?.ref_code) return cur.ref_code;
    await db.prepare('UPDATE users SET ref_code = ? WHERE id = ? AND ref_code IS NULL').bind(randomRef(), userId).run().catch(() => null);
  }
  throw new Error('Could not create a referral code');
}

export function validateCode(raw: string): { code: string } | { error: string } {
  const code = normCode(raw);
  if (!CODE_RE.test(code)) return { error: 'Use 3–20 letters or numbers.' };
  if (RESERVED.includes(code) || BLOCKED.some((w) => code.includes(w))) return { error: 'That code is not available. Try another.' };
  return { code };
}

export async function createInfluencer(db: D1Database, userId: string, code: string): Promise<'ok' | 'taken' | 'exists'> {
  if (await db.prepare('SELECT 1 FROM influencers WHERE user_id = ?').bind(userId).first()) return 'exists';
  const r = await db.prepare('INSERT INTO influencers (code, user_id, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING').bind(code, userId, nowIso()).run();
  return r.meta?.changes ? 'ok' : 'taken';
}

type Influencer = { code: string; user_id: string; status: string; percent: number; stripe_account_id: string | null; payouts_enabled: number };

export async function partnerState(db: D1Database, user: Partnered, site: string) {
  const refCode = await ensureRefCode(db, user.id);
  const [invited, rewards] = await Promise.all([
    db.prepare('SELECT COUNT(*) AS n FROM users WHERE referred_by = ?').bind(user.id).first<{ n: number }>(),
    db.prepare('SELECT COUNT(*) AS n FROM referral_rewards WHERE referrer_id = ?').bind(user.id).first<{ n: number }>(),
  ]);
  const inf = await db.prepare('SELECT * FROM influencers WHERE user_id = ?').bind(user.id).first<Influencer>();
  let influencer = null;
  if (inf) {
    if (inf.stripe_account_id && !inf.payouts_enabled) {
      const acct = await stripe().accounts.retrieve(inf.stripe_account_id).catch(() => null);
      if (acct?.payouts_enabled) {
        await db.prepare('UPDATE influencers SET payouts_enabled = 1 WHERE code = ?').bind(inf.code).run();
        inf.payouts_enabled = 1;
      }
    }
    const now = nowIso();
    const [clicks, signups, money, payouts] = await Promise.all([
      db.prepare('SELECT COALESCE(SUM(n), 0) AS n FROM partner_clicks WHERE code = ?').bind(inf.code).first<{ n: number }>(),
      db.prepare('SELECT COUNT(*) AS n FROM users WHERE referred_code = ?').bind(inf.code).first<{ n: number }>(),
      db.prepare(
        `SELECT COUNT(*) AS paying,
          COALESCE(SUM(CASE WHEN status = 'pending' AND available_at > ? THEN commission_cents END), 0) AS held,
          COALESCE(SUM(CASE WHEN status = 'pending' AND available_at <= ? THEN commission_cents END), 0) AS available,
          COALESCE(SUM(CASE WHEN status = 'paid' THEN commission_cents END), 0) AS paid
         FROM commissions WHERE code = ?`,
      ).bind(now, now, inf.code).first<{ paying: number; held: number; available: number; paid: number }>(),
      db.prepare('SELECT amount_cents, period, created_at FROM payouts WHERE code = ? ORDER BY created_at DESC LIMIT 24').bind(inf.code)
        .all<{ amount_cents: number; period: string; created_at: string }>(),
    ]);
    influencer = {
      code: inf.code, status: inf.status, percent: inf.percent, link: `${site}/?code=${inf.code}`,
      payoutsEnabled: !!inf.payouts_enabled, payoutsStarted: !!inf.stripe_account_id,
      clicks: clicks?.n ?? 0, signups: signups?.n ?? 0, paying: money?.paying ?? 0,
      pendingCents: money?.held ?? 0, availableCents: money?.available ?? 0, paidCents: money?.paid ?? 0,
      payouts: payouts.results.map((p) => ({ amountCents: p.amount_cents, period: p.period, paidAt: p.created_at })),
    };
  }
  return {
    referral: {
      link: `${site}/?ref=${refCode}`, invited: invited?.n ?? 0, rewards: rewards?.n ?? 0,
      earnedQuestions: (rewards?.n ?? 0) * REFERRER_REWARD_QUESTIONS, monthlyMax: REFERRAL_MONTHLY_MAX,
    },
    influencer,
    rules: { payoutMinCents: PAYOUT_MIN_CENTS, holdDays: PAYOUT_HOLD_DAYS },
  };
}

/** Stripe Connect Express onboarding link for the influencer's payouts. */
export async function connectLink(db: D1Database, user: Partnered, site: string): Promise<string | null> {
  const inf = await db.prepare('SELECT * FROM influencers WHERE user_id = ?').bind(user.id).first<Influencer>();
  if (!inf) return null;
  let acct = inf.stripe_account_id;
  if (!acct) {
    const a = await stripe().accounts.create({
      type: 'express', email: user.email, capabilities: { transfers: { requested: true } },
      metadata: { influencerCode: inf.code, userId: user.id },
    }, { idempotencyKey: `connect:${inf.code}` });
    acct = a.id;
    await db.prepare('UPDATE influencers SET stripe_account_id = ? WHERE code = ?').bind(acct, inf.code).run();
  }
  const link = await stripe().accountLinks.create({
    account: acct, type: 'account_onboarding',
    refresh_url: `${site}/influencers?payouts=retry`, return_url: `${site}/influencers?payouts=done`,
  });
  return link.url;
}

export async function payoutsCsv(db: D1Database, userId: string): Promise<string | null> {
  const inf = await db.prepare('SELECT code FROM influencers WHERE user_id = ?').bind(userId).first<{ code: string }>();
  if (!inf) return null;
  const rows = (await db.prepare('SELECT period, amount_cents, stripe_transfer_id, created_at FROM payouts WHERE code = ? ORDER BY created_at')
    .bind(inf.code).all<{ period: string; amount_cents: number; stripe_transfer_id: string | null; created_at: string }>()).results;
  return ['period,amount_usd,paid_at,reference', ...rows.map((r) => `${r.period},${(r.amount_cents / 100).toFixed(2)},${r.created_at},${r.stripe_transfer_id ?? ''}`)].join('\n');
}

/** Monthly job: pay out held-long-enough commissions of at least the minimum to each active, onboarded influencer. */
export async function runPayouts(db: D1Database, at = new Date()): Promise<{ code: string; cents: number }[]> {
  const period = at.toISOString().slice(0, 7);
  const now = at.toISOString();
  const due = (await db.prepare(
    `SELECT i.code, i.stripe_account_id, SUM(c.commission_cents) AS cents FROM influencers i
     JOIN commissions c ON c.code = i.code AND c.status = 'pending' AND c.available_at <= ?
     WHERE i.status = 'active' AND i.payouts_enabled = 1 AND i.stripe_account_id IS NOT NULL
     GROUP BY i.code HAVING cents >= ?`,
  ).bind(now, PAYOUT_MIN_CENTS).all<{ code: string; stripe_account_id: string; cents: number }>()).results;
  const done: { code: string; cents: number }[] = [];
  for (const d of due) {
    const id = crypto.randomUUID();
    const claim = await db.prepare('INSERT INTO payouts (id, code, amount_cents, period, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(code, period) DO NOTHING')
      .bind(id, d.code, d.cents, period, now).run();
    if (!claim.meta?.changes) continue;
    try {
      const tr = await stripe().transfers.create({
        amount: d.cents, currency: 'usd', destination: d.stripe_account_id, description: `Kaalera influencer payout ${period} (${d.code})`,
      }, { idempotencyKey: `payout:${d.code}:${period}` });
      await db.batch([
        db.prepare('UPDATE payouts SET stripe_transfer_id = ? WHERE id = ?').bind(tr.id, id),
        db.prepare("UPDATE commissions SET status = 'paid', payout_id = ? WHERE code = ? AND status = 'pending' AND available_at <= ?").bind(id, d.code, now),
      ]);
      done.push({ code: d.code, cents: d.cents });
    } catch (err) {
      console.error(`Payout ${d.code} ${period} failed:`, err);
      await db.prepare('DELETE FROM payouts WHERE id = ?').bind(id).run();
    }
  }
  return done;
}
