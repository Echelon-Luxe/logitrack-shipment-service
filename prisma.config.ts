import { defineConfig } from 'prisma/config';

/**
 * Migrations need a DIRECT connection. DDL and the advisory lock Prisma takes
 * during `migrate` do not work through Supabase's transaction pooler.
 *
 * Read from process.env rather than prisma/config's env() helper: env() throws
 * when the variable is absent, which breaks `prisma generate` in CI and in any
 * fresh clone, even though generate never opens a connection. Commands that
 * genuinely need the URL fail with a clear connection error instead.
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: process.env['DIRECT_URL'] ?? '',
  },
});
