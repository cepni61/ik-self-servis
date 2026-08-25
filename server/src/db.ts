import { PrismaClient } from '@prisma/client';
import { env } from './config/env';

/**
 * Tek Prisma instance. Dev'de tsx watch yeniden yukledigi icin global cache.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: env.isProduction ? ['warn', 'error'] : ['warn', 'error'],
  });

if (!env.isProduction) {
  globalForPrisma.prisma = prisma;
}

/** Transaction icinde de kullanilabilen client tipi. */
export type Db = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;
