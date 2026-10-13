const BASE = "Kaal's readings are astrological guidance for personal reflection only. They are not medical, legal, financial or other professional advice, and predictions are not guaranteed. All sales are final — no refunds.";

/** Flat lump sum added to every purchase, worldwide. The owner can change it in /admin. */
export const TAX_FEE_PERCENT_DEFAULT = 15;
export const taxFeeNote = (percent: number): string => (percent > 0 ? ` + ${percent}% taxes & fees` : '');

/** Auto-charge is on by default; shown in the consent box, on Stripe Checkout and again after the first payment. */
export interface AutoPrices { extraQuestionCents: number; apiCreditCents: number; taxFeePercent: number }
const usd = (cents: number) => `$${(cents / 100).toFixed(cents % 100 ? 2 : 0)}`;
const withFee = (cents: number, pct: number) => cents + Math.round((cents * pct) / 100);
export const API_AUTO_DEFAULT = { lowCents: 1000, cents: 10_000, capCents: 50_000 };
export const autoNote = (area: 'chat' | 'api', p: AutoPrices): string => {
  const fee = p.taxFeePercent > 0 ? ` + ${p.taxFeePercent}% taxes & fees` : '';
  if (area === 'chat') {
    return `Auto-charge is on: your card is saved and each extra question after your paid ones is charged automatically at ${usd(p.extraQuestionCents)}${fee} (${usd(withFee(p.extraQuestionCents, p.taxFeePercent))}), up to 10 a day. Turn it off any time in your account menu.`;
  }
  const pack = API_AUTO_DEFAULT.cents;
  return `Auto-recharge is on: your card is saved and when your wallet drops below ${usd(API_AUTO_DEFAULT.lowCents)} we add ${usd(pack)}${fee} (${usd(withFee(pack, p.taxFeePercent))}), up to ${usd(API_AUTO_DEFAULT.capCents)} a month. Change or turn it off on the Developers page.`;
};

export const disclaimer = (area: 'chat' | 'api', p: AutoPrices): string =>
  `${BASE} ${area === 'chat' ? 'Chat questions expire 3 months after purchase.' : 'API wallet balance expires 6 months after purchase.'} ${autoNote(area, p)}`;

/** Shown on the card payment page above the Pay button. */
export const checkoutNote = (area: 'chat' | 'api', p: AutoPrices): string => [
  'Guidance only, not professional advice.',
  p.taxFeePercent > 0 ? `A flat ${p.taxFeePercent}% taxes & fees is included in the total.` : '',
  'All sales are final — no refunds.',
  area === 'chat' ? 'Questions expire 3 months after purchase.' : 'API wallet balance expires 6 months after purchase.',
  autoNote(area, p),
].filter(Boolean).join(' ');
