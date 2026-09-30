/**
 * Stripe webhook — the core fulfillment endpoint.
 *
 * When a Checkout Session completes, Stripe calls this endpoint. We verify the
 * signature against the RAW request body, claim the session exactly once, then
 * fulfil in the background (Stripe gets a fast 200):
 *   - kind 'kundli':   read the order payload from the KV lead record, pre-compute
 *                      the chart(s) in the Worker and start the `!kundli` playbook
 *                      session, which emails the PDF + reference number.
 *   - kind 'followup': decode the reference back to the session id and ask the
 *                      follow-up questions on that same session.
 */
export const prerender = false;
import type { APIRoute } from 'astro';
import type Stripe from 'stripe';
import type { D1Database, ExecutionContext, KVNamespace } from '@cloudflare/workers-types';
import { stripe, cryptoProvider } from '../../../lib/stripe';
import { env } from '../../../lib/env';
import {
  createKundliSession,
  askFollowup,
  instructKundliDelivery,
  type PersonDetails,
} from '../../../lib/devin';
import { encodeReference, decodeReference } from '../../../lib/reference';
import { recordOrder, type OrderRecord } from '../../../lib/orders';
import { deleteLead, getLead, type LeadPerson, type LeadRecord } from '../../../lib/leads';
import { computeChart, chartToPromptText } from '../../../lib/kundli/chart';
import {
  findOrderById,
  upsertOrder,
  type OrderRecord as AccountOrderRecord,
} from '../../../lib/auth';

const KV_CLAIM_PREFIX = 'fulfilment-claim:';
const KV_CLAIM_TTL_SECONDS = 60 * 60 * 24 * 30;

interface Stores {
  db: D1Database | undefined;
  kv: KVNamespace | undefined;
}

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
  const kind: OrderRecord['kind'] = m.kind === 'followup' ? 'followup' : 'kundli';
  const stores: Stores = { db: locals.runtime.env.SIDDH_DB, kv: locals.runtime.env.SIDDH_KV };

  // Kundli orders are fulfilled from the KV lead written at checkout. If it is
  // not readable yet, ask Stripe to retry rather than fulfil without the
  // customer's questions.
  let lead: LeadRecord | null = null;
  try {
    lead = await getLead(stores.kv, session.id);
  } catch (err) {
    console.error('Lead lookup error:', err);
  }
  if (lead && lead.kind !== kind) lead = null;
  if (kind === 'kundli') {
    lead ??= leadFromLegacyMetadata(session);
    if (!lead) {
      // Already fulfilled sessions have had their lead deleted.
      if (await isClaimed(stores, session.id).catch(() => false)) {
        console.info('Duplicate checkout.session.completed ignored:', session.id);
        return json({ received: true, duplicate: true }, 200);
      }
      console.error('Order payload not found for paid session; asking Stripe to retry:', session.id);
      return json({ error: 'order_payload_unavailable' }, 500);
    }
  }

  const createdAt = new Date(event.created * 1000);
  const order: OrderRecord = {
    id: session.id,
    kind,
    amountTotal: session.amount_total ?? 0,
    currency: session.currency ?? '',
    email: session.customer_email ?? lead?.email ?? m.email ?? '',
    fullName: lead?.fullName ?? (m.fullName || undefined),
    questionCount: lead ? lead.questions.length : Number(m.questionCount) || undefined,
    createdAt: createdAt.toISOString(),
    createdAtMs: createdAt.getTime(),
  };

  let claimed: boolean;
  try {
    claimed = await claimFulfilment(stores, {
      id: order.id,
      user_id: m.userId || lead?.userId || null,
      email: order.email,
      kind: order.kind,
      service_type: order.kind,
      full_name: order.fullName ?? null,
      amount_total: order.amountTotal,
      currency: order.currency,
      status: 'fulfilling',
      pdf_key: null,
      reference_number: m.reference || null,
      created_at: order.createdAt,
    });
  } catch (err) {
    console.error('Fulfilment claim error; asking Stripe to retry:', err);
    return json({ error: 'claim_unavailable' }, 500);
  }
  if (!claimed) {
    console.info('Duplicate checkout.session.completed ignored:', session.id);
    return json({ received: true, duplicate: true }, 200);
  }

  try {
    await recordOrder(stores.kv, order);
  } catch (err) {
    console.error('Order persistence error:', err);
  }

  const work =
    kind === 'kundli' && lead
      ? fulfilKundli(stores, session.id, lead)
      : fulfilFollowup(
          stores,
          session.id,
          lead?.reference ?? m.reference ?? '',
          lead ? lead.questions : parseMetadataQuestions(m.questions),
        );
  const ctx = locals.runtime.ctx as ExecutionContext | undefined;
  if (ctx) {
    ctx.waitUntil(work);
  } else {
    await work;
  }

  return json({ received: true }, 200);
};

