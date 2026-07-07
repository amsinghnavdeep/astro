/**
 * Protected admin API to query persisted orders.
 *
 *   GET /api/admin/orders?date=YYYY-MM-DD
 *   GET /api/admin/orders?from=YYYY-MM-DD&to=YYYY-MM-DD
 */
export const prerender = false;
import type { APIRoute } from 'astro';
import { authorized } from '../../../lib/adminAuth';
import { queryOrders } from '../../../lib/orders';

function parseDateOnly(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function endOfUtcDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999),
  );
}

export const GET: APIRoute = async ({ request, locals }) => {
  if (!authorized(request)) return json({ error: 'Unauthorized' }, 401);

  const kv = locals.runtime.env.SIDDH_KV as
    | import('@cloudflare/workers-types').KVNamespace
    | undefined;
  if (!kv) return json({ error: 'KV not configured' }, 500);

  const url = new URL(request.url);
  const date = url.searchParams.get('date');
  const fromParam = url.searchParams.get('from');
  const toParam = url.searchParams.get('to');

  let from: Date | undefined;
  let to: Date | undefined;

  if (date) {
    if (fromParam || toParam) {
      return json({ error: 'Use either date or from/to, not both' }, 400);
    }
    const parsed = parseDateOnly(date);
    if (!parsed) return json({ error: 'Invalid date format' }, 400);
    from = startOfUtcDay(parsed);
    to = endOfUtcDay(parsed);
  } else if (fromParam || toParam) {
    if (!fromParam || !toParam) {
      return json({ error: 'Both from and to are required' }, 400);
    }
    const fromParsed = parseDateOnly(fromParam);
    const toParsed = parseDateOnly(toParam);
    if (!fromParsed || !toParsed) return json({ error: 'Invalid date format' }, 400);
    from = startOfUtcDay(fromParsed);
    to = endOfUtcDay(toParsed);
  }

  const orders = await queryOrders(kv, { from, to });
  const totalsByCurrency = orders.reduce<Record<string, number>>((acc, order) => {
    acc[order.currency] = (acc[order.currency] ?? 0) + order.amountTotal;
    return acc;
  }, {});

  return json({
    from: from?.toISOString() ?? null,
    to: to?.toISOString() ?? null,
    count: orders.length,
    totalsByCurrency,
    orders,
  });
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
