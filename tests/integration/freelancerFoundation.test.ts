import { beforeEach, describe, expect, it } from 'vitest';
import { api, authed, base, login } from '../helpers/api';
import { prisma, resetDatabase, seedTestOrganization, TestOrg } from '../helpers/factory';
import { isFreelancerSearchable } from '../../src/services/freelancer.service';
import { hashPassword } from '../../src/utils/password';

describe('freelancer foundation security', () => {
  let org: TestOrg;
  let otherOrg: TestOrg;
  let adminToken: string;
  let memberToken: string;
  let freelancerId: string;
  let projectId: string;
  let shootId: string;

  beforeEach(async () => {
    await resetDatabase();
    org = await seedTestOrganization('foundation-a');
    otherOrg = await seedTestOrganization('foundation-b');
    adminToken = await login(org.admin);
    memberToken = await login(org.member);

    const client = await authed(adminToken)
      .post(`${base}/clients`)
      .send({ displayName: 'Foundation Couple', primaryPhone: '9812345678' })
      .expect(201);

    const project = await authed(adminToken)
      .post(`${base}/projects`)
      .send({ clientId: client.body.data.id, name: 'Foundation Wedding', weddingDate: '2026-12-14' })
      .expect(201);
    projectId = project.body.data.id;

    const shoot = await authed(adminToken)
      .post(`${base}/shoots`)
      .send({ projectId, title: 'Foundation Shoot', shootDate: '2026-12-14' })
      .expect(201);
    shootId = shoot.body.data.id;

    const freelancer = await authed(adminToken)
      .post(`${base}/freelancers`)
      .send({ fullName: 'Foundation Artist', phone: '9900112233', rate: '12000.00' })
      .expect(201);
    freelancerId = freelancer.body.data.id;
  });

  it('rejects unauthenticated and unauthorized freelancer foundation mutations', async () => {
    await api()
      .get(`${base}/freelancers/plans`)
      .expect(401);

    await authed(memberToken)
      .post(`${base}/freelancers/plans`)
      .send({ name: 'Pro', slug: 'pro', price: '1000.00' })
      .expect(403);

    const response = await authed(memberToken)
      .post(`${base}/freelancers/applications`)
      .send({ fullName: 'Applicant', phone: '9876543210' });
    expect(response.status).toBe(403);
  });

  it('keeps application creation submitted-only and detects active duplicates', async () => {
    const created = await authed(adminToken)
      .post(`${base}/freelancers/applications`)
      .send({
        fullName: 'Privilege Escalation Attempt',
        phone: '9876543210',
        email: 'artist@example.com',
        status: 'APPROVED',
      })
      .expect(201);

    expect(created.body.data.status).toBe('SUBMITTED');
    expect(created.body.data.reviewedById).toBeNull();

    const duplicate = await authed(adminToken)
      .post(`${base}/freelancers/applications`)
      .send({ fullName: 'Duplicate Applicant', phone: '9876543210' });
    expect(duplicate.status).toBe(409);
  });

  it('enforces organization boundaries for subscriptions and connections', async () => {
    const otherFreelancer = await prisma.freelancer.create({
      data: {
        organizationId: otherOrg.organizationId,
        code: 'F-OTHER',
        fullName: 'Other Org Artist',
        phone: '9876500000',
      },
    });
    const otherPlan = await prisma.freelancerPlan.create({
      data: {
        organizationId: otherOrg.organizationId,
        name: 'Other Plan',
        slug: 'other-plan',
        price: '1000.00',
      },
    });

    await authed(adminToken)
      .post(`${base}/freelancers/${otherFreelancer.id}/subscriptions`)
      .send({ planId: otherPlan.id })
      .expect(404);

    await authed(adminToken)
      .post(`${base}/freelancers/connections`)
      .send({ freelancerId: otherFreelancer.id, projectId })
      .expect(404);
  });

  it('validates subscription status transitions', async () => {
    const plan = await authed(adminToken)
      .post(`${base}/freelancers/plans`)
      .send({ name: 'Studio Pro', slug: 'studio-pro', price: '1500.00' })
      .expect(201);

    const subscription = await authed(adminToken)
      .post(`${base}/freelancers/${freelancerId}/subscriptions`)
      .send({ planId: plan.body.data.id, status: 'ACTIVE' })
      .expect(201);

    const invalid = await authed(adminToken)
      .patch(`${base}/freelancers/${freelancerId}/subscriptions/${subscription.body.data.id}`)
      .send({ status: 'PENDING' });
    expect(invalid.status).toBe(409);
  });

  it('prevents duplicate active connections while allowing different contexts', async () => {
    await authed(adminToken)
      .post(`${base}/freelancers/connections`)
      .send({ freelancerId, projectId })
      .expect(201);

    await authed(adminToken)
      .post(`${base}/freelancers/connections`)
      .send({ freelancerId, projectId })
      .expect(409);

    const secondClient = await authed(adminToken)
      .post(`${base}/clients`)
      .send({ displayName: 'Second Couple', primaryPhone: '9812345679' })
      .expect(201);
    const secondProject = await authed(adminToken)
      .post(`${base}/projects`)
      .send({ clientId: secondClient.body.data.id, name: 'Second Wedding' })
      .expect(201);

    await authed(adminToken)
      .post(`${base}/freelancers/connections`)
      .send({ freelancerId, projectId: secondProject.body.data.id })
      .expect(201);
  });

  it('rejects a connection when the shoot does not belong to the selected project', async () => {
    const secondClient = await authed(adminToken)
      .post(`${base}/clients`)
      .send({ displayName: 'Mismatch Couple', primaryPhone: '9812345680' })
      .expect(201);
    const secondProject = await authed(adminToken)
      .post(`${base}/projects`)
      .send({ clientId: secondClient.body.data.id, name: 'Mismatch Wedding' })
      .expect(201);

    const response = await authed(adminToken)
      .post(`${base}/freelancers/connections`)
      .send({ freelancerId, projectId: secondProject.body.data.id, shootId });
    expect(response.status).toBe(409);
  });

  it('rejects portfolio attachment to a file from another organization', async () => {
    const otherFile = await prisma.fileObject.create({
      data: {
        organizationId: otherOrg.organizationId,
        entityType: 'FREELANCER_PORTFOLIO',
        bucket: 'test',
        objectKey: 'other-org/portfolio.jpg',
        originalName: 'portfolio.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 1000n,
      },
    });

    await authed(adminToken)
      .post(`${base}/freelancers/${freelancerId}/portfolio`)
      .send({ fileObjectId: otherFile.id, title: 'Other file' })
      .expect(404);
  });

  it('validates availability time order and keeps list pagination bounded', async () => {
    const invalid = await authed(adminToken)
      .put(`${base}/freelancers/${freelancerId}/availability`)
      .send({
        date: '2026-12-14',
        status: 'PARTIALLY_AVAILABLE',
        startTime: '2026-12-14T14:00:00.000Z',
        endTime: '2026-12-14T10:00:00.000Z',
      });
    expect(invalid.status).toBe(400);

    const listed = await authed(adminToken)
      .get(`${base}/freelancers/plans?limit=100000`)
      .expect(400);
    expect(listed.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('centralizes search eligibility around approved application and active subscription', async () => {
    const plan = await prisma.freelancerPlan.create({
      data: {
        organizationId: org.organizationId,
        name: 'Searchable',
        slug: 'searchable',
        price: '1000.00',
      },
    });

    expect(await isFreelancerSearchable(org.organizationId, freelancerId)).toBe(false);

    await prisma.freelancerApplication.create({
      data: {
        organizationId: org.organizationId,
        freelancerId,
        fullName: 'Foundation Artist',
        phone: '9900112233',
        status: 'APPROVED',
        reviewedById: org.admin.id,
        reviewedAt: new Date(),
      },
    });
    await prisma.freelancerSubscription.create({
      data: {
        freelancerId,
        planId: plan.id,
        status: 'ACTIVE',
        startedAt: new Date(),
        currentPeriodEnd: new Date(Date.now() + 86_400_000),
      },
    });

    expect(await isFreelancerSearchable(org.organizationId, freelancerId)).toBe(true);
  });

  it('authenticates a freelancer separately from internal CRM users and exposes only own portal data', async () => {
    await prisma.freelancer.update({
      where: { id: freelancerId },
      data: { email: 'foundation.artist@example.com', passwordHash: await hashPassword('Freelancer1') },
    });
    const other = await prisma.freelancer.create({
      data: {
        organizationId: org.organizationId,
        code: 'F-SECOND',
        fullName: 'Second Artist',
        phone: '9876511111',
        passwordHash: await hashPassword('Freelancer1'),
      },
    });
    await prisma.freelancerAvailability.create({
      data: { freelancerId: other.id, date: new Date('2026-12-20T00:00:00Z'), status: 'AVAILABLE' },
    });

    await api()
      .get(`${base}/freelancer-portal/me`)
      .expect(401);

    const bad = await api()
      .post(`${base}/freelancer-portal/auth/login`)
      .send({ identifier: 'foundation.artist@example.com', password: 'WrongPass1' });
    expect(bad.status).toBe(401);

    const loginResponse = await api()
      .post(`${base}/freelancer-portal/auth/login`)
      .send({ identifier: 'foundation.artist@example.com', password: 'Freelancer1' })
      .expect(200);
    const token = loginResponse.body.data.tokens.accessToken as string;

    const me = await api()
      .get(`${base}/freelancer-portal/me`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(me.body.data.freelancer.id).toBe(freelancerId);
    expect(me.body.data.freelancer.availability).toHaveLength(0);

    await api()
      .put(`${base}/freelancer-portal/availability`)
      .set('Authorization', `Bearer ${token}`)
      .send({ date: '2026-12-21', status: 'AVAILABLE' })
      .expect(200);

    expect(await prisma.freelancerAvailability.count({ where: { freelancerId } })).toBe(1);
    expect(await prisma.freelancerAvailability.count({ where: { freelancerId: other.id } })).toBe(1);

    await api()
      .post(`${base}/freelancer-portal/auth/logout`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    await api()
      .get(`${base}/freelancer-portal/me`)
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
  });
});
