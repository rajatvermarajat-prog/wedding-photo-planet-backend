import { AttendanceSource, AttendanceStatus, LeaveStatus, LeaveType, WorkLocation } from '@prisma/client';
import { prisma } from '../config/prisma';
import { andWhere, paginate } from '../repositories/base.repository';
import { resolveSort } from '../utils/pagination';
import { badRequest, conflict, notFound } from '../utils/errors';
import { dateRangeFilter, toDateOnly } from '../utils/date';
import { AuthContext } from '../types';
import { AuditRequestContext, recordAudit } from './audit.service';

const SORTABLE = ['date', 'createdAt'] as const;

export function listAttendance(
  organizationId: string,
  query: {
    page?: number;
    limit?: number;
    userId?: string;
    status?: AttendanceStatus;
    workLocation?: WorkLocation;
    branchId?: string;
    from?: string;
    to?: string;
    sortBy?: string;
    sortOrder?: string;
  },
) {
  const sort = resolveSort(query.sortBy, query.sortOrder, SORTABLE, 'date');
  const date = dateRangeFilter(query.from, query.to);
  return paginate(prisma.attendance, {
    where: andWhere(
      { organizationId },
      query.userId ? { userId: query.userId } : undefined,
      query.status ? { status: query.status } : undefined,
      query.workLocation ? { workLocation: query.workLocation } : undefined,
      query.branchId ? { branchId: query.branchId } : undefined,
      date ? { date } : undefined,
    ),
    orderBy: { [sort.field]: sort.direction },
    page: query.page,
    limit: query.limit,
    include: {
      user: { select: { id: true, fullName: true, employeeCode: true } },
      project: { select: { id: true, projectNumber: true, name: true } },
    },
  });
}

export interface MarkAttendanceInput {
  userId?: string;
  date: string;
  checkIn?: string;
  checkOut?: string;
  status?: AttendanceStatus;
  source?: AttendanceSource;
  workLocation?: WorkLocation;
  projectId?: string;
  notes?: string;
}

/**
 * Marks (or corrects) a day's attendance. `@@unique([userId, date])` means one
 * row per person per day, so a double submission updates rather than duplicates.
 * Working minutes are always derived from the timestamps, never trusted from
 * the client.
 */
export async function markAttendance(
  auth: AuthContext,
  input: MarkAttendanceInput,
  canManageOthers: boolean,
  ctx: AuditRequestContext,
) {
  const targetUserId = input.userId ?? auth.userId;

  if (targetUserId !== auth.userId && !canManageOthers) {
    throw conflict('You may only mark your own attendance');
  }

  const user = await prisma.user.findFirst({
    where: { id: targetUserId, organizationId: auth.organizationId, deletedAt: null },
    select: { id: true, branchId: true },
  });
  if (!user) throw notFound('User');

  const date = toDateOnly(input.date);
  const checkIn = input.checkIn ? new Date(input.checkIn) : undefined;
  const checkOut = input.checkOut ? new Date(input.checkOut) : undefined;

  if (checkIn && checkOut && checkOut < checkIn) {
    throw badRequest('checkOut cannot be earlier than checkIn');
  }

  const workingMinutes =
    checkIn && checkOut ? Math.max(0, Math.round((checkOut.getTime() - checkIn.getTime()) / 60000)) : 0;

  const record = await prisma.$transaction(async (tx) => {
    const saved = await tx.attendance.upsert({
      where: { userId_date: { userId: targetUserId, date } },
      create: {
        organizationId: auth.organizationId,
        branchId: user.branchId,
        userId: targetUserId,
        projectId: input.projectId,
        date,
        checkIn,
        checkOut,
        workingMinutes,
        status: input.status ?? AttendanceStatus.PRESENT,
        source: input.source ?? (targetUserId === auth.userId ? 'PASSWORD' : 'ADMIN'),
        workLocation: input.workLocation ?? WorkLocation.OFFICE,
        notes: input.notes,
        markedById: auth.userId,
      },
      update: {
        checkIn,
        checkOut,
        workingMinutes,
        status: input.status,
        workLocation: input.workLocation,
        projectId: input.projectId,
        notes: input.notes,
        markedById: auth.userId,
      },
    });

    await recordAudit(tx, ctx, {
      action: 'UPDATE',
      entityType: 'Attendance',
      entityId: saved.id,
      summary: `Attendance marked for ${input.date}`,
      newData: saved,
    });

    return saved;
  });

  return record;
}

