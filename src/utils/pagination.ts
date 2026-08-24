import { env } from '../config/env';

export interface PageParams {
  page: number;
  limit: number;
  skip: number;
  take: number;
}

/**
 * Resolves pagination for a list endpoint. `limit` is always clamped to
 * MAX_PAGE_SIZE — no caller can ever request an unbounded result set (§28).
 */
export function resolvePagination(input: { page?: number; limit?: number }): PageParams {
  const page = Math.max(1, Math.trunc(input.page ?? 1));
  const requested = Math.trunc(input.limit ?? env.DEFAULT_PAGE_SIZE);
  const limit = Math.min(Math.max(1, requested), env.MAX_PAGE_SIZE);
  return { page, limit, skip: (page - 1) * limit, take: limit };
}

export type SortDirection = 'asc' | 'desc';

/**
 * Maps a client-supplied sort field to a whitelisted column. Anything not in
 * `allowed` falls back to the default, so `sortBy` can never inject a column.
 */
export function resolveSort<T extends string>(
  sortBy: string | undefined,
  sortOrder: string | undefined,
  allowed: readonly T[],
  fallback: T,
): { field: T; direction: SortDirection } {
  const field = allowed.includes(sortBy as T) ? (sortBy as T) : fallback;
  const direction: SortDirection = sortOrder === 'asc' ? 'asc' : 'desc';
  return { field, direction };
}
