import type { Response } from 'express';
import type { ApiFailure, ApiSuccess } from '@policy-prism/shared';

/** Every failure the API produces goes through this class. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, message: string, code = 'ERROR', details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  static badRequest(message = 'Invalid request', details?: unknown) {
    return new ApiError(400, message, 'BAD_REQUEST', details);
  }
  static validation(message = 'Validation failed', details?: unknown) {
    return new ApiError(422, message, 'VALIDATION_ERROR', details);
  }
  static unauthorized(message = 'Authentication required') {
    return new ApiError(401, message, 'UNAUTHENTICATED');
  }
  static forbidden(message = 'You do not have permission to do that') {
    return new ApiError(403, message, 'FORBIDDEN');
  }
  static notFound(message = 'Not found') {
    return new ApiError(404, message, 'NOT_FOUND');
  }
  static conflict(message = 'Conflict', details?: unknown) {
    return new ApiError(409, message, 'CONFLICT', details);
  }
  static payload(message = 'File too large') {
    return new ApiError(413, message, 'PAYLOAD_TOO_LARGE');
  }
  static unsupportedMedia(message = 'Unsupported file type') {
    return new ApiError(415, message, 'UNSUPPORTED_MEDIA_TYPE');
  }
  static internal(message = 'Something went wrong', details?: unknown) {
    return new ApiError(500, message, 'INTERNAL_ERROR', details);
  }
}

export function ok<T>(res: Response, data: T, meta?: Record<string, unknown>, status = 200): Response {
  const body: ApiSuccess<T> = meta ? { success: true, data, meta } : { success: true, data };
  return res.status(status).json(body);
}

export function created<T>(res: Response, data: T, meta?: Record<string, unknown>): Response {
  return ok(res, data, meta, 201);
}

export function fail(res: Response, error: ApiError): Response {
  const body: ApiFailure = {
    success: false,
    error: {
      message: error.message,
      code: error.code,
      ...(error.details !== undefined ? { details: error.details } : {}),
    },
  };
  return res.status(error.status).json(body);
}

/** Wraps an async handler so rejected promises reach the error middleware. */
export const asyncHandler =
  <T extends (...args: never[]) => Promise<unknown>>(fn: T) =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (req: any, res: any, next: any) =>
    Promise.resolve(fn(req, res, next)).catch(next);
