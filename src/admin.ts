/** Owner-only admin API: blog posts and prices. No customer data is exposed here. */
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { env } from './env.js';
import { deletePost, listPosts, savePost, slugify } from './blog.js';
import { getPrices, priceHistory, PRICE_LIMITS, setPrices, type Prices } from './settings.js';
import type { AppEnv } from './types.js';
import { funnel } from './analytics.js';
import { listFestivals, updateFestival } from './festivals.js';

export const admin = new Hono<AppEnv>();
export const isAdmin = (email: string | undefined | null): boolean => !!email && env.adminEmails.includes(email.toLowerCase());

admin.use('*', async (c, next) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'account_required' }, 401);
  if (!isAdmin(user.email)) return c.json({ error: 'Not found' }, 404);
  await next();
});

admin.get('/me', (c) => c.json({ admin: true, email: c.get('user')!.email }));

/** Funnel totals only — no emails, names or per-user rows. */
admin.get('/funnel', async (c) => {
  const days = Math.min(365, Math.max(1, Number(c.req.query('days')) || 30));
  return c.json(await funnel(c.env.DB, days));
});

const int = (k: keyof Prices) => z.number().int().min(PRICE_LIMITS[k][0]).max(PRICE_LIMITS[k][1]);
export const pricesSchema = z.object({
  chatPackCents: int('chatPackCents'), extraQuestionCents: int('extraQuestionCents'), chatPackQuestions: int('chatPackQuestions'), freeQuestions: int('freeQuestions'),
  planBasicCents: int('planBasicCents'), planBasicConsults: int('planBasicConsults'), planPlusCents: int('planPlusCents'),
  planPlusConsults: int('planPlusConsults'), planProCents: int('planProCents'), planProConsults: int('planProConsults'),
  trialDays: int('trialDays'), trialConsults: int('trialConsults'),
  apiCreditCents: int('apiCreditCents'), apiMinRechargeCents: int('apiMinRechargeCents'), taxFeePercent: int('taxFeePercent'), quickWords: int('quickWords'),
}).partial().strict();

admin.get('/prices', async (c) =>
  c.json({ prices: await getPrices(c.env.DB), limits: PRICE_LIMITS, history: await priceHistory(c.env.DB) }));

admin.put('/prices', async (c) => {
  const p = pricesSchema.safeParse(await c.req.json().catch(() => null));
  if (!p.success) return c.json({ error: p.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') }, 400);
  const prices = await setPrices(c.env.DB, p.data, c.get('user')!.email);
  return c.json({ prices, history: await priceHistory(c.env.DB) });
});

export const postSchema = z.object({
  title: z.string().trim().min(3).max(160),
  slug: z.string().trim().max(80).default(''),
  summary: z.string().trim().max(300).default(''),
  coverUrl: z.union([z.literal(''), z.string().trim().url().max(500).refine((u) => u.startsWith('https://'), 'must start with https://')]).default(''),
  body: z.string().max(60_000).refine((b) => b.trim().length >= 20, 'is too short'),
  status: z.enum(['draft', 'published']),
});

admin.get('/posts', async (c) => c.json({ posts: await listPosts(c.env.DB, false) }));

const upsert = async (c: Context<AppEnv>, id: string | null) => {
  const p = postSchema.safeParse(await c.req.json().catch(() => null));
  if (!p.success) return c.json({ error: p.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ') }, 400);
  const slug = slugify(p.data.slug || p.data.title);
  if (!slug) return c.json({ error: 'Add a title or link made of letters or numbers.' }, 400);
  const r = await savePost(c.env.DB, id, { ...p.data, slug, coverUrl: p.data.coverUrl || null });
  if (r.error === 'not_found') return c.json({ error: 'Not found' }, 404);
  if (r.error === 'slug_taken') return c.json({ error: `Another post already uses the link /blog/${slug}.` }, 409);
  return c.json({ post: r.post });
};
admin.post('/posts', (c) => upsert(c, null));
admin.put('/posts/:id', (c) => upsert(c, c.req.param('id')));
admin.delete('/posts/:id', async (c) =>
  ((await deletePost(c.env.DB, c.req.param('id'))) ? c.json({ ok: true }) : c.json({ error: 'Not found' }, 404)));

export const festivalSchema = z.object({
  enabled: z.boolean(), percent: z.number().int().min(0).max(50), festivalDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
}).partial().strict();

admin.get('/festivals', async (c) => c.json({ festivals: await listFestivals(c.env.DB) }));

admin.put('/festivals/:id', async (c) => {
  const p = festivalSchema.safeParse(await c.req.json().catch(() => null));
  if (!p.success) return c.json({ error: p.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') }, 400);
  return (await updateFestival(c.env.DB, c.req.param('id'), p.data)) ? c.json({ festivals: await listFestivals(c.env.DB) }) : c.json({ error: 'Not found' }, 404);
});
