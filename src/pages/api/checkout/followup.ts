/**
 * Returning-customer checkout: reference + 2 questions, $1100 Stripe Checkout.
 *
 * We validate the reference decrypts to a session id BEFORE taking payment, so a
 * bad reference fails fast. The reference + questions ride along in metadata.
 */
export const prerender = false;
import type { APIRoute } from 'astro';
import { stripe } from '../../../lib/stripe';
import { env } from '../../../lib/env';
import { followupSchema } from '../../../lib/validation';
import { decodeReference } from '../../../lib/reference';

export const POST: APIRoute = async ({ request }) => {
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

  // Fail fast on a forged/expired reference before charging anyone.
  try {
    decodeReference(reference);
  } catch {
    return json({ error: 'That reference number is invalid.' }, 400);
  }

  const session = await stripe().checkout.sessions.create({
    mode: 'payment',
    customer_email: email,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: env.pricing.followupCents,
          product_data: {
            name: 'Kundli Follow-up — 2 Precise Questions',
            description: 'Answered from your existing chart. No new report.',
          },
        },
      },
    ],
    metadata: {
      kind: 'followup',
      email,
      reference: reference.slice(0, 480),
      questions: JSON.stringify(questions).slice(0, 480),
    },
    success_url: `${env.siteUrl}/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${env.siteUrl}/returning?canceled=1`,
  });

  return json({ url: session.url });
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
