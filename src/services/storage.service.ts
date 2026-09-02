import crypto from 'crypto';
import path from 'path';
import { StorageProvider } from '@prisma/client';
import { env } from '../config/env';

export interface SignedUrl {
  url: string;
  expiresAt: Date;
  provider: StorageProvider;
}

/**
 * Storage abstraction. PostgreSQL only ever holds metadata — the binary lives
 * with the provider (§22), and clients receive short-lived signed URLs rather
 * than a permanent public link.
 *
 * S3, Cloudflare R2 and Supabase Storage are all S3-compatible, so wiring any
 * of them up means implementing `presign` below with the provider SDK; the
 * database shape and every caller stay unchanged.
 */
export function getStorageProvider(): StorageProvider {
  return env.STORAGE_PROVIDER as StorageProvider;
}

/** Deterministic, collision-resistant object key. Never trusts the client name. */
export function buildObjectKey(
  organizationId: string,
  entityType: string,
  originalName: string,
): string {
  const safeName = originalName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80);
  const stamp = new Date().toISOString().slice(0, 10);
  return `${organizationId}/${entityType.toLowerCase()}/${stamp}/${crypto.randomUUID()}-${safeName}`;
}

export function createSignedUrl(objectKey: string, bucket: string): SignedUrl {
  const expiresAt = new Date(Date.now() + env.SIGNED_URL_TTL_SECONDS * 1000);
  const provider = getStorageProvider();

  if (provider === 'LOCAL' || provider === 'DATABASE') {
    // LOCAL and DATABASE both expose a short-lived backend URL. LOCAL reads
    // the development filesystem; DATABASE reads the FileObject bytea column.
    const expires = Math.floor(expiresAt.getTime() / 1000);
    const signature = crypto
      .createHmac('sha256', env.JWT_SECRET)
      .update(`${bucket}/${objectKey}:${expires}`)
      .digest('hex');
    const base = env.STORAGE_PUBLIC_BASE_URL || `http://localhost:${env.PORT}/files`;
    return {
      url: `${base}/${objectKey}?expires=${expires}&signature=${signature}`,
      expiresAt,
      provider,
    };
  }

  // S3 / R2 / Supabase are not used by this deployment.
  const base =
    env.STORAGE_PUBLIC_BASE_URL ||
    env.STORAGE_ENDPOINT ||
    `https://${bucket}.s3.${env.STORAGE_REGION ?? 'ap-south-1'}.amazonaws.com`;
  return { url: `${base}/${objectKey}`, expiresAt, provider };
}

/** Validates the short-lived URLs used by the local development storage driver. */
export function verifyLocalSignedUrl(bucket: string, objectKey: string, expiresValue: unknown, signatureValue: unknown): boolean {
  const expires = typeof expiresValue === 'string' ? Number(expiresValue) : NaN;
  const signature = typeof signatureValue === 'string' ? signatureValue : '';
  if (!Number.isInteger(expires) || expires < Math.floor(Date.now() / 1000) || !/^[a-f0-9]{64}$/i.test(signature)) return false;
  const expected = crypto.createHmac('sha256', env.JWT_SECRET).update(`${bucket}/${objectKey}:${expires}`).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(signature, 'hex'));
}

/** Keeps LOCAL uploads inside the backend working directory and prevents path traversal. */
export function localObjectPath(objectKey: string): string | null {
  const root = path.resolve(process.cwd(), '.local-storage');
  const target = path.resolve(root, objectKey);
  return target.startsWith(`${root}${path.sep}`) ? target : null;
}
