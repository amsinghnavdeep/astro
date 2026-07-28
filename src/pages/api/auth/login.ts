export const prerender = false;
import type { APIRoute } from 'astro';
import {
  allowAuthAttempt,
  createSession,
  findUserByEmail,
  readFormOrJson,
  requestIp,
  setSessionCookieHeader,
  verifyPassword,
} from '../../../lib/auth';
import { z } from 'zod';

const loginSchema = z.object({
  email: z.string().trim().email().max(200),
  password: z.string().min(1).max(200),
});

export const POST: APIRoute = async ({ request, locals }) => {
  let payload: Record<string, unknown>;
  try {
    payload = await readFormOrJson(request);
  } catch {
    return json({ error: 'Invalid request.' }, 400);
  }
  const parsed = loginSchema.safeParse(payload);
  if (!parsed.success) return json({ error: 'Invalid email or password.' }, 401);

  const email = parsed.data.email.toLowerCase();
  if (!(await allowAuthAttempt(locals.runtime.env.SIDDH_KV, `${requestIp(request)}:${email}`))) {
    return json({ error: 'Too many attempts. Please try again later.' }, 429);
  }
  const db = locals.runtime.env.SIDDH_DB;
  if (!db) return json({ error: 'Invalid email or password.' }, 401);

  const user = await findUserByEmail(db, email);
  const valid = user
    ? await verifyPassword(parsed.data.password, user.password_hash, user.password_salt)
    : false;
  if (!user || !valid) return json({ error: 'Invalid email or password.' }, 401);

  try {
    const cookie = await createSession(db, user.id);
    return json({ ok: true }, 200, setSessionCookieHeader(cookie));
  } catch {
    return json({ error: 'Unable to sign in right now.' }, 500);
  }
};

function json(body: unknown, status = 200, cookie?: string): Response {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (cookie) headers.append('Set-Cookie', cookie);
  return new Response(JSON.stringify(body), { status, headers });
}
