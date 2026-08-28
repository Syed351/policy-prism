import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { and, eq } from 'drizzle-orm';
import { can, Permission, RoleKey, ROLES } from '@policy-prism/shared';
import { env } from '../config/env';
import { db } from '../db';
import { hospitals, users } from '../db/schema';
import { ApiError } from '../utils/http';

export interface AuthContext {
  id: number;
  email: string;
  name: string;
  role: RoleKey;
  roleLabel: string;
  /** The branch this request operates on. Every query is scoped by it. */
  hospitalId: number;
  /** The organisation the user belongs to, spanning all of its branches. */
  organizationId: number | null;
  /** The user's home branch, used when no branch is selected. */
  homeHospitalId: number;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

export interface TokenPayload {
  sub: number;
  email: string;
  role: RoleKey;
  hospitalId: number;
}

export function signToken(payload: TokenPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN,
    issuer: 'policy-prism',
  } as jwt.SignOptions);
}

function readToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) return header.slice(7).trim();
  const cookie = (req as Request & { cookies?: Record<string, string> }).cookies?.pp_token;
  return cookie || null;
}

/** Rejects the request unless a valid token maps to an active user. */
export async function requireAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const token = readToken(req);
    if (!token) throw ApiError.unauthorized('Sign in to continue');

    let payload: TokenPayload;
    try {
      payload = jwt.verify(token, env.JWT_SECRET, {
        issuer: 'policy-prism',
      }) as unknown as TokenPayload;
    } catch {
      throw ApiError.unauthorized('Your session has expired. Sign in again.');
    }

    const [user] = await db.select().from(users).where(eq(users.id, payload.sub)).limit(1);
    if (!user || !user.isActive) throw ApiError.unauthorized('This account is no longer active');

    // The active branch comes from a header so switching needs no new token.
    // It is validated against the user's organisation, so a request can never
    // reach a branch the user does not belong to.
    let hospitalId = user.hospitalId;
    const requested = Number(req.header('X-Branch-Id') ?? 0);

    if (requested && requested !== user.hospitalId) {
      if (!user.organizationId) {
        throw ApiError.forbidden('This account is not part of a multi-branch organisation.');
      }
      const [branch] = await db
        .select({ id: hospitals.id })
        .from(hospitals)
        .where(and(eq(hospitals.id, requested), eq(hospitals.organizationId, user.organizationId)))
        .limit(1);
      if (!branch) throw ApiError.forbidden('That branch does not belong to your organisation.');
      hospitalId = branch.id;
    }

    req.auth = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      roleLabel: ROLES[user.role].label,
      hospitalId,
      organizationId: user.organizationId,
      homeHospitalId: user.hospitalId,
    };
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Permission gate. Mirrors the prototype's role matrix, so an auditor can read
 * and export but never mutate, and a reviewer can decide but never edit.
 */
export function requirePermission(permission: Permission) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.auth) return next(ApiError.unauthorized());
    if (!can(req.auth.role, permission)) {
      return next(
        ApiError.forbidden(`Your role (${req.auth.roleLabel}) cannot ${PERMISSION_VERB[permission]}.`),
      );
    }
    next();
  };
}

const PERMISSION_VERB: Record<Permission, string> = {
  edit: 'create or change documents',
  review: 'approve or reject findings',
  profile: 'change the facility profile',
  run: 'run the analysis',
  export: 'export reports',
};

/** Restrict a route to specific roles regardless of the permission matrix. */
export function requireRole(...roles: RoleKey[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.auth) return next(ApiError.unauthorized());
    if (!roles.includes(req.auth.role)) {
      return next(ApiError.forbidden(`This action is limited to: ${roles.map((r) => ROLES[r].label).join(', ')}.`));
    }
    next();
  };
}

export function auth(req: Request): AuthContext {
  if (!req.auth) throw ApiError.unauthorized();
  return req.auth;
}
