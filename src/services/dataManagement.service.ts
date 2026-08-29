import { prisma } from '../config/prisma';
import { dateRangeFilter } from '../utils/date';
import { money, round2 } from '../utils/money';

/**
 * Every figure below is produced by a PostgreSQL aggregate. No endpoint here
 * loads rows into Node to count or total them (§30), and nothing is fabricated
 * to make the UI look populated — a studio with no data gets accurate zeroes
 * and empty arrays (§29).
 *
 * Money is emitted as an exact decimal string (`"70000"`, `"1234.5"`) — the
 * same representation entity endpoints use, so a client never has to handle
 * two shapes. Format for display on the client; never parse into a float
 * before doing arithmetic.
 */

export interface OverviewQuery {
  from?: string;
  to?: string;
  limit?: number;
}

interface ProfitabilityRow {
  id: string;
  project_number: string;
  name: string;
  status: string;
  wedding_date: Date | null;
  quoted: string;
  revenue: string;
  expenses: string;
  crew_committed: string;
  profit: string;
}

interface StorageRow {
  total_gb: string | null;
  received_gb: string | null;
  shoots_with_data: bigint;
  shoots_backed_up: bigint;
}

export async function getOverview(organizationId: string, query: OverviewQuery) {
  const range = dateRangeFilter(query.from, query.to);
  const now = new Date();
  const limit = Math.min(Math.max(query.limit ?? 10, 1), 50);

  const projectWhere = { organizationId, deletedAt: null, ...(range ? { createdAt: range } : {}) };
  const shootWhere = { organizationId, deletedAt: null, ...(range ? { shootDate: range } : {}) };

  const [
    projectsByStatus,
    shootsByStatus,
    upcomingShoots,
    deliveriesByStatus,
    tasksByStatus,
    overdueTasks,
    paymentsAgg,
    expensesAgg,
    invoiceAgg,
    invoicesByStatus,
    assignmentsByRole,
    storageRows,
    profitability,
  ] = await Promise.all([
    prisma.project.groupBy({
      by: ['status'],
      where: projectWhere,
      _count: { _all: true },
      _sum: { totalQuotation: true },
    }),
    prisma.shoot.groupBy({ by: ['status'], where: shootWhere, _count: { _all: true } }),
    prisma.shoot.count({
      where: { organizationId, deletedAt: null, shootDate: { gte: now }, status: 'SCHEDULED' },
    }),
    prisma.delivery.groupBy({
      by: ['status'],
      where: { organizationId, deletedAt: null },
      _count: { _all: true },
    }),
    prisma.task.groupBy({
      by: ['status'],
      where: { organizationId, deletedAt: null },
      _count: { _all: true },
    }),
    prisma.task.count({
      where: {
        organizationId,
        deletedAt: null,
        dueDate: { lt: now },
        status: { notIn: ['COMPLETED', 'CANCELLED'] },
      },
    }),
    prisma.payment.aggregate({
      where: { organizationId, status: 'COMPLETED', ...(range ? { paymentDate: range } : {}) },
      _sum: { amount: true },
      _count: { _all: true },
    }),
    prisma.expense.aggregate({
      where: {
        organizationId,
        deletedAt: null,
        approvalStatus: 'APPROVED',
        ...(range ? { expenseDate: range } : {}),
      },
      _sum: { amount: true, taxAmount: true },
      _count: { _all: true },
    }),
    prisma.invoice.aggregate({
      where: { organizationId, status: { notIn: ['DRAFT', 'CANCELLED'] } },
      _sum: { total: true, amountPaid: true, amountDue: true },
    }),
    prisma.invoice.groupBy({
      by: ['status'],
      where: { organizationId },
      _count: { _all: true },
      _sum: { total: true, amountDue: true },
    }),
    prisma.shootAssignment.groupBy({
      by: ['role', 'status'],
      where: { shoot: { organizationId, deletedAt: null, ...(range ? { shootDate: range } : {}) } },
      _count: { _all: true },
    }),
    prisma.$queryRaw<StorageRow[]>`
      SELECT SUM(s.data_size_gb)                                        AS total_gb,
             SUM(s.data_size_gb) FILTER (WHERE s.data_received_at IS NOT NULL) AS received_gb,
             COUNT(*) FILTER (WHERE s.data_received_at IS NOT NULL)     AS shoots_with_data,
             COUNT(*) FILTER (WHERE s.backup_done_at IS NOT NULL)       AS shoots_backed_up
        FROM shoots s
       WHERE s.organization_id = ${organizationId}::uuid
         AND s.deleted_at IS NULL`,
    getProfitability(organizationId, limit),
  ]);

  const countBy = <T extends { _count: { _all: number } }>(
    rows: T[],
    key: keyof T,
  ): Record<string, number> =>
    Object.fromEntries(rows.map((row) => [String(row[key]), row._count._all]));

  const revenue = round2(money(paymentsAgg._sum.amount ?? 0));
  const expenseTotal = round2(
    money(expensesAgg._sum.amount ?? 0).plus(expensesAgg._sum.taxAmount ?? 0),
  );

  const projectStatusCounts = countBy(projectsByStatus, 'status');
  const deliveryStatusCounts = countBy(deliveriesByStatus, 'status');
  const taskStatusCounts = countBy(tasksByStatus, 'status');
  const shootStatusCounts = countBy(shootsByStatus, 'status');

  const activeProjects =
    (projectStatusCounts.CONFIRMED ?? 0) +
    (projectStatusCounts.PLANNING ?? 0) +
    (projectStatusCounts.SHOOTING ?? 0) +
    (projectStatusCounts.EDITING ?? 0) +
    (projectStatusCounts.DELIVERY ?? 0);

  const storage = storageRows[0];

  return {
    range: { from: query.from ?? null, to: query.to ?? null },
    projects: {
      total: projectsByStatus.reduce((acc, r) => acc + r._count._all, 0),
      active: activeProjects,
      completed: projectStatusCounts.COMPLETED ?? 0,
      cancelled: projectStatusCounts.CANCELLED ?? 0,
      byStatus: projectStatusCounts,
      quotedValue: round2(
        projectsByStatus.reduce((acc, r) => acc.plus(r._sum.totalQuotation ?? 0), money(0)),
      ).toString(),
    },
    shoots: {
      total: shootsByStatus.reduce((acc, r) => acc + r._count._all, 0),
      completed: shootStatusCounts.COMPLETED ?? 0,
      upcoming: upcomingShoots,
      cancelled: shootStatusCounts.CANCELLED ?? 0,
      byStatus: shootStatusCounts,
    },
    deliveries: {
      total: deliveriesByStatus.reduce((acc, r) => acc + r._count._all, 0),
      delivered: deliveryStatusCounts.DELIVERED ?? 0,
      pending:
        (deliveryStatusCounts.PENDING ?? 0) +
        (deliveryStatusCounts.IN_PROGRESS ?? 0) +
        (deliveryStatusCounts.READY ?? 0) +
        (deliveryStatusCounts.REWORK ?? 0),
      byStatus: deliveryStatusCounts,
    },
    tasks: {
      total: tasksByStatus.reduce((acc, r) => acc + r._count._all, 0),
      pending:
        (taskStatusCounts.TODO ?? 0) +
        (taskStatusCounts.ASSIGNED ?? 0) +
        (taskStatusCounts.IN_PROGRESS ?? 0) +
        (taskStatusCounts.PAUSED ?? 0) +
        (taskStatusCounts.IN_REVIEW ?? 0),
      completed: taskStatusCounts.COMPLETED ?? 0,
      overdue: overdueTasks,
      byStatus: taskStatusCounts,
    },
    finance: {
      revenueCollected: revenue.toString(),
      paymentCount: paymentsAgg._count._all,
      expensesApproved: expenseTotal.toString(),
      expenseCount: expensesAgg._count._all,
      netMargin: round2(revenue.minus(expenseTotal)).toString(),
      invoiced: round2(money(invoiceAgg._sum.total ?? 0)).toString(),
      invoicePaid: round2(money(invoiceAgg._sum.amountPaid ?? 0)).toString(),
      outstanding: round2(money(invoiceAgg._sum.amountDue ?? 0)).toString(),
      invoicesByStatus: Object.fromEntries(
        invoicesByStatus.map((row) => [
          row.status,
          {
            count: row._count._all,
            total: round2(money(row._sum.total ?? 0)).toString(),
            due: round2(money(row._sum.amountDue ?? 0)).toString(),
          },
        ]),
      ),
    },
    teamAssignments: assignmentsByRole.map((row) => ({
      role: row.role,
      status: row.status,
      count: row._count._all,
    })),
    storage: {
      totalDataGb: storage?.total_gb ? Number(storage.total_gb) : 0,
      receivedDataGb: storage?.received_gb ? Number(storage.received_gb) : 0,
      shootsWithDataReceived: Number(storage?.shoots_with_data ?? 0),
      shootsBackedUp: Number(storage?.shoots_backed_up ?? 0),
    },
    projectProfitability: profitability,
  };
}

