const BASE = "Kaal's readings are astrological guidance for personal reflection only. They are not medical, legal, financial or other professional advice, and predictions are not guaranteed. All sales are final — no refunds.";

/** Flat lump sum added to every purchase, worldwide. The owner can change it in /admin. */
export const TAX_FEE_PERCENT_DEFAULT = 15;
export const taxFeeNote = (percent: number): string => (percent > 0 ? ` + ${percent}% taxes & fees` : '');

/** Auto-charge is on by default; shown in the consent box, on Stripe Checkout and again after the first payment. */
export const AUTO_NOTE = {
  chat: 'Auto-charge is on: your card is saved and each extra question after your paid ones is charged automatically at $5 + 15% taxes & fees ($5.75), up to 10 a day. Turn it off any time in your account menu.',
  api: 'Auto-recharge is on: your card is saved and when your balance drops below 2 credits we buy 10 credits ($50 + 15% taxes & fees = $57.50), up to $500 a month. Change or turn it off on the Developers page.',
} as const;

export const DISCLAIMER = {
  chat: `${BASE} Chat questions expire 3 months after purchase. ${AUTO_NOTE.chat}`,
  api: `${BASE} API credits expire 6 months after purchase. ${AUTO_NOTE.api}`,
} as const;

/** Shown on the card payment page above the Pay button. */
export const checkoutNote = (area: 'chat' | 'api', taxPercent: number): string => [
  'Guidance only, not professional advice.',
  taxPercent > 0 ? `A flat ${taxPercent}% taxes & fees is included in the total.` : '',
  'All sales are final — no refunds.',
  area === 'chat' ? 'Questions expire 3 months after purchase.' : 'API credits expire 6 months after purchase.',
  area === 'chat' ? AUTO_NOTE.chat : AUTO_NOTE.api,
].filter(Boolean).join(' ');
