/**
 * Runtime pricing configuration store.
 *
 * The app is otherwise "no-database", but prices and currency need to change
 * without a redeploy. This module provides a tiny persisted config layer
 * backed by Cloudflare Workers KV.
 *
 * When no KV binding is available, we transparently fall back to the env-var
 * defaults in `env.ts`, so the app keeps working with zero KV setup. Reads
 * are cached in-memory with a short TTL to avoid a KV round-trip on every
 * checkout.
 */
import type { KVNamespace } from '@cloudflare/workers-types';
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

/** Returns the current effective pricing config (cached briefly). */
export async function getPricing(kv?: KVNamespace): Promise<PricingConfig> {
  if (cache && cache.expiresAt > Date.now()) {
    return cache.value;
  }

  let value = defaultPricing();

  if (kv) {
    try {
      const stored = await kv.get(KV_KEY);
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
export async function setPricing(
  kv: KVNamespace | undefined,
  config: PricingConfig,
): Promise<PricingConfig> {
  const value = pricingConfigSchema.parse(config);

  if (!kv) {
    throw new Error('KV not configured');
  }

  await kv.put(KV_KEY, JSON.stringify(value));
  cache = { value, expiresAt: Date.now() + CACHE_TTL_MS };
  return value;
}
