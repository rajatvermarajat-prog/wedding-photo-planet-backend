import { z } from 'zod';
import { email, listQuery, password, phone, uuid } from './common.validator';
import { PERMISSION_KEYS } from '../types/permissions';

const permissionKey = z.string().refine((k) => PERMISSION_KEYS.includes(k), {
  message: 'Unknown permission key',
});

// --- Users ----------------------------------------------------------------

export const USER_STATUS = z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED', 'DISABLED']);

export const userListQuery = listQuery.extend({
  status: USER_STATUS.optional(),
  branchId: uuid.optional(),
  roleId: uuid.optional(),
  departmentId: uuid.optional(),
});

const employeeProfileSchema = z.object({
  departmentId: uuid.optional(),
  designationId: uuid.optional(),
  employmentType: z.enum(['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN']).optional(),
  joiningDate: z.coerce.date().optional(),
  monthlySalary: z.coerce.number().min(0).optional(),
  dailyRate: z.coerce.number().min(0).optional(),
  workLocation: z.enum(['OFFICE', 'WFH', 'HYBRID', 'ON_SHOOT']).optional(),
  skills: z.array(z.string().max(60)).max(30).optional(),
  reportingManagerId: uuid.optional(),
});

export const createUserSchema = z.object({
  fullName: z.string().trim().min(1).max(160),
  email,
  password,
  phone: phone.optional(),
  employeeCode: z.string().max(32).optional(),
  branchId: uuid.optional(),
  roleIds: z.array(uuid).min(1, 'At least one role is required').max(10),
  profile: employeeProfileSchema.optional(),
});

export const updateUserSchema = z.object({
  fullName: z.string().trim().min(1).max(160).optional(),
  phone: phone.optional(),
  employeeCode: z.string().max(32).optional(),
  branchId: uuid.optional(),
  status: USER_STATUS.optional(),
  profile: employeeProfileSchema.optional(),
});

export const setRolesSchema = z.object({ roleIds: z.array(uuid).min(1).max(10) });

export const resetPasswordSchema = z.object({ newPassword: password });

// --- Roles ----------------------------------------------------------------

export const createRoleSchema = z.object({
  name: z.string().trim().min(1).max(64),
  description: z.string().max(255).optional(),
  permissionKeys: z.array(permissionKey).max(PERMISSION_KEYS.length).default([]),
});

export const updateRoleSchema = z.object({
  name: z.string().trim().min(1).max(64).optional(),
  description: z.string().max(255).optional(),
});

export const setPermissionsSchema = z.object({
  permissionKeys: z.array(permissionKey).max(PERMISSION_KEYS.length),
});

// --- Organization & branches ---------------------------------------------

export const updateOrganizationSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  legalName: z.string().max(200).optional(),
  email: email.optional(),
  phone: phone.optional(),
  website: z.string().url().max(200).optional(),
  gstNumber: z.string().max(32).optional(),
  panNumber: z.string().max(16).optional(),
  addressLine: z.string().max(255).optional(),
  city: z.string().max(80).optional(),
  state: z.string().max(80).optional(),
  postalCode: z.string().max(16).optional(),
  currency: z.string().length(3).optional(),
  timezone: z.string().max(64).optional(),
});

export const createBranchSchema = z.object({
  name: z.string().trim().min(1).max(160),
  code: z.string().trim().min(1).max(32),
  phone: phone.optional(),
  email: email.optional(),
  addressLine: z.string().max(255).optional(),
  city: z.string().max(80).optional(),
  state: z.string().max(80).optional(),
  postalCode: z.string().max(16).optional(),
  isHeadOffice: z.boolean().optional(),
});

export const updateBranchSchema = createBranchSchema.partial().extend({
  isActive: z.boolean().optional(),
});

// --- Files ----------------------------------------------------------------

export const fileListQuery = listQuery.extend({
  entityType: z.string().max(48).optional(),
  entityId: uuid.optional(),
  projectId: uuid.optional(),
});

export const uploadIntentSchema = z.object({
  entityType: z.string().trim().min(1).max(48),
  originalName: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(1).max(160),
});

export const registerFileSchema = z.object({
  entityType: z.string().trim().min(1).max(48),
  entityId: uuid.optional(),
  projectId: uuid.optional(),
  bucket: z.string().trim().min(1).max(120),
  objectKey: z.string().trim().min(1).max(512),
  originalName: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(1).max(160),
  sizeBytes: z.coerce.number().int().min(0).max(50 * 1024 * 1024 * 1024),
  checksum: z.string().max(128).optional(),
  visibility: z.enum(['PRIVATE', 'INTERNAL', 'CLIENT', 'PUBLIC']).optional(),
  metadata: z.record(z.unknown()).optional(),
});

// --- Notifications, audit, settings ---------------------------------------

export const notificationListQuery = listQuery.extend({
  isRead: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
});

export const auditListQuery = listQuery.extend({
  entityType: z.string().max(48).optional(),
  entityId: uuid.optional(),
  actorId: uuid.optional(),
  action: z
    .enum([
      'CREATE',
      'UPDATE',
      'DELETE',
      'SOFT_DELETE',
      'RESTORE',
      'LOGIN',
      'LOGOUT',
      'STATUS_CHANGE',
      'ASSIGN',
      'UNASSIGN',
      'APPROVE',
      'REJECT',
      'PAYMENT_RECORDED',
      'PAYMENT_ALLOCATED',
      'ROLE_CHANGED',
      'PERMISSION_CHANGED',
      'EXPORT',
    ])
    .optional(),
});

export const settingSchema = z.object({
  key: z.string().trim().min(1).max(80),
  value: z.unknown(),
  description: z.string().max(255).optional(),
});

export const overviewQuery = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});
