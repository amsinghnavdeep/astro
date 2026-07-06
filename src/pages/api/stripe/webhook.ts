/**
 * Stripe webhook — the core fulfillment endpoint.
 *
 * When a Checkout Session completes, Stripe calls this endpoint. We verify the
 * signature against the RAW request body, then act on the order stored in the
 * session metadata:
 *   - kind 'kundli':   start a new Devin session and email the reference number.
 *   - kind 'followup': decode the reference back to the session id and ask the
 *                      follow-up questions on that same session.
 */
export const prerender = false;
import type { APIRoute } from 'astro';
import type Stripe from 'stripe';
import { stripe } from '../../../lib/stripe';
import { env } from '../../../lib/env';
import { createKundliSession, askFollowup } from '../../../lib/devin';
import { encodeReference, decodeReference } from '../../../lib/reference';
import { sendEmail, kundliDeliveryHtml } from '../../../lib/email';

export const POST: APIRoute = async ({ request }) => {
  // Signature verification needs the RAW body — never call request.json() first.
  const raw = await request.text();
  const sig = request.headers.get('stripe-signature');

  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(raw, sig ?? '', env.stripe.webhookSecret);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return json({ error: `Webhook signature verification failed: ${message}` }, 400);
  }

  // We only fulfill on completed checkout sessions; acknowledge everything else.
  if (event.type !== 'checkout.session.completed') {
    return json({ received: true }, 200);
  }

  const session = event.data.object as Stripe.Checkout.Session;
  const m = session.metadata ?? {};

  try {
    if (m.kind === 'kundli') {
      const questions = JSON.parse(m.questions || '[]') as string[];
      const devinSession = await createKundliSession({
        fullName: m.fullName,
        dateOfBirth: m.dateOfBirth,
        timeOfBirth: m.timeOfBirth,
        placeOfBirth: m.placeOfBirth,
        email: m.email,
        questions,
      });
      const reference = encodeReference(devinSession.session_id);

      // We email the reference NOW (Stripe needs a fast 200). The PDF itself is
      // produced asynchronously and emailed by the `!kundli` playbook once ready
      // (the customer email is passed into the session prompt), so no polling here.
      await sendEmail({
        to: m.email,
        subject: 'Your Kundli reference number',
        html: kundliDeliveryHtml(m.fullName, reference),
      });
    } else if (m.kind === 'followup') {
      const sessionId = decodeReference(m.reference);
      const questions = JSON.parse(m.questions || '[]') as string[];
      await askFollowup(sessionId, questions);
    }
  } catch (err) {
    // Permanent errors (bad metadata, decode failure) should NOT be retried
    // forever by Stripe, so we log and still return 200. If you want Stripe to
    // retry a transient failure, return 500 instead.
    console.error('Webhook fulfillment error:', err);
    return json({ received: true }, 200);
  }

  return json({ received: true }, 200);
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
