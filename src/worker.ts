import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { ensureDeviceCookie, freeBlocked, freeKeys, isDisposable, recordFreeClaims } from './freeclaims.js';
import { z } from 'zod';
import type Stripe from 'stripe';
import type { D1Database } from '@cloudflare/workers-types';
import { env } from './env.js';
import { deleteKundli, getKundli, kundliInput, listKundlis, MAX_KUNDLIS, publicKundli, saveKundli, type Kundli } from './kundlis.js';
import { LANGUAGES } from './languages.js';
import { computeChart, computeSky, chartToChatContext } from './kundli/chart.js';
import { createLoginToken, destroySession, redeemLoginToken, userForSession, type User } from './auth.js';
import { escapeHtml, sendContactEmails, sendLoginEmail, sendPayoutRequestEmail, sendPayoutSentEmail, sendSubscriptionTrialEndingEmail } from './email.js';
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
import { checkoutNote, disclaimer } from './disclaimer.js';
import { API_DISCOUNT_PERCENT, apiActivated, apiPrice, apiPacks, getPrices, priceHistory, setPrices, taxesAndFees } from './settings.js';

const usdCents = (cents: number): string => `$${(cents / 100).toFixed(cents % 100 ? 2 : 0)}`;
import { admin } from './admin.js';
import { autoChargeQuestion, autoRechargeApi, CHAT_RELOAD_QUESTIONS, ensureCustomer, getBilling, publicBilling, RECEIPT_ITEM, saveCardFromCheckout, sendReceipt } from './autocharge.js';
import { CONTACT_TOPICS, contactPage, privacyPage, termsPage } from './legal.js';
import { affiliatesPage, influencersPage } from './programs.js';
import { chatPrices, listFestivals, updateFestival } from './festivals.js';
import { sendExpiryReminders, sendFestivalEmails, sendInfluencerDigests, unsubscribe, validUnsubToken } from './engagement.js';
import { festivalSchema, isAdmin, postSchema, pricesSchema } from './admin.js';
import { CODE_RE, createCoupon, listCoupons, normCode, redeemCoupon, setCouponEnabled } from './coupons.js';
import { apiTokenInfo, AUDIENCES, broadcastLog, checkApiToken, FROM_IDS, renderEmail, resolveRecipients, rotateApiToken, sendBroadcast, sendTest, type AudienceId, type Draft } from './broadcast.js';
import { isKaalKey, KAAL_FIELDS, KAAL_MAX_CHARS, KAAL_MIN_CHARS, kaalFields, kaalHistory, kaalVersion, setKaalPrompt } from './kaalPrompt.js';
import { adminPage, blogTab, festivalsTab, filterRows, FILTER_KEYS, noticeHtml, peopleCsv, couponsTab, emailTab, kaalTab, pricesTab, PRICE_FIELDS, toRows, type Filters, type Person } from './adminPage.js';
import { CLIENT_EVENTS, funnel, markLeadSignedUp, saveLead, trackPayment, trackSafe, type FunnelEvent } from './analytics.js';
import { addReminder, listReminders, sendDueReminders } from './reminders.js';
import { attributeSignup, captureReferral, createInfluencer, getPayout, grantFriendBonus, markPayoutPaid, partnerState, PAYOUT_METHODS, payoutsCsv, requestPayout, validateCode, type PayoutMethod } from './partners.js';
import { blogIndexPage, blogPostPage, blogVersion, deletePost, getPost, getPublishedPost, listPosts, savePost, slugify, llmsTxt, robotsTxt, rssXml, sitemapXml } from './blog.js';
import { layout } from './seo/layout.js';
import { TOPICS, topicPage } from './seo/topics.js';
import { creditBalance, creditLots, grantCredits, spendCredit } from './credits.js';
import { checkPhoneVerification, startPhoneVerification, validPhone } from './phone.js';
import {
  createSubscriptionCheckout, ensurePlanProduct, markTrialIdentity, planFor, plansForPrices, spendSubscriptionConsultation,
  stripeId, subscriptionForUser, subscriptionIdFromInvoice, syncSubscription, trialEligible, type PlanId,
} from './subscriptions.js';
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

const pricing = async (db: D1Database, userId?: string) => {
  const p = await chatPrices(db, userId);
  return {
    freeQuestions: p.freeQuestions, packQuestions: p.chatPackQuestions, packCents: p.chatPackCents, extraQuestionCents: p.extraQuestionCents, quickWords: p.quickWords,
    consultationDays: env.chat.consultationDays, currency: env.stripe.currency, taxFeePercent: p.taxFeePercent,
    deal: p.deal, business: p.business, fullPackCents: p.fullPackCents, fullExtraQuestionCents: p.fullExtraQuestionCents,
  };
};

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
const FREE_BLOCKED = { error: 'The free reading was already used on this device or connection. Further questions are paid.', code: 'free_used' };
const agreedIn = (body: unknown): boolean => !!body && typeof body === 'object' && (body as { agreed?: unknown }).agreed === true;

