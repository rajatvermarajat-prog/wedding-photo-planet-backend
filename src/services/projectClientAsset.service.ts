import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { notFound } from '../utils/errors';
import { AuthContext } from '../types';
import { AuditRequestContext, recordAudit } from './audit.service';
import { createUploadIntent, deleteFile, registerFile } from './file.service';
import { createSignedUrl } from './storage.service';

const ENTITY_TYPE = 'PROJECT_CLIENT_ASSET';

async function requireProject(organizationId: string, projectId: string) {
  const project = await prisma.project.findFirst({ where: { id: projectId, organizationId, deletedAt: null }, select: { id: true } });
  if (!project) throw notFound('Project');
  return project;
}

export async function getProjectClientAssets(organizationId: string, projectId: string) {
  await requireProject(organizationId, projectId);
  return prisma.fileObject.findMany({
    where: { organizationId, projectId, entityType: ENTITY_TYPE, deletedAt: null },
    orderBy: { createdAt: 'desc' },
    include: { uploadedBy: { select: { id: true, fullName: true } } },
  });
}

export async function createProjectClientAssetUploadIntent(auth: AuthContext, projectId: string, input: { originalName: string; mimeType: string }) {
  await requireProject(auth.organizationId, projectId);
  return createUploadIntent(auth, { ...input, entityType: ENTITY_TYPE });
}

export async function createProjectClientAsset(auth: AuthContext, projectId: string, input: { bucket: string; objectKey: string; originalName: string; mimeType: string; sizeBytes: number; category?: string; title?: string; notes?: string }, ctx: AuditRequestContext) {
  await requireProject(auth.organizationId, projectId);
  return registerFile(auth, {
    entityType: ENTITY_TYPE, projectId, bucket: input.bucket, objectKey: input.objectKey,
    originalName: input.originalName, mimeType: input.mimeType, sizeBytes: input.sizeBytes,
    metadata: { category: input.category || 'Client asset', title: input.title || input.originalName, notes: input.notes || undefined },
  }, ctx);
}

export async function updateProjectClientAsset(auth: AuthContext, projectId: string, assetId: string, input: { category?: string; title?: string; notes?: string }, ctx: AuditRequestContext) {
  await requireProject(auth.organizationId, projectId);
  const asset = await prisma.fileObject.findFirst({ where: { id: assetId, organizationId: auth.organizationId, projectId, entityType: ENTITY_TYPE, deletedAt: null } });
  if (!asset) throw notFound('Client asset');
  const metadata = { ...((asset.metadata as Record<string, unknown> | null) ?? {}), ...input };
  const updated = await prisma.fileObject.update({ where: { id: assetId }, data: { metadata: metadata as Prisma.InputJsonValue } });
  await recordAudit(prisma, ctx, { action: 'UPDATE', entityType: 'ProjectClientAsset', entityId: assetId, summary: `Client asset ${asset.originalName} updated`, oldData: asset.metadata ?? undefined, newData: metadata });
  return updated;
}

export async function deleteProjectClientAsset(auth: AuthContext, projectId: string, assetId: string, ctx: AuditRequestContext) {
  await requireProject(auth.organizationId, projectId);
  const asset = await prisma.fileObject.findFirst({ where: { id: assetId, organizationId: auth.organizationId, projectId, entityType: ENTITY_TYPE, deletedAt: null } });
  if (!asset) throw notFound('Client asset');
  await deleteFile(auth, assetId, ctx);
}

export async function getProjectClientAssetDownloadUrl(organizationId: string, projectId: string, assetId: string) {
  await requireProject(organizationId, projectId);
  const asset = await prisma.fileObject.findFirst({ where: { id: assetId, organizationId, projectId, entityType: ENTITY_TYPE, deletedAt: null } });
  if (!asset) throw notFound('Client asset');
  return { id: asset.id, originalName: asset.originalName, downloadUrl: createSignedUrl(asset.objectKey, asset.bucket).url };
}
