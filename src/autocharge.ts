import { trackPayment } from './analytics.js';
/**
 * Saved-card billing, on by default:
 *  - chat: when a consultation is out of questions, the next question is charged off-session (extra question + fee).
 *  - API: when the balance drops below API_LOW_CENTS, a pack is bought off-session, capped per calendar month.
 * Any failure (no card, bank verification needed, decline, cap) returns null and the caller falls back to Checkout / 402.
 */
import type Stripe from 'stripe';
import type { D1Database } from '@cloudflare/workers-types';
import { env } from './env.js';
import { stripe } from './stripe.js';
import { getPrices, taxesAndFees } from './settings.js';
import { chatPrices } from './festivals.js';
import { apiBalance, grantApiCredits } from './api.js';
import { applyPayment, type Thread } from './chat.js';
import { sendReceiptEmail } from './email.js';

export const CHAT_AUTO_DAILY_MAX = 10;
export const API_LOW_CENTS = 1000;

export interface Billing {
  stripe_customer_id: string | null; stripe_pm_id: string | null; card_last4: string | null;
  chat_autocharge: number; chat_autocharge_ack_at: string | null;
  api_autorecharge: number; api_autorecharge_cents: number; api_autorecharge_cap_cents: number; api_autorecharge_ack_at: string | null;
}

const nowIso = (): string => new Date().toISOString();

export const getBilling = async (db: D1Database, userId: string): Promise<Billing | null> =>
  db.prepare(`SELECT stripe_customer_id, stripe_pm_id, card_last4, chat_autocharge, chat_autocharge_ack_at, api_autorecharge,
      api_autorecharge_cents, api_autorecharge_cap_cents, api_autorecharge_ack_at FROM users WHERE id = ?`).bind(userId).first<Billing>();

export async function ensureCustomer(db: D1Database, user: { id: string; email: string; name: string }): Promise<string> {
  const b = await getBilling(db, user.id);
  if (b?.stripe_customer_id) return b.stripe_customer_id;
  const cust = await stripe().customers.create({ email: user.email, name: user.name, metadata: { userId: user.id } });
  await db.prepare('UPDATE users SET stripe_customer_id = COALESCE(stripe_customer_id, ?) WHERE id = ?').bind(cust.id, user.id).run();
  return (await getBilling(db, user.id))?.stripe_customer_id ?? cust.id;
}

/** Remember the card used on a paid Checkout so later questions / API top-ups can be charged automatically. */
export async function saveCardFromCheckout(db: D1Database, s: Stripe.Checkout.Session): Promise<void> {
  const userId = s.metadata?.userId;
  const piId = typeof s.payment_intent === 'string' ? s.payment_intent : s.payment_intent?.id;
  if (!userId || !piId) return;
  const pi = await stripe().paymentIntents.retrieve(piId, { expand: ['payment_method'] });
  const pm = pi.payment_method && typeof pi.payment_method === 'object' ? pi.payment_method : null;
  if (!pm || pi.setup_future_usage !== 'off_session') return;
  const cust = typeof pi.customer === 'string' ? pi.customer : pi.customer?.id ?? null;
  await db.prepare('UPDATE users SET stripe_pm_id = ?, card_last4 = ?, stripe_customer_id = COALESCE(stripe_customer_id, ?) WHERE id = ?')
    .bind(pm.id, pm.card?.last4 ?? null, cust, userId).run();
}

async function chargeSaved(b: Billing, cents: number, description: string, metadata: Record<string, string>, idempotencyKey: string): Promise<Stripe.PaymentIntent | null> {
  if (!b.stripe_customer_id || !b.stripe_pm_id) return null;
  try {
    const pi = await stripe().paymentIntents.create({
      amount: cents, currency: env.stripe.currency, customer: b.stripe_customer_id, payment_method: b.stripe_pm_id,
      off_session: true, confirm: true, description, metadata,
    }, { idempotencyKey });
    return pi.status === 'succeeded' ? pi : null;
  } catch (err) {
    console.error('Off-session charge failed:', (err as { code?: string }).code ?? err);
    return null;
  }
}

