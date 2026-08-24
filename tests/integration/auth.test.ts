import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { api, authed, base, login } from '../helpers/api';
import { prisma, resetDatabase, seedTestOrganization, TestOrg } from '../helpers/factory';

describe('authentication', () => {
  let org: TestOrg;

  beforeAll(async () => {
    await resetDatabase();
  });

  beforeEach(async () => {
    await resetDatabase();
    org = await seedTestOrganization();
  });

  it('signs in with valid credentials and returns roles and permissions', async () => {
    const response = await api()
      .post(`${base}/auth/login`)
      .send({ email: org.admin.email, password: org.admin.password });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.tokens.accessToken).toBeTruthy();
    expect(response.body.data.tokens.refreshToken).toBeTruthy();
    expect(response.body.data.user.roles).toContain('ADMIN');
    expect(response.body.data.user.permissions).toContain('PAYMENT_CREATE');
  });

  it('never returns a password hash', async () => {
    const response = await api()
      .post(`${base}/auth/login`)
      .send({ email: org.admin.email, password: org.admin.password });

    expect(JSON.stringify(response.body)).not.toContain('passwordHash');
    expect(response.body.data.user.passwordHash).toBeUndefined();
  });

  it('rejects a wrong password with an indistinguishable message', async () => {
    const wrongPassword = await api()
      .post(`${base}/auth/login`)
      .send({ email: org.admin.email, password: 'NotThePassword1!' });

    const unknownEmail = await api()
      .post(`${base}/auth/login`)
      .send({ email: 'nobody@test.test', password: 'NotThePassword1!' });

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    // User enumeration must not be possible from the response.
    expect(wrongPassword.body.error.message).toBe(unknownEmail.body.error.message);
  });

  it('records every login attempt in login history', async () => {
    await api().post(`${base}/auth/login`).send({ email: org.admin.email, password: 'wrong-password' });
    await api()
      .post(`${base}/auth/login`)
      .send({ email: org.admin.email, password: org.admin.password });

    const history = await prisma.loginHistory.findMany({ orderBy: { createdAt: 'asc' } });
    expect(history.map((h) => h.outcome)).toEqual(['INVALID_CREDENTIALS', 'SUCCESS']);
  });

  it('locks the account after repeated failures', async () => {
    for (let i = 0; i < 5; i += 1) {
      await api().post(`${base}/auth/login`).send({ email: org.member.email, password: 'wrong-password' });
    }

    const response = await api()
      .post(`${base}/auth/login`)
      .send({ email: org.member.email, password: org.member.password });

    expect(response.status).toBe(403);
    expect(response.body.error.message).toMatch(/locked/i);
  });

  it('returns the current user from /auth/me', async () => {
    const token = await login(org.admin);
    const response = await authed(token).get(`${base}/auth/me`);

    expect(response.status).toBe(200);
    expect(response.body.data.email).toBe(org.admin.email);
    expect(response.body.data.organization.slug).toBe('test-studio');
  });

  it('rejects requests with no token', async () => {
    const response = await api().get(`${base}/auth/me`);
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('rotates the refresh token and retires the old one', async () => {
    const loginResponse = await api()
      .post(`${base}/auth/login`)
      .send({ email: org.admin.email, password: org.admin.password });
    const original = loginResponse.body.data.tokens.refreshToken;

    const first = await api().post(`${base}/auth/refresh`).send({ refreshToken: original });
    expect(first.status).toBe(200);
    expect(first.body.data.tokens.refreshToken).not.toBe(original);

    // Reusing a rotated token must fail — it is single-use.
    const replay = await api().post(`${base}/auth/refresh`).send({ refreshToken: original });
    expect(replay.status).toBe(401);
  });

  it('invalidates the session immediately on logout', async () => {
    const token = await login(org.admin);
    await authed(token).post(`${base}/auth/logout`).expect(200);

    const afterLogout = await authed(token).get(`${base}/auth/me`);
    expect(afterLogout.status).toBe(401);
  });

  it('revokes access the moment an account is disabled', async () => {
    const token = await login(org.member);
    await authed(token).get(`${base}/auth/me`).expect(200);

    await prisma.user.update({ where: { id: org.member.id }, data: { status: 'DISABLED' } });

    // Authority is re-read from PostgreSQL per request, so this does not wait
    // for the access token to expire.
    const response = await authed(token).get(`${base}/auth/me`);
    expect(response.status).toBe(403);
  });

  it('writes an audit row for a successful sign-in', async () => {
    await login(org.admin);
    const audit = await prisma.auditLog.findFirst({
      where: { action: 'LOGIN', actorId: org.admin.id },
    });
    expect(audit).not.toBeNull();
    expect(audit?.entityType).toBe('User');
  });
});
