import { Prisma, prisma, Tx } from '../config/prisma';
import { AppError } from './errors';
import { logger } from '../config/logger';

/**
 * Runs a unit of work at SERIALIZABLE isolation and retries the handful of
 * failures PostgreSQL raises specifically to say "retry me":
 *
 *   40001 serialization_failure   — concurrent transactions could not be ordered
 *   40P01 deadlock_detected
 *   P2034 (Prisma)                — the above, surfaced through the client
 *
 * Used for money paths where two operators can act on the same invoice at the
 * same instant (§36). Anything else is rethrown untouched.
 */
export async function serializable<T>(
  fn: (tx: Tx) => Promise<T>,
  options: { retries?: number; timeoutMs?: number } = {},
): Promise<T> {
  const retries = options.retries ?? 3;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await prisma.$transaction(fn, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeout: options.timeoutMs ?? 15_000,
      });
    } catch (error) {
      // A deliberate business rejection must not be retried.
      if (error instanceof AppError) throw error;
      if (!isRetryable(error) || attempt === retries) throw error;

      lastError = error;
      const backoff = 25 * 2 ** attempt + Math.floor(Math.random() * 25);
      logger.warn({ attempt: attempt + 1, backoff }, 'serialization conflict — retrying');
      await new Promise((resolve) => setTimeout(resolve, backoff));
    }
  }

  throw lastError;
}

function isRetryable(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return error.code === 'P2034';
  }
  const message = String((error as Error)?.message ?? '');
  return message.includes('40001') || message.includes('40P01');
}
