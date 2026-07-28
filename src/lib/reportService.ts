import { env } from './env';

export interface GeneratePerson {
  fullName: string;
  gender: string;
  dateOfBirth: string;
  timeOfBirth: string;
  placeOfBirth: string;
  latitude: number;
  longitude: number;
  timezone: string;
  timezoneOffset?: string;
}

export interface GeneratePayload {
  orderId: string;
  serviceType: string;
  person: GeneratePerson;
  partner: GeneratePerson | null;
  questions: string[];
  extras: Record<string, unknown>;
  pandit: {
    name: string;
    referenceNumber: string;
    customerEmail: string;
  };
  dryRun: boolean;
}

const REQUEST_TIMEOUT_MS = 300_000;

export async function generateReport(
  payload: GeneratePayload,
): Promise<{ ok: boolean; status: number; idempotent?: boolean }> {
  if (!env.reportService.url) {
    throw new Error('KUNDLI_SERVICE_URL is not configured');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${env.reportService.url}/generate`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.reportService.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (response.status === 409) {
      return { ok: false, status: response.status, idempotent: true };
    }
    if (!response.ok) {
      throw new Error(`Report service returned HTTP ${response.status}`);
    }

    const result: unknown = await response.json();
    const idempotent =
      result && typeof result === 'object' && 'idempotent' in result
        ? Boolean(result.idempotent)
        : undefined;
    return { ok: true, status: response.status, idempotent };
  } finally {
    clearTimeout(timeout);
  }
}
