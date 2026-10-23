function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name}`);
  return v;
}
const optional = (name: string): string | undefined => process.env[name] || undefined;
const int = (name: string, fallback: number): number => {
  const v = process.env[name] ? Number(process.env[name]) : fallback;
  if (!Number.isInteger(v) || v < 0) throw new Error(`Invalid integer for ${name}`);
  return v;
};

export const env = {
  get siteUrl() { return (process.env.SITE_URL || 'http://localhost:8787').replace(/\/$/, ''); },
  get devLoginLinks() { return process.env.DEV_LOGIN_LINKS === 'true'; },
  /** Emails allowed into /admin (comma separated). */
  get adminEmails() { return (process.env.ADMIN_EMAILS || 'amsinghnavdeep@gmail.com').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean); },
  devin: {
    get apiKey() { return required('DEVIN_API_KEY'); },
    get orgId() { return required('DEVIN_ORG_ID'); },
    get apiBase() { return process.env.DEVIN_API_BASE || 'https://api.devin.ai'; },
    get kundliPlaybook() { return optional('DEVIN_KUNDLI_PLAYBOOK'); },
    get followupPlaybook() { return optional('DEVIN_FOLLOWUP_PLAYBOOK'); },
  },
  stripe: {
    get secretKey() { return required('STRIPE_SECRET_KEY'); },
    get webhookSecret() { return required('STRIPE_WEBHOOK_SECRET'); },
    get currency() { return 'usd'; },
  },
  phone: {
    get accountSid() { return optional('TWILIO_ACCOUNT_SID'); },
    get authToken() { return optional('TWILIO_AUTH_TOKEN'); },
    get verifySid() { return optional('TWILIO_VERIFY_SID'); },
    get enabled() { return !!(this.accountSid && this.authToken && this.verifySid); },
  },
  email: {
    get apiKey() { return optional('RESEND_API_KEY'); },
    get from() { return process.env.EMAIL_FROM || 'Kaalera <hello@kaalera.com>'; },
  },
  api: {
    get creditCents() { return int('API_CREDIT_CENTS', 1000); },
    get creditDays() { return int('API_CREDIT_DAYS', 180); },
    get packs() {
      const cents = this.creditCents;
      return [2, 10, 50].map((credits) => ({ id: `api${credits}`, credits, cents: credits * cents }));
    },
  },
  support: {
    get email() { return optional('SUPPORT_EMAIL'); },
    get maxAcu() { return int('SUPPORT_MAX_ACU', 3); },
    get maxAiReplies() { return int('SUPPORT_MAX_AI_REPLIES', 2); },
  },
  chat: {
    get freeQuestions() { return int('FREE_QUESTIONS', 1); },
    get packQuestions() { return int('PACK_QUESTIONS', 2); },
    get packCents() { return int('PACK_CENTS', 2000); },
    get creditDays() { return int('CHAT_CREDIT_DAYS', 90); },
    get consultationDays() { return int('CONSULTATION_DAYS', 7); },
    get playbook() { return optional('DEVIN_CHAT_PLAYBOOK'); },
    get devinMode() { return optional('DEVIN_CHAT_MODE'); },
    get maxAcuPerSession() { return int('CHAT_MAX_ACU_PER_SESSION', 10); },
    get maxMessageChars() { return int('CHAT_MAX_MESSAGE_CHARS', 600); },
  },
};
