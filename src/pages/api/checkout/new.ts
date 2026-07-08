/**
 * First-timer checkout: collect birth details, start a $2100 Stripe Checkout.
 *
 * The birth details are stashed in the Checkout Session metadata (Stripe is our
 * only "store" — no DB). After payment, the webhook reads them back and runs
 * the Kundli playbook.
 */
export const prerender = false;
import type { APIRoute } from 'astro';
import { stripe } from '../../../lib/stripe';
import { env } from '../../../lib/env';
import { detectCountry } from '../../../lib/geo';
import { getPricing, resolveCurrency } from '../../../lib/pricing';
import { isUnsupportedCurrencyError } from '../../../lib/stripe';
import { birthDetailsSchema } from '../../../lib/validation';
import { randomPandit } from '../../../lib/pandits';
import { recordLead, type LeadRecord } from '../../../lib/leads';

export const POST: APIRoute = async ({ request, locals }) => {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const parsed = birthDetailsSchema.safeParse(payload);
  if (!parsed.success) {
    return json({ error: 'Invalid birth details', issues: parsed.error.issues }, 400);
  }
  const d = parsed.data;
  const pandit = randomPandit();
  const country = detectCountry(request, locals.runtime);
  const config = await getPricing(locals.runtime.env.SIDDH_KV);
  const currency = resolveCurrency(config, country);
  const pricing = config.currencies[currency];
  const usdBlock = config.currencies.usd ?? config.currencies[config.defaultCurrency];
  const makeSessionArgs = (sessionCurrency: string, unitAmount: number) => ({
    mode: 'payment' as const,
    customer_email: d.email,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: sessionCurrency,
          unit_amount: unitAmount,
          product_data: {
            name: 'Siddh Jyotish — Full Vedic Birth Chart Report (includes 3 questions)',
            description: 'Detailed PDF birth-chart report, computed to arc-second precision.',
          },
        },
      },
    ],
    metadata: {
      kind: 'kundli',
      fullName: d.fullName,
      gender: d.gender,
      dateOfBirth: d.dateOfBirth,
      timeOfBirth: d.timeOfBirth,
      placeOfBirth: d.placeOfBirth,
      timezone: d.timezone,
      email: d.email,
      pandit,
      questions: JSON.stringify(d.questions ?? []).slice(0, 480),
    },
    success_url: `${env.siteUrl}/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${env.siteUrl}/?canceled=1`,
  });

  const createSession = async (sessionCurrency: string, unitAmount: number) =>
    stripe().checkout.sessions.create(makeSessionArgs(sessionCurrency, unitAmount));

  let session;
  try {
    session = await createSession(currency, pricing.kundliCents);
  } catch (err) {
    if (currency !== 'usd' && isUnsupportedCurrencyError(err)) {
      session = await createSession('usd', usdBlock.kundliCents);
    } else {
      throw err;
    }
  }

  try {
    const createdAt = new Date();
    const lead: LeadRecord = {
      id: session.id,
      kind: 'kundli',
      email: d.email,
      fullName: d.fullName,
      gender: d.gender,
      dateOfBirth: d.dateOfBirth,
      timeOfBirth: d.timeOfBirth,
      placeOfBirth: d.placeOfBirth,
      timezone: d.timezone,
      questions: d.questions ?? [],
      amountTotal: session.amount_total ?? pricing.kundliCents,
      currency: session.currency ?? currency,
      createdAt: createdAt.toISOString(),
      createdAtMs: createdAt.getTime(),
    };
    await recordLead(locals.runtime.env.SIDDH_KV, lead);
  } catch (err) {
    console.error('Lead capture error (kundli):', err);
  }

  return json({ url: session.url });
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
