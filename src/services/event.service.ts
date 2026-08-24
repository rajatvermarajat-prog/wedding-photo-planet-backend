import { EventStatus, Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { andWhere, findScoped, paginate, searchFilter } from '../repositories/base.repository';
import { resolveSort } from '../utils/pagination';
import { notFound } from '../utils/errors';
import { dateRangeFilter } from '../utils/date';
import { AuthContext } from '../types';
import { AuditRequestContext, recordAudit } from './audit.service';

const SORTABLE = ['eventDate', 'createdAt', 'name'] as const;

export interface EventListQuery {
  page?: number;
  limit?: number;
  search?: string;
  projectId?: string;
  status?: EventStatus;
  eventTypeId?: string;
  from?: string;
  to?: string;
  sortBy?: string;
  sortOrder?: string;
}

export function listEvents(organizationId: string, query: EventListQuery) {
  const sort = resolveSort(query.sortBy, query.sortOrder, SORTABLE, 'eventDate');
  const eventDate = dateRangeFilter(query.from, query.to);
  return paginate(prisma.event, {
    where: andWhere(
      { organizationId, deletedAt: null },
      query.projectId ? { projectId: query.projectId } : undefined,
      query.status ? { status: query.status } : undefined,
      query.eventTypeId ? { eventTypeId: query.eventTypeId } : undefined,
      eventDate ? { eventDate } : undefined,
      searchFilter(query.search, ['name', 'venueName', 'city']),
    ),
    orderBy: { [sort.field]: sort.direction },
    page: query.page,
    limit: query.limit,
    include: {
      eventType: { select: { id: true, name: true, colorHex: true } },
      project: { select: { id: true, projectNumber: true, name: true } },
      _count: { select: { shoots: true } },
    },
  });
}

export function getEvent(organizationId: string, id: string) {
  return findScoped(prisma.event, organizationId, id, 'Event', {
    include: {
      eventType: true,
      project: { select: { id: true, projectNumber: true, name: true, clientId: true } },
      shoots: { where: { deletedAt: null }, orderBy: { shootDate: 'asc' } },
    },
  });
}

export interface CreateEventInput {
  projectId: string;
  eventTypeId?: string;
  name: string;
  eventDate: Date;
  startTime?: Date;
  endTime?: Date;
  venueName?: string;
  address?: string;
  city?: string;
  latitude?: Prisma.Decimal.Value;
  longitude?: Prisma.Decimal.Value;
  guestCount?: number;
  notes?: string;
}

export async function createEvent(auth: AuthContext, input: CreateEventInput, ctx: AuditRequestContext) {
  return prisma.$transaction(async (tx) => {
    const project = await tx.project.findFirst({
      where: { id: input.projectId, organizationId: auth.organizationId, deletedAt: null },
      select: { id: true },
    });
    if (!project) throw notFound('Project');

    const event = await tx.event.create({
      data: { organizationId: auth.organizationId, ...input },
    });

    await recordAudit(tx, ctx, {
      action: 'CREATE',
      entityType: 'Event',
      entityId: event.id,
      summary: `Event ${event.name} created`,
      newData: event,
    });

    return event;
  });
}

export async function updateEvent(
  auth: AuthContext,
  id: string,
  input: Partial<Omit<CreateEventInput, 'projectId'>> & { status?: EventStatus },
  ctx: AuditRequestContext,
) {
  return prisma.$transaction(async (tx) => {
    const existing = await findScoped<Record<string, unknown>>(
      tx.event,
      auth.organizationId,
      id,
      'Event',
    );
    const updated = await tx.event.update({ where: { id }, data: input });
    await recordAudit(tx, ctx, {
      action: 'UPDATE',
      entityType: 'Event',
      entityId: id,
      summary: 'Event updated',
      oldData: existing,
      newData: updated,
    });
    return updated;
  });
}

export async function deleteEvent(auth: AuthContext, id: string, ctx: AuditRequestContext) {
  return prisma.$transaction(async (tx) => {
    const event = await findScoped<{ id: string; name: string }>(
      tx.event,
      auth.organizationId,
      id,
      'Event',
    );
    await tx.event.update({
      where: { id },
      data: { deletedAt: new Date(), deletedBy: auth.userId },
    });
    await recordAudit(tx, ctx, {
      action: 'SOFT_DELETE',
      entityType: 'Event',
      entityId: id,
      summary: `Event ${event.name} archived`,
      oldData: event,
    });
  });
}

export function listEventTypes(organizationId: string) {
  return prisma.eventType.findMany({
    where: { organizationId, isActive: true },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  });
}

export function createEventType(
  organizationId: string,
  input: { name: string; colorHex?: string; sortOrder?: number },
) {
  return prisma.eventType.create({ data: { organizationId, ...input } });
}
