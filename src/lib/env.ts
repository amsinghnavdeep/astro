/**
 * Centralised, type-safe access to environment configuration.
 *
 * All secrets are read from the server process only. None of these values are
 * ever exposed to the browser (only `PUBLIC_*` vars would be, and we keep none
 * of the sensitive ones public).
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optional(name: string, fallback = ''): string {
  return process.env[name] ?? fallback;
}

function usdToCents(name: string, fallbackDollars: number): number {
  const raw = process.env[name];
  const dollars = raw ? Number(raw) : fallbackDollars;
  if (!Number.isFinite(dollars) || dollars <= 0) {
    throw new Error(`Invalid price for ${name}: ${raw}`);
  }
  return Math.round(dollars * 100);
}

export const env = {
  siteUrl: optional('PUBLIC_SITE_URL', 'http://localhost:4321'),

  pricing: {
    kundliCents: usdToCents('PRICE_KUNDLI_USD', 2100),
    followupCents: usdToCents('PRICE_FOLLOWUP_USD', 1100),
  },

  devin: {
    get apiKey() {
      return required('DEVIN_API_KEY');
    },
    get orgId() {
      return required('DEVIN_ORG_ID');
    },
    apiBase: optional('DEVIN_API_BASE', 'https://api.devin.ai'),
    kundliPlaybook: optional('DEVIN_KUNDLI_PLAYBOOK'),
    followupPlaybook: optional('DEVIN_FOLLOWUP_PLAYBOOK'),
  },

  get referenceSecret() {
    return required('REFERENCE_SECRET');
  },

  stripe: {
    get secretKey() {
      return required('STRIPE_SECRET_KEY');
    },
    get webhookSecret() {
      return required('STRIPE_WEBHOOK_SECRET');
    },
  },

  email: {
    get apiKey() {
      return required('RESEND_API_KEY');
    },
    from: optional('EMAIL_FROM', 'Siddh Jyotish <onboarding@resend.dev>'),
  },
} as const;
