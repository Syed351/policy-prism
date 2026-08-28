import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { ZodError, ZodSchema } from 'zod';
import { env } from '../config/env';
import { ApiError, fail } from '../utils/http';

/** Validates and REPLACES req.body with the parsed result. */
export function validateBody<T>(schema: ZodSchema<T>) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return next(zodToApiError(parsed.error));
    req.body = parsed.data;
    next();
  };
}

export function validateQuery<T>(schema: ZodSchema<T>) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const parsed = schema.safeParse(req.query);
    if (!parsed.success) return next(zodToApiError(parsed.error));
    // req.query is a getter on Express 5; assign onto a stashed field instead.
    (req as Request & { valid?: unknown }).valid = parsed.data;
    Object.defineProperty(req, 'query', { value: parsed.data, writable: true, configurable: true });
    next();
  };
}

export function validateParams<T>(schema: ZodSchema<T>) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const parsed = schema.safeParse(req.params);
    if (!parsed.success) return next(zodToApiError(parsed.error));
    Object.defineProperty(req, 'params', { value: parsed.data, writable: true, configurable: true });
    next();
  };
}

function zodToApiError(error: ZodError): ApiError {
  const details = error.issues.map((i) => ({
    field: i.path.join('.') || '(root)',
    message: i.message,
  }));
  const first = details[0];
  return ApiError.validation(
    first ? `${first.field}: ${first.message}` : 'Validation failed',
    details,
  );
}

export function notFound(req: Request, _res: Response, next: NextFunction): void {
  next(ApiError.notFound(`No route for ${req.method} ${req.originalUrl}`));
}

/** Single funnel for every error shape the app can produce. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ApiError) {
    fail(res, err);
    return;
  }

  if (err instanceof ZodError) {
    fail(res, zodToApiError(err));
    return;
  }

  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      fail(res, ApiError.payload(`File is larger than the ${env.MAX_UPLOAD_MB} MB limit`));
      return;
    }
    fail(res, ApiError.badRequest(`Upload failed: ${err.message}`));
    return;
  }

  const e = err as { code?: string; message?: string; constraint?: string; detail?: string };

  // Postgres error codes we can translate into something readable.
  if (e?.code === '23505') {
    fail(res, ApiError.conflict('That record already exists', e.detail));
    return;
  }
  if (e?.code === '23503') {
    fail(res, ApiError.badRequest('Referenced record does not exist', e.detail));
    return;
  }
  if (e?.code === '23502') {
    fail(res, ApiError.badRequest('A required field was missing', e.detail));
    return;
  }
  if (e?.code === '22P02') {
    fail(res, ApiError.badRequest('Malformed value for a database column'));
    return;
  }
  if (e?.code === 'ECONNREFUSED' || e?.code === '57P01' || e?.code === '08006') {
    fail(res, new ApiError(503, 'The database is unavailable. Try again shortly.', 'DB_UNAVAILABLE'));
    return;
  }

  // eslint-disable-next-line no-console
  console.error('[unhandled]', err);
  fail(
    res,
    ApiError.internal(
      env.isProd ? 'Something went wrong' : e?.message || 'Something went wrong',
      env.isProd ? undefined : String((err as Error)?.stack ?? ''),
    ),
  );
}
