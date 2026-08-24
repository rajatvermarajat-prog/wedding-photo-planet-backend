import crypto from 'crypto';
import { NextFunction, Request, Response } from 'express';
import { Prisma, prisma } from '../config/prisma';
import { AppError, badRequest } from '../utils/errors';
import { logger } from '../config/logger';

const RETENTION_HOURS = 24;

const hashBody = (body: unknown): string =>
  crypto.createHash('sha256').update(JSON.stringify(body ?? {})).digest('hex');

/**
 * Makes a write endpoint safe to retry (§35).
 *
 * The first request with a given `Idempotency-Key` claims the key by inserting
 * a row; the unique index on (organization, key, endpoint) means a concurrent
 * duplicate loses the race rather than creating a second financial record. The
 * winner's response body is stored and replayed verbatim on any later retry.
 *
 * A retry carrying a *different* payload under the same key is rejected — that
 * is a client bug, not a retry.
 */
export function idempotent(options: { required?: boolean } = {}) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const key = req.header('idempotency-key');
    const auth = req.auth;

    if (!key) {
      if (options.required) {
        next(badRequest('An Idempotency-Key header is required for this endpoint'));
        return;
      }
      next();
      return;
    }
    if (!auth) {
      next();
      return;
    }
    if (key.length < 8 || key.length > 120) {
      next(badRequest('Idempotency-Key must be between 8 and 120 characters'));
      return;
    }

    const endpoint = `${req.method} ${req.baseUrl}${req.route?.path ?? req.path}`;
    const requestHash = hashBody(req.body);
    const expiresAt = new Date(Date.now() + RETENTION_HOURS * 3_600_000);

    try {
      await prisma.idempotencyKey.create({
        data: { organizationId: auth.organizationId, key, endpoint, requestHash, expiresAt },
      });
    } catch (error) {
      if (
        !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        error.code !== 'P2002'
      ) {
        next(error);
        return;
      }

      const existing = await prisma.idempotencyKey.findUnique({
        where: {
          organizationId_key_endpoint: { organizationId: auth.organizationId, key, endpoint },
        },
      });

      if (!existing) {
        next(new AppError(409, 'CONFLICT', 'Idempotency key could not be resolved'));
        return;
      }
      if (existing.requestHash !== requestHash) {
        next(
          new AppError(
            409,
            'IDEMPOTENCY_CONFLICT',
            'This Idempotency-Key was already used with a different request body',
          ),
        );
        return;
      }
      if (!existing.completedAt) {
        next(
          new AppError(
            409,
            'IDEMPOTENCY_IN_PROGRESS',
            'An identical request is currently being processed. Retry shortly.',
          ),
        );
        return;
      }

      res.setHeader('idempotency-replayed', 'true');
      res.status(existing.statusCode ?? 200).json(existing.responseBody);
      return;
    }

    // Capture the successful response so a retry replays it byte-for-byte.
    const originalJson = res.json.bind(res);
    res.json = ((body: unknown) => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        void prisma.idempotencyKey
          .update({
            where: {
              organizationId_key_endpoint: { organizationId: auth.organizationId, key, endpoint },
            },
            data: {
              statusCode: res.statusCode,
              responseBody: body as Prisma.InputJsonValue,
              completedAt: new Date(),
            },
          })
          .catch((err) => logger.warn({ err, key }, 'failed to persist idempotent response'));
      } else {
        // Failed attempts release the key so the caller can legitimately retry.
        void prisma.idempotencyKey
          .delete({
            where: {
              organizationId_key_endpoint: { organizationId: auth.organizationId, key, endpoint },
            },
          })
          .catch(() => undefined);
      }
      return originalJson(body);
    }) as Response['json'];

    next();
  };
}
