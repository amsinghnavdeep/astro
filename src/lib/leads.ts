import type { KVNamespace } from '@cloudflare/workers-types';

export interface LeadRecord {
  id: string;
  kind: 'kundli' | 'followup';
  userId?: string;
  email: string;
  fullName?: string;
  gender?: 'Male' | 'Female' | 'Other';
  dateOfBirth?: string;
  timeOfBirth?: string;
  placeOfBirth?: string;
  timezone?: string;
  reference?: string;
  questions: string[];
  amountTotal: number;
  currency: string;
  createdAt: string;
  createdAtMs: number;
}

const LEAD_PREFIX = 'lead:';
const LEAD_TTL_SECONDS = 60 * 60 * 24 * 30;

function leadKey(id: string): string {
  return `${LEAD_PREFIX}${id}`;
}

export async function recordLead(
  kv: KVNamespace | undefined,
  lead: LeadRecord,
): Promise<void> {
  if (!kv) {
    throw new Error('KV not configured');
  }
  await kv.put(leadKey(lead.id), JSON.stringify(lead), {
    expirationTtl: LEAD_TTL_SECONDS,
  });
}

export async function deleteLead(
  kv: KVNamespace | undefined,
  id: string,
): Promise<void> {
  if (!kv) {
    throw new Error('KV not configured');
  }
  await kv.delete(leadKey(id));
}

function parseLead(value: string | null): LeadRecord | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as LeadRecord;
    if (
      typeof parsed.id !== 'string' ||
      (parsed.kind !== 'kundli' && parsed.kind !== 'followup') ||
      typeof parsed.email !== 'string' ||
      !Array.isArray(parsed.questions) ||
      parsed.questions.some((item) => typeof item !== 'string') ||
      typeof parsed.amountTotal !== 'number' ||
      typeof parsed.currency !== 'string' ||
      typeof parsed.createdAt !== 'string' ||
      typeof parsed.createdAtMs !== 'number'
    ) {
      return null;
    }

    if (
      parsed.fullName !== undefined &&
      typeof parsed.fullName !== 'string'
    ) {
      return null;
    }

    if (
      parsed.userId !== undefined &&
      typeof parsed.userId !== 'string'
    ) {
      return null;
    }

    if (
      parsed.gender !== undefined &&
      parsed.gender !== 'Male' &&
      parsed.gender !== 'Female' &&
      parsed.gender !== 'Other'
    ) {
      return null;
    }

    if (
      parsed.dateOfBirth !== undefined &&
      typeof parsed.dateOfBirth !== 'string'
    ) {
      return null;
    }
    if (
      parsed.timeOfBirth !== undefined &&
      typeof parsed.timeOfBirth !== 'string'
    ) {
      return null;
    }
    if (
      parsed.placeOfBirth !== undefined &&
      typeof parsed.placeOfBirth !== 'string'
    ) {
      return null;
    }
    if (
      parsed.timezone !== undefined &&
      typeof parsed.timezone !== 'string'
    ) {
      return null;
    }
    if (
      parsed.reference !== undefined &&
      typeof parsed.reference !== 'string'
    ) {
      return null;
    }

    if (parsed.kind === 'kundli') {
      if (
        typeof parsed.gender !== 'string' ||
        typeof parsed.dateOfBirth !== 'string' ||
        typeof parsed.timeOfBirth !== 'string' ||
        typeof parsed.placeOfBirth !== 'string' ||
        typeof parsed.timezone !== 'string'
      ) {
        return null;
      }
    } else if (typeof parsed.reference !== 'string') {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

async function listLeadKeys(kv: KVNamespace): Promise<string[]> {
  const keys: string[] = [];
  let cursor: string | undefined;

  do {
    const page = await kv.list({ prefix: LEAD_PREFIX, cursor });
    keys.push(...page.keys.map((item) => item.name));
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);

  return keys;
}

export async function queryLeads(
  kv: KVNamespace,
  filters: { from?: Date; to?: Date } = {},
): Promise<LeadRecord[]> {
  const fromMs = filters.from?.getTime();
  const toMs = filters.to?.getTime();
  const keys = await listLeadKeys(kv);
  const values = await Promise.all(keys.map((key) => kv.get(key)));

  return values
    .map(parseLead)
    .filter((lead): lead is LeadRecord => Boolean(lead))
    .filter((lead) => {
      if (typeof fromMs === 'number' && lead.createdAtMs < fromMs) return false;
      if (typeof toMs === 'number' && lead.createdAtMs > toMs) return false;
      return true;
    })
    .sort((a, b) => a.createdAtMs - b.createdAtMs || a.id.localeCompare(b.id));
}
