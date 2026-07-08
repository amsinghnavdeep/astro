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

/** The v3 API expects the `playbook-` prefixed id; tolerate a bare uuid in config. */
function playbookId(id: string): string {
  return id.startsWith('playbook-') ? id : `playbook-${id}`;
}

export interface BirthDetails {
  fullName: string;
  gender: 'Male' | 'Female' | 'Other';
  dateOfBirth: string; // e.g. "30 Jan 2000"
  timeOfBirth: string; // e.g. "11:30 AM"
  placeOfBirth: string; // "City, State, Country"
  /** IANA timezone of the birthplace (e.g. "Asia/Kolkata"), used for UT conversion. */
  timezone?: string;
  questions?: string[];
  email: string;
  /** Display name of the astrologer this report is attributed to. */
  pandit?: string;
  /**
   * Pre-computed chart analysis (positions, Lagna, dasha, D-9, doshas) rendered
   * as a labelled text block. When present, the playbook uses these figures
   * verbatim instead of computing the ephemeris itself.
   */
  precomputedChart?: string;
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

function isInitializingError(err: unknown): boolean {
  return (
    err instanceof Error &&
    err.message.includes('Devin API 400') &&
    err.message.toLowerCase().includes('still initializing')
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function postSessionMessage(
  sessionId: string,
  message: string,
  opts: { retryOnInitializing?: boolean } = {},
): Promise<void> {
  const url = `${sessionsBase()}/${devinId(sessionId)}/messages`;
  const attempts = opts.retryOnInitializing ? 8 : 1;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await devinFetch(url, {
        method: 'POST',
        body: JSON.stringify({ message }),
      });
      return;
    } catch (err) {
      if (!opts.retryOnInitializing || !isInitializingError(err) || attempt === attempts) {
        throw err;
      }
      await delay(8000);
    }
  }
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
    ...(d.timezone
      ? [`Birthplace timezone (IANA): ${d.timezone} — the customer confirmed this is the timezone in effect at the birthplace on the birth date; use it for the local-time-to-UT conversion (still apply the correct historical DST/offset for that date).`]
      : []),
    `Customer email: ${d.email}`,
    `Assigned Pandit (astrologer): ${pandit}`,
    questions,
    '',
    'Use gendered language consistent with the stated gender.',
    'Keep the confirmed birth details available in this session so future follow-up',
    'questions can reuse the chart. Produce the branded PDF report (Kundli_Report.pdf)',
    'and attach it to this session.',
    '',
    ...(d.precomputedChart
      ? [
          'The birth chart has ALREADY been computed for you with high precision.',
          'Use these figures verbatim as the factual basis of the entire reading —',
          'do NOT install an ephemeris or recompute planetary positions. Your job is',
          'the interpretation, predictions, remedies, PDF and email; the raw analysis',
          'below is authoritative:',
          '',
          '----- BEGIN PRECOMPUTED CHART -----',
          d.precomputedChart,
          '----- END PRECOMPUTED CHART -----',
          '',
        ]
      : []),
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
  if (env.devin.kundliPlaybook) body.playbook_id = playbookId(env.devin.kundliPlaybook);
  return devinFetch<DevinSession>(sessionsBase(), {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/**
 * Resume an existing session to answer follow-up questions (no new PDF).
 *
 * NOTE: The Devin v3 message API does not accept a playbook_id, so we cannot
 * attach DEVIN_FOLLOWUP_PLAYBOOK here. The session keeps its original !kundli
 * playbook context, and the prompt itself instructs the agent to behave as a
 * follow-up handler. If the API adds playbook-on-resume support, pass
 * env.devin.followupPlaybook in the request body.
 */
export async function askFollowup(
  sessionId: string,
  questions: string[],
): Promise<void> {
  const prompt = [
    'Follow-up request from a returning customer.',
    'Reuse the already-computed chart from this session (recompute from the same birth',
    'details only if a value is missing). Do NOT produce a new PDF or HTML.',
    'Answer ONLY these questions, precisely, with dasha/transit timing:',
    ...questions.map((q, i) => `${i + 1}. ${q}`),
  ].join('\n');
  await postSessionMessage(sessionId, prompt);
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
    `Reference number (their key to ask the Pandit follow-up questions at https://siddhjyotish.com/returning): ${opts.reference}`,
    '',
    `When the report is ready, send EXACTLY ONE email to ${opts.email}, framed as personally`,
    `from ${opts.pandit}, with subject "Your Janma Kundli from ${opts.pandit} at Siddh Jyotish". The email body`,
    'must prominently include the reference number above, and the Kundli_Report.pdf must be',
    'attached. Send via Resend using the RESEND_API_KEY secret. Do not send more than one email.',
  ].join('\n');
  await postSessionMessage(sessionId, message, { retryOnInitializing: true });
}

/** Fetch the current state of a session. */
export async function getSession(sessionId: string): Promise<DevinSession> {
  return devinFetch<DevinSession>(`${sessionsBase()}/${devinId(sessionId)}`, {
    method: 'GET',
  });
}
