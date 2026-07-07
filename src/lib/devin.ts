/**
 * Minimal server-side client for the Devin REST API (v3, org-scoped).
 *
 * Docs: https://docs.devin.ai/api-reference/overview
 *
 * We use the v3 organization endpoints because service-user API keys
 * (prefix `cog_`) authenticate against v3, not the legacy v1 routes:
 *   - create:  POST /v3/organizations/{org}/sessions
 *   - message: POST /v3/organizations/{org}/sessions/{devin_id}/messages
 *   - get:     GET  /v3/organizations/{org}/sessions/{devin_id}
 *
 * Only the backend ever holds DEVIN_API_KEY. The browser never talks to Devin.
 */
import { env } from './env';

/** v3 session/message endpoints expect the `devin-` prefixed id. */
function devinId(sessionId: string): string {
  return sessionId.startsWith('devin-') ? sessionId : `devin-${sessionId}`;
}

function sessionsBase(): string {
  return `${env.devin.apiBase}/v3/organizations/${env.devin.orgId}/sessions`;
}

export interface BirthDetails {
  fullName: string;
  gender: 'Male' | 'Female' | 'Other';
  dateOfBirth: string; // e.g. "30 Jan 2000"
  timeOfBirth: string; // e.g. "11:30 AM"
  placeOfBirth: string; // "City, State, Country"
  questions?: string[];
  email: string;
  /** Display name of the astrologer this report is attributed to. */
  pandit?: string;
}

export interface DevinSession {
  session_id: string;
  url?: string;
  status_enum?: string;
  structured_output?: Record<string, unknown> | null;
  status?: string;
}

async function devinFetch<T>(fullUrl: string, init: RequestInit): Promise<T> {
  const res = await fetch(fullUrl, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.devin.apiKey}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Devin API ${res.status} on ${fullUrl}: ${body}`);
  }
  return (await res.json()) as T;
}

/** Build the prompt that drives the first-time Kundli playbook. */
function buildKundliPrompt(d: BirthDetails): string {
  const questions =
    d.questions && d.questions.length
      ? `\nSpecific questions to answer:\n${d.questions.map((q, i) => `${i + 1}. ${q}`).join('\n')}`
      : '';
  const pandit = d.pandit ?? 'our senior astrologer';
  return [
    'Generate a full Vedic (Hindu) Janma Kundli birth-chart report for the following person.',
    'These details are complete and confirmed — proceed automatically without waiting for a reply.',
    `Full name: ${d.fullName}`,
    `Gender: ${d.gender}`,
    `Date of birth: ${d.dateOfBirth}`,
    `Time of birth: ${d.timeOfBirth}`,
    `Place of birth: ${d.placeOfBirth}`,
    `Customer email: ${d.email}`,
    `Assigned Pandit (astrologer): ${pandit}`,
    questions,
    '',
    'Use gendered language consistent with the stated gender.',
    'Keep the confirmed birth details available in this session so future follow-up',
    'questions can reuse or recompute the chart. Produce the PDF and interactive HTML,',
    'then attach both files to this session.',
    '',
    `You will receive the customer's encrypted reference number in a follow-up message.`,
    `When the report is ready, send EXACTLY ONE email to ${d.email}, framed as personally`,
    `from ${pandit}, containing that reference number prominently and the Kundli_Report.pdf`,
    'attached, using the RESEND_API_KEY secret (per the playbook). Do not send more than one email.',
  ].join('\n');
}

/** Create the first-time Kundli session. Returns the created session. */
export async function createKundliSession(d: BirthDetails): Promise<DevinSession> {
  const body: Record<string, unknown> = {
    prompt: buildKundliPrompt(d),
    title: `Kundli — ${d.fullName}`,
  };
  if (env.devin.kundliPlaybook) body.playbook_id = env.devin.kundliPlaybook;
  return devinFetch<DevinSession>(sessionsBase(), {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/** Resume an existing session to answer follow-up questions (no new PDF). */
export async function askFollowup(
  sessionId: string,
  questions: string[],
): Promise<void> {
  const prompt = [
    'Follow-up request from a returning customer using the kundli_followup playbook.',
    'Reuse the already-computed chart from this session (recompute from the same birth',
    'details only if a value is missing). Do NOT produce a new PDF or HTML.',
    'Answer ONLY these questions, precisely, with dasha/transit timing:',
    ...questions.map((q, i) => `${i + 1}. ${q}`),
  ].join('\n');
  await devinFetch(`${sessionsBase()}/${devinId(sessionId)}/messages`, {
    method: 'POST',
    body: JSON.stringify({ message: prompt }),
  });
}

/**
 * Give the running Kundli session the customer's reference number and the
 * single-email delivery instruction (framed as from the assigned Pandit).
 */
export async function instructKundliDelivery(
  sessionId: string,
  opts: { reference: string; pandit: string; email: string; fullName: string },
): Promise<void> {
  const message = [
    'Delivery instruction for this customer:',
    `Customer: ${opts.fullName} <${opts.email}>`,
    `Assigned Pandit: ${opts.pandit}`,
    `Reference number (their receipt to buy follow-up questions later): ${opts.reference}`,
    '',
    `When the report is ready, send EXACTLY ONE email to ${opts.email}, framed as personally`,
    `from ${opts.pandit}, with subject "Your Janma Kundli from ${opts.pandit} at Siddh Jyotish". The email body`,
    'must prominently include the reference number above, and the Kundli_Report.pdf must be',
    'attached. Send via Resend using the RESEND_API_KEY secret. Do not send more than one email.',
  ].join('\n');
  await devinFetch(`${sessionsBase()}/${devinId(sessionId)}/messages`, {
    method: 'POST',
    body: JSON.stringify({ message }),
  });
}

/** Fetch the current state of a session. */
export async function getSession(sessionId: string): Promise<DevinSession> {
  return devinFetch<DevinSession>(`${sessionsBase()}/${devinId(sessionId)}`, {
    method: 'GET',
  });
}

export interface SessionListItem {
  session_id: string;
  url?: string;
  title?: string;
  status?: string;
  playbook_id?: string | null;
  created_at?: number; // unix seconds
  updated_at?: number;
  acus_consumed?: number;
  is_archived?: boolean;
}

interface SessionsPage {
  items: SessionListItem[];
  end_cursor: string | null;
  has_next_page: boolean;
  total?: number;
}

/**
 * List every session in the org, following pagination. The v3 list endpoint
 * returns newest-first pages of up to `pageSize`; we walk `end_cursor` until
 * `has_next_page` is false (bounded by `maxPages` for safety).
 */
export async function listAllSessions(
  pageSize = 100,
  maxPages = 50,
): Promise<SessionListItem[]> {
  const out: SessionListItem[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < maxPages; i++) {
    const qs = new URLSearchParams({ limit: String(pageSize) });
    if (cursor) qs.set('after', cursor);
    const page = await devinFetch<SessionsPage>(`${sessionsBase()}?${qs}`, {
      method: 'GET',
    });
    out.push(...(page.items ?? []));
    if (!page.has_next_page || !page.end_cursor) break;
    cursor = page.end_cursor;
  }
  return out;
}

export interface SessionAttachment {
  attachment_id: string;
  name: string;
  url: string;
  content_type?: string;
  source?: string;
}

/** List a session's attachments (e.g. the generated PDF / HTML). */
export async function getAttachments(
  sessionId: string,
): Promise<SessionAttachment[]> {
  return devinFetch<SessionAttachment[]>(
    `${sessionsBase()}/${devinId(sessionId)}/attachments`,
    { method: 'GET' },
  );
}
