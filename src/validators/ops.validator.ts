import { z } from 'zod';
import {
  dateOnly,
  email,
  isoDateTime,
  listQuery,
  nonNegativeDecimal,
  phone,
  positiveDecimal,
  uuid,
} from './common.validator';
import { CREW_ROLE } from './project.validator';

const toDate = dateOnly.transform((v) => new Date(`${v}T00:00:00Z`));

// --- Tasks ----------------------------------------------------------------

export const TASK_STATUS = z.enum([
  'TODO',
  'ASSIGNED',
  'IN_PROGRESS',
  'PAUSED',
  'IN_REVIEW',
  'COMPLETED',
  'CANCELLED',
]);

export const TASK_PRIORITY = z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']);

export const TASK_CATEGORY = z.enum([
  'PHOTO_EDITING',
  'VIDEO_EDITING',
  'CULLING',
  'COLOR_GRADING',
  'ALBUM_DESIGN',
  'ALBUM_PRINTING',
  'SHOOT_COVERAGE',
  'DATA_BACKUP',
  'CLIENT_MEETING',
  'DELIVERY',
  'ADMIN',
  'OTHER',
]);

export const taskListQuery = listQuery.extend({
  status: TASK_STATUS.optional(),
  priority: TASK_PRIORITY.optional(),
  category: TASK_CATEGORY.optional(),
  assigneeId: uuid.optional(),
  projectId: uuid.optional(),
  shootId: uuid.optional(),
  deliveryId: uuid.optional(),
  overdue: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
});

export const createTaskSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(5000).optional(),
  category: TASK_CATEGORY.optional(),
  priority: TASK_PRIORITY.optional(),
  quantity: z.coerce.number().int().min(1).max(100000).optional(),
  unit: z.string().max(160).optional(),
  dueDate: toDate.optional(),
  assigneeId: uuid.optional(),
  projectId: uuid.optional(),
  eventId: uuid.optional(),
  shootId: uuid.optional(),
  deliveryId: uuid.optional(),
  clientId: uuid.optional(),
  estimatedMinutes: z.coerce.number().int().min(0).max(100000).optional(),
});

export const updateTaskSchema = createTaskSchema.partial().omit({ assigneeId: true });

export const taskStatusSchema = z.object({
  status: TASK_STATUS,
  reason: z.string().max(500).optional(),
});

export const reassignTaskSchema = z.object({
  toUserId: uuid,
  reason: z.string().max(500).optional(),
});

export const PERSONAL_TODO_PRIORITY = z.enum(['LOW', 'MEDIUM', 'HIGH']);

export const personalTodoListQuery = listQuery.extend({
  completed: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
});

export const createPersonalTodoSchema = z.object({
  title: z.string().trim().min(1).max(200),
  priority: PERSONAL_TODO_PRIORITY.optional(),
  dueDate: toDate.optional(),
  category: z.string().trim().max(80).optional(),
});

export const updatePersonalTodoSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  priority: PERSONAL_TODO_PRIORITY.optional(),
  dueDate: toDate.optional().nullable(),
  completed: z.boolean().optional(),
  category: z.string().trim().max(80).optional().nullable(),
});

export const createPersonalNoteSchema = z.object({
  title: z.string().trim().max(200).optional(),
  content: z.string().max(20000).optional(),
});

export const updatePersonalNoteSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  content: z.string().max(20000).optional(),
  pinned: z.boolean().optional(),
  sortOrder: z.number().int().min(0).optional(),
});

export const reorderPersonalNotesSchema = z.object({
  ids: z.array(uuid).min(1).max(100),
});

// --- Deliveries -----------------------------------------------------------

export const DELIVERY_STATUS = z.enum([
  'PENDING',
  'IN_PROGRESS',
  'READY',
  'DELIVERED',
  'REWORK',
  'CANCELLED',
]);