async function createCheckout(c: C, user: User, o: { kind: CheckoutKind; threadId?: string; credits: number; cents: number; name: string; returnPath: string }): Promise<string> {
  const area = o.kind === 'api_credits' ? 'api' : 'chat';
  const consentId = crypto.randomUUID();
  const prices = await chatPrices(c.env.DB, user.id);
  const tax = prices.taxFeePercent;
  const name = area !== 'chat' ? o.name : prices.business ? `${o.name} (Business price)` : prices.deal ? `${o.name} (${prices.deal.name} ${prices.deal.percent}% off)` : o.name;
  await c.env.DB.prepare(
    `INSERT INTO purchase_consents (id, user_id, kind, thread_id, disclaimer, ip, user_agent, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(consentId, user.id, o.kind, o.threadId ?? null, disclaimer(area, prices), c.req.header('cf-connecting-ip') ?? null,
    (c.req.header('user-agent') ?? '').slice(0, 300) || null, new Date().toISOString()).run();
  const s = await stripe().checkout.sessions.create({
    custom_text: { submit: { message: checkoutNote(area, prices) } },
    mode: 'payment',
    customer: await ensureCustomer(c.env.DB, user),
    payment_intent_data: { setup_future_usage: 'off_session' },
    line_items: [
      { quantity: 1, price_data: { currency: env.stripe.currency, unit_amount: o.cents, product_data: { name } } },
      ...(tax > 0 ? [{
        quantity: 1,
        price_data: { currency: env.stripe.currency, unit_amount: taxesAndFees(o.cents, tax), product_data: { name: `Taxes & fees (${tax}%)` } },
      }] : []),
    ],
    metadata: { kind: o.kind, userId: user.id, threadId: o.threadId ?? '', credits: String(o.credits), consentId, baseCents: String(o.cents) },
    success_url: `${env.siteUrl}${o.returnPath}${o.returnPath.includes('?') ? '&' : '?'}checkout={CHECKOUT_SESSION_ID}`,
    cancel_url: `${env.siteUrl}${o.returnPath}`,
  });
  if (!s.url) throw new Error('Stripe returned no checkout URL');
  await c.env.DB.prepare('UPDATE purchase_consents SET stripe_session_id = ? WHERE id = ?').bind(s.id, consentId).run();
  background(c, trackSafe(c.env.DB, 'checkout_opened'));
  return s.url;
}

/** Idempotent: safe to call from both the webhook and the success redirect. */
async function fulfill(db: D1Database, s: Stripe.Checkout.Session): Promise<{ kind: string; threadId: string | null } | null> {
  if (s.payment_status !== 'paid') return null;
  const m = s.metadata ?? {};
  const kind = m.kind as CheckoutKind | undefined;
  if (!kind || !m.userId) return null;
  await saveCardFromCheckout(db, s).catch((err) => console.error('Saving card failed:', err));
  const receipt = { totalCents: s.amount_total ?? 0, baseCents: Number(m.baseCents) || undefined, auto: false, ref: s.id };
  if (kind === 'api_credits') {
    await grantApiCredits(db, m.userId, Number(m.credits), `stripe:${s.id}`);
    await db.prepare("UPDATE users SET account_type = 'business' WHERE id = ?").bind(m.userId).run();
    const ins = await db.prepare(
      `INSERT INTO payments (stripe_session_id, user_id, thread_id, kind, amount_cents, currency, created_at)
       VALUES (?, ?, NULL, 'api_credits', ?, ?, ?) ON CONFLICT(stripe_session_id) DO NOTHING`,
    ).bind(s.id, m.userId, s.amount_total ?? 0, s.currency ?? env.stripe.currency, new Date().toISOString()).run();
    if (ins.meta?.changes) {
      await sendReceipt(db, m.userId, { ...receipt, item: `API wallet top-up ${usdCents(Number(m.credits))}`, api: true });
      await trackPayment(db, m.userId);
    }
    return { kind, threadId: null };
  }
  const t = await applyPayment(db, {
    stripeSessionId: s.id, userId: m.userId, threadId: m.threadId, kind, credits: Number(m.credits) || 1,
    amountCents: s.amount_total ?? 0, currency: s.currency ?? env.stripe.currency,
  });
  if (t) {
    await sendReceipt(db, m.userId, { ...receipt, item: RECEIPT_ITEM[kind] });
    await trackPayment(db, m.userId);
  }
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

/** Run work after the response is sent (falls back to awaiting-free fire-and-forget outside Workers). */
function background(c: C, p: Promise<unknown>): void {
  const safe = p.catch((err) => console.error('Background task failed:', err));
  try {
    c.executionCtx.waitUntil(safe);
  } catch {
    void safe;
  }
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
  ensureDeviceCookie(c, env.siteUrl.startsWith('https'));
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
  const p = z.object({ email: z.string().trim().email().max(200), name: z.string().trim().max(80).optional(), optin: z.boolean().optional() })
    .safeParse(await c.req.json().catch(() => null));
  if (!p.success) return c.json({ error: 'Enter a valid email.' }, 400);
  const email = p.data.email.toLowerCase();
  if (isDisposable(email) && !(await c.env.DB.prepare('SELECT 1 FROM users WHERE email = ?').bind(email).first()))
    return c.json({ error: 'Please use your regular email address. Temporary email services are not accepted.' }, 400);
  if (p.data.optin) await saveLead(c.env.DB, email, true).catch((err) => console.error('Lead save failed:', err));
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

/** Requests signed with the owner admin token (no cookies, so no cross-site risk). */
const ownerTokenReqs = new WeakSet<Request>();
const sameSite = (c: C): boolean => {
  if (ownerTokenReqs.has(c.req.raw)) return true;
  const origin = c.req.header('origin');
  return !!origin && (origin === new URL(env.siteUrl).origin || origin === new URL(c.req.url).origin);
};

app.post('/api/lead', async (c) => {
  if (!sameSite(c)) return c.json({ error: 'Not allowed' }, 403);
  const p = z.object({ email: z.string().trim().email().max(200), optin: z.boolean().optional() }).strict()
    .safeParse(await c.req.json().catch(() => null));
  if (!p.success) return c.json({ ok: false }, 400);
  const email = p.data.email.toLowerCase();
  if (isDisposable(email)) return c.json({ ok: false }, 400);
  if (await saveLead(c.env.DB, email, !!p.data.optin)) background(c, trackSafe(c.env.DB, 'email_typed'));
  return c.json({ ok: true });
});

app.post('/api/track', async (c) => {
  if (!sameSite(c)) return c.json({ error: 'Not allowed' }, 403);
  const event = ((await c.req.json().catch(() => ({}))) as { event?: unknown }).event;
  if (typeof event !== 'string' || !CLIENT_EVENTS.includes(event as FunnelEvent)) return c.json({ ok: false }, 400);
  background(c, trackSafe(c.env.DB, event as FunnelEvent));
  return c.json({ ok: true });
});

app.get('/auth/verify', async (c) => {
  const session = await redeemLoginToken(c.env.DB, c.req.query('token') ?? '');
  if (!session) return c.redirect('/?login=expired');
  const fresh = await userForSession(c.env.DB, session);
  if (fresh) {
    await attributeSignup(c, c.env.DB, fresh, await freeKeys(c)).catch((err) => console.error('Referral attribution failed:', err));
    background(c, Promise.all([trackSafe(c.env.DB, 'signup'), markLeadSignedUp(c.env.DB, fresh.email)]));
  }
  setCookie(c, COOKIE, session, {
    httpOnly: true, sameSite: 'Lax', path: '/', secure: env.siteUrl.startsWith('https'), maxAge: 60 * 60 * 24 * 30,
  });
  return c.redirect('/?app=1');
});

app.post('/api/ref', async (c) => {
  const b = (await c.req.json().catch(() => ({}))) as { ref?: unknown; code?: unknown };
  const str = (v: unknown) => (typeof v === 'string' ? v.slice(0, 40) : undefined);
  await captureReferral(c, c.env.DB, { ref: str(b.ref), code: str(b.code) }, env.siteUrl.startsWith('https'));
  return c.json({ ok: true });
});

app.get('/api/partner', async (c) => {
  const user = c.get('user');
  if (!user) return unauth(c);
  c.header('Cache-Control', 'no-store');
  return c.json(await partnerState(c.env.DB, user, env.siteUrl));
});

app.post('/api/partner/code', async (c) => {
  const user = c.get('user');
  if (!user) return unauth(c);
  const b = (await c.req.json().catch(() => ({}))) as { code?: unknown };
  const v = validateCode(typeof b.code === 'string' ? b.code : '');
  if ('error' in v) return c.json({ error: v.error }, 400);
  const r = await createInfluencer(c.env.DB, user.id, v.code);
  if (r === 'taken') return c.json({ error: 'That code is taken. Try another.' }, 409);
  if (r === 'exists') return c.json({ error: 'You already have a code.' }, 409);
  return c.json({ ok: true, code: v.code });
});

app.post('/api/partner/payout-request', async (c) => {
  const user = c.get('user');
  if (!user) return unauth(c);
  if (!sameSite(c)) return c.json({ error: 'Not allowed' }, 403);
  const p = z.object({ method: z.enum(['paypal', 'interac']), to: z.string().trim().email().max(200) }).strict()
    .safeParse(await c.req.json().catch(() => null));
  if (!p.success) return c.json({ error: 'Choose PayPal or Interac and enter a valid payout email.' }, 400);
  const to = p.data.to.toLowerCase();
  const r = await requestPayout(c.env.DB, user.id, p.data.method, to);
  if ('error' in r) return c.json({ error: r.error }, 400);
  background(c, sendPayoutRequestEmail({
    to: env.support.email ?? env.adminEmails[0], code: r.code, cents: r.cents, method: PAYOUT_METHODS[p.data.method],
    payTo: to, account: user.email, link: `${env.siteUrl}/api/owner/payouts/${r.id}`,
  }).catch((err) => console.error('Payout request email failed:', err)));
  return c.json({ ok: true, cents: r.cents });
});

const ownerHtml = (title: string, inner: string): string =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(title)} · Kaalera</title></head>`
  + `<body style="font-family:system-ui,sans-serif;max-width:520px;margin:40px auto;padding:0 16px"><h2>${escapeHtml(title)}</h2>${inner}</body></html>`;

/** Owner-only admin: overview and people, blog, prices, festivals. Never shows chat text or birth details. */
const adminUser = async (c: C) => {
  const bearer = /^Bearer\s+(\S+)$/i.exec(c.req.header('Authorization') ?? '')?.[1];
  if (bearer) {
    const owner = (await checkApiToken(c.env.DB, bearer))
      ? await c.env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(env.adminEmails[0]).first<User>() : null;
    c.header('Cache-Control', 'no-store');
    if (!owner) return c.html(ownerHtml('Not allowed', ''), 401);
    ownerTokenReqs.add(c.req.raw);
    return owner;
  }
  const user = await userForSession(c.env.DB, getCookie(c, COOKIE));
  c.header('Cache-Control', 'no-store');
  c.header('X-Robots-Tag', 'noindex');
  if (!user) return c.html(ownerHtml('Sign in first', '<p>Sign in to Kaalera with the owner email, then open this page again.</p><p><a href="/?app=1">Sign in</a></p>'), 401);
  if (!isAdmin(user.email)) return c.html(ownerHtml('Not found', ''), 404);
  return user;
};
const adminFilters = (c: C): Filters => Object.fromEntries(FILTER_KEYS.map((k) => [k, (c.req.query(k) ?? '').trim().slice(0, 100)])) as Filters;
const loadPeople = async (db: D1Database) => (await db.prepare(`SELECT u.name, u.email, u.account_type, u.business_name, u.created_at, u.last_seen_at,
    (SELECT COUNT(*) FROM threads t WHERE t.user_id = u.id AND t.source = 'web') AS web,
    (SELECT COUNT(*) FROM threads t WHERE t.user_id = u.id AND t.source = 'api') AS api,
    (SELECT COALESCE(SUM(amount_cents), 0) FROM payments p WHERE p.user_id = u.id) AS cents,
    (SELECT COALESCE(SUM(delta), 0) FROM chat_credit_ledger l WHERE l.user_id = u.id) AS chats_left,
    (SELECT substr(group_concat(m.body, ' '), 1, 6000) FROM messages m JOIN threads t ON t.id = m.thread_id WHERE t.user_id = u.id AND m.role = 'user') AS asked
  FROM users u ORDER BY COALESCE(u.last_seen_at, u.created_at) DESC LIMIT 5000`).all<Person>()).results;
const back = (c: C, tab: string, ok: string, err = '', extra = '') =>
  c.redirect(`/admin?tab=${tab}${extra}&${new URLSearchParams(err ? { err } : { ok }).toString()}`, 303);

app.get('/admin', async (c) => {
  const user = await adminUser(c);
  if (user instanceof Response) return user;
  const db = c.env.DB;
  const notice = noticeHtml(c.req.query('ok') ?? '', c.req.query('err') ?? '');
  const tab = c.req.query('tab') ?? 'people';
  if (tab === 'blog') {
    const posts = await listPosts(db, false);
    const e = c.req.query('edit');
    const edit = e === 'new' ? 'new' : e ? (await getPost(db, e)) ?? null : null;
    return c.html(blogTab(posts, edit, notice));
  }
  if (tab === 'prices') return c.html(pricesTab({ ...(await getPrices(db)) }, await priceHistory(db), notice));
  if (tab === 'festivals') return c.html(festivalsTab(await listFestivals(db), notice));
  if (tab === 'coupons') return c.html(couponsTab(await listCoupons(db), env.siteUrl, notice));
  if (tab === 'email') return c.html(emailTab({ log: await broadcastLog(db), tokenInfo: await apiTokenInfo(db), notice }));
  if (tab === 'kaal') {
    const load = Number(c.req.query('load'));
    const [fields, history, loaded] = await Promise.all([kaalFields(db), kaalHistory(db), Number.isInteger(load) && load > 0 ? kaalVersion(db, load) : Promise.resolve(null)]);
    return c.html(kaalTab(fields, history, notice, loaded));
  }
  const days = Math.min(365, Math.max(1, Number(c.req.query('days')) || 30));
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const [f, revenue, all, people] = await Promise.all([
    funnel(db, days),
    db.prepare('SELECT substr(created_at, 1, 10) AS day, SUM(amount_cents) AS cents, COUNT(*) AS n FROM payments WHERE created_at >= ? GROUP BY day')
      .bind(since).all<{ day: string; cents: number; n: number }>(),
    db.prepare('SELECT (SELECT COUNT(*) FROM users) AS users, (SELECT COUNT(*) FROM payments) AS payments, (SELECT COALESCE(SUM(amount_cents), 0) FROM payments) AS cents')
      .first<{ users: number; payments: number; cents: number }>(),
    loadPeople(db),
  ]);
  return c.html(adminPage({ days, f: adminFilters(c), totals: f.totals, revenue: revenue.results, all: all ?? { users: 0, payments: 0, cents: 0 }, people }, notice));
});

app.get('/admin/people.csv', async (c) => {
  const user = await adminUser(c);
  if (user instanceof Response) return user;
  const rows = filterRows(toRows(await loadPeople(c.env.DB)), adminFilters(c));
  return c.body(peopleCsv(rows), 200, {
    'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'no-store',
    'Content-Disposition': `attachment; filename="kaalera-people-${new Date().toISOString().slice(0, 10)}.csv"`,
  });
});

const formOf = async (c: C) => Object.fromEntries(Object.entries(await c.req.parseBody()).map(([k, v]) => [k, typeof v === 'string' ? v : '']));
const issues = (e: z.ZodError) => e.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');

const saveBlog = async (c: C, id: string | null) => {
  const user = await adminUser(c);
  if (user instanceof Response) return user;
  if (!sameSite(c)) return c.html(ownerHtml('Not allowed', ''), 403);
  const p = postSchema.safeParse(await formOf(c));
  const again = id ? `&edit=${encodeURIComponent(id)}` : '&edit=new';
  if (!p.success) return back(c, 'blog', '', issues(p.error), again);
  const slug = slugify(p.data.slug || p.data.title);
  if (!slug) return back(c, 'blog', '', 'Add a title or link made of letters or numbers.', again);
  const r = await savePost(c.env.DB, id, { ...p.data, slug, coverUrl: p.data.coverUrl || null });
  if (r.error === 'slug_taken') return back(c, 'blog', '', `Another post already uses the link /blog/${slug}.`, again);
  if (r.error) return back(c, 'blog', '', 'Post not found.');
  return back(c, 'blog', p.data.status === 'published' ? `Published: kaalera.com/blog/${slug}` : 'Draft saved.');
};
app.post('/admin/blog', (c) => saveBlog(c, null));
app.post('/admin/blog/:id', (c) => saveBlog(c, c.req.param('id')));
app.post('/admin/blog/:id/delete', async (c) => {
  const user = await adminUser(c);
  if (user instanceof Response) return user;
  if (!sameSite(c)) return c.html(ownerHtml('Not allowed', ''), 403);
  return (await deletePost(c.env.DB, c.req.param('id'))) ? back(c, 'blog', 'Post deleted.') : back(c, 'blog', '', 'Post not found.');
});

app.post('/admin/prices', async (c) => {
  const user = await adminUser(c);
  if (user instanceof Response) return user;
  if (!sameSite(c)) return c.html(ownerHtml('Not allowed', ''), 403);
  const form = await formOf(c);
  const patch: Record<string, number> = {};
  for (const x of PRICE_FIELDS) {
    const v = form[x.key];
    if (v === undefined || v.trim() === '') continue;
    patch[x.key] = x.money ? Math.round(Number(v) * 100) : Number(v);
  }
  const p = pricesSchema.safeParse(patch);
  if (!p.success) return back(c, 'prices', '', issues(p.error));
  const cur = await getPrices(c.env.DB);
  const changed = Object.fromEntries(Object.entries(p.data).filter(([k, v]) => cur[k as keyof typeof cur] !== v));
  if (!Object.keys(changed).length) return back(c, 'prices', 'Nothing changed.');
  await setPrices(c.env.DB, changed, user.email);
  return back(c, 'prices', 'Prices saved.');
});

app.post('/admin/festivals/:id', async (c) => {
  const user = await adminUser(c);
  if (user instanceof Response) return user;
  if (!sameSite(c)) return c.html(ownerHtml('Not allowed', ''), 403);
  const form = await formOf(c);
  const p = festivalSchema.safeParse({ enabled: form.enabled === '1', percent: Number(form.percent) });
  if (!p.success) return back(c, 'festivals', '', issues(p.error));
  return (await updateFestival(c.env.DB, c.req.param('id'), p.data)) ? back(c, 'festivals', 'Festival saved.') : back(c, 'festivals', '', 'Festival not found.');
});

/** Owner gives free chats (questions) to a person; logged in the credit ledger and settings audit. */
app.post('/admin/people/gift', async (c) => {
  const user = await adminUser(c);
  if (user instanceof Response) return user;
  if (!sameSite(c)) return c.html(ownerHtml('Not allowed', ''), 403);
  const form = await formOf(c);
  const n = Number(form.n);
  if (!Number.isInteger(n) || n < 1 || n > 20) return back(c, 'people', '', 'Give between 1 and 20 chats.');
  const db = c.env.DB;
  const u = await db.prepare('SELECT id, email FROM users WHERE email = ?').bind((form.email ?? '').trim().toLowerCase()).first<{ id: string; email: string }>();
  if (!u) return back(c, 'people', '', 'Person not found.');
  const now = new Date().toISOString();
  await db.batch([
    db.prepare("INSERT INTO chat_credit_ledger (id, user_id, delta, reason, ref, created_at) VALUES (?, ?, ?, 'gift', ?, ?)")
      .bind(crypto.randomUUID(), u.id, n, `gift:${crypto.randomUUID()}`, now),
    db.prepare('INSERT INTO settings_audit (key, old_value, new_value, changed_by, changed_at) VALUES (?, NULL, ?, ?, ?)')
      .bind(`gift_chats:${u.email}`, String(n), user.email, now),
  ]);
  return back(c, 'people', `Gave ${n} free ${n === 1 ? 'chat' : 'chats'} to ${u.email}.`);
});

app.post('/admin/coupons', async (c) => {
  const user = await adminUser(c);
  if (user instanceof Response) return user;
  if (!sameSite(c)) return c.html(ownerHtml('Not allowed', ''), 403);
  const f = await formOf(c);
  const code = normCode(f.code ?? '');
  const kind = f.kind === 'chats' ? 'chats' : 'percent';
  const value = Number(f.value);
  const maxUses = f.max_uses ? Number(f.max_uses) : null;
  const expiresOn = /^\d{4}-\d{2}-\d{2}$/.test(f.expires_on ?? '') ? f.expires_on : null;
  if (!CODE_RE.test(code)) return back(c, 'coupons', '', 'Code: 3–24 letters, numbers, - or _.');
  if (!Number.isInteger(value) || value < 1 || value > (kind === 'chats' ? 20 : 90)) return back(c, 'coupons', '', kind === 'chats' ? 'Free chats: 1 to 20.' : '% off: 1 to 90.');
  if (maxUses !== null && (!Number.isInteger(maxUses) || maxUses < 1)) return back(c, 'coupons', '', 'Max people must be 1 or more.');
  const err = await createCoupon(c.env.DB, { code, kind, value, maxUses, expiresOn, note: (f.note ?? '').trim().slice(0, 200) || null }, user.email);
  return err ? back(c, 'coupons', '', err) : back(c, 'coupons', `Coupon ${code} created.`);
});
app.post('/admin/coupons/:code', async (c) => {
  const user = await adminUser(c);
  if (user instanceof Response) return user;
  if (!sameSite(c)) return c.html(ownerHtml('Not allowed', ''), 403);
  const on = (await formOf(c)).enabled === '1';
  return (await setCouponEnabled(c.env.DB, c.req.param('code'), on)) ? back(c, 'coupons', `Coupon turned ${on ? 'on' : 'off'}.`) : back(c, 'coupons', '', 'Coupon not found.');
});

const redeemPage = (c: C, inner: string, status: 200 | 400 = 200) => c.html(layout(
  { site: env.siteUrl, path: '/redeem', title: 'Redeem a code | Kaalera', description: 'Use a Kaalera coupon code.' },
  `<section class="w-hero"><h1>Redeem a code</h1>${inner}</section>`,
), status, { 'Content-Security-Policy': PUBLIC_CSP, 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' });
const redeemForm = (code: string) => `<form method="post" action="/redeem" style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center;margin-top:18px">
<input name="code" required maxlength="24" value="${escapeHtml(code)}" placeholder="Your code" style="text-transform:uppercase;padding:14px 16px;border-radius:12px;border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.06);color:inherit;font-size:17px;min-width:220px">
<button class="w-cta big" type="submit">Redeem</button></form>`;
app.get('/redeem', async (c) => {
  const code = normCode(c.req.query('code') ?? '').slice(0, 24);
  const user = await userForSession(c.env.DB, getCookie(c, COOKIE));
  if (!user) return redeemPage(c, `<p class="w-lead">Sign in first, then open this page again to use ${code ? `code <b>${escapeHtml(code)}</b>` : 'your code'}.</p><p><a class="w-cta big" href="/?app=1">Sign in</a></p>`);
  return redeemPage(c, `<p class="w-lead">Free chats are added right away. A % code applies to your next purchase.</p>${redeemForm(code)}`);
});
app.post('/redeem', async (c) => {
  if (!sameSite(c)) return redeemPage(c, '<p class="w-lead">Not allowed.</p>', 400);
  const user = await userForSession(c.env.DB, getCookie(c, COOKIE));
  if (!user) return redeemPage(c, '<p class="w-lead">Sign in first.</p><p><a class="w-cta big" href="/?app=1">Sign in</a></p>');
  const code = (await formOf(c)).code ?? '';
  const r = await redeemCoupon(c.env.DB, user, code);
  return r.ok
    ? redeemPage(c, `<p class="w-lead">${escapeHtml(r.message)}</p><p><a class="w-cta big" href="/?app=1">Ask Kaal now</a></p>`)
    : redeemPage(c, `<p class="w-lead">${escapeHtml(r.message)}</p>${redeemForm(normCode(code).slice(0, 24))}`, 400);
});

const AUDIENCE_IDS = Object.keys(AUDIENCES) as [AudienceId, ...AudienceId[]];
const draftSchema = z.object({
  from: z.enum(FROM_IDS).default('kaal'),
  kind: z.enum(['service', 'promo']).default('service'),
  audience: z.enum(AUDIENCE_IDS).default('emails'),
  emails: z.string().max(100_000).default(''),
  subject: z.string().trim().min(1, 'Write a subject.').max(200),
  body: z.string().trim().min(1, 'Write the email body.').max(50_000),
});
const firstIssue = (e: z.ZodError) => e.issues[0]?.message ?? 'Check the form.';
const emailTabHtml = async (c: C, o: Omit<Parameters<typeof emailTab>[0], 'log' | 'tokenInfo'>) =>
  c.html(emailTab({ ...o, log: await broadcastLog(c.env.DB), tokenInfo: await apiTokenInfo(c.env.DB) }));

app.post('/admin/email', async (c) => {
  const user = await adminUser(c);
  if (user instanceof Response) return user;
  if (!sameSite(c)) return c.html(ownerHtml('Not allowed', ''), 403);
  const form = await formOf(c);
  const p = draftSchema.safeParse({ ...form, body: (form.body ?? '').replace(/\r\n?/g, '\n') });
  const raw = { from: 'kaal', kind: 'service', audience: 'emails', emails: '', subject: '', body: '', ...form } as Draft;
  if (!p.success) return emailTabHtml(c, { draft: raw, notice: noticeHtml('', firstIssue(p.error)) });
  const d: Draft = p.data;
  const db = c.env.DB;
  const { to, skipped } = await resolveRecipients(db, d);
  if (form.action === 'test') {
    const err = await sendTest(d, user.email, to[0]?.name || user.name || '');
    return emailTabHtml(c, { draft: d, notice: noticeHtml(err ? '' : `Test sent to ${user.email}.`, err ? `Test failed: ${err}` : '') });
  }
  if (form.action === 'send') {
    if (!to.length) return emailTabHtml(c, { draft: d, notice: noticeHtml('', `Nobody to send to${skipped ? ` (${skipped} skipped: no consent, unsubscribed or not users)` : ''}.`) });
    if (form.confirm !== 'on') return emailTabHtml(c, { draft: d, notice: noticeHtml('', 'Tick \u201cI checked the preview\u201d, then press Send.') });
    const r = await sendBroadcast(db, d, to, user.email, 'admin');
    return r.failed
      ? back(c, 'email', '', `Sent ${r.sent} of ${to.length}. ${r.failed} failed: ${r.error ?? ''}`)
      : back(c, 'email', `Sent to ${r.sent} ${r.sent === 1 ? 'person' : 'people'}${skipped ? ` (${skipped} skipped)` : ''}.`);
  }
  const sample = to[0] ?? { id: null, email: user.email, name: user.name || '' };
  const e = renderEmail(d, { name: sample.name, unsub: d.kind === 'promo' ? `${env.siteUrl}/unsubscribe` : undefined });
  return emailTabHtml(c, { draft: d, preview: { html: e.html, subject: e.subject, count: to.length, skipped, sample: sample.name || sample.email } });
});
app.post('/admin/email/token', async (c) => {
  const user = await adminUser(c);
  if (user instanceof Response) return user;
  if (!sameSite(c)) return c.html(ownerHtml('Not allowed', ''), 403);
  return emailTabHtml(c, { newToken: await rotateApiToken(c.env.DB, user.email) });
});

/** Owner email API: Bearer token from admin Email tab (or the owner's signed-in session). */
app.post('/api/owner/email', async (c) => {
  c.header('Cache-Control', 'no-store');
  const db = c.env.DB;
  const bearer = /^Bearer\s+(\S+)$/i.exec(c.req.header('Authorization') ?? '')?.[1];
  let by: string | null = null;
  if (bearer) by = (await checkApiToken(db, bearer)) ? 'api' : null;
  else {
    const u = await userForSession(db, getCookie(c, COOKIE));
    by = u && isAdmin(u.email) && sameSite(c) ? u.email : null;
  }
  if (!by) return c.json({ error: 'Not authorized' }, 401);
  const json = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  const to = Array.isArray(json?.to) ? (json.to as unknown[]).filter((x) => typeof x === 'string').join('\n') : typeof json?.to === 'string' ? json.to : '';
  const p = draftSchema.safeParse({ ...json, emails: to, audience: json?.audience ?? 'emails' });
  if (!p.success) return c.json({ error: firstIssue(p.error) }, 400);
  const { to: list, skipped } = await resolveRecipients(db, p.data);
  if (json?.dryRun === true) return c.json({ count: list.length, skipped });
  if (!list.length) return c.json({ error: 'Nobody to send to.', skipped }, 400);
  const r = await sendBroadcast(db, p.data, list, by, bearer ? 'api' : 'admin');
  return c.json({ id: r.id, sent: r.sent, failed: r.failed, skipped, ...(r.error ? { error: r.error } : {}) }, r.failed && !r.sent ? 502 : 200);
});

const kaalLabel = (k: string) => KAAL_FIELDS.find((f) => f.key === k)?.label ?? k;
app.post('/admin/kaal/restore/:id', async (c) => {
  const user = await adminUser(c);
  if (user instanceof Response) return user;
  if (!sameSite(c)) return c.html(ownerHtml('Not allowed', ''), 403);
  const v = await kaalVersion(c.env.DB, Number(c.req.param('id')) || 0);
  if (!v || !isKaalKey(v.key)) return back(c, 'kaal', '', 'Version not found.');
  const changed = await setKaalPrompt(c.env.DB, v.key, v.body || null, user.email);
  return back(c, 'kaal', changed ? `${kaalLabel(v.key)}: restored the version from ${v.changed_at.slice(0, 16).replace('T', ' ')} UTC. New consultations use it now.` : 'That version is already live.');
});
app.post('/admin/kaal/:key', async (c) => {
  const user = await adminUser(c);
  if (user instanceof Response) return user;
  if (!sameSite(c)) return c.html(ownerHtml('Not allowed', ''), 403);
  const key = c.req.param('key');
  if (!isKaalKey(key)) return back(c, 'kaal', '', 'Unknown section.');
  const form = await formOf(c);
  if (form.action === 'original') {
    return back(c, 'kaal', (await setKaalPrompt(c.env.DB, key, null, user.email)) ? `${kaalLabel(key)}: original restored.` : 'Already the original.');
  }
  const body = (form.body ?? '').replace(/\r\n?/g, '\n').trim();
  if (body.length < KAAL_MIN_CHARS || body.length > KAAL_MAX_CHARS) return back(c, 'kaal', '', `Keep it between ${KAAL_MIN_CHARS} and ${KAAL_MAX_CHARS} characters.`);
  return back(c, 'kaal', (await setKaalPrompt(c.env.DB, key, body, user.email)) ? `${kaalLabel(key)} saved. New consultations use it now.` : 'Nothing changed.');
});

/** Owner-only page from the payout-request email: shows where to send the money and marks it paid. */
app.get('/api/owner/payouts/:id', async (c) => {
  c.header('Cache-Control', 'no-store');
  const user = c.get('user');
  if (!user) return c.html(ownerHtml('Sign in first', '<p>Sign in to Kaalera with the owner email, then open this link again.</p><p><a href="/?app=1">Sign in</a></p>'), 401);
  if (!isAdmin(user.email)) return c.html(ownerHtml('Not found', ''), 404);
  const p = await getPayout(c.env.DB, c.req.param('id'));
  if (!p) return c.html(ownerHtml('Not found', ''), 404);
  const details = `<p>Code: <b>${escapeHtml(p.code)}</b><br>Amount: <b>$${(p.amount_cents / 100).toFixed(2)}</b><br>`
    + `Send by: ${escapeHtml(PAYOUT_METHODS[p.method as PayoutMethod] ?? p.method ?? '')}<br>Send to: <b>${escapeHtml(p.pay_to ?? '')}</b><br>Requested: ${escapeHtml(p.created_at.slice(0, 10))}</p>`;
  if (p.status === 'paid') return c.html(ownerHtml('Payout paid', `${details}<p>Marked as paid on ${escapeHtml((p.paid_at ?? '').slice(0, 10))}.</p>`));
  return c.html(ownerHtml('Payout request', `${details}<p>Send the money first, then press the button.</p>`
    + '<form method="post"><button type="submit" style="background:#111;color:#fff;border:0;padding:10px 18px;border-radius:8px;font-size:15px">I sent it, mark as paid</button></form>'));
});

app.post('/api/owner/payouts/:id', async (c) => {
  const user = c.get('user');
  if (!user || !isAdmin(user.email) || !sameSite(c)) return c.html(ownerHtml('Not allowed', ''), 403);
  const id = c.req.param('id');
  const p = await getPayout(c.env.DB, id);
  if (!p) return c.html(ownerHtml('Not found', ''), 404);
  if (await markPayoutPaid(c.env.DB, id)) {
    background(c, sendPayoutSentEmail({ to: p.email, code: p.code, cents: p.amount_cents, method: PAYOUT_METHODS[p.method as PayoutMethod] ?? 'PayPal' })
      .catch((err) => console.error('Payout sent email failed:', err)));
  }
  return c.redirect(`/api/owner/payouts/${id}`, 303);
});

app.get('/api/partner/payouts.csv', async (c) => {
  const user = c.get('user');
  if (!user) return unauth(c);
  const csv = await payoutsCsv(c.env.DB, user.id);
  if (csv === null) return c.json({ error: 'Not found' }, 404);
  return c.body(csv, 200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="kaalera-payouts.csv"' });
});

app.put('/api/admin/influencers/:code', async (c) => {
  const user = c.get('user');
  if (!user || !isAdmin(user.email)) return c.json({ error: 'Not found' }, 404);
  const b = (await c.req.json().catch(() => ({}))) as { status?: unknown; percent?: unknown };
  const status = b.status === 'paused' || b.status === 'active' ? b.status : null;
  const percent = typeof b.percent === 'number' && Number.isInteger(b.percent) && b.percent >= 0 && b.percent <= 50 ? b.percent : null;
  const r = await c.env.DB.prepare('UPDATE influencers SET status = COALESCE(?, status), percent = COALESCE(?, percent) WHERE code = ?')
    .bind(status, percent, c.req.param('code').toUpperCase()).run();
  return r.meta?.changes ? c.json({ ok: true }) : c.json({ error: 'Not found' }, 404);
});

app.post('/api/logout', async (c) => {
  await destroySession(c.env.DB, getCookie(c, COOKIE));
  deleteCookie(c, COOKIE, { path: '/' });
  return c.json({ ok: true });
});

const subscriptionPlans = async (db: D1Database) => {
  const prices = await getPrices(db);
  return {
    taxFeePercent: prices.taxFeePercent,
    plans: plansForPrices(prices),
  };
};

app.get('/api/plans', async (c) => c.json({ ...(await pricing(c.env.DB)), ...(await subscriptionPlans(c.env.DB)), languages: LANGUAGES }));

app.get('/api/subscription', async (c) => {
  const user = c.get('user');
  if (!user) return unauth(c);
  const personal = user.account_type !== 'business';
  const [state, phone, catalog] = await Promise.all([
    subscriptionForUser(c.env.DB, user.id),
    c.env.DB.prepare('SELECT phone_e164, phone_verified_at FROM users WHERE id = ?').bind(user.id)
      .first<{ phone_e164: string | null; phone_verified_at: string | null }>(),
    personal ? subscriptionPlans(c.env.DB) : Promise.resolve({ taxFeePercent: 0, plans: [] }),
  ]);
  const plan = state ? planFor(await getPrices(c.env.DB), state.plan) : null;
  return c.json({
    enabled: personal, phoneEnabled: env.phone.enabled, phoneVerified: !!phone?.phone_verified_at,
    phone: phone?.phone_e164 ?? null, phoneSaved: !!phone?.phone_e164,
    trialDays: personal ? (await getPrices(c.env.DB)).trialDays : 0,
    trialConsults: personal ? (await getPrices(c.env.DB)).trialConsults : 0,
    taxFeePercent: catalog.taxFeePercent,
    trialEligible: personal ? await trialEligible(c.env.DB, user.id, await freeKeys(c)) : false,
    plans: catalog.plans,
    subscription: state ? {
      plan: state.plan, planName: plan?.name ?? state.plan, status:
        state.pause_starts_at && state.paused_until
          && Date.parse(state.pause_starts_at) <= Date.now() && Date.parse(state.paused_until) > Date.now()
          ? 'paused' : state.status,
      priceCents: plan?.cents ?? 0,
      consultations: plan?.consultations ?? 0, consultsLeft: state.consults_left,
      trialEnd: state.trial_end, renewsAt: state.current_period_end,
      pauseStartsAt: state.pause_starts_at, pausedUntil: state.paused_until, cancelAtPeriodEnd: !!state.cancel_at_period_end,
      pendingPlan: state.pending_plan,
    } : null,
  });
});

app.post('/api/phone/start', async (c) => {
  const user = c.get('user');
  if (!user) return unauth(c);
  if (!sameSite(c)) return c.json({ error: 'Not allowed' }, 403);
  if (user.account_type === 'business') return c.json({ error: 'Subscriptions are not available for Business accounts.' }, 403);
  if (!env.phone.enabled) return c.json({ enabled: false });
  if (await limited(c, 'RL_AUTH', `phone:${user.id}`)) return tooMany(c);
  const parsed = z.object({ phone: z.string().trim().max(16) }).strict().safeParse(await c.req.json().catch(() => null));
  if (!parsed.success || !validPhone(parsed.data.phone)) return c.json({ error: 'Enter a valid phone number in international format.' }, 400);
  const since = new Date(Date.now() - 60 * 60_000).toISOString();
  const sends = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM phone_otp_sends WHERE user_id = ? AND created_at > ?')
    .bind(user.id, since).first<{ n: number }>();
  if ((sends?.n ?? 0) >= 5) return c.json({ error: 'You have reached the verification limit. Try again later.' }, 429);
  try {
    await startPhoneVerification(parsed.data.phone);
  } catch (err) {
    console.error('Phone verification start failed:', err);
    return c.json({ error: 'Could not send a verification code. Try again later.' }, 503);
  }
  await c.env.DB.prepare('INSERT INTO phone_otp_sends (id, user_id, created_at) VALUES (?, ?, ?)')
    .bind(crypto.randomUUID(), user.id, new Date().toISOString()).run();
  return c.json({ sent: true });
});

app.post('/api/phone/check', async (c) => {
  const user = c.get('user');
  if (!user) return unauth(c);
  if (!sameSite(c)) return c.json({ error: 'Not allowed' }, 403);
  if (user.account_type === 'business') return c.json({ error: 'Subscriptions are not available for Business accounts.' }, 403);
  if (!env.phone.enabled) return c.json({ enabled: false });
  const parsed = z.object({ phone: z.string().trim().max(16), code: z.string().trim().min(4).max(10) }).strict()
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success || !validPhone(parsed.data.phone)) return c.json({ error: 'Enter the phone number and verification code.' }, 400);
  let verified: { status?: string };
  try {
    verified = await checkPhoneVerification(parsed.data.phone, parsed.data.code);
  } catch (err) {
    console.error('Phone verification check failed:', err);
    return c.json({ error: 'Could not verify the code. Try again.' }, 503);
  }
  if (verified.status !== 'approved') return c.json({ error: 'That verification code is not valid.' }, 400);
  const owner = await c.env.DB.prepare('SELECT id FROM users WHERE phone_e164 = ? AND id != ?')
    .bind(parsed.data.phone, user.id).first();
  if (owner) return c.json({ error: 'That phone number is already linked to another account.' }, 409);
  try {
    await c.env.DB.prepare('UPDATE users SET phone_e164 = ?, phone_verified_at = ? WHERE id = ?')
      .bind(parsed.data.phone, new Date().toISOString(), user.id).run();
  } catch {
    return c.json({ error: 'That phone number is already linked to another account.' }, 409);
  }
  return c.json({ verified: true });
});

app.post('/api/subscribe', async (c) => {
  const user = c.get('user');
  if (!user) return unauth(c);
  if (!sameSite(c)) return c.json({ error: 'Not allowed' }, 403);
  if (user.account_type === 'business') return c.json({ error: 'Subscriptions are not available for Business accounts.' }, 403);
  const parsed = z.object({
    plan: z.enum(['basic', 'plus', 'pro']), threadId: z.string().min(1).optional(),
    agreed: z.literal(true), phone: z.string().max(24).optional(),
  })
    .strict().safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'Choose a plan and accept the subscription terms.' }, 400);
  const existing = await subscriptionForUser(c.env.DB, user.id);
  if (existing && ['active', 'trialing'].includes(existing.status)) return c.json({ error: 'You already have an active subscription.' }, 409);
  const phone = await c.env.DB.prepare('SELECT phone_e164, phone_verified_at FROM users WHERE id = ?')
    .bind(user.id).first<{ phone_e164: string | null; phone_verified_at: string | null }>();
  if (env.phone.enabled && !phone?.phone_verified_at) return c.json({ error: 'Verify your phone number before subscribing.' }, 400);
  const prices = await getPrices(c.env.DB);
  const plan = planFor(prices, parsed.data.plan);
  if (!plan) return c.json({ error: 'That plan is unavailable.' }, 400);
  if (!env.phone.enabled && !phone?.phone_e164) {
    const normalized = parsed.data.phone?.replace(/[ \-().]/g, '') ?? '';
    if (!validPhone(normalized)) return c.json({ error: 'Enter your mobile number with country code.' }, 400);
    const owner = await c.env.DB.prepare('SELECT id FROM users WHERE phone_e164 = ? AND id != ?')
      .bind(normalized, user.id).first();
    if (owner) return c.json({ error: 'That mobile number is already linked to another account.' }, 409);
    try {
      await c.env.DB.prepare('UPDATE users SET phone_e164 = ? WHERE id = ?').bind(normalized, user.id).run();
    } catch (err) {
      if (err instanceof Error && /UNIQUE constraint failed: users\.phone_e164/.test(err.message)) {
        return c.json({ error: 'That mobile number is already linked to another account.' }, 409);
      }
      throw err;
    }
  }
  const keys = await freeKeys(c);
  const eligible = await trialEligible(c.env.DB, user.id, keys);
  const trialEnd = new Date(Date.now() + prices.trialDays * 86_400_000).toISOString();
  const url = await createSubscriptionCheckout(c.env.DB, user, {
    plan, eligible, threadId: parsed.data.threadId, taxFeePercent: prices.taxFeePercent,
    trialDays: prices.trialDays, trialEnd, trialKeys: keys,
  }, { ip: c.req.header('cf-connecting-ip') ?? null, userAgent: (c.req.header('user-agent') ?? '').slice(0, 300) || null });
  return c.json({ checkoutUrl: url });
});

const subscriptionOffer = async (db: D1Database, userId: string, offer: 'pause' | 'basic' | 'cancel', reason?: string, note?: string) =>
  db.prepare('INSERT INTO subscription_cancellations (id, user_id, reason, note, offer_taken, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), userId, reason ?? null, note ?? null, offer, new Date().toISOString()).run();

app.post('/api/subscription/manage', async (c) => {
  const user = c.get('user');
  if (!user) return unauth(c);
  if (!sameSite(c)) return c.json({ error: 'Not allowed' }, 403);
  if (user.account_type === 'business') return c.json({ error: 'Subscriptions are not available for Business accounts.' }, 403);
  const parsed = z.object({
    action: z.enum(['pause', 'basic', 'cancel']), reason: z.enum(['expensive', 'not_using', 'not_helpful', 'other']).optional(),
    note: z.string().trim().max(500).optional(),
  }).strict().safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'Choose an account action.' }, 400);
  const state = await subscriptionForUser(c.env.DB, user.id);
  if (!state || !['active', 'trialing', 'past_due'].includes(state.status)) return c.json({ error: 'No active subscription was found.' }, 409);
  if (parsed.data.action === 'pause' && state.status === 'trialing') {
    return c.json({ error: 'Pause is available after your first monthly payment.' }, 409);
  }
  if (state.cancel_at_period_end) return c.json({ error: 'Your subscription is already set to end.' }, 409);
  if (parsed.data.action !== 'cancel' && !['active', 'trialing'].includes(state.status)) {
    return c.json({ error: 'This plan action is not available while payment is past due.' }, 409);
  }
  const now = Math.floor(Date.now() / 1000);
  if (parsed.data.action === 'pause') {
    const pauseStartsAt = state.current_period_end ?? new Date(now * 1000).toISOString();
    const periodEnd = state.current_period_end ? Math.floor(Date.parse(state.current_period_end) / 1000) : now;
    const resumeDate = new Date(Math.max(periodEnd, now) * 1000);
    const day = resumeDate.getUTCDate();
    resumeDate.setUTCDate(1);
    resumeDate.setUTCMonth(resumeDate.getUTCMonth() + 1);
    resumeDate.setUTCDate(Math.min(day, new Date(Date.UTC(resumeDate.getUTCFullYear(), resumeDate.getUTCMonth() + 1, 0)).getUTCDate()));
    const updated = await stripe().subscriptions.update(state.stripe_subscription_id, {
      pause_collection: { behavior: 'void', resumes_at: Math.floor(resumeDate.getTime() / 1000) },
    });
    await syncSubscription(c.env.DB, updated, user.id);
    await c.env.DB.prepare('UPDATE subscriptions SET pause_starts_at = ? WHERE user_id = ?')
      .bind(pauseStartsAt, user.id).run();
    await subscriptionOffer(c.env.DB, user.id, 'pause', parsed.data.reason, parsed.data.note);
    return c.json({ pauseStartsAt, pausedUntil: resumeDate.toISOString() });
  }
  if (parsed.data.action === 'basic') {
    if (state.plan === 'basic') return c.json({ error: 'You are already on Basic.' }, 409);
    const prices = await getPrices(c.env.DB);
    const plan = planFor(prices, 'basic')!;
    const oldProduct = await ensurePlanProduct(c.env.DB, planFor(prices, state.plan)!);
    const basicProduct = await ensurePlanProduct(c.env.DB, plan);
    const subscription = await stripe().subscriptions.retrieve(state.stripe_subscription_id);
    const items = subscription.items.data;
    const planItem = items.find((item) => stripeId(item.price.product) === oldProduct);
    const taxItem = items.find((item) => item.id !== planItem?.id);
    if (!planItem || !taxItem) return c.json({ error: 'Could not update this subscription. Contact support.' }, 502);
    const taxProduct = stripeId(taxItem.price.product);
    if (!taxProduct) return c.json({ error: 'Could not update this subscription. Contact support.' }, 502);
    const updated = await stripe().subscriptions.update(state.stripe_subscription_id, {
      items: [
        { id: planItem.id, price_data: { currency: env.stripe.currency, unit_amount: plan.cents, recurring: { interval: 'month' }, product: basicProduct } },
        { id: taxItem.id, price_data: { currency: env.stripe.currency, unit_amount: taxesAndFees(plan.cents, prices.taxFeePercent), recurring: { interval: 'month' }, product: taxProduct } },
      ],
      proration_behavior: 'none',
    });
    await syncSubscription(c.env.DB, updated, user.id);
    await c.env.DB.prepare('UPDATE subscriptions SET pending_plan = ? WHERE user_id = ?')
      .bind('basic', user.id).run();
    await subscriptionOffer(c.env.DB, user.id, 'basic', parsed.data.reason, parsed.data.note);
    return c.json({ switchedTo: 'basic', renewsAt: state.current_period_end });
  }
  const updated = await stripe().subscriptions.update(state.stripe_subscription_id, { cancel_at_period_end: true });
  await syncSubscription(c.env.DB, updated, user.id);
  await subscriptionOffer(c.env.DB, user.id, 'cancel', parsed.data.reason, parsed.data.note);
  return c.json({ canceledAt: state.current_period_end });
});

app.post('/api/subscription/resume', async (c) => {
  const user = c.get('user');
  if (!user) return unauth(c);
  if (!sameSite(c)) return c.json({ error: 'Not allowed' }, 403);
  if (user.account_type === 'business') return c.json({ error: 'Subscriptions are not available for Business accounts.' }, 403);
  const state = await subscriptionForUser(c.env.DB, user.id);
  if (!state) return c.json({ error: 'No subscription was found.' }, 404);
  const update: Stripe.SubscriptionUpdateParams = {};
  if (state.cancel_at_period_end) update.cancel_at_period_end = false;
  if (state.paused_until && Date.parse(state.paused_until) > Date.now()) update.pause_collection = null;
  const updated = await stripe().subscriptions.update(state.stripe_subscription_id, update);
  await syncSubscription(c.env.DB, updated, user.id);
  return c.json({ ok: true });
});

app.post('/api/subscription/cancel', async (c) => {
  const user = c.get('user');
  if (!user) return unauth(c);
  if (!sameSite(c)) return c.json({ error: 'Not allowed' }, 403);
  if (user.account_type === 'business') return c.json({ error: 'Subscriptions are not available for Business accounts.' }, 403);
  const parsed = z.object({
    reason: z.enum(['expensive', 'not_using', 'not_helpful', 'other']).optional(),
    note: z.string().trim().max(500).optional(),
  }).strict().safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: 'Invalid cancellation details.' }, 400);
  const state = await subscriptionForUser(c.env.DB, user.id);
  if (!state || !['active', 'trialing', 'past_due'].includes(state.status)) return c.json({ error: 'No active subscription was found.' }, 409);
  if (state.cancel_at_period_end) return c.json({ error: 'Your subscription is already set to end.' }, 409);
  const updated = await stripe().subscriptions.update(state.stripe_subscription_id, { cancel_at_period_end: true });
  await syncSubscription(c.env.DB, updated, user.id);
  await subscriptionOffer(c.env.DB, user.id, 'cancel', parsed.data.reason, parsed.data.note);
  return c.json({ canceledAt: state.current_period_end });
});

