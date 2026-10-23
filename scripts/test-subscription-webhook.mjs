import { readFileSync } from 'node:fs';
import Stripe from 'stripe';

const vars = Object.fromEntries(readFileSync(new URL('../.dev.vars', import.meta.url), 'utf8')
  .split(/\r?\n/)
  .filter((line) => /^[A-Z_]+=/.test(line))
  .map((line) => {
    const i = line.indexOf('=');
    return [line.slice(0, i), line.slice(i + 1).trim().replace(/^['"]|['"]$/g, '')];
  }));
const webhookSecret = vars.STRIPE_WEBHOOK_SECRET;
if (!webhookSecret) throw new Error('STRIPE_WEBHOOK_SECRET is missing from .dev.vars');

const stripe = new Stripe('sk_test_local_webhook_fixture');
const now = Math.floor(Date.now() / 1000);
const userId = process.env.SUBSCRIPTION_TEST_USER_ID;
const baseSubscription = {
    id: 'sub_local_webhook_fixture',
    object: 'subscription',
    customer: 'cus_local_webhook_fixture',
    status: 'trialing',
    metadata: userId ? { userId, plan: 'plus' } : {},
    cancel_at_period_end: false,
    current_period_end: now + 30 * 86400,
    trial_end: now + 7 * 86400,
    pause_collection: null,
    items: { data: [] },
};
const fixture = (overrides = {}) => ({ ...baseSubscription, ...overrides });
const cases = [
  ['trial', 'customer.subscription.updated', fixture()],
  ['pause', 'customer.subscription.updated', fixture({
    pause_collection: { behavior: 'void', resumes_at: now + 60 * 86400 },
  })],
  ['switch_to_basic', 'customer.subscription.updated', fixture({
    metadata: userId ? { userId, plan: 'basic' } : {},
    pause_collection: null,
  })],
  ['cancel_at_period_end', 'customer.subscription.updated', fixture({
    status: 'active',
    trial_end: null,
    cancel_at_period_end: true,
  })],
  ['resume', 'customer.subscription.updated', fixture({
    status: 'active',
    trial_end: null,
    cancel_at_period_end: false,
    pause_collection: null,
  })],
  ['deleted', 'customer.subscription.deleted', fixture({
    status: 'canceled',
    trial_end: null,
  })],
];

for (const [label, type, object] of cases) {
  const event = {
    id: `evt_local_${label}`,
    object: 'event',
    api_version: '2024-06-20',
    created: now,
    type,
    data: { object },
  };
  const payload = JSON.stringify(event);
  const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: webhookSecret });
  const response = await fetch('http://127.0.0.1:8788/api/stripe/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'stripe-signature': signature },
    body: payload,
  });
  console.log(`${type}: HTTP ${response.status}`);
  if (!response.ok) process.exitCode = 1;
}

const testKey = /^(sk|rk)_test_/.test(vars.STRIPE_SECRET_KEY ?? '');
if (!testKey) console.log('Stripe Checkout: skipped; configured key is not recognized as test mode.');
