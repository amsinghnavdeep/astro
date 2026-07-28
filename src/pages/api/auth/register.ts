export const prerender = false;
import type { APIRoute } from 'astro';
import {
  allowAuthAttempt,
  createSession,
  createUser,
  hashPassword,
  newId,
  readFormOrJson,
  requestIp,
  setSessionCookieHeader,
  findUserByEmail,
} from '../../../lib/auth';
import { z } from 'zod';

const registerSchema = z.object({
  email: z.string().trim().email().max(200),
  password: z.string().min(8).max(200),
  fullName: z.string().trim().max(120).optional().or(z.literal('')),
});

export const POST: APIRoute = async ({ request, locals }) => {
  let payload: Record<string, unknown>;
  try {
    payload = await readFormOrJson(request);
  } catch {
    return json({ error: 'Invalid request.' }, 400);
  }
  const parsed = registerSchema.safeParse(payload);
  if (!parsed.success) return json({ error: 'Please enter a valid name, email, and password.' }, 400);

  const email = parsed.data.email.toLowerCase();
  if (!(await allowAuthAttempt(locals.runtime.env.SIDDH_KV, `${requestIp(request)}:${email}`))) {
    return json({ error: 'Too many attempts. Please try again later.' }, 429);
  }
  const db = locals.runtime.env.SIDDH_DB;
  if (!db) return json({ error: 'Accounts are not available right now.' }, 503);

  if (await findUserByEmail(db, email)) {
    return json({ error: 'An account with this email already exists.' }, 409);
  }

  try {
    const { hash, salt } = await hashPassword(parsed.data.password);
    await createUser(db, {
      id: newId(),
      email,
      passwordHash: hash,
      passwordSalt: salt,
      fullName: parsed.data.fullName || null,
      createdAt: new Date().toISOString(),
    });
    const user = await findUserByEmail(db, email);
    if (!user) return json({ error: 'Unable to create account.' }, 500);
    const cookie = await createSession(db, user.id);
    return json({ ok: true }, 200, setSessionCookieHeader(cookie));
  } catch {
    return json({ error: 'Unable to create account.' }, 500);
  }
};

function json(body: unknown, status = 200, cookie?: string): Response {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (cookie) headers.append('Set-Cookie', cookie);
  return new Response(JSON.stringify(body), { status, headers });
}
