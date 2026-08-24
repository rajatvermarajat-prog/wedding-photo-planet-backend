import rateLimit, { Options } from 'express-rate-limit';
import { env } from '../config/env';

const shared: Partial<Options> = {
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  // Tests would otherwise trip the auth limiter across cases.
  skip: () => env.isTest,
  handler: (_req, res) => {
    res.status(429).json({
      success: false,
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many requests. Please retry later.',
        details: [],
        requestId: res.locals.requestId,
      },
    });
  },
};

/** Baseline limiter applied to the whole API surface. */
export const generalLimiter = rateLimit({
  ...shared,
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: env.RATE_LIMIT_MAX,
});

/** Tight limiter for credential endpoints — slows password spraying. */
export const authLimiter = rateLimit({
  ...shared,
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: env.AUTH_RATE_LIMIT_MAX,
  skipSuccessfulRequests: true,
});
