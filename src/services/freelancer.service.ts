import { CrewRole, FreelancerStatus, PaymentMethod, Prisma, RateType } from '@prisma/client';
import { prisma } from '../config/prisma';
import { andWhere, findScoped, paginate, searchFilter } from '../repositories/base.repository';
import { resolveSort } from '../utils/pagination';
import { nextDocumentNumber } from '../utils/documentNumber';
import { badRequest, conflict, notFound } from '../utils/errors';
import { toDateOnly } from '../utils/date';
import { money, round2, ZERO } from '../utils/money';
import { AuthContext } from '../types';
import { AuditRequestContext, recordAudit } from './audit.service';

const SORTABLE = ['createdAt', 'fullName', 'rate', 'rating'] as const;

export function listFreelancers(
  organizationId: string,
  query: {
    page?: number;
    limit?: number;
    search?: string;
    status?: FreelancerStatus;
    primarySkill?: CrewRole;
    city?: string;
    sortBy?: string;
    sortOrder?: string;
  },
) {
  const sort = resolveSort(query.sortBy, query.sortOrder, SORTABLE, 'createdAt');
  return paginate(prisma.freelancer, {
    where: andWhere(
      { organizationId, deletedAt: null },
      query.status ? { status: query.status } : undefined,
      query.primarySkill ? { primarySkill: query.primarySkill } : undefined,
      query.city ? { city: { equals: query.city, mode: 'insensitive' } } : undefined,
      searchFilter(query.search, ['fullName', 'phone', 'email', 'code', 'city']),
    ),
    orderBy: { [sort.field]: sort.direction },
    page: query.page,
    limit: query.limit,
    include: { _count: { select: { assignments: true } } },
  });
}

export function getFreelancer(organizationId: string, id: string) {
  return findScoped(prisma.freelancer, organizationId, id, 'Freelancer', {
    include: {
      assignments: {
        orderBy: { createdAt: 'desc' },
        take: 50,
        include: {
          shoot: {
            select: {
              id: true,
              title: true,
              shootDate: true,
              status: true,
              project: { select: { id: true, projectNumber: true, name: true } },
            },
          },
        },
      },
      payouts: { orderBy: { paymentDate: 'desc' }, take: 50 },
    },
  });
}

export interface CreateFreelancerInput {
  fullName: string;
  phone: string;
  whatsapp?: string;
  email?: string;
  city?: string;
  addressLine?: string;
  primarySkill?: CrewRole;
  skills?: string[];
  experienceYears?: number;
  rate?: Prisma.Decimal.Value;
  rateType?: RateType;
  travelAvailable?: boolean;
  maxShootsPerDay?: number;
  equipmentNotes?: string;
  paymentMethod?: PaymentMethod;
  upiId?: string;
  bankName?: string;
  accountHolder?: string;
  accountNumber?: string;
  ifsc?: string;
  panNumber?: string;
  gstNumber?: string;
  notes?: string;
}

export async function createFreelancer(
  auth: AuthContext,
  input: CreateFreelancerInput,
  ctx: AuditRequestContext,
) {
  return prisma.$transaction(async (tx) => {
    const code = await nextDocumentNumber(tx, auth.organizationId, 'FREELANCER');
    const freelancer = await tx.freelancer.create({
      data: {
        organizationId: auth.organizationId,
        code,
        ...input,
        email: input.email?.toLowerCase(),
        skills: input.skills ?? [],
      },
    });
    await recordAudit(tx, ctx, {
      action: 'CREATE',
      entityType: 'Freelancer',
      entityId: freelancer.id,
      summary: `Freelancer ${code} added`,
      newData: freelancer,
    });
    return freelancer;
  });
}

export async function updateFreelancer(
  auth: AuthContext,
  id: string,
  input: Partial<CreateFreelancerInput> & { status?: FreelancerStatus },
  ctx: AuditRequestContext,
) {
  return prisma.$transaction(async (tx) => {
    const existing = await findScoped<Record<string, unknown>>(
      tx.freelancer,
      auth.organizationId,
      id,
      'Freelancer',
    );
    const updated = await tx.freelancer.update({
      where: { id },
      data: { ...input, email: input.email?.toLowerCase() },
    });
    await recordAudit(tx, ctx, {
      action: 'UPDATE',
      entityType: 'Freelancer',
      entityId: id,
      summary: 'Freelancer updated',
      oldData: existing,
      newData: updated,
    });
    return updated;
  });
}

