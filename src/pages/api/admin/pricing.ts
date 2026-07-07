/**
 * Protected admin API to read and change pricing/currency at runtime.
 *
 *   GET  /api/admin/pricing  → current effective pricing config
 *   PUT  /api/admin/pricing  → validate + persist a new config
 *
 * Both require `Authorization: Bearer <ADMIN_API_TOKEN>`.
 */
export const prerender = false;
import type { APIRoute } from 'astro';
import { env } from '../../../lib/env';
import { getPricing, setPricing, pricingConfigSchema } from '../../../lib/pricing';

function authorized(request: Request): boolean {
  const header = request.headers.get('authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) return false;
  return match[1] === env.adminApiToken;
}

export const GET: APIRoute = async ({ request }) => {
  if (!authorized(request)) return json({ error: 'Unauthorized' }, 401);
  return json(await getPricing());
};

export const PUT: APIRoute = async ({ request }) => {
  if (!authorized(request)) return json({ error: 'Unauthorized' }, 401);

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const parsed = pricingConfigSchema.safeParse(payload);
  if (!parsed.success) {
    return json({ error: 'Invalid pricing config', issues: parsed.error.issues }, 400);
  }

  try {
    const saved = await setPricing(parsed.data);
    return json(saved);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Failed to persist pricing' }, 500);
  }
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