export const DELIVERY_TYPE = z.enum([
  'RAW_HANDOVER',
  'TEASER',
  'HIGHLIGHTS',
  'FULL_FILM',
  'REELS',
  'EDITED_PHOTOS',
  'ALBUM',
  'DRONE_EDIT',
  'OTHER',
]);

export const deliveryListQuery = listQuery.extend({
  status: DELIVERY_STATUS.optional(),
  type: DELIVERY_TYPE.optional(),
  projectId: uuid.optional(),
  clientId: uuid.optional(),
  assigneeId: uuid.optional(),
  overdue: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
});

export const createDeliverySchema = z.object({
  projectId: uuid,
  clientId: uuid.optional(),
  eventId: uuid.optional(),
  title: z.string().trim().min(1).max(200),
  type: DELIVERY_TYPE.optional(),
  expectedDate: dateOnly.optional(),
  assigneeId: uuid.optional(),
  deliveryUrl: z.string().url().max(1024).optional(),
  notes: z.string().max(5000).optional(),
  items: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(200),
        description: z.string().max(2000).optional(),
        quantity: z.coerce.number().int().min(1).max(100000).optional(),
        unit: z.string().max(160).optional(),
      }),
    )
    .max(50)
    .optional(),
});

export const updateDeliverySchema = createDeliverySchema
  .partial()
  .omit({ projectId: true, items: true });

export const deliveryStatusSchema = z.object({
  status: DELIVERY_STATUS,
  reason: z.string().max(500).optional(),
});

// --- Freelancers ----------------------------------------------------------

export const FREELANCER_STATUS = z.enum(['ACTIVE', 'INACTIVE', 'UNAVAILABLE', 'SUSPENDED']);
export const RATE_TYPE = z.enum(['PER_DAY', 'PER_HALF_DAY', 'PER_EVENT', 'PER_HOUR', 'FIXED']);
export const BILLING_INTERVAL = z.enum(['MONTHLY', 'QUARTERLY', 'YEARLY', 'ONE_TIME']);
export const FREELANCER_SUBSCRIPTION_STATUS = z.enum([
  'PENDING',
  'ACTIVE',
  'PAST_DUE',
  'CANCELED',
  'EXPIRED',
]);
export const FREELANCER_AVAILABILITY_STATUS = z.enum([
  'AVAILABLE',
  'PARTIALLY_AVAILABLE',
  'UNAVAILABLE',
]);
export const FREELANCER_APPLICATION_STATUS = z.enum([
  'DRAFT',
  'SUBMITTED',
  'UNDER_REVIEW',
  'APPROVED',
  'REJECTED',
  'WITHDRAWN',
]);
export const FREELANCER_CONNECTION_STATUS = z.enum([
  'INTERESTED',
  'CONTACTED',
  'ACCEPTED',
  'DECLINED',
  'EXPIRED',
  'ASSIGNED',
]);

export const freelancerListQuery = listQuery.extend({
  status: FREELANCER_STATUS.optional(),
  primarySkill: CREW_ROLE.optional(),
  city: z.string().max(80).optional(),
});

export const createFreelancerSchema = z.object({
  fullName: z.string().trim().min(1).max(160),
  phone,
  whatsapp: phone.optional(),
  email: email.optional(),
  city: z.string().max(80).optional(),
  addressLine: z.string().max(255).optional(),
  primarySkill: CREW_ROLE.optional(),
  skills: z.array(z.string().max(60)).max(30).optional(),
  experienceYears: z.coerce.number().int().min(0).max(70).optional(),
  rate: nonNegativeDecimal.optional(),
  rateType: RATE_TYPE.optional(),
  travelAvailable: z.boolean().optional(),
  maxShootsPerDay: z.coerce.number().int().min(1).max(5).optional(),
  equipmentNotes: z.string().max(5000).optional(),
  paymentMethod: z
    .enum(['CASH', 'UPI', 'BANK_TRANSFER', 'CREDIT_CARD', 'DEBIT_CARD', 'CHEQUE', 'OTHER'])
    .optional(),
  upiId: z.string().max(120).optional(),
  bankName: z.string().max(120).optional(),
  accountHolder: z.string().max(160).optional(),
  accountNumber: z.string().max(64).optional(),
  ifsc: z.string().max(16).optional(),
  panNumber: z.string().max(16).optional(),
  gstNumber: z.string().max(32).optional(),
  notes: z.string().max(5000).optional(),
});

