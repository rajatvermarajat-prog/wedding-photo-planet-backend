import {
  CrewRole,
  Prisma,
  ProjectStatus,
  ProjectType,
  ShootStatus,
  ShootType,
  TaskCategory,
  TaskPriority,
  TaskStatus,
} from '@prisma/client';
import { prisma } from '../config/prisma';
import { andWhere, findScoped, paginate, searchFilter } from '../repositories/base.repository';
import { resolveSort } from '../utils/pagination';
import { nextDocumentNumber } from '../utils/documentNumber';
import { badRequest, conflict, forbidden, notFound } from '../utils/errors';
import { dateRangeFilter } from '../utils/date';
import { AuthContext } from '../types';
import { AuditRequestContext, recordAudit } from './audit.service';

const SORTABLE = ['createdAt', 'weddingDate', 'name', 'projectNumber', 'totalQuotation'] as const;

/**
 * Legal status transitions. A project cannot jump from LEAD straight to
 * COMPLETED, and terminal states are terminal.
 */
const ALLOWED_TRANSITIONS: Record<ProjectStatus, ProjectStatus[]> = {
  UPCOMING: ['CONFIRMED', 'CANCELLED'],
  LEAD: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['UPCOMING', 'PLANNING', 'SHOOTING', 'CANCELLED'],
  PLANNING: ['SHOOTING', 'CANCELLED'],
  SHOOTING: ['EDITING', 'CANCELLED'],
  EDITING: ['DELIVERY', 'CANCELLED'],
  DELIVERY: ['COMPLETED', 'EDITING', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};

const PROJECT_TASK_INCLUDE = {
  where: { deletedAt: null },
  orderBy: { createdAt: 'asc' as const },
  include: { assignee: { select: { id: true, fullName: true } } },
};

const PROJECT_SHOOT_INCLUDE = {
  where: { deletedAt: null },
  orderBy: { shootDate: 'asc' as const },
  include: {
    assignments: {
      include: {
        user: { select: { id: true, fullName: true, phone: true } },
        freelancer: { select: { id: true, fullName: true, code: true, phone: true } },
      },
    },
  },
};

const PROJECT_CREATE_INCLUDE = {
  client: { select: { id: true, clientCode: true, displayName: true, primaryPhone: true } },
  events: { where: { deletedAt: null }, orderBy: { eventDate: 'asc' as const } },
  shoots: PROJECT_SHOOT_INCLUDE,
  tasks: PROJECT_TASK_INCLUDE,
};

type Tx = Prisma.TransactionClient;

async function loadCreatedProject(tx: Tx, organizationId: string, projectId: string) {
  return findScoped<Record<string, unknown>>(tx.project, organizationId, projectId, 'Project', {
    include: PROJECT_CREATE_INCLUDE,
  });
}

function assertNestedCreatePermissions(auth: AuthContext, input: CreateProjectInput) {
  if (input.tasks?.length && !auth.permissions.has('TASK_CREATE')) {
    throw forbidden('TASK_CREATE permission is required to create project tasks.');
  }
  if (input.shoots?.length && !auth.permissions.has('SHOOT_CREATE')) {
    throw forbidden('SHOOT_CREATE permission is required to create project shoots.');
  }
  if (input.shoots?.some((shoot) => (shoot.crewAssignments || []).length > 0) && !auth.permissions.has('SHOOT_ASSIGN')) {
    throw forbidden('SHOOT_ASSIGN permission is required to assign project shoot crew.');
  }
}

async function resolveProjectClient(
  tx: Tx,
  auth: AuthContext,
  input: CreateProjectInput,
  ctx: AuditRequestContext,
): Promise<string> {
  if (input.clientId) {
    const client = await tx.client.findFirst({
      where: { id: input.clientId, organizationId: auth.organizationId, deletedAt: null },
      select: { id: true },
    });
    if (!client) throw notFound('Client');
    return client.id;
  }

  const pendingClient = input.client;
  if (!pendingClient) throw badRequest('Provide either clientId or client details.');

  const phoneMatch = await tx.client.findFirst({
    where: {
      organizationId: auth.organizationId,
      deletedAt: null,
      primaryPhone: pendingClient.primaryPhone,
    },
    select: { id: true },
  });
  if (phoneMatch) return phoneMatch.id;

  const nameMatch = await tx.client.findFirst({
    where: {
      organizationId: auth.organizationId,
      deletedAt: null,
      displayName: { equals: pendingClient.displayName, mode: 'insensitive' },
    },
    select: { id: true },
  });
  if (nameMatch) return nameMatch.id;

  if (!auth.permissions.has('CLIENT_CREATE')) {
    throw forbidden('CLIENT_CREATE permission is required to create a new client during project intake.');
  }

  const clientCode = await nextDocumentNumber(tx, auth.organizationId, 'CLIENT');
  const created = await tx.client.create({
    data: {
      organizationId: auth.organizationId,
      clientCode,
      displayName: pendingClient.displayName,
      primaryPhone: pendingClient.primaryPhone,
      primaryEmail: pendingClient.primaryEmail?.toLowerCase(),
    },
  });

  await recordAudit(tx, ctx, {
    action: 'CREATE',
    entityType: 'Client',
    entityId: created.id,
    summary: `Client ${clientCode} created during project intake`,
    newData: created,
  });

  return created.id;
}

async function createProjectTasks(
  tx: Tx,
  auth: AuthContext,
  projectId: string,
  projectName: string,
  clientId: string,
  tasks: NonNullable<CreateProjectInput['tasks']>,
) {
  const assigneeIds = [...new Set(tasks.map((task) => task.assigneeId).filter((value): value is string => Boolean(value)))];
  const validAssigneeIds = new Set<string>();
  if (assigneeIds.length > 0) {
    const users = await tx.user.findMany({
      where: { id: { in: assigneeIds }, organizationId: auth.organizationId, deletedAt: null },
      select: { id: true },
    });
    users.forEach((user) => validAssigneeIds.add(user.id));
  }

  const notified = new Set<string>();
  for (const item of tasks) {
    const assigneeId = item.assigneeId && validAssigneeIds.has(item.assigneeId) ? item.assigneeId : undefined;
    const requestedStatus = item.status ?? (assigneeId ? TaskStatus.ASSIGNED : TaskStatus.TODO);
    const status =
      requestedStatus === TaskStatus.TODO && assigneeId ? TaskStatus.ASSIGNED
        : requestedStatus === TaskStatus.ASSIGNED && !assigneeId ? TaskStatus.TODO
        : requestedStatus;

    const task = await tx.task.create({
      data: {
        organizationId: auth.organizationId,
        projectId,
        clientId,
        title: item.title,
        description: item.description,
        category: item.category ?? TaskCategory.OTHER,
        priority: item.priority ?? TaskPriority.MEDIUM,
        quantity: item.quantity ?? 1,
        unit: item.unit,
        dueDate: item.dueDate,
        status,
        assigneeId,
        createdById: auth.userId,
        startedAt: status === TaskStatus.IN_PROGRESS ? new Date() : undefined,
        completedAt: status === TaskStatus.COMPLETED ? new Date() : undefined,
      },
    });

    await tx.taskStatusHistory.create({
      data: {
        taskId: task.id,
        oldStatus: null,
        newStatus: status,
        changedById: auth.userId,
        reason: 'Task created',
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
        message: `${projectName}: ${item.title}`,
        entityType: 'Project',
        entityId: projectId,
      },
    });
  }
}

async function createProjectShoots(
  tx: Tx,
  auth: AuthContext,
  projectId: string,
  shoots: NonNullable<CreateProjectInput['shoots']>,
) {
  const crewUserIds = [...new Set(
    shoots.flatMap((shoot) => shoot.crewAssignments || []).map((assignment) => assignment.userId),
  )];
  const validUserIds = new Set<string>();
  if (crewUserIds.length > 0) {
    const users = await tx.user.findMany({
      where: { id: { in: crewUserIds }, organizationId: auth.organizationId, deletedAt: null },
      select: { id: true },
    });
    users.forEach((user) => validUserIds.add(user.id));
  }

  for (const [index, item] of shoots.entries()) {
    if (item.startTime && item.endTime && item.endTime.getTime() <= item.startTime.getTime()) {
      throw badRequest('A shoot end time must be later than its start time.', [
        { field: `shoots.${index}.endTime`, message: 'Must be later than startTime' },
      ]);
    }

    const status = item.status ?? ShootStatus.SCHEDULED;
    const shoot = await tx.shoot.create({
      data: {
        organizationId: auth.organizationId,
        projectId,
        title: item.title,
        shootType: item.shootType ?? ShootType.PHOTO_AND_VIDEO,
        shootDate: item.shootDate,
        startTime: item.startTime,
        endTime: item.endTime,
        location: item.location,
        city: item.city,
        notes: item.notes,
        plannedRoleSlots: item.plannedRoleSlots,
        status,
        createdById: auth.userId,
        completedAt: status === ShootStatus.COMPLETED ? new Date() : undefined,
      },
    });

    const seenUsers = new Set<string>();
    for (const assignment of item.crewAssignments || []) {
      if (!validUserIds.has(assignment.userId)) throw notFound('Team member');
      if (seenUsers.has(assignment.userId)) throw conflict('This person is already assigned to this shoot');
      seenUsers.add(assignment.userId);

      await tx.shootAssignment.create({
        data: {
          shootId: shoot.id,
          userId: assignment.userId,
          role: assignment.role,
          assignedById: auth.userId,
        },
      });

      await tx.notification.create({
        data: {
          organizationId: auth.organizationId,
          userId: assignment.userId,
          type: 'SHOOT_ASSIGNED',
          title: 'You have been assigned to a shoot',
          message: `${shoot.title} — role ${assignment.role}`,
          entityType: 'Shoot',
          entityId: shoot.id,
        },
      });
    }
  }
}

export interface ProjectListQuery {
  page?: number;
  limit?: number;
  search?: string;
  status?: ProjectStatus;
  isUrgent?: boolean;
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
      query.isUrgent === undefined ? undefined : { isUrgent: query.isUrgent },
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
      tasks: PROJECT_TASK_INCLUDE,
      paymentMilestones: { select: { id: true, amount: true, status: true } },
      _count: { select: { events: true, shoots: true, tasks: true, deliveries: true } },
    },
  });
}

