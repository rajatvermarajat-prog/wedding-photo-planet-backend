import { FileVisibility } from '@prisma/client';
import { Prisma, prisma } from '../config/prisma';
import { andWhere, paginate, searchFilter } from '../repositories/base.repository';
import { notFound } from '../utils/errors';
import { AuthContext } from '../types';
import { AuditRequestContext, recordAudit } from './audit.service';
import { buildObjectKey, createSignedUrl, getStorageProvider } from './storage.service';
import { env } from '../config/env';

export function listFiles(
  organizationId: string,
  query: {
    page?: number;
    limit?: number;
    entityType?: string;
    entityId?: string;
    projectId?: string;
    search?: string;
  },
) {
  return paginate(prisma.fileObject, {
    where: andWhere(
      { organizationId, deletedAt: null },
      query.entityType ? { entityType: query.entityType } : undefined,
      query.entityId ? { entityId: query.entityId } : undefined,
      query.projectId ? { projectId: query.projectId } : undefined,
      searchFilter(query.search, ['originalName']),
    ),
    orderBy: { createdAt: 'desc' },
    page: query.page,
    limit: query.limit,
    include: { uploadedBy: { select: { id: true, fullName: true } } },
  });
}

/**
 * Issues the object key and a short-lived upload URL. The client PUTs the
 * bytes straight to the storage provider, then calls `registerFile` — the API
 * process never proxies file content.
 */
export function createUploadIntent(
  auth: AuthContext,
  input: { entityType: string; originalName: string; mimeType: string },
) {
  const objectKey = buildObjectKey(auth.organizationId, input.entityType, input.originalName);
  const bucket = env.STORAGE_BUCKET;
  const signed = createSignedUrl(objectKey, bucket);

  return {
    bucket,
    objectKey,
    provider: getStorageProvider(),
    uploadUrl: signed.url,
    expiresAt: signed.expiresAt,
    requiredHeaders: { 'content-type': input.mimeType },
  };
}

export interface RegisterFileInput {
  entityType: string;
  entityId?: string;
  projectId?: string;
  bucket: string;
  objectKey: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  checksum?: string;
  visibility?: FileVisibility;
  metadata?: Record<string, unknown>;
}

export async function registerFile(
  auth: AuthContext,
  input: RegisterFileInput,
  ctx: AuditRequestContext,
) {
  const file = await prisma.fileObject.create({
    data: {
      organizationId: auth.organizationId,
      uploadedById: auth.userId,
      entityType: input.entityType,
      entityId: input.entityId,
      projectId: input.projectId,
      storageProvider: getStorageProvider(),
      bucket: input.bucket,
      objectKey: input.objectKey,
      originalName: input.originalName,
      mimeType: input.mimeType,
      sizeBytes: BigInt(input.sizeBytes),
      checksum: input.checksum,
      visibility: input.visibility ?? FileVisibility.PRIVATE,
      metadata: input.metadata as Prisma.InputJsonValue | undefined,
    },
  });

  await recordAudit(prisma, ctx, {
    action: 'CREATE',
    entityType: 'FileObject',
    entityId: file.id,
    summary: `File ${file.originalName} registered`,
    newData: { objectKey: file.objectKey, sizeBytes: input.sizeBytes },
  });

  return file;
}

export async function getDownloadUrl(organizationId: string, id: string) {
  const file = await prisma.fileObject.findFirst({
    where: { id, organizationId, deletedAt: null },
  });
  if (!file) throw notFound('File');

  const signed = createSignedUrl(file.objectKey, file.bucket);
  return {
    id: file.id,
    originalName: file.originalName,
    mimeType: file.mimeType,
    sizeBytes: file.sizeBytes.toString(),
    downloadUrl: signed.url,
    expiresAt: signed.expiresAt,
  };
}

export async function deleteFile(auth: AuthContext, id: string, ctx: AuditRequestContext) {
  const file = await prisma.fileObject.findFirst({
    where: { id, organizationId: auth.organizationId, deletedAt: null },
  });
  if (!file) throw notFound('File');

  await prisma.fileObject.update({
    where: { id },
    data: { deletedAt: new Date(), deletedBy: auth.userId },
  });

  await recordAudit(prisma, ctx, {
    action: 'SOFT_DELETE',
    entityType: 'FileObject',
    entityId: id,
    summary: `File ${file.originalName} removed`,
    oldData: { objectKey: file.objectKey },
  });
}
