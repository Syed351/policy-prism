import { sql } from 'drizzle-orm';
import { closeDb, db } from './index';

/**
 * Drops and recreates the public schema. Destructive by design - it exists so a
 * demo environment can be rebuilt from zero with `npm run db:reset`.
 */
async function main(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log('[reset] dropping public schema');
  await db.execute(sql`DROP SCHEMA IF EXISTS public CASCADE`);
  await db.execute(sql`CREATE SCHEMA public`);
  // eslint-disable-next-line no-console
  console.log('[reset] schema recreated - run db:migrate next');
}

main()
  .then(() => closeDb())
  .then(() => process.exit(0))
  .catch(async (err) => {
    // eslint-disable-next-line no-console
    console.error('[reset] failed:', err);
    await closeDb().catch(() => undefined);
    process.exit(1);
  });
