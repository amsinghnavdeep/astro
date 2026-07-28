export const prerender = false;
import type { APIRoute } from 'astro';
import {
  clearSessionCookieHeader,
  destroySession,
  sessionCookieValue,
} from '../../../lib/auth';

export const POST: APIRoute = async ({ request, locals }) => {
  const db = locals.runtime.env.SIDDH_DB;
  if (db) {
    try {
      await destroySession(db, sessionCookieValue(request));
    } catch {
      // Clearing the browser cookie is still safe if D1 is temporarily unavailable.
    }
  }
  return new Response(JSON.stringify({ ok: true }), {
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': clearSessionCookieHeader(),
    },
  });
};
