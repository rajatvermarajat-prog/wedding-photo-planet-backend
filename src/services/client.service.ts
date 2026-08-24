import { prisma } from '../config/prisma';
import { andWhere, findScoped, paginate, searchFilter } from '../repositories/base.repository';
import { nextDocumentNumber } from '../utils/documentNumber';
import { resolveSort } from '../utils/pagination';
import { conflict } from '../utils/errors';
import { AuthContext } from '../types';
import { auditContextFromAuth, recordAudit, AuditRequestContext } from './audit.service';

const SORTABLE = ['createdAt', 'displayName', 'clientCode'] as const;

export interface ClientListQuery {
  page?: number;
  limit?: number;
  search?: string;
  isActive?: boolean;
  sortBy?: string;
  sortOrder?: string;
}

export function listClients(organizationId: string, query: ClientListQuery) {
  const sort = resolveSort(query.sortBy, query.sortOrder, SORTABLE, 'createdAt');
  return paginate(prisma.client, {
    where: andWhere(
      { organizationId, deletedAt: null },
      query.isActive === undefined ? undefined : { isActive: query.isActive },
      searchFilter(query.search, ['displayName', 'primaryPhone', 'primaryEmail', 'clientCode']),
    ),
    orderBy: { [sort.field]: sort.direction },
    page: query.page,
    limit: query.limit,
    include: { _count: { select: { projects: true } } },
  });
}

export function getClient(organizationId: string, id: string) {
  return findScoped(prisma.client, organizationId, id, 'Client', {
    include: {
      contacts: { orderBy: { isPrimary: 'desc' } },
      addresses: { orderBy: { isPrimary: 'desc' } },
      notes: { where: { deletedAt: null }, orderBy: { createdAt: 'desc' }, take: 20 },
      projects: {
        where: { deletedAt: null },
        select: { id: true, projectNumber: true, name: true, status: true, weddingDate: true },
        orderBy: { createdAt: 'desc' },
      },
    },
  });
}

export interface CreateClientInput {
  displayName: string;
  primaryPhone: string;
  primaryEmail?: string;
  brideName?: string;
  groomName?: string;
  gstNumber?: string;
  contacts?: Array<{ name: string; relationship?: string; phone?: string; email?: string; isPrimary?: boolean }>;
  addresses?: Array<{
    type?: 'HOME' | 'OFFICE' | 'VENUE' | 'BILLING' | 'OTHER';
    label?: string;
    addressLine: string;
    city?: string;
    state?: string;
    postalCode?: string;
    isPrimary?: boolean;
  }>;
}

export async function createClient(auth: AuthContext, input: CreateClientInput, ctx: AuditRequestContext) {
  return prisma.$transaction(async (tx) => {
    const clientCode = await nextDocumentNumber(tx, auth.organizationId, 'CLIENT');

    const client = await tx.client.create({
      data: {
        organizationId: auth.organizationId,
        clientCode,
        displayName: input.displayName,
        primaryPhone: input.primaryPhone,
        primaryEmail: input.primaryEmail?.toLowerCase(),
        brideName: input.brideName,
        groomName: input.groomName,
        gstNumber: input.gstNumber,
        contacts: input.contacts?.length ? { createMany: { data: input.contacts } } : undefined,
        addresses: input.addresses?.length ? { createMany: { data: input.addresses } } : undefined,
      },
      include: { contacts: true, addresses: true },
    });

    await recordAudit(tx, ctx, {
      action: 'CREATE',
      entityType: 'Client',
      entityId: client.id,
      summary: `Client ${client.clientCode} created`,
      newData: client,
    });

    return client;
  });
}

export async function updateClient(
  auth: AuthContext,
  id: string,
  input: Partial<CreateClientInput>,
  ctx: AuditRequestContext,
) {
  return prisma.$transaction(async (tx) => {
    const existing = await findScoped<{ id: string }>(tx.client, auth.organizationId, id, 'Client');

    const updated = await tx.client.update({
      where: { id },
      data: {
        displayName: input.displayName,
        primaryPhone: input.primaryPhone,
        primaryEmail: input.primaryEmail?.toLowerCase(),
        brideName: input.brideName,
        groomName: input.groomName,
        gstNumber: input.gstNumber,
      },
    });

    await recordAudit(tx, ctx, {
      action: 'UPDATE',
      entityType: 'Client',
      entityId: id,
      summary: 'Client updated',
      oldData: existing,
      newData: updated,
    });

    return updated;
  });
}

export async function deleteClient(auth: AuthContext, id: string, ctx: AuditRequestContext) {
  return prisma.$transaction(async (tx) => {
    const client = await findScoped<{ id: string; clientCode: string }>(
      tx.client,
      auth.organizationId,
      id,
      'Client',
    );

    const liveProjects = await tx.project.count({
      where: { clientId: id, deletedAt: null },
    });
    if (liveProjects > 0) {
      throw conflict(
        `Cannot delete a client with ${liveProjects} active project(s). Archive the projects first.`,
      );
    }

    await tx.client.update({
      where: { id },
      data: { deletedAt: new Date(), deletedBy: auth.userId, isActive: false },
    });

    await recordAudit(tx, ctx, {
      action: 'SOFT_DELETE',
      entityType: 'Client',
      entityId: id,
      summary: `Client ${client.clientCode} archived`,
      oldData: client,
    });
  });
}

export async function addClientNote(
  auth: AuthContext,
  clientId: string,
  body: string,
  isPinned: boolean,
  ctx: AuditRequestContext,
) {
  await findScoped(prisma.client, auth.organizationId, clientId, 'Client');
  const note = await prisma.clientNote.create({
    data: { clientId, authorId: auth.userId, body, isPinned },
  });
  await recordAudit(prisma, ctx, {
    action: 'CREATE',
    entityType: 'ClientNote',
    entityId: note.id,
    summary: 'Client note added',
  });
  return note;
}

export { auditContextFromAuth };
