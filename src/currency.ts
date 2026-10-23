import type { D1Database } from '@cloudflare/workers-types';

export type Currency = 'usd' | 'inr';
export type CurrencyUser = { account_type?: string | null; currency?: Currency | null } | null;
type CurrencyContext = { req: { raw: Request; header: (name: string) => string | undefined } };

export function countryOf(c: CurrencyContext): string | null {
  const country = (c.req.raw as Request & { cf?: { country?: string } }).cf?.country;
  return country ?? c.req.header('cf-ipcountry') ?? null;
}

export function currencyFor(c: CurrencyContext, user: CurrencyUser): Currency {
  if (user?.account_type === 'business') return 'usd';
  if (user?.currency) return user.currency;
  return countryOf(c) === 'IN' ? 'inr' : 'usd';
}

export async function lockCurrency(db: D1Database, userId: string, currency: Currency): Promise<Currency> {
  await db.prepare('UPDATE users SET currency = COALESCE(currency, ?) WHERE id = ?').bind(currency, userId).run();
  const row = await db.prepare('SELECT currency FROM users WHERE id = ?').bind(userId).first<{ currency: Currency | null }>();
  return row?.currency ?? currency;
}
