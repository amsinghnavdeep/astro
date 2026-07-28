import type { D1Database, KVNamespace } from '@cloudflare/workers-types';

export interface AuthUser {
  id: string;
  email: string;
  fullName: string | null;
}

export interface UserRecord extends AuthUser {
  password_hash: string;
  password_salt: string;
  created_at: string;
}

export interface SessionUser extends AuthUser {}

export interface OrderRecord {
  id: string;
  user_id: string | null;
  email: string;
  kind: string;
  service_type: string | null;
  full_name: string | null;
  amount_total: number | null;
  currency: string | null;
  status: 'paid' | 'fulfilling' | 'delivered' | 'failed';
  pdf_key: string | null;
  reference_number: string | null;
  created_at: string;
}

const SESSION_COOKIE = 'sj_session';
const SESSION_MAX_AGE = 60 * 60 * 24 * 30;
const PBKDF2_ITERATIONS = 150_000;
const RATE_LIMIT = 10;
const RATE_WINDOW_SECONDS = 15 * 60;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer as ArrayBuffer;
}

async function digestSha256(value: Uint8Array | string): Promise<Uint8Array> {
  const input = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  return new Uint8Array(await crypto.subtle.digest('SHA-256', asArrayBuffer(input)));
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

export async function hashPassword(
  password: string,
): Promise<{ hash: string; salt: string }> {
  const salt = randomBytes(16);
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: asArrayBuffer(salt),
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    material,
    256,
  );
  return {
    hash: bytesToBase64(new Uint8Array(bits)),
    salt: bytesToBase64(salt),
  };
}

export async function verifyPassword(
  password: string,
  hash: string,
  salt: string,
): Promise<boolean> {
  const expected = base64ToBytes(hash);
  const saltBytes = base64ToBytes(salt);
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: asArrayBuffer(saltBytes),
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    material,
    256,
  );
  return constantTimeEqual(expected, new Uint8Array(bits));
}

function cookieValue(request: Request): string | null {
  const cookieHeader = request.headers.get('cookie') ?? '';
  for (const part of cookieHeader.split(';')) {
    const [name, ...value] = part.trim().split('=');
    if (name === SESSION_COOKIE) return value.join('=') || null;
  }
  return null;
}

function sessionCookie(value: string, maxAge = SESSION_MAX_AGE): string {
  return `${SESSION_COOKIE}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

export function setSessionCookieHeader(value: string): string {
  return sessionCookie(value);
}

export function clearSessionCookieHeader(): string {
  return sessionCookie('', 0);
}

export async function createSession(
  db: D1Database,
  userId: string,
): Promise<string> {
  const sessionId = bytesToBase64(randomBytes(16)).replaceAll('+', '-').replaceAll('/', '_');
  const rawToken = bytesToBase64(randomBytes(32)).replaceAll('+', '-').replaceAll('/', '_');
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_MAX_AGE * 1000);
  const tokenHash = bytesToBase64(await digestSha256(rawToken));

  await db
    .prepare(
      'INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)',
    )
    .bind(sessionId, userId, tokenHash, now.toISOString(), expires.toISOString())
    .run();

  return `${sessionId}.${rawToken}`;
}

export async function validateSession(
  db: D1Database,
  cookie: string | null,
): Promise<AuthUser | null> {
  if (!cookie) return null;
  const separator = cookie.indexOf('.');
  if (separator <= 0 || separator === cookie.length - 1) return null;
  const sessionId = cookie.slice(0, separator);
  const rawToken = cookie.slice(separator + 1);
  const row = await db
    .prepare(
      `SELECT u.id, u.email, u.full_name, s.token_hash, s.expires_at
       FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?`,
    )
    .bind(sessionId)
    .first<{
      id: string;
      email: string;
      full_name: string | null;
      token_hash: string;
      expires_at: string;
    }>();
  if (!row || new Date(row.expires_at).getTime() <= Date.now()) {
    if (row) {
      await db.prepare('DELETE FROM sessions WHERE id = ?').bind(sessionId).run();
    }
    return null;
  }

  const presentedHash = await digestSha256(rawToken);
  if (!constantTimeEqual(presentedHash, base64ToBytes(row.token_hash))) return null;
  return { id: row.id, email: row.email, fullName: row.full_name };
}

export async function destroySession(
  db: D1Database,
  cookie: string | null,
): Promise<void> {
  if (!cookie) return;
  const separator = cookie.indexOf('.');
  if (separator <= 0) return;
  await db
    .prepare('DELETE FROM sessions WHERE id = ?')
    .bind(cookie.slice(0, separator))
    .run();
}

export async function findUserByEmail(
  db: D1Database,
  email: string,
): Promise<UserRecord | null> {
  return db
    .prepare(
      'SELECT id, email, password_hash, password_salt, full_name, created_at FROM users WHERE email = ?',
    )
    .bind(email.toLowerCase())
    .first<UserRecord>();
}

export async function findUserById(
  db: D1Database,
  id: string,
): Promise<AuthUser | null> {
  return db
    .prepare('SELECT id, email, full_name AS fullName FROM users WHERE id = ?')
    .bind(id)
    .first<AuthUser>();
}

export async function createUser(
  db: D1Database,
  input: {
    id: string;
    email: string;
    passwordHash: string;
    passwordSalt: string;
    fullName: string | null;
    createdAt: string;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO users
       (id, email, password_hash, password_salt, full_name, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      input.id,
      input.email.toLowerCase(),
      input.passwordHash,
      input.passwordSalt,
      input.fullName,
      input.createdAt,
    )
    .run();
}

export async function upsertOrder(
  db: D1Database,
  order: OrderRecord,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO orders
       (id, user_id, email, kind, service_type, full_name, amount_total,
        currency, status, pdf_key, reference_number, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         user_id = excluded.user_id,
         email = excluded.email,
         kind = excluded.kind,
         service_type = excluded.service_type,
         full_name = excluded.full_name,
         amount_total = excluded.amount_total,
         currency = excluded.currency,
         status = excluded.status,
         pdf_key = COALESCE(excluded.pdf_key, orders.pdf_key),
         reference_number = COALESCE(excluded.reference_number, orders.reference_number),
         created_at = excluded.created_at`,
    )
    .bind(
      order.id,
      order.user_id,
      order.email.toLowerCase(),
      order.kind,
      order.service_type,
      order.full_name,
      order.amount_total,
      order.currency,
      order.status,
      order.pdf_key,
      order.reference_number,
      order.created_at,
    )
    .run();
}

