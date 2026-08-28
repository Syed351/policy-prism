import fs from 'node:fs';
import path from 'node:path';
import compression from 'compression';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import morgan from 'morgan';
import { sql } from 'drizzle-orm';
import { env } from './config/env';
import { db } from './db';
import { errorHandler, notFound } from './middleware/error';
import { api } from './routes';
import { ok } from './utils/http';

export function createApp(): Express {
  const app = express();

  // Whether this process also serves the frontend. Decided up front because
  // both the CORS policy and the static handler depend on it.
  const clientDist = path.resolve(__dirname, '../../client/dist');
  const hasClientBuild =
    process.env.SERVE_CLIENT !== 'false' && fs.existsSync(path.join(clientDist, 'index.html'));

  // Behind Render/Railway/Vercel proxies, req.ip needs the forwarded header.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(
    helmet({
      // The API serves JSON and file downloads, never HTML pages that embed
      // third-party assets, so the default CSP would only get in the way.
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  app.use(
    cors({
      origin: (origin, callback) => {
        // Same-origin requests and curl send no Origin header.
        if (!origin) return callback(null, true);
        if (env.corsOrigins.includes(origin) || env.corsOrigins.includes('*')) {
          return callback(null, true);
        }
        // When this process also serves the frontend, the browser's origin is
        // this server. Allowing it means a deployment works without anyone
        // having to discover their own URL and set it as a variable first.
        if (hasClientBuild) return callback(null, true);
        return callback(new Error(`Origin ${origin} is not allowed by CORS`));
      },
      credentials: true,
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Branch-Id'],
      exposedHeaders: ['Content-Disposition', 'X-Report-Rows'],
    }),
  );

  app.use(compression({ threshold: 512 }));
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true, limit: '2mb' }));

  if (env.LOG_LEVEL !== 'silent') {
    app.use(morgan(env.LOG_LEVEL));
  }

  // A broad ceiling; the auth routes have their own tighter limiter.
  app.use(
    '/api',
    rateLimit({
      windowMs: 60 * 1000,
      limit: 600,
      standardHeaders: true,
      legacyHeaders: false,
      message: {
        success: false,
        error: { message: 'Too many requests. Slow down and try again.', code: 'RATE_LIMITED' },
      },
    }),
  );

  /** Liveness + database reachability, for platform health checks. */
  app.get('/health', async (_req, res) => {
    try {
      await db.execute(sql`SELECT 1`);
      return ok(res, { status: 'ok', database: 'connected', env: env.NODE_ENV, time: new Date().toISOString() });
    } catch (err) {
      return res.status(503).json({
        success: false,
        error: { message: 'Database unreachable', code: 'DB_UNAVAILABLE', details: (err as Error).message },
      });
    }
  });

  app.use('/api', api);

  // Serve the built client from the same origin whenever a build exists.
  //
  // No flag to set: if client/dist is present the frontend is served, and if it
  // is not, the process is API-only. Requiring an environment variable meant a
  // correct deployment could still 404 on every page.
  //
  // The path is resolved from this file rather than the working directory: the
  // start command runs from the repo root in production but from server/
  // locally, and a cwd-based path silently points at nothing in one of those.
  if (hasClientBuild) {
    app.use(express.static(clientDist));
    app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
  }

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
