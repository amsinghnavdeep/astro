const BASE = "Kaal's readings are astrological guidance for personal reflection only. They are not medical, legal, financial or other professional advice, and predictions are not guaranteed. All sales are final — no refunds.";

export const DISCLAIMER = {
  chat: `${BASE} Chat questions expire 3 months after purchase.`,
  api: `${BASE} API credits expire 6 months after purchase.`,
} as const;

/** Shown on the card payment page above the Pay button. */
export const CHECKOUT_NOTE = {
  chat: 'Guidance only, not professional advice. All sales are final — no refunds. Questions expire 3 months after purchase.',
  api: 'Guidance only, not professional advice. All sales are final — no refunds. API credits expire 6 months after purchase.',
} as const;
