export function formatMoney(cents: number, currency: string): string {
  const cur = currency.toUpperCase();
  const fractionDigits =
    new Intl.NumberFormat('en', { style: 'currency', currency: cur }).resolvedOptions()
      .maximumFractionDigits ?? 2;
  const major = cents / 10 ** fractionDigits;
  const s = new Intl.NumberFormat('en', {
    style: 'currency',
    currency: cur,
    currencyDisplay: 'narrowSymbol',
  }).format(major);
  return s.replace(/\.00$/, '');
}
