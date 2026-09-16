import { beforeEach, describe, expect, it } from 'vitest';
import { authed, base, login } from '../helpers/api';
import { ensurePermissions, prisma, resetDatabase, seedTestOrganization, TestOrg } from '../helpers/factory';

async function grantRolePermissions(roleId: string, keys: string[]) {
  const permissionIds = await ensurePermissions();
  await prisma.rolePermission.createMany({
    data: keys
      .map((key) => permissionIds.get(key))
      .filter((permissionId): permissionId is string => Boolean(permissionId))
      .map((permissionId) => ({ roleId, permissionId })),
    skipDuplicates: true,
  });
}

describe('resource-level authorization', () => {
  let org: TestOrg;
  let adminToken: string;
  let managerToken: string;
  let memberToken: string;
  let isolatedClientId: string;
  let accessibleClientId: string;
  let isolatedProjectId: string;
  let accessibleProjectId: string;

  beforeEach(async () => {
    await resetDatabase();
    org = await seedTestOrganization();
    await grantRolePermissions(org.roleIds.MANAGER, ['PAYMENT_VIEW']);
    await grantRolePermissions(org.roleIds.MEMBER, ['FILE_DELETE']);

    adminToken = await login(org.admin);
    managerToken = await login(org.manager);
    memberToken = await login(org.member);

    const isolatedClient = await authed(adminToken)
      .post(`${base}/clients`)
      .send({ displayName: 'Private Couple', primaryPhone: '9812345678' })
      .expect(201);
    isolatedClientId = isolatedClient.body.data.id;

    const isolatedProject = await authed(adminToken)
      .post(`${base}/projects`)
      .send({ clientId: isolatedClientId, name: 'Private Wedding', weddingDate: '2026-12-14' })
      .expect(201);
    isolatedProjectId = isolatedProject.body.data.id;

    const accessibleClient = await authed(adminToken)
      .post(`${base}/clients`)
      .send({ displayName: 'Assigned Couple', primaryPhone: '9812345679' })
      .expect(201);
    accessibleClientId = accessibleClient.body.data.id;

    const accessibleProject = await authed(adminToken)
      .post(`${base}/projects`)
      .send({
        clientId: accessibleClientId,
        name: 'Assigned Wedding',
        weddingDate: '2026-12-20',
        tasks: [{ title: 'Assigned edit', assigneeId: org.member.id }],
      })
      .expect(201);
    accessibleProjectId = accessibleProject.body.data.id;
  });

  it('keeps task list and detail access scoped to assigned or project-connected records', async () => {
    const privateTask = await authed(adminToken)
      .post(`${base}/tasks`)
      .send({ title: 'Manager-only work', projectId: isolatedProjectId, assigneeId: org.manager.id })
      .expect(201);

    const assignedTask = await authed(adminToken)
      .post(`${base}/tasks`)
      .send({ title: 'Member work', projectId: accessibleProjectId, assigneeId: org.member.id })
      .expect(201);

    const memberList = await authed(memberToken).get(`${base}/tasks`).expect(200);
    const listedIds = memberList.body.data.map((task: { id: string }) => task.id);
    expect(listedIds).toContain(assignedTask.body.data.id);
    expect(listedIds).not.toContain(privateTask.body.data.id);

    await authed(memberToken).get(`${base}/tasks/${assignedTask.body.data.id}`).expect(200);
    await authed(memberToken).get(`${base}/tasks/${privateTask.body.data.id}`).expect(404);
  });

  it('keeps client list and detail access aligned with accessible projects', async () => {
    const memberList = await authed(memberToken).get(`${base}/clients`).expect(200);
    const listedIds = memberList.body.data.map((client: { id: string }) => client.id);
    expect(listedIds).toContain(accessibleClientId);
    expect(listedIds).not.toContain(isolatedClientId);

    await authed(memberToken).get(`${base}/clients/${accessibleClientId}`).expect(200);
    await authed(memberToken).get(`${base}/clients/${isolatedClientId}`).expect(404);
  });

  it('prevents self-attendance users from querying another employee directly', async () => {
    await authed(adminToken)
      .post(`${base}/attendance`)
      .send({ userId: org.manager.id, date: '2026-01-15', status: 'PRESENT' })
      .expect(201);

    const response = await authed(memberToken).get(`${base}/attendance?userId=${org.manager.id}`);
    expect(response.status).toBe(403);
  });

  it('requires payment detail access to match project access', async () => {
    const payment = await authed(adminToken)
      .post(`${base}/payments`)
      .set('Idempotency-Key', 'resource-auth-payment')
      .send({
        clientId: isolatedClientId,
        projectId: isolatedProjectId,
        amount: '5000.00',
        paymentDate: '2026-01-15',
      })
      .expect(201);

    const managerList = await authed(managerToken).get(`${base}/payments`).expect(200);
    const listedIds = managerList.body.data.map((item: { id: string }) => item.id);
    expect(listedIds).not.toContain(payment.body.data.id);

    await authed(managerToken).get(`${base}/payments/${payment.body.data.id}`).expect(404);
  });

  it('scopes generic file list and signed URLs to accessible project resources', async () => {
    const accessibleFile = await authed(adminToken)
      .post(`${base}/files`)
      .send({
        entityType: 'PROJECT_CLIENT_ASSET',
        projectId: accessibleProjectId,
        bucket: 'test',
        objectKey: `resource-auth/${accessibleProjectId}.pdf`,
        originalName: 'accessible.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 12,
      })
      .expect(201);

    const privateFile = await authed(adminToken)
      .post(`${base}/files`)
      .send({
        entityType: 'PROJECT_CLIENT_ASSET',
        projectId: isolatedProjectId,
        bucket: 'test',
        objectKey: `resource-auth/${isolatedProjectId}.pdf`,
        originalName: 'private.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 12,
      })
      .expect(201);

    const memberList = await authed(memberToken).get(`${base}/files`).expect(200);
    const listedIds = memberList.body.data.map((file: { id: string }) => file.id);
    expect(listedIds).toContain(accessibleFile.body.data.id);
    expect(listedIds).not.toContain(privateFile.body.data.id);

    await authed(memberToken).get(`${base}/files/${accessibleFile.body.data.id}/download-url`).expect(200);
    await authed(memberToken).get(`${base}/files/${privateFile.body.data.id}/download-url`).expect(404);
  });

  it('does not let FILE_DELETE remove a file from an inaccessible project', async () => {
    const privateFile = await authed(adminToken)
      .post(`${base}/files`)
      .send({
        entityType: 'PROJECT_CLIENT_ASSET',
        projectId: isolatedProjectId,
        bucket: 'test',
        objectKey: 'resource-auth/private-delete.pdf',
        originalName: 'private-delete.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 12,
      })
      .expect(201);

    await authed(memberToken).delete(`${base}/files/${privateFile.body.data.id}`).expect(404);

    const stillThere = await prisma.fileObject.findUnique({ where: { id: privateFile.body.data.id } });
    expect(stillThere?.deletedAt).toBeNull();
  });

  it('prevents upload intents and registrations from targeting inaccessible projects', async () => {
    await authed(memberToken)
      .post(`${base}/files/upload-intent`)
      .send({
        entityType: 'PROJECT_CLIENT_ASSET',
        projectId: isolatedProjectId,
        originalName: 'bad.pdf',
        mimeType: 'application/pdf',
      })
      .expect(404);

    await authed(memberToken)
      .post(`${base}/files`)
      .send({
        entityType: 'PROJECT_CLIENT_ASSET',
        projectId: isolatedProjectId,
        bucket: 'test',
        objectKey: 'resource-auth/bad-register.pdf',
        originalName: 'bad-register.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 12,
      })
      .expect(404);
  });

  it('keeps file ids isolated across organizations while preserving admin access in the owning tenant', async () => {
    const file = await authed(adminToken)
      .post(`${base}/files`)
      .send({
        entityType: 'PROJECT_CLIENT_ASSET',
        projectId: isolatedProjectId,
        bucket: 'test',
        objectKey: 'resource-auth/admin-private.pdf',
        originalName: 'admin-private.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 12,
      })
      .expect(201);

    await authed(adminToken).get(`${base}/files/${file.body.data.id}/download-url`).expect(200);

    const otherOrg = await seedTestOrganization('file-other-studio');
    const otherToken = await login(otherOrg.admin);
    await authed(otherToken).get(`${base}/files/${file.body.data.id}/download-url`).expect(404);
  });

  it('does not expose employee documents through generic FILE_VIEW alone', async () => {
    const employeeDoc = await prisma.fileObject.create({
      data: {
        organizationId: org.organizationId,
        uploadedById: org.admin.id,
        entityType: 'EMPLOYEE_DOCUMENT',
        entityId: org.manager.id,
        bucket: 'test',
        objectKey: 'resource-auth/employee-id.pdf',
        originalName: 'employee-id.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 12,
      },
    });

    await authed(memberToken).get(`${base}/files/${employeeDoc.id}/download-url`).expect(403);
    await authed(adminToken).get(`${base}/files/${employeeDoc.id}/download-url`).expect(200);
  });
});
