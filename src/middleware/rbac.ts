import { NextFunction, Request, Response } from 'express';
import { forbidden, unauthenticated } from '../utils/errors';

/**
 * Authorization is enforced here and nowhere else that matters. The frontend's
 * permission state is a convenience for hiding buttons — it is never trusted
 * (§6, §50).
 */
export function requirePermission(...required: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.auth) {
      next(unauthenticated());
      return;
    }
    const missing = required.filter((key) => !req.auth!.permissions.has(key));
    if (missing.length > 0) {
      next(forbidden(`Missing required permission: ${missing.join(', ')}`));
      return;
    }
    next();
  };
}

/** Passes when the caller holds *any* of the listed permissions. */
export function requireAnyPermission(...accepted: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.auth) {
      next(unauthenticated());
      return;
    }
    if (accepted.some((key) => req.auth!.permissions.has(key))) {
      next();
      return;
    }
    next(forbidden(`Requires one of: ${accepted.join(', ')}`));
  };
}

export function requireRole(...roles: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.auth) {
      next(unauthenticated());
      return;
    }
    if (!roles.some((role) => req.auth!.roles.includes(role))) {
      next(forbidden(`Requires role: ${roles.join(' or ')}`));
      return;
    }
    next();
  };
}
