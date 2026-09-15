import { PrismaClient } from '@prisma/client';

/**
 * One client per process. Prisma manages its own pool; creating several
 * clients multiplies connections and exhausts Supabase's cap quickly - each
 * replica of each service opens its own pool.
 */
export const prisma = new PrismaClient({
  log: process.env['LOG_LEVEL'] === 'debug' ? ['warn', 'error'] : ['error'],
});

export async function pingDb(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}
