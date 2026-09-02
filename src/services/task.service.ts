import { TaskCategory, TaskPriority, TaskStatus } from '@prisma/client';
import { prisma } from '../config/prisma';
import { andWhere, findScoped, paginate, searchFilter } from '../repositories/base.repository';
import { resolveSort } from '../utils/pagination';
import { badRequest, conflict, notFound } from '../utils/errors';
import { dateRangeFilter } from '../utils/date';
import { AuthContext } from '../types';
import { AuditRequestContext, recordAudit } from './audit.service';

const SORTABLE = ['dueDate', 'createdAt', 'priority', 'status', 'title'] as const;

const TERMINAL: TaskStatus[] = ['COMPLETED', 'CANCELLED'];

export interface TaskListQuery {
  page?: number;
  limit?: number;
  search?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  category?: TaskCategory;
  assigneeId?: string;
  projectId?: string;
  shootId?: string;
  deliveryId?: string;
  overdue?: boolean;
  from?: string;
  to?: string;
  sortBy?: string;
  sortOrder?: string;
}

export function listTasks(organizationId: string, query: TaskListQuery) {
  const sort = resolveSort(query.sortBy, query.sortOrder, SORTABLE, 'dueDate');
  const dueDate = dateRangeFilter(query.from, query.to);
  return paginate(prisma.task, {
    where: andWhere(
      { organizationId, deletedAt: null },
      query.status ? { status: query.status } : undefined,
      query.priority ? { priority: query.priority } : undefined,
      query.category ? { category: query.category } : undefined,
      query.assigneeId ? { assigneeId: query.assigneeId } : undefined,
      query.projectId ? { projectId: query.projectId } : undefined,
      query.shootId ? { shootId: query.shootId } : undefined,
      query.deliveryId ? { deliveryId: query.deliveryId } : undefined,
      query.overdue
        ? { dueDate: { lt: new Date() }, status: { notIn: TERMINAL } }
        : undefined,
      dueDate ? { dueDate } : undefined,
      searchFilter(query.search, ['title', 'description']),
    ),
    orderBy: { [sort.field]: sort.direction },
    page: query.page,
    limit: query.limit,
    include: {
      assignee: { select: { id: true, fullName: true } },
      project: { select: { id: true, projectNumber: true, name: true } },
    },
  });
}

export function getTask(organizationId: string, id: string) {
  return findScoped(prisma.task, organizationId, id, 'Task', {
    include: {
      assignee: { select: { id: true, fullName: true, email: true } },
      createdBy: { select: { id: true, fullName: true } },
      project: { select: { id: true, projectNumber: true, name: true } },
      event: { select: { id: true, name: true } },
      shoot: { select: { id: true, title: true } },
      delivery: { select: { id: true, title: true } },
      assignments: {
        orderBy: { createdAt: 'desc' },
        include: {
          fromUser: { select: { id: true, fullName: true } },
          toUser: { select: { id: true, fullName: true } },
          assignedBy: { select: { id: true, fullName: true } },
        },
      },
      statusHistory: {
        orderBy: { createdAt: 'desc' },
        include: { changedBy: { select: { id: true, fullName: true } } },
      },
      workSessions: { orderBy: { startedAt: 'desc' }, take: 20 },
    },
  });
}

export interface CreateTaskInput {
  title: string;
  description?: string;
  category?: TaskCategory;
  priority?: TaskPriority;
  quantity?: number;
  unit?: string;
  dueDate?: Date;
  assigneeId?: string;
  projectId?: string;
  eventId?: string;
  shootId?: string;
  deliveryId?: string;
  clientId?: string;
  estimatedMinutes?: number;
}

export async function createTask(auth: AuthContext, input: CreateTaskInput, ctx: AuditRequestContext) {
  return prisma.$transaction(async (tx) => {
    if (input.projectId) {
      const project = await tx.project.findFirst({
        where: { id: input.projectId, organizationId: auth.organizationId, deletedAt: null },
        select: { id: true },
      });
      if (!project) throw notFound('Project');
    }
    if (input.assigneeId) {
      const assignee = await tx.user.findFirst({
        where: { id: input.assigneeId, organizationId: auth.organizationId, deletedAt: null },
        select: { id: true },
      });
      if (!assignee) throw notFound('Assignee');
    }

    const task = await tx.task.create({
      data: {
        organizationId: auth.organizationId,
        ...input,
        status: input.assigneeId ? TaskStatus.ASSIGNED : TaskStatus.TODO,
        createdById: auth.userId,
      },
    });

    await tx.taskStatusHistory.create({
      data: {
        taskId: task.id,
        oldStatus: null,
        newStatus: task.status,
        changedById: auth.userId,
        reason: 'Task created',
      },
    });

    if (input.assigneeId) {
      await tx.taskAssignment.create({
        data: {
          taskId: task.id,
          fromUserId: null,
          toUserId: input.assigneeId,
          assignedById: auth.userId,
          reason: 'Initial assignment',
        },
      });
      await tx.notification.create({
        data: {
          organizationId: auth.organizationId,
          userId: input.assigneeId,
          type: 'TASK_ASSIGNED',
          title: 'New task assigned',
          message: task.title,
          entityType: 'Task',
          entityId: task.id,
        },
      });
    }

    await recordAudit(tx, ctx, {
      action: 'CREATE',
      entityType: 'Task',
      entityId: task.id,
      summary: `Task "${task.title}" created`,
      newData: task,
    });

    return task;
  });
}

