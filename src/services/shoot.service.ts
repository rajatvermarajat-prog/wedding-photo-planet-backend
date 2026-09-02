import { AssignmentStatus, CrewRole, Prisma, ShootStatus, ShootType } from '@prisma/client';
import { prisma } from '../config/prisma';
import { andWhere, findScoped, paginate, searchFilter } from '../repositories/base.repository';
import { resolveSort } from '../utils/pagination';
import { badRequest, conflict, notFound } from '../utils/errors';
import { dateRangeFilter } from '../utils/date';
import { AuthContext } from '../types';
import { AuditRequestContext, recordAudit } from './audit.service';

const SORTABLE = ['shootDate', 'createdAt', 'title', 'status'] as const;

export interface ShootListQuery {
  page?: number;
  limit?: number;
  search?: string;
  projectId?: string;
  eventId?: string;
  status?: ShootStatus;
  shootType?: ShootType;
  userId?: string;
  freelancerId?: string;
  from?: string;
  to?: string;
  sortBy?: string;
  sortOrder?: string;
}

export function listShoots(organizationId: string, query: ShootListQuery) {
  const sort = resolveSort(query.sortBy, query.sortOrder, SORTABLE, 'shootDate');
  const shootDate = dateRangeFilter(query.from, query.to);
  return paginate(prisma.shoot, {
    where: andWhere(
      { organizationId, deletedAt: null },
      query.projectId ? { projectId: query.projectId } : undefined,
      query.eventId ? { eventId: query.eventId } : undefined,
      query.status ? { status: query.status } : undefined,
      query.shootType ? { shootType: query.shootType } : undefined,
      query.userId ? { assignments: { some: { userId: query.userId } } } : undefined,
      query.freelancerId ? { assignments: { some: { freelancerId: query.freelancerId } } } : undefined,
      shootDate ? { shootDate } : undefined,
      searchFilter(query.search, ['title', 'location', 'city']),
    ),
    orderBy: { [sort.field]: sort.direction },
    page: query.page,
    limit: query.limit,
    include: {
      project: { select: { id: true, projectNumber: true, name: true } },
      event: { select: { id: true, name: true } },
      assignments: {
        include: {
          user: { select: { id: true, fullName: true, phone: true } },
          freelancer: { select: { id: true, fullName: true, code: true, phone: true } },
        },
      },
    },
  });
}

export function getShoot(organizationId: string, id: string) {
  return findScoped(prisma.shoot, organizationId, id, 'Shoot', {
    include: {
      project: { select: { id: true, projectNumber: true, name: true, clientId: true } },
      event: true,
      createdBy: { select: { id: true, fullName: true } },
      assignments: {
        orderBy: { createdAt: 'asc' },
        include: {
          user: { select: { id: true, fullName: true, email: true, phone: true } },
          freelancer: { select: { id: true, fullName: true, code: true, phone: true } },
          assignedBy: { select: { id: true, fullName: true } },
        },
      },
    },
  });
}

export interface CreateShootInput {
  projectId: string;
  eventId?: string;
  title: string;
  shootType?: ShootType;
  shootDate: Date;
  startTime?: Date;
  endTime?: Date;
  location?: string;
  city?: string;
  notes?: string;
}

export async function createShoot(auth: AuthContext, input: CreateShootInput, ctx: AuditRequestContext) {
  return prisma.$transaction(async (tx) => {
    const project = await tx.project.findFirst({
      where: { id: input.projectId, organizationId: auth.organizationId, deletedAt: null },
      select: { id: true },
    });
    if (!project) throw notFound('Project');

    if (input.eventId) {
      const event = await tx.event.findFirst({
        where: { id: input.eventId, projectId: input.projectId, deletedAt: null },
        select: { id: true },
      });
      if (!event) throw badRequest('The event does not belong to this project');
    }

    const shoot = await tx.shoot.create({
      data: { organizationId: auth.organizationId, createdById: auth.userId, ...input },
    });

    await recordAudit(tx, ctx, {
      action: 'CREATE',
      entityType: 'Shoot',
      entityId: shoot.id,
      summary: `Shoot ${shoot.title} scheduled`,
      newData: shoot,
    });

    return shoot;
  });
}

