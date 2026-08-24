import { Prisma, prisma } from '../config/prisma';
import { andWhere, paginate, searchFilter } from '../repositories/base.repository';
import { dateRangeFilter } from '../utils/date';
import { conflict, notFound } from '../utils/errors';
import { AuthContext } from '../types';
import { AuditRequestContext, recordAudit } from './audit.service';

// --- Organization ---------------------------------------------------------

export async function getOrganization(organizationId: string) {
  const org = await prisma.organization.findFirst({
    where: { id: organizationId, deletedAt: null },
    include: { branches: { where: { deletedAt: null }, orderBy: { name: 'asc' } } },
  });
  if (!org) throw notFound('Organization');
  return org;
}

export async function updateOrganization(
  auth: AuthContext,
  input: Record<string, unknown>,
  ctx: AuditRequestContext,
) {
  const before = await getOrganization(auth.organizationId);
  const updated = await prisma.organization.update({
    where: { id: auth.organizationId },
    data: input,
  });
  await recordAudit(prisma, ctx, {
    action: 'UPDATE',
    entityType: 'Organization',
    entityId: auth.organizationId,
    summary: 'Organization profile updated',
    oldData: before,
    newData: updated,
  });
  return updated;
}

// --- Branches -------------------------------------------------------------

export function listBranches(organizationId: string) {
  return prisma.branch.findMany({
    where: { organizationId, deletedAt: null },
    orderBy: [{ isHeadOffice: 'desc' }, { name: 'asc' }],
    include: { _count: { select: { users: true, projects: true } } },
  });
}

export async function createBranch(
  auth: AuthContext,
  input: { name: string; code: string; isHeadOffice?: boolean; [key: string]: unknown },
  ctx: AuditRequestContext,
) {
  const branch = await prisma.branch.create({
    data: { organizationId: auth.organizationId, ...input } as Prisma.BranchUncheckedCreateInput,
  });
  await recordAudit(prisma, ctx, {
    action: 'CREATE',
    entityType: 'Branch',
    entityId: branch.id,
    summary: `Branch ${branch.name} created`,
    newData: branch,
  });
  return branch;
}

export async function updateBranch(
  auth: AuthContext,
  id: string,
  input: Record<string, unknown>,
  ctx: AuditRequestContext,
) {
  const existing = await prisma.branch.findFirst({
    where: { id, organizationId: auth.organizationId, deletedAt: null },
  });
  if (!existing) throw notFound('Branch');
  const updated = await prisma.branch.update({ where: { id }, data: input });
  await recordAudit(prisma, ctx, {
    action: 'UPDATE',
    entityType: 'Branch',
    entityId: id,
    summary: 'Branch updated',
    oldData: existing,
    newData: updated,
  });
  return updated;
}

export async function deleteBranch(auth: AuthContext, id: string, ctx: AuditRequestContext) {
  const branch = await prisma.branch.findFirst({
    where: { id, organizationId: auth.organizationId, deletedAt: null },
    include: { _count: { select: { users: true, projects: true } } },
  });
  if (!branch) throw notFound('Branch');
  if (branch._count.users > 0 || branch._count.projects > 0) {
    throw conflict('This branch still has users or projects attached');
  }
  await prisma.branch.update({
    where: { id },
    data: { deletedAt: new Date(), deletedBy: auth.userId, isActive: false },
  });
  await recordAudit(prisma, ctx, {
    action: 'SOFT_DELETE',
    entityType: 'Branch',
    entityId: id,
    summary: `Branch ${branch.name} archived`,
    oldData: branch,
  });
}

// --- Notifications --------------------------------------------------------

export function listNotifications(
  userId: string,
  query: { page?: number; limit?: number; isRead?: boolean },
) {
  return paginate(prisma.notification, {
    where: andWhere({ userId }, query.isRead === undefined ? undefined : { isRead: query.isRead }),
    orderBy: { createdAt: 'desc' },
    page: query.page,
    limit: query.limit,
  });
}

export const countUnread = (userId: string) =>
  prisma.notification.count({ where: { userId, isRead: false } });

export async function markNotificationRead(userId: string, id: string) {
  const result = await prisma.notification.updateMany({
    where: { id, userId, isRead: false },
    data: { isRead: true, readAt: new Date() },
  });
  if (result.count === 0) {
    const exists = await prisma.notification.findFirst({ where: { id, userId } });
    if (!exists) throw notFound('Notification');
  }
  return { updated: result.count };
}

export async function markAllNotificationsRead(userId: string) {
  const result = await prisma.notification.updateMany({
    where: { userId, isRead: false },
    data: { isRead: true, readAt: new Date() },
  });
  return { updated: result.count };
}

// --- Audit log ------------------------------------------------------------

export function listAuditLogs(
  organizationId: string,
  query: {
    page?: number;
    limit?: number;
    entityType?: string;
    entityId?: string;
    actorId?: string;
    action?: Prisma.EnumAuditActionFilter['equals'];
    from?: string;
    to?: string;
    search?: string;
  },
) {
  const createdAt = dateRangeFilter(query.from, query.to);
  return paginate(prisma.auditLog, {
    where: andWhere(
      { organizationId },
      query.entityType ? { entityType: query.entityType } : undefined,
      query.entityId ? { entityId: query.entityId } : undefined,
      query.actorId ? { actorId: query.actorId } : undefined,
      query.action ? { action: query.action } : undefined,
      createdAt ? { createdAt } : undefined,
      searchFilter(query.search, ['summary']),
    ),
    orderBy: { createdAt: 'desc' },
    page: query.page,
    limit: query.limit,
    include: { actor: { select: { id: true, fullName: true, email: true } } },
  });
}

// --- Settings -------------------------------------------------------------

export function listSettings(organizationId: string) {
  return prisma.systemSetting.findMany({ where: { organizationId }, orderBy: { key: 'asc' } });
}

export async function upsertSetting(
  auth: AuthContext,
  key: string,
  value: Prisma.InputJsonValue,
  description: string | undefined,
  ctx: AuditRequestContext,
) {
  const existing = await prisma.systemSetting.findUnique({
    where: { organizationId_key: { organizationId: auth.organizationId, key } },
  });

  const setting = await prisma.systemSetting.upsert({
    where: { organizationId_key: { organizationId: auth.organizationId, key } },
    create: {
      organizationId: auth.organizationId,
      key,
      value,
      description,
      updatedById: auth.userId,
    },
    update: { value, description, updatedById: auth.userId },
  });

  await recordAudit(prisma, ctx, {
    action: existing ? 'UPDATE' : 'CREATE',
    entityType: 'SystemSetting',
    entityId: setting.id,
    summary: `Setting ${key} ${existing ? 'updated' : 'created'}`,
    oldData: existing?.value,
    newData: value,
  });

  return setting;
}
