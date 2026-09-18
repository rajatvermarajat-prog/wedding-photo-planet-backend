import { z } from 'zod';
import { dateOnly, email, nonNegativeDecimal, password, phone, uuid, isoDateTime } from './common.validator';
import { CREW_ROLE } from './project.validator';
import { FREELANCER_AVAILABILITY_STATUS, RATE_TYPE } from './ops.validator';

export const freelancerPortalLoginSchema = z.object({
  identifier: z.string().trim().min(1).max(160),
  password,
});

export const freelancerPortalRefreshSchema = z.object({
  refreshToken: z.string().optional(),
});

export const publicFreelancerApplicationSchema = z.object({
  organizationSlug: z.string().trim().max(80).optional(),
  fullName: z.string().trim().min(1).max(160),
  phone,
  email: email.optional(),
  city: z.string().trim().max(80).optional(),
  primarySkill: CREW_ROLE.optional(),
  skills: z.array(z.string().trim().max(60)).max(30).optional(),
  experienceYears: z.coerce.number().int().min(0).max(70).optional(),
  portfolioUrl: z.string().url().max(1024).optional(),
  expectedRate: nonNegativeDecimal.optional(),
  notes: z.string().max(5000).optional(),
});

export const freelancerProfileUpdateSchema = z.object({
  fullName: z.string().trim().min(1).max(160).optional(),
  whatsapp: phone.optional().nullable(),
  email: email.optional().nullable(),
  city: z.string().trim().max(80).optional().nullable(),
  addressLine: z.string().max(255).optional().nullable(),
  primarySkill: CREW_ROLE.optional(),
  skills: z.array(z.string().trim().max(60)).max(30).optional(),
  experienceYears: z.coerce.number().int().min(0).max(70).optional().nullable(),
  rate: nonNegativeDecimal.optional(),
  rateType: RATE_TYPE.optional(),
  travelAvailable: z.boolean().optional(),
  maxShootsPerDay: z.coerce.number().int().min(1).max(5).optional(),
  equipmentNotes: z.string().max(5000).optional().nullable(),
  notes: z.string().max(5000).optional().nullable(),
}).refine((v) => Object.keys(v).length > 0, 'At least one field is required');

export const setFreelancerPasswordSchema = z.object({
  password,
});

export const portalAvailabilitySchema = z.object({
  date: dateOnly,
  status: FREELANCER_AVAILABILITY_STATUS,
  startTime: isoDateTime.optional().nullable(),
  endTime: isoDateTime.optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
}).refine((v) => !v.startTime || !v.endTime || v.endTime >= v.startTime, {
  message: 'endTime cannot be before startTime',
  path: ['endTime'],
});

export const portalPortfolioCreateSchema = z.object({
  fileObjectId: uuid,
  title: z.string().trim().min(1).max(160),
  description: z.string().max(5000).optional(),
  category: z.string().trim().max(80).optional(),
  sortOrder: z.coerce.number().int().min(0).max(100000).optional(),
  isPublished: z.boolean().optional(),
});

export const portalPortfolioUpdateSchema = portalPortfolioCreateSchema
  .partial()
  .omit({ fileObjectId: true });

export const itemIdParam = z.object({ itemId: uuid });
