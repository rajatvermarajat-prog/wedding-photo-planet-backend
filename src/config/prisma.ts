import { PrismaClient, Prisma } from '@prisma/client';
import { env } from './env';
import { logger } from './logger';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: env.isDevelopment
      ? [{ emit: 'event', level: 'warn' }, { emit: 'event', level: 'error' }]
      : [{ emit: 'event', level: 'error' }],
  });

prisma.$on('error' as never, (e: unknown) => logger.error({ prisma: e }, 'prisma error'));
prisma.$on('warn' as never, (e: unknown) => logger.warn({ prisma: e }, 'prisma warning'));

if (!env.isProduction) {
  globalForPrisma.prisma = prisma;
}

/** Transaction client type — what every service method receives inside `$transaction`. */
export type Tx = Prisma.TransactionClient;

/** Either the root client or an open transaction, so repositories compose. */
export type Db = PrismaClient | Tx;

export { Prisma };
