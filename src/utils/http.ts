import { NextFunction, Request, RequestHandler, Response } from 'express';
import { AuthContext } from '../types';
import { unauthenticated } from './errors';
import { AuditRequestContext } from '../services/audit.service';

/** Wraps an async handler so a rejected promise reaches the error middleware. */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    void fn(req, res, next).catch(next);
  };
}

/** Narrows `req.auth` after `requireAuth`, keeping controllers free of `!`. */
export function requireAuthContext(req: Request): AuthContext {
  if (!req.auth) throw unauthenticated();
  return req.auth;
}

/** Builds the who/where/when envelope attached to every audit row. */
export function auditContext(req: Request): AuditRequestContext {
  const auth = requireAuthContext(req);
  return {
    organizationId: auth.organizationId,
    actorId: auth.userId,
    ipAddress: req.ip ?? null,
    userAgent: req.header('user-agent')?.slice(0, 512) ?? null,
    requestId: req.requestId ?? null,
  };
}