app.get('/api/sky', async (c) => {
  const now = Date.now();
  c.header('Cache-Control', 'public, max-age=600');
  return c.json({ at: new Date(now).toISOString(), planets: await computeSky(now) });
});

app.get('/api/me', async (c) => {
  const user = c.get('user');
  if (!user) return unauth(c);
  return c.json({
    user: { name: user.name, email: user.email, accountType: user.account_type ?? 'personal', businessName: user.business_name ?? null }, freeAvailable: !user.free_used && user.account_type !== 'business',
    chatCredits: await creditLots(c.env.DB, 'chat', user.id),
    walletCents: user.account_type === 'business' ? await apiBalance(c.env.DB, user.id) : null,
    pricing: await pricing(c.env.DB, user.id), languages: LANGUAGES, maxChars: env.chat.maxMessageChars,
    billing: publicBilling(await getBilling(c.env.DB, user.id)),
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
  if (!(await chartText({ ...data, language: 'English' }))) return c.json({ error: 'Could not calculate this Kundli. Check the date, time and birthplace.' }, 400);
  if (!id) background(c, trackSafe(c.env.DB, 'kundli_added'));
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
  const body = z.object({
    kundliId: z.string().min(1), question: questionText(), language, agreed: z.boolean().optional(), overage: z.boolean().optional(),
  })
    .safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: 'Choose or add a Kundli and write your question.' }, 400);
  const db = c.env.DB;
  const pr = await chatPrices(db, user.id);
  const k = await getKundli(db, user.id, body.data.kundliId);
  if (!k) return c.json({ error: 'Choose or add a Kundli first.' }, 400);
  const p = { data: { ...kundliInput(k), language: body.data.language, question: body.data.question } };
  if ((await listThreads(db, user.id)).length >= MAX_THREADS) return c.json({ error: `You can keep up to ${MAX_THREADS} consultations.` }, 400);
  const chart = await chartText(p.data);
  if (!chart) return c.json({ error: 'Could not calculate this Kundli. Check the date, time and birthplace.' }, 400);

  const t = newThread(user.id, p.data, chart, p.data.question, {});
  await createThreadWithQuestion(db, t, p.data.question);
  t.kundli_id = k.id;
  await db.prepare('UPDATE threads SET kundli_id = ? WHERE id = ?').bind(k.id, t.id).run();
  let covered = false;
  if (user.account_type !== 'business') {
    if (await spendCredit(db, 'chat', user.id, `first:${t.id}`, { threadId: t.id })) {
      t.questions_allowed = 1;
      covered = true;
    } else {
      const sub = await subscriptionForUser(db, user.id);
      if (sub && ['trialing', 'active'].includes(sub.status)) {
        if (await spendSubscriptionConsultation(db, user.id, t.id)) {
          t.questions_allowed = pr.chatPackQuestions;
          covered = true;
        } else if (!body.data.overage) {
          const fresh = (await getThreadById(db, t.id))!;
          const now = Date.now();
          const paused = !!(sub.pause_starts_at && sub.paused_until
            && Date.parse(sub.pause_starts_at) <= now && Date.parse(sub.paused_until) > now);
          return c.json({
            thread: await pubT(c, fresh), code: paused ? 'plan_paused' : 'plan_used_up',
            ...(paused ? { pauseStartsAt: sub.pause_starts_at, pausedUntil: sub.paused_until } : {}),
          });
        }
      } else if (!body.data.overage) {
        const keys = await freeKeys(c);
        const prices = await getPrices(db);
        const catalog = await subscriptionPlans(db);
        const eligible = await trialEligible(db, user.id, keys);
        return c.json({
          thread: await pubT(c, t), plansRequired: true, plans: catalog.plans,
          trialEligible: eligible, trialDays: prices.trialDays, trialConsults: prices.trialConsults,
        });
      }
    }
  } else if (await spendCredit(db, 'chat', user.id, `first:${t.id}`, { threadId: t.id })) {
    await db.prepare('UPDATE threads SET questions_allowed = 1 WHERE id = ?').bind(t.id).run();
    t.questions_allowed = 1;
    covered = true;
  }
  if (!covered && !(await walletPay(db, user, t, 'consultation'))) {
    const url = await createCheckout(c, user, {
      kind: 'consultation', threadId: t.id, credits: pr.chatPackQuestions, cents: pr.chatPackCents,
      name: `Kaalera consultation for ${t.full_name}`, returnPath: `/?t=${t.id}`,
    });
    return c.json({ thread: await pubT(c, t), checkoutUrl: url });
  }
  if (t.questions_allowed > 0) {
    await db.prepare('UPDATE threads SET questions_allowed = ? WHERE id = ?').bind(t.questions_allowed, t.id).run();
  }
  try {
    return c.json({ thread: await pubT(c, await startThreadSession(db, t)) });
  } catch (err) {
    console.error('Session creation failed:', err);
    return c.json({ thread: await pubT(c, (await getThreadById(db, t.id))!), error: 'Kaal is unavailable right now. Tap retry in a minute.' }, 503);
  }
});

