import Stripe from 'stripe';
import { env } from './env';

let client: Stripe | null = null;

/**
 * WebCrypto-backed provider for webhook signature verification.
 *
 * Cloudflare Workers has no synchronous Node crypto for HMAC, so signature
 * checks must run through SubtleCrypto (async). Pair this with
 * `webhooks.constructEventAsync` (see `api/stripe/webhook.ts`).
 */
export const cryptoProvider = Stripe.createSubtleCryptoProvider();

export function stripe(): Stripe {
  if (!client) {
    client = new Stripe(env.stripe.secretKey, {
      apiVersion: '2024-06-20',
      // The default Node `http` client is unavailable on the Workers runtime;
      // use the Fetch-based client so requests work on Cloudflare.
      httpClient: Stripe.createFetchHttpClient(),
    });
  }
  return client;
}

export function isUnsupportedCurrencyError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { type?: unknown; param?: unknown; message?: unknown };
  const isInvalidReq =
    e.type === 'StripeInvalidRequestError' || err instanceof Stripe.errors.StripeInvalidRequestError;
  const paramIsCurrency = e.param === 'currency';
  const msg = typeof e.message === 'string' ? e.message : '';
  return isInvalidReq && (paramIsCurrency || /currency/i.test(msg));
}
