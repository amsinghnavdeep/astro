/**
 * Minimal server-side client for the Devin REST API.
 *
 * Docs: https://docs.devin.ai/api-reference/overview
 *
 * Only the backend ever holds DEVIN_API_KEY. The browser never talks to Devin.
 */
import { env } from './env';

export interface BirthDetails {
  fullName: string;
  dateOfBirth: string; // e.g. "30 Jan 2000"
  timeOfBirth: string; // e.g. "11:30 AM"
  placeOfBirth: string; // "City, State, Country"
  questions?: string[];
  email: string;
}

export interface DevinSession {
  session_id: string;
  url?: string;
  status_enum?: string;
  structured_output?: Record<string, unknown> | null;
  status?: string;
}

async function devinFetch<T>(path: string, init: RequestInit): Promise<T> {
  const res = await fetch(`${env.devin.apiBase}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.devin.apiKey}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Devin API ${res.status} on ${path}: ${body}`);
  }
  return (await res.json()) as T;
}

/** Build the prompt that drives the first-time Kundli playbook. */
function buildKundliPrompt(d: BirthDetails): string {
  const questions =
    d.questions && d.questions.length
      ? `\nSpecific questions to answer:\n${d.questions.map((q, i) => `${i + 1}. ${q}`).join('\n')}`
      : '';
  return [
    'Generate a full Vedic (Hindu) Janma Kundli birth-chart report for the following person.',
    `Full name: ${d.fullName}`,
    `Date of birth: ${d.dateOfBirth}`,
    `Time of birth: ${d.timeOfBirth}`,
    `Place of birth: ${d.placeOfBirth}`,
    questions,
    '',
    'Keep the confirmed birth details available in this session so future follow-up',
    'questions can reuse or recompute the chart. Deliver the PDF and interactive HTML.',
  ].join('\n');
}

/** Create the first-time Kundli session. Returns the created session. */
export async function createKundliSession(d: BirthDetails): Promise<DevinSession> {
  const body: Record<string, unknown> = { prompt: buildKundliPrompt(d) };
  if (env.devin.kundliPlaybook) body.playbook_id = env.devin.kundliPlaybook;
  return devinFetch<DevinSession>('/sessions', {
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
  await devinFetch(`/session/${sessionId}/message`, {
    method: 'POST',
    body: JSON.stringify({ message: prompt }),
  });
}

/** Fetch the current state of a session. */
export async function getSession(sessionId: string): Promise<DevinSession> {
  return devinFetch<DevinSession>(`/session/${sessionId}`, { method: 'GET' });
}
