import { beforeEach, describe, expect, it } from 'vitest';
import { authed, base, login } from '../helpers/api';
import { prisma, resetDatabase, seedTestOrganization, TestOrg } from '../helpers/factory';

describe('operations: expenses, tasks, deliveries, data management', () => {
  let org: TestOrg;
  let adminToken: string;
  let managerToken: string;
  let memberToken: string;
  let projectId: string;
  let clientId: string;

  beforeEach(async () => {
    await resetDatabase();
    org = await seedTestOrganization();
    adminToken = await login(org.admin);
    managerToken = await login(org.manager);
    memberToken = await login(org.member);

    const client = await authed(adminToken)
      .post(`${base}/clients`)
      .send({ displayName: 'Test Couple', primaryPhone: '+919812345678' })
      .expect(201);
    clientId = client.body.data.id;

    const project = await authed(adminToken)
      .post(`${base}/projects`)
      .send({ clientId, name: 'Test Wedding', weddingDate: '2026-12-14' })
      .expect(201);
    projectId = project.body.data.id;
  });

  // --- Expenses -----------------------------------------------------------

  it('creates and approves an expense', async () => {
    const expense = await authed(memberToken)
      .post(`${base}/expenses`)
      .send({
        categoryId: org.expenseCategoryId,
        amount: '2500.00',
        expenseDate: '2026-01-15',
        projectId,
        vendor: 'Cab Service',
        submit: true,
      })
      .expect(201);

    expect(expense.body.data.approvalStatus).toBe('SUBMITTED');

    const approved = await authed(adminToken)
      .post(`${base}/expenses/${expense.body.data.id}/review`)
      .send({ decision: 'APPROVE' })
      .expect(200);

    expect(approved.body.data.approvalStatus).toBe('APPROVED');
    expect(approved.body.data.approvedById).toBe(org.admin.id);
    expect(approved.body.data.approvedAt).not.toBeNull();
  });

  it('prevents a submitter from approving their own expense', async () => {
    const expense = await authed(managerToken)
      .post(`${base}/expenses`)
      .send({
        categoryId: org.expenseCategoryId,
        amount: '2500.00',
        expenseDate: '2026-01-15',
        submit: true,
      })
      .expect(201);

    const response = await authed(managerToken)
      .post(`${base}/expenses/${expense.body.data.id}/review`)
      .send({ decision: 'APPROVE' });

    expect(response.status).toBe(409);
    expect(response.body.error.message).toMatch(/cannot approve an expense you submitted/i);
  });

  it('requires a reason when rejecting an expense', async () => {
    const expense = await authed(memberToken)
      .post(`${base}/expenses`)
      .send({
        categoryId: org.expenseCategoryId,
        amount: '500.00',
        expenseDate: '2026-01-15',
        submit: true,
      })
      .expect(201);

    const noReason = await authed(adminToken)
      .post(`${base}/expenses/${expense.body.data.id}/review`)
      .send({ decision: 'REJECT' });
    expect(noReason.status).toBe(400);

    const rejected = await authed(adminToken)
      .post(`${base}/expenses/${expense.body.data.id}/review`)
      .send({ decision: 'REJECT', reason: 'Missing receipt' })
      .expect(200);
    expect(rejected.body.data.approvalStatus).toBe('REJECTED');
  });

  it('refuses to edit an approved expense', async () => {
    const expense = await authed(memberToken)
      .post(`${base}/expenses`)
      .send({
        categoryId: org.expenseCategoryId,
        amount: '500.00',
        expenseDate: '2026-01-15',
        submit: true,
      })
      .expect(201);

    await authed(adminToken)
      .post(`${base}/expenses/${expense.body.data.id}/review`)
      .send({ decision: 'APPROVE' })
      .expect(200);

    const edit = await authed(adminToken)
      .patch(`${base}/expenses/${expense.body.data.id}`)
      .send({ amount: '999999.00' });
    expect(edit.status).toBe(409);
  });

  it('rejects a non-positive expense amount', async () => {
    const response = await authed(memberToken)
      .post(`${base}/expenses`)
      .send({ categoryId: org.expenseCategoryId, amount: '0.00', expenseDate: '2026-01-15' });
    expect(response.status).toBe(400);
  });

  it('separates project expenses from general studio expenses', async () => {
    await authed(memberToken)
      .post(`${base}/expenses`)
      .send({ categoryId: org.expenseCategoryId, amount: '100.00', expenseDate: '2026-01-15', projectId })
      .expect(201);
    await authed(memberToken)
      .post(`${base}/expenses`)
      .send({ categoryId: org.expenseCategoryId, amount: '200.00', expenseDate: '2026-01-15' })
      .expect(201);

    const projectScoped = await authed(adminToken).get(`${base}/expenses?scope=PROJECT`).expect(200);
    const general = await authed(adminToken).get(`${base}/expenses?scope=GENERAL`).expect(200);

    expect(projectScoped.body.data).toHaveLength(1);
    expect(general.body.data).toHaveLength(1);
    expect(general.body.data[0].projectId).toBeNull();
  });

  // --- Tasks --------------------------------------------------------------

  it('reassigns a task and keeps a full ownership trail', async () => {
    const task = await authed(adminToken)
      .post(`${base}/tasks`)
      .send({ title: 'Cull selects', projectId, assigneeId: org.member.id, category: 'CULLING' })
      .expect(201);

    expect(task.body.data.status).toBe('ASSIGNED');

    await authed(adminToken)
      .post(`${base}/tasks/${task.body.data.id}/reassign`)
      .send({ toUserId: org.manager.id, reason: 'Editor on leave' })
      .expect(200);

    const assignments = await prisma.taskAssignment.findMany({
      where: { taskId: task.body.data.id },
      orderBy: { createdAt: 'asc' },
    });

    expect(assignments).toHaveLength(2);
    expect(assignments[0].toUserId).toBe(org.member.id);
    expect(assignments[1].fromUserId).toBe(org.member.id);
    expect(assignments[1].toUserId).toBe(org.manager.id);
    expect(assignments[1].reason).toBe('Editor on leave');
    expect(assignments[1].assignedById).toBe(org.admin.id);

    const audit = await prisma.auditLog.findFirst({
      where: { entityType: 'Task', action: 'ASSIGN' },
    });
    expect(audit).not.toBeNull();
  });

  it('refuses to reassign a completed task', async () => {
    const task = await authed(adminToken)
      .post(`${base}/tasks`)
      .send({ title: 'Done already', projectId, assigneeId: org.member.id })
      .expect(201);

    await authed(adminToken)
      .patch(`${base}/tasks/${task.body.data.id}/status`)
      .send({ status: 'COMPLETED' })
      .expect(200);

    const response = await authed(adminToken)
      .post(`${base}/tasks/${task.body.data.id}/reassign`)
      .send({ toUserId: org.manager.id });
    expect(response.status).toBe(409);
  });

  it('records task status history', async () => {
    const task = await authed(adminToken)
      .post(`${base}/tasks`)
      .send({ title: 'Grade footage', projectId, assigneeId: org.member.id })
      .expect(201);

    await authed(adminToken)
      .patch(`${base}/tasks/${task.body.data.id}/status`)
      .send({ status: 'IN_PROGRESS' })
      .expect(200);

    const history = await prisma.taskStatusHistory.findMany({
      where: { taskId: task.body.data.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(history.map((h) => h.newStatus)).toEqual(['ASSIGNED', 'IN_PROGRESS']);
  });

  // --- Deliveries ---------------------------------------------------------

  it('walks a delivery through its legal status transitions', async () => {
    const delivery = await authed(adminToken)
      .post(`${base}/deliveries`)
      .send({ projectId, title: 'Cinematic Teaser', type: 'TEASER', expectedDate: '2026-12-30' })
      .expect(201);

    const id = delivery.body.data.id;
    expect(delivery.body.data.status).toBe('PENDING');

    // PENDING -> DELIVERED is not a legal jump.
    const illegal = await authed(adminToken)
      .patch(`${base}/deliveries/${id}/status`)
      .send({ status: 'DELIVERED' });
    expect(illegal.status).toBe(409);

    await authed(adminToken).patch(`${base}/deliveries/${id}/status`).send({ status: 'IN_PROGRESS' }).expect(200);
    await authed(adminToken).patch(`${base}/deliveries/${id}/status`).send({ status: 'READY' }).expect(200);
    const delivered = await authed(adminToken)
      .patch(`${base}/deliveries/${id}/status`)
      .send({ status: 'DELIVERED' })
      .expect(200);

    expect(delivered.body.data.deliveredDate).not.toBeNull();

    const history = await prisma.deliveryStatusHistory.findMany({
      where: { deliveryId: id },
      orderBy: { createdAt: 'asc' },
    });
    expect(history.map((h) => h.newStatus)).toEqual([
      'PENDING',
      'IN_PROGRESS',
      'READY',
      'DELIVERED',
    ]);
  });

  it('allows a delivered item to be reopened for rework', async () => {
    const delivery = await authed(adminToken)
      .post(`${base}/deliveries`)
      .send({ projectId, title: 'Album', type: 'ALBUM' })
      .expect(201);
    const id = delivery.body.data.id;

    await authed(adminToken).patch(`${base}/deliveries/${id}/status`).send({ status: 'IN_PROGRESS' }).expect(200);
    await authed(adminToken).patch(`${base}/deliveries/${id}/status`).send({ status: 'READY' }).expect(200);
    await authed(adminToken).patch(`${base}/deliveries/${id}/status`).send({ status: 'DELIVERED' }).expect(200);
    await authed(adminToken)
      .patch(`${base}/deliveries/${id}/status`)
      .send({ status: 'REWORK', reason: 'Client asked for a re-edit' })
      .expect(200);
  });

  // --- Data management ----------------------------------------------------

  it('returns accurate zeroes for an empty studio rather than placeholder data', async () => {
    const emptyOrg = await seedTestOrganization('empty-studio');
    const emptyToken = await login(emptyOrg.admin);

    const response = await authed(emptyToken).get(`${base}/data-management/overview`).expect(200);
    const data = response.body.data;

    expect(data.projects.total).toBe(0);
    expect(data.projects.active).toBe(0);
    expect(data.shoots.total).toBe(0);
    expect(data.deliveries.pending).toBe(0);
    expect(data.tasks.pending).toBe(0);
    expect(data.finance.revenueCollected).toBe('0');
    expect(data.finance.expensesApproved).toBe('0');
    expect(data.finance.outstanding).toBe('0');
    expect(data.projectProfitability).toEqual([]);
    expect(data.teamAssignments).toEqual([]);
  });

  it('aggregates real figures into the overview', async () => {
    await authed(adminToken)
      .patch(`${base}/projects/${projectId}/status`)
      .send({ status: 'CONFIRMED' })
      .expect(200);

    await authed(adminToken)
      .post(`${base}/tasks`)
      .send({ title: 'Pending work', projectId, assigneeId: org.member.id })
      .expect(201);

    await authed(adminToken)
      .post(`${base}/payments`)
      .set('Idempotency-Key', 'overview-payment-key-1')
      .send({ clientId, projectId, amount: '75000.00', paymentDate: '2026-01-15' })
      .expect(201);

    const expense = await authed(memberToken)
      .post(`${base}/expenses`)
      .send({
        categoryId: org.expenseCategoryId,
        amount: '5000.00',
        expenseDate: '2026-01-16',
        projectId,
        submit: true,
      })
      .expect(201);
    await authed(adminToken)
      .post(`${base}/expenses/${expense.body.data.id}/review`)
      .send({ decision: 'APPROVE' })
      .expect(200);

    const response = await authed(adminToken).get(`${base}/data-management/overview`).expect(200);
    const data = response.body.data;

    expect(data.projects.total).toBe(1);
    expect(data.projects.active).toBe(1);
    expect(data.tasks.pending).toBe(1);
    expect(data.finance.revenueCollected).toBe('75000');
    expect(data.finance.expensesApproved).toBe('5000');
    expect(data.finance.netMargin).toBe('70000');

    const profit = data.projectProfitability.find(
      (row: { projectId: string }) => row.projectId === projectId,
    );
    expect(profit.revenue).toBe('75000.00');
    expect(profit.expenses).toBe('5000.00');
    expect(profit.profit).toBe('70000.00');
    // (raw SQL casts preserve the column scale, so these keep 2dp)
  });

  it('exposes the per-project data-backup view', async () => {
    const response = await authed(adminToken).get(`${base}/data-management/projects`).expect(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].summary).toMatchObject({
      shootCount: 0,
      dataReceivedCount: 0,
      pendingDataCount: 0,
    });
    expect(response.body.data[0].summary.totalDataGb).toBe('0');
  });

  // --- Personal to-dos ----------------------------------------------------

  it('keeps personal to-dos private to the signed-in employee', async () => {
    const created = await authed(memberToken)
      .post(`${base}/me/todos`)
      .send({ title: 'Cull my own selects', priority: 'HIGH', dueDate: '2026-09-01' })
      .expect(201);

    expect(created.body.data.title).toBe('Cull my own selects');
    expect(created.body.data.userId).toBe(org.member.id);
    expect(created.body.data.completed).toBe(false);

    const mine = await authed(memberToken).get(`${base}/me/todos`).expect(200);
    expect(mine.body.data).toHaveLength(1);
    expect(mine.body.data[0].id).toBe(created.body.data.id);

    const adminList = await authed(adminToken).get(`${base}/me/todos`).expect(200);
    expect(adminList.body.data).toHaveLength(0);

    await authed(adminToken).patch(`${base}/me/todos/${created.body.data.id}`).send({ completed: true }).expect(404);
    await authed(managerToken).delete(`${base}/me/todos/${created.body.data.id}`).expect(404);

    const toggled = await authed(memberToken)
      .patch(`${base}/me/todos/${created.body.data.id}`)
      .send({ completed: true })
      .expect(200);
    expect(toggled.body.data.completed).toBe(true);

    await authed(memberToken).delete(`${base}/me/todos/completed`).expect(200);
    const afterClear = await authed(memberToken).get(`${base}/me/todos`).expect(200);
    expect(afterClear.body.data).toHaveLength(0);
  });

  // --- Health -------------------------------------------------------------

  it('reports readiness only when PostgreSQL answers', async () => {
    const response = await authed(adminToken).get('/health/ready').expect(200);
    expect(response.body.data.database.engine).toBe('postgresql');
    expect(response.body.data.database.reachable).toBe(true);
  });
});
