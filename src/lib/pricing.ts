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
import { countryToCurrency } from './geo';

export interface CurrencyPricing {
  kundliCents: number;
  kundliWasCents: number;
  followupTierCents: { 1: number; 2: number; 3: number };
  followupTierWasCents: { 1: number; 2: number; 3: number };
}

export interface PricingConfig {
  defaultCurrency: string;
  currencies: Record<string, CurrencyPricing>;
}

export const currencyPricingSchema = z.object({
  kundliCents: z.number().int().positive(),
  kundliWasCents: z.number().int().positive(),
  followupTierCents: z.object({
    1: z.number().int().positive(),
    2: z.number().int().positive(),
    3: z.number().int().positive(),
  }),
  followupTierWasCents: z.object({
    1: z.number().int().positive(),
    2: z.number().int().positive(),
    3: z.number().int().positive(),
  }),
});

/** Validation schema for an incoming pricing config (admin PUT). */
export const pricingConfigSchema = z.object({
  defaultCurrency: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{3}$/, 'defaultCurrency must be a 3-letter ISO code')
    .transform((s) => s.toLowerCase()),
  currencies: z
    .record(
      z.string().regex(/^[a-z]{3}$/, 'currency key must be a lowercase 3-letter ISO code'),
      currencyPricingSchema,
    )
    .superRefine((currencies, ctx) => {
      if (Object.keys(currencies).length < 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['currencies'],
          message: 'At least one currency must be configured.',
        });
      }
    }),
}).superRefine((data, ctx) => {
  if (!Object.prototype.hasOwnProperty.call(data.currencies, data.defaultCurrency)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['defaultCurrency'],
      message: 'defaultCurrency must match one of the configured currencies.',
    });
  }
});

const KV_KEY = 'pricing:config';
const CACHE_TTL_MS = 30_000;

let cache: { value: PricingConfig; expiresAt: number } | null = null;

function currencyPricingSeed(
  kundliCents: number,
  kundliWasCents: number,
  followupTierCents: { 1: number; 2: number; 3: number },
  followupTierWasCents: { 1: number; 2: number; 3: number },
): CurrencyPricing {
  return {
    kundliCents,
    kundliWasCents,
    followupTierCents,
    followupTierWasCents,
  };
}

/** The default seed: the existing env-var pricing (USD). */
function defaultPricing(): PricingConfig {
  return {
    defaultCurrency: 'usd',
    currencies: {
      usd: currencyPricingSeed(
        env.pricing.kundliCents,
        5100,
        {
          1: env.pricing.followupTierCents[1],
          2: env.pricing.followupTierCents[2],
          3: env.pricing.followupTierCents[3],
        },
        { 1: 1300, 2: 1800, 3: 2100 },
      ),
      inr: currencyPricingSeed(
        250000,
        410000,
        { 1: 60000, 2: 85000, 3: 110000 },
        { 1: 110000, 2: 150000, 3: 180000 },
      ),
      gbp: currencyPricingSeed(
        2500,
        4100,
        { 1: 650, 2: 900, 3: 1050 },
        { 1: 1050, 2: 1450, 3: 1700 },
      ),
      eur: currencyPricingSeed(
        2900,
        4800,
        { 1: 750, 2: 1000, 3: 1200 },
        { 1: 1200, 2: 1650, 3: 1950 },
      ),
      aud: currencyPricingSeed(
        4700,
        7700,
        { 1: 1200, 2: 1650, 3: 1950 },
        { 1: 1950, 2: 2700, 3: 3200 },
      ),
      cad: currencyPricingSeed(
        4300,
        7000,
        { 1: 1100, 2: 1500, 3: 1800 },
        { 1: 1800, 2: 2500, 3: 2900 },
      ),
    },
  };
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function mergeCurrencyPricing(
  base: Partial<CurrencyPricing>,
  override: Partial<CurrencyPricing>,
): CurrencyPricing {
  return {
    kundliCents: override.kundliCents ?? base.kundliCents ?? 0,
    kundliWasCents: override.kundliWasCents ?? base.kundliWasCents ?? 0,
    followupTierCents: {
      1: override.followupTierCents?.[1] ?? base.followupTierCents?.[1] ?? 0,
      2: override.followupTierCents?.[2] ?? base.followupTierCents?.[2] ?? 0,
      3: override.followupTierCents?.[3] ?? base.followupTierCents?.[3] ?? 0,
    },
    followupTierWasCents: {
      1: override.followupTierWasCents?.[1] ?? base.followupTierWasCents?.[1] ?? 0,
      2: override.followupTierWasCents?.[2] ?? base.followupTierWasCents?.[2] ?? 0,
      3: override.followupTierWasCents?.[3] ?? base.followupTierWasCents?.[3] ?? 0,
    },
  };
}

function mergeParsedPricing(parsed: unknown): PricingConfig | null {
  if (!parsed || typeof parsed !== 'object') {
    return null;
  }

  const defaults = defaultPricing();
  const merged = deepClone(defaults);
  const input = parsed as Record<string, unknown>;

  if (Object.prototype.hasOwnProperty.call(input, 'kundliCents')) {
    const old = input as {
      currency?: unknown;
      kundliCents?: unknown;
      followupTierCents?: Partial<CurrencyPricing['followupTierCents']>;
    };
    const targetKeyRaw = typeof old.currency === 'string' && old.currency.trim() ? old.currency : 'usd';
    const targetKey = targetKeyRaw.toLowerCase();
    const base = merged.currencies[targetKey] ?? merged.currencies[defaults.defaultCurrency];
    if (!base || typeof old.kundliCents !== 'number') {
      return null;
    }

    merged.currencies[targetKey] = {
      ...base,
      kundliCents: old.kundliCents,
      followupTierCents: {
        ...base.followupTierCents,
        ...old.followupTierCents,
      },
    };
    return merged;
  }

  if (typeof input.defaultCurrency === 'string' && input.defaultCurrency.trim()) {
    merged.defaultCurrency = input.defaultCurrency.toLowerCase();
  }

  if (input.currencies && typeof input.currencies === 'object' && !Array.isArray(input.currencies)) {
    for (const [cur, block] of Object.entries(input.currencies)) {
      if (!block || typeof block !== 'object' || Array.isArray(block)) {
        continue;
      }

      const key = cur.toLowerCase();
      const base = merged.currencies[key] ?? defaults.currencies[key] ?? ({} as Partial<CurrencyPricing>);
      merged.currencies[key] = mergeCurrencyPricing(base, block as Partial<CurrencyPricing>);
    }
  }

  return merged;
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
        const merged = mergeParsedPricing(JSON.parse(stored));
        if (merged) {
          const parsed = pricingConfigSchema.safeParse(merged);
          if (parsed.success) {
            value = parsed.data;
          }
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

export function resolveCurrency(config: PricingConfig, country?: string): string {
  const currency = countryToCurrency(country);
  return currency && config.currencies[currency] ? currency : config.defaultCurrency;
}

export async function getCurrencyPricing(
  kv: KVNamespace | undefined,
  country?: string,
): Promise<{ currency: string; pricing: CurrencyPricing }> {
  const config = await getPricing(kv);
  const currency = resolveCurrency(config, country);
  return { currency, pricing: config.currencies[currency] };
}
