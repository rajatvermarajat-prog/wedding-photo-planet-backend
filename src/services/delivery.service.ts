import { DeliveryStatus, DeliveryType } from '@prisma/client';
import { prisma } from '../config/prisma';
import { andWhere, findScoped, paginate, searchFilter } from '../repositories/base.repository';
import { resolveSort } from '../utils/pagination';
import { conflict, notFound } from '../utils/errors';
import { dateRangeFilter, toDateOnly } from '../utils/date';
import { AuthContext } from '../types';
import { AuditRequestContext, recordAudit } from './audit.service';

const SORTABLE = ['expectedDate', 'createdAt', 'status', 'title'] as const;

/** REWORK is reachable from DELIVERED so a client revision reopens the item. */
const ALLOWED_TRANSITIONS: Record<DeliveryStatus, DeliveryStatus[]> = {
  PENDING: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['READY', 'REWORK', 'CANCELLED'],
  READY: ['DELIVERED', 'REWORK', 'CANCELLED'],
  DELIVERED: ['REWORK'],
  REWORK: ['IN_PROGRESS', 'READY', 'CANCELLED'],
  CANCELLED: [],
};

export function listDeliveries(
  organizationId: string,
  query: {
    page?: number;
    limit?: number;
    search?: string;
    projectId?: string;
    clientId?: string;
    status?: DeliveryStatus;
    type?: DeliveryType;
    assigneeId?: string;
    overdue?: boolean;
    from?: string;
    to?: string;
    sortBy?: string;
    sortOrder?: string;
  },
) {
  const sort = resolveSort(query.sortBy, query.sortOrder, SORTABLE, 'expectedDate');
  const expectedDate = dateRangeFilter(query.from, query.to);
  return paginate(prisma.delivery, {
    where: andWhere(
      { organizationId, deletedAt: null },
      query.projectId ? { projectId: query.projectId } : undefined,
      query.clientId ? { clientId: query.clientId } : undefined,
      query.status ? { status: query.status } : undefined,
      query.type ? { type: query.type } : undefined,
      query.assigneeId ? { assigneeId: query.assigneeId } : undefined,
      query.overdue
        ? {
            expectedDate: { lt: new Date() },
            status: { notIn: ['DELIVERED', 'CANCELLED'] },
          }
        : undefined,
      expectedDate ? { expectedDate } : undefined,
      searchFilter(query.search, ['title', 'notes']),
    ),
    orderBy: { [sort.field]: sort.direction },
    page: query.page,
    limit: query.limit,
    include: {
      project: { select: { id: true, projectNumber: true, name: true } },
      assignee: { select: { id: true, fullName: true } },
      _count: { select: { items: true } },
    },
  });
}

export function getDelivery(organizationId: string, id: string) {
  return findScoped(prisma.delivery, organizationId, id, 'Delivery', {
    include: {
      project: { select: { id: true, projectNumber: true, name: true } },
      client: { select: { id: true, displayName: true } },
      event: { select: { id: true, name: true } },
      assignee: { select: { id: true, fullName: true } },
      items: { orderBy: { createdAt: 'asc' } },
      statusHistory: {
        orderBy: { createdAt: 'desc' },
        include: { changedBy: { select: { id: true, fullName: true } } },
      },
    },
  });
}

export interface CreateDeliveryInput {
  projectId: string;
  clientId?: string;
  eventId?: string;
  title: string;
  type?: DeliveryType;
  expectedDate?: string;
  assigneeId?: string;
  deliveryUrl?: string;
  notes?: string;
  items?: Array<{ name: string; description?: string; quantity?: number; unit?: string }>;
}