const autoSpendSince = async (db: D1Database, userId: string, kinds: string, since: string): Promise<{ n: number; cents: number }> =>
  (await db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(amount_cents), 0) AS cents FROM payments
     WHERE user_id = ? AND auto = 1 AND kind IN (${kinds}) AND created_at >= ?`).bind(userId, since).first<{ n: number; cents: number }>())
  ?? { n: 0, cents: 0 };

/** Charge one extra question to the saved card and add it to the consultation. Returns true when the question was paid. */
export async function autoChargeQuestion(db: D1Database, t: Thread, used: number): Promise<boolean> {
  const b = await getBilling(db, t.user_id);
  if (!b || !b.chat_autocharge || !b.stripe_pm_id) return false;
  const day = new Date(Date.now() - 86_400_000).toISOString();
  if ((await autoSpendSince(db, t.user_id, "'topup'", day)).n >= CHAT_AUTO_DAILY_MAX) return false;
  const p = await chatPrices(db);
  const cents = p.extraQuestionCents + taxesAndFees(p.extraQuestionCents, p.taxFeePercent);
  const pi = await chargeSaved(b, cents, 'Kaalera — extra question', { kind: 'topup', userId: t.user_id, threadId: t.id, auto: '1' },
    `auto-q:${t.id}:${used}`);
  if (!pi) return false;
  await applyPayment(db, { stripeSessionId: pi.id, userId: t.user_id, threadId: t.id, kind: 'topup', credits: 1, amountCents: pi.amount, currency: pi.currency });
  await db.prepare('UPDATE payments SET auto = 1 WHERE stripe_session_id = ?').bind(pi.id).run();
  await sendReceipt(db, t.user_id, { item: RECEIPT_ITEM.topup, totalCents: pi.amount, baseCents: p.extraQuestionCents, auto: true, ref: pi.id });
  await trackPayment(db, t.user_id);
  return true;
}

/** Top up API credits from the saved card when the balance is low. Returns true when credits were added. */
export async function autoRechargeApi(db: D1Database, userId: string, need = API_LOW_CENTS): Promise<boolean> {
  const b = await getBilling(db, userId);
  if (!b || !b.api_autorecharge || !b.stripe_pm_id) return false;
  if ((await apiBalance(db, userId)) >= need) return false;
  const p = await getPrices(db);
  const base = Math.max(b.api_autorecharge_cents, need);
  const cents = base + taxesAndFees(base, p.taxFeePercent);
  const month = new Date();
  month.setUTCDate(1);
  month.setUTCHours(0, 0, 0, 0);
  if ((await autoSpendSince(db, userId, "'api_credits'", month.toISOString())).cents + cents > b.api_autorecharge_cap_cents) return false;
  const pi = await chargeSaved(b, cents, `Kaalera API wallet — $${(base / 100).toFixed(2)} (auto-recharge)`, { kind: 'api_credits', userId, credits: String(base), auto: '1' },
    `auto-api:${userId}:${Math.floor(Date.now() / 60_000)}`);
  if (!pi) return false;
  await grantApiCredits(db, userId, base, `stripe:${pi.id}`);
  await db.prepare(
    `INSERT INTO payments (stripe_session_id, user_id, thread_id, kind, amount_cents, currency, created_at, auto)
     VALUES (?, ?, NULL, 'api_credits', ?, ?, ?, 1) ON CONFLICT(stripe_session_id) DO NOTHING`,
  ).bind(pi.id, userId, pi.amount, pi.currency, nowIso()).run();
  await sendReceipt(db, userId, { item: `API wallet top-up $${(base / 100).toFixed(2)} (auto-recharge)`, totalCents: pi.amount, baseCents: base, auto: true, ref: pi.id, api: true });
  return true;
}

export const publicBilling = (b: Billing | null) => ({
  card: b?.card_last4 ? { last4: b.card_last4 } : null,
  chatAutoCharge: !!b?.chat_autocharge, chatAutoChargeAcked: !!b?.chat_autocharge_ack_at, chatAutoDailyMax: CHAT_AUTO_DAILY_MAX,
  apiAutoRecharge: !!b?.api_autorecharge, apiAutoRechargeAcked: !!b?.api_autorecharge_ack_at,
  apiAutoRechargeCents: b?.api_autorecharge_cents ?? 10000, apiAutoRechargeCapCents: b?.api_autorecharge_cap_cents ?? 50000,
  apiLowCents: API_LOW_CENTS,
});

export const RECEIPT_ITEM = { consultation: 'Kaal consultation (opening question)', topup: 'Extra question' } as const;

/** Email a receipt. Never throws: a mail failure must not affect the payment. */
export async function sendReceipt(db: D1Database, userId: string, o: { item: string; totalCents: number; baseCents?: number; auto: boolean; ref: string; api?: boolean }): Promise<void> {
  try {
    const u = await db.prepare('SELECT email, card_last4 FROM users WHERE id = ?').bind(userId).first<{ email: string; card_last4: string | null }>();
    if (!u) return;
    const tax = (await getPrices(db)).taxFeePercent;
    const base = o.baseCents ?? Math.round((o.totalCents * 100) / (100 + tax));
    await sendReceiptEmail({
      to: u.email, item: o.item, baseCents: base, feeCents: Math.max(0, o.totalCents - base), feePercent: tax, totalCents: o.totalCents,
      last4: u.card_last4, auto: o.auto, ref: o.ref, manageUrl: `${env.siteUrl}${o.api ? '/developers#billing' : '/?billing=1'}`,
    });
  } catch (err) {
    console.error('Receipt email failed:', err);
  }
}
