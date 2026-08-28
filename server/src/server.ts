import { sql } from 'drizzle-orm';
import { createApp } from './app';
import { env } from './config/env';
import { closeDb, db } from './db';
import { mailerProvider } from './services/mailer';
import { aiProviderLabel } from './services/ai/provider';

async function start(): Promise<void> {
  // Fail loudly at boot rather than on the first request.
  try {
    await db.execute(sql`SELECT 1`);
    // eslint-disable-next-line no-console
    console.log('[db] connected');
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[db] could not connect:', (err as Error).message);
    console.error('     Check DATABASE_URL in your .env file.');
    process.exit(1);
  }

  const app = createApp();

  const server = app.listen(env.PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`
  Policy Prism API
  ----------------
  Listening   http://localhost:${env.PORT}
  Health      http://localhost:${env.PORT}/health
  API index   http://localhost:${env.PORT}/api
  Environment ${env.NODE_ENV}
  Frontend    ${
    require('node:fs').existsSync(
      require('node:path').resolve(__dirname, '../../client/dist/index.html'),
    )
      ? 'served from client/dist'
      : 'not built - API only'
  }
  AI analysis ${aiProviderLabel()}
  Email       ${
    mailerProvider() === 'none'
      ? 'not configured - password reset links will not be delivered'
      : `${mailerProvider()} \u00b7 from ${env.MAIL_FROM}`
  }
  CORS allows ${env.corsOrigins.join(', ')}
`);
  });

  const shutdown = (signal: string) => {
    // eslint-disable-next-line no-console
    console.log(`\n[${signal}] shutting down`);
    server.close(async () => {
      await closeDb().catch(() => undefined);
      process.exit(0);
    });
    // Do not hang forever on a stuck connection.
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

start().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[boot] failed:', err);
  process.exit(1);
});