/** Business accounts pay chat from their wallet (taxes & fees were paid at top-up). */
async function walletPay(db: D1Database, user: User, t: Thread, kind: 'consultation' | 'topup'): Promise<boolean> {
  if (user.account_type !== 'business') return false;
  const pr = await chatPrices(db, user.id);
  const cents = kind === 'topup' ? pr.extraQuestionCents * CHAT_RELOAD_QUESTIONS : pr.chatPackCents;
  if ((await apiBalance(db, user.id)) < cents) await autoRechargeApi(db, user.id, cents).catch(() => false);
  const ref = `chat:${kind}:${t.id}:${kind === 'topup' ? crypto.randomUUID() : 'first'}`;
  if (!(await spendApiCredit(db, user.id, ref, null, t.id, cents))) return false;
  await grantCredits(db, 'chat', user.id, kind === 'topup' ? CHAT_RELOAD_QUESTIONS : pr.chatPackQuestions, `wallet:${ref}`);
  if (kind === 'consultation' && t.questions_allowed < 1 && (await spendCredit(db, 'chat', user.id, `first:${t.id}`, { threadId: t.id }))) {
    await db.prepare('UPDATE threads SET questions_allowed = 1 WHERE id = ?').bind(t.id).run();
    t.questions_allowed = 1;
  }
  return true;
}

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
  if (await walletPay(c.env.DB, user, t, kind === 'topup' ? 'topup' : 'consultation')) {
    const fresh = (await getThreadById(c.env.DB, t.id))!;
    if (kind === 'consultation' && !fresh.devin_session_id) await startThreadSession(c.env.DB, fresh).catch((err) => console.error('Session start failed:', err));
    return c.json({ paid: true, thread: await pubT(c, (await getThreadById(c.env.DB, t.id))!) });
  }
  const pr = await chatPrices(c.env.DB, user.id);
  const url = await createCheckout(c, user, {
    kind, threadId: t.id,
    credits: kind === 'topup' ? CHAT_RELOAD_QUESTIONS : pr.chatPackQuestions,
    cents: kind === 'topup' ? pr.extraQuestionCents * CHAT_RELOAD_QUESTIONS : pr.chatPackCents,
    name: kind === 'topup' ? `Kaalera — ${CHAT_RELOAD_QUESTIONS} more questions for ${t.full_name}` : `Kaalera consultation for ${t.full_name}`,
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

app.get('/api/threads/:id/reminders', async (c) => {
  const t = await ownThread(c);
  if (!t) return c.json({ error: 'Not found' }, 404);
  return c.json({ reminders: await listReminders(c.env.DB, t.id) });
});

app.post('/api/threads/:id/reminders', async (c) => {
  const t = await ownThread(c);
  if (!t) return c.json({ error: 'Not found' }, 404);
  const p = z.object({ area: z.string().trim().min(1).max(80), when: z.string().trim().min(4).max(60) }).safeParse(await c.req.json().catch(() => null));
  if (!p.success) return c.json({ error: 'Bad reminder.' }, 400);
  const r = await addReminder(c.env.DB, t.user_id, t.id, p.data.area, p.data.when);
  if (!('error' in r)) background(c, trackSafe(c.env.DB, 'reminder_set'));
  return 'error' in r ? c.json(r, 409) : c.json(r);
});

app.get('/api/threads/:id/card', async (c) => {
  const t = await ownThread(c);
  if (!t) return c.json({ error: 'Not found' }, 404);
  const k = t.kundli_id ? await getKundli(c.env.DB, t.user_id, t.kundli_id) : null;
  const input = k ? kundliInput(k) : { dateOfBirth: t.date_of_birth, timeOfBirth: t.time_of_birth, placeOfBirth: t.place_of_birth, timezone: t.timezone };
  try {
    const ch = await computeChart(input);
    const moon = ch.planets.find((p) => p.name === 'Moon');
    const cur = ch.dasha.current;
    c.header('Cache-Control', 'private, max-age=86400');
    return c.json({
      ascendant: { sign: ch.lagna.sign, degree: Math.floor(ch.lagna.degreeInSign) },
      moonSign: ch.moonSign,
      sunSign: ch.sunSign,
      birthStar: moon ? { name: moon.nakshatra, pada: moon.pada } : null,
      period: cur ? { maha: cur.maha.lord, mahaEnd: cur.maha.end, sub: cur.antardasha?.lord ?? null, subEnd: cur.antardasha?.end ?? null } : null,
    });
  } catch (err) {
    console.error('Kundli card failed:', err);
    return c.json({ error: 'Unavailable' }, 503);
  }
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
  const p = z.object({ text: questionText(), language: z.enum(LANGUAGES).optional(), kundliId: z.string().optional(), quick: z.boolean().optional() })
    .safeParse(await c.req.json().catch(() => null));
  if (!p.success) return c.json({ error: `Please write a question (up to ${env.chat.maxMessageChars} characters).` }, 400);
  let context: string | undefined;
  if (p.data.kundliId && p.data.kundliId !== t.kundli_id) {
    const k = await getKundli(c.env.DB, t.user_id, p.data.kundliId);
    if (!k) return c.json({ error: 'That Kundli was not found.' }, 400);
    context = (await chartContext(k, t.full_name)) ?? undefined;
    if (!context) return c.json({ error: 'Could not calculate that Kundli. Check its birth details.' }, 400);
  }
  const quickWords = p.data.quick ? (await getPrices(c.env.DB)).quickWords : 0;
  let r = await sendCustomerMessage(c.env.DB, t, p.data.text, p.data.language, context, quickWords);
  let autoCharged = false;
  const me = c.get('user');
  if (r.error === 'no_questions' && t.source === 'web'
    && ((me && (await walletPay(c.env.DB, me, t, 'topup'))) || (await autoChargeQuestion(c.env.DB, t, t.questions_used)))) {
    autoCharged = true;
    r = await sendCustomerMessage(c.env.DB, (await getThreadById(c.env.DB, t.id))!, p.data.text, p.data.language, context, quickWords);
  }
  if (r.error) {
    const [status, error] = SEND_ERRORS[r.error];
    if (autoCharged) return c.json({ error: 'Your question could not be delivered. The payment is kept as a question credit and will be used for your next message.' }, status);
    return c.json({ error }, status);
  }
  return c.json({ message: publicMessage(r.message!), autoCharged, thread: await pubT(c, (await getThreadById(c.env.DB, t.id))!) });
});

async function subscriptionPaymentMethod(db: D1Database, userId: string, subscription: Stripe.Subscription): Promise<string | null> {
  const method = subscription.default_payment_method;
  const pm = method && typeof method === 'object'
    ? method : method ? await stripe().paymentMethods.retrieve(method) : null;
  if (!pm) return null;
  const customerId = stripeId(subscription.customer);
  await db.prepare(
    'UPDATE users SET stripe_pm_id = ?, card_last4 = ?, stripe_customer_id = COALESCE(stripe_customer_id, ?) WHERE id = ?',
  ).bind(pm.id, pm.card?.last4 ?? null, customerId, userId).run();
  return pm.card?.fingerprint ?? null;
}

async function claimTrialForSubscription(
  db: D1Database, subscription: Stripe.Subscription, fingerprint: string | null,
): Promise<Stripe.Subscription> {
  if (subscription.status !== 'trialing') return subscription;
  const userId = subscription.metadata?.userId;
  if (!userId) return subscription;
  const reservation = await db.prepare(
    'INSERT INTO subscription_trial_claims (stripe_subscription_id, user_id, created_at) VALUES (?, ?, ?) ON CONFLICT(stripe_subscription_id) DO NOTHING',
  ).bind(subscription.id, userId, new Date().toISOString()).run();
  if (!(reservation.meta?.changes ?? 0)) return subscription;
  const metadata = subscription.metadata ?? {};
  const keys = {
    devices: (metadata.trialDeviceKeys ?? '').split(',').filter(Boolean),
    ip: metadata.trialIpKey || null,
  };
  const phone = await db.prepare('SELECT phone_e164 FROM users WHERE id = ?')
    .bind(userId).first<{ phone_e164: string | null }>();
  const priorPhone = phone?.phone_e164
    ? await db.prepare("SELECT user_id FROM trial_marks WHERE kind = 'phone' AND value = ?").bind(phone.phone_e164).first<{ user_id: string }>()
    : null;
  const priorCard = fingerprint
    ? await db.prepare("SELECT user_id FROM trial_marks WHERE kind = 'card' AND value = ?").bind(fingerprint).first<{ user_id: string }>()
    : null;
  let repeated = await freeBlocked(db, keys) || !!(priorPhone && priorPhone.user_id !== userId)
    || !!(priorCard && priorCard.user_id !== userId);
  if (!repeated && fingerprint && !(await markTrialIdentity(db, 'card', fingerprint, userId))) repeated = true;
  if (!repeated && phone?.phone_e164 && !(await markTrialIdentity(db, 'phone', phone.phone_e164, userId))) repeated = true;
  if (repeated) {
    try {
      const ended = await stripe().subscriptions.update(subscription.id, { trial_end: 'now' });
      await syncSubscription(db, ended, userId);
      await db.prepare('UPDATE subscriptions SET consults_left = 0 WHERE stripe_subscription_id = ?').bind(subscription.id).run();
      return ended;
    } catch (err) {
      await db.prepare('DELETE FROM subscription_trial_claims WHERE stripe_subscription_id = ?').bind(subscription.id).run();
      throw err;
    }
  }
  await recordFreeClaims(db, userId, keys);
  return subscription;
}

async function startSubscriptionThread(db: D1Database, userId: string, threadId: string | null): Promise<void> {
  if (!threadId) return;
  const consumed = await spendSubscriptionConsultation(db, userId, threadId);
  const prior = consumed || await db.prepare('SELECT 1 FROM subscription_usages WHERE thread_id = ? AND user_id = ?')
    .bind(threadId, userId).first();
  if (!prior) return;
  const t = await getThreadById(db, threadId);
  if (!t || t.user_id !== userId || t.status !== 'awaiting_payment') return;
  const p = await chatPrices(db, userId);
  await db.prepare('UPDATE threads SET questions_allowed = ? WHERE id = ? AND status = ?')
    .bind(p.chatPackQuestions, threadId, 'awaiting_payment').run();
  await startThreadSession(db, (await getThreadById(db, threadId))!);
}

async function completeSubscriptionCheckout(db: D1Database, session: Stripe.Checkout.Session): Promise<{ kind: string; threadId: string | null } | null> {
  if (session.mode !== 'subscription' || session.metadata?.kind !== 'subscription' || !session.metadata.userId) return null;
  const id = stripeId(session.subscription);
  if (!id) return null;
  const subscription = await stripe().subscriptions.retrieve(id, { expand: ['default_payment_method', 'latest_invoice'] });
  const userId = await syncSubscription(db, subscription, session.metadata.userId);
  if (!userId) return null;
  const fingerprint = await subscriptionPaymentMethod(db, userId, subscription);
  const current = await claimTrialForSubscription(db, subscription, fingerprint);
  const latestInvoice = current.latest_invoice;
  if (latestInvoice && typeof latestInvoice === 'object' && latestInvoice.status === 'paid')
    await applySubscriptionInvoice(db, latestInvoice);
  await startSubscriptionThread(db, userId, session.metadata.threadId || null);
  return { kind: 'subscription', threadId: session.metadata.threadId || null };
}

async function applySubscriptionInvoice(db: D1Database, invoice: Stripe.Invoice): Promise<void> {
  const id = subscriptionIdFromInvoice(invoice);
  if (!id) return;
  const subscription = await stripe().subscriptions.retrieve(id);
  const userId = await syncSubscription(db, subscription);
  if (!userId) return;
  const current = await subscriptionForUser(db, userId);
  if (!current || current.stripe_subscription_id !== id) return;
  const marker = await db.prepare(
    'INSERT INTO subscription_invoices (stripe_invoice_id, user_id, created_at) VALUES (?, ?, ?) ON CONFLICT(stripe_invoice_id) DO NOTHING',
  ).bind(invoice.id, userId, new Date().toISOString()).run();
  if (!(marker.meta?.changes ?? 0)) return;
  const prices = await getPrices(db);
  const appliesPendingPlan = invoice.amount_paid > 0 && invoice.billing_reason === 'subscription_cycle' && !!current.pending_plan;
  const planId = appliesPendingPlan ? current.pending_plan! : current.plan;
  const plan = planFor(prices, planId);
  if (!plan) return;
  let allowance: number | null = null;
  if (invoice.amount_paid === 0 && invoice.billing_reason === 'subscription_create') allowance = prices.trialConsults;
  else if (invoice.amount_paid > 0) allowance = plan.consultations;
  await db.prepare(
    `UPDATE subscriptions SET plan = CASE WHEN ? THEN ? ELSE plan END,
      pending_plan = CASE WHEN ? THEN NULL ELSE pending_plan END,
      consults_left = COALESCE(?, consults_left), last_invoice_id = ?, updated_at = ?
     WHERE stripe_subscription_id = ?`,
  ).bind(appliesPendingPlan ? 1 : 0, planId, appliesPendingPlan ? 1 : 0, allowance,
    invoice.id, new Date().toISOString(), id).run();
  if (appliesPendingPlan) {
    await stripe().subscriptions.update(id, { metadata: { plan: planId, pendingPlan: '' } });
  }
  if (invoice.amount_paid > 0) {
    await db.prepare(
      `INSERT INTO payments (stripe_session_id, user_id, thread_id, kind, amount_cents, currency, created_at, auto)
       VALUES (?, ?, NULL, 'subscription', ?, ?, ?, 0) ON CONFLICT(stripe_session_id) DO NOTHING`,
    ).bind(invoice.id, userId, invoice.amount_paid, invoice.currency, new Date().toISOString()).run();
    await sendReceipt(db, userId, {
      item: `Kaalera ${plan.name} monthly subscription`, totalCents: invoice.amount_paid,
      baseCents: plan.cents, auto: false, ref: invoice.id,
    });
    await trackPayment(db, userId);
  }
  await startSubscriptionThread(db, userId, subscription.metadata?.threadId || null);
}

app.get('/api/checkout/confirm', async (c) => {
  const user = c.get('user');
  if (!user) return unauth(c);
  const id = c.req.query('session_id') ?? '';
  if (!id.startsWith('cs_')) return c.json({ error: 'Bad session' }, 400);
  const s = await stripe().checkout.sessions.retrieve(id);
  if (s.metadata?.userId !== user.id) return c.json({ error: 'Not found' }, 404);
  const sub = await completeSubscriptionCheckout(c.env.DB, s);
  const r = sub ?? await fulfill(c.env.DB, s);
  if (sub) return c.json({ paid: true, kind: sub.kind, threadId: sub.threadId });
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
  try {
    if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.mode === 'subscription') await completeSubscriptionCheckout(c.env.DB, session);
      else await fulfill(c.env.DB, session);
    } else if (event.type === 'invoice.paid') {
      await applySubscriptionInvoice(c.env.DB, event.data.object as Stripe.Invoice);
    } else if (event.type === 'invoice.payment_failed') {
      const invoice = event.data.object as Stripe.Invoice;
      const id = subscriptionIdFromInvoice(invoice);
      if (id) {
        const subscription = await stripe().subscriptions.retrieve(id);
        const userId = await syncSubscription(c.env.DB, subscription);
        if (userId) await c.env.DB.prepare("UPDATE subscriptions SET status = 'past_due', consults_left = 0, updated_at = ? WHERE stripe_subscription_id = ?")
          .bind(new Date().toISOString(), id).run();
      }
    } else if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
      const subscription = event.data.object as Stripe.Subscription;
      const userId = await syncSubscription(c.env.DB, subscription);
      if (userId && event.type === 'customer.subscription.deleted')
        await c.env.DB.prepare("UPDATE subscriptions SET status = 'canceled', consults_left = 0, updated_at = ? WHERE stripe_subscription_id = ?")
          .bind(new Date().toISOString(), subscription.id).run();
    } else if (event.type === 'customer.subscription.trial_will_end') {
      const subscription = event.data.object as Stripe.Subscription;
      const userId = await syncSubscription(c.env.DB, subscription);
      const emailSent = await c.env.DB.prepare('SELECT 1 FROM subscription_trial_emails WHERE stripe_subscription_id = ?')
        .bind(subscription.id).first();
      if (userId && !emailSent) {
        const state = await subscriptionForUser(c.env.DB, userId);
        const prices = await getPrices(c.env.DB);
        const plan = state ? planFor(prices, state.plan) : null;
        const account = await c.env.DB.prepare('SELECT email FROM users WHERE id = ?').bind(userId).first<{ email: string }>();
        if (plan && account) {
          await sendSubscriptionTrialEndingEmail({
            to: account.email, plan: plan.name, monthlyCents: plan.cents, taxFeePercent: prices.taxFeePercent,
            trialEnd: state?.trial_end ?? new Date((subscription.trial_end ?? 0) * 1000).toISOString(),
            manageUrl: `${env.siteUrl}/?app=1&account=1`,
          });
          await c.env.DB.prepare('INSERT INTO subscription_trial_emails (stripe_subscription_id, user_id, created_at) VALUES (?, ?, ?)')
            .bind(subscription.id, userId, new Date().toISOString()).run();
        }
      }
    }
  } catch (err) {
    console.error('Stripe subscription webhook failed:', event.type, err);
    return c.text('Webhook processing failed', 500);
  }
  return c.json({ received: true });
});

