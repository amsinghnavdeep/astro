import type { Currency } from './currency.js';

const BASE = "Kaal's readings are astrological guidance for personal reflection only. They are not medical, legal, financial or other professional advice, and predictions are not guaranteed. All sales are final — no refunds.";

/** Flat lump sum added to every purchase, worldwide. The owner can change it in /admin. */
export const TAX_FEE_PERCENT_DEFAULT = 15;
export const taxFeeNote = (percent: number): string => (percent > 0 ? ' + taxes & fees' : '');
export const allIn = (cents: number, percent: number): number => cents + Math.round((cents * percent) / 100);

/** Auto-charge is on by default; shown in the consent box, on Stripe Checkout and again after the first payment. */
export interface AutoPrices { extraQuestionCents: number; apiCreditCents: number; taxFeePercent: number; currency: Currency }
const money = (cents: number, currency: Currency) =>
  new Intl.NumberFormat(currency === 'inr' ? 'en-IN' : 'en-US', {
    style: 'currency', currency: currency.toUpperCase(), minimumFractionDigits: cents % 100 ? 2 : 0,
  }).format(cents / 100);
export const authorizedPrice = (cents: number, percent: number, currency: Currency): string =>
  percent > 0 ? `${money(cents, currency)} + ${percent}% taxes & fees (${money(allIn(cents, percent), currency)} total)` : `${money(cents, currency)} total`;
export const authorizedMonthlyPrice = (cents: number, percent: number, currency: Currency): string =>
  percent > 0 ? `${money(cents, currency)}/month + ${percent}% taxes & fees (${money(allIn(cents, percent), currency)} total)` : `${money(cents, currency)}/month`;
export const planCouponConsent = (o: { code: string; months: number; planName: string; monthlyCents: number; taxFeePercent: number; currency: Currency }): string =>
  `I agree to the Terms. Code ${o.code}: your first ${o.months} ${o.months === 1 ? 'month' : 'months'} of ${o.planName} are free, no card needed. After that the plan costs ${authorizedMonthlyPrice(o.monthlyCents, o.taxFeePercent, o.currency)}; add a card from your account to continue, or it ends.`;
export const API_AUTO_DEFAULT = { lowCents: 1000, cents: 10_000, capCents: 50_000 };
export const autoNote = (area: 'chat' | 'api', p: AutoPrices): string => {
  if (area === 'chat') {
    return `Auto-reload is on: your card is saved and when your questions run out, 2 more are added automatically for ${authorizedPrice(p.extraQuestionCents * 2, p.taxFeePercent, p.currency)}, up to 10 questions a day. You can turn it off any time on your Account page.`;
  }
  const pack = API_AUTO_DEFAULT.cents;
  return `Auto-recharge is on: your card is saved and when your wallet drops below ${money(API_AUTO_DEFAULT.lowCents, 'usd')} we add ${money(pack, 'usd')} to your wallet for ${authorizedPrice(pack, p.taxFeePercent, 'usd')}, up to ${money(API_AUTO_DEFAULT.capCents, 'usd')} a month. Change or turn it off on the Developers page.`;
};

export const disclaimer = (area: 'chat' | 'api', p: AutoPrices): string =>
  `${BASE} ${area === 'chat' ? 'Chat questions expire 3 months after purchase.' : 'API wallet balance expires 6 months after purchase.'} ${autoNote(area, p)}`;

export const subscriptionDisclaimer = (o: { trial: boolean; trialEnd: string; monthlyCents: number; taxFeePercent: number; currency: Currency; coupon?: { code: string; months: number; planName: string } }): string => {
  if (o.coupon) {
    return `${BASE} ${planCouponConsent({
      ...o.coupon, monthlyCents: o.monthlyCents, taxFeePercent: o.taxFeePercent, currency: o.currency,
    })} Your consultation allowance resets each billing cycle.`;
  }
  const monthly = authorizedMonthlyPrice(o.monthlyCents, o.taxFeePercent, o.currency);
  const trial = o.trial ? ` Your 7-day free trial ends on ${o.trialEnd}; your card will be charged ${monthly} after the trial.` : ` You will be charged ${monthly} starting today.`;
  return `${BASE} ${trial} Your consultation allowance resets each paid billing cycle. You can cancel anytime from your account.`;
};

/** Shown on the card payment page above the Pay button. */
export const checkoutNote = (area: 'chat' | 'api', p: AutoPrices): string => [
  'Guidance only, not professional advice.',
  p.taxFeePercent > 0 ? `A flat ${p.taxFeePercent}% taxes & fees is added to the base price at checkout.` : '',
  'All sales are final — no refunds.',
  area === 'chat' ? 'Questions expire 3 months after purchase.' : 'API wallet balance expires 6 months after purchase.',
  autoNote(area, p),
].filter(Boolean).join(' ');
