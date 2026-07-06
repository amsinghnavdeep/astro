/**
 * Admin dump endpoint — list Kundli sessions in a date range, with their
 * generated PDF/HTML attachment URLs.
 *
 * GET /api/admin/sessions?from=2026-07-01&to=2026-07-06[&all=1][&attachments=0]
 *
 * Auth: send the admin token either as `Authorization: Bearer <ADMIN_API_TOKEN>`
 * or `x-admin-token: <ADMIN_API_TOKEN>`. Never exposed to the browser.
 *
 * `from`/`to` are inclusive dates (YYYY-MM-DD, UTC). Omit both to get everything.
 * By default only sessions from the `!kundli` playbook are returned; pass `all=1`
 * to include every session. Attachment URLs are fetched per session unless
 * `attachments=0`.
 */
export const prerender = false;
import type { APIRoute } from 'astro';
import { env } from '../../../lib/env';
import { listAllSessions, getAttachments } from '../../../lib/devin';

function unauthorized(): Response {
  return json({ error: 'Unauthorized' }, 401);
}

function parseDate(value: string | null, endOfDay: boolean): number | null {
  if (!value) return null;
  const ms = Date.parse(endOfDay ? `${value}T23:59:59.999Z` : `${value}T00:00:00.000Z`);
  return Number.isNaN(ms) ? null : Math.floor(ms / 1000);
}

export const GET: APIRoute = async ({ request }) => {
  const url = new URL(request.url);

  // --- auth ---
  const auth = request.headers.get('authorization') ?? '';
  const bearer = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
  const token = request.headers.get('x-admin-token') ?? bearer;
  if (!token || token !== env.admin.apiToken) return unauthorized();

  // --- params ---
  const from = parseDate(url.searchParams.get('from'), false);
  const to = parseDate(url.searchParams.get('to'), true);
  if (url.searchParams.get('from') && from === null) {
    return json({ error: 'Invalid `from` date (use YYYY-MM-DD)' }, 400);
  }
  if (url.searchParams.get('to') && to === null) {
    return json({ error: 'Invalid `to` date (use YYYY-MM-DD)' }, 400);
  }
  const includeAll = url.searchParams.get('all') === '1';
  const withAttachments = url.searchParams.get('attachments') !== '0';

  try {
    const all = await listAllSessions();
    const kundliPlaybook = env.devin.kundliPlaybook;

    const filtered = all.filter((s) => {
      const ts = s.created_at ?? 0;
      if (from !== null && ts < from) return false;
      if (to !== null && ts > to) return false;
      if (!includeAll && kundliPlaybook && s.playbook_id !== kundliPlaybook) return false;
      return true;
    });

    const rows = await Promise.all(
      filtered.map(async (s) => {
        const base = {
          session_id: s.session_id,
          url: s.url,
          title: s.title,
          status: s.status,
          playbook_id: s.playbook_id ?? null,
          created_at: s.created_at,
          created_at_iso: s.created_at ? new Date(s.created_at * 1000).toISOString() : null,
          acus_consumed: s.acus_consumed ?? 0,
        };
        if (!withAttachments) return base;
        try {
          const atts = await getAttachments(s.session_id);
          return {
            ...base,
            attachments: atts.map((a) => ({
              name: a.name,
              url: a.url,
              content_type: a.content_type,
            })),
          };
        } catch {
          return { ...base, attachments: [] };
        }
      }),
    );

    return json(
      {
        count: rows.length,
        from: url.searchParams.get('from') ?? null,
        to: url.searchParams.get('to') ?? null,
        sessions: rows,
      },
      200,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return json({ error: `Failed to list sessions: ${message}` }, 502);
  }
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
