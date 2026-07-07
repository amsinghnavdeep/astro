import { Resend } from 'resend';
import { env } from './env';

let client: Resend | null = null;

function resend(): Resend {
  if (!client) client = new Resend(env.email.apiKey);
  return client;
}

interface SendArgs {
  to: string;
  subject: string;
  html: string;
  attachments?: { filename: string; content: Buffer }[];
}

export async function sendEmail({ to, subject, html, attachments }: SendArgs): Promise<void> {
  await resend().emails.send({
    from: env.email.from,
    to,
    subject,
    html,
    attachments: attachments?.map((a) => ({
      filename: a.filename,
      content: a.content,
    })),
  });
}

/** Email delivered to a first-time customer with their reference. */
export function kundliDeliveryHtml(fullName: string, reference: string): string {
  return `
  <div style="font-family:system-ui,sans-serif;max-width:560px;margin:auto">
    <h2 style="color:#b8860b">Your Janma Kundli from Siddh Jyotish is ready 🪔</h2>
    <p>Namaste ${escapeHtml(fullName)},</p>
    <p>Your full Vedic birth-chart report is attached as a PDF.</p>
    <p><b>Keep this reference safe.</b> You'll need it to purchase precise
    follow-up answers later without paying for a full chart again:</p>
    <pre style="background:#faf5e6;border:1px solid #e6d9a8;padding:14px;border-radius:8px;
    word-break:break-all;white-space:pre-wrap;font-size:13px">${escapeHtml(reference)}</pre>
    <p style="color:#666;font-size:13px">This reference is encrypted and unique to you.</p>
    <p style="color:#8a7a3a;font-size:13px;margin-top:18px">🪔 Siddh Jyotish — precise, honest Vedic astrology from a living lineage of Jyotish scholars.</p>
  </div>`;
}

/** Email delivered to a returning customer with follow-up answers. */
export function followupAnswersHtml(answers: string): string {
  return `
  <div style="font-family:system-ui,sans-serif;max-width:560px;margin:auto">
    <h2 style="color:#b8860b">Your follow-up answers from Siddh Jyotish 🔮</h2>
    <div style="white-space:pre-wrap;line-height:1.6">${escapeHtml(answers)}</div>
    <p style="color:#8a7a3a;font-size:13px;margin-top:18px">🪔 Siddh Jyotish — precise, honest Vedic astrology from a living lineage of Jyotish scholars.</p>
  </div>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
