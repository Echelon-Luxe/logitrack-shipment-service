import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';

/**
 * Prisma 7 connects through a driver adapter rather than its own engine.
 *
 * connectionString points at Supabase's TRANSACTION POOLER (port 6543). That
 * pooler cannot handle session-scoped state, so the URL must carry
 * ?pgbouncer=true - otherwise Prisma's prepared statements collide under
 * concurrency and you get intermittent "prepared statement s0 already exists".
 *
 * max is deliberately small: Supabase's free tier caps total connections, and
 * each replica of each service opens its own pool. Six services x 3 replicas x
 * a pool of 10 would exhaust the quota long before the app is under real load.
 */
const adapter = new PrismaPg({
  connectionString: process.env['DATABASE_URL'] ?? '',
  max: Number(process.env['DB_POOL_MAX'] ?? 5),
});

export const prisma = new PrismaClient({ adapter });

export async function pingDb(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}
