import { z } from 'zod';
import {
  dateOnly,
  email,
  isoDateTime,
  listQuery,
  nonNegativeDecimal,
  phone,
  uuid,
} from './common.validator';

const LEAD_STATUS = z.enum([
  'NEW',
  'CONTACTED',
  'QUALIFIED',
  'PROPOSAL_SENT',
  'NEGOTIATION',
  'WON',
  'LOST',
]);

const PROJECT_TYPE = z.enum([
  'ROKA',
  'ENGAGEMENT',
  'PRE_WEDDING',
  'WEDDING',
  'COMPLETE_WEDDING_SERVICES',
  'HALDI_MEHENDI',
  'SANGEET',
  'RECEPTION',
  'ANNIVERSARY',
  'CORPORATE',
  'OTHER',
]);

// --- Clients --------------------------------------------------------------

export const clientListQuery = listQuery.extend({
  isActive: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
});

const contactSchema = z.object({
  name: z.string().trim().min(1).max(120),
  relationship: z.string().max(60).optional(),
  phone: phone.optional(),
  email: email.optional(),
  isPrimary: z.boolean().optional(),
});

const addressSchema = z.object({
  type: z.enum(['HOME', 'OFFICE', 'VENUE', 'BILLING', 'OTHER']).optional(),
  label: z.string().max(80).optional(),
  addressLine: z.string().trim().min(1).max(255),
  city: z.string().max(80).optional(),
  state: z.string().max(80).optional(),
  postalCode: z.string().max(16).optional(),
  isPrimary: z.boolean().optional(),
});

export const createClientSchema = z.object({
  displayName: z.string().trim().min(1).max(160),
  primaryPhone: phone,
  primaryEmail: email.optional(),
  brideName: z.string().max(120).optional(),
  groomName: z.string().max(120).optional(),
  gstNumber: z.string().max(32).optional(),
  contacts: z.array(contactSchema).max(20).optional(),
  addresses: z.array(addressSchema).max(10).optional(),
});

export const updateClientSchema = createClientSchema.partial().omit({ contacts: true, addresses: true });

export const clientNoteSchema = z.object({
  body: z.string().trim().min(1).max(5000),
  isPinned: z.boolean().default(false),
});

// --- Leads ----------------------------------------------------------------

export const leadListQuery = listQuery.extend({
  status: LEAD_STATUS.optional(),
  ownerId: uuid.optional(),
  sourceId: uuid.optional(),
});

export const createLeadSchema = z.object({
  name: z.string().trim().min(1).max(160),
  phone,
  email: email.optional(),
  sourceId: uuid.optional(),
  eventType: PROJECT_TYPE.optional(),
  eventDate: dateOnly.transform((v) => new Date(`${v}T00:00:00Z`)).optional(),
  venueCity: z.string().max(80).optional(),
  estimatedValue: nonNegativeDecimal.optional(),
  ownerId: uuid.optional(),
  nextFollowUpAt: isoDateTime.optional(),
  notes: z.string().max(5000).optional(),
});

export const updateLeadSchema = createLeadSchema.partial().extend({
  status: LEAD_STATUS.optional(),
  lostReason: z.string().max(255).optional(),
});

export const followUpSchema = z.object({
  channel: z.enum(['CALL', 'WHATSAPP', 'EMAIL', 'SMS', 'MEETING', 'SITE_VISIT', 'OTHER']).optional(),
  scheduledAt: isoDateTime,
  summary: z.string().max(2000).optional(),
  outcome: z
    .enum(['PENDING', 'CONNECTED', 'NO_ANSWER', 'RESCHEDULED', 'NOT_INTERESTED'])
    .optional(),
});

export const convertLeadSchema = z.object({
  clientId: uuid.optional(),
});

export const leadSourceSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().max(255).optional(),
});