export async function listOrdersByUserId(
  db: D1Database,
  userId: string,
): Promise<OrderRecord[]> {
  const result = await db
    .prepare('SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC')
    .bind(userId)
    .all<OrderRecord>();
  return result.results;
}

export async function listOrdersByEmail(
  db: D1Database,
  email: string,
): Promise<OrderRecord[]> {
  const result = await db
    .prepare('SELECT * FROM orders WHERE email = ? ORDER BY created_at DESC')
    .bind(email.toLowerCase())
    .all<OrderRecord>();
  return result.results;
}

export async function findOrderById(
  db: D1Database,
  id: string,
): Promise<OrderRecord | null> {
  return db.prepare('SELECT * FROM orders WHERE id = ?').bind(id).first<OrderRecord>();
}

export function sessionCookieValue(request: Request): string | null {
  return cookieValue(request);
}

export async function allowAuthAttempt(
  kv: KVNamespace | undefined,
  key: string,
): Promise<boolean> {
  if (!kv) return true;
  try {
    const storageKey = `auth-rate:${encodeURIComponent(key)}`;
    const current = await kv.get<{ count: number; resetAt: number }>(storageKey, 'json');
    const now = Date.now();
    if (!current || current.resetAt <= now) {
      await kv.put(
        storageKey,
        JSON.stringify({ count: 1, resetAt: now + RATE_WINDOW_SECONDS * 1000 }),
        { expirationTtl: RATE_WINDOW_SECONDS },
      );
      return true;
    }
    if (current.count >= RATE_LIMIT) return false;
    await kv.put(
      storageKey,
      JSON.stringify({ count: current.count + 1, resetAt: current.resetAt }),
      { expirationTtl: Math.max(1, Math.ceil((current.resetAt - now) / 1000)) },
    );
    return true;
  } catch {
    return true;
  }
}

export function requestIp(request: Request): string {
  return (
    request.headers.get('cf-connecting-ip') ??
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown'
  );
}

export function newId(): string {
  return crypto.randomUUID();
}

export async function readFormOrJson(request: Request): Promise<Record<string, unknown>> {
  const contentType = request.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    const body: unknown = await request.json();
    return body && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
  }
  const form = await request.formData();
  return Object.fromEntries(form.entries());
}