export async function getProject(organizationId: string, id: string) {
  const project = await findScoped<Record<string, any>>(prisma.project, organizationId, id, 'Project', {
    include: {
      client: { include: { contacts: true, addresses: true } },
      manager: { select: { id: true, fullName: true, email: true } },
      createdBy: { select: { id: true, fullName: true } },
      branch: { select: { id: true, name: true, code: true } },
      events: { where: { deletedAt: null }, orderBy: { eventDate: 'asc' } },
      shoots: PROJECT_SHOOT_INCLUDE,
      tasks: PROJECT_TASK_INCLUDE,
      payments: {
        orderBy: { paymentDate: 'desc' },
      },
      paymentMilestones: { select: { id: true, amount: true, status: true } },
      deliveries: { where: { deletedAt: null }, orderBy: { expectedDate: 'asc' } },
      statusHistory: {
        orderBy: { createdAt: 'desc' },
        take: 25,
        include: { changedBy: { select: { id: true, fullName: true } } },
      },
    },
  });

  let meta: { dataBackup?: Record<string, unknown>; deliveryStatus?: Record<string, unknown> } = {};
  if (project.otherClientDetails) {
    try {
      meta = JSON.parse(project.otherClientDetails);
    } catch {
      meta = {};
    }
  }

  return {
    ...project,
    dataBackup: meta.dataBackup || null,
    deliveryStatus: meta.deliveryStatus || null,
  };
}

