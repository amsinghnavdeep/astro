/** Owner coupons: % off the next website chat purchase, or free chats added on redeem. Personal accounts only. */
import type { D1Database } from '@cloudflare/workers-types';
import { grantCredits } from './credits.js';

export type CouponKind = 'percent' | 'chats';
export interface Coupon {
  code: string; kind: CouponKind; value: number; max_uses: number | null; uses: number; expires_on: string | null;
  enabled: number; note: string | null; created_by: string; created_at: string;
}
export const CODE_RE = /^[A-Z0-9][A-Z0-9_-]{2,23}$/;
export const normCode = (s: string): string => s.trim().toUpperCase();
const today = (): string => new Date().toISOString().slice(0, 10);
const nowIso = (): string => new Date().toISOString();

export const listCoupons = async (db: D1Database): Promise<Coupon[]> =>
  (await db.prepare('SELECT * FROM coupons ORDER BY created_at DESC').all<Coupon>()).results;

export async function createCoupon(db: D1Database, c: { code: string; kind: CouponKind; value: number; maxUses: number | null; expiresOn: string | null; note: string | null }, by: string): Promise<string | null> {
  const r = await db.prepare(`INSERT INTO coupons (code, kind, value, max_uses, expires_on, note, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(code) DO NOTHING`)
    .bind(c.code, c.kind, c.value, c.maxUses, c.expiresOn, c.note, by, nowIso()).run();
  return r.meta?.changes ? null : 'That code already exists.';
}

export async function setCouponEnabled(db: D1Database, code: string, on: boolean): Promise<boolean> {
  return !!(await db.prepare('UPDATE coupons SET enabled = ? WHERE code = ?').bind(on ? 1 : 0, code).run()).meta?.changes;
}

export async function redeemCoupon(db: D1Database, user: { id: string; account_type?: string }, raw: string): Promise<{ ok: boolean; message: string }> {
  const code = normCode(raw);
  const c = CODE_RE.test(code) ? await db.prepare('SELECT * FROM coupons WHERE code = ?').bind(code).first<Coupon>() : null;
  if (!c || !c.enabled) return { ok: false, message: 'This code is not valid.' };
  if (c.expires_on && c.expires_on < today()) return { ok: false, message: 'This code has expired.' };
  if (user.account_type === 'business') return { ok: false, message: 'Codes are for personal accounts only.' };
  if (c.max_uses !== null && c.uses >= c.max_uses) return { ok: false, message: 'This code has been fully used.' };
  const ins = await db.prepare(`INSERT INTO coupon_redemptions (id, code, user_id, kind, value, status, created_at, used_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(code, user_id) DO NOTHING`)
    .bind(crypto.randomUUID(), code, user.id, c.kind, c.value, c.kind === 'chats' ? 'used' : 'active', nowIso(), c.kind === 'chats' ? nowIso() : null).run();
  if (!ins.meta?.changes) return { ok: false, message: 'You have already used this code.' };
  const up = await db.prepare('UPDATE coupons SET uses = uses + 1 WHERE code = ? AND (max_uses IS NULL OR uses < max_uses)').bind(code).run();
  if (!up.meta?.changes) {
    await db.prepare('DELETE FROM coupon_redemptions WHERE code = ? AND user_id = ?').bind(code, user.id).run();
    return { ok: false, message: 'This code has been fully used.' };
  }
  if (c.kind === 'chats') {
    await grantCredits(db, 'chat', user.id, c.value, `coupon:${code}:${user.id}`);
    return { ok: true, message: `Done. ${c.value} free ${c.value === 1 ? 'chat was' : 'chats were'} added to your account.` };
  }
  return { ok: true, message: `Done. ${c.value}% off your next purchase is ready and shows at checkout.` };
}

/** Best unused % code for this person, if still valid. */
export async function activeCoupon(db: D1Database, userId: string): Promise<{ code: string; percent: number; expiresOn: string | null } | null> {
  const r = await db.prepare(`SELECT r.code, r.value, c.expires_on FROM coupon_redemptions r JOIN coupons c ON c.code = r.code
    WHERE r.user_id = ? AND r.kind = 'percent' AND r.status = 'active' AND c.enabled = 1 AND (c.expires_on IS NULL OR c.expires_on >= ?)
    ORDER BY r.value DESC LIMIT 1`).bind(userId, today()).first<{ code: string; value: number; expires_on: string | null }>();
  return r ? { code: r.code, percent: r.value, expiresOn: r.expires_on } : null;
}

export async function useCoupon(db: D1Database, userId: string, code: string): Promise<void> {
  await db.prepare("UPDATE coupon_redemptions SET status = 'used', used_at = ? WHERE user_id = ? AND code = ? AND status = 'active'")
    .bind(nowIso(), userId, code).run();
}
