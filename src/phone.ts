import { env } from './env.js';

const endpoint = (action: 'Verifications' | 'VerificationCheck') =>
  `https://verify.twilio.com/v2/Services/${encodeURIComponent(env.phone.verifySid!)}/${action}`;

const twilio = async (action: 'Verifications' | 'VerificationCheck', fields: Record<string, string>): Promise<{ status?: string }> => {
  const auth = btoa(`${env.phone.accountSid}:${env.phone.authToken}`);
  const response = await fetch(endpoint(action), {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(fields),
  });
  const body = await response.json().catch(() => ({})) as { status?: string; message?: string };
  if (!response.ok) throw new Error(body.message ?? `Twilio Verify returned ${response.status}`);
  return body;
};

export const validPhone = (phone: string): boolean => /^\+[1-9]\d{7,14}$/.test(phone);

export const startPhoneVerification = (phone: string): Promise<{ status?: string }> =>
  twilio('Verifications', { To: phone, Channel: 'sms' });

export const checkPhoneVerification = (phone: string, code: string): Promise<{ status?: string }> =>
  twilio('VerificationCheck', { To: phone, Code: code });
