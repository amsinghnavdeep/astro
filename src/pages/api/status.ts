/**
 * Status endpoint for the success page.
 *
 * Given a Stripe Checkout Session id, report whether payment has landed and, if
 * so, what kind of order it was. Never exposes secrets or full metadata.
 */
export const prerender = false;
import type { APIRoute } from 'astro';
import { stripe } from '../../lib/stripe';

export const GET: APIRoute = async ({ url }) => {
  const checkoutId = url.searchParams.get('session_id');
  if (!checkoutId) {
    return json({ error: 'Missing session_id' }, 400);
  }

  const session = await stripe().checkout.sessions.retrieve(checkoutId);

  if (session.payment_status !== 'paid') {
    return json({ state: 'unpaid' });
  }

  return json({
    state: 'paid',
    kind: session.metadata?.kind,
    pandit: session.metadata?.pandit,
    fullName: session.metadata?.fullName,
  });
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
