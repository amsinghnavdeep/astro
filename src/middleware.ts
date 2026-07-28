import { defineMiddleware } from 'astro:middleware';
import { sessionCookieValue, validateSession } from './lib/auth';

export const onRequest = defineMiddleware(async ({ request, locals }, next) => {
  locals.user = null;
  const db = locals.runtime?.env?.SIDDH_DB;
  if (db) {
    try {
      locals.user = await validateSession(db, sessionCookieValue(request));
    } catch {
      locals.user = null;
    }
  }
  return next();
});
