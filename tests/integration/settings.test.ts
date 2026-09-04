import { beforeEach, describe, expect, it } from 'vitest';
import { authed, base, login } from '../helpers/api';
import { prisma, resetDatabase, seedTestOrganization, TestOrg } from '../helpers/factory';

/**
 * The Settings workspace: self-service profile and preferences, studio
 * settings, and the module access request loop.
 *
 * The load-bearing assertion is that approving a request changes real
 * authority — the employee can call the module's own endpoints afterwards, and
 * the grant is visible from the existing Roles & Permissions API — rather than
 * only flipping a status column in a Settings-owned table.
 */
describe('settings workspace', () => {
  let org: TestOrg;
  let adminToken: string;
  let memberToken: string;

  beforeEach(async () => {
    await resetDatabase();
    org = await seedTestOrganization();
    [adminToken, memberToken] = await Promise.all([login(org.admin), login(org.member)]);
  });

  const workspace = (token: string) => authed(token).get(`${base}/settings/workspace`);

  // --- Workspace -----------------------------------------------------------

  it('returns the full workspace for an employee', async () => {
    const { body } = await workspace(memberToken).expect(200);
    const data = body.data;

    expect(body.success).toBe(true);
    expect(data.viewer).toMatchObject({ id: org.member.id, email: org.member.email, isAdmin: false });
    expect(data.organization).toMatchObject({ name: 'Test Studio', currency: 'INR' });
    // Defaults are merged in on read, so a brand-new employee still gets switches.
    expect(Object.keys(data.notifications).length).toBeGreaterThan(0);
    expect(data.security.sessionTimeoutMinutes).toBe(60);
    expect(data.requests).toEqual([]);
  });

  it('marks an admin as admin and derives module lists from real permissions', async () => {
    const [member, admin] = await Promise.all([
      workspace(memberToken).expect(200),
      workspace(adminToken).expect(200),
    ]);

    expect(admin.body.data.viewer.isAdmin).toBe(true);
    // ADMIN holds every key, so nothing is left to request.
    expect(admin.body.data.availableModules).toEqual([]);

    const memberKeys = member.body.data.availableModules.map((m: { key: string }) => m.key);
    // MEMBER has no finance or report keys, and does hold the shoot ones.
    expect(memberKeys).toContain('finance');
    expect(member.body.data.grantedModules.map((m: { key: string }) => m.key)).toContain('shoots');
  });

  it('rejects an unauthenticated caller', async () => {
    const response = await authed('not-a-token').get(`${base}/settings/workspace`);
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHENTICATED');
  });

  // --- Profile -------------------------------------------------------------

  it('updates the signed-in employee’s own profile', async () => {
    const { body } = await authed(memberToken)
      .patch(`${base}/settings/profile`)
      .send({ fullName: 'Renamed Member', phone: '9812345678', imageUrl: 'https://cdn.test/a.png' })
      .expect(200);

    expect(body.data).toMatchObject({ fullName: 'Renamed Member', phone: '9812345678', imageUrl: 'https://cdn.test/a.png' });

    const { body: after } = await workspace(memberToken).expect(200);
    expect(after.data.viewer.fullName).toBe('Renamed Member');
    expect(after.data.viewer.imageUrl).toBe('https://cdn.test/a.png');
  });

  it('keeps the avatar when a later save omits it', async () => {
    await authed(memberToken)
      .patch(`${base}/settings/profile`)
      .send({ fullName: 'With Avatar', imageUrl: 'https://cdn.test/keep.png' })
      .expect(200);
    await authed(memberToken)
      .patch(`${base}/settings/profile`)
      .send({ fullName: 'Name Only' })
      .expect(200);

    const { body } = await workspace(memberToken).expect(200);
    expect(body.data.viewer.imageUrl).toBe('https://cdn.test/keep.png');
  });

  it('rejects a profile save with a missing name or a bad phone', async () => {
    const missing = await authed(memberToken).patch(`${base}/settings/profile`).send({});
    expect(missing.status).toBe(400);
    expect(missing.body.error.code).toBe('VALIDATION_ERROR');

    const badPhone = await authed(memberToken)
      .patch(`${base}/settings/profile`)
      .send({ fullName: 'Someone', phone: '123' });
    expect(badPhone.status).toBe(400);
  });

  it('never lets one employee edit another’s profile', async () => {
    // The route takes no user id at all: the body is applied to `auth.userId`.
    await authed(memberToken)
      .patch(`${base}/settings/profile`)
      .send({ fullName: 'Hijack', userId: org.admin.id })
      .expect(400);

    const admin = await prisma.user.findUnique({ where: { id: org.admin.id } });
    expect(admin?.fullName).toBe('Admin User');
  });

  // --- Organization --------------------------------------------------------

  it('lets an admin update studio settings', async () => {
    const { body } = await authed(adminToken)
      .patch(`${base}/settings/organization`)
      .send({
        name: 'Renamed Studio',
        contactEmail: 'studio@test.example',
        timezone: 'Asia/Kolkata',
        currency: 'inr',
        dateFormat: 'DD/MM/YYYY',
        logoUrl: 'https://cdn.test/logo.png',
      })
      .expect(200);

    expect(body.data).toMatchObject({
      name: 'Renamed Studio',
      contactEmail: 'studio@test.example',
      currency: 'INR',
      dateFormat: 'DD/MM/YYYY',
      logoUrl: 'https://cdn.test/logo.png',
    });

    // Studio identity is written to `organizations`, not to a Settings copy.
    const stored = await prisma.organization.findUnique({ where: { id: org.organizationId } });
    expect(stored?.name).toBe('Renamed Studio');
    expect(stored?.currency).toBe('INR');
  });

  it('forbids an employee from updating studio settings', async () => {
    const response = await authed(memberToken)
      .patch(`${base}/settings/organization`)
      .send({ name: 'Not Allowed' });
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');

    const stored = await prisma.organization.findUnique({ where: { id: org.organizationId } });
    expect(stored?.name).toBe('Test Studio');
  });

  it('rejects an empty or unknown-field studio update', async () => {
    expect((await authed(adminToken).patch(`${base}/settings/organization`).send({})).status).toBe(400);
    expect(
      (await authed(adminToken).patch(`${base}/settings/organization`).send({ hackField: 'x' })).status,
    ).toBe(400);
  });

  // --- Preferences ---------------------------------------------------------

  it('merges preference saves instead of replacing them', async () => {
    await authed(memberToken)
      .patch(`${base}/settings/preferences`)
      .send({ notifications: { taskAssigned: false } })
      .expect(200);

    const { body } = await authed(memberToken)
      .patch(`${base}/settings/preferences`)
      .send({ security: { sessionTimeoutMinutes: 30, notifyNewLogin: false } })
      .expect(200);

    // The notification switch survives a save that only touched security.
    expect(body.data.notifications.taskAssigned).toBe(false);
    expect(body.data.security).toMatchObject({ sessionTimeoutMinutes: 30, notifyNewLogin: false });

    const { body: after } = await workspace(memberToken).expect(200);
    expect(after.data.notifications.taskAssigned).toBe(false);
    expect(after.data.security.sessionTimeoutMinutes).toBe(30);
  });

  it('rejects an empty or out-of-range preference save', async () => {
    expect((await authed(memberToken).patch(`${base}/settings/preferences`).send({})).status).toBe(400);
    expect(
      (
        await authed(memberToken)
          .patch(`${base}/settings/preferences`)
          .send({ security: { sessionTimeoutMinutes: 1 } })
      ).status,
    ).toBe(400);
  });

  it('keeps preferences private to each employee', async () => {
    await authed(memberToken)
      .patch(`${base}/settings/preferences`)
      .send({ notifications: { taskAssigned: false } })
      .expect(200);

    const { body } = await workspace(adminToken).expect(200);
    expect(body.data.notifications.taskAssigned).toBe(true);
  });

  // --- Password ------------------------------------------------------------

  it('changes the password and invalidates the old session', async () => {
    await authed(memberToken)
      .post(`${base}/settings/password`)
      .send({ currentPassword: 'TestPassw0rd!', newPassword: 'BrandNewPassw0rd!' })
      .expect(200);

    // Old session is revoked, so the previous token stops working immediately.
    expect((await workspace(memberToken)).status).toBe(401);

    const fresh = await login({ ...org.member, password: 'BrandNewPassw0rd!' });
    expect((await workspace(fresh)).status).toBe(200);
  });

  it('rejects a wrong current password and a weak new one', async () => {
    const wrong = await authed(memberToken)
      .post(`${base}/settings/password`)
      .send({ currentPassword: 'NotMyPassword1!', newPassword: 'BrandNewPassw0rd!' });
    expect(wrong.status).toBe(401);

    const weak = await authed(memberToken)
      .post(`${base}/settings/password`)
      .send({ currentPassword: 'TestPassw0rd!', newPassword: 'short' });
    expect(weak.status).toBe(400);

    // Neither failure changed anything.
    expect((await workspace(memberToken)).status).toBe(200);
  });

  // --- Module access requests ----------------------------------------------

  const requestFinance = (token: string, reason = 'I reconcile studio payments each month.') =>
    authed(token).post(`${base}/settings/module-access-requests`).send({ moduleKey: 'finance', reason });

  it('raises a module access request', async () => {
    const { body } = await requestFinance(memberToken).expect(201);
    expect(body.data).toMatchObject({
      moduleKey: 'finance',
      moduleLabel: 'Finance',
      status: 'PENDING',
      employeeEmail: org.member.email,
    });

    const { body: mine } = await authed(memberToken)
      .get(`${base}/settings/module-access-requests`)
      .expect(200);
    expect(mine.data).toHaveLength(1);
  });

  it('rejects a duplicate, an already-granted and an unknown module', async () => {
    await requestFinance(memberToken).expect(201);

    const duplicate = await requestFinance(memberToken);
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('CONFLICT');

    // MEMBER already holds the shoots keys.
    const held = await authed(memberToken)
      .post(`${base}/settings/module-access-requests`)
      .send({ moduleKey: 'shoots', reason: 'please' });
    expect(held.status).toBe(409);

    const unknown = await authed(memberToken)
      .post(`${base}/settings/module-access-requests`)
      .send({ moduleKey: 'nuclear-launch', reason: 'please' });
    expect(unknown.status).toBe(400);
    expect(unknown.body.error.code).toBe('VALIDATION_ERROR');

    const noReason = await authed(memberToken)
      .post(`${base}/settings/module-access-requests`)
      .send({ moduleKey: 'reports' });
    expect(noReason.status).toBe(400);
  });

  it('shows an employee only their own requests, and a reviewer the whole queue', async () => {
    await requestFinance(memberToken).expect(201);

    const { body: adminView } = await authed(adminToken)
      .get(`${base}/settings/module-access-requests`)
      .expect(200);
    expect(adminView.data).toHaveLength(1);
    expect(adminView.data[0].employeeName).toBe('Member User');

    const managerToken = await login(org.manager);
    const { body: managerView } = await authed(managerToken)
      .get(`${base}/settings/module-access-requests`)
      .expect(200);
    // MANAGER lacks PERMISSION_ASSIGN, so it sees only its own (none).
    expect(managerView.data).toEqual([]);
  });

  it('grants real access on approval, visible from Roles & Permissions', async () => {
    // Finance is closed to this employee before the request.
    expect((await authed(memberToken).get(`${base}/payments`)).status).toBe(403);

    const { body: created } = await requestFinance(memberToken).expect(201);

    const { body: reviewed } = await authed(adminToken)
      .patch(`${base}/settings/module-access-requests/${created.data.id}`)
      .send({ status: 'APPROVED', reviewReason: 'Approved for month-end close.' })
      .expect(200);
    expect(reviewed.data).toMatchObject({
      status: 'APPROVED',
      reviewerName: 'Admin User',
      reviewReason: 'Approved for month-end close.',
    });

    // 1. Authority actually changed — the same token now reaches Finance.
    expect((await authed(memberToken).get(`${base}/payments`)).status).toBe(200);
    expect((await authed(memberToken).get(`${base}/invoices`)).status).toBe(200);

    // 2. `/auth/me` carries the new keys on its next load, with no re-login.
    const { body: me } = await authed(memberToken).get(`${base}/auth/me`).expect(200);
    expect(me.data.permissions).toEqual(
      expect.arrayContaining(['PAYMENT_VIEW', 'INVOICE_VIEW', 'QUOTATION_VIEW', 'EXPENSE_VIEW']),
    );

    // 3. The grant lives in the existing RBAC tables, so the Roles desk sees it.
    const { body: roles } = await authed(adminToken).get(`${base}/roles`).expect(200);
    const personal = roles.data.find(
      (role: { personalForUserId: string | null }) => role.personalForUserId === org.member.id,
    );
    expect(personal).toBeDefined();
    expect(personal.rolePermissions.map((rp: { permission: { key: string } }) => rp.permission.key))
      .toEqual(expect.arrayContaining(['PAYMENT_VIEW', 'INVOICE_VIEW']));

    // 4. No parallel permission system was created.
    const grantedRows = await prisma.rolePermission.count({ where: { roleId: personal.id } });
    expect(grantedRows).toBeGreaterThan(0);

    // 5. The workspace now reports finance as granted rather than available.
    const { body: after } = await workspace(memberToken).expect(200);
    expect(after.data.grantedModules.map((m: { key: string }) => m.key)).toContain('finance');
    expect(after.data.availableModules.map((m: { key: string }) => m.key)).not.toContain('finance');
  });

  it('grants nothing on rejection', async () => {
    const { body: created } = await requestFinance(memberToken).expect(201);

    const { body } = await authed(adminToken)
      .patch(`${base}/settings/module-access-requests/${created.data.id}`)
      .send({ status: 'REJECTED', reviewReason: 'Not part of this role.' })
      .expect(200);
    expect(body.data.status).toBe('REJECTED');

    expect((await authed(memberToken).get(`${base}/payments`)).status).toBe(403);
    const personal = await prisma.role.findFirst({ where: { personalForUserId: org.member.id } });
    expect(personal).toBeNull();
  });

  it('refuses a second review of a settled request', async () => {
    const { body: created } = await requestFinance(memberToken).expect(201);
    const url = `${base}/settings/module-access-requests/${created.data.id}`;

    await authed(adminToken).patch(url).send({ status: 'APPROVED' }).expect(200);
    const again = await authed(adminToken).patch(url).send({ status: 'REJECTED' });
    expect(again.status).toBe(409);

    // The first decision stands.
    expect((await authed(memberToken).get(`${base}/payments`)).status).toBe(200);
  });

  it('forbids review by an employee without PERMISSION_ASSIGN', async () => {
    const { body: created } = await requestFinance(memberToken).expect(201);
    const url = `${base}/settings/module-access-requests/${created.data.id}`;

    expect((await authed(memberToken).patch(url).send({ status: 'APPROVED' })).status).toBe(403);
    const managerToken = await login(org.manager);
    expect((await authed(managerToken).patch(url).send({ status: 'APPROVED' })).status).toBe(403);

    expect((await authed(memberToken).get(`${base}/payments`)).status).toBe(403);
  });

  it('refuses a reviewer approving their own request', async () => {
    // Give the admin something to ask for, then have them try to self-approve.
    const financePermissions = await prisma.permission.findMany({
      where: { key: { in: ['QUOTATION_VIEW', 'INVOICE_VIEW', 'PAYMENT_VIEW', 'EXPENSE_VIEW'] } },
      select: { id: true },
    });
    await prisma.rolePermission.deleteMany({
      where: {
        roleId: org.roleIds.ADMIN,
        permissionId: { in: financePermissions.map((p) => p.id) },
      },
    });

    const token = await login(org.admin);
    const { body: created } = await requestFinance(token).expect(201);
    const response = await authed(token)
      .patch(`${base}/settings/module-access-requests/${created.data.id}`)
      .send({ status: 'APPROVED' });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
  });

  it('returns 404 for a request in another studio', async () => {
    const other = await seedTestOrganization('other-studio');
    const otherMemberToken = await login(other.member);
    const { body: created } = await requestFinance(otherMemberToken).expect(201);

    const response = await authed(adminToken)
      .patch(`${base}/settings/module-access-requests/${created.data.id}`)
      .send({ status: 'APPROVED' });
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });

  it('leaves the existing key/value settings endpoints working', async () => {
    // The workspace router shares the `/settings` mount with the older router.
    await authed(adminToken)
      .put(`${base}/settings`)
      .send({ key: 'studio.theme', value: { mode: 'dark' } })
      .expect(200);

    const { body } = await authed(adminToken).get(`${base}/settings`).expect(200);
    expect(body.data.map((row: { key: string }) => row.key)).toContain('studio.theme');
  });
});
