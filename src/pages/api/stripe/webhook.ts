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
import type { D1Database } from '@cloudflare/workers-types';
import { stripe, cryptoProvider } from '../../../lib/stripe';
import { env } from '../../../lib/env';
import {
  createKundliSession,
  askFollowup,
  instructKundliDelivery,
} from '../../../lib/devin';
import { encodeReference, decodeReference } from '../../../lib/reference';
import { recordOrder, type OrderRecord } from '../../../lib/orders';
import { deleteLead } from '../../../lib/leads';
import { computeChart, chartToPromptText } from '../../../lib/kundli/chart';
import {
  findOrderById,
  upsertOrder,
  type OrderRecord as AccountOrderRecord,
} from '../../../lib/auth';
import { geocodeBirthplace } from '../../../lib/kundli/geocode';
import { generateReport, type GeneratePayload } from '../../../lib/reportService';

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
    const db = locals.runtime.env.SIDDH_DB;
    if (db) {
      const accountOrder: AccountOrderRecord = {
        id: order.id,
        user_id: m.userId || null,
        email: order.email,
        kind: order.kind,
        service_type: order.kind,
        full_name: order.fullName ?? null,
        amount_total: order.amountTotal,
        currency: order.currency,
        status: 'paid',
        pdf_key: null,
        reference_number: m.reference || null,
        created_at: order.createdAt,
      };
      await upsertOrder(db, accountOrder);
    }
  } catch (err) {
    console.error('Account order persistence error:', err);
  }

  try {
    await deleteLead(locals.runtime.env.SIDDH_KV, session.id);
  } catch (err) {
    console.error('Lead deletion error:', err);
  }

  try {
    if (m.kind === 'kundli') {
      const questions = JSON.parse(m.questions || '[]') as string[];
      const pandit = m.pandit || 'our senior astrologer';

      const runDevinFulfillment = async (): Promise<void> => {
        // Pre-compute the chart in the Worker so the Devin session only has to
        // interpret it (big ACU saving). If anything fails (geocoding, parsing),
        // fall back gracefully: the playbook computes the chart itself.
        let precomputedChart: string | undefined;
        try {
          if (m.timezone && m.dateOfBirth && m.timeOfBirth && m.placeOfBirth) {
            const chart = await computeChart({
              dateOfBirth: m.dateOfBirth,
              timeOfBirth: m.timeOfBirth,
              placeOfBirth: m.placeOfBirth,
              timezone: m.timezone,
            });
            precomputedChart = chartToPromptText(chart);
          }
        } catch (err) {
          console.error('Chart pre-computation failed; playbook will compute it:', err);
        }

        const devinSession = await createKundliSession({
          fullName: m.fullName,
          gender: (m.gender as 'Male' | 'Female' | 'Other') || 'Other',
          dateOfBirth: m.dateOfBirth,
          timeOfBirth: m.timeOfBirth,
          placeOfBirth: m.placeOfBirth,
          timezone: m.timezone || undefined,
          email: m.email,
          questions,
          pandit,
          precomputedChart,
        });
        console.info('Created Devin Kundli session:', devinSession.session_id);
        const reference = encodeReference(devinSession.session_id);
        const delivery = instructKundliDelivery(devinSession.session_id, {
          reference,
          pandit,
          email: m.email,
          fullName: m.fullName,
        })
          .then(() => {
            console.info('Kundli delivery instruction accepted:', devinSession.session_id);
          })
          .catch((err) => {
            console.error('Kundli delivery instruction error:', err);
          });

        // No backend email here (Stripe needs a fast 200). We hand the session the
        // reference + delivery instruction; the `!kundli` playbook then sends the
        // customer EXACTLY ONE email — framed as from their Pandit — with the PDF
        // attached and the reference number included. No polling needed.
        const waitUntil = (locals.runtime as { ctx?: { waitUntil(promise: Promise<unknown>): void } }).ctx?.waitUntil;
        if (waitUntil) {
          waitUntil(delivery);
        } else {
          await delivery;
        }
      };

      if (env.reportService.useDevinFulfillment) {
        await runDevinFulfillment();
      } else {
        const geo = await geocodeBirthplace(m.placeOfBirth || '');
        if (!geo) {
          console.error('Report service geocoding failed; falling back to Devin.');
          await runDevinFulfillment();
        } else {
          const reference = encodeReference(session.id);
          const payload: GeneratePayload = {
            orderId: session.id,
            serviceType: m.serviceType || 'kundli',
            person: {
              fullName: m.fullName || 'Seeker',
              gender: m.gender || 'Other',
              dateOfBirth: m.dateOfBirth || '',
              timeOfBirth: m.timeOfBirth || '',
              placeOfBirth: m.placeOfBirth || '',
              latitude: geo.latitude,
              longitude: geo.longitude,
              timezone: m.timezone || '',
              ...(m.timezoneOffset ? { timezoneOffset: m.timezoneOffset } : {}),
            },
            partner: null,
            questions,
            extras: {},
            pandit: {
              name: pandit,
              referenceNumber: reference,
              customerEmail: order.email,
            },
            dryRun: false,
          };

          const serviceWork = generateReport(payload)
            .then(async (result) => {
              if (result.ok) {
                try {
                  const db = locals.runtime.env.SIDDH_DB;
                  // TODO(phase-8b): service should return PDF bytes; store to SIDDH_PDF and set pdf_key.
                  await setAccountOrderStatus(db, session.id, 'delivered');
                } catch (err) {
                  console.error('Delivered order status update failed:', err);
                }
              } else if (result.status !== 409) {
                try {
                  const db = locals.runtime.env.SIDDH_DB;
                  await setAccountOrderStatus(db, session.id, 'failed');
                } catch (err) {
                  console.error('Failed order status update failed:', err);
                }
              }
            })
            .catch(async (err) => {
              console.error('Report service fulfillment failed:', err);
              try {
                const db = locals.runtime.env.SIDDH_DB;
                await setAccountOrderStatus(db, session.id, 'failed');
              } catch (statusErr) {
                console.error('Failed order status update failed:', statusErr);
              }
            });
          const waitUntil = (locals.runtime as { ctx?: { waitUntil(promise: Promise<unknown>): void } }).ctx?.waitUntil;
          if (waitUntil) {
            waitUntil(serviceWork);
          } else {
            await serviceWork;
          }
        }
      }
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
    if (m.kind === 'kundli') {
      try {
        await setAccountOrderStatus(locals.runtime.env.SIDDH_DB, session.id, 'failed');
      } catch (statusErr) {
        console.error('Failed order status update failed:', statusErr);
      }
    }
    return json({ received: true }, 200);
  }

  return json({ received: true }, 200);
};

async function setAccountOrderStatus(
  db: D1Database | undefined,
  orderId: string,
  status: AccountOrderRecord['status'],
): Promise<void> {
  if (!db) return;
  const existing = await findOrderById(db, orderId);
  if (existing) await upsertOrder(db, { ...existing, status });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
