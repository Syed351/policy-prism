import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { env } from '../config/env';
import * as schema from './schema';

/**
 * Hosted Postgres (Neon / Supabase / Render) terminates TLS, so we enable SSL
 * whenever the URL asks for it or DATABASE_SSL=true is set.
 */
const needsSsl =
  env.DATABASE_SSL === true ||
  /sslmode=require/i.test(env.DATABASE_URL) ||
  (env.isProd && !/localhost|127\.0\.0\.1/.test(env.DATABASE_URL));

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
  max: 10,
  idleTimeoutMillis: 30_000,
});

pool.on('error', (err) => {
  // eslint-disable-next-line no-console
  console.error('[db] unexpected pool error', err.message);
});

export const db = drizzle(pool, { schema });

export type Database = typeof db;
export { schema };

export async function closeDb(): Promise<void> {
  await pool.end();
}
