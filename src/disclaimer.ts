const BASE = "Kaal's readings are astrological guidance for personal reflection only. They are not medical, legal, financial or other professional advice, and predictions are not guaranteed. All sales are final — no refunds.";

/** Flat lump sum added to every purchase, worldwide. The owner can change it in /admin. */
export const TAX_FEE_PERCENT_DEFAULT = 15;
export const taxFeeNote = (percent: number): string => (percent > 0 ? ` + ${percent}% taxes & fees` : '');

export const DISCLAIMER = {
  chat: `${BASE} Chat questions expire 3 months after purchase.`,
  api: `${BASE} API credits expire 6 months after purchase.`,
} as const;

/** Shown on the card payment page above the Pay button. */
export const checkoutNote = (area: 'chat' | 'api', taxPercent: number): string => [
  'Guidance only, not professional advice.',
  taxPercent > 0 ? `A flat ${taxPercent}% taxes & fees is included in the total.` : '',
  'All sales are final — no refunds.',
  area === 'chat' ? 'Questions expire 3 months after purchase.' : 'API credits expire 6 months after purchase.',
].filter(Boolean).join(' ');
