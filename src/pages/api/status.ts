/**
 * Status endpoint for the success page.
 *
 * Given a Stripe Checkout Session id, report whether payment has landed and, if
 * so, what kind of order it was. Never exposes secrets or full metadata.
 */
export const prerender = false;
import type { APIRoute } from 'astro';
import Stripe from 'stripe';
import { stripe } from '../../lib/stripe';

export const GET: APIRoute = async ({ url }) => {
  const checkoutId = url.searchParams.get('session_id');
  if (!checkoutId) {
    return json({ error: 'Missing session_id' }, 400);
  }

  let session;
  try {
    session = await stripe().checkout.sessions.retrieve(checkoutId);
  } catch (err) {
    // A bogus/expired session id makes Stripe throw. Return a clean JSON error
    // instead of letting the exception surface as a bare 500 with no body.
    if (err instanceof Stripe.errors.StripeInvalidRequestError) {
      return json({ error: 'No such checkout session' }, 404);
    }
    console.error('Status lookup error:', err);
    return json({ error: 'Failed to look up checkout session' }, 502);
  }

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
