/**
 * The "reference number" is the ONLY piece of state in the whole product.
 *
 * There is no database and there are no user accounts. Instead, the Devin
 * session id (which holds the fully-computed birth chart in its context) is
 * sealed into an authenticated, encrypted token and emailed to the customer.
 * When they return to buy follow-up questions, the backend decrypts the token
 * to recover the session id and resumes that exact session.
 *
 * Format:  v1.<base64url(iv)>.<base64url(ciphertext+authTag)>
 *
 * AES-256-GCM provides confidentiality AND integrity, so a reference cannot be
 * forged or mutated to read someone else's chart. The 96-bit random IV makes
 * each reference unique even for the same session id.
 */
import crypto from 'node:crypto';
import { env } from './env';

const VERSION = 'v1';
const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;

function getKey(): Buffer {
  const key = Buffer.from(env.referenceSecret, 'base64');
  if (key.length !== 32) {
    throw new Error(
      'REFERENCE_SECRET must decode to exactly 32 bytes (base64 of 32 random bytes).',
    );
  }
  return key;
}

function b64url(buf: Buffer): string {
  return buf.toString('base64url');
}

/** Encrypt a Devin session id into a shareable reference token. */
export function encodeReference(sessionId: string): string {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGO, getKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(sessionId, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  const payload = Buffer.concat([ciphertext, authTag]);
  return `${VERSION}.${b64url(iv)}.${b64url(payload)}`;
}

/** Decrypt a reference token back into its Devin session id. Throws if tampered/invalid. */
export function decodeReference(reference: string): string {
  const parts = reference.trim().split('.');
  if (parts.length !== 3 || parts[0] !== VERSION) {
    throw new Error('Malformed reference token.');
  }
  const iv = Buffer.from(parts[1], 'base64url');
  const payload = Buffer.from(parts[2], 'base64url');
  if (iv.length !== IV_BYTES || payload.length <= 16) {
    throw new Error('Malformed reference token.');
  }
  const authTag = payload.subarray(payload.length - 16);
  const ciphertext = payload.subarray(0, payload.length - 16);

  const decipher = crypto.createDecipheriv(ALGO, getKey(), iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);
  return plaintext.toString('utf8');
}