/* ---------- developer dashboard (cookie auth) ---------- */

const BUSINESS_REQUIRED = { error: 'business_required', message: 'API keys are for Business accounts. Switch to Business with a $100 wallet payment.' };

app.post('/api/account/business', async (c) => {
  const user = c.get('user');
  if (!user) return unauth(c);
  if (!sameSite(c)) return c.json({ error: 'Not allowed' }, 403);
  const p = z.object({ businessName: z.string().trim().min(2).max(120), taxId: z.string().trim().min(3).max(40) }).strict()
    .safeParse(await c.req.json().catch(() => null));
  if (!p.success) return c.json({ error: 'Enter your business name and business or tax number.' }, 400);
  await c.env.DB.prepare('UPDATE users SET business_name = ?, tax_id = ? WHERE id = ?').bind(p.data.businessName, p.data.taxId, user.id).run();
  return c.json({ ok: true });
});

app.get('/api/developer', async (c) => {
  const user = c.get('user');
  if (!user) return unauth(c);
  const db = c.env.DB;
  const pr = await getPrices(db);
  const [keys, balance, ledger] = await Promise.all([listApiKeys(db, user.id), apiBalance(db, user.id), listApiLedger(db, user.id)]);
  return c.json({ keys, balance, ledger, packs: apiPacks(pr), creditCents: pr.apiCreditCents, taxFeePercent: pr.taxFeePercent, apiPrice: apiPrice(pr), apiDiscountPercent: API_DISCOUNT_PERCENT,
    business: user.account_type === 'business', businessName: user.business_name ?? null,
    activated: await apiActivated(db, user.id, pr), minRechargeCents: pr.apiMinRechargeCents, creditLots: await creditLots(db, 'api', user.id),
    billing: publicBilling(await getBilling(db, user.id)) });
});