export function getAttendanceSummary(
  organizationId: string,
  query: { userId?: string; from?: string; to?: string },
) {
  const date = dateRangeFilter(query.from, query.to);
  return prisma.attendance.groupBy({
    by: ['status'],
    where: andWhere(
      { organizationId },
      query.userId ? { userId: query.userId } : undefined,
      date ? { date } : undefined,
    ),
    _count: { _all: true },
    _sum: { workingMinutes: true, breakMinutes: true },
  });
}

export function listLeaveRequests(
  organizationId: string,
  query: {
    page?: number;
    limit?: number;
    userId?: string;
    status?: LeaveStatus;
    from?: string;
    to?: string;
  },
) {
  const startDate = dateRangeFilter(query.from, query.to);
  return paginate(prisma.leaveRequest, {
    where: andWhere(
      { organizationId },
      query.userId ? { userId: query.userId } : undefined,
      query.status ? { status: query.status } : undefined,
      startDate ? { startDate } : undefined,
    ),
    orderBy: { createdAt: 'desc' },
    page: query.page,
    limit: query.limit,
    include: {
      user: { select: { id: true, fullName: true } },
      reviewer: { select: { id: true, fullName: true } },
    },
  });
}

export async function requestLeave(
  auth: AuthContext,
  input: { type?: LeaveType; startDate: string; endDate: string; reason?: string },
  ctx: AuditRequestContext,
) {
  const start = toDateOnly(input.startDate);
  const end = toDateOnly(input.endDate);
  if (end < start) throw badRequest('endDate cannot be before startDate');

  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;

  const overlapping = await prisma.leaveRequest.count({
    where: {
      userId: auth.userId,
      status: { in: ['PENDING', 'APPROVED'] },
      startDate: { lte: end },
      endDate: { gte: start },
    },
  });
  if (overlapping > 0) throw conflict('You already have a leave request covering these dates');

  const leave = await prisma.leaveRequest.create({
    data: {
      organizationId: auth.organizationId,
      userId: auth.userId,
      type: input.type ?? LeaveType.CASUAL,
      startDate: start,
      endDate: end,
      days,
      reason: input.reason,
    },
  });

  await recordAudit(prisma, ctx, {
    action: 'CREATE',
    entityType: 'LeaveRequest',
    entityId: leave.id,
    summary: `Leave requested ${input.startDate} to ${input.endDate}`,
    newData: leave,
  });

  return leave;
}

export async function reviewLeave(
  auth: AuthContext,
  id: string,
  decision: 'APPROVE' | 'REJECT',
  note: string | undefined,
  ctx: AuditRequestContext,
) {
  return prisma.$transaction(async (tx) => {
    const leave = await tx.leaveRequest.findFirst({
      where: { id, organizationId: auth.organizationId },
    });
    if (!leave) throw notFound('Leave request');
    if (leave.status !== 'PENDING') throw conflict(`Leave request is already ${leave.status}`);
    if (leave.userId === auth.userId) throw conflict('You cannot review your own leave request');

    const updated = await tx.leaveRequest.update({
      where: { id },
      data: {
        status: decision === 'APPROVE' ? LeaveStatus.APPROVED : LeaveStatus.REJECTED,
        reviewerId: auth.userId,
        reviewedAt: new Date(),
        reviewNote: note,
      },
    });

    await recordAudit(tx, ctx, {
      action: decision === 'APPROVE' ? 'APPROVE' : 'REJECT',
      entityType: 'LeaveRequest',
      entityId: id,
      summary: `Leave ${updated.status.toLowerCase()}`,
      oldData: { status: leave.status },
      newData: { status: updated.status, note },
    });

    return updated;
  });
}