async function fulfilKundli(stores: Stores, sessionId: string, lead: LeadRecord): Promise<void> {
  const primary = leadPrimary(lead);
  if (!primary) {
    console.error('Kundli lead is missing birth details:', sessionId);
    await releaseClaim(stores, sessionId);
    return;
  }
  const pandit = lead.pandit || 'our senior astrologer';
  const email = lead.email;

  // Pre-compute the chart(s) in the Worker so the Devin session only has to
  // interpret them (big ACU saving). If a computation fails, the playbook
  // computes that chart itself.
  const [primaryChart, partnerChart] = await Promise.all([
    precompute(primary, 'primary'),
    lead.partner ? precompute(lead.partner, 'partner') : Promise.resolve(undefined),
  ]);
  const partner: PersonDetails | undefined = lead.partner
    ? { ...lead.partner, precomputedChart: partnerChart }
    : undefined;

  let devinSessionId: string;
  try {
    const devinSession = await createKundliSession({
      ...primary,
      precomputedChart: primaryChart,
      email,
      questions: lead.questions.join('\n\n'),
      pandit,
      partner,
    });
    devinSessionId = devinSession.session_id;
  } catch (err) {
    console.error('Devin Kundli session creation failed:', err);
    await releaseClaim(stores, sessionId);
    return;
  }
  console.info('Created Devin Kundli session:', devinSessionId);

  try {
    await deleteLead(stores.kv, sessionId);
  } catch (err) {
    console.error('Lead deletion error:', err);
  }

  // No backend email here. We hand the session the reference + delivery
  // instruction; the `!kundli` playbook then sends the customer EXACTLY ONE
  // email — framed as from their Pandit — with the PDF and reference number.
  try {
    await instructKundliDelivery(devinSessionId, {
      reference: encodeReference(devinSessionId),
      pandit,
      email,
      fullName: primary.fullName,
    });
    console.info('Kundli delivery instruction accepted:', devinSessionId);
  } catch (err) {
    console.error('Kundli delivery instruction error:', err);
  }
}

async function fulfilFollowup(
  stores: Stores,
  sessionId: string,
  reference: string,
  questions: string[],
): Promise<void> {
  try {
    await askFollowup(decodeReference(reference), questions);
  } catch (err) {
    console.error('Follow-up fulfilment error:', err);
    await releaseClaim(stores, sessionId);
    return;
  }
  try {
    await deleteLead(stores.kv, sessionId);
  } catch (err) {
    console.error('Lead deletion error:', err);
  }
}

/** Metadata copy of follow-up questions; only used when the KV lead is missing. */
function parseMetadataQuestions(raw: string | undefined): string[] {
  try {
    const parsed: unknown = JSON.parse(raw || '[]');
    if (Array.isArray(parsed)) return parsed.filter((q): q is string => typeof q === 'string');
  } catch {
    // Truncated metadata is not valid JSON; fall through.
  }
  return raw ? [raw] : [];
}

async function precompute(person: LeadPerson, label: string): Promise<string | undefined> {
  try {
    const chart = await computeChart({
      dateOfBirth: person.dateOfBirth,
      timeOfBirth: person.timeOfBirth,
      placeOfBirth: person.placeOfBirth,
      timezone: person.timezone,
    });
    return chartToPromptText(chart);
  } catch {
    // Deliberately no error detail: messages can echo birth details.
    console.error(`Chart pre-computation failed (${label}); playbook will compute it.`);
    return undefined;
  }
}

function leadPrimary(lead: LeadRecord): LeadPerson | null {
  if (!lead.fullName || !lead.gender || !lead.dateOfBirth || !lead.timeOfBirth || !lead.placeOfBirth || !lead.timezone) {
    return null;
  }
  return {
    fullName: lead.fullName,
    gender: lead.gender,
    dateOfBirth: lead.dateOfBirth,
    timeOfBirth: lead.timeOfBirth,
    placeOfBirth: lead.placeOfBirth,
    timezone: lead.timezone,
  };
}

