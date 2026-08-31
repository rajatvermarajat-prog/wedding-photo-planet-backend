import { beforeEach, describe, expect, it } from 'vitest';
import { authed, base, login } from '../helpers/api';
import { prisma, resetDatabase, seedTestOrganization, TestOrg } from '../helpers/factory';

describe('CRM: clients, projects, events, shoots', () => {
  let org: TestOrg;
  let token: string;

  beforeEach(async () => {
    await resetDatabase();
    org = await seedTestOrganization();
    token = await login(org.admin);
  });

  const createClient = async (name = 'Aarav & Diya') => {
    const response = await authed(token)
      .post(`${base}/clients`)
      .send({ displayName: name, primaryPhone: '+919812345678', primaryEmail: 'a@example.com' })
      .expect(201);
    return response.body.data;
  };

  const createProject = async (clientId: string) => {
    const response = await authed(token)
      .post(`${base}/projects`)
      .send({
        clientId,
        name: 'Aarav & Diya — Wedding',
        type: 'WEDDING',
        weddingDate: '2026-12-14',
        totalQuotation: '450000.00',
        events: [{ name: 'Wedding Ceremony', eventDate: '2026-12-14', venueName: 'Fairmont' }],
      })
      .expect(201);
    return response.body.data;
  };

  it('creates a client with an auto-allocated client code', async () => {
    const client = await createClient();
    expect(client.clientCode).toMatch(/^CLI-\d{4}$/);
    expect(client.displayName).toBe('Aarav & Diya');
  });

  it('allocates sequential, unique client codes', async () => {
    const first = await createClient('First Couple');
    const second = await createClient('Second Couple');
    expect(first.clientCode).not.toBe(second.clientCode);
  });

  it('creates a project with its events in one transaction', async () => {
    const client = await createClient();
    const project = await createProject(client.id);

    expect(project.projectNumber).toMatch(/^PRJ-\d{4}-\d{4}$/);
    expect(project.status).toBe('LEAD');
    expect(project.events).toHaveLength(1);
    // Money is an exact decimal string, never a float. Trailing zeros are not
    // padded, so 450000.00 is sent as "450000".
    expect(project.totalQuotation).toBe('450000');
    expect(typeof project.totalQuotation).toBe('string');

    const history = await prisma.projectStatusHistory.findMany({ where: { projectId: project.id } });
    expect(history).toHaveLength(1);
    expect(history[0].newStatus).toBe('LEAD');
  });

  it('rolls the whole project creation back when the client does not exist', async () => {
    const before = await prisma.project.count();
    const response = await authed(token)
      .post(`${base}/projects`)
      .send({ clientId: '00000000-0000-4000-8000-000000000000', name: 'Orphan' });

    expect(response.status).toBe(404);
    expect(await prisma.project.count()).toBe(before);
  });

  it('enforces the project status machine and records every transition', async () => {
    const client = await createClient();
    const project = await createProject(client.id);

    // LEAD -> COMPLETED is not a legal jump.
    const illegal = await authed(token)
      .patch(`${base}/projects/${project.id}/status`)
      .send({ status: 'COMPLETED' });
    expect(illegal.status).toBe(400);

    await authed(token)
      .patch(`${base}/projects/${project.id}/status`)
      .send({ status: 'CONFIRMED', reason: 'Advance received' })
      .expect(200);

    const history = await prisma.projectStatusHistory.findMany({
      where: { projectId: project.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(history.map((h) => h.newStatus)).toEqual(['LEAD', 'CONFIRMED']);
    expect(history[1].reason).toBe('Advance received');
    expect(history[1].changedById).toBe(org.admin.id);
  });

  it('creates an event attached to a project', async () => {
    const client = await createClient();
    const project = await createProject(client.id);

    const response = await authed(token)
      .post(`${base}/events`)
      .send({
        projectId: project.id,
        eventTypeId: org.eventTypeId,
        name: 'Sangeet',
        eventDate: '2026-12-12',
        venueName: 'Fairmont Lawn',
      })
      .expect(201);

    expect(response.body.data.name).toBe('Sangeet');
    expect(response.body.data.projectId).toBe(project.id);
  });

  it('creates a shoot and rejects an event from a different project', async () => {
    const client = await createClient();
    const projectA = await createProject(client.id);
    const projectB = await createProject(client.id);

    const shoot = await authed(token)
      .post(`${base}/shoots`)
      .send({
        projectId: projectA.id,
        eventId: projectA.events[0].id,
        title: 'Wedding Day Coverage',
        shootDate: '2026-12-14',
      })
      .expect(201);
    expect(shoot.body.data.status).toBe('SCHEDULED');

    const mismatched = await authed(token)
      .post(`${base}/shoots`)
      .send({
        projectId: projectB.id,
        eventId: projectA.events[0].id,
        title: 'Wrong event',
        shootDate: '2026-12-14',
      });
    expect(mismatched.status).toBe(400);
  });

  it('paginates and never exceeds the maximum page size', async () => {
    await createClient('Alpha');
    await createClient('Beta');

    const capped = await authed(token).get(`${base}/clients?page=1&limit=9999`);
    expect(capped.status).toBe(400);

    const page = await authed(token).get(`${base}/clients?page=1&limit=1`).expect(200);
    expect(page.body.data).toHaveLength(1);
    expect(page.body.meta.pagination.total).toBe(2);
    expect(page.body.meta.pagination.hasNext).toBe(true);
  });

  it('filters clients by search term', async () => {
    await createClient('Aarav & Diya');
    await createClient('Rohan & Meera');

    const response = await authed(token).get(`${base}/clients?search=rohan`).expect(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].displayName).toBe('Rohan & Meera');
  });

  it('soft-deletes a client and hides it from lists', async () => {
    const client = await createClient();
    await authed(token).delete(`${base}/clients/${client.id}`).expect(204);

    const list = await authed(token).get(`${base}/clients`).expect(200);
    expect(list.body.data).toHaveLength(0);

    // The row is retained with a tombstone, not removed.
    const row = await prisma.client.findUnique({ where: { id: client.id } });
    expect(row).not.toBeNull();
    expect(row?.deletedAt).not.toBeNull();
    expect(row?.deletedBy).toBe(org.admin.id);
  });

  it('refuses to archive a client that still has live projects', async () => {
    const client = await createClient();
    await createProject(client.id);

    const response = await authed(token).delete(`${base}/clients/${client.id}`);
    expect(response.status).toBe(409);
  });

  it('converts a lead into a client exactly once', async () => {
    const lead = await authed(token)
      .post(`${base}/leads`)
      .send({ name: 'Karan & Simran', phone: '+919900112233', estimatedValue: '300000.00' })
      .expect(201);

    const converted = await authed(token)
      .post(`${base}/leads/${lead.body.data.id}/convert`)
      .send({})
      .expect(200);

    expect(converted.body.data.status).toBe('WON');
    expect(converted.body.data.client.displayName).toBe('Karan & Simran');

    const second = await authed(token)
      .post(`${base}/leads/${lead.body.data.id}/convert`)
      .send({});
    expect(second.status).toBe(409);
  });

  it('scopes lead lists and direct detail access to the assigned employee', async () => {
    const memberLead = await authed(token)
      .post(`${base}/leads`)
      .send({ name: 'Assigned Couple', phone: '+919900112234', ownerId: org.member.id })
      .expect(201);
    const otherLead = await authed(token)
      .post(`${base}/leads`)
      .send({ name: 'Another Couple', phone: '+919900112235', ownerId: org.manager.id })
      .expect(201);

    const memberToken = await login(org.member);
    const memberList = await authed(memberToken).get(`${base}/leads?search=couple`).expect(200);
    expect(memberList.body.data.map((lead: { id: string }) => lead.id)).toEqual([memberLead.body.data.id]);
    expect(memberList.body.meta.pagination.total).toBe(1);

    await authed(memberToken).get(`${base}/leads/${memberLead.body.data.id}`).expect(200);
    // A guessed UUID reads as missing, without revealing another employee's lead.
    await authed(memberToken).get(`${base}/leads/${otherLead.body.data.id}`).expect(404);

    const adminList = await authed(token).get(`${base}/leads?search=couple`).expect(200);
    expect(adminList.body.meta.pagination.total).toBe(2);
  });

  it('rejects a malformed UUID before it reaches the database', async () => {
    const response = await authed(token).get(`${base}/clients/not-a-uuid`);
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });
});
