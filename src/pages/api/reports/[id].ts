export const prerender = false;
import type { APIRoute } from 'astro';
import { findOrderById } from '../../../lib/auth';
import { getReportPdf } from '../../../lib/reports';

export const GET: APIRoute = async ({ params, locals }) => {
  const orderId = params.id;
  const user = locals.user;
  const db = locals.runtime.env.SIDDH_DB;
  if (!orderId || !user || !db) return new Response('Not found', { status: 404 });

  const order = await findOrderById(db, orderId);
  if (!order || order.user_id !== user.id) return new Response('Not found', { status: 404 });
  if (!order.pdf_key) return new Response('Report not ready', { status: 404 });

  const bucket = locals.runtime.env.SIDDH_PDF;
  if (!bucket) return new Response('Report storage is not configured', { status: 503 });
  const report = await getReportPdf(bucket, order.pdf_key);
  if (!report?.body) return new Response('Report not found', { status: 404 });

  return new Response(report.body as unknown as BodyInit, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="siddh-jyotish-${encodeURIComponent(order.id)}.pdf"`,
      ...(report.size
        ? { 'Content-Length': String(report.size) }
        : {}),
    },
  });
};
