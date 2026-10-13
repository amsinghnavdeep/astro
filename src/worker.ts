import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { z } from 'zod';
import type Stripe from 'stripe';
import type { D1Database } from '@cloudflare/workers-types';
import { env } from './env.js';
import { deleteKundli, getKundli, kundliInput, listKundlis, MAX_KUNDLIS, publicKundli, saveKundli, type Kundli } from './kundlis.js';
import { LANGUAGES } from './languages.js';
import { computeChart, chartToChatContext } from './kundli/chart.js';
import { createLoginToken, destroySession, redeemLoginToken, userForSession, type User } from './auth.js';
import { sendLoginEmail } from './email.js';
import { cryptoProvider, stripe } from './stripe.js';
import {
  apiBalance, authenticateApiKey, createApiKey, grantApiCredits, listApiKeys, listApiLedger,
  refundApiCredit, revokeApiKey, spendApiCredit,
} from './api.js';
import {
  applyPayment, claimFreeConsultation, getThread, getThreadById, insertMessage, insertThread, isExpired,
  listMessages, listThreads, pendingCount, publicMessage, publicThread, sendCustomerMessage, startThreadSession,
  syncThread, type SendError, type Thread,
} from './chat.js';

import { support } from './support.js';
import { CHECKOUT_NOTE, DISCLAIMER } from './disclaimer.js';
import { creditBalance, creditLots, spendCredit } from './credits.js';
import type { AppEnv } from './types.js';

type C = Context<AppEnv>;
const chatCredits = (c: C): Promise<number> => {
  const u = c.get('user');
  return u ? creditBalance(c.env.DB, 'chat', u.id) : Promise.resolve(0);
};
const pubT = async (c: C, t: Thread) => publicThread(t, await chatCredits(c));

const app = new Hono<AppEnv>();
const COOKIE = 'kaalera_session';
const MAX_THREADS = 20;

const pricing = () => ({
  freeQuestions: env.chat.freeQuestions,
  packQuestions: env.chat.packQuestions,
  packCents: env.chat.packCents,
  consultationDays: env.chat.consultationDays,
  currency: env.stripe.currency,
});

/* ---------- shared validation ---------- */

const coord = (min: number, max: number) =>
  z.preprocess((v) => (v === '' || v == null ? undefined : Number(v)), z.number().min(min).max(max).optional());
const language = z.enum(LANGUAGES).default('English');
const birthSchema = z.object({
  fullName: z.string().trim().max(120).default(''),
  newborn: z.preprocess((v) => v === true || v === 'on' || v === 'true', z.boolean()).default(false),
  gender: z.enum(['Male', 'Female', 'Other']),
  dateOfBirth: z.string().trim().min(1).max(40),
  timeOfBirth: z.string().trim().regex(/^\d{1,2}:\d{2}(\s?[AaPp][Mm])?$/),
  placeOfBirth: z.string().trim().min(2).max(160),
  timezone: z.string().trim().min(1).max(64),
  latitude: coord(-90, 90),
  longitude: coord(-180, 180),
  language,
});
/** Name is required unless the chart is for a newborn whose name isn't chosen yet. */
function named<T extends { fullName: string; newborn: boolean }>(v: T): T | null {
  if (v.fullName) return v;
  return v.newborn ? { ...v, fullName: 'Newborn baby' } : null;
}
const kundliSchema = birthSchema.omit({ language: true });
const BIRTH_ERROR = 'Please add the name (or tick newborn), date, time and place of birth.';