export async function deleteFreelancer(auth: AuthContext, id: string, ctx: AuditRequestContext) {
  return prisma.$transaction(async (tx) => {
    const freelancer = await findScoped<{ id: string; code: string }>(
      tx.freelancer,
      auth.organizationId,
      id,
      'Freelancer',
    );
    const upcoming = await tx.shootAssignment.count({
      where: {
        freelancerId: id,
        status: { notIn: ['COMPLETED', 'CANCELLED', 'DECLINED'] },
        shoot: { deletedAt: null, shootDate: { gte: new Date() } },
      },
    });
    if (upcoming > 0) {
      throw conflict(`This freelancer has ${upcoming} upcoming assignment(s). Reassign them first.`);
    }
    await tx.freelancer.update({
      where: { id },
      data: { deletedAt: new Date(), deletedBy: auth.userId, status: 'INACTIVE' },
    });
    await recordAudit(tx, ctx, {
      action: 'SOFT_DELETE',
      entityType: 'Freelancer',
      entityId: id,
      summary: `Freelancer ${freelancer.code} archived`,
      oldData: freelancer,
    });
  });
}

/**
 * Records a freelancer settlement.
 *
 * The payout and its backing Expense are written in one transaction and linked
 * 1:1, so `expenses` remains the single cost ledger and project profitability
 * counts crew cost exactly once (§14, §20). The expense is created already
 * APPROVED — the payout itself is the approval event.
 */
export async function recordPayout(
  auth: AuthContext,
  freelancerId: string,
  input: {
    amount: Prisma.Decimal.Value;
    paymentDate: string;
    assignmentId?: string;
    paymentMethod?: PaymentMethod;
    transactionRef?: string;
    notes?: string;
    categoryId: string;
  },
  ctx: AuditRequestContext,
) {
  const amount = round2(money(input.amount));
  if (amount.lessThanOrEqualTo(ZERO())) throw badRequest('Payout amount must be greater than zero');

  return prisma.$transaction(async (tx) => {
    const freelancer = await findScoped<{ id: string; code: string; fullName: string }>(
      tx.freelancer,
      auth.organizationId,
      freelancerId,
      'Freelancer',
    );

    const category = await tx.expenseCategory.findFirst({
      where: { id: input.categoryId, organizationId: auth.organizationId },
      select: { id: true },
    });
    if (!category) throw notFound('Expense category');

    let projectId: string | undefined;
    let shootId: string | undefined;

    if (input.assignmentId) {
      const assignment = await tx.shootAssignment.findFirst({
        where: {
          id: input.assignmentId,
          freelancerId,
          shoot: { organizationId: auth.organizationId },
        },
        include: { shoot: { select: { id: true, projectId: true } } },
      });
      if (!assignment) throw notFound('Shoot assignment');
      projectId = assignment.shoot.projectId;
      shootId = assignment.shoot.id;
    }

    const expense = await tx.expense.create({
      data: {
        organizationId: auth.organizationId,
        branchId: auth.branchId,
        projectId,
        shootId,
        freelancerId,
        categoryId: input.categoryId,
        amount,
        expenseDate: toDateOnly(input.paymentDate),
        vendor: freelancer.fullName,
        paymentMethod: input.paymentMethod ?? 'BANK_TRANSFER',
        description: `Freelancer payout — ${freelancer.code}${input.notes ? `: ${input.notes}` : ''}`,
        approvalStatus: 'APPROVED',
        createdById: auth.userId,
        approvedById: auth.userId,
        approvedAt: new Date(),
      },
    });

    const payout = await tx.freelancerPayout.create({
      data: {
        organizationId: auth.organizationId,
        freelancerId,
        assignmentId: input.assignmentId,
        expenseId: expense.id,
        amount,
        paymentDate: toDateOnly(input.paymentDate),
        paymentMethod: input.paymentMethod ?? 'BANK_TRANSFER',
        transactionRef: input.transactionRef,
        notes: input.notes,
        paidById: auth.userId,
      },
    });

    await recordAudit(tx, ctx, {
      action: 'PAYMENT_RECORDED',
      entityType: 'FreelancerPayout',
      entityId: payout.id,
      summary: `Payout of ${amount.toString()} to ${freelancer.code}`,
      newData: { payout, expenseId: expense.id },
    });

    return { payout, expense };
  });
}

/** Outstanding balance per assignment: agreed cost minus what has been paid. */
export async function getFreelancerLedger(organizationId: string, freelancerId: string) {
  const assignments = await prisma.shootAssignment.findMany({
    where: { freelancerId, shoot: { organizationId, deletedAt: null } },
    include: {
      shoot: { select: { id: true, title: true, shootDate: true, projectId: true } },
      payouts: { select: { amount: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  return assignments.map((assignment) => {
    const committed = round2(
      money(assignment.agreedAmount)
        .plus(assignment.travelAmount)
        .plus(assignment.extraAmount),
    );
    const paid = round2(
      assignment.payouts.reduce((acc, p) => acc.plus(p.amount), money(0)),
    );
    return {
      assignmentId: assignment.id,
      shoot: assignment.shoot,
      role: assignment.role,
      status: assignment.status,
      committed: committed.toString(),
      paid: paid.toString(),
      outstanding: round2(committed.minus(paid)).toString(),
    };
  });
}
