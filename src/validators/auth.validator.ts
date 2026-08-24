import { z } from 'zod';
import { email, password } from './common.validator';

export const loginSchema = z.object({
  email,
  password: z.string().min(1, 'Password is required').max(128),
  organizationSlug: z.string().max(80).optional(),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1).optional(),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1).max(128),
    newPassword: password,
  })
  .refine((v) => v.currentPassword !== v.newPassword, {
    message: 'New password must differ from the current password',
    path: ['newPassword'],
  });
