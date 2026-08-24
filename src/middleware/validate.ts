import { NextFunction, Request, Response } from 'express';
import { AnyZodObject, ZodError, ZodTypeAny } from 'zod';
import { AppError, ErrorDetail } from '../utils/errors';

export interface ValidationSchemas {
  body?: ZodTypeAny;
  params?: AnyZodObject;
  query?: AnyZodObject;
}

const toDetails = (error: ZodError): ErrorDetail[] =>
  error.issues.map((issue) => ({
    field: issue.path.join('.') || undefined,
    message: issue.message,
  }));

/**
 * Validates and *replaces* the request parts with their parsed output, so
 * handlers receive coerced, defaulted, strongly typed values. Nothing reaches
 * the database before this passes (§32).
 */
export function validate(schemas: ValidationSchemas) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      if (schemas.params) req.params = schemas.params.parse(req.params) as typeof req.params;
      if (schemas.query) {
        const parsed = schemas.query.parse(req.query);
        // Express 5 exposes `query` as a getter; assign defensively.
        Object.defineProperty(req, 'query', { value: parsed, writable: true, configurable: true });
      }
      if (schemas.body) req.body = schemas.body.parse(req.body);
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        next(new AppError(400, 'VALIDATION_ERROR', 'Invalid request', toDetails(error)));
        return;
      }
      next(error);
    }
  };
}
