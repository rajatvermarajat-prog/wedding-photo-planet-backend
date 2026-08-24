import { z } from 'zod';
import { env } from '../config/env';

export const uuid = z.string().uuid('Must be a valid UUID');

export const idParam = z.object({ id: uuid });

/** `YYYY-MM-DD`, rejected early so an invalid date never reaches PostgreSQL. */
export const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be a date in YYYY-MM-DD format')
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), 'Not a real calendar date');

export const isoDateTime = z.coerce.date();

/** Money accepted as a string or number, always with at most 2 decimals. */
export const decimal = z
  .union([z.string(), z.number()])
  .transform((v) => String(v))
  .refine((v) => /^-?\d{1,12}(\.\d{1,2})?$/.test(v), 'Must be a number with at most 2 decimal places');

export const positiveDecimal = decimal.refine(
  (v) => Number(v) > 0,
  'Must be greater than zero',
);

export const nonNegativeDecimal = decimal.refine(
  (v) => Number(v) >= 0,
  'Must not be negative',
);

/** Pagination is always bounded — MAX_PAGE_SIZE is a hard ceiling (§28). */
export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(env.MAX_PAGE_SIZE).default(env.DEFAULT_PAGE_SIZE),
});

export const sortQuery = z.object({
  sortBy: z.string().max(40).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
});

export const searchQuery = z.object({
  search: z.string().trim().min(1).max(120).optional(),
});

export const dateRangeQuery = z.object({
  from: dateOnly.optional(),
  to: dateOnly.optional(),
});

/** The standard list-endpoint query surface: search + sort + page + range. */
export const listQuery = paginationQuery
  .merge(sortQuery)
  .merge(searchQuery)
  .merge(dateRangeQuery);

export const booleanQuery = z
  .enum(['true', 'false'])
  .transform((v) => v === 'true');

export const email = z.string().email().max(160).toLowerCase();

export const phone = z
  .string()
  .trim()
  .min(6)
  .max(32)
  .regex(/^[+\d][\d\s\-()]*$/, 'Must be a valid phone number');

/** Rejects trivially weak passwords before they can ever be hashed. */
export const password = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .max(128)
  .refine((v) => /[a-z]/.test(v), 'Must contain a lowercase letter')
  .refine((v) => /[A-Z]/.test(v), 'Must contain an uppercase letter')
  .refine((v) => /\d/.test(v), 'Must contain a digit');
