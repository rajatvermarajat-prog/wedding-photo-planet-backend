import { ExpenseApprovalStatus, PaymentMethod, Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { andWhere, findScoped, paginate, searchFilter } from '../repositories/base.repository';
import { resolveSort } from '../utils/pagination';
import { badRequest, conflict, notFound } from '../utils/errors';
import { dateRangeFilter, toDateOnly } from '../utils/date';
import { startOfMonth } from '../utils/date';
import { money, round2, ZERO } from '../utils/money';
import { AuthContext } from '../types';
import { AuditRequestContext, recordAudit } from './audit.service';

const SORTABLE = ['expenseDate', 'createdAt', 'amount'] as const;
export function withPaymentStatus<T extends { amount: Prisma.Decimal; paidAmount: Prisma.Decimal }>(expense: T) { const amount = Number(expense.amount); const paid = Number(expense.paidAmount); return { ...expense, paymentStatus: paid >= amount ? 'Paid' : paid > 0 ? 'Partial' : 'Unpaid' }; }

export interface ExpenseListQuery {
  page?: number;
  limit?: number;
  search?: string;
  projectId?: string;
  categoryId?: string;
  approvalStatus?: ExpenseApprovalStatus;
  scope?: 'PROJECT' | 'GENERAL';
  freelancerId?: string;
  from?: string;
  to?: string;
  sortBy?: string;
  sortOrder?: string;
}

export function listExpenses(organizationId: string, query: ExpenseListQuery) {
  const sort = resolveSort(query.sortBy, query.sortOrder, SORTABLE, 'expenseDate');
  const expenseDate = dateRangeFilter(query.from, query.to);
  return paginate(prisma.expense, {
    where: andWhere(
      { organizationId, deletedAt: null },
      query.projectId ? { projectId: query.projectId } : undefined,
      query.categoryId ? { categoryId: query.categoryId } : undefined,
      query.approvalStatus ? { approvalStatus: query.approvalStatus } : undefined,
      query.freelancerId ? { freelancerId: query.freelancerId } : undefined,
      // §19: a project expense is attributed; a general studio expense is not.
      query.scope === 'PROJECT'
        ? { projectId: { not: null } }
        : query.scope === 'GENERAL'
          ? { projectId: null }
          : undefined,
      expenseDate ? { expenseDate } : undefined,
      searchFilter(query.search, ['description', 'vendor']),
    ),
    orderBy: { [sort.field]: sort.direction },
    page: query.page,
    limit: query.limit,
    include: {
      category: { select: { id: true, name: true } },
      project: { select: { id: true, projectNumber: true, name: true } },
      createdBy: { select: { id: true, fullName: true } },
      approvedBy: { select: { id: true, fullName: true } },
      payments: true,
    },
  });
}

export function getExpense(organizationId: string, id: string) {
  return findScoped(prisma.expense, organizationId, id, 'Expense', {
    include: {
      category: true,
      project: { select: { id: true, projectNumber: true, name: true } },
      shoot: { select: { id: true, title: true, shootDate: true } },
      freelancer: { select: { id: true, fullName: true, code: true } },
      attachments: { include: { file: true } },
      createdBy: { select: { id: true, fullName: true } },
      approvedBy: { select: { id: true, fullName: true } },
      payments: { orderBy: { paidAt: 'desc' } },
    },
  });
}

export interface CreateExpenseInput {
  categoryId: string;
  amount: Prisma.Decimal.Value;
  subcategory?: string;
  paidAmount?: Prisma.Decimal.Value;
  expenseDate: string;
  projectId?: string;
  shootId?: string;
  branchId?: string;
  freelancerId?: string;
  taxAmount?: Prisma.Decimal.Value;
  vendor?: string;
  paymentMethod?: PaymentMethod;
  description?: string;
  submit?: boolean;
}

export async function createExpense(
  auth: AuthContext,
  input: CreateExpenseInput,
  ctx: AuditRequestContext,
) {
  if (round2(money(input.amount)).lessThanOrEqualTo(ZERO())) {
    throw badRequest('Expense amount must be greater than zero');
  }

  return prisma.$transaction(async (tx) => {
    const category = await tx.expenseCategory.findFirst({
      where: { id: input.categoryId, organizationId: auth.organizationId },
      select: { id: true },
    });
    if (!category) throw notFound('Expense category');

    if (input.projectId) {
      const project = await tx.project.findFirst({
        where: { id: input.projectId, organizationId: auth.organizationId, deletedAt: null },
        select: { id: true },
      });
      if (!project) throw notFound('Project');
    }

    const expense = await tx.expense.create({
      data: {
        organizationId: auth.organizationId,
        branchId: input.branchId ?? auth.branchId,
        projectId: input.projectId,
        shootId: input.shootId,
        freelancerId: input.freelancerId,
        categoryId: input.categoryId,
        amount: round2(money(input.amount)), subcategory: input.subcategory, paidAmount: round2(money(input.paidAmount ?? 0)),
        taxAmount: round2(money(input.taxAmount ?? 0)),
        expenseDate: toDateOnly(input.expenseDate),
        vendor: input.vendor,
        paymentMethod: input.paymentMethod ?? 'CASH',
        description: input.description,
        approvalStatus: input.submit
          ? ExpenseApprovalStatus.SUBMITTED
          : ExpenseApprovalStatus.DRAFT,
        createdById: auth.userId,
      },
      include: { category: { select: { name: true } }, payments: true },
    });

    await recordAudit(tx, ctx, {
      action: 'CREATE',
      entityType: 'Expense',
      entityId: expense.id,
      summary: `Expense of ${String(expense.amount)} created`,
      newData: expense,
    });

    return expense;
  });
}

export async function updateExpense(
  auth: AuthContext,
  id: string,
  input: Partial<CreateExpenseInput>,
  ctx: AuditRequestContext,
) {
  return prisma.$transaction(async (tx) => {
    const existing = await findScoped<{ id: string; approvalStatus: ExpenseApprovalStatus }>(
      tx.expense,
      auth.organizationId,
      id,
      'Expense',
    );

    if (existing.approvalStatus === 'APPROVED') {
      // An approved expense is already part of project profitability.
      throw conflict('An approved expense can no longer be edited');
    }

    const updated = await tx.expense.update({
      where: { id },
      data: {
        categoryId: input.categoryId,
        amount: input.amount === undefined ? undefined : round2(money(input.amount)), subcategory: input.subcategory,
        taxAmount: input.taxAmount === undefined ? undefined : round2(money(input.taxAmount)),
        expenseDate: input.expenseDate ? toDateOnly(input.expenseDate) : undefined,
        projectId: input.projectId,
        shootId: input.shootId,
        vendor: input.vendor,
        paymentMethod: input.paymentMethod,
        description: input.description,
        approvalStatus: input.submit ? ExpenseApprovalStatus.SUBMITTED : undefined,
      },
    });

    await recordAudit(tx, ctx, {
      action: 'UPDATE',
      entityType: 'Expense',
      entityId: id,
      summary: 'Expense updated',
      oldData: existing,
      newData: updated,
    });

    return updated;
  });
}

/**
 * Approval or rejection. The status change, the approver stamp, the notifi-
 * cation to the submitter and the audit row commit together (§34) — and the
 * `expenses_approval_metadata_complete` CHECK constraint means an APPROVED row
 * without an approver cannot exist even if this code were bypassed.
 */
export async function reviewExpense(
  auth: AuthContext,
  id: string,
  decision: 'APPROVE' | 'REJECT',
  reason: string | undefined,
  ctx: AuditRequestContext,
) {
  if (decision === 'REJECT' && !reason) {
    throw badRequest('A reason is required when rejecting an expense');
  }

  return prisma.$transaction(async (tx) => {
    const expense = await findScoped<{
      id: string;
      approvalStatus: ExpenseApprovalStatus;
      createdById: string | null;
      amount: Prisma.Decimal;
    }>(tx.expense, auth.organizationId, id, 'Expense');

    if (expense.approvalStatus === 'APPROVED') throw conflict('Expense is already approved');
    if (expense.approvalStatus === 'DRAFT') {
      throw conflict('This expense has not been submitted for approval yet');
    }
    if (expense.createdById === auth.userId) {
      // Separation of duties: a submitter cannot approve their own spend.
      throw conflict('You cannot approve an expense you submitted');
    }

    const approved = decision === 'APPROVE';

    const updated = await tx.expense.update({
      where: { id },
      data: {
        approvalStatus: approved
          ? ExpenseApprovalStatus.APPROVED
          : ExpenseApprovalStatus.REJECTED,
        approvedById: approved ? auth.userId : null,
        approvedAt: approved ? new Date() : null,
        rejectionReason: approved ? null : reason,
      },
    });

    if (expense.createdById) {
      await tx.notification.create({
        data: {
          organizationId: auth.organizationId,
          userId: expense.createdById,
          type: approved ? 'EXPENSE_APPROVED' : 'EXPENSE_REJECTED',
          title: approved ? 'Expense approved' : 'Expense rejected',
          message: approved
            ? `Your expense of ${String(expense.amount)} was approved.`
            : `Your expense of ${String(expense.amount)} was rejected: ${reason}`,
          entityType: 'Expense',
          entityId: id,
        },
      });
    }

    await recordAudit(tx, ctx, {
      action: approved ? 'APPROVE' : 'REJECT',
      entityType: 'Expense',
      entityId: id,
      summary: approved ? 'Expense approved' : `Expense rejected: ${reason}`,
      oldData: { approvalStatus: expense.approvalStatus },
      newData: { approvalStatus: updated.approvalStatus, reason },
    });

    return updated;
  });
}

export async function deleteExpense(auth: AuthContext, id: string, ctx: AuditRequestContext) {
  return prisma.$transaction(async (tx) => {
    const expense = await findScoped<{ id: string; approvalStatus: ExpenseApprovalStatus }>(
      tx.expense,
      auth.organizationId,
      id,
      'Expense',
    );
    if (expense.approvalStatus === 'APPROVED') {
      throw conflict('An approved expense cannot be deleted');
    }
    const payout = await tx.freelancerPayout.findUnique({ where: { expenseId: id } });
    if (payout) throw conflict('This expense backs a freelancer payout and cannot be deleted');

    await tx.expense.update({
      where: { id },
      data: { deletedAt: new Date(), deletedBy: auth.userId },
    });
    await recordAudit(tx, ctx, {
      action: 'SOFT_DELETE',
      entityType: 'Expense',
      entityId: id,
      summary: 'Expense archived',
      oldData: expense,
    });
  });
}

export async function addExpensePayment(auth: AuthContext, id: string, input: { amount: Prisma.Decimal.Value; paidAt: string; method?: PaymentMethod; note?: string }, ctx: AuditRequestContext) {
  return prisma.$transaction(async tx => { const expense = await findScoped<{ id: string; amount: Prisma.Decimal }>(tx.expense, auth.organizationId, id, 'Expense'); const payment = await tx.expensePayment.create({ data: { expenseId: id, amount: round2(money(input.amount)), paidAt: toDateOnly(input.paidAt), method: input.method ?? 'CASH', note: input.note } }); const total = await tx.expensePayment.aggregate({ where: { expenseId: id }, _sum: { amount: true } }); if (Number(total._sum.amount ?? 0) > Number(expense.amount)) throw badRequest('Payment total cannot exceed expense amount'); const updated = await tx.expense.update({ where: { id }, data: { paidAmount: total._sum.amount ?? 0 }, include: { payments: true } }); await recordAudit(tx, ctx, { action: 'CREATE', entityType: 'ExpensePayment', entityId: payment.id, summary: 'Expense payment recorded', newData: payment }); return withPaymentStatus(updated); });
}

export function listExpenseCategories(organizationId: string) {
  return prisma.expenseCategory.findMany({
    where: { organizationId, isActive: true },
    orderBy: { name: 'asc' },
  });
}

export function createExpenseCategory(
  organizationId: string,
  input: { name: string; description?: string },
) {
  return prisma.expenseCategory.create({ data: { organizationId, ...input } });
}

export async function summary(organizationId: string) {
  const now = new Date(); const month = startOfMonth(now); const year = new Date(Date.UTC(now.getUTCFullYear(), 0, 1)); const where = { organizationId, deletedAt: null };
  const [monthTotal, yearTotal, categories] = await prisma.$transaction([
    prisma.expense.aggregate({ where: { ...where, expenseDate: { gte: month } }, _sum: { amount: true }, _count: true }),
    prisma.expense.aggregate({ where: { ...where, expenseDate: { gte: year } }, _sum: { amount: true }, _count: true }),
    prisma.expense.groupBy({ by: ['categoryId'], orderBy: { categoryId: 'asc' }, where: { ...where, expenseDate: { gte: month } }, _sum: { amount: true }, _count: true }),
  ]);
  return { month: { total: monthTotal._sum.amount ?? 0, count: monthTotal._count }, year: { total: yearTotal._sum.amount ?? 0, count: yearTotal._count }, categories };
}
