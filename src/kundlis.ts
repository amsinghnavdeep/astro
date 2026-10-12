import type { D1Database } from '@cloudflare/workers-types';

export interface Kundli {
  id: string;
  user_id: string;
  full_name: string;
  is_newborn: number;
  gender: string;
  date_of_birth: string;
  time_of_birth: string;
  place_of_birth: string;
  timezone: string;
  latitude: number | null;
  longitude: number | null;
  created_at: string;
  updated_at: string;
}

export interface KundliInput {
  fullName: string;
  newborn: boolean;
  gender: string;
  dateOfBirth: string;
  timeOfBirth: string;
  placeOfBirth: string;
  timezone: string;
  latitude?: number;
  longitude?: number;
}

export const MAX_KUNDLIS = 20;

export const listKundlis = async (db: D1Database, userId: string): Promise<Kundli[]> =>
  (await db.prepare('SELECT * FROM kundlis WHERE user_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC').bind(userId).all<Kundli>()).results;

export const getKundli = (db: D1Database, userId: string, id: string): Promise<Kundli | null> =>
  db.prepare('SELECT * FROM kundlis WHERE id = ? AND user_id = ? AND deleted_at IS NULL').bind(id, userId).first<Kundli>();

export async function saveKundli(db: D1Database, userId: string, k: KundliInput, id?: string): Promise<Kundli | null> {
  const now = new Date().toISOString();
  const vals = [k.fullName, k.newborn ? 1 : 0, k.gender, k.dateOfBirth, k.timeOfBirth, k.placeOfBirth, k.timezone, k.latitude ?? null, k.longitude ?? null, now];
  if (id) {
    const r = await db.prepare(
      `UPDATE kundlis SET full_name = ?, is_newborn = ?, gender = ?, date_of_birth = ?, time_of_birth = ?, place_of_birth = ?,
        timezone = ?, latitude = ?, longitude = ?, updated_at = ? WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
    ).bind(...vals, id, userId).run();
    return (r.meta?.changes ?? 0) > 0 ? getKundli(db, userId, id) : null;
  }
  const newId = crypto.randomUUID();
  await db.prepare(
    `INSERT INTO kundlis (full_name, is_newborn, gender, date_of_birth, time_of_birth, place_of_birth, timezone, latitude, longitude, updated_at, id, user_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(...vals, newId, userId, now).run();
  return getKundli(db, userId, newId);
}

export const deleteKundli = async (db: D1Database, userId: string, id: string): Promise<boolean> =>
  ((await db.prepare('UPDATE kundlis SET deleted_at = ? WHERE id = ? AND user_id = ? AND deleted_at IS NULL')
    .bind(new Date().toISOString(), id, userId).run()).meta?.changes ?? 0) > 0;

export const kundliInput = (k: Kundli): KundliInput => ({
  fullName: k.full_name, newborn: !!k.is_newborn, gender: k.gender, dateOfBirth: k.date_of_birth, timeOfBirth: k.time_of_birth,
  placeOfBirth: k.place_of_birth, timezone: k.timezone, latitude: k.latitude ?? undefined, longitude: k.longitude ?? undefined,
});

export const publicKundli = (k: Kundli) => ({
  id: k.id, fullName: k.full_name, newborn: !!k.is_newborn, gender: k.gender, dateOfBirth: k.date_of_birth, timeOfBirth: k.time_of_birth,
  placeOfBirth: k.place_of_birth, timezone: k.timezone, latitude: k.latitude, longitude: k.longitude,
});
