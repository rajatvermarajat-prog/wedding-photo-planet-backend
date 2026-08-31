import { beforeEach, describe, expect, it } from 'vitest';
import { authed, base, login } from '../helpers/api';
import { resetDatabase, seedTestOrganization, TestOrg } from '../helpers/factory';

/**
 * Custom-role lifecycle and the rules that stop role management from becoming a
 * privilege-escalation path.
 */
describe('role management', () => {
  let org: TestOrg;
  let adminToken: string;

  beforeEach(async () => {
    await resetDatabase();
    org = await seedTestOrganization();
    adminToken = await login(org.admin);
  });

  const createRole = (token: string, body: Record<string, unknown>) =>
    authed(token).post(`${base}/roles`).send(body);

  const salesManager = {
    name: 'Sales Manager',
    description: 'Leads, clients and sales operations.',
    permissionKeys: ['DASHBOARD_VIEW', 'LEAD_VIEW', 'LEAD_CREATE', 'CLIENT_VIEW', 'PROJECT_VIEW'],
  };

  it('lets an admin list roles, marking system and custom roles', async () => {
    const response = await authed(adminToken).get(`${base}/roles`).expect(200);
    const names = response.body.data.map((role: { name: string }) => role.name);
    expect(names).toEqual(expect.arrayContaining(['ADMIN', 'MANAGER', 'MEMBER']));
    for (const role of response.body.data) {
      expect(role.type).toBe('SYSTEM');
      expect(role.status).toBe('ACTIVE');
      expect(typeof role._count.userRoles).toBe('number');
    }
  });

  it('forbids a member from reading roles', async () => {
    const token = await login(org.member);
    const response = await authed(token).get(`${base}/roles`);
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
  });

  it('creates a custom role with exactly the requested permissions', async () => {
    const response = await createRole(adminToken, salesManager).expect(201);
    expect(response.body.data.type).toBe('CUSTOM');
    expect(response.body.data.status).toBe('ACTIVE');

    const keys = response.body.data.rolePermissions.map(
      (rp: { permission: { key: string } }) => rp.permission.key,
    );
    for (const key of salesManager.permissionKeys) expect(keys).toContain(key);
    expect(keys).not.toContain('ROLE_DELETE');
    expect(keys).not.toContain('PAYMENT_CREATE');
  });

  it('rejects a duplicate role name within the organization', async () => {
    await createRole(adminToken, salesManager).expect(201);
    const response = await createRole(adminToken, salesManager);
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('CONFLICT');
    expect(response.body.error.message).toMatch(/already exists/i);
  });

  it('rejects an unknown permission key', async () => {
    const response = await createRole(adminToken, {
      name: 'Bogus',
      permissionKeys: ['NOT_A_REAL_PERMISSION'],
    });
    expect(response.status).toBe(400);
  });

  it('updates a role name, description and status', async () => {
    const created = await createRole(adminToken, salesManager).expect(201);
    const response = await authed(adminToken)
      .patch(`${base}/roles/${created.body.data.id}`)
      .send({ name: 'Sales Lead', description: 'Renamed', status: 'INACTIVE' })
      .expect(200);

    expect(response.body.data.name).toBe('Sales Lead');
    expect(response.body.data.status).toBe('INACTIVE');
  });

  it('replaces a role permission set without touching unrelated roles', async () => {
    const created = await createRole(adminToken, salesManager).expect(201);
    const roleId = created.body.data.id;

    const response = await authed(adminToken)
      .put(`${base}/roles/${roleId}/permissions`)
      .send({ permissionKeys: [...salesManager.permissionKeys, 'LEAD_UPDATE'] })
      .expect(200);

    const keys = response.body.data.rolePermissions.map(
      (rp: { permission: { key: string } }) => rp.permission.key,
    );
    expect(keys).toContain('LEAD_UPDATE');
    expect(keys).toContain('LEAD_VIEW');

    const memberRole = await authed(adminToken)
      .get(`${base}/roles/${org.roleIds.MEMBER}`)
      .expect(200);
    expect(memberRole.body.data.rolePermissions.length).toBeGreaterThan(0);
  });

  it('refuses to delete a system role', async () => {
    const response = await authed(adminToken).delete(`${base}/roles/${org.roleIds.ADMIN}`);
    expect(response.status).toBe(409);
    expect(response.body.error.message).toMatch(/system role/i);
  });

  it('refuses to rename or deactivate a system role', async () => {
    const renamed = await authed(adminToken)
      .patch(`${base}/roles/${org.roleIds.MEMBER}`)
      .send({ name: 'MEMBERS' });
    expect(renamed.status).toBe(409);

    const deactivated = await authed(adminToken)
      .patch(`${base}/roles/${org.roleIds.MEMBER}`)
      .send({ status: 'INACTIVE' });
    expect(deactivated.status).toBe(409);
  });

  it('deletes an unused custom role but blocks one that is still assigned', async () => {
    const created = await createRole(adminToken, salesManager).expect(201);
    const roleId = created.body.data.id;

    await authed(adminToken)
      .post(`${base}/users`)
      .send({
        fullName: 'Rahul Sharma',
        email: 'rahul@test-studio.test',
        password: 'TestPassw0rd!',
        roleIds: [roleId],
      })
      .expect(201);

    const blocked = await authed(adminToken).delete(`${base}/roles/${roleId}`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.message).toMatch(/Rahul Sharma/);

    const unused = await createRole(adminToken, { name: 'Temp', permissionKeys: [] }).expect(201);
    await authed(adminToken).delete(`${base}/roles/${unused.body.data.id}`).expect(204);
  });

  it('lists the employees holding a role', async () => {
    const response = await authed(adminToken)
      .get(`${base}/roles/${org.roleIds.MANAGER}/users`)
      .expect(200);

    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].email).toBe('manager@test-studio.test');
    expect(response.body.data[0].roles.map((r: { name: string }) => r.name)).toEqual(['MANAGER']);
  });

  it('does not leak the members of another organization’s role', async () => {
    const otherOrg = await seedTestOrganization('other-studio');
    const response = await authed(adminToken).get(`${base}/roles/${otherOrg.roleIds.MANAGER}/users`);
    expect(response.status).toBe(404);
  });

  it('splits colleagues onto separate roles so one can differ from the other', async () => {
    const before = await authed(adminToken)
      .get(`${base}/roles/${org.roleIds.MANAGER}/users`)
      .expect(200);
    expect(before.body.data).toHaveLength(1);
    const target = before.body.data[0];

    // A personal role cloned from MANAGER, then narrowed.
    const personal = await createRole(adminToken, {
      name: `${target.fullName} — MANAGER`,
      permissionKeys: ['DASHBOARD_VIEW', 'CLIENT_VIEW'],
    }).expect(201);

    await authed(adminToken)
      .put(`${base}/users/${target.id}/roles`)
      .send({ roleIds: [personal.body.data.id] })
      .expect(200);

    const after = await authed(adminToken)
      .get(`${base}/roles/${org.roleIds.MANAGER}/users`)
      .expect(200);
    expect(after.body.data).toHaveLength(0);

    const moved = await authed(adminToken)
      .get(`${base}/roles/${personal.body.data.id}/users`)
      .expect(200);
    expect(moved.body.data.map((u: { id: string }) => u.id)).toEqual([target.id]);

    // The narrowed set applies immediately, and MANAGER itself is untouched.
    const token = await login({ id: '', email: target.email, password: 'TestPassw0rd!' });
    expect((await authed(token).get(`${base}/clients`)).status).toBe(200);
    expect((await authed(token).get(`${base}/leads`)).status).toBe(403);

    const managerRole = await authed(adminToken)
      .get(`${base}/roles/${org.roleIds.MANAGER}`)
      .expect(200);
    expect(managerRole.body.data.rolePermissions.length).toBeGreaterThan(50);
  });

  it('audits role creation and permission changes', async () => {
    const created = await createRole(adminToken, salesManager).expect(201);
    await authed(adminToken)
      .put(`${base}/roles/${created.body.data.id}/permissions`)
      .send({ permissionKeys: ['DASHBOARD_VIEW'] })
      .expect(200);

    const audit = await authed(adminToken).get(`${base}/audit`).expect(200);
    const entries = audit.body.data.filter(
      (entry: { entityType: string; entityId: string }) =>
        entry.entityType === 'Role' && entry.entityId === created.body.data.id,
    );
    expect(entries.map((e: { action: string }) => e.action)).toEqual(
      expect.arrayContaining(['CREATE', 'PERMISSION_CHANGED']),
    );
  });
});

