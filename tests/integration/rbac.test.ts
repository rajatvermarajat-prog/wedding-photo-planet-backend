import { beforeEach, describe, expect, it } from 'vitest';
import { authed, base, login } from '../helpers/api';
import { resetDatabase, seedTestOrganization, TestOrg } from '../helpers/factory';

describe('role-based access control', () => {
  let org: TestOrg;

  beforeEach(async () => {
    await resetDatabase();
    org = await seedTestOrganization();
  });

  it('lets an admin read the audit log', async () => {
    const token = await login(org.admin);
    const response = await authed(token).get(`${base}/audit`);
    expect(response.status).toBe(200);
  });

  it('forbids a manager from reading the audit log', async () => {
    const token = await login(org.manager);
    const response = await authed(token).get(`${base}/audit`);
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
    expect(response.body.error.message).toMatch(/AUDIT_VIEW/);
  });

  it('forbids a member from creating a client', async () => {
    const token = await login(org.member);
    const response = await authed(token)
      .post(`${base}/clients`)
      .send({ displayName: 'Nope', primaryPhone: '+911234567890' });

    expect(response.status).toBe(403);
  });

  it('forbids a member from reading payments', async () => {
    const token = await login(org.member);
    expect((await authed(token).get(`${base}/payments`)).status).toBe(403);
  });

  it('forbids a member from managing users', async () => {
    const token = await login(org.member);
    const response = await authed(token)
      .put(`${base}/users/${org.member.id}/roles`)
      .send({ roleIds: [org.roleIds.ADMIN] });

    // A self-service privilege escalation must be impossible.
    expect(response.status).toBe(403);
  });

  it('allows a member the permissions they do hold', async () => {
    const token = await login(org.member);
    expect((await authed(token).get(`${base}/projects`)).status).toBe(200);
    expect((await authed(token).get(`${base}/tasks`)).status).toBe(200);
    expect((await authed(token).get(`${base}/notifications`)).status).toBe(200);
  });

  it('reflects a revoked permission on the very next request', async () => {
    const token = await login(org.manager);
    expect((await authed(token).get(`${base}/clients`)).status).toBe(200);

    const adminToken = await login(org.admin);
    await authed(adminToken)
      .put(`${base}/roles/${org.roleIds.MANAGER}/permissions`)
      .send({ permissionKeys: ['PROJECT_VIEW'] })
      .expect(200);

    const afterRevoke = await authed(token).get(`${base}/clients`);
    expect(afterRevoke.status).toBe(403);
  });

  it('isolates tenants — one studio cannot read another studio’s records', async () => {
    const adminToken = await login(org.admin);
    const created = await authed(adminToken)
      .post(`${base}/clients`)
      .send({ displayName: 'Studio A Client', primaryPhone: '+919000000001' })
      .expect(201);

    const otherOrg = await seedTestOrganization('other-studio');
    const otherToken = await login(otherOrg.admin);

    const response = await authed(otherToken).get(`${base}/clients/${created.body.data.id}`);
    expect(response.status).toBe(404);
  });
});