export async function updateShoot(
  auth: AuthContext,
  id: string,
  input: Partial<Omit<CreateShootInput, 'projectId'>> & {
    status?: ShootStatus;
    dataSizeGb?: Prisma.Decimal.Value;
    dataReceivedAt?: Date;
    backupDoneAt?: Date;
  },
  ctx: AuditRequestContext,
) {
  return prisma.$transaction(async (tx) => {
    const existing = await findScoped<Record<string, unknown>>(
      tx.shoot,
      auth.organizationId,
      id,
      'Shoot',
    );

    const updated = await tx.shoot.update({
      where: { id },
      data: {
        ...input,
        completedAt: input.status === 'COMPLETED' ? new Date() : undefined,
      },
    });

    await recordAudit(tx, ctx, {
      action: input.status ? 'STATUS_CHANGE' : 'UPDATE',
      entityType: 'Shoot',
      entityId: id,
      summary: input.status ? `Shoot status -> ${input.status}` : 'Shoot updated',
      oldData: existing,
      newData: updated,
    });

    return updated;
  });
}

export async function deleteShoot(auth: AuthContext, id: string, ctx: AuditRequestContext) {
  return prisma.$transaction(async (tx) => {
    const shoot = await findScoped<{ id: string; title: string }>(
      tx.shoot,
      auth.organizationId,
      id,
      'Shoot',
    );
    // Shoot assignments are owned by the shoot and use the existing cascade
    // relation, so deleting the parent cannot leave orphaned crew rows.
    await tx.shoot.delete({ where: { id } });
    await recordAudit(tx, ctx, {
      action: 'DELETE',
      entityType: 'Shoot',
      entityId: id,
      summary: `Shoot ${shoot.title} permanently deleted`,
      oldData: shoot,
    });
  });
}

export interface AssignCrewInput {
  userId?: string;
  freelancerId?: string;
  role: CrewRole;
  agreedAmount?: Prisma.Decimal.Value;
  travelAmount?: Prisma.Decimal.Value;
  extraAmount?: Prisma.Decimal.Value;
  callTime?: Date;
  notes?: string;
}

/**
 * Assigns one crew member to a shoot.
 *
 * Three separate guards, deliberately layered (§10, §36):
 *   1. exactly one of userId/freelancerId — checked here and by a CHECK constraint
 *   2. no duplicate assignment — unique (shoot, user) / (shoot, freelancer)
 *   3. no double-booking across shoots on the same date — checked here
 */
