import { badRequest } from './errors';

/** Midnight UTC for a `YYYY-MM-DD` string — the canonical form for `@db.Date`. */
export function toDateOnly(value: string | Date): Date {
  const date = value instanceof Date ? value : new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw badRequest(`Invalid date: ${String(value)}`);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/**
 * Half-open range `[from, to)` for date filters. The upper bound is exclusive
 * so a `to` of 2026-08-31 includes every timestamp on that day.
 */
export function dateRangeFilter(from?: string, to?: string): { gte?: Date; lt?: Date } | undefined {
  if (!from && !to) return undefined;
  const filter: { gte?: Date; lt?: Date } = {};
  if (from) filter.gte = toDateOnly(from);
  if (to) {
    const end = toDateOnly(to);
    end.setUTCDate(end.getUTCDate() + 1);
    filter.lt = end;
  }
  return filter;
}

export const startOfMonth = (d: Date): Date =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));

export const addMonths = (d: Date, months: number): Date =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
