export const prerender = false;
import type { APIRoute } from 'astro';

export const GET: APIRoute = ({ locals }) => {
  if (!locals.user) return json({ error: 'Authentication required.' }, 401);
  return json({ user: locals.user });
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
