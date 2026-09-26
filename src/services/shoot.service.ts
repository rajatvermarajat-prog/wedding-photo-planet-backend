import { AssignmentStatus, CrewRole, Prisma, ShootStatus, ShootType } from '@prisma/client';
import { prisma } from '../config/prisma';
import { andWhere, findScoped, paginate, searchFilter } from '../repositories/base.repository';
import { resolveSort } from '../utils/pagination';
import { badRequest, conflict, notFound } from '../utils/errors';
import { dateRangeFilter } from '../utils/date';
import { AuthContext } from '../types';
import { AuditRequestContext, recordAudit } from './audit.service';

const SORTABLE = ['shootDate', 'createdAt', 'title', 'status'] as const;
const BOOKING_BLOCKING_SHOOT_STATUSES: ShootStatus[] = [ShootStatus.SCHEDULED, ShootStatus.IN_PROGRESS, ShootStatus.COMPLETED];
/** Neon + audit writes can exceed Prisma's default 5s interactive transaction limit. */
const SHOOT_TX_OPTIONS = { maxWait: 10_000, timeout: 15_000 } as const;
const assignmentInclude = {
  user: { select: { id: true, fullName: true } },
  freelancer: { select: { id: true, fullName: true, code: true } },
} as const;
const formatDateKey = (date: Date) => date.toISOString().slice(0, 10);
const hasKnownNonOverlappingTimes = (
  next: { startTime?: Date | null; endTime?: Date | null },
  existing: { startTime?: Date | null; endTime?: Date | null },
) => {
  if (!next.startTime || !next.endTime || !existing.startTime || !existing.endTime) return false;
  return next.endTime.getTime() <= existing.startTime.getTime() || existing.endTime.getTime() <= next.startTime.getTime();
};

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
  plannedRoleSlots?: Array<{ role: string; requiredCount: number; name?: string; mobile?: string; dataReceived?: boolean; dataSizeGb?: Prisma.Decimal.Value; copyInHD?: string; backupInHD?: string }>;
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
  }, SHOOT_TX_OPTIONS);
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

    return tx.shoot.findUniqueOrThrow({
      where: { id },
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
  }, SHOOT_TX_OPTIONS);
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
  }, SHOOT_TX_OPTIONS);
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
 *   2. no duplicate assignment for the same role — unique (shoot, user, role) / (shoot, freelancer, role)
 *   3. one project per person per date — other projects on the same date are rejected
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
    const shoot = await findScoped<{ id: string; title: string; shootDate: Date; projectId: string; startTime?: Date | null; endTime?: Date | null }>(
      tx.shoot,
      auth.organizationId,
      shootId,
      'Shoot',
    );

    if (input.userId) {
      const user = await tx.user.findFirst({
        where: { id: input.userId, organizationId: auth.organizationId, deletedAt: null },
        select: { id: true, fullName: true },
      });
      if (!user) throw notFound('Team member');
      const assignmentDate = formatDateKey(shoot.shootDate);

      const sameDayAssignments = await tx.shootAssignment.findMany({
        where: {
          userId: input.userId,
          status: { notIn: ['DECLINED', 'CANCELLED'] },
          shoot: {
            id: { not: shoot.id },
            projectId: { not: shoot.projectId },
            shootDate: dateRangeFilter(assignmentDate, assignmentDate),
            status: { in: BOOKING_BLOCKING_SHOOT_STATUSES },
            deletedAt: null,
          },
        },
        select: { shoot: { select: { title: true, shootDate: true, startTime: true, endTime: true } }, user: { select: { fullName: true } } },
      });
      const sameDay = sameDayAssignments.find((row) => !hasKnownNonOverlappingTimes(shoot, row.shoot));
      if (sameDay) {
        throw conflict(`${sameDay.user?.fullName || user.fullName} is already assigned on ${formatDateKey(sameDay.shoot.shootDate)} for "${sameDay.shoot.title}".`);
      }
    } else {
      const freelancer = await tx.freelancer.findFirst({
        where: { id: input.freelancerId, organizationId: auth.organizationId, deletedAt: null },
        select: { id: true, status: true, maxShootsPerDay: true },
      });
      if (!freelancer) throw notFound('Freelancer');
      if (freelancer.status !== 'ACTIVE') {
        throw conflict('This freelancer is not currently active');
      }

      const assignmentDate = formatDateKey(shoot.shootDate);
      const sameDayAssignments = await tx.shootAssignment.findMany({
        where: {
          freelancerId: input.freelancerId,
          status: { notIn: ['DECLINED', 'CANCELLED'] },
          shoot: {
            id: { not: shoot.id },
            projectId: { not: shoot.projectId },
            shootDate: dateRangeFilter(assignmentDate, assignmentDate),
            status: { in: BOOKING_BLOCKING_SHOOT_STATUSES },
            deletedAt: null,
          },
        },
        select: { shoot: { select: { startTime: true, endTime: true } } },
      });
      const sameDay = sameDayAssignments.filter((row) => !hasKnownNonOverlappingTimes(shoot, row.shoot)).length;
      if (sameDay >= freelancer.maxShootsPerDay) {
        throw conflict(
          `This freelancer is already booked for ${sameDay} shoot(s) on that date (limit ${freelancer.maxShootsPerDay})`,
        );
      }
    }

    const existing = await tx.shootAssignment.findFirst({
      where: {
        shootId,
        role: input.role,
        status: { notIn: ['DECLINED', 'CANCELLED'] },
        ...(input.userId ? { userId: input.userId } : { freelancerId: input.freelancerId }),
      },
      include: assignmentInclude,
    });
    if (existing) return existing;

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
      include: assignmentInclude,
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
  }, SHOOT_TX_OPTIONS);
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

    if (input.role) {
      const duplicate = await tx.shootAssignment.findFirst({
        where: {
          id: { not: assignmentId },
          shootId,
          role: input.role,
          ...(assignment.userId ? { userId: assignment.userId } : { freelancerId: assignment.freelancerId }),
        },
        select: { id: true },
      });
      if (duplicate) throw conflict('Employee is already assigned to this role.');
    }

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
  }, SHOOT_TX_OPTIONS);
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
  }, SHOOT_TX_OPTIONS);
}
