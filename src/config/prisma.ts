import { PrismaClient, Prisma } from '@prisma/client';
import { env } from './env';
import { logger } from './logger';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createPrisma(): PrismaClient {
  const client = new PrismaClient({
    log: env.isDevelopment
      ? [{ emit: 'event', level: 'warn' }, { emit: 'event', level: 'error' }]
      : [{ emit: 'event', level: 'error' }],
  });
  client.$on('error' as never, (e: unknown) => logger.error({ prisma: e }, 'prisma error'));
  client.$on('warn' as never, (e: unknown) => logger.warn({ prisma: e }, 'prisma warning'));
  return client;
}

const cached = globalForPrisma.prisma;
if (cached && !(cached as { personalTodo?: unknown }).personalTodo) {
  void cached.$disconnect();
}
export const prisma =
  cached && (cached as { personalTodo?: unknown }).personalTodo ? cached : createPrisma();

if (!env.isProduction) {
  globalForPrisma.prisma = prisma;
}

/** Transaction client type — what every service method receives inside `$transaction`. */
export type Tx = Prisma.TransactionClient;

/** Either the root client or an open transaction, so repositories compose. */
export type Db = PrismaClient | Tx;

export { Prisma };