describe('role assignment security', () => {
  let org: TestOrg;
  let adminToken: string;

  beforeEach(async () => {
    await resetDatabase();
    org = await seedTestOrganization();
    adminToken = await login(org.admin);
  });

  const createEmployee = (token: string, email: string, roleIds: string[]) =>
    authed(token)
      .post(`${base}/users`)
      .send({ fullName: 'New Employee', email, password: 'TestPassw0rd!', roleIds });

  it('gives an employee exactly the permissions of their custom role', async () => {
    const role = await authed(adminToken)
      .post(`${base}/roles`)
      .send({
        name: 'Sales Manager',
        permissionKeys: ['DASHBOARD_VIEW', 'LEAD_VIEW', 'CLIENT_VIEW', 'CLIENT_CREATE'],
      })
      .expect(201);

    await createEmployee(adminToken, 'sales@test-studio.test', [role.body.data.id]).expect(201);

    const token = await login({
      id: '',
      email: 'sales@test-studio.test',
      password: 'TestPassw0rd!',
    });

    expect((await authed(token).get(`${base}/clients`)).status).toBe(200);
    // Granted CLIENT_CREATE, so the write succeeds.
    expect(
      (
        await authed(token)
          .post(`${base}/clients`)
          .send({ displayName: 'Lead Client', primaryPhone: '+919000000123' })
      ).status,
    ).toBe(201);
    // Never granted PROJECT_DELETE or PAYMENT_VIEW.
    expect((await authed(token).get(`${base}/payments`)).status).toBe(403);
    expect((await authed(token).delete(`${base}/projects/${org.branchId}`)).status).toBe(403);
  });

  it('applies a role change on the employee’s next request', async () => {
    const readOnly = await authed(adminToken)
      .post(`${base}/roles`)
      .send({ name: 'Read Only', permissionKeys: ['DASHBOARD_VIEW'] })
      .expect(201);
    const withClients = await authed(adminToken)
      .post(`${base}/roles`)
      .send({ name: 'Client Desk', permissionKeys: ['DASHBOARD_VIEW', 'CLIENT_VIEW'] })
      .expect(201);

    const created = await createEmployee(adminToken, 'switch@test-studio.test', [
      readOnly.body.data.id,
    ]).expect(201);
    const token = await login({
      id: '',
      email: 'switch@test-studio.test',
      password: 'TestPassw0rd!',
    });
    expect((await authed(token).get(`${base}/clients`)).status).toBe(403);

    await authed(adminToken)
      .put(`${base}/users/${created.body.data.id}/roles`)
      .send({ roleIds: [withClients.body.data.id] })
      .expect(200);

    expect((await authed(token).get(`${base}/clients`)).status).toBe(200);
  });

  it('stops a manager from assigning a role stronger than their own', async () => {
    const managerToken = await login(org.manager);
    const response = await authed(managerToken)
      .put(`${base}/users/${org.member.id}/roles`)
      .send({ roleIds: [org.roleIds.ADMIN] });

    expect(response.status).toBe(403);
    expect(response.body.error.message).toMatch(/not allowed to assign/i);
  });

  it('stops a manager from creating a role that grants more than they hold', async () => {
    const managerToken = await login(org.manager);
    const response = await authed(managerToken)
      .post(`${base}/roles`)
      .send({ name: 'Backdoor', permissionKeys: ['ROLE_DELETE'] });

    // MANAGER lacks ROLE_CREATE outright, so authorization stops it first.
    expect(response.status).toBe(403);
  });

  it('rejects assigning an inactive role', async () => {
    const role = await authed(adminToken)
      .post(`${base}/roles`)
      .send({ name: 'Retired Desk', permissionKeys: ['DASHBOARD_VIEW'] })
      .expect(201);
    await authed(adminToken)
      .patch(`${base}/roles/${role.body.data.id}`)
      .send({ status: 'INACTIVE' })
      .expect(200);

    const response = await createEmployee(adminToken, 'inactive@test-studio.test', [
      role.body.data.id,
    ]);
    expect(response.status).toBe(409);
    expect(response.body.error.message).toMatch(/inactive/i);
  });

  it('stops granting permissions through an inactive role', async () => {
    const role = await authed(adminToken)
      .post(`${base}/roles`)
      .send({ name: 'Suspendable', permissionKeys: ['DASHBOARD_VIEW', 'CLIENT_VIEW'] })
      .expect(201);
    await createEmployee(adminToken, 'suspend@test-studio.test', [role.body.data.id]).expect(201);

    const token = await login({
      id: '',
      email: 'suspend@test-studio.test',
      password: 'TestPassw0rd!',
    });
    expect((await authed(token).get(`${base}/clients`)).status).toBe(200);

    await authed(adminToken)
      .patch(`${base}/roles/${role.body.data.id}`)
      .send({ status: 'INACTIVE' })
      .expect(200);

    // Authority is re-read from Postgres per request, so this is immediate.
    expect((await authed(token).get(`${base}/clients`)).status).toBe(403);
  });

  it('rejects a role from another organization', async () => {
    const otherOrg = await seedTestOrganization('other-studio');
    const response = await createEmployee(adminToken, 'crossorg@test-studio.test', [
      otherOrg.roleIds.MEMBER,
    ]);
    expect(response.status).toBe(400);
    expect(response.body.error.message).toMatch(/invalid/i);
  });

  it('does not expose another organization’s custom roles', async () => {
    await authed(adminToken)
      .post(`${base}/roles`)
      .send({ name: 'Studio A Only', permissionKeys: ['DASHBOARD_VIEW'] })
      .expect(201);

    const otherOrg = await seedTestOrganization('other-studio');
    const otherToken = await login(otherOrg.admin);
    const response = await authed(otherToken).get(`${base}/roles`).expect(200);

    const names = response.body.data.map((role: { name: string }) => role.name);
    expect(names).not.toContain('Studio A Only');
  });

  it('marks roles the actor may not assign as not assignable', async () => {
    const managerToken = await login(org.manager);
    const response = await authed(managerToken).get(`${base}/roles`);

    // MANAGER lacks ROLE_VIEW-independent access; if it can read the list, the
    // ADMIN row must still be flagged unassignable.
    if (response.status === 200) {
      const admin = response.body.data.find((role: { name: string }) => role.name === 'ADMIN');
      expect(admin.assignable).toBe(false);
    } else {
      expect(response.status).toBe(403);
    }
  });
});
