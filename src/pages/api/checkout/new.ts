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
import { birthDetailsSchema } from '../../../lib/validation';
import { randomPandit } from '../../../lib/pandits';

export const POST: APIRoute = async ({ request }) => {
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

  const session = await stripe().checkout.sessions.create({
    mode: 'payment',
    customer_email: d.email,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: env.pricing.kundliCents,
          product_data: {
            name: 'Siddh Jyotish — Full Vedic Birth Chart Report (includes 3 questions)',
            description: 'Detailed PDF + interactive chart, computed with Swiss Ephemeris.',
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
      email: d.email,
      pandit,
      questions: JSON.stringify(d.questions ?? []).slice(0, 480),
    },
    success_url: `${env.siteUrl}/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${env.siteUrl}/?canceled=1`,
  });

  return json({ url: session.url });
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
