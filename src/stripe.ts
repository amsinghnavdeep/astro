import Stripe from 'stripe';
import { env } from './env.js';

let client: Stripe | null = null;

export const cryptoProvider = Stripe.createSubtleCryptoProvider();

export function stripe(): Stripe {
  if (!client) {
    client = new Stripe(env.stripe.secretKey, { httpClient: Stripe.createFetchHttpClient() });
  }
  return client;
}