export async function createDelivery(
  auth: AuthContext,
  input: CreateDeliveryInput,
  ctx: AuditRequestContext,
) {
  return prisma.$transaction(async (tx) => {
    const project = await tx.project.findFirst({
      where: { id: input.projectId, organizationId: auth.organizationId, deletedAt: null },
      select: { id: true, clientId: true },
    });
    if (!project) throw notFound('Project');

    const delivery = await tx.delivery.create({
      data: {
        organizationId: auth.organizationId,
        projectId: input.projectId,
        clientId: input.clientId ?? project.clientId,
        eventId: input.eventId,
        title: input.title,
        type: input.type ?? 'OTHER',
        expectedDate: input.expectedDate ? toDateOnly(input.expectedDate) : null,
        assigneeId: input.assigneeId,
        deliveryUrl: input.deliveryUrl,
        notes: input.notes,
        items: input.items?.length ? { createMany: { data: input.items } } : undefined,
      },
      include: { items: true },
    });

    await tx.deliveryStatusHistory.create({
      data: {
        deliveryId: delivery.id,
        oldStatus: null,
        newStatus: DeliveryStatus.PENDING,
        changedById: auth.userId,
        reason: 'Delivery created',
      },
    });

    await recordAudit(tx, ctx, {
      action: 'CREATE',
      entityType: 'Delivery',
      entityId: delivery.id,
      summary: `Delivery "${delivery.title}" created`,
      newData: delivery,
    });

    return delivery;
  });
}

export async function updateDelivery(
  auth: AuthContext,
  id: string,
  input: Partial<Omit<CreateDeliveryInput, 'projectId' | 'items'>>,
  ctx: AuditRequestContext,
) {
  return prisma.$transaction(async (tx) => {
    const existing = await findScoped<Record<string, unknown>>(
      tx.delivery,
      auth.organizationId,
      id,
      'Delivery',
    );
    const updated = await tx.delivery.update({
      where: { id },
      data: {
        ...input,
        expectedDate: input.expectedDate ? toDateOnly(input.expectedDate) : undefined,
      },
    });
    await recordAudit(tx, ctx, {
      action: 'UPDATE',
      entityType: 'Delivery',
      entityId: id,
      summary: 'Delivery updated',
      oldData: existing,
      newData: updated,
    });
    return updated;
  });
}

export async function changeDeliveryStatus(
  auth: AuthContext,
  id: string,
  status: DeliveryStatus,
  reason: string | undefined,
  ctx: AuditRequestContext,
) {
  return prisma.$transaction(async (tx) => {
    const delivery = await findScoped<{
      id: string;
      status: DeliveryStatus;
      title: string;
      clientId: string | null;
      projectId: string;
    }>(tx.delivery, auth.organizationId, id, 'Delivery');

    if (delivery.status === status) throw conflict(`Delivery is already ${status}`);
    if (!ALLOWED_TRANSITIONS[delivery.status].includes(status)) {
      throw conflict(
        `Cannot move a delivery from ${delivery.status} to ${status}. Allowed: ${
          ALLOWED_TRANSITIONS[delivery.status].join(', ') || 'none'
        }`,
      );
    }

    const updated = await tx.delivery.update({
      where: { id },
      data: {
        status,
        deliveredDate: status === 'DELIVERED' ? new Date() : undefined,
      },
    });

    await tx.deliveryStatusHistory.create({
      data: {
        deliveryId: id,
        oldStatus: delivery.status,
        newStatus: status,
        changedById: auth.userId,
        reason,
      },
    });

    await recordAudit(tx, ctx, {
      action: 'STATUS_CHANGE',
      entityType: 'Delivery',
      entityId: id,
      summary: `Delivery "${delivery.title}": ${delivery.status} -> ${status}`,
      oldData: { status: delivery.status },
      newData: { status, reason },
    });

    return updated;
  });
}

export async function deleteDelivery(auth: AuthContext, id: string, ctx: AuditRequestContext) {
  return prisma.$transaction(async (tx) => {
    const delivery = await findScoped<{ id: string; status: DeliveryStatus; title: string }>(
      tx.delivery,
      auth.organizationId,
      id,
      'Delivery',
    );
    if (delivery.status === 'DELIVERED') {
      throw conflict('A delivered item cannot be archived');
    }
    await tx.delivery.update({
      where: { id },
      data: { deletedAt: new Date(), deletedBy: auth.userId },
    });
    await recordAudit(tx, ctx, {
      action: 'SOFT_DELETE',
      entityType: 'Delivery',
      entityId: id,
      summary: `Delivery "${delivery.title}" archived`,
      oldData: delivery,
    });
  });
}
