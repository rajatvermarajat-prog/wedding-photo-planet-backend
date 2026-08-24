import { Db, Prisma, prisma } from '../config/prisma';
import { resolvePagination } from '../utils/pagination';
import { buildPaginationMeta, PaginationMeta } from '../utils/response';
import { notFound } from '../utils/errors';

/**
 * The subset of a Prisma model delegate the shared repository helpers need.
 * Keeping it structural lets every model reuse the same pagination, org
 * scoping and soft-delete behaviour without a per-model repository class.
 */
export interface ModelDelegate {
  // `findMany`/`count` are typed as PrismaPromise so the pair can be handed to
  // `prisma.$transaction([...])` and read a single consistent snapshot.
  findMany(args: any): Prisma.PrismaPromise<any[]>;
  findFirst(args: any): Promise<any | null>;
  count(args: any): Prisma.PrismaPromise<number>;
  create(args: any): Promise<any>;
  update(args: any): Promise<any>;
  updateMany(args: any): Promise<{ count: number }>;
  aggregate?(args: any): Promise<any>;
  groupBy?(args: any): Promise<any[]>;
}

export interface ListOptions {
  where: Record<string, unknown>;
  orderBy: Record<string, unknown> | Record<string, unknown>[];
  page?: number;
  limit?: number;
  include?: Record<string, unknown>;
  select?: Record<string, unknown>;
}

export interface ListResult<T> {
  items: T[];
  pagination: PaginationMeta;
}

/**
 * Runs the count and the page in one round trip. `limit` has already been
 * clamped by `resolvePagination`, so an unbounded read is not expressible.
 */
export async function paginate<T>(
  delegate: ModelDelegate,
  options: ListOptions,
): Promise<ListResult<T>> {
  const { page, limit, skip, take } = resolvePagination(options);

  const query: Record<string, unknown> = {
    where: options.where,
    orderBy: options.orderBy,
    skip,
    take,
  };
  if (options.include) query.include = options.include;
  if (options.select) query.select = options.select;

  // One transaction so the page and its total cannot disagree under concurrent writes.
  const [items, total] = await prisma.$transaction([
    delegate.findMany(query),
    delegate.count({ where: options.where }),
  ]);

  return { items: items as T[], pagination: buildPaginationMeta(page, limit, total) };
}

/** Case-insensitive `contains` filter across several columns. */
export function searchFilter(
  search: string | undefined,
  fields: string[],
): Record<string, unknown> | undefined {
  const term = search?.trim();
  if (!term) return undefined;
  return { OR: fields.map((field) => ({ [field]: { contains: term, mode: 'insensitive' } })) };
}

/** Merges optional filter fragments into a single `where`, dropping undefined. */
export function andWhere(
  ...fragments: Array<Record<string, unknown> | undefined>
): Record<string, unknown> {
  const present = fragments.filter(Boolean) as Record<string, unknown>[];
  if (present.length === 0) return {};
  if (present.length === 1) return present[0];
  return { AND: present };
}

/**
 * Loads a record scoped to the caller's organization. Cross-tenant reads are
 * impossible because the tenant predicate is part of the lookup, not a check
 * performed afterwards.
 */
export async function findScoped<T>(
  delegate: ModelDelegate,
  organizationId: string,
  id: string,
  resourceName: string,
  extra: { include?: Record<string, unknown>; select?: Record<string, unknown>; withDeleted?: boolean } = {},
): Promise<T> {
  const args: Record<string, unknown> = {
    where: {
      id,
      organizationId,
      ...(extra.withDeleted ? {} : { deletedAt: null }),
    },
  };
  if (extra.include) args.include = extra.include;
  if (extra.select) args.select = extra.select;

  const record = await delegate.findFirst(args);
  if (!record) throw notFound(resourceName);
  return record as T;
}

/** Soft-delete helper — critical business records are never hard-deleted (§25). */
export async function softDelete(
  db: Db,
  model: keyof Db,
  organizationId: string,
  id: string,
  deletedBy: string,
): Promise<{ count: number }> {
  const delegate = db[model] as unknown as ModelDelegate;
  return delegate.updateMany({
    where: { id, organizationId, deletedAt: null },
    data: { deletedAt: new Date(), deletedBy },
  });
}