export const updateFreelancerSchema = createFreelancerSchema
  .partial()
  .extend({ status: FREELANCER_STATUS.optional() });

export const freelancerPayoutSchema = z.object({
  amount: positiveDecimal,
  paymentDate: dateOnly,
  categoryId: uuid,
  assignmentId: uuid.optional(),
  paymentMethod: z
    .enum(['CASH', 'UPI', 'BANK_TRANSFER', 'CREDIT_CARD', 'DEBIT_CARD', 'CHEQUE', 'OTHER'])
    .optional(),
  transactionRef: z.string().max(120).optional(),
  notes: z.string().max(2000).optional(),
});

export const freelancerPlanListQuery = listQuery.extend({
  active: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
});

export const createFreelancerPlanSchema = z.object({
  name: z.string().trim().min(1).max(120),
  slug: z.string().trim().min(1).max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use a URL-safe slug'),
  description: z.string().max(5000).optional(),
  price: nonNegativeDecimal,
  currency: z.string().trim().length(3).toUpperCase().optional(),
  billingInterval: BILLING_INTERVAL.optional(),
  features: z.unknown().optional(),
  limits: z.unknown().optional(),
  isActive: z.boolean().optional(),
});

export const updateFreelancerPlanSchema = createFreelancerPlanSchema.partial();

export const createFreelancerSubscriptionSchema = z.object({
  planId: uuid,
  status: FREELANCER_SUBSCRIPTION_STATUS.optional(),
  startedAt: isoDateTime.optional(),
  currentPeriodStart: isoDateTime.optional(),
  currentPeriodEnd: isoDateTime.optional(),
  canceledAt: isoDateTime.optional(),
  externalCustomerId: z.string().max(160).optional(),
  externalSubscriptionId: z.string().max(160).optional(),
  metadata: z.unknown().optional(),
});

export const updateFreelancerSubscriptionSchema = createFreelancerSubscriptionSchema
  .partial()
  .omit({ planId: true });

export const availabilityListQuery = listQuery.extend({
  status: FREELANCER_AVAILABILITY_STATUS.optional(),
});

export const upsertAvailabilitySchema = z.object({
  date: dateOnly,
  status: FREELANCER_AVAILABILITY_STATUS,
  startTime: isoDateTime.optional().nullable(),
  endTime: isoDateTime.optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
}).refine((v) => !v.startTime || !v.endTime || v.endTime >= v.startTime, {
  message: 'endTime cannot be before startTime',
  path: ['endTime'],
});

export const createPortfolioItemSchema = z.object({
  fileObjectId: uuid,
  title: z.string().trim().min(1).max(160),
  description: z.string().max(5000).optional(),
  category: z.string().trim().max(80).optional(),
  sortOrder: z.coerce.number().int().min(0).max(100000).optional(),
  isPublished: z.boolean().optional(),
});

export const updatePortfolioItemSchema = createPortfolioItemSchema
  .partial()
  .omit({ fileObjectId: true });

export const freelancerApplicationListQuery = listQuery.extend({
  status: FREELANCER_APPLICATION_STATUS.optional(),
  primarySkill: CREW_ROLE.optional(),
  city: z.string().max(80).optional(),
});

