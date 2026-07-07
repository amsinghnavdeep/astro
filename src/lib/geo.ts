const ASIA = new Set([
  'AF',
  'AM',
  'AZ',
  'BD',
  'BT',
  'BN',
  'KH',
  'CN',
  'HK',
  'IN',
  'ID',
  'JP',
  'KZ',
  'KG',
  'LA',
  'MO',
  'MY',
  'MV',
  'MN',
  'MM',
  'NP',
  'KP',
  'KR',
  'PK',
  'PH',
  'SG',
  'LK',
  'TW',
  'TJ',
  'TH',
  'TM',
  'UZ',
  'VN',
]);

const EUROPE = new Set([
  'AL',
  'AD',
  'AT',
  'BA',
  'BE',
  'BG',
  'BY',
  'CH',
  'CY',
  'CZ',
  'DE',
  'DK',
  'EE',
  'ES',
  'FI',
  'FO',
  'FR',
  'GB',
  'GE',
  'GI',
  'GR',
  'HR',
  'HU',
  'IE',
  'IS',
  'IT',
  'LI',
  'LT',
  'LU',
  'LV',
  'MC',
  'MD',
  'ME',
  'MK',
  'MT',
  'NL',
  'NO',
  'PL',
  'PT',
  'RO',
  'RS',
  'RU',
  'SE',
  'SI',
  'SK',
  'SM',
  'TR',
  'UA',
  'VA',
  'XK',
]);

export function countryToCurrency(country?: string): string {
  const code = country?.trim().toUpperCase();
  if (!code) return '';
  if (ASIA.has(code)) {
    return 'inr';
  }
  if (EUROPE.has(code)) {
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
