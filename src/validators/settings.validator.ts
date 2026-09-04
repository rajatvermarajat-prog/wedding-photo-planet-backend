import { z } from 'zod';
import { email, password, phone } from './common.validator';
import { SETTINGS_MODULE_KEYS } from '../types/settingsModules';

/**
 * Request shapes for the Settings workspace, mirroring
 * `docs/SETTINGS_API_CONTRACT.md`. Nothing reaches the database before these
 * pass (§32).
 */

/** An avatar or logo is a URL the client already uploaded through `/files`. */
const assetUrl = z.string().trim().url('Must be a valid URL').max(500);

/** `phone` is the shared 10-digit rule; empty string means "clear it". */
const optionalPhone = z.union([phone, z.literal('')]).optional();

export const updateProfileSchema = z
  .object({
    fullName: z.string().trim().min(1, 'Full name is required').max(160),
    phone: optionalPhone,
    imageUrl: z.union([assetUrl, z.literal('')]).optional(),
  })
  .strict();

export const updateOrganizationSettingsSchema = z
  .object({
    name: z.string().trim().min(1).max(160).optional(),
    logoUrl: z.union([assetUrl, z.literal('')]).optional(),
    contactEmail: z.union([email, z.literal('')]).optional(),
    contactPhone: optionalPhone,
    timezone: z.string().trim().min(1).max(64).optional(),
    currency: z.string().trim().length(3, 'Use a 3-letter currency code').toUpperCase().optional(),
    dateFormat: z.string().trim().min(1).max(32).optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, 'Provide at least one field to update');

export const updatePreferencesSchema = z
  .object({
    notifications: z.record(z.boolean()).optional(),
    security: z
      .object({
        // A session shorter than 5 minutes would log the studio out mid-shoot.
        sessionTimeoutMinutes: z.coerce.number().int().min(5).max(43_200).optional(),
        notifyNewLogin: z.boolean().optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine(
    (body) => body.notifications !== undefined || body.security !== undefined,
    'Provide notifications, security, or both',
  );

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: password,
  })
  .strict();

export const createModuleAccessRequestSchema = z
  .object({
    // Enumerated here so an unknown module is a 400 with a clear field, rather
    // than a row that can never be approved.
    moduleKey: z.enum(SETTINGS_MODULE_KEYS as [string, ...string[]], {
      errorMap: () => ({ message: `Must be one of: ${SETTINGS_MODULE_KEYS.join(', ')}` }),
    }),
    reason: z.string().trim().min(1, 'A reason is required').max(1000),
  })
  .strict();

export const reviewModuleAccessRequestSchema = z
  .object({
    status: z.enum(['APPROVED', 'REJECTED']),
    reviewReason: z.string().trim().max(1000).optional(),
  })
  .strict();

export const moduleAccessRequestListQuery = z
  .object({
    status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional(),
  })
  .strict();
