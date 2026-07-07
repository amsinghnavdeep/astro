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
import { stripe, cryptoProvider } from '../../../lib/stripe';
import { env } from '../../../lib/env';
import {
  createKundliSession,
  askFollowup,
  instructKundliDelivery,
} from '../../../lib/devin';
import { encodeReference, decodeReference } from '../../../lib/reference';
import { recordOrder, type OrderRecord } from '../../../lib/orders';

export const POST: APIRoute = async ({ request, locals }) => {
  // Signature verification needs the RAW body — never call request.json() first.
  const raw = await request.text();
  const sig = request.headers.get('stripe-signature');

  let event: Stripe.Event;
  try {
    // Async verification: the Workers runtime only exposes WebCrypto (async),
    // so we use constructEventAsync with the SubtleCrypto provider.
    event = await stripe().webhooks.constructEventAsync(
      raw,
      sig ?? '',
      env.stripe.webhookSecret,
      undefined,
      cryptoProvider,
    );
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
  const createdAt = new Date(event.created * 1000);
  const order: OrderRecord = {
    id: session.id,
    kind: m.kind === 'followup' ? 'followup' : 'kundli',
    amountTotal: session.amount_total ?? 0,
    currency: session.currency ?? '',
    email: session.customer_email ?? m.email ?? '',
    fullName: m.fullName || undefined,
    questionCount:
      m.kind === 'kundli'
        ? JSON.parse(m.questions || '[]').length
        : m.kind === 'followup'
          ? Number(m.questionCount)
          : undefined,
    createdAt: createdAt.toISOString(),
    createdAtMs: createdAt.getTime(),
  };

  try {
    await recordOrder(locals.runtime.env.SIDDH_KV, order);
  } catch (err) {
    console.error('Order persistence error:', err);
  }

  try {
    if (m.kind === 'kundli') {
      const questions = JSON.parse(m.questions || '[]') as string[];
      const pandit = m.pandit || 'our senior astrologer';
      const devinSession = await createKundliSession({
        fullName: m.fullName,
        gender: (m.gender as 'Male' | 'Female' | 'Other') || 'Other',
        dateOfBirth: m.dateOfBirth,
        timeOfBirth: m.timeOfBirth,
        placeOfBirth: m.placeOfBirth,
        email: m.email,
        questions,
        pandit,
      });
      const reference = encodeReference(devinSession.session_id);

      // No backend email here (Stripe needs a fast 200). We hand the session the
      // reference + delivery instruction; the `!kundli` playbook then sends the
      // customer EXACTLY ONE email — framed as from their Pandit — with the PDF
      // attached and the reference number included. No polling needed.
      await instructKundliDelivery(devinSession.session_id, {
        reference,
        pandit,
        email: m.email,
        fullName: m.fullName,
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