/**
 * Per-project P&L computed entirely in PostgreSQL (§20).
 *
 *   revenue        = completed client payments attributed to the project
 *   expenses       = approved project expenses, freelancer payouts included
 *                    (each payout writes exactly one expense row)
 *   crewCommitted  = agreed crew cost from shoot assignments — shown for
 *                    forecasting; it is NOT subtracted, because settled crew
 *                    cost already appears in `expenses`
 */
export async function getProfitability(organizationId: string, limit = 10, projectId?: string) {
  const rows = await prisma.$queryRaw<ProfitabilityRow[]>`
    SELECT p.id,
           p.project_number,
           p.name,
           p.status::text                              AS status,
           p.wedding_date,
           p.total_quotation::text                     AS quoted,
           COALESCE(rev.revenue, 0)::text              AS revenue,
           COALESCE(exp.expenses, 0)::text             AS expenses,
           COALESCE(crew.committed, 0)::text           AS crew_committed,
           (COALESCE(rev.revenue, 0) - COALESCE(exp.expenses, 0))::text AS profit
      FROM projects p
      LEFT JOIN (
            SELECT project_id, SUM(amount) AS revenue
              FROM payments
             WHERE organization_id = ${organizationId}::uuid
               AND status = 'COMPLETED'
               AND project_id IS NOT NULL
             GROUP BY project_id
           ) rev ON rev.project_id = p.id
      LEFT JOIN (
            SELECT project_id, SUM(amount + tax_amount) AS expenses
              FROM expenses
             WHERE organization_id = ${organizationId}::uuid
               AND approval_status = 'APPROVED'
               AND deleted_at IS NULL
               AND project_id IS NOT NULL
             GROUP BY project_id
           ) exp ON exp.project_id = p.id
      LEFT JOIN (
            SELECT s.project_id,
                   SUM(sa.agreed_amount + sa.travel_amount + sa.extra_amount) AS committed
              FROM shoot_assignments sa
              JOIN shoots s ON s.id = sa.shoot_id
             WHERE s.organization_id = ${organizationId}::uuid
               AND s.deleted_at IS NULL
               AND sa.status NOT IN ('CANCELLED', 'DECLINED')
             GROUP BY s.project_id
           ) crew ON crew.project_id = p.id
     WHERE p.organization_id = ${organizationId}::uuid
       AND p.deleted_at IS NULL
       AND (${projectId ?? null}::uuid IS NULL OR p.id = ${projectId ?? null}::uuid)
     ORDER BY (COALESCE(rev.revenue, 0) - COALESCE(exp.expenses, 0)) DESC
     LIMIT ${limit}`;

  return rows.map((row) => ({
    projectId: row.id,
    projectNumber: row.project_number,
    name: row.name,
    status: row.status,
    weddingDate: row.wedding_date,
    quoted: row.quoted,
    revenue: row.revenue,
    expenses: row.expenses,
    crewCommitted: row.crew_committed,
    profit: row.profit,
  }));
}

