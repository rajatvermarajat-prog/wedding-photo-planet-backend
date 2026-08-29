import { Prisma, ProjectStatus, ProjectType, TaskStatus } from '@prisma/client';
import { prisma } from '../config/prisma';
import { andWhere, findScoped, paginate, searchFilter } from '../repositories/base.repository';
import { resolveSort } from '../utils/pagination';
import { nextDocumentNumber } from '../utils/documentNumber';
import { badRequest, conflict, notFound } from '../utils/errors';
import { dateRangeFilter } from '../utils/date';
import { AuthContext } from '../types';
import { AuditRequestContext, recordAudit } from './audit.service';

const SORTABLE = ['createdAt', 'weddingDate', 'name', 'projectNumber', 'totalQuotation'] as const;

/**
 * Legal status transitions. A project cannot jump from LEAD straight to
 * COMPLETED, and terminal states are terminal.
 */
const ALLOWED_TRANSITIONS: Record<ProjectStatus, ProjectStatus[]> = {
  LEAD: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['PLANNING', 'SHOOTING', 'CANCELLED'],
  PLANNING: ['SHOOTING', 'CANCELLED'],
  SHOOTING: ['EDITING', 'CANCELLED'],
  EDITING: ['DELIVERY', 'CANCELLED'],
  DELIVERY: ['COMPLETED', 'EDITING', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};

export interface ProjectListQuery {
  page?: number;
  limit?: number;
  search?: string;
  status?: ProjectStatus;
  type?: ProjectType;
  clientId?: string;
  managerId?: string;
  branchId?: string;
  from?: string;
  to?: string;
  sortBy?: string;
  sortOrder?: string;
}

export function listProjects(organizationId: string, query: ProjectListQuery) {
  const sort = resolveSort(query.sortBy, query.sortOrder, SORTABLE, 'createdAt');
  const weddingDate = dateRangeFilter(query.from, query.to);
  return paginate(prisma.project, {
    where: andWhere(
      { organizationId, deletedAt: null },
      query.status ? { status: query.status } : undefined,
      query.type ? { type: query.type } : undefined,
      query.clientId ? { clientId: query.clientId } : undefined,
      query.managerId ? { managerId: query.managerId } : undefined,
      query.branchId ? { branchId: query.branchId } : undefined,
      weddingDate ? { weddingDate } : undefined,
      searchFilter(query.search, ['name', 'projectNumber', 'venueName', 'venueCity']),
    ),
    orderBy: { [sort.field]: sort.direction },
    page: query.page,
    limit: query.limit,
    include: {
      client: { select: { id: true, clientCode: true, displayName: true, primaryPhone: true } },
      manager: { select: { id: true, fullName: true } },
      _count: { select: { events: true, shoots: true, tasks: true, deliveries: true } },
    },
  });
}

export function getProject(organizationId: string, id: string) {
  return findScoped(prisma.project, organizationId, id, 'Project', {
    include: {
      client: { include: { contacts: true, addresses: true } },
      manager: { select: { id: true, fullName: true, email: true } },
      createdBy: { select: { id: true, fullName: true } },
      branch: { select: { id: true, name: true, code: true } },
      events: { where: { deletedAt: null }, orderBy: { eventDate: 'asc' } },
      shoots: {
        where: { deletedAt: null },
        orderBy: { shootDate: 'asc' },
        include: {
          assignments: {
            include: {
              user: { select: { id: true, fullName: true } },
              freelancer: { select: { id: true, fullName: true, code: true } },
            },
          },
        },
      },
      deliveries: { where: { deletedAt: null }, orderBy: { expectedDate: 'asc' } },
      statusHistory: {
        orderBy: { createdAt: 'desc' },
        take: 25,
        include: { changedBy: { select: { id: true, fullName: true } } },
      },
    },
  });
}

export interface CreateProjectInput {
  clientId: string;
  leadId?: string;
  branchId?: string;
  name: string;
  type?: ProjectType;
  weddingDate?: Date;
  deliveryDueDate?: Date;
  venueName?: string;
  venueAddress?: string;
  venueCity?: string;
  totalQuotation?: Prisma.Decimal.Value;
  notes?: string;
  managerId?: string;
  events?: Array<{
    name: string;
    eventTypeId?: string;
    eventDate: Date;
    startTime?: Date;
    endTime?: Date;
    venueName?: string;
    address?: string;
    city?: string;
    notes?: string;
  }>;
  tasks?: Array<{
    title: string;
    quantity?: number;
    unit?: string;
    assigneeId?: string;
  }>;
}

/**
 * Project creation is one atomic unit (§34): number allocation, the project
 * row, its wedding events, the opening status-history entry and the audit
 * record either all land or none do.
 */
export async function createProject(
  auth: AuthContext,
  input: CreateProjectInput,
  ctx: AuditRequestContext,
) {
  return prisma.$transaction(async (tx) => {
    const client = await tx.client.findFirst({
      where: { id: input.clientId, organizationId: auth.organizationId, deletedAt: null },
      select: { id: true },
    });
    if (!client) throw notFound('Client');

    if (input.branchId) {
      const branch = await tx.branch.findFirst({
        where: { id: input.branchId, organizationId: auth.organizationId, deletedAt: null },
        select: { id: true },
      });
      if (!branch) throw notFound('Branch');
    }

    const projectNumber = await nextDocumentNumber(tx, auth.organizationId, 'PROJECT');

    const project = await tx.project.create({
      data: {
        organizationId: auth.organizationId,
        branchId: input.branchId,
        clientId: input.clientId,
        leadId: input.leadId,
        projectNumber,
        name: input.name,
        type: input.type ?? 'WEDDING',
        status: ProjectStatus.LEAD,
        weddingDate: input.weddingDate,
        deliveryDueDate: input.deliveryDueDate,
        venueName: input.venueName,
        venueAddress: input.venueAddress,
        venueCity: input.venueCity,
        totalQuotation: input.totalQuotation ?? 0,
        notes: input.notes,
        managerId: input.managerId,
        createdById: auth.userId,
        events: input.events?.length
          ? {
              createMany: {
                data: input.events.map((e) => ({
                  organizationId: auth.organizationId,
                  name: e.name,
                  eventTypeId: e.eventTypeId,
                  eventDate: e.eventDate,
                  startTime: e.startTime,
                  endTime: e.endTime,
                  venueName: e.venueName,
                  address: e.address,
                  city: e.city,
                  notes: e.notes,
                })),
              },
            }
          : undefined,
      },
      include: { events: true, client: { select: { displayName: true } } },
    });

    await tx.projectStatusHistory.create({
      data: {
        projectId: project.id,
        oldStatus: null,
        newStatus: ProjectStatus.LEAD,
        changedById: auth.userId,
        reason: 'Project created',
      },
    });

    const notified = new Set<string>();
    for (const item of input.tasks ?? []) {
      let assigneeId = item.assigneeId;
      if (assigneeId) {
        const assignee = await tx.user.findFirst({
          where: { id: assigneeId, organizationId: auth.organizationId, deletedAt: null },
          select: { id: true },
        });
        if (!assignee) assigneeId = undefined;
      }

      const task = await tx.task.create({
        data: {
          organizationId: auth.organizationId,
          projectId: project.id,
          clientId: input.clientId,
          title: item.title,
          quantity: item.quantity ?? 1,
          unit: item.unit,
          status: assigneeId ? TaskStatus.ASSIGNED : TaskStatus.TODO,
          assigneeId,
          createdById: auth.userId,
        },
      });

      if (!assigneeId) continue;
      await tx.taskAssignment.create({
        data: {
          taskId: task.id,
          fromUserId: null,
          toUserId: assigneeId,
          assignedById: auth.userId,
          reason: 'Assigned on project create',
        },
      });
      if (notified.has(assigneeId)) continue;
      notified.add(assigneeId);
      await tx.notification.create({
        data: {
          organizationId: auth.organizationId,
          userId: assigneeId,
          type: 'TASK_ASSIGNED',
          title: 'You were assigned to a project',
          message: `${project.name}: ${item.title}`,
          entityType: 'Project',
          entityId: project.id,
        },
      });
    }

    await recordAudit(tx, ctx, {
      action: 'CREATE',
      entityType: 'Project',
      entityId: project.id,
      summary: `Project ${project.projectNumber} created`,
      newData: project,
    });

    return project;
  });
}

export async function updateProject(
  auth: AuthContext,
  id: string,
  input: Partial<Omit<CreateProjectInput, 'events' | 'clientId'>>,
  ctx: AuditRequestContext,
) {
  return prisma.$transaction(async (tx) => {
    const existing = await findScoped<Record<string, unknown>>(
      tx.project,
      auth.organizationId,
      id,
      'Project',
    );

    const updated = await tx.project.update({
      where: { id },
      data: {
        name: input.name,
        type: input.type,
        weddingDate: input.weddingDate,
        deliveryDueDate: input.deliveryDueDate,
        venueName: input.venueName,
        venueAddress: input.venueAddress,
        venueCity: input.venueCity,
        totalQuotation: input.totalQuotation,
        notes: input.notes,
        managerId: input.managerId,
        branchId: input.branchId,
      },
    });

    await recordAudit(tx, ctx, {
      action: 'UPDATE',
      entityType: 'Project',
      entityId: id,
      summary: 'Project updated',
      oldData: existing,
      newData: updated,
    });

    return updated;
  });
}

export async function changeProjectStatus(
  auth: AuthContext,
  id: string,
  newStatus: ProjectStatus,
  reason: string | undefined,
  ctx: AuditRequestContext,
) {
  return prisma.$transaction(async (tx) => {
    const project = await findScoped<{ id: string; status: ProjectStatus; projectNumber: string }>(
      tx.project,
      auth.organizationId,
      id,
      'Project',
    );

    if (project.status === newStatus) {
      throw conflict(`Project is already ${newStatus}`);
    }
    if (!ALLOWED_TRANSITIONS[project.status].includes(newStatus)) {
      throw badRequest(
        `Cannot move a project from ${project.status} to ${newStatus}`,
        [{ field: 'status', message: `Allowed: ${ALLOWED_TRANSITIONS[project.status].join(', ') || 'none'}` }],
      );
    }

    const updated = await tx.project.update({
      where: { id },
      data: {
        status: newStatus,
        completedAt: newStatus === 'COMPLETED' ? new Date() : undefined,
        cancelledAt: newStatus === 'CANCELLED' ? new Date() : undefined,
      },
    });

    await tx.projectStatusHistory.create({
      data: {
        projectId: id,
        oldStatus: project.status,
        newStatus,
        changedById: auth.userId,
        reason,
      },
    });

    await recordAudit(tx, ctx, {
      action: 'STATUS_CHANGE',
      entityType: 'Project',
      entityId: id,
      summary: `Project ${project.projectNumber}: ${project.status} -> ${newStatus}`,
      oldData: { status: project.status },
      newData: { status: newStatus, reason },
    });

    return updated;
  });
}

export async function deleteProject(auth: AuthContext, id: string, ctx: AuditRequestContext) {
  return prisma.$transaction(async (tx) => {
    const project = await findScoped<{ id: string; projectNumber: string }>(
      tx.project,
      auth.organizationId,
      id,
      'Project',
    );

    const [payments, invoices] = await Promise.all([
      tx.payment.count({ where: { projectId: id, status: 'COMPLETED' } }),
      tx.invoice.count({ where: { projectId: id, status: { notIn: ['DRAFT', 'CANCELLED'] } } }),
    ]);
    if (payments > 0 || invoices > 0) {
      // Financial history must remain reachable from its project.
      throw conflict(
        'This project has settled financial records and cannot be archived. Cancel it instead.',
      );
    }

    await tx.project.update({
      where: { id },
      data: { deletedAt: new Date(), deletedBy: auth.userId },
    });

    await recordAudit(tx, ctx, {
      action: 'SOFT_DELETE',
      entityType: 'Project',
      entityId: id,
      summary: `Project ${project.projectNumber} archived`,
      oldData: project,
    });
  });
}

export function getProjectStatusHistory(organizationId: string, projectId: string) {
  return prisma.projectStatusHistory.findMany({
    where: { project: { id: projectId, organizationId } },
    orderBy: { createdAt: 'desc' },
    include: { changedBy: { select: { id: true, fullName: true } } },
  });
}