export const createFreelancerApplicationSchema = z.object({
  freelancerId: uuid.optional(),
  fullName: z.string().trim().min(1).max(160),
  phone,
  whatsapp: phone.optional(),
  email: email.optional(),
  city: z.string().max(80).optional(),
  primarySkill: CREW_ROLE.optional(),
  skills: z.array(z.string().max(60)).max(30).optional(),
  experienceYears: z.coerce.number().int().min(0).max(70).optional(),
  portfolioUrl: z.string().url().max(1024).optional(),
  expectedRate: nonNegativeDecimal.optional(),
  rateType: RATE_TYPE.optional(),
  notes: z.string().max(5000).optional(),
});

export const reviewFreelancerApplicationSchema = z.object({
  status: FREELANCER_APPLICATION_STATUS,
  freelancerId: uuid.optional(),
  rejectionReason: z.string().max(500).optional(),
  notes: z.string().max(5000).optional(),
});

export const freelancerConnectionListQuery = listQuery.extend({
  status: FREELANCER_CONNECTION_STATUS.optional(),
  projectId: uuid.optional(),
  shootId: uuid.optional(),
  freelancerId: uuid.optional(),
});

export const createFreelancerConnectionSchema = z.object({
  freelancerId: uuid,
  projectId: uuid.optional(),
  shootId: uuid.optional(),
  status: FREELANCER_CONNECTION_STATUS.optional(),
  notes: z.string().max(5000).optional(),
});

export const updateFreelancerConnectionSchema = z.object({
  status: FREELANCER_CONNECTION_STATUS.optional(),
  notes: z.string().max(5000).optional().nullable(),
});

export const freelancerSubscriptionParams = z.object({
  id: uuid,
  subscriptionId: uuid,
});

export const freelancerPortfolioItemParams = z.object({
  id: uuid,
  itemId: uuid,
});

// --- Attendance & leave ---------------------------------------------------

export const ATTENDANCE_STATUS = z.enum([
  'PRESENT',
  'HALF_DAY',
  'ABSENT',
  'ON_LEAVE',
  'WEEKLY_OFF',
  'HOLIDAY',
]);

export const WORK_LOCATION = z.enum(['OFFICE', 'WFH', 'HYBRID', 'ON_SHOOT']);
export const ATTENDANCE_SOURCE = z.enum(['PASSWORD', 'FACE', 'ADMIN', 'SYSTEM']);

export const attendanceListQuery = listQuery.extend({
  userId: uuid.optional(),
  status: ATTENDANCE_STATUS.optional(),
  workLocation: WORK_LOCATION.optional(),
  branchId: uuid.optional(),
});

export const monthlyAttendanceSummaryQuery = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM').optional(),
  userId: uuid.optional(),
});
export const employeePerformanceParams = z.object({ userId: uuid });

export const markAttendanceSchema = z.object({
  userId: uuid.optional(),
  date: dateOnly,
  checkIn: isoDateTime.transform((d) => d.toISOString()).optional(),
  checkOut: isoDateTime.transform((d) => d.toISOString()).optional(),
  status: ATTENDANCE_STATUS.optional(),
  source: ATTENDANCE_SOURCE.optional(),
  workLocation: WORK_LOCATION.optional(),
  projectId: uuid.optional(),
  notes: z.string().max(2000).optional(),
});

export const LEAVE_TYPE = z.enum(['CASUAL', 'SICK', 'PERSONAL', 'EMERGENCY', 'UNPAID', 'OTHER']);
export const LEAVE_STATUS = z.enum(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']);

export const leaveListQuery = listQuery.extend({
  userId: uuid.optional(),
  status: LEAVE_STATUS.optional(),
});

export const requestLeaveSchema = z
  .object({
    userId: uuid.optional(),
    type: LEAVE_TYPE.optional(),
    startDate: dateOnly,
    endDate: dateOnly,
    reason: z.string().max(2000).optional(),
  })
  .refine((v) => v.endDate >= v.startDate, {
    message: 'endDate cannot be before startDate',
    path: ['endDate'],
  });

export const reviewLeaveSchema = z.object({
  decision: z.enum(['APPROVE', 'REJECT']),
  note: z.string().max(500).optional(),
});
