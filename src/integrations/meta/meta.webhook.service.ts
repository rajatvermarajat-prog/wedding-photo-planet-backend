import crypto from 'crypto';
import { prisma, Prisma } from '../../config/prisma';
import { logger } from '../../config/logger';
import { badRequest, forbidden, unauthenticated } from '../../utils/errors';
import * as leadService from '../../services/lead.service';
import { requireMetaConfig } from './meta.config';
import { fetchMetaLeadDetails } from './meta.client';
import { mapMetaLeadToCrmLead } from './meta.lead.mapper';
import { MetaLeadgenEvent, MetaWebhookPayload } from './meta.types';

function timingSafeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function verifyChallenge(query: Record<string, unknown>): string {
  const config = requireMetaConfig();
  if (query['hub.mode'] !== 'subscribe' || query['hub.verify_token'] !== config.verifyToken) {
    throw forbidden('Invalid Meta webhook verification token');
  }
  const challenge = query['hub.challenge'];
  if (typeof challenge !== 'string') throw badRequest('Missing Meta webhook challenge');
  return challenge;
}

export function assertValidSignature(rawBody: Buffer | undefined, signatureHeader: string | undefined): void {
  const config = requireMetaConfig();
  if (!rawBody || !signatureHeader?.startsWith('sha256=')) {
    throw unauthenticated('Missing Meta webhook signature');
  }
  const expected = `sha256=${crypto.createHmac('sha256', config.appSecret).update(rawBody).digest('hex')}`;
  if (!timingSafeEqual(expected, signatureHeader)) {
    throw unauthenticated('Invalid Meta webhook signature');
  }
}

export function extractLeadgenEvents(payload: MetaWebhookPayload): MetaLeadgenEvent[] {
  if (payload.object !== 'page') return [];
  const events: MetaLeadgenEvent[] = [];
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== 'leadgen') continue;
      const value = change.value;
      if (!value?.leadgen_id) continue;
      const pageId = value.page_id ?? entry.id;
      if (!pageId) continue;
      events.push({
        leadgenId: value.leadgen_id,
        pageId,
        formId: value.form_id,
        adId: value.ad_id,
        adsetId: value.adset_id,
        campaignId: value.campaign_id,
        createdTime: value.created_time,
      });
    }
  }
  return events;
}

async function leadSourceId(organizationId: string): Promise<string> {
  const source = await prisma.leadSource.upsert({
    where: { organizationId_name: { organizationId, name: 'Meta Lead Ads' } },
    create: {
      organizationId,
      name: 'Meta Lead Ads',
      description: 'Imported from Meta/Facebook Lead Ads webhook',
    },
    update: { isActive: true },
    select: { id: true },
  });
  return source.id;
}

async function findIntegration(pageId: string) {
  return prisma.metaLeadIntegration.findFirst({
    where: { pageId, isActive: true, organization: { deletedAt: null, status: 'ACTIVE' } },
    select: { id: true, organizationId: true, pageId: true },
  });
}

export async function processWebhookPayload(payload: MetaWebhookPayload) {
  const config = requireMetaConfig();
  const events = extractLeadgenEvents(payload);
  const result = { accepted: events.length, imported: 0, ignored: 0, duplicates: 0 };

  logger.info({ eventCount: events.length }, 'Meta webhook received');

  for (const event of events) {
    logger.info({ leadgenId: event.leadgenId, pageId: event.pageId }, 'Meta leadgen event extracted');
    if (event.pageId !== config.pageId) {
      result.ignored += 1;
      logger.warn({ leadgenId: event.leadgenId, pageId: event.pageId }, 'Meta lead ignored for unauthorized page');
      continue;
    }

    const integration = await findIntegration(event.pageId);
    if (!integration) {
      result.ignored += 1;
      logger.warn({ leadgenId: event.leadgenId, pageId: event.pageId }, 'Meta lead ignored because page is not mapped to an organization');
      continue;
    }

    try {
      const details = await fetchMetaLeadDetails(event.leadgenId, config);
      logger.info({ leadgenId: event.leadgenId }, 'Meta lead details retrieved');
      const mapped = mapMetaLeadToCrmLead({ ...details, id: details.id ?? event.leadgenId, form_id: details.form_id ?? event.formId, ad_id: details.ad_id ?? event.adId });
      const sourceId = await leadSourceId(integration.organizationId);
      const lead = await leadService.upsertExternalLead({
        ...mapped,
        organizationId: integration.organizationId,
        sourceId,
        externalProvider: 'META',
        rawPayload: details as unknown as Prisma.InputJsonValue,
        customFields: mapped.customFields as Prisma.InputJsonValue,
      });
      await prisma.metaLeadIntegration.update({
        where: { id: integration.id },
        data: { lastWebhookAt: new Date(), lastError: null },
      });
      result.imported += 1;
      logger.info({ leadgenId: event.leadgenId, leadId: lead.id }, 'Meta lead upserted into CRM');
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        result.duplicates += 1;
        logger.info({ leadgenId: event.leadgenId }, 'Meta duplicate lead ignored');
        continue;
      }
      await prisma.metaLeadIntegration.update({
        where: { id: integration.id },
        data: { lastWebhookAt: new Date(), lastError: error instanceof Error ? error.message : 'Unknown error' },
      });
      throw error;
    }
  }

  logger.info(result, 'Meta webhook processing completed');
  return result;
}