/**
 * Sessions created before the order payload moved to KV carried the birth
 * details in metadata; keep fulfilling those if their lead is gone.
 */
function leadFromLegacyMetadata(session: Stripe.Checkout.Session): LeadRecord | null {
  const m = session.metadata ?? {};
  const gender = m.gender === 'Male' || m.gender === 'Female' || m.gender === 'Other' ? m.gender : 'Other';
  if (!m.fullName || !m.dateOfBirth || !m.timeOfBirth || !m.placeOfBirth || !m.timezone) return null;
  let questions: string[] = [];
  try {
    const parsed: unknown = JSON.parse(m.questions || '[]');
    if (Array.isArray(parsed)) questions = parsed.filter((q): q is string => typeof q === 'string');
  } catch {
    questions = [];
  }
  const createdAt = new Date(session.created * 1000);
  return {
    id: session.id,
    kind: 'kundli',
    userId: m.userId || undefined,
    email: session.customer_email ?? m.email ?? '',
    fullName: m.fullName,
    gender,
    dateOfBirth: m.dateOfBirth,
    timeOfBirth: m.timeOfBirth,
    placeOfBirth: m.placeOfBirth,
    timezone: m.timezone,
    questions,
    charts: 1,
    pandit: m.pandit || undefined,
    amountTotal: session.amount_total ?? 0,
    currency: session.currency ?? '',
    createdAt: createdAt.toISOString(),
    createdAtMs: createdAt.getTime(),
  };
}

/**
 * Claim a Checkout Session for fulfilment exactly once, so a re-delivered
 * `checkout.session.completed` never starts a second session or email.
 *
 * With D1 the claim is the atomic insert of the account order row: it only
 * succeeds for a new order, or re-claims one whose earlier fulfilment failed.
 * Without D1 it falls back to a (best-effort) KV marker.
 */
async function claimFulfilment(stores: Stores, row: AccountOrderRecord): Promise<boolean> {
  if (stores.db) {
    const result = await stores.db
      .prepare(
        `INSERT INTO orders
         (id, user_id, email, kind, service_type, full_name, amount_total,
          currency, status, pdf_key, reference_number, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           user_id = excluded.user_id,
           email = excluded.email,
           full_name = excluded.full_name,
           amount_total = excluded.amount_total,
           currency = excluded.currency,
           status = excluded.status
         WHERE orders.status = 'failed'`,
      )
      .bind(
        row.id,
        row.user_id,
        row.email,
        row.kind,
        row.service_type,
        row.full_name,
        row.amount_total,
        row.currency,
        row.status,
        row.pdf_key,
        row.reference_number,
        row.created_at,
      )
      .run();
    return result.meta.changes > 0;
  }
  if (stores.kv) {
    const key = `${KV_CLAIM_PREFIX}${row.id}`;
    if (await stores.kv.get(key)) return false;
    await stores.kv.put(key, new Date().toISOString(), { expirationTtl: KV_CLAIM_TTL_SECONDS });
    return true;
  }
  throw new Error('Neither D1 nor KV is configured for the fulfilment claim');
}

async function isClaimed(stores: Stores, orderId: string): Promise<boolean> {
  if (stores.db) {
    const existing = await findOrderById(stores.db, orderId);
    return Boolean(existing && existing.status !== 'failed');
  }
  if (stores.kv) return Boolean(await stores.kv.get(`${KV_CLAIM_PREFIX}${orderId}`));
  return false;
}

/** Mark a claimed order failed so a later (manual) re-delivery can fulfil it. */
async function releaseClaim(stores: Stores, orderId: string): Promise<void> {
  try {
    if (stores.db) {
      await setAccountOrderStatus(stores.db, orderId, 'failed');
    } else if (stores.kv) {
      await stores.kv.delete(`${KV_CLAIM_PREFIX}${orderId}`);
    }
  } catch (err) {
    console.error('Failed order status update failed:', err);
  }
}

async function setAccountOrderStatus(
  db: D1Database,
  orderId: string,
  status: AccountOrderRecord['status'],
): Promise<void> {
  const existing = await findOrderById(db, orderId);
  if (existing) await upsertOrder(db, { ...existing, status });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
