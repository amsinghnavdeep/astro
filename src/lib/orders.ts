import type { KVNamespace } from '@cloudflare/workers-types';

export interface OrderRecord {
  id: string;
  kind: 'kundli' | 'followup';
  amountTotal: number;
  currency: string;
  email: string;
  fullName?: string;
  questionCount?: number;
  createdAt: string;
  createdAtMs: number;
}

const ORDER_PREFIX = 'order:';

function orderKey(order: Pick<OrderRecord, 'createdAt' | 'id'>): string {
  return `${ORDER_PREFIX}${order.createdAt}:${order.id}`;
}

export async function recordOrder(
  kv: KVNamespace | undefined,
  order: OrderRecord,
): Promise<void> {
  if (!kv) {
    throw new Error('KV not configured');
  }
  await kv.put(orderKey(order), JSON.stringify(order));
}

function parseOrder(value: string | null): OrderRecord | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as OrderRecord;
    if (
      typeof parsed.id !== 'string' ||
      (parsed.kind !== 'kundli' && parsed.kind !== 'followup') ||
      typeof parsed.amountTotal !== 'number' ||
      typeof parsed.currency !== 'string' ||
      typeof parsed.email !== 'string' ||
      typeof parsed.createdAt !== 'string' ||
      typeof parsed.createdAtMs !== 'number'
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

async function listOrderKeys(kv: KVNamespace): Promise<string[]> {
  const keys: string[] = [];
  let cursor: string | undefined;

  do {
    const page = await kv.list({ prefix: ORDER_PREFIX, cursor });
    keys.push(...page.keys.map((item) => item.name));
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);

  return keys;
}

export async function queryOrders(
  kv: KVNamespace,
  filters: { from?: Date; to?: Date } = {},
): Promise<OrderRecord[]> {
  const fromMs = filters.from?.getTime();
  const toMs = filters.to?.getTime();
  const keys = await listOrderKeys(kv);
  const values = await Promise.all(keys.map((key) => kv.get(key)));

  return values
    .map(parseOrder)
    .filter((order): order is OrderRecord => Boolean(order))
    .filter((order) => {
      if (typeof fromMs === 'number' && order.createdAtMs < fromMs) return false;
      if (typeof toMs === 'number' && order.createdAtMs > toMs) return false;
      return true;
    })
    .sort((a, b) => a.createdAtMs - b.createdAtMs || a.id.localeCompare(b.id));
}
