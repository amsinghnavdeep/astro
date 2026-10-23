import { readFileSync } from 'node:fs';
import Stripe from 'stripe';

const vars = Object.fromEntries(readFileSync(new URL('../.dev.vars', import.meta.url), 'utf8')
  .split(/\r?\n/)
  .filter((line) => /^[A-Z_]+=/.test(line))
  .map((line) => {
    const i = line.indexOf('=');
    return [line.slice(0, i), line.slice(i + 1).trim().replace(/^['"]|['"]$/g, '')];
  }));
const key = vars.STRIPE_SECRET_KEY ?? '';
if (!/^(sk|rk)_test_/.test(key)) {
  console.log('Stripe test Checkout: skipped; no recognized test-mode key.');
  process.exit(0);
}

const stripe = new Stripe(key);
const baseCents = 2900;
const taxPercent = 15;
const taxCents = Math.round(baseCents * taxPercent / 100);
const session = await stripe.checkout.sessions.create({
  mode: 'subscription',
  customer_email: `subscription-test-${Date.now()}@example.com`,
  payment_method_collection: 'always',
  line_items: [
    {
      price_data: {
        currency: 'usd',
        unit_amount: baseCents,
        recurring: { interval: 'month' },
        product_data: { name: 'Kaalera Basic plan' },
      },
      quantity: 1,
    },
    {
      price_data: {
        currency: 'usd',
        unit_amount: taxCents,
        recurring: { interval: 'month' },
        product_data: { name: `Taxes & fees (${taxPercent}%)` },
      },
      quantity: 1,
    },
  ],
  subscription_data: {
    trial_period_days: 7,
    trial_settings: { end_behavior: { missing_payment_method: 'cancel' } },
    metadata: { kind: 'subscription', userId: 'local-test-user', plan: 'basic', trialConsults: '2' },
  },
  metadata: { kind: 'subscription', userId: 'local-test-user', plan: 'basic', consentId: 'local-test-consent' },
  success_url: 'https://example.com/?checkout={CHECKOUT_SESSION_ID}',
  cancel_url: 'https://example.com/',
});
console.log(`Stripe test Checkout accepted: ${session.id} (${session.status}).`);
if (session.status === 'open') {
  await stripe.checkout.sessions.expire(session.id);
  console.log('Test Checkout Session expired.');
}
