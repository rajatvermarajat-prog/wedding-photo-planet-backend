import { z } from 'zod';
import { dateOnly, isoDateTime, listQuery, nonNegativeDecimal, uuid } from './common.validator';

export const PROJECT_STATUS = z.enum([
  'LEAD',
  'CONFIRMED',
  'PLANNING',
  'SHOOTING',
  'EDITING',
  'DELIVERY',
  'COMPLETED',
  'CANCELLED',
]);

export const PROJECT_TYPE = z.enum([
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

const toDate = dateOnly.transform((v) => new Date(`${v}T00:00:00Z`));

export const projectListQuery = listQuery.extend({
  status: PROJECT_STATUS.optional(),
  type: PROJECT_TYPE.optional(),
  clientId: uuid.optional(),
  managerId: uuid.optional(),
  branchId: uuid.optional(),
});

const embeddedEventSchema = z.object({
  name: z.string().trim().min(1).max(160),
  eventTypeId: uuid.optional(),
  eventDate: toDate,
  startTime: isoDateTime.optional(),
  endTime: isoDateTime.optional(),
  venueName: z.string().max(200).optional(),
  address: z.string().max(255).optional(),
  city: z.string().max(80).optional(),
  notes: z.string().max(2000).optional(),
});

export const createProjectSchema = z.object({
  clientId: uuid,
  leadId: uuid.optional(),
  branchId: uuid.optional(),
  name: z.string().trim().min(1).max(200),
  type: PROJECT_TYPE.optional(),
  weddingDate: toDate.optional(),
  deliveryDueDate: toDate.optional(),
  venueName: z.string().max(200).optional(),
  venueAddress: z.string().max(255).optional(),
  venueCity: z.string().max(80).optional(),
  totalQuotation: nonNegativeDecimal.optional(),
  notes: z.string().max(5000).optional(),
  managerId: uuid.optional(),
  events: z.array(embeddedEventSchema).max(30).optional(),
  tasks: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(200),
        quantity: z.coerce.number().int().min(1).max(100000).optional(),
        unit: z.string().max(32).optional(),
        assigneeId: uuid.optional(),
      }),
    )
    .max(50)
    .optional(),
});

export const updateProjectSchema = createProjectSchema
  .partial()
  .omit({ clientId: true, events: true, leadId: true, tasks: true });

export const projectStatusSchema = z.object({
  status: PROJECT_STATUS,
  reason: z.string().max(500).optional(),
});

// --- Events ---------------------------------------------------------------

export const EVENT_STATUS = z.enum(['PLANNED', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']);

export const eventListQuery = listQuery.extend({
  projectId: uuid.optional(),
  status: EVENT_STATUS.optional(),
  eventTypeId: uuid.optional(),
});

export const createEventSchema = embeddedEventSchema.extend({
  projectId: uuid,
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
  guestCount: z.coerce.number().int().min(0).max(1_000_000).optional(),
});

export const updateEventSchema = createEventSchema
  .partial()
  .omit({ projectId: true })
  .extend({ status: EVENT_STATUS.optional() });

export const eventTypeSchema = z.object({
  name: z.string().trim().min(1).max(80),
  colorHex: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  sortOrder: z.coerce.number().int().min(0).max(999).optional(),
});

// --- Shoots ---------------------------------------------------------------

export const SHOOT_STATUS = z.enum([
  'SCHEDULED',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
  'POSTPONED',
]);

export const SHOOT_TYPE = z.enum([
  'PHOTO',
  'VIDEO',
  'PHOTO_AND_VIDEO',
  'DRONE',
  'CANDID',
  'TRADITIONAL',
  'PRE_WEDDING',
  'OTHER',
]);

export const CREW_ROLE = z.enum([
  'LEAD_PHOTOGRAPHER',
  'CANDID_PHOTOGRAPHER',
  'TRADITIONAL_PHOTOGRAPHER',
  'CINEMATOGRAPHER',
  'TRADITIONAL_VIDEOGRAPHER',
  'DRONE_OPERATOR',
  'ASSISTANT',
  'LIGHT_ASSISTANT',
  'LIVE_EDITOR',
  'COORDINATOR',
  'OTHER',
]);

export const ASSIGNMENT_STATUS = z.enum([
  'PROPOSED',
  'ASSIGNED',
  'CONFIRMED',
  'DECLINED',
  'ON_SHOOT',
  'COMPLETED',
  'CANCELLED',
]);

export const shootListQuery = listQuery.extend({
  projectId: uuid.optional(),
  eventId: uuid.optional(),
  status: SHOOT_STATUS.optional(),
  shootType: SHOOT_TYPE.optional(),
  userId: uuid.optional(),
  freelancerId: uuid.optional(),
});

export const createShootSchema = z.object({
  projectId: uuid,
  eventId: uuid.optional(),
  title: z.string().trim().min(1).max(160),
  shootType: SHOOT_TYPE.optional(),
  shootDate: toDate,
  startTime: isoDateTime.optional(),
  endTime: isoDateTime.optional(),
  location: z.string().max(255).optional(),
  city: z.string().max(80).optional(),
  notes: z.string().max(5000).optional(),
});

export const updateShootSchema = createShootSchema
  .partial()
  .omit({ projectId: true })
  .extend({
    status: SHOOT_STATUS.optional(),
    dataSizeGb: nonNegativeDecimal.optional(),
    dataReceivedAt: isoDateTime.optional(),
    backupDoneAt: isoDateTime.optional(),
  });

/**
 * Exactly one of userId / freelancerId — the same rule the database enforces
 * with `num_nonnulls(user_id, freelancer_id) = 1`.
 */
export const assignCrewSchema = z
  .object({
    userId: uuid.optional(),
    freelancerId: uuid.optional(),
    role: CREW_ROLE,
    agreedAmount: nonNegativeDecimal.optional(),
    travelAmount: nonNegativeDecimal.optional(),
    extraAmount: nonNegativeDecimal.optional(),
    callTime: isoDateTime.optional(),
    notes: z.string().max(2000).optional(),
  })
  .refine((v) => Number(Boolean(v.userId)) + Number(Boolean(v.freelancerId)) === 1, {
    message: 'Provide exactly one of userId or freelancerId',
    path: ['userId'],
  });

export const updateAssignmentSchema = z.object({
  role: CREW_ROLE.optional(),
  status: ASSIGNMENT_STATUS.optional(),
  agreedAmount: nonNegativeDecimal.optional(),
  travelAmount: nonNegativeDecimal.optional(),
  extraAmount: nonNegativeDecimal.optional(),
  checkInAt: isoDateTime.optional(),
  checkOutAt: isoDateTime.optional(),
  dataSizeGb: nonNegativeDecimal.optional(),
  dataReceived: z.boolean().optional(),
  storageReference: z.string().max(160).optional(),
  notes: z.string().max(2000).optional(),
});

export const assignmentParams = z.object({ id: uuid, assignmentId: uuid });
export const paymentMilestoneParams = z.object({ id: uuid, milestoneId: z.string().trim().min(1).max(64) });