/** Per-project data-backup posture, driving the Data Management screen. */
export async function getProjectDataStatus(
  organizationId: string,
  query: { page?: number; limit?: number },
) {
  const limit = Math.min(Math.max(query.limit ?? 25, 1), 100);
  const page = Math.max(query.page ?? 1, 1);

  const [projects, total] = await prisma.$transaction([
    prisma.project.findMany({
      where: { organizationId, deletedAt: null },
      orderBy: { weddingDate: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true,
        projectNumber: true,
        name: true,
        status: true,
        weddingDate: true,
        client: { select: { id: true, displayName: true } },
        shoots: {
          where: { deletedAt: null },
          select: {
            id: true,
            title: true,
            shootDate: true,
            status: true,
            dataSizeGb: true,
            dataReceivedAt: true,
            backupDoneAt: true,
            assignments: {
              select: {
                id: true,
                role: true,
                dataReceived: true,
                dataSizeGb: true,
                storageReference: true,
                notes: true,
                user: { select: { id: true, fullName: true } },
                freelancer: { select: { id: true, fullName: true } },
              },
            },
          },
        },
      },
    }),
    prisma.project.count({ where: { organizationId, deletedAt: null } }),
  ]);

  const items = projects.map((project) => {
    const totalGb = project.shoots.reduce((acc, s) => acc.plus(s.dataSizeGb ?? 0), money(0));
    const received = project.shoots.filter((s) => s.dataReceivedAt !== null).length;
    const backedUp = project.shoots.filter((s) => s.backupDoneAt !== null).length;
    return {
      ...project,
      summary: {
        shootCount: project.shoots.length,
        dataReceivedCount: received,
        backupCompleteCount: backedUp,
        pendingDataCount: project.shoots.length - received,
        totalDataGb: round2(totalGb).toString(),
      },
    };
  });

  return { items, total, page, limit };
}
