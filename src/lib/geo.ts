const EUROZONE = new Set([
  'AT',
  'BE',
  'CY',
  'DE',
  'EE',
  'ES',
  'FI',
  'FR',
  'GR',
  'IE',
  'IT',
  'LT',
  'LU',
  'LV',
  'MT',
  'NL',
  'PT',
  'SI',
  'SK',
  'HR',
]);

const DIRECT: Record<string, string> = {
  IN: 'inr',
  US: 'usd',
  GB: 'gbp',
  AU: 'aud',
  CA: 'cad',
};

export function countryToCurrency(country?: string): string {
  const code = country?.trim().toUpperCase();
  if (!code) return '';
  if (Object.prototype.hasOwnProperty.call(DIRECT, code)) {
    return DIRECT[code];
  }
  if (EUROZONE.has(code)) {
    return 'eur';
  }
  return '';
}

export function detectCountry(
  request: Request,
  runtime?: { cf?: unknown } | undefined,
): string | undefined {
  const country = runtime && typeof runtime === 'object' && 'cf' in runtime
    ? (runtime.cf as { country?: unknown } | undefined)?.country
    : undefined;

  return typeof country === 'string' && country.length > 0
    ? country
    : request.headers.get('cf-ipcountry') ?? undefined;
}
