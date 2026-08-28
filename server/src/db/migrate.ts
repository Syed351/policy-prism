import path from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { closeDb, db } from './index';

async function main(): Promise<void> {
  const folder = path.resolve(__dirname, '../../drizzle');
  // eslint-disable-next-line no-console
  console.log(`[migrate] applying migrations from ${folder}`);
  await migrate(db, { migrationsFolder: folder });
  // eslint-disable-next-line no-console
  console.log('[migrate] done');
}

main()
  .then(() => closeDb())
  .then(() => process.exit(0))
  .catch(async (err) => {
    // eslint-disable-next-line no-console
    console.error('[migrate] failed:', err);
    await closeDb().catch(() => undefined);
    process.exit(1);
  });
