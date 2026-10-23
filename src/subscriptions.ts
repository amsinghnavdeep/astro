import type Stripe from 'stripe';
import type { D1Database } from '@cloudflare/workers-types';
import { env } from './env.js';
import type { FreeKeys } from './freeclaims.js';
import { freeBlocked } from './freeclaims.js';
import { ensureCustomer } from './autocharge.js';
import { stripe } from './stripe.js';
import { getPrices, taxesAndFees, type Prices } from './settings.js';
import { subscriptionDisclaimer } from './disclaimer.js';

export type PlanId = 'basic' | 'plus' | 'pro';
export type Plan = { id: PlanId; name: string; cents: number; consultations: number };
export type SubscriptionState = {
  user_id: string; stripe_subscription_id: string; plan: PlanId; status: string;
  pending_plan: PlanId | null;
  trial_end: string | null; current_period_end: string | null; cancel_at_period_end: number;
  paused_until: string | null; pause_starts_at: string | null; consults_left: number; last_invoice_id: string | null; had_trial: number;
};
export type SubscriptionUser = { id: string; email: string; name: string };

export const plansForPrices = (prices: Prices): Plan[] => [
  { id: 'basic', name: 'Basic', cents: prices.planBasicCents, consultations: prices.planBasicConsults },
  { id: 'plus', name: 'Plus', cents: prices.planPlusCents, consultations: prices.planPlusConsults },
  { id: 'pro', name: 'Pro', cents: prices.planProCents, consultations: prices.planProConsults },
];

export const planFor = (prices: Prices, id: string): Plan | null => plansForPrices(prices).find((p) => p.id === id) ?? null;

export async function subscriptionForUser(db: D1Database, userId: string): Promise<SubscriptionState | null> {
  return db.prepare('SELECT * FROM subscriptions WHERE user_id = ?').bind(userId).first<SubscriptionState>();
}

export async function trialEligible(db: D1Database, userId: string, keys: FreeKeys): Promise<boolean> {
  if (await subscriptionForUser(db, userId)) return false;
  if (await freeBlocked(db, keys)) return false;
  const phone = await db.prepare('SELECT phone_e164 FROM users WHERE id = ? AND phone_verified_at IS NOT NULL')
    .bind(userId).first<{ phone_e164: string | null }>();
  if (phone?.phone_e164) {
    const used = await db.prepare("SELECT 1 FROM trial_marks WHERE kind = 'phone' AND value = ?").bind(phone.phone_e164).first();
    if (used) return false;
  }
  return true;
}

const idOf = (v: string | { id: string } | null | undefined): string | null =>
  typeof v === 'string' ? v : v?.id ?? null;

export async function ensurePlanProduct(db: D1Database, plan: Plan): Promise<string> {
  const key = `stripe_product_${plan.id}`;
  const existing = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<{ value: string }>();
  if (existing?.value) return existing.value;
  const product = await stripe().products.create(
    { name: `Kaalera ${plan.name} monthly plan`, metadata: { plan: plan.id } },
    { idempotencyKey: `kaalera-subscription-product:${plan.id}` },
  );
  const now = new Date().toISOString();
  await db.prepare(
    'INSERT INTO settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO NOTHING',
  ).bind(key, product.id, now, 'subscriptions').run();
  return (await db.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<{ value: string }>())?.value ?? product.id;
}

export async function createSubscriptionCheckout(
  db: D1Database,
  user: SubscriptionUser,
  o: { plan: Plan; eligible: boolean; threadId?: string; taxFeePercent: number; trialDays: number; trialEnd: string; trialKeys: FreeKeys },
  request: { ip: string | null; userAgent: string | null },
): Promise<string> {
  const consentId = crypto.randomUUID();
  const consent = subscriptionDisclaimer({
    trial: o.eligible, trialEnd: o.trialEnd, monthlyCents: o.plan.cents, taxFeePercent: o.taxFeePercent,
  });
  const now = new Date().toISOString();
  await db.prepare(
    `INSERT INTO purchase_consents (id, user_id, kind, thread_id, disclaimer, ip, user_agent, created_at)
     VALUES (?, ?, 'subscription', ?, ?, ?, ?, ?)`,
  ).bind(consentId, user.id, o.threadId ?? null, consent, request.ip, request.userAgent, now).run();
  const tax = o.taxFeePercent;
  const metadata = {
    kind: 'subscription', userId: user.id, plan: o.plan.id, threadId: o.threadId ?? '', consentId,
    trialDeviceKeys: o.trialKeys.devices.join(','), trialIpKey: o.trialKeys.ip ?? '',
  };
  const product = await ensurePlanProduct(db, o.plan);
  const session = await stripe().checkout.sessions.create({
    mode: 'subscription',
    customer: await ensureCustomer(db, user),
    payment_method_collection: 'always',
    ...(o.eligible ? {
      subscription_data: {
        trial_period_days: o.trialDays,
        trial_settings: { end_behavior: { missing_payment_method: 'cancel' } },
        metadata,
      },
    } : { subscription_data: { metadata } }),
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: env.stripe.currency, unit_amount: o.plan.cents,
          recurring: { interval: 'month' }, product,
        },
      },
      ...(tax > 0 ? [{
        quantity: 1,
        price_data: {
          currency: env.stripe.currency, unit_amount: taxesAndFees(o.plan.cents, tax),
          recurring: { interval: 'month' as const }, product_data: { name: `Taxes & fees (${tax}%)` },
        },
      }] : []),
    ],
    metadata,
    success_url: `${env.siteUrl}/?app=1${o.threadId ? `&t=${encodeURIComponent(o.threadId)}` : ''}&checkout={CHECKOUT_SESSION_ID}`,
    cancel_url: `${env.siteUrl}/?app=1`,
  });
  if (!session.url) throw new Error('Stripe returned no subscription checkout URL');
  await db.prepare('UPDATE purchase_consents SET stripe_session_id = ? WHERE id = ?').bind(session.id, consentId).run();
  return session.url;
}