export async function assignCrew(
  auth: AuthContext,
  shootId: string,
  input: AssignCrewInput,
  ctx: AuditRequestContext,
) {
  if (Number(Boolean(input.userId)) + Number(Boolean(input.freelancerId)) !== 1) {
    throw badRequest('Provide exactly one of userId or freelancerId');
  }

  return prisma.$transaction(async (tx) => {
    const shoot = await findScoped<{ id: string; title: string; shootDate: Date }>(
      tx.shoot,
      auth.organizationId,
      shootId,
      'Shoot',
    );

    if (input.userId) {
      const user = await tx.user.findFirst({
        where: { id: input.userId, organizationId: auth.organizationId, deletedAt: null },
        select: { id: true },
      });
      if (!user) throw notFound('Team member');
    } else {
      const freelancer = await tx.freelancer.findFirst({
        where: { id: input.freelancerId, organizationId: auth.organizationId, deletedAt: null },
        select: { id: true, status: true, maxShootsPerDay: true },
      });
      if (!freelancer) throw notFound('Freelancer');
      if (freelancer.status !== 'ACTIVE') {
        throw conflict('This freelancer is not currently active');
      }

      const sameDay = await tx.shootAssignment.count({
        where: {
          freelancerId: input.freelancerId,
          status: { notIn: ['DECLINED', 'CANCELLED'] },
          shoot: { shootDate: shoot.shootDate, deletedAt: null },
        },
      });
      if (sameDay >= freelancer.maxShootsPerDay) {
        throw conflict(
          `This freelancer is already booked for ${sameDay} shoot(s) on that date (limit ${freelancer.maxShootsPerDay})`,
        );
      }
    }

    const existing = await tx.shootAssignment.findFirst({
      where: {
        shootId,
        ...(input.userId ? { userId: input.userId } : { freelancerId: input.freelancerId }),
      },
      select: { id: true },
    });
    if (existing) throw conflict('This person is already assigned to this shoot');

    const assignment = await tx.shootAssignment.create({
      data: {
        shootId,
        userId: input.userId ?? null,
        freelancerId: input.freelancerId ?? null,
        role: input.role,
        agreedAmount: input.agreedAmount ?? 0,
        travelAmount: input.travelAmount ?? 0,
        extraAmount: input.extraAmount ?? 0,
        callTime: input.callTime,
        notes: input.notes,
        assignedById: auth.userId,
      },
      include: {
        user: { select: { id: true, fullName: true } },
        freelancer: { select: { id: true, fullName: true, code: true } },
      },
    });

    if (input.userId) {
      await tx.notification.create({
        data: {
          organizationId: auth.organizationId,
          userId: input.userId,
          type: 'SHOOT_ASSIGNED',
          title: 'You have been assigned to a shoot',
          message: `${shoot.title} — role ${input.role}`,
          entityType: 'Shoot',
          entityId: shootId,
        },
      });
    }

    await recordAudit(tx, ctx, {
      action: 'ASSIGN',
      entityType: 'ShootAssignment',
      entityId: assignment.id,
      summary: `Crew assigned to shoot ${shoot.title} as ${input.role}`,
      newData: assignment,
    });

    return assignment;
  });
}

export async function updateAssignment(
  auth: AuthContext,
  shootId: string,
  assignmentId: string,
  input: {
    role?: CrewRole;
    status?: AssignmentStatus;
    agreedAmount?: Prisma.Decimal.Value;
    travelAmount?: Prisma.Decimal.Value;
    extraAmount?: Prisma.Decimal.Value;
    checkInAt?: Date;
    checkOutAt?: Date;
    dataSizeGb?: Prisma.Decimal.Value;
    dataReceived?: boolean;
    storageReference?: string;
    notes?: string;
  },
  ctx: AuditRequestContext,
) {
  return prisma.$transaction(async (tx) => {
    const assignment = await tx.shootAssignment.findFirst({
      where: { id: assignmentId, shootId, shoot: { organizationId: auth.organizationId } },
    });
    if (!assignment) throw notFound('Shoot assignment');

    const updated = await tx.shootAssignment.update({ where: { id: assignmentId }, data: input });

    await recordAudit(tx, ctx, {
      action: 'UPDATE',
      entityType: 'ShootAssignment',
      entityId: assignmentId,
      summary: 'Shoot assignment updated',
      oldData: assignment,
      newData: updated,
    });

    return updated;
  });
}

export async function removeAssignment(
  auth: AuthContext,
  shootId: string,
  assignmentId: string,
  ctx: AuditRequestContext,
) {
  return prisma.$transaction(async (tx) => {
    const assignment = await tx.shootAssignment.findFirst({
      where: { id: assignmentId, shootId, shoot: { organizationId: auth.organizationId } },
      include: { payouts: { select: { id: true } } },
    });
    if (!assignment) throw notFound('Shoot assignment');

    if (assignment.payouts.length > 0) {
      // Money has already moved against this assignment.
      throw conflict(
        'This assignment has settled payouts. Cancel the assignment instead of removing it.',
      );
    }

    await tx.shootAssignment.delete({ where: { id: assignmentId } });

    await recordAudit(tx, ctx, {
      action: 'UNASSIGN',
      entityType: 'ShootAssignment',
      entityId: assignmentId,
      summary: 'Crew removed from shoot',
      oldData: assignment,
    });
  });
}
