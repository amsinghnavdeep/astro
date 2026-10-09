/**
 * Buy a pack of Pandit chat questions (Stripe Checkout). Credits are granted by
 * the webhook (kind 'chat_credits'), idempotently on the Checkout Session id.
 */
export const prerender = false;
import type { APIRoute } from 'astro';
import { z } from 'zod';
import { stripe } from '../../../lib/stripe';
import { env } from '../../../lib/env';

export const POST: APIRoute = async ({ request, locals }) => {
  if (!locals.user) return json({ error: 'account_required' }, 401);

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  const parsed = z.object({ packId: z.string().min(1).max(32) }).safeParse(payload);
  const pack = parsed.success ? env.chat.packs.find((p) => p.id === parsed.data.packId) : undefined;
  if (!pack) return json({ error: 'Unknown pack' }, 400);

  const session = await stripe().checkout.sessions.create({
    mode: 'payment',
    customer_email: locals.user.email,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: pack.cents,
          product_data: {
            name: `Siddh Jyotish — ${pack.credits} questions to your Pandit`,
            description: 'Live chat answers from your own birth chart, with timing and explanation.',
          },
        },
      },
    ],
    metadata: {
      kind: 'chat_credits',
      userId: locals.user.id,
      email: locals.user.email,
      packId: pack.id,
      credits: String(pack.credits),
    },
    success_url: `${env.siteUrl}/chat?purchased=1`,
    cancel_url: `${env.siteUrl}/chat?canceled=1`,
  });
  return json({ url: session.url });
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
