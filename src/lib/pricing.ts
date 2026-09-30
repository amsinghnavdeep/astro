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
  /** Price of one reading on one birth chart. Two-chart readings cost 2× this. */
  kundliCents: number;
  kundliWasCents: number;
  /** Price of a follow-up on an already-computed chart. */
  followupCents: number;
  followupWasCents: number;
}

export interface PricingConfig {
  defaultCurrency: string;
  currencies: Record<string, CurrencyPricing>;
}

export const currencyPricingSchema = z.object({
  kundliCents: z.number().int().positive(),
  kundliWasCents: z.number().int().positive(),
  followupCents: z.number().int().positive(),
  followupWasCents: z.number().int().positive(),
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
export const PRICING_CACHE_TTL_MS = 30_000;

let cache: { value: PricingConfig; expiresAt: number } | null = null;

function currencyPricingSeed(
  kundliCents: number,
  kundliWasCents: number,
  followupCents: number,
  followupWasCents: number,
): CurrencyPricing {
  return { kundliCents, kundliWasCents, followupCents, followupWasCents };
}

/** The default seed: the existing env-var pricing (USD). */
function defaultPricing(): PricingConfig {
  return {
    defaultCurrency: 'usd',
    currencies: {
      usd: currencyPricingSeed(env.pricing.kundliCents, 5100, env.pricing.followupCents, 1300),
      inr: currencyPricingSeed(250000, 410000, 60000, 110000),
      gbp: currencyPricingSeed(2500, 4100, 650, 1050),
      eur: currencyPricingSeed(2900, 4800, 750, 1200),
      aud: currencyPricingSeed(4700, 7700, 1200, 1950),
      cad: currencyPricingSeed(4300, 7000, 1100, 1800),
    },
  };
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * A stored block may be in the current shape, or in the legacy tiered shape
 * (`followupTierCents: {1,2,3}`), in which case the 1-question tier becomes
 * the single follow-up price.
 */
type StoredCurrencyPricing = Partial<CurrencyPricing> & {
  followupTierCents?: Partial<Record<'1' | '2' | '3', unknown>>;
  followupTierWasCents?: Partial<Record<'1' | '2' | '3', unknown>>;
};

function legacyTier1(tiers: StoredCurrencyPricing['followupTierCents']): number | undefined {
  const value = tiers?.['1'];
  return typeof value === 'number' ? value : undefined;
}

function mergeCurrencyPricing(
  base: Partial<CurrencyPricing>,
  override: StoredCurrencyPricing,
): CurrencyPricing {
  return {
    kundliCents: override.kundliCents ?? base.kundliCents ?? 0,
    kundliWasCents: override.kundliWasCents ?? base.kundliWasCents ?? 0,
    followupCents:
      override.followupCents ?? legacyTier1(override.followupTierCents) ?? base.followupCents ?? 0,
    followupWasCents:
      override.followupWasCents ??
      legacyTier1(override.followupTierWasCents) ??
      base.followupWasCents ??
      0,
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
    const old = input as { currency?: unknown; kundliCents?: unknown } & StoredCurrencyPricing;
    const targetKeyRaw = typeof old.currency === 'string' && old.currency.trim() ? old.currency : 'usd';
    const targetKey = targetKeyRaw.toLowerCase();
    const base = merged.currencies[targetKey] ?? merged.currencies[defaults.defaultCurrency];
    if (!base || typeof old.kundliCents !== 'number') {
      return null;
    }

    merged.currencies[targetKey] = mergeCurrencyPricing(base, {
      kundliCents: old.kundliCents,
      followupTierCents: old.followupTierCents,
    });
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
      merged.currencies[key] = mergeCurrencyPricing(base, block as StoredCurrencyPricing);
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

  cache = { value, expiresAt: Date.now() + PRICING_CACHE_TTL_MS };
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
  cache = { value, expiresAt: Date.now() + PRICING_CACHE_TTL_MS };
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
