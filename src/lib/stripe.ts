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
