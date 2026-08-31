import { LeadStatus, Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { andWhere, paginate, searchFilter } from '../repositories/base.repository';
import { resolveSort } from '../utils/pagination';
import { badRequest, conflict, forbidden, notFound } from '../utils/errors';
import { dateRangeFilter } from '../utils/date';
import { nextDocumentNumber } from '../utils/documentNumber';
import { AuthContext } from '../types';
import { AuditRequestContext, recordAudit } from './audit.service';

const SORTABLE = ['createdAt', 'nextFollowUpAt', 'estimatedValue', 'name'] as const;

export interface LeadListQuery {
  page?: number;
  limit?: number;
  search?: string;
  status?: LeadStatus;
  ownerId?: string;
  sourceId?: string;
  from?: string;
  to?: string;
  sortBy?: string;
  sortOrder?: string;
}

/** Only the ADMIN system role can read across the studio lead book. */
export function canAccessAllLeads(auth: AuthContext): boolean {
  // Existing studios may have the seeded `ADMIN` role or the display-case
  // `Admin` role. Both represent the administrator access level.
  return auth.roles.some((role) => role.trim().toUpperCase() === 'ADMIN');
}

/** Applied to every lead read and write, never merely after a row is loaded. */
function leadAccessWhere(auth: AuthContext): Prisma.LeadWhereInput {
  return {
    organizationId: auth.organizationId,
    deletedAt: null,
    ...(canAccessAllLeads(auth) ? {} : { ownerId: auth.userId }),
  };
}

async function getAccessibleLead<T>(
  db: Pick<typeof prisma.lead, 'findFirst'>,
  auth: AuthContext,
  id: string,
  include?: Prisma.LeadInclude,
): Promise<T> {
  const lead = await db.findFirst({ where: { ...leadAccessWhere(auth), id }, ...(include ? { include } : {}) });
  if (!lead) throw notFound('Lead');
  return lead as T;
}

async function assertLeadOwnerInOrganization(
  db: Pick<typeof prisma.user, 'findFirst'>,
  organizationId: string,
  ownerId: string | undefined,
): Promise<void> {
  if (!ownerId) return;
  const owner = await db.findFirst({ where: { id: ownerId, organizationId, deletedAt: null }, select: { id: true } });
  if (!owner) throw badRequest('Lead owner must be an active employee of this studio');
}

export function listLeads(auth: AuthContext, query: LeadListQuery) {
  const sort = resolveSort(query.sortBy, query.sortOrder, SORTABLE, 'createdAt');
  const created = dateRangeFilter(query.from, query.to);
  return paginate(prisma.lead, {
    where: andWhere(
      leadAccessWhere(auth),
      query.status ? { status: query.status } : undefined,
      query.ownerId ? { ownerId: query.ownerId } : undefined,
      query.sourceId ? { sourceId: query.sourceId } : undefined,
      created ? { createdAt: created } : undefined,
      searchFilter(query.search, ['name', 'phone', 'email', 'venueCity']),
    ),
    orderBy: { [sort.field]: sort.direction },
    page: query.page,
    limit: query.limit,
    include: {
      source: { select: { id: true, name: true } },
      owner: { select: { id: true, fullName: true } },
    },
  });
}

export function getLead(auth: AuthContext, id: string) {
  return getAccessibleLead(prisma.lead, auth, id, {
    source: true,
    owner: { select: { id: true, fullName: true, email: true } },
    followUps: { orderBy: { scheduledAt: 'desc' } },
    client: { select: { id: true, clientCode: true, displayName: true } },
  });
}

export interface CreateLeadInput {
  name: string;
  phone: string;
  email?: string;
  sourceId?: string;
  eventType?: Prisma.LeadCreateInput['eventType'];
  eventDate?: Date;
  venueCity?: string;
  estimatedValue?: Prisma.Decimal.Value;
  ownerId?: string;
  nextFollowUpAt?: Date;
  notes?: string;
}

export async function createLead(auth: AuthContext, input: CreateLeadInput, ctx: AuditRequestContext) {
  if (!canAccessAllLeads(auth) && input.ownerId && input.ownerId !== auth.userId) {
    throw forbidden('Employees can create leads only for themselves');
  }
  return prisma.$transaction(async (tx) => {
    if (canAccessAllLeads(auth)) await assertLeadOwnerInOrganization(tx.user, auth.organizationId, input.ownerId);
    const lead = await tx.lead.create({
      data: {
        organizationId: auth.organizationId,
        name: input.name,
        phone: input.phone,
        email: input.email?.toLowerCase(),
        sourceId: input.sourceId,
        eventType: input.eventType,
        eventDate: input.eventDate,
        venueCity: input.venueCity,
        estimatedValue: input.estimatedValue ?? 0,
        // New employee leads must be assigned immediately; unassigned rows
        // cannot leak into another employee's view later.
        ownerId: canAccessAllLeads(auth) ? input.ownerId : auth.userId,
        nextFollowUpAt: input.nextFollowUpAt,
        notes: input.notes,
        createdById: auth.userId,
      },
    });
    await recordAudit(tx, ctx, {
      action: 'CREATE',
      entityType: 'Lead',
      entityId: lead.id,
      summary: `Lead ${lead.name} created`,
      newData: lead,
    });
    return lead;
  });
}

export async function updateLead(
  auth: AuthContext,
  id: string,
  input: Partial<CreateLeadInput> & { status?: LeadStatus; lostReason?: string },
  ctx: AuditRequestContext,
) {
  return prisma.$transaction(async (tx) => {
    const existing = await getAccessibleLead<{ id: string; status: LeadStatus }>(tx.lead, auth, id);

    if (!canAccessAllLeads(auth) && input.ownerId !== undefined && input.ownerId !== auth.userId) {
      throw forbidden('Employees cannot reassign leads');
    }
    if (canAccessAllLeads(auth)) await assertLeadOwnerInOrganization(tx.user, auth.organizationId, input.ownerId);

    if (input.status === 'LOST' && !input.lostReason) {
      throw badRequest('A lostReason is required when marking a lead as LOST');
    }

    const updated = await tx.lead.update({
      where: { id },
      data: {
        name: input.name,
        phone: input.phone,
        email: input.email?.toLowerCase(),
        sourceId: input.sourceId,
        eventType: input.eventType,
        eventDate: input.eventDate,
        venueCity: input.venueCity,
        estimatedValue: input.estimatedValue,
        ownerId: canAccessAllLeads(auth) ? input.ownerId : undefined,
        nextFollowUpAt: input.nextFollowUpAt,
        notes: input.notes,
        status: input.status,
        lostReason: input.lostReason,
      },
    });

    await recordAudit(tx, ctx, {
      action: input.status && input.status !== existing.status ? 'STATUS_CHANGE' : 'UPDATE',
      entityType: 'Lead',
      entityId: id,
      summary:
        input.status && input.status !== existing.status
          ? `Lead status ${existing.status} -> ${input.status}`
          : 'Lead updated',
      oldData: existing,
      newData: updated,
    });

    return updated;
  });
}

export async function addFollowUp(
  auth: AuthContext,
  leadId: string,
  input: {
    channel?: Prisma.LeadFollowUpCreateInput['channel'];
    scheduledAt: Date;
    summary?: string;
    outcome?: Prisma.LeadFollowUpCreateInput['outcome'];
  },
  ctx: AuditRequestContext,
) {
  return prisma.$transaction(async (tx) => {
    await getAccessibleLead(tx.lead, auth, leadId);

    const followUp = await tx.leadFollowUp.create({
      data: {
        leadId,
        ownerId: auth.userId,
        channel: input.channel,
        scheduledAt: input.scheduledAt,
        summary: input.summary,
        outcome: input.outcome,
        completedAt: input.outcome && input.outcome !== 'PENDING' ? new Date() : null,
      },
    });

    // Keep the lead's next-touch marker aligned with its open follow-ups.
    await tx.lead.update({
      where: { id: leadId },
      data: { nextFollowUpAt: input.outcome === 'PENDING' ? input.scheduledAt : null },
    });

    await recordAudit(tx, ctx, {
      action: 'CREATE',
      entityType: 'LeadFollowUp',
      entityId: followUp.id,
      summary: 'Lead follow-up logged',
    });

    return followUp;
  });
}

/**
 * Converts a won lead into a client without duplicating contact details (§7):
 * an existing client can be linked instead of creating a second record.
 */
export async function convertLead(
  auth: AuthContext,
  leadId: string,
  input: { clientId?: string },
  ctx: AuditRequestContext,
) {
  return prisma.$transaction(async (tx) => {
    const lead = await getAccessibleLead<{
      id: string;
      name: string;
      phone: string;
      email: string | null;
      status: LeadStatus;
      clientId: string | null;
    }>(tx.lead, auth, leadId);

    if (lead.clientId) throw conflict('This lead has already been converted');

    let clientId = input.clientId;

    if (clientId) {
      const existing = await tx.client.findFirst({
        where: { id: clientId, organizationId: auth.organizationId, deletedAt: null },
        select: { id: true },
      });
      if (!existing) throw notFound('Client');
    } else {
      const clientCode = await nextDocumentNumber(tx, auth.organizationId, 'CLIENT');
      const created = await tx.client.create({
        data: {
          organizationId: auth.organizationId,
          clientCode,
          displayName: lead.name,
          primaryPhone: lead.phone,
          primaryEmail: lead.email,
        },
      });
      clientId = created.id;
    }

    const updatedLead = await tx.lead.update({
      where: { id: leadId },
      data: { clientId, status: LeadStatus.WON, convertedAt: new Date() },
      include: { client: true },
    });

    await recordAudit(tx, ctx, {
      action: 'STATUS_CHANGE',
      entityType: 'Lead',
      entityId: leadId,
      summary: `Lead converted to client ${clientId}`,
      oldData: lead,
      newData: updatedLead,
    });

    return updatedLead;
  });
}

export async function deleteLead(auth: AuthContext, id: string, ctx: AuditRequestContext) {
  return prisma.$transaction(async (tx) => {
    const lead = await getAccessibleLead<{ id: string }>(tx.lead, auth, id);
    await tx.lead.update({
      where: { id },
      data: { deletedAt: new Date(), deletedBy: auth.userId },
    });
    await recordAudit(tx, ctx, {
      action: 'SOFT_DELETE',
      entityType: 'Lead',
      entityId: id,
      summary: 'Lead archived',
      oldData: lead,
    });
  });
}
