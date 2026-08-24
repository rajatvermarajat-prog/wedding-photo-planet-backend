import { beforeEach, describe, expect, it } from 'vitest';
import { authed, base, login } from '../helpers/api';
import { prisma, resetDatabase, seedTestOrganization, TestOrg } from '../helpers/factory';

describe('shoot crew assignment', () => {
  let org: TestOrg;
  let token: string;
  let shootId: string;
  let freelancerId: string;

  beforeEach(async () => {
    await resetDatabase();
    org = await seedTestOrganization();
    token = await login(org.admin);

    const client = await authed(token)
      .post(`${base}/clients`)
      .send({ displayName: 'Test Couple', primaryPhone: '+919812345678' })
      .expect(201);

    const project = await authed(token)
      .post(`${base}/projects`)
      .send({ clientId: client.body.data.id, name: 'Test Wedding', weddingDate: '2026-12-14' })
      .expect(201);

    const shoot = await authed(token)
      .post(`${base}/shoots`)
      .send({ projectId: project.body.data.id, title: 'Wedding Day', shootDate: '2026-12-14' })
      .expect(201);
    shootId = shoot.body.data.id;

    const freelancer = await authed(token)
      .post(`${base}/freelancers`)
      .send({ fullName: 'Rohit Candid', phone: '+919900112233', rate: '18000.00' })
      .expect(201);
    freelancerId = freelancer.body.data.id;
  });

  it('assigns an employee to a shoot', async () => {
    const response = await authed(token)
      .post(`${base}/shoots/${shootId}/assignments`)
      .send({ userId: org.member.id, role: 'LEAD_PHOTOGRAPHER' })
      .expect(201);

    expect(response.body.data.userId).toBe(org.member.id);
    expect(response.body.data.freelancerId).toBeNull();
    expect(response.body.data.status).toBe('ASSIGNED');
  });

  it('assigns a freelancer with an agreed cost', async () => {
    const response = await authed(token)
      .post(`${base}/shoots/${shootId}/assignments`)
      .send({
        freelancerId,
        role: 'CANDID_PHOTOGRAPHER',
        agreedAmount: '18000.00',
        travelAmount: '2000.00',
      })
      .expect(201);

    expect(response.body.data.freelancerId).toBe(freelancerId);
    expect(response.body.data.agreedAmount).toBe('18000');
  });

  it('rejects an assignment naming both an employee and a freelancer', async () => {
    const response = await authed(token)
      .post(`${base}/shoots/${shootId}/assignments`)
      .send({ userId: org.member.id, freelancerId, role: 'ASSISTANT' });

    expect(response.status).toBe(400);
    // The envelope message is stable; the specific rule is in `details`.
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(JSON.stringify(response.body.error.details)).toMatch(/exactly one/i);
  });

  it('rejects an assignment naming neither', async () => {
    const response = await authed(token)
      .post(`${base}/shoots/${shootId}/assignments`)
      .send({ role: 'ASSISTANT' });
    expect(response.status).toBe(400);
  });

  it('prevents assigning the same employee to the same shoot twice', async () => {
    await authed(token)
      .post(`${base}/shoots/${shootId}/assignments`)
      .send({ userId: org.member.id, role: 'LEAD_PHOTOGRAPHER' })
      .expect(201);

    const duplicate = await authed(token)
      .post(`${base}/shoots/${shootId}/assignments`)
      .send({ userId: org.member.id, role: 'ASSISTANT' });

    expect(duplicate.status).toBe(409);
    expect(await prisma.shootAssignment.count({ where: { shootId } })).toBe(1);
  });

  it('prevents assigning the same freelancer to the same shoot twice', async () => {
    await authed(token)
      .post(`${base}/shoots/${shootId}/assignments`)
      .send({ freelancerId, role: 'CANDID_PHOTOGRAPHER' })
      .expect(201);

    const duplicate = await authed(token)
      .post(`${base}/shoots/${shootId}/assignments`)
      .send({ freelancerId, role: 'DRONE_OPERATOR' });

    expect(duplicate.status).toBe(409);
  });

  it('blocks over-booking a freelancer beyond their daily limit', async () => {
    const otherShoot = await prisma.shoot.findFirstOrThrow({ where: { id: shootId } });

    const second = await authed(token)
      .post(`${base}/shoots`)
      .send({
        projectId: otherShoot.projectId,
        title: 'Second shoot same day',
        shootDate: '2026-12-14',
      })
      .expect(201);

    await authed(token)
      .post(`${base}/shoots/${shootId}/assignments`)
      .send({ freelancerId, role: 'CANDID_PHOTOGRAPHER' })
      .expect(201);

    // maxShootsPerDay defaults to 1.
    const clash = await authed(token)
      .post(`${base}/shoots/${second.body.data.id}/assignments`)
      .send({ freelancerId, role: 'CANDID_PHOTOGRAPHER' });

    expect(clash.status).toBe(409);
    expect(clash.body.error.message).toMatch(/already booked/i);
  });

  it('notifies an employee when they are assigned', async () => {
    await authed(token)
      .post(`${base}/shoots/${shootId}/assignments`)
      .send({ userId: org.member.id, role: 'LEAD_PHOTOGRAPHER' })
      .expect(201);

    const notification = await prisma.notification.findFirst({
      where: { userId: org.member.id, type: 'SHOOT_ASSIGNED' },
    });
    expect(notification).not.toBeNull();
  });

  it('writes an audit entry for the assignment', async () => {
    await authed(token)
      .post(`${base}/shoots/${shootId}/assignments`)
      .send({ userId: org.member.id, role: 'LEAD_PHOTOGRAPHER' })
      .expect(201);

    const audit = await prisma.auditLog.findFirst({
      where: { entityType: 'ShootAssignment', action: 'ASSIGN' },
    });
    expect(audit).not.toBeNull();
    expect(audit?.actorId).toBe(org.admin.id);
  });

  it('is rejected at the database level even when the service is bypassed', async () => {
    // Direct insert with neither assignee — the CHECK constraint must hold.
    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO shoot_assignments (id, shoot_id, user_id, freelancer_id, role, status,
           agreed_amount, travel_amount, extra_amount, data_received, assigned_at, created_at, updated_at)
         VALUES (gen_random_uuid(), $1::uuid, NULL, NULL, 'ASSISTANT', 'ASSIGNED', 0, 0, 0, false, now(), now(), now())`,
        shootId,
      ),
    ).rejects.toThrow();
  });
});
