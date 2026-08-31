import { prisma } from '../config/prisma';
import { AuthContext } from '../types';
import { canAccessAllLeads } from './lead.service';
import { dateRangeFilter } from '../utils/date';
import { money, round2 } from '../utils/money';

interface MonthlyRow {
  month: Date;
  revenue: string;
  expenses: string;
}

/** Revenue vs. expense by calendar month — a single grouped SQL pass (§30). */
export async function getMonthlyFinancials(
  organizationId: string,
  query: { from?: string; to?: string },
) {
  const from = query.from ? new Date(`${query.from}T00:00:00Z`) : new Date(Date.UTC(new Date().getUTCFullYear(), 0, 1));
  const to = query.to ? new Date(`${query.to}T00:00:00Z`) : new Date();

  const rows = await prisma.$queryRaw<MonthlyRow[]>`
    WITH months AS (
      SELECT generate_series(date_trunc('month', ${from}::timestamptz),
                             date_trunc('month', ${to}::timestamptz),
                             interval '1 month') AS month
    ),
    revenue AS (
      SELECT date_trunc('month', payment_date::timestamptz) AS month, SUM(amount) AS total
        FROM payments
       WHERE organization_id = ${organizationId}::uuid AND status = 'COMPLETED'
       GROUP BY 1
    ),
    costs AS (
      SELECT date_trunc('month', expense_date::timestamptz) AS month, SUM(amount + tax_amount) AS total
        FROM expenses
       WHERE organization_id = ${organizationId}::uuid
         AND approval_status = 'APPROVED' AND deleted_at IS NULL
       GROUP BY 1
    )
    SELECT m.month,
           COALESCE(r.total, 0)::text AS revenue,
           COALESCE(c.total, 0)::text AS expenses
      FROM months m
      LEFT JOIN revenue r ON r.month = m.month
      LEFT JOIN costs   c ON c.month = m.month
     ORDER BY m.month`;

  return rows.map((row) => ({
    month: row.month.toISOString().slice(0, 7),
    revenue: row.revenue,
    expenses: row.expenses,
    net: round2(money(row.revenue).minus(row.expenses)).toString(),
  }));
}

export async function getLeadFunnel(auth: AuthContext, query: { from?: string; to?: string }) {
  const createdAt = dateRangeFilter(query.from, query.to);
  const leadScope = {
    organizationId: auth.organizationId,
    deletedAt: null,
    ...(canAccessAllLeads(auth) ? {} : { ownerId: auth.userId }),
  };
  const [byStatus, bySource] = await Promise.all([
    prisma.lead.groupBy({
      by: ['status'],
      where: { ...leadScope, ...(createdAt ? { createdAt } : {}) },
      _count: { _all: true },
      _sum: { estimatedValue: true },
    }),
    prisma.lead.groupBy({
      by: ['sourceId'],
      where: { ...leadScope, ...(createdAt ? { createdAt } : {}) },
      _count: { _all: true },
    }),
  ]);

  const sourceIds = bySource.map((r) => r.sourceId).filter((id): id is string => Boolean(id));
  const sources = sourceIds.length
    ? await prisma.leadSource.findMany({
        where: { id: { in: sourceIds } },
        select: { id: true, name: true },
      })
    : [];
  const nameOf = new Map(sources.map((s) => [s.id, s.name]));

  const total = byStatus.reduce((acc, r) => acc + r._count._all, 0);
  const won = byStatus.find((r) => r.status === 'WON')?._count._all ?? 0;

  return {
    total,
    won,
    conversionRate: total > 0 ? Number(((won / total) * 100).toString()) : 0,
    byStatus: byStatus.map((r) => ({
      status: r.status,
      count: r._count._all,
      estimatedValue: round2(money(r._sum.estimatedValue ?? 0)).toString(),
    })),
    bySource: bySource.map((r) => ({
      sourceId: r.sourceId,
      source: r.sourceId ? (nameOf.get(r.sourceId) ?? 'Unknown') : 'Unattributed',
      count: r._count._all,
    })),
  };
}

export async function getTeamWorkload(organizationId: string, query: { from?: string; to?: string }) {
  const range = dateRangeFilter(query.from, query.to);

  const [tasks, shoots] = await Promise.all([
    prisma.task.groupBy({
      by: ['assigneeId', 'status'],
      where: {
        organizationId,
        deletedAt: null,
        assigneeId: { not: null },
        ...(range ? { createdAt: range } : {}),
      },
      _count: { _all: true },
    }),
    prisma.shootAssignment.groupBy({
      by: ['userId'],
      where: {
        userId: { not: null },
        shoot: { organizationId, deletedAt: null, ...(range ? { shootDate: range } : {}) },
      },
      _count: { _all: true },
    }),
  ]);

  const userIds = [
    ...new Set([
      ...tasks.map((t) => t.assigneeId).filter((id): id is string => Boolean(id)),
      ...shoots.map((s) => s.userId).filter((id): id is string => Boolean(id)),
    ]),
  ];
  if (userIds.length === 0) return [];

  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, fullName: true, employeeCode: true },
  });

  return users.map((user) => {
    const userTasks = tasks.filter((t) => t.assigneeId === user.id);
    return {
      userId: user.id,
      fullName: user.fullName,
      employeeCode: user.employeeCode,
      shootAssignments: shoots.find((s) => s.userId === user.id)?._count._all ?? 0,
      tasksTotal: userTasks.reduce((acc, t) => acc + t._count._all, 0),
      tasksByStatus: Object.fromEntries(userTasks.map((t) => [t.status, t._count._all])),
    };
  });
}

export async function getReceivablesAging(organizationId: string) {
  const rows = await prisma.$queryRaw<Array<{ bucket: string; count: bigint; amount: string }>>`
    SELECT CASE
             WHEN due_date IS NULL                       THEN 'no_due_date'
             WHEN due_date >= CURRENT_DATE               THEN 'current'
             WHEN due_date >= CURRENT_DATE - INTERVAL '30 days' THEN '1_30'
             WHEN due_date >= CURRENT_DATE - INTERVAL '60 days' THEN '31_60'
             WHEN due_date >= CURRENT_DATE - INTERVAL '90 days' THEN '61_90'
             ELSE '90_plus'
           END                     AS bucket,
           COUNT(*)                AS count,
           SUM(amount_due)::text   AS amount
      FROM invoices
     WHERE organization_id = ${organizationId}::uuid
       AND status IN ('SENT', 'PARTIALLY_PAID', 'OVERDUE')
       AND amount_due > 0
     GROUP BY 1
     ORDER BY 1`;

  return rows.map((row) => ({
    bucket: row.bucket,
    count: Number(row.count),
    amount: row.amount,
  }));
}