/** Removes only the planned instalment; recorded payments and project totals stay intact. */
export async function deletePaymentMilestone(
  auth: AuthContext, projectId: string, milestoneId: string,
  legacyMilestones: Array<{ id: string; stageName: string; dueDate?: string; amount: number; status?: string; notes?: string }> = [],
  ctx: AuditRequestContext,
) {
  return prisma.$transaction(async (tx) => {
    const milestone = await tx.paymentMilestone.findFirst({
      where: { id: milestoneId, projectId, organizationId: auth.organizationId },
      select: { id: true, title: true, projectId: true },
    });
    // Existing UI schedules used `sched-*` IDs before milestones had a table.
    // Persist every remaining legacy item atomically, deliberately excluding
    // the requested item; after this first delete the DB is authoritative.
    if (!milestone && legacyMilestones.length > 0) {
      await tx.paymentMilestone.createMany({
        data: legacyMilestones
          .filter((item) => item.id !== milestoneId)
          .map((item) => ({
            id: item.id, organizationId: auth.organizationId, projectId,
            title: item.stageName, amount: item.amount,
            dueDate: item.dueDate && !Number.isNaN(Date.parse(item.dueDate)) ? new Date(item.dueDate) : null,
            status: item.status?.toUpperCase() || 'PENDING', notes: item.notes,
          })),
        skipDuplicates: true,
      });
      return;
    }
    if (!milestone) throw notFound('Payment milestone');
    await tx.paymentMilestone.delete({ where: { id: milestone.id } });
    await recordAudit(tx, ctx, {
      action: 'DELETE', entityType: 'PaymentMilestone', entityId: milestone.id,
      summary: `Payment milestone ${milestone.title} deleted`, oldData: milestone,
    });
  });
}

