/**
 * First-timer checkout: collect birth details (one person, or two for a
 * compatibility reading) and the free-text questions, then start a Stripe
 * Checkout priced at one chart (`kundliCents`) per person.
 *
 * The full order payload is stored as the KV lead record keyed by the Checkout
 * Session id; Stripe metadata only carries identifiers. After payment, the
 * webhook reads the lead back and runs the Kundli playbook.
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
  if (!locals.user) return json({ error: 'account_required' }, 401);
  const userId = locals.user.id;

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
  const charts: 1 | 2 = d.partner ? 2 : 1;
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
        // One unit per birth chart, so a two-person reading shows as 2 × the chart price.
        quantity: charts,
        price_data: {
          currency: sessionCurrency,
          unit_amount: unitAmount,
          product_data:
            charts === 2
              ? {
                  name: 'Siddh Jyotish — Two-Person Compatibility Reading (2 birth charts, ask anything)',
                  description:
                    'Two charts, two people: both Vedic birth charts computed to arc-second precision and read together, with everything you asked answered in one PDF report. Priced per chart.',
                }
              : {
                  name: 'Siddh Jyotish — Full Vedic Birth Chart Report (ask anything)',
                  description:
                    'Your Vedic birth chart computed to arc-second precision, with everything you asked answered in one PDF report.',
                },
        },
      },
    ],
    metadata: {
      kind: 'kundli',
      userId,
      pandit,
      charts: String(charts),
    },
    success_url: `${env.siteUrl}/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${env.siteUrl}/?canceled=1`,
  });

  const createSession = async (sessionCurrency: string, unitAmount: number) =>
    stripe().checkout.sessions.create(makeSessionArgs(sessionCurrency, unitAmount));

  let session;
  let unitAmount = pricing.kundliCents;
  try {
    session = await createSession(currency, unitAmount);
  } catch (err) {
    if (currency !== 'usd' && isUnsupportedCurrencyError(err)) {
      unitAmount = usdBlock.kundliCents;
      session = await createSession('usd', unitAmount);
    } else {
      throw err;
    }
  }

  // The lead is the only copy of the order payload. If it cannot be stored,
  // expire the Checkout Session so the customer can never pay for an order
  // whose questions or birth details we would not have.
  try {
    const createdAt = new Date();
    const lead: LeadRecord = {
      id: session.id,
      kind: 'kundli',
      userId,
      email: d.email,
      fullName: d.fullName,
      gender: d.gender,
      dateOfBirth: d.dateOfBirth,
      timeOfBirth: d.timeOfBirth,
      placeOfBirth: d.placeOfBirth,
      timezone: d.timezone,
      questions: d.questions ? [d.questions] : [],
      charts,
      ...(d.partner ? { partner: d.partner } : {}),
      pandit,
      amountTotal: session.amount_total ?? unitAmount * charts,
      currency: session.currency ?? currency,
      createdAt: createdAt.toISOString(),
      createdAtMs: createdAt.getTime(),
    };
    await recordLead(locals.runtime.env.SIDDH_KV, lead);
  } catch (err) {
    console.error('Lead capture error (kundli):', err);
    try {
      await stripe().checkout.sessions.expire(session.id);
    } catch (expireErr) {
      console.error('Checkout Session expiry failed after lead capture error:', expireErr);
    }
    return json(
      { error: 'We could not save your order details. You have not been charged — please try again.' },
      503,
    );
  }

  return json({ url: session.url });
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
