import { Response } from 'express';

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

export interface ResponseMeta {
  pagination?: PaginationMeta;
  requestId?: string;
  [key: string]: unknown;
}

/** Standard success envelope (§33). */
export function sendSuccess<T>(
  res: Response,
  data: T,
  meta: ResponseMeta = {},
  statusCode = 200,
): Response {
  return res.status(statusCode).json({
    success: true,
    data,
    meta: { requestId: res.locals.requestId, ...meta },
  });
}

export function sendCreated<T>(res: Response, data: T, meta: ResponseMeta = {}): Response {
  return sendSuccess(res, data, meta, 201);
}

export function sendNoContent(res: Response): Response {
  return res.status(204).send();
}

export function buildPaginationMeta(
  page: number,
  limit: number,
  total: number,
): PaginationMeta {
  const totalPages = limit > 0 ? Math.ceil(total / limit) : 0;
  return {
    page,
    limit,
    total,
    totalPages,
    hasNext: page < totalPages,
    hasPrev: page > 1,
  };
}
