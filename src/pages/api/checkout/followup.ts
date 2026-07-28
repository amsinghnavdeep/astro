/**
 * Returning-customer checkout: reference + 1-3 questions, tiered-price Stripe
 * Checkout ($8 / $11 / $13 for 1 / 2 / 3 questions).
 *
 * We validate the reference decrypts to a session id BEFORE taking payment, so a
 * bad reference fails fast. The reference + questions ride along in metadata.
 */
export const prerender = false;
import type { APIRoute } from 'astro';
import { stripe } from '../../../lib/stripe';
import { env } from '../../../lib/env';
import { detectCountry } from '../../../lib/geo';
import { getPricing, resolveCurrency } from '../../../lib/pricing';
import { isUnsupportedCurrencyError } from '../../../lib/stripe';
import { followupSchema } from '../../../lib/validation';
import { decodeReference } from '../../../lib/reference';
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

  const parsed = followupSchema.safeParse(payload);
  if (!parsed.success) {
    return json({ error: 'Invalid input', issues: parsed.error.issues }, 400);
  }
  const { reference, email, questions } = parsed.data;
  const count = questions.length;

  // Fail fast on a forged/expired reference before charging anyone.
  try {
    decodeReference(reference);
  } catch {
    return json({ error: 'That reference number is invalid.' }, 400);
  }

  if (count < 1 || count > 3) {
    return json({ error: 'You may ask between 1 and 3 questions.' }, 400);
  }

  const country = detectCountry(request, locals.runtime);
  const config = await getPricing(locals.runtime.env.SIDDH_KV);
  const currency = resolveCurrency(config, country);
  const pricing = config.currencies[currency];
  const usdBlock = config.currencies.usd ?? config.currencies[config.defaultCurrency];
  const unitAmount = pricing.followupTierCents[count as 1 | 2 | 3];
  const usdUnitAmount = usdBlock.followupTierCents[count as 1 | 2 | 3];

  const makeSessionArgs = (sessionCurrency: string, amount: number) => ({
    mode: 'payment' as const,
    customer_email: email,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: sessionCurrency,
          unit_amount: amount,
          product_data: {
            name: `Siddh Jyotish Follow-up — ${count} precise question${count === 1 ? '' : 's'}`,
            description: 'Answered from your existing chart. No new report.',
          },
        },
      },
    ],
    metadata: {
      kind: 'followup',
      userId,
      email,
      reference: reference.slice(0, 480),
      questionCount: String(count),
      questions: JSON.stringify(questions).slice(0, 480),
    },
    success_url: `${env.siteUrl}/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${env.siteUrl}/returning?canceled=1`,
  });

  const createSession = async (sessionCurrency: string, amount: number) =>
    stripe().checkout.sessions.create(makeSessionArgs(sessionCurrency, amount));

  let session;
  try {
    session = await createSession(currency, unitAmount);
  } catch (err) {
    if (currency !== 'usd' && isUnsupportedCurrencyError(err)) {
      session = await createSession('usd', usdUnitAmount);
    } else {
      throw err;
    }
  }

  try {
    const createdAt = new Date();
    const lead: LeadRecord = {
      id: session.id,
      kind: 'followup',
      email,
      reference,
      questions,
      amountTotal: session.amount_total ?? unitAmount,
      currency: session.currency ?? currency,
      createdAt: createdAt.toISOString(),
      createdAtMs: createdAt.getTime(),
    };
    await recordLead(locals.runtime.env.SIDDH_KV, lead);
  } catch (err) {
    console.error('Lead capture error (followup):', err);
  }

  return json({ url: session.url });
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