export function listPaymentMilestones(organizationId: string, projectId: string) {
  return prisma.paymentMilestone.findMany({ where: { organizationId, projectId }, orderBy: { createdAt: 'asc' } });
}

export interface PaymentMilestoneInput {
  title: string;
  amount: string;
  /** Derived by the UI from amount / project total; not a database column. */
  percentage?: string;
  dueDate: Date;
  status: 'PENDING' | 'RECEIVED' | 'OVERDUE';
  notes?: string;
}

export async function createPaymentMilestone(
  auth: AuthContext, projectId: string, input: PaymentMilestoneInput, ctx: AuditRequestContext,
) {
  return prisma.$transaction(async (tx) => {
    await findScoped(tx.project, auth.organizationId, projectId, 'Project', { select: { id: true } });
    const { percentage: _percentage, ...milestoneData } = input;
    const milestone = await tx.paymentMilestone.create({
      data: { organizationId: auth.organizationId, projectId, ...milestoneData },
    });
    await recordAudit(tx, ctx, {
      action: 'CREATE', entityType: 'PaymentMilestone', entityId: milestone.id,
      summary: `Payment milestone ${milestone.title} created`, newData: milestone,
    });
    return milestone;
  });
}

export async function updatePaymentMilestone(
  auth: AuthContext, projectId: string, milestoneId: string, input: PaymentMilestoneInput, ctx: AuditRequestContext,
) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.paymentMilestone.findFirst({
      where: { id: milestoneId, projectId, organizationId: auth.organizationId },
    });
    if (!existing) throw notFound('Payment milestone');
    const { percentage: _percentage, ...milestoneData } = input;
    const milestone = await tx.paymentMilestone.update({ where: { id: milestoneId }, data: milestoneData });
    await recordAudit(tx, ctx, {
      action: 'UPDATE', entityType: 'PaymentMilestone', entityId: milestone.id,
      summary: `Payment milestone ${milestone.title} updated`, oldData: existing, newData: milestone,
    });
    return milestone;
  });
}

