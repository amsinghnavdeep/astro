/**
 * Runtime pricing configuration store.
 *
 * The app is otherwise "no-database", but prices and currency need to change
 * without a redeploy. This module provides a tiny persisted config layer backed
 * by a serverless KV (Upstash Redis over its REST API — works on any host).
 *
 * When no KV is configured (`KV_REST_API_URL` / `KV_REST_API_TOKEN` unset), we
 * transparently fall back to the env-var defaults in `env.ts`, so the app keeps
 * working with zero KV setup. Reads are cached in-memory with a short TTL to
 * avoid a KV round-trip on every checkout.
 */
import { z } from 'zod';
import { env } from './env';

export interface PricingConfig {
  currency: string;
  kundliCents: number;
  followupTierCents: { 1: number; 2: number; 3: number };
}

/** Validation schema for an incoming pricing config (admin PUT). */
export const pricingConfigSchema = z.object({
  // 3-letter ISO 4217 code (e.g. usd, inr, jpy). Stored lower-cased for Stripe.
  currency: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{3}$/, 'currency must be a 3-letter ISO code')
    .transform((s) => s.toLowerCase()),
  // Amounts are positive integers in the smallest currency unit
  // (USD cents, INR paise; zero-decimal currencies like JPY use whole units).
  kundliCents: z.number().int().positive(),
  followupTierCents: z.object({
    1: z.number().int().positive(),
    2: z.number().int().positive(),
    3: z.number().int().positive(),
  }),
});

const KV_KEY = 'pricing:config';
const CACHE_TTL_MS = 30_000;

let cache: { value: PricingConfig; expiresAt: number } | null = null;

/** The default seed: the existing env-var pricing (USD). */
function defaultPricing(): PricingConfig {
  return {
    currency: 'usd',
    kundliCents: env.pricing.kundliCents,
    followupTierCents: {
      1: env.pricing.followupTierCents[1],
      2: env.pricing.followupTierCents[2],
      3: env.pricing.followupTierCents[3],
    },
  };
}

function kvConfigured(): boolean {
  return Boolean(env.kv.restUrl && env.kv.restToken);
}

/**
 * Minimal Upstash Redis REST helper. Command is sent as a path-segment array,
 * e.g. `['GET', key]` or `['SET', key, value]`.
 */
async function kvCommand(command: string[]): Promise<unknown> {
  const url = `${env.kv.restUrl!.replace(/\/$/, '')}/${command
    .map((c) => encodeURIComponent(c))
    .join('/')}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${env.kv.restToken!}` },
  });
  if (!res.ok) {
    throw new Error(`KV request failed: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as { result?: unknown; error?: string };
  if (body.error) {
    throw new Error(`KV error: ${body.error}`);
  }
  return body.result;
}

/** Returns the current effective pricing config (cached briefly). */
export async function getPricing(): Promise<PricingConfig> {
  if (cache && cache.expiresAt > Date.now()) {
    return cache.value;
  }

  let value = defaultPricing();

  if (kvConfigured()) {
    try {
      const stored = await kvCommand(['GET', KV_KEY]);
      if (typeof stored === 'string' && stored.length > 0) {
        const parsed = pricingConfigSchema.safeParse(JSON.parse(stored));
        if (parsed.success) {
          value = parsed.data;
        }
      }
    } catch {
      // On any KV read failure, fall back to defaults rather than blocking a sale.
    }
  }

  cache = { value, expiresAt: Date.now() + CACHE_TTL_MS };
  return value;
}

/** Persists a new pricing config to KV and refreshes the in-memory cache. */
export async function setPricing(config: PricingConfig): Promise<PricingConfig> {
  const value = pricingConfigSchema.parse(config);

  if (!kvConfigured()) {
    throw new Error(
      'No KV configured: set KV_REST_API_URL and KV_REST_API_TOKEN to persist pricing changes.',
    );
  }

  await kvCommand(['SET', KV_KEY, JSON.stringify(value)]);
  cache = { value, expiresAt: Date.now() + CACHE_TTL_MS };
  return value;
}