export async function updateTask(
  auth: AuthContext,
  id: string,
  input: Partial<Omit<CreateTaskInput, 'assigneeId'>>,
  ctx: AuditRequestContext,
) {
  return prisma.$transaction(async (tx) => {
    const existing = await findScoped<Record<string, unknown>>(
      tx.task,
      auth.organizationId,
      id,
      'Task',
    );
    const updated = await tx.task.update({ where: { id }, data: input });
    await recordAudit(tx, ctx, {
      action: 'UPDATE',
      entityType: 'Task',
      entityId: id,
      summary: 'Task updated',
      oldData: existing,
      newData: updated,
    });
    return updated;
  });
}

export async function changeTaskStatus(
  auth: AuthContext,
  id: string,
  status: TaskStatus,
  reason: string | undefined,
  ctx: AuditRequestContext,
) {
  return prisma.$transaction(async (tx) => {
    const task = await findScoped<{ id: string; status: TaskStatus; title: string; createdById: string | null }>(
      tx.task,
      auth.organizationId,
      id,
      'Task',
    );

    if (task.status === status) throw conflict(`Task is already ${status}`);
    if (TERMINAL.includes(task.status)) {
      throw conflict(`A ${task.status.toLowerCase()} task cannot change status`);
    }

    const updated = await tx.task.update({
      where: { id },
      data: {
        status,
        startedAt: status === 'IN_PROGRESS' ? new Date() : undefined,
        completedAt: status === 'COMPLETED' ? new Date() : undefined,
      },
    });

    await tx.taskStatusHistory.create({
      data: { taskId: id, oldStatus: task.status, newStatus: status, changedById: auth.userId, reason },
    });

    if (status === 'COMPLETED' && task.createdById && task.createdById !== auth.userId) {
      await tx.notification.create({
        data: {
          organizationId: auth.organizationId,
          userId: task.createdById,
          type: 'TASK_COMPLETED',
          title: 'Task completed',
          message: task.title,
          entityType: 'Task',
          entityId: id,
        },
      });
    }

    await recordAudit(tx, ctx, {
      action: 'STATUS_CHANGE',
      entityType: 'Task',
      entityId: id,
      summary: `Task "${task.title}": ${task.status} -> ${status}`,
      oldData: { status: task.status },
      newData: { status, reason },
    });

    return updated;
  });
}

/**
 * Reassigns a task. Every handover writes a TaskAssignment row, so ownership
 * history is fully auditable (§12) rather than being overwritten in place.
 */
export async function reassignTask(
  auth: AuthContext,
  id: string,
  toUserId: string,
  reason: string | undefined,
  ctx: AuditRequestContext,
) {
  return prisma.$transaction(async (tx) => {
    const task = await findScoped<{ id: string; assigneeId: string | null; title: string; status: TaskStatus }>(
      tx.task,
      auth.organizationId,
      id,
      'Task',
    );

    if (TERMINAL.includes(task.status)) {
      throw conflict(`A ${task.status.toLowerCase()} task cannot be reassigned`);
    }
    if (task.assigneeId === toUserId) throw badRequest('The task is already assigned to this user');

    const assignee = await tx.user.findFirst({
      where: { id: toUserId, organizationId: auth.organizationId, deletedAt: null, status: 'ACTIVE' },
      select: { id: true, fullName: true },
    });
    if (!assignee) throw notFound('Assignee');

    const updated = await tx.task.update({
      where: { id },
      data: {
        assigneeId: toUserId,
        status: task.status === 'TODO' ? TaskStatus.ASSIGNED : task.status,
      },
    });

    await tx.taskAssignment.create({
      data: {
        taskId: id,
        fromUserId: task.assigneeId,
        toUserId,
        assignedById: auth.userId,
        reason,
      },
    });

    await tx.notification.create({
      data: {
        organizationId: auth.organizationId,
        userId: toUserId,
        type: 'TASK_REASSIGNED',
        title: 'A task was assigned to you',
        message: task.title,
        entityType: 'Task',
        entityId: id,
      },
    });

    await recordAudit(tx, ctx, {
      action: 'ASSIGN',
      entityType: 'Task',
      entityId: id,
      summary: `Task "${task.title}" reassigned to ${assignee.fullName}`,
      oldData: { assigneeId: task.assigneeId },
      newData: { assigneeId: toUserId, reason },
    });

    return updated;
  });
}

export async function deleteTask(auth: AuthContext, id: string, ctx: AuditRequestContext) {
  return prisma.$transaction(async (tx) => {
    const task = await findScoped<{ id: string; title: string }>(
      tx.task,
      auth.organizationId,
      id,
      'Task',
    );
    await tx.task.delete({ where: { id } });
    await recordAudit(tx, ctx, {
      action: 'DELETE',
      entityType: 'Task',
      entityId: id,
      summary: `Task "${task.title}" permanently deleted`,
      oldData: task,
    });
  });
}
