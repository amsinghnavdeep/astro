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

function intVar(name: string, fallback: number): number {
  const raw = process.env[name];
  const value = raw ? Number(raw) : fallback;
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`Invalid integer for ${name}: ${raw}`);
  }
  return value;
}

export const env = {
  siteUrl: optional('PUBLIC_SITE_URL', 'http://localhost:4321'),

  pricing: {
    kundliCents: usdToCents('PRICE_KUNDLI_USD', 31),
    followupTierCents: {
      1: usdToCents('PRICE_FOLLOWUP_1_USD', 8),
      2: usdToCents('PRICE_FOLLOWUP_2_USD', 11),
      3: usdToCents('PRICE_FOLLOWUP_3_USD', 13),
    } as Record<number, number>,
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
    // Not consumed at runtime — the v3 message API does not accept a
    // playbook_id, so follow-ups resume the original session's context.
    // Retained for documentation; will be wired in if the API adds support.
    followupPlaybook: optional('DEVIN_FOLLOWUP_PLAYBOOK'),
  },

  chat: {
    creditsPerKundli: intVar('CHAT_CREDITS_PER_KUNDLI', 5),
    packs: [
      { id: 'pack10', credits: 10, cents: usdToCents('PRICE_CHAT_PACK_10_USD', 9) },
      { id: 'pack25', credits: 25, cents: usdToCents('PRICE_CHAT_PACK_25_USD', 19) },
    ],
    playbook: optional('DEVIN_CHAT_PLAYBOOK'),
    // Optional agent mode for chat sessions (e.g. "fast") to trade depth for cost.
    devinMode: optional('DEVIN_CHAT_MODE'),
    maxAcuPerSession: intVar('CHAT_MAX_ACU_PER_SESSION', 20),
    maxMessageChars: intVar('CHAT_MAX_MESSAGE_CHARS', 600),
  },

  reportService: {
    url: optional('KUNDLI_SERVICE_URL'),
    get token() {
      return required('KUNDLI_SERVICE_TOKEN');
    },
    useDevinFulfillment: optional('USE_DEVIN_FULFILLMENT') === 'true',
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
    // NOTE: siddhjyotish.com must be a verified sending domain in Resend for
    // this From address to deliver (Resend → Domains). Otherwise sends fail.
    from: optional('EMAIL_FROM', 'Siddh Jyotish <namaste@siddhjyotish.com>'),
  },

  docs: {
    authUser: optional('DOCS_AUTH_USER'),
    authPass: optional('DOCS_AUTH_PASS'),
  },

  // Bearer token protecting the runtime pricing admin API
  // (`PUT /api/admin/pricing`). Required in production.
  get adminApiToken() {
    return required('ADMIN_API_TOKEN');
  },
} as const;
