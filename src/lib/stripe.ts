import Stripe from 'stripe';
import { env } from './env';

let client: Stripe | null = null;

export function stripe(): Stripe {
  if (!client) {
    client = new Stripe(env.stripe.secretKey, { apiVersion: '2024-06-20' });
  }
  return client;
}
