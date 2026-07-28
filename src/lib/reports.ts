import type { R2Bucket, R2Object } from '@cloudflare/workers-types';

export function reportKey(orderId: string): string {
  return `reports/${encodeURIComponent(orderId)}.pdf`;
}

export async function putReportPdf(
  bucket: R2Bucket,
  key: string,
  bytes: Uint8Array,
): Promise<R2Object | null> {
  return bucket.put(key, bytes, {
    httpMetadata: { contentType: 'application/pdf' },
  });
}

export async function getReportPdf(
  bucket: R2Bucket,
  key: string,
): Promise<R2ObjectBody | null> {
  return bucket.get(key);
}

type R2ObjectBody = Awaited<ReturnType<R2Bucket['get']>>;