export async function syncSubscription(db: D1Database, subscription: Stripe.Subscription, fallbackUserId?: string): Promise<string | null> {
  const meta = subscription.metadata ?? {};
  const userId = meta.userId || fallbackUserId || null;
  const plan = (meta.plan || 'basic') as PlanId;
  if (!userId) return null;
  const prices = await getPrices(db);
  const planInfo = planFor(prices, plan);
  if (!planInfo) return null;
  const now = new Date().toISOString();
  const trialEnd = subscription.trial_end ? new Date(subscription.trial_end * 1000).toISOString() : null;
  const currentPeriodEnd = subscription.current_period_end ? new Date(subscription.current_period_end * 1000).toISOString() : null;
  const pausedUntil = subscription.pause_collection?.resumes_at
    ? new Date(subscription.pause_collection.resumes_at * 1000).toISOString() : null;
  const pauseStartsAt = subscription.pause_collection ? currentPeriodEnd : null;
  const trialing = subscription.status === 'trialing';
  await db.prepare(
    `INSERT INTO subscriptions
      (user_id, stripe_subscription_id, plan, status, trial_end, current_period_end, cancel_at_period_end, paused_until, pause_starts_at, consults_left, last_invoice_id, had_trial, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET stripe_subscription_id = excluded.stripe_subscription_id,
       plan = excluded.plan, status = excluded.status, trial_end = excluded.trial_end,
       current_period_end = excluded.current_period_end, cancel_at_period_end = excluded.cancel_at_period_end,
       paused_until = excluded.paused_until, pause_starts_at = excluded.pause_starts_at,
       had_trial = MAX(subscriptions.had_trial, excluded.had_trial), updated_at = excluded.updated_at`,
  ).bind(userId, subscription.id, plan, subscription.status, trialEnd, currentPeriodEnd,
    subscription.cancel_at_period_end ? 1 : 0, pausedUntil, pauseStartsAt,
    trialing ? prices.trialConsults : 0, trialing ? 1 : 0, now, now).run();
  return userId;
}

export const subscriptionIdFromInvoice = (invoice: Stripe.Invoice): string | null => {
  const legacy = (invoice as Stripe.Invoice & { subscription?: string | { id: string } | null }).subscription;
  if (legacy) return idOf(legacy);
  const parent = (invoice as Stripe.Invoice & {
    parent?: { subscription_details?: { subscription?: string | { id: string } | null } | null } | null;
  }).parent;
  return idOf(parent?.subscription_details?.subscription);
}

export async function spendSubscriptionConsultation(
  db: D1Database, userId: string, threadId: string, now = new Date().toISOString(),
): Promise<boolean> {
  const result = await db.prepare(
    `INSERT INTO subscription_usages (thread_id, user_id, stripe_subscription_id, created_at)
     SELECT t.id, s.user_id, s.stripe_subscription_id, ?
     FROM threads t JOIN subscriptions s ON s.user_id = t.user_id
     WHERE t.id = ? AND t.user_id = ? AND t.status = 'awaiting_payment'
       AND s.consults_left > 0 AND s.status IN ('trialing', 'active')
       AND (s.paused_until IS NULL OR s.paused_until <= ? OR (s.pause_starts_at IS NOT NULL AND ? < s.pause_starts_at))
     ON CONFLICT(thread_id) DO NOTHING`,
  ).bind(now, threadId, userId, now, now).run();
  return (result.meta?.changes ?? 0) > 0;
}

export async function markTrialIdentity(db: D1Database, kind: 'phone' | 'card', value: string, userId: string): Promise<boolean> {
  const result = await db.prepare(
    'INSERT INTO trial_marks (kind, value, user_id, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(kind, value) DO NOTHING',
  ).bind(kind, value, userId, new Date().toISOString()).run();
  return (result.meta?.changes ?? 0) > 0;
}

export const stripeId = idOf;