export interface CreateProjectInput {
  clientId?: string;
  client?: {
    displayName: string;
    primaryPhone: string;
    primaryEmail?: string;
  };
  leadId?: string;
  branchId?: string;
  name: string;
  type?: ProjectType;
  status?: ProjectStatus;
  isUrgent?: boolean;
  weddingDate?: Date;
  deliveryDueDate?: Date;
  venueName?: string;
  venueAddress?: string;
  venueCity?: string;
  totalQuotation?: Prisma.Decimal.Value;
  customServiceType?: string;
  otherClientDetails?: string;
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
    description?: string;
    category?: TaskCategory;
    priority?: TaskPriority;
    quantity?: number;
    unit?: string;
    dueDate?: Date;
    assigneeId?: string;
    status?: TaskStatus;
  }>;
  shoots?: Array<{
    title: string;
    shootType?: ShootType;
    shootDate: Date;
    startTime?: Date;
    endTime?: Date;
    location?: string;
    city?: string;
    notes?: string;
    status?: ShootStatus;
    plannedRoleSlots?: Array<{ role: string; requiredCount: number; name?: string; mobile?: string }>;
    crewAssignments?: Array<{
      userId: string;
      role: CrewRole;
    }>;
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
    assertNestedCreatePermissions(auth, input);
    const clientId = await resolveProjectClient(tx, auth, input, ctx);

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
        clientId,
        leadId: input.leadId,
        projectNumber,
        name: input.name,
        type: input.type ?? 'WEDDING',
        status: input.status ?? ProjectStatus.UPCOMING,
        isUrgent: input.isUrgent ?? false,
        weddingDate: input.weddingDate,
        deliveryDueDate: input.deliveryDueDate,
        venueName: input.venueName,
        venueAddress: input.venueAddress,
        venueCity: input.venueCity,
        totalQuotation: input.totalQuotation ?? 0,
        customServiceType: input.customServiceType,
        otherClientDetails: input.otherClientDetails,
        notes: input.notes,
        managerId: input.managerId,
        createdById: auth.userId,
        completedAt: input.status === ProjectStatus.COMPLETED ? new Date() : undefined,
        cancelledAt: input.status === ProjectStatus.CANCELLED ? new Date() : undefined,
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
    });

    await tx.projectStatusHistory.create({
      data: {
        projectId: project.id,
        oldStatus: null,
        newStatus: input.status ?? ProjectStatus.UPCOMING,
        changedById: auth.userId,
        reason: 'Project created',
      },
    });

    if (input.tasks?.length) await createProjectTasks(tx, auth, project.id, project.name, clientId, input.tasks);
    if (input.shoots?.length) await createProjectShoots(tx, auth, project.id, input.shoots);

    const createdProject = await loadCreatedProject(tx, auth.organizationId, project.id);

    await recordAudit(tx, ctx, {
      action: 'CREATE',
      entityType: 'Project',
      entityId: project.id,
      summary: `Project ${project.projectNumber} created`,
      newData: createdProject,
    });

    return createdProject;
  }, { timeout: 15_000, maxWait: 10_000 });
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
        customServiceType: input.customServiceType,
        otherClientDetails: input.otherClientDetails,
        notes: input.notes,
        managerId: input.managerId,
        branchId: input.branchId,
        isUrgent: input.isUrgent,
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

    // A user-initiated delete is a permanent removal. Database foreign-key
    // actions remove project-owned records (shoots, tasks, deliveries, etc.)
    // and detach retained accounting records where the schema requires it.
    await tx.project.delete({ where: { id } });

    await recordAudit(tx, ctx, {
      action: 'DELETE',
      entityType: 'Project',
      entityId: id,
      summary: `Project ${project.projectNumber} permanently deleted`,
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

export async function updateProjectDataBackup(
  auth: AuthContext,
  projectId: string,
  dataBackup: Record<string, unknown>,
  ctx: AuditRequestContext,
) {
  return prisma.$transaction(async (tx) => {
    const existing = await findScoped<{ id: string; otherClientDetails: string | null }>(
      tx.project,
      auth.organizationId,
      projectId,
      'Project',
    );
    let parsed: Record<string, unknown> = {};
    if (existing.otherClientDetails) {
      try {
        parsed = JSON.parse(existing.otherClientDetails);
      } catch {
        parsed = { customDetails: existing.otherClientDetails };
      }
    }
    parsed.dataBackup = dataBackup;
    const updated = await tx.project.update({
      where: { id: projectId },
      data: { otherClientDetails: JSON.stringify(parsed) },
    });
    await recordAudit(tx, ctx, {
      action: 'UPDATE',
      entityType: 'ProjectDataBackup',
      entityId: projectId,
      summary: 'Project data backup posture updated',
      newData: dataBackup,
    });
    return updated;
  });
}

export async function updateProjectDeliveries(
  auth: AuthContext,
  projectId: string,
  deliveryStatus: Record<string, unknown>,
  ctx: AuditRequestContext,
) {
  return prisma.$transaction(async (tx) => {
    const existing = await findScoped<{ id: string; otherClientDetails: string | null }>(
      tx.project,
      auth.organizationId,
      projectId,
      'Project',
    );
    let parsed: Record<string, unknown> = {};
    if (existing.otherClientDetails) {
      try {
        parsed = JSON.parse(existing.otherClientDetails);
      } catch {
        parsed = { customDetails: existing.otherClientDetails };
      }
    }
    parsed.deliveryStatus = deliveryStatus;
    const updated = await tx.project.update({
      where: { id: projectId },
      data: { otherClientDetails: JSON.stringify(parsed) },
    });
    await recordAudit(tx, ctx, {
      action: 'UPDATE',
      entityType: 'ProjectDeliveries',
      entityId: projectId,
      summary: 'Project delivery status updated',
      newData: deliveryStatus,
    });
    return updated;
  });
}
