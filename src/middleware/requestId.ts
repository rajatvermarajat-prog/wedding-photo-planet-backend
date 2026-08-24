import crypto from 'crypto';
import { NextFunction, Request, Response } from 'express';

/** Assigns a correlation id used by logs, audit rows and error envelopes (§40). */
export function requestId(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header('x-request-id');
  const id = incoming && /^[\w-]{8,64}$/.test(incoming) ? incoming : crypto.randomUUID();
  req.requestId = id;
  res.locals.requestId = id;
  res.setHeader('x-request-id', id);
  next();
}