app.post('/api/developer/keys', async (c) => {
  const user = c.get('user');
  if (!user) return unauth(c);
  const p = z.object({ name: z.string().trim().min(1).max(60) }).safeParse(await c.req.json().catch(() => null));
  if (!p.success) return c.json({ error: 'Give the key a name.' }, 400);
  if (user.account_type !== 'business' || !(await apiActivated(c.env.DB, user.id, await getPrices(c.env.DB)))) return c.json(BUSINESS_REQUIRED, 403);
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
  const body = (await c.req.json().catch(() => ({}))) as { packId?: string; agreed?: boolean; returnTo?: string };
  const pr = await getPrices(c.env.DB);
  const pack = apiPacks(pr).find((p) => p.id === body.packId);
  if (!pack) return c.json({ error: 'Unknown pack' }, 400);
  if (pack.cents < pr.apiMinRechargeCents && !(await apiActivated(c.env.DB, user.id, pr))) {
    return c.json({ error: 'below_minimum', message: `Your first API recharge must be at least ${usdCents(pr.apiMinRechargeCents)}.` }, 400);
  }
  if (!user.business_name) return c.json(BUSINESS_REQUIRED, 403);
  if (!agreedIn(body)) return c.json(CONSENT_REQUIRED, 400);
  const url = await createCheckout(c, user, {
    kind: 'api_credits', credits: pack.credits, cents: pack.cents,
    name: `Kaalera Business wallet — ${usdCents(pack.cents)}`, returnPath: body.returnTo === 'app' ? '/' : '/developers',
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
  const pr = await getPrices(c.env.DB);
  if (!(await apiActivated(c.env.DB, c.get('api').userId, pr))) {
    return c.json({
      error: 'activation_required',
      message: `Recharge at least ${usdCents(pr.apiMinRechargeCents)} of API credits to activate your API keys.`,
    }, 402);
  }
  await next();
});

const apiConsultation = (t: Thread, messages?: Awaited<ReturnType<typeof listMessages>>) => ({
  id: t.id, name: t.full_name, language: t.language,
  status: isExpired(t) ? 'closed' : t.status === 'failed' ? 'failed' : messages && pendingCount(messages) > 0 ? 'answering' : t.status === 'active' ? 'ready' : 'starting',
  created_at: t.created_at, expires_at: t.expires_at ? new Date(t.expires_at).toISOString() : null,
  ...(messages ? { messages: messages.map((m) => ({ id: m.id, role: m.role === 'pandit' ? 'kaal' : 'user', content: m.body, created_at: m.created_at })) } : {}),
});

app.get('/v1/balance', async (c) => {
  const cents = await apiBalance(c.env.DB, c.get('api').userId);
  return c.json({ balance_cents: cents, balance_usd: (cents / 100).toFixed(2), currency: 'usd' });
});

app.post('/v1/consultations', async (c) => {
  const { userId, keyId } = c.get('api');
  const parsed = birthSchema.extend({ question: questionText() }).safeParse(await c.req.json().catch(() => null));
  const named_ = parsed.success ? named(parsed.data) : null;
  const p = named_ ? { success: true as const, data: named_ } : { success: false as const };
  if (!p.success) return apiError(c, 400, 'invalid_request', parsed.success ? 'fullName is required unless newborn is true.' : parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  const db = c.env.DB;
  const chart = await chartText(p.data);
  if (!chart) return apiError(c, 400, 'chart_failed', 'Could not calculate the Kundli. Check date, time, place and timezone.');
  const t = newThread(userId, p.data, chart, p.data.question, { source: 'api', api_key_id: keyId });
  const price = apiPrice(await getPrices(db));
  if ((await apiBalance(db, userId)) < price.startCents) await autoRechargeApi(db, userId, price.startCents);
  const ref = `consultation:${t.id}`;
  if (!(await spendApiCredit(db, userId, ref, keyId, t.id, price.startCents))) {
    return apiError(c, 402, 'insufficient_credits', `Starting a consultation costs ${usdCents(price.startCents)}. Recharge your wallet at /developers.`);
  }
  await createThreadWithQuestion(db, t, p.data.question);
  try {
    const started = await startThreadSession(db, t);
    return c.json({ consultation: apiConsultation(started, await listMessages(db, started.id)), balance_cents: await apiBalance(db, userId) }, 201);
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
  no_questions: [402, 'insufficient_credits', 'Not enough balance in your API wallet. Recharge at /developers.'],
  expired: [409, 'consultation_closed', 'Consultations close 7 days after they start. Create a new one.'],
  too_many_pending: [429, 'answer_pending', 'Wait for the current answer before asking again.'],
  thread_unavailable: [409, 'consultation_not_ready', 'The consultation is not ready yet.'],
  delivery_failed: [503, 'unavailable', 'Could not deliver the question. You were not charged.'],
};

app.post('/v1/consultations/:id/questions', async (c) => {
  const t = await ownApiThread(c);
  if (!t) return apiError(c, 404, 'not_found', 'Consultation not found.');
  const p = z.object({ question: questionText(), language: z.enum(LANGUAGES).optional(), quick: z.boolean().optional() }).safeParse(await c.req.json().catch(() => null));
  if (!p.success) return apiError(c, 400, 'invalid_request', `question is required (2–${env.chat.maxMessageChars} characters).`);
  const prices = await getPrices(c.env.DB);
  const qCents = p.data.quick ? apiPrice(prices).quickCents : apiPrice(prices).questionCents;
  if ((await apiBalance(c.env.DB, t.user_id)) < qCents) await autoRechargeApi(c.env.DB, t.user_id, qCents);
  const r = await sendCustomerMessage(c.env.DB, t, p.data.question, p.data.language, undefined, p.data.quick ? prices.quickWords : 0);
  if (!r.error) background(c, autoRechargeApi(c.env.DB, t.user_id));
  if (r.error) {
    const [status, code, message] = API_SEND_ERRORS[r.error];
    return apiError(c, status, code, message);
  }
  return c.json({ question_id: r.message!.id, status: 'answering', balance_cents: await apiBalance(c.env.DB, t.user_id) }, 202);
});

app.put('/api/billing', async (c) => {
  const user = c.get('user');
  if (!user) return unauth(c);
  const p = z.object({
    chatAutoCharge: z.boolean().optional(), apiAutoRecharge: z.boolean().optional(), ack: z.enum(['chat', 'api']).optional(),
    apiAutoRechargeCents: z.number().int().min(1000).max(100_000).optional(), apiAutoRechargeCapCents: z.number().int().min(0).max(1_000_000).optional(),
  }).safeParse(await c.req.json().catch(() => null));
  if (!p.success) return c.json({ error: 'Invalid settings.' }, 400);
  const d = p.data;
  const now = new Date().toISOString();
  await c.env.DB.prepare(`UPDATE users SET
      chat_autocharge = COALESCE(?, chat_autocharge), api_autorecharge = COALESCE(?, api_autorecharge),
      api_autorecharge_cents = COALESCE(?, api_autorecharge_cents), api_autorecharge_cap_cents = COALESCE(?, api_autorecharge_cap_cents),
      chat_autocharge_ack_at = CASE WHEN ? = 'chat' THEN ? ELSE chat_autocharge_ack_at END,
      api_autorecharge_ack_at = CASE WHEN ? = 'api' THEN ? ELSE api_autorecharge_ack_at END
    WHERE id = ?`).bind(
    d.chatAutoCharge === undefined ? null : Number(d.chatAutoCharge), d.apiAutoRecharge === undefined ? null : Number(d.apiAutoRecharge),
    d.apiAutoRechargeCents ?? null, d.apiAutoRechargeCapCents ?? null, d.ack ?? null, now, d.ack ?? null, now, user.id).run();
  return c.json({ billing: publicBilling(await getBilling(c.env.DB, user.id)) });
});

app.post('/api/contact', async (c) => {
  const back = (q: string) => c.redirect(`/contact?${q}`, 303);
  const f = await c.req.parseBody().catch(() => ({} as Record<string, unknown>));
  const str = (k: string) => (typeof f[k] === 'string' ? (f[k] as string).trim() : '');
  if (str('website')) return back('sent=1');
  const p = z.object({
    name: z.string().min(1).max(100), email: z.string().email().max(200), topic: z.enum(CONTACT_TOPICS), message: z.string().min(10).max(4000),
  }).safeParse({ name: str('name'), email: str('email').toLowerCase(), topic: str('topic') || 'General', message: str('message') });
  if (!p.success || isDisposable(p.data.email)) return back('error=1');
  const db = c.env.DB;
  const since = new Date(Date.now() - 3_600_000).toISOString();
  const n = await db.prepare('SELECT COUNT(*) AS n FROM contact_messages WHERE ip = ? AND created_at >= ?').bind(ip(c), since).first<{ n: number }>();
  if ((n?.n ?? 0) >= 3) return back('error=1');
  await db.prepare('INSERT INTO contact_messages (id, ip, email, topic, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), ip(c), p.data.email, p.data.topic, new Date().toISOString()).run();
  try {
    await sendContactEmails({ owner: env.support.email ?? env.adminEmails[0], ...p.data });
  } catch (err) {
    console.error('Contact email failed:', err);
    return back('error=1');
  }
  return back('sent=1');
});

app.route('/api/support', support);
app.route('/api/admin', admin);

/* ---------- public SEO pages: server-rendered, edge-cached, refreshed on every blog change ---------- */

/** Bump when public page HTML or headers change so cached copies are replaced. */
const PUBLIC_CACHE_REV = '2026-10-no-vedic-1-logo2-acct';
const PUBLIC_CSP = "default-src 'self'; script-src 'self' https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self' https://cloudflareinsights.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'";
const CONTENT_TYPE = { html: 'text/html; charset=utf-8', xml: 'application/xml; charset=utf-8', rss: 'application/rss+xml; charset=utf-8', text: 'text/plain; charset=utf-8' } as const;
const edgeCache = (): Cache | undefined => (typeof caches === 'undefined' ? undefined : (caches as unknown as { default: Cache }).default);

async function publicPage(c: C, type: keyof typeof CONTENT_TYPE, render: () => Promise<string | null>): Promise<Response> {
  const cache = edgeCache();
  const key = new Request(`${new URL(c.req.url).origin}${c.req.path}?v=${await blogVersion(c.env.DB)}&r=${PUBLIC_CACHE_REV}`);
  const hit = cache ? await cache.match(key) : undefined;
  if (hit) return new Response(hit.body, hit);
  const body = await render();
  const headers = { 'Content-Type': CONTENT_TYPE[type], 'Content-Security-Policy': PUBLIC_CSP };
  if (body === null) {
    const html = layout({ site: env.siteUrl, path: c.req.path, title: 'Page not found | Kaalera', description: 'This page does not exist.' },
      '<section class="w-hero"><h1>Page not found</h1><p class="w-lead"><a href="/blog">Read the blog</a> or <a href="/">ask Kaal</a>.</p></section>');
    return new Response(html, { status: 404, headers: { ...headers, 'Content-Type': CONTENT_TYPE.html, 'Cache-Control': 'no-store' } });
  }
  const res = new Response(body, { headers: { ...headers, 'Cache-Control': 'public, max-age=60, s-maxage=86400' } });
  if (cache) {
    const put = cache.put(key, res.clone());
    try { c.executionCtx.waitUntil(put); } catch { await put; }
  }
  return res;
}

const published = (c: C) => listPosts(c.env.DB, true);
app.get('/robots.txt', (c) => publicPage(c, 'text', async () => robotsTxt(env.siteUrl)));
app.get('/sitemap.xml', (c) => publicPage(c, 'xml', async () => sitemapXml(env.siteUrl, await published(c))));
app.get('/llms.txt', (c) => publicPage(c, 'text', async () => llmsTxt(env.siteUrl, await published(c))));
app.get('/blog/rss.xml', (c) => publicPage(c, 'rss', async () => rssXml(env.siteUrl, await published(c))));
app.get('/blog', (c) => publicPage(c, 'html', async () => blogIndexPage(env.siteUrl, await published(c))));
app.get('/blog/:slug', (c) => publicPage(c, 'html', async () => {
  const p = await getPublishedPost(c.env.DB, c.req.param('slug'));
  if (!p) return null;
  return blogPostPage(env.siteUrl, p, (await published(c)).filter((x) => x.slug !== p.slug).slice(0, 3));
}));
app.get('/terms', (c) => publicPage(c, 'html', async () => termsPage(env.siteUrl)));

const unsubPage = (c: C, lead: string, form = '') => c.html(layout(
  { site: env.siteUrl, path: '/unsubscribe', title: 'Email preferences | Kaalera', description: 'Manage Kaalera emails.' },
  `<section class="w-hero"><h1>Email preferences</h1><p class="w-lead">${lead}</p>${form}</section>`,
), 200, { 'Content-Security-Policy': PUBLIC_CSP, 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' });
app.get('/unsubscribe', (c) => {
  const t = c.req.query('t') ?? '';
  if (!validUnsubToken(t)) return unsubPage(c, 'This unsubscribe link is not valid.');
  return unsubPage(c, 'Stop offers, festival deals and influencer updates from Kaalera? Sign-in links, receipts and expiry notices about your purchases still arrive.',
    `<form method="post" action="/unsubscribe?t=${t}"><button class="w-cta big" type="submit">Unsubscribe</button></form>`);
});
app.post('/unsubscribe', async (c) => {
  const ok = await unsubscribe(c.env.DB, c.req.query('t') ?? '');
  return unsubPage(c, ok ? 'Done. You won\'t get offers or influencer updates from Kaalera any more.' : 'This unsubscribe link is not valid.');
});
app.get('/privacy', (c) => publicPage(c, 'html', async () => privacyPage(env.siteUrl)));
app.get('/affiliates', (c) => publicPage(c, 'html', async () => affiliatesPage(env.siteUrl)));
app.get('/influencers', (c) => publicPage(c, 'html', async () => influencersPage(env.siteUrl)));
app.get('/contact', (c) => {
  const q = c.req.query();
  if (q.sent || q.error) return c.html(contactPage(env.siteUrl, q.sent ? 'sent' : 'error'), 200, { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' });
  return publicPage(c, 'html', async () => contactPage(env.siteUrl));
});
for (const t of TOPICS) app.get(`/${t.slug}`, (c) => publicPage(c, 'html', async () => topicPage(env.siteUrl, t, await published(c))));

app.notFound((c) => c.json({ error: 'Not found' }, 404));
app.onError((err, c) => {
  console.error(err);
  return c.json({ error: 'Something went wrong.' }, 500);
});

export default {
  fetch: app.fetch,
  async scheduled(_event: { cron: string }, bindings: { DB: D1Database }, ctx: { waitUntil(p: Promise<unknown>): void }) {
    ctx.waitUntil(sendDueReminders(bindings.DB).then((n) => console.log('Reminders sent:', n)));
    ctx.waitUntil(sendExpiryReminders(bindings.DB).then((n) => console.log('Expiry notices sent:', n)).catch((err) => console.error('Expiry notices failed:', err)));
    ctx.waitUntil(sendInfluencerDigests(bindings.DB).then((n) => console.log('Influencer emails sent:', n)).catch((err) => console.error('Influencer emails failed:', err)));
    ctx.waitUntil(sendFestivalEmails(bindings.DB).then((n) => console.log('Festival emails sent:', n)).catch((err) => console.error('Festival emails failed:', err)));
    ctx.waitUntil(bindings.DB.prepare("DELETE FROM email_leads WHERE signed_up = 0 AND created_at < ?")
      .bind(new Date(Date.now() - 90 * 86_400_000).toISOString()).run().catch((err) => console.error('Lead cleanup failed:', err)));
  },
};