async function chartContext(k: Kundli, mainName: string): Promise<string | null> {
  const chart = await chartText({ ...kundliInput(k), language: 'English' });
  if (!chart) return null;
  const name = k.full_name.replace(/[<>"]/g, '');
  return `<additional_chart person="${name}">\n${chart}\n</additional_chart>\n(This question is about ${name}, whose birth chart is above, not about ${mainName.replace(/[<>"]/g, '')} unless the customer compares them. Answer from ${name}'s chart.)`;
}

const questionText = () => z.string().trim().min(2).max(env.chat.maxMessageChars);

type BirthInput = Omit<z.infer<typeof birthSchema>, 'gender'> & { gender: string };

async function chartText(p: BirthInput): Promise<string | null> {
  try {
    return await chartToChatContext(await computeChart(p));
  } catch (err) {
    console.error('Chart computation failed:', err);
    return null;
  }
}

function newThread(userId: string, p: BirthInput, chart: string, question: string, extra: Partial<Thread>): Thread {
  return {
    id: crypto.randomUUID(), user_id: userId, full_name: p.fullName, gender: p.gender, date_of_birth: p.dateOfBirth,
    time_of_birth: p.timeOfBirth, place_of_birth: p.placeOfBirth, timezone: p.timezone, language: p.language,
    source: 'web', api_key_id: null, chart_text: chart, first_question: question, devin_session_id: null,
    devin_cursor: null, status: 'awaiting_payment', is_free: 0, questions_allowed: 0, questions_used: 1,
    acus_consumed: 0, last_synced_at: 0, created_at: new Date().toISOString(), expires_at: null, ...extra,
  };
}

async function createThreadWithQuestion(db: D1Database, t: Thread, question: string): Promise<void> {
  await insertThread(db, t);
  await insertMessage(db, { id: crypto.randomUUID(), thread_id: t.id, role: 'user', body: question, devin_event_id: null, created_at: t.created_at });
}

/* ---------- Stripe ---------- */

type CheckoutKind = 'consultation' | 'topup' | 'api_credits';

const CONSENT_REQUIRED = { error: 'Please tick the box to accept the terms before paying.', code: 'consent_required' };
const agreedIn = (body: unknown): boolean => !!body && typeof body === 'object' && (body as { agreed?: unknown }).agreed === true;

async function createCheckout(c: C, user: User, o: { kind: CheckoutKind; threadId?: string; credits: number; cents: number; name: string; returnPath: string }): Promise<string> {
  const area = o.kind === 'api_credits' ? 'api' : 'chat';
  const consentId = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO purchase_consents (id, user_id, kind, thread_id, disclaimer, ip, user_agent, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(consentId, user.id, o.kind, o.threadId ?? null, DISCLAIMER[area], c.req.header('cf-connecting-ip') ?? null,
    (c.req.header('user-agent') ?? '').slice(0, 300) || null, new Date().toISOString()).run();
  const s = await stripe().checkout.sessions.create({
    custom_text: { submit: { message: CHECKOUT_NOTE[area] } },
    mode: 'payment',
    customer_email: user.email,
    line_items: [{
      quantity: 1,
      price_data: { currency: env.stripe.currency, unit_amount: o.cents, product_data: { name: o.name } },
    }],
    metadata: { kind: o.kind, userId: user.id, threadId: o.threadId ?? '', credits: String(o.credits), consentId },
    success_url: `${env.siteUrl}${o.returnPath}${o.returnPath.includes('?') ? '&' : '?'}checkout={CHECKOUT_SESSION_ID}`,
    cancel_url: `${env.siteUrl}${o.returnPath}`,
  });
  if (!s.url) throw new Error('Stripe returned no checkout URL');
  await c.env.DB.prepare('UPDATE purchase_consents SET stripe_session_id = ? WHERE id = ?').bind(s.id, consentId).run();
  return s.url;
}

/** Idempotent: safe to call from both the webhook and the success redirect. */
async function fulfill(db: D1Database, s: Stripe.Checkout.Session): Promise<{ kind: string; threadId: string | null } | null> {
  if (s.payment_status !== 'paid') return null;
  const m = s.metadata ?? {};
  const kind = m.kind as CheckoutKind | undefined;
  if (!kind || !m.userId) return null;
  if (kind === 'api_credits') {
    await grantApiCredits(db, m.userId, Number(m.credits), `stripe:${s.id}`);
    await db.prepare(
      `INSERT INTO payments (stripe_session_id, user_id, thread_id, kind, amount_cents, currency, created_at)
       VALUES (?, ?, NULL, 'api_credits', ?, ?, ?) ON CONFLICT(stripe_session_id) DO NOTHING`,
    ).bind(s.id, m.userId, s.amount_total ?? 0, s.currency ?? env.stripe.currency, new Date().toISOString()).run();
    return { kind, threadId: null };
  }
  const t = await applyPayment(db, {
    stripeSessionId: s.id, userId: m.userId, threadId: m.threadId, kind,
    amountCents: s.amount_total ?? 0, currency: s.currency ?? env.stripe.currency,
  });
  const current = t ?? (await getThreadById(db, m.threadId));
  if (current && !current.devin_session_id && current.status !== 'starting') {
    try {
      await startThreadSession(db, current);
    } catch (err) {
      console.error('Session start after payment failed:', err);
    }
  }
  return { kind, threadId: m.threadId };
}

/* ---------- security headers + rate limits ---------- */

app.use('*', async (c, next) => {
  await next();
  const h = c.res.headers;
  h.set('X-Content-Type-Options', 'nosniff');
  h.set('X-Frame-Options', 'DENY');
  h.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  h.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  if (!h.has('Cache-Control')) h.set('Cache-Control', 'no-store');
});

type Limiter = keyof Pick<AppEnv['Bindings'], 'RL_AUTH' | 'RL_WEB' | 'RL_API'>;
const limited = async (c: C, name: Limiter, key: string): Promise<boolean> => {
  const rl = c.env[name];
  if (!rl) return false;
  try {
    return !(await rl.limit({ key })).success;
  } catch (err) {
    console.error('Rate limiter failed:', err);
    return false;
  }
};
const ip = (c: C) => c.req.header('cf-connecting-ip') ?? 'unknown';
const tooMany = (c: C) => c.json({ error: 'Too many requests. Please wait a minute and try again.' }, 429);

app.use('/api/login', async (c, next) => ((await limited(c, 'RL_AUTH', ip(c))) ? tooMany(c) : next()));
app.use('/auth/*', async (c, next) => ((await limited(c, 'RL_AUTH', ip(c))) ? tooMany(c) : next()));
app.use('/api/*', async (c, next) => {
  if (c.req.method === 'GET' || c.req.path === '/api/stripe/webhook') return next();
  return (await limited(c, 'RL_WEB', ip(c))) ? tooMany(c) : next();
});

/* ---------- web session ---------- */

app.use('/api/*', async (c, next) => {
  const user = await userForSession(c.env.DB, getCookie(c, COOKIE));
  c.set('user', user);
  const seen = (user as (User & { last_seen_at?: string | null }) | null)?.last_seen_at;
  if (user && (!seen || Date.now() - Date.parse(seen) > 5 * 60_000)) {
    const touch = c.env.DB.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?').bind(new Date().toISOString(), user.id).run();
    try {
      c.executionCtx.waitUntil(touch);
    } catch {
      await touch;
    }
  }
  await next();
});

const unauth = (c: C) => c.json({ error: 'account_required' }, 401);

app.post('/api/login', async (c) => {
  const p = z.object({ email: z.string().trim().email().max(200), name: z.string().trim().max(80).optional() })
    .safeParse(await c.req.json().catch(() => null));
  if (!p.success) return c.json({ error: 'Enter a valid email.' }, 400);
  const email = p.data.email.toLowerCase();
  const token = await createLoginToken(c.env.DB, email, p.data.name);
  if (!token) return c.json({ error: 'Too many sign-in links requested. Try again in 15 minutes.' }, 429);
  const link = `${env.siteUrl}/auth/verify?token=${encodeURIComponent(token)}`;
  if (env.devLoginLinks) return c.json({ sent: true, devLink: link });
  try {
    await sendLoginEmail(email, link);
  } catch (err) {
    console.error('Login email failed:', err);
    return c.json({ error: 'Could not send the sign-in email. Please try again.' }, 503);
  }
  return c.json({ sent: true });
});

app.get('/auth/verify', async (c) => {
  const session = await redeemLoginToken(c.env.DB, c.req.query('token') ?? '');
  if (!session) return c.redirect('/?login=expired');
  setCookie(c, COOKIE, session, {
    httpOnly: true, sameSite: 'Lax', path: '/', secure: env.siteUrl.startsWith('https'), maxAge: 60 * 60 * 24 * 30,
  });
  return c.redirect('/');
});

app.post('/api/logout', async (c) => {
  await destroySession(c.env.DB, getCookie(c, COOKIE));
  deleteCookie(c, COOKIE, { path: '/' });
  return c.json({ ok: true });
});

app.get('/api/plans', (c) => c.json({ ...pricing(), languages: LANGUAGES }));

app.get('/api/me', async (c) => {
  const user = c.get('user');
  if (!user) return unauth(c);
  return c.json({
    user: { name: user.name, email: user.email }, freeAvailable: !user.free_used,
    chatCredits: await creditLots(c.env.DB, 'chat', user.id),
    pricing: pricing(), languages: LANGUAGES, maxChars: env.chat.maxMessageChars,
  });
});

app.get('/api/places', async (c) => {
  const q = (c.req.query('q') ?? '').trim();
  if (q.length < 2) return c.json({ places: [] });
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q.split(',')[0])}&count=8&language=en&format=json`;
  const res = await fetch(url).catch(() => null);
  if (!res?.ok) return c.json({ places: [] });
  const data = (await res.json()) as { results?: { name: string; admin1?: string; country?: string; latitude: number; longitude: number; timezone?: string }[] };
  return c.json({
    places: (data.results ?? []).map((r) => ({
      label: [r.name, r.admin1, r.country].filter(Boolean).join(', '),
      latitude: r.latitude, longitude: r.longitude, timezone: r.timezone ?? null,
    })),
  });
});

/* ---------- consultations (web) ---------- */

app.get('/api/threads', async (c) => {
  const user = c.get('user');
  if (!user) return unauth(c);
  const credits = await chatCredits(c);
  return c.json({ threads: (await listThreads(c.env.DB, user.id)).map((t) => publicThread(t, credits)) });
});

app.get('/api/kundlis', async (c) => {
  const user = c.get('user');
  if (!user) return unauth(c);
  return c.json({ kundlis: (await listKundlis(c.env.DB, user.id)).map(publicKundli) });
});

async function upsertKundli(c: C, id?: string) {
  const user = c.get('user');
  if (!user) return unauth(c);
  const parsed = kundliSchema.safeParse(await c.req.json().catch(() => null));
  const data = parsed.success ? named(parsed.data) : null;
  if (!data) return c.json({ error: BIRTH_ERROR }, 400);
  if (!id && (await listKundlis(c.env.DB, user.id)).length >= MAX_KUNDLIS) return c.json({ error: `You can save up to ${MAX_KUNDLIS} Kundlis.` }, 400);
  if (!(await chartText({ ...data, language: 'English' }))) return c.json({ error: 'Could not compute this chart. Check the date, time and birthplace.' }, 400);
  const k = await saveKundli(c.env.DB, user.id, data, id);
  return k ? c.json({ kundli: publicKundli(k) }, id ? 200 : 201) : c.json({ error: 'Not found' }, 404);
}
app.post('/api/kundlis', (c) => upsertKundli(c));
app.put('/api/kundlis/:id', (c) => upsertKundli(c, c.req.param('id')));
app.delete('/api/kundlis/:id', async (c) => {
  const user = c.get('user');
  if (!user) return unauth(c);
  return (await deleteKundli(c.env.DB, user.id, c.req.param('id'))) ? c.json({ ok: true }) : c.json({ error: 'Not found' }, 404);
});

app.post('/api/threads', async (c) => {
  const user = c.get('user');
  if (!user) return unauth(c);
  const body = z.object({ kundliId: z.string().min(1), question: questionText(), language, agreed: z.boolean().optional() })
    .safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: 'Choose or add a Kundli and write your question.' }, 400);
  if (user.free_used && !body.data.agreed && (await chatCredits(c)) < 1) return c.json(CONSENT_REQUIRED, 400);
  const db = c.env.DB;
  const k = await getKundli(db, user.id, body.data.kundliId);
  if (!k) return c.json({ error: 'Choose or add a Kundli first.' }, 400);
  const p = { data: { ...kundliInput(k), language: body.data.language, question: body.data.question } };
  if ((await listThreads(db, user.id)).length >= MAX_THREADS) return c.json({ error: `You can keep up to ${MAX_THREADS} consultations.` }, 400);
  const chart = await chartText(p.data);
  if (!chart) return c.json({ error: 'Could not compute this chart. Check the date, time and birthplace.' }, 400);

  const free = await claimFreeConsultation(db, user.id);
  const t = newThread(user.id, p.data, chart, p.data.question, free ? { is_free: 1, questions_allowed: env.chat.freeQuestions } : {});
  await createThreadWithQuestion(db, t, p.data.question);
  t.kundli_id = k.id;
  await db.prepare('UPDATE threads SET kundli_id = ? WHERE id = ?').bind(k.id, t.id).run();
  if (!free && (await spendCredit(db, 'chat', user.id, `first:${t.id}`, { threadId: t.id }))) {
    await db.prepare('UPDATE threads SET questions_allowed = 1 WHERE id = ?').bind(t.id).run();
    t.questions_allowed = 1;
  } else if (!free) {
    const url = await createCheckout(c, user, {
      kind: 'consultation', threadId: t.id, credits: env.chat.packQuestions, cents: env.chat.packCents,
      name: `Kaalera consultation — ${env.chat.packQuestions} questions for ${t.full_name}`, returnPath: `/?t=${t.id}`,
    });
    return c.json({ thread: await pubT(c, t), checkoutUrl: url });
  }
  try {
    return c.json({ thread: await pubT(c, await startThreadSession(db, t)) });
  } catch (err) {
    console.error('Session creation failed:', err);
    return c.json({ thread: await pubT(c, (await getThreadById(db, t.id))!), error: 'Kaal is unavailable right now. Tap retry in a minute.' }, 503);
  }
});

const ownThread = async (c: C): Promise<Thread | null> => {
  const user = c.get('user');
  return user ? getThread(c.env.DB, user.id, c.req.param('id')!) : null;
};

app.post('/api/threads/:id/checkout', async (c) => {
  const user = c.get('user');
  if (!user) return unauth(c);
  const t = await ownThread(c);
  if (!t) return c.json({ error: 'Not found' }, 404);
  if (isExpired(t)) return c.json({ error: 'This consultation has closed. Start a new one.' }, 409);
  if (!agreedIn(await c.req.json().catch(() => null))) return c.json(CONSENT_REQUIRED, 400);
  const kind: CheckoutKind = t.status === 'awaiting_payment' ? 'consultation' : 'topup';
  const url = await createCheckout(c, user, {
    kind, threadId: t.id, credits: env.chat.packQuestions, cents: env.chat.packCents,
    name: kind === 'topup'
      ? `Kaalera — ${env.chat.packQuestions} more questions for ${t.full_name}`
      : `Kaalera consultation — ${env.chat.packQuestions} questions for ${t.full_name}`,
    returnPath: `/?t=${t.id}`,
  });
  return c.json({ checkoutUrl: url });
});

app.post('/api/threads/:id/retry', async (c) => {
  const t = await ownThread(c);
  if (!t) return c.json({ error: 'Not found' }, 404);
  if (t.status !== 'failed' || t.questions_allowed < 1) return c.json({ error: 'Nothing to retry.' }, 409);
  try {
    return c.json({ thread: await pubT(c, await startThreadSession(c.env.DB, t)) });
  } catch {
    return c.json({ error: 'Kaal is still unavailable. Please try again shortly.' }, 503);
  }
});

app.patch('/api/threads/:id', async (c) => {
  const t = await ownThread(c);
  if (!t) return c.json({ error: 'Not found' }, 404);
  const p = z.object({ language }).safeParse(await c.req.json().catch(() => null));
  if (!p.success) return c.json({ error: 'Unsupported language.' }, 400);
  await c.env.DB.prepare('UPDATE threads SET language = ? WHERE id = ?').bind(p.data.language, t.id).run();
  return c.json({ thread: await pubT(c, { ...t, language: p.data.language }) });
});

app.get('/api/threads/:id/messages', async (c) => {
  const t = await ownThread(c);
  if (!t) return c.json({ error: 'Not found' }, 404);
  try {
    await syncThread(c.env.DB, t);
  } catch (err) {
    console.error('Sync failed:', err);
  }
  const fresh = (await getThreadById(c.env.DB, t.id))!;
  const messages = await listMessages(c.env.DB, t.id);
  const live = fresh.status === 'active' || fresh.status === 'starting';
  return c.json({ thread: await pubT(c, fresh), messages: messages.map(publicMessage), pending: live ? pendingCount(messages) : 0 });
});

const SEND_ERRORS: Record<SendError, [402 | 409 | 429 | 503, string]> = {
  no_questions: [402, 'no_questions'],
  expired: [409, 'This consultation has closed after a week. Start a new one.'],
  too_many_pending: [429, 'Please wait for Kaal to answer your previous question.'],
  thread_unavailable: [409, 'This consultation is not active.'],
  delivery_failed: [503, 'Your question could not be delivered. It was not charged.'],
};

app.post('/api/threads/:id/messages', async (c) => {
  const t = await ownThread(c);
  if (!t) return c.json({ error: 'Not found' }, 404);
  const p = z.object({ text: questionText(), language: z.enum(LANGUAGES).optional(), kundliId: z.string().optional() })
    .safeParse(await c.req.json().catch(() => null));
  if (!p.success) return c.json({ error: `Please write a question (up to ${env.chat.maxMessageChars} characters).` }, 400);
  let context: string | undefined;
  if (p.data.kundliId && p.data.kundliId !== t.kundli_id) {
    const k = await getKundli(c.env.DB, t.user_id, p.data.kundliId);
    if (!k) return c.json({ error: 'That Kundli was not found.' }, 400);
    context = (await chartContext(k, t.full_name)) ?? undefined;
    if (!context) return c.json({ error: 'Could not compute that chart. Check its birth details.' }, 400);
  }
  const r = await sendCustomerMessage(c.env.DB, t, p.data.text, p.data.language, context);
  if (r.error) {
    const [status, error] = SEND_ERRORS[r.error];
    return c.json({ error }, status);
  }
  return c.json({ message: publicMessage(r.message!), thread: await pubT(c, (await getThreadById(c.env.DB, t.id))!) });
});

app.get('/api/checkout/confirm', async (c) => {
  const user = c.get('user');
  if (!user) return unauth(c);
  const id = c.req.query('session_id') ?? '';
  if (!id.startsWith('cs_')) return c.json({ error: 'Bad session' }, 400);
  const s = await stripe().checkout.sessions.retrieve(id);
  if (s.metadata?.userId !== user.id) return c.json({ error: 'Not found' }, 404);
  const r = await fulfill(c.env.DB, s);
  return c.json({ paid: s.payment_status === 'paid', kind: r?.kind ?? s.metadata?.kind, threadId: r?.threadId ?? null });
});

app.post('/api/stripe/webhook', async (c) => {
  const sig = c.req.header('stripe-signature');
  const body = await c.req.text();
  let event: Stripe.Event;
  try {
    event = await stripe().webhooks.constructEventAsync(body, sig ?? '', env.stripe.webhookSecret, undefined, cryptoProvider);
  } catch {
    return c.text('Invalid signature', 400);
  }
  if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
    await fulfill(c.env.DB, event.data.object as Stripe.Checkout.Session);
  }
  return c.json({ received: true });
});

/* ---------- developer dashboard (cookie auth) ---------- */

app.get('/api/developer', async (c) => {
  const user = c.get('user');
  if (!user) return unauth(c);
  const db = c.env.DB;
  const [keys, balance, ledger] = await Promise.all([listApiKeys(db, user.id), apiBalance(db, user.id), listApiLedger(db, user.id)]);
  return c.json({ keys, balance, ledger, packs: env.api.packs, creditCents: env.api.creditCents, creditLots: await creditLots(db, 'api', user.id) });
});

app.post('/api/developer/keys', async (c) => {
  const user = c.get('user');
  if (!user) return unauth(c);
  const p = z.object({ name: z.string().trim().min(1).max(60) }).safeParse(await c.req.json().catch(() => null));
  if (!p.success) return c.json({ error: 'Give the key a name.' }, 400);
  if ((await listApiKeys(c.env.DB, user.id)).filter((k) => !k.revoked_at).length >= 10) return c.json({ error: 'Up to 10 active keys.' }, 400);
  return c.json(await createApiKey(c.env.DB, user.id, p.data.name));
});

app.delete('/api/developer/keys/:id', async (c) => {
  const user = c.get('user');
  if (!user) return unauth(c);
  return (await revokeApiKey(c.env.DB, user.id, c.req.param('id'))) ? c.json({ ok: true }) : c.json({ error: 'Not found' }, 404);
});

app.post('/api/developer/checkout', async (c) => {
  const user = c.get('user');
  if (!user) return unauth(c);
  const body = (await c.req.json().catch(() => ({}))) as { packId?: string; agreed?: boolean };
  const pack = env.api.packs.find((p) => p.id === body.packId);
  if (!pack) return c.json({ error: 'Unknown pack' }, 400);
  if (!agreedIn(body)) return c.json(CONSENT_REQUIRED, 400);
  const url = await createCheckout(c, user, {
    kind: 'api_credits', credits: pack.credits, cents: pack.cents,
    name: `Kaalera API — ${pack.credits} question credits`, returnPath: '/developers',
  });
  return c.json({ checkoutUrl: url });
});

/* ---------- public API v1 (Bearer API key) ---------- */

const apiError = (c: C, status: 400 | 401 | 402 | 404 | 409 | 429 | 503, code: string, message: string) =>
  c.json({ error: { code, message } }, status);

app.use('/v1/*', cors({ origin: '*', allowHeaders: ['Authorization', 'Content-Type'], allowMethods: ['GET', 'POST', 'OPTIONS'] }));
app.use('/v1/*', async (c, next) => {
  if (c.req.method === 'OPTIONS') return next();
  const raw = c.req.header('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  const auth = raw ? await authenticateApiKey(c.env.DB, raw) : null;
  if (!auth) {
    if (await limited(c, 'RL_AUTH', `v1:${ip(c)}`)) return apiError(c, 429, 'rate_limited', 'Too many requests.');
    return apiError(c, 401, 'invalid_api_key', 'Missing or invalid API key.');
  }
  if (await limited(c, 'RL_API', auth.keyId)) return apiError(c, 429, 'rate_limited', 'Rate limit exceeded (120 requests per minute per key).');
  c.set('api', auth);
  await next();
});

const apiConsultation = (t: Thread, messages?: Awaited<ReturnType<typeof listMessages>>) => ({
  id: t.id, name: t.full_name, language: t.language,
  status: isExpired(t) ? 'closed' : t.status === 'failed' ? 'failed' : messages && pendingCount(messages) > 0 ? 'answering' : t.status === 'active' ? 'ready' : 'starting',
  created_at: t.created_at, expires_at: t.expires_at ? new Date(t.expires_at).toISOString() : null,
  ...(messages ? { messages: messages.map((m) => ({ id: m.id, role: m.role === 'pandit' ? 'kaal' : 'user', content: m.body, created_at: m.created_at })) } : {}),
});

app.get('/v1/balance', async (c) => c.json({ credits: await apiBalance(c.env.DB, c.get('api').userId) }));

app.post('/v1/consultations', async (c) => {
  const { userId, keyId } = c.get('api');
  const parsed = birthSchema.extend({ question: questionText() }).safeParse(await c.req.json().catch(() => null));
  const named_ = parsed.success ? named(parsed.data) : null;
  const p = named_ ? { success: true as const, data: named_ } : { success: false as const };
  if (!p.success) return apiError(c, 400, 'invalid_request', parsed.success ? 'fullName is required unless newborn is true.' : parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  const db = c.env.DB;
  const chart = await chartText(p.data);
  if (!chart) return apiError(c, 400, 'chart_failed', 'Could not compute the chart. Check date, time, place and timezone.');
  const t = newThread(userId, p.data, chart, p.data.question, { source: 'api', api_key_id: keyId });
  const ref = `consultation:${t.id}`;
  if (!(await spendApiCredit(db, userId, ref, keyId, t.id))) return apiError(c, 402, 'insufficient_credits', 'Not enough API credits. Buy more at /developers.');
  await createThreadWithQuestion(db, t, p.data.question);
  try {
    const started = await startThreadSession(db, t);
    return c.json({ consultation: apiConsultation(started, await listMessages(db, started.id)), credits_remaining: await apiBalance(db, userId) }, 201);
  } catch (err) {
    console.error('API session start failed:', err);
    await refundApiCredit(db, userId, ref);
    return apiError(c, 503, 'unavailable', 'Kaal is unavailable right now. You were not charged.');
  }
});

const ownApiThread = async (c: C): Promise<Thread | null> => {
  const t = await getThreadById(c.env.DB, c.req.param('id')!);
  return t && t.source === 'api' && t.user_id === c.get('api').userId ? t : null;
};

app.get('/v1/consultations/:id', async (c) => {
  const t = await ownApiThread(c);
  if (!t) return apiError(c, 404, 'not_found', 'Consultation not found.');
  try {
    await syncThread(c.env.DB, t);
  } catch (err) {
    console.error('API sync failed:', err);
  }
  return c.json({ consultation: apiConsultation((await getThreadById(c.env.DB, t.id))!, await listMessages(c.env.DB, t.id)) });
});

const API_SEND_ERRORS: Record<SendError, [402 | 409 | 429 | 503, string, string]> = {
  no_questions: [402, 'insufficient_credits', 'Not enough API credits.'],
  expired: [409, 'consultation_closed', 'Consultations close 7 days after they start. Create a new one.'],
  too_many_pending: [429, 'answer_pending', 'Wait for the current answer before asking again.'],
  thread_unavailable: [409, 'consultation_not_ready', 'The consultation is not ready yet.'],
  delivery_failed: [503, 'unavailable', 'Could not deliver the question. You were not charged.'],
};

app.post('/v1/consultations/:id/questions', async (c) => {
  const t = await ownApiThread(c);
  if (!t) return apiError(c, 404, 'not_found', 'Consultation not found.');
  const p = z.object({ question: questionText(), language: z.enum(LANGUAGES).optional() }).safeParse(await c.req.json().catch(() => null));
  if (!p.success) return apiError(c, 400, 'invalid_request', `question is required (2–${env.chat.maxMessageChars} characters).`);
  const r = await sendCustomerMessage(c.env.DB, t, p.data.question, p.data.language);
  if (r.error) {
    const [status, code, message] = API_SEND_ERRORS[r.error];
    return apiError(c, status, code, message);
  }
  return c.json({ question_id: r.message!.id, status: 'answering', credits_remaining: await apiBalance(c.env.DB, t.user_id) }, 202);
});

app.route('/api/support', support);

app.notFound((c) => c.json({ error: 'Not found' }, 404));
app.onError((err, c) => {
  console.error(err);
  return c.json({ error: 'Something went wrong.' }, 500);
});

export default app;
