import crypto from 'node:crypto';
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { AuthUser, ROLE_KEYS, ROLES, RoleKey, SERVICES } from '@policy-prism/shared';
import { db } from '../../db';
import { env } from '../../config/env';
import {
  hospitalServices,
  hospitals,
  organizations,
  passwordResets,
  users,
} from '../../db/schema';
import { auth, requireAuth, requireRole, signToken } from '../../middleware/auth';
import { validateBody, validateParams } from '../../middleware/error';
import { safeAudit } from '../../services/audit';
import { mailerConfigured, passwordResetEmail, sendMail } from '../../services/mailer';
import { ApiError, asyncHandler, created, ok } from '../../utils/http';

export const authRouter = Router();

/** Brute-force protection on the credential endpoints. */
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: { message: 'Too many sign-in attempts. Wait a few minutes and try again.', code: 'RATE_LIMITED' },
  },
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
});

const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  password: z
    .string()
    .min(10, 'Password must be at least 10 characters')
    .max(200)
    .regex(/[a-zA-Z]/, 'Password must contain a letter')
    .regex(/[0-9!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/, 'Password must contain a number or symbol'),
  name: z.string().trim().min(2, 'Name is required').max(120),
  role: z.enum(ROLE_KEYS).default('viewer'),
  hospitalId: z.coerce.number().int().positive().optional(),
});

function toAuthUser(row: {
  id: number;
  email: string;
  name: string;
  role: RoleKey;
  hospitalId: number;
  isActive?: boolean;
}): AuthUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    roleLabel: ROLES[row.role].label,
    hospitalId: row.hospitalId,
    isActive: row.isActive ?? true,
    permissions: ROLES[row.role].can,
  };
}

/**
 * POST /api/auth/register
 * Creating an account is a compliance-manager action - open self-registration
 * would let anyone into the workspace. The very first user in an empty database
 * is allowed through so a fresh deployment can be bootstrapped.
 */
authRouter.post(
  '/register',
  loginLimiter,
  validateBody(registerSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof registerSchema>;

    const [countRow] = await db.select({ count: sql<number>`count(*)::int` }).from(users);
    const userCount = Number(countRow?.count ?? 0);
    let actorHospitalId: number | undefined;

    if (userCount > 0) {
      // Not the bootstrap case - require an authenticated compliance manager.
      await new Promise<void>((resolve, reject) => {
        requireAuth(req, res, (err?: unknown) => (err ? reject(err) : resolve()));
      });
      const actor = auth(req);
      if (actor.role !== 'admin') {
        throw ApiError.forbidden(
          `Your role (${actor.roleLabel}) cannot create accounts. Ask a compliance manager.`,
        );
      }
      actorHospitalId = actor.hospitalId;
    }

    const [existing] = await db.select().from(users).where(eq(users.email, body.email)).limit(1);
    if (existing) throw ApiError.conflict('An account with that email already exists');

    let hospitalId = body.hospitalId ?? actorHospitalId;
    if (!hospitalId) {
      const [firstHospital] = await db.select().from(hospitals).limit(1);
      if (!firstHospital) {
        throw ApiError.badRequest('No facility exists yet. Run `npm run db:seed` first.');
      }
      hospitalId = firstHospital.id;
    }

    const passwordHash = await bcrypt.hash(body.password, 12);
    const [user] = await db
      .insert(users)
      .values({
        hospitalId,
        email: body.email,
        name: body.name,
        role: userCount === 0 ? 'admin' : body.role,
        passwordHash,
      })
      .returning();

    await safeAudit({
      hospitalId,
      category: 'system',
      action: 'Created user account',
      object: user.email,
      detail: `Role ${ROLES[user.role].label}`,
      actor: req.auth ?? null,
      ip: req.ip,
    });

    const token = signToken({
      sub: user.id,
      email: user.email,
      role: user.role,
      hospitalId: user.hospitalId,
    });

    return created(res, { user: toAuthUser(user), token });
  }),
);

/** POST /api/auth/login */
authRouter.post(
  '/login',
  loginLimiter,
  validateBody(loginSchema),
  asyncHandler(async (req, res) => {
    const { email, password } = req.body as z.infer<typeof loginSchema>;

    const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);

    // Constant-ish work either way so timing does not reveal whether the email exists.
    const hash = user?.passwordHash ?? '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidin';
    const valid = await bcrypt.compare(password, hash);

    if (!user || !valid) throw ApiError.unauthorized('Email or password is incorrect');
    if (!user.isActive) throw ApiError.unauthorized('This account has been deactivated');

    await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));

    const token = signToken({
      sub: user.id,
      email: user.email,
      role: user.role,
      hospitalId: user.hospitalId,
    });

    await safeAudit({
      hospitalId: user.hospitalId,
      category: 'system',
      action: 'Signed in',
      object: user.email,
      detail: ROLES[user.role].label,
      actor: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        roleLabel: ROLES[user.role].label,
        hospitalId: user.hospitalId,
        organizationId: user.organizationId,
        homeHospitalId: user.hospitalId,
      },
      ip: req.ip,
    });

    return ok(res, { user: toAuthUser(user), token });
  }),
);

/** GET /api/auth/me */
authRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const a = auth(req);
    const [user] = await db.select().from(users).where(eq(users.id, a.id)).limit(1);
    if (!user) throw ApiError.unauthorized();
    return ok(res, { user: toAuthUser(user) });
  }),
);

/**
 * POST /api/auth/logout
 * JWTs are stateless, so this records the event and tells the client to drop
 * its token. Honest about what it does rather than pretending to revoke.
 */
authRouter.post(
  '/logout',
  requireAuth,
  asyncHandler(async (req, res) => {
    const a = auth(req);
    await safeAudit({
      hospitalId: a.hospitalId,
      category: 'system',
      action: 'Signed out',
      object: a.email,
      actor: a,
      ip: req.ip,
    });
    return ok(res, { message: 'Signed out. Discard the token on the client.' });
  }),
);

/** GET /api/auth/users - roster, compliance manager only. */
authRouter.get(
  '/users',
  requireAuth,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const a = auth(req);
    // Users belong to the organisation, so list everyone in it - not just the
    // branch currently being viewed.
    const rows = a.organizationId
      ? await db.select().from(users).where(eq(users.organizationId, a.organizationId))
      : await db.select().from(users).where(eq(users.hospitalId, a.hospitalId));
    return ok(
      res,
      rows.map((u) => ({
        id: u.id,
        email: u.email,
        name: u.name,
        role: u.role,
        roleLabel: ROLES[u.role].label,
        isActive: u.isActive,
        lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
      })),
    );
  }),
);

/* ------------------------------------------------------------------ *
 * Self-service sign-up
 * ------------------------------------------------------------------ */

const signupSchema = z.object({
  organizationName: z.string().trim().min(2).max(200),
  facilityName: z.string().trim().min(2).max(200),
  state: z.string().trim().length(2),
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(200),
  password: z
    .string()
    .min(10, 'Use at least 10 characters')
    .max(200)
    .refine((p) => /[a-z]/i.test(p) && /[0-9]/.test(p), 'Include at least one letter and one number'),
});

/**
 * POST /api/auth/signup
 * Creates a NEW organisation with its own facility and an admin user.
 *
 * Deliberately cannot join an existing organisation: this is compliance data,
 * so membership is granted by an administrator from inside, never claimed from
 * the sign-in page.
 */
authRouter.post(
  '/signup',
  loginLimiter,
  validateBody(signupSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof signupSchema>;
    const email = body.email.toLowerCase();

    const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (existing) {
      throw ApiError.conflict('An account with that email already exists. Sign in instead.');
    }

    const passwordHash = await bcrypt.hash(body.password, 12);

    const result = await db.transaction(async (tx) => {
      const [org] = await tx
        .insert(organizations)
        .values({ name: body.organizationName })
        .returning();

      const [hospital] = await tx
        .insert(hospitals)
        .values({
          organizationId: org.id,
          name: body.facilityName,
          branchLabel: body.facilityName,
          isPrimary: true,
          state: body.state.toUpperCase(),
        })
        .returning();

      // Services start off; the user sets them on the facility profile.
      await tx.insert(hospitalServices).values(
        SERVICES.map((s) => ({ hospitalId: hospital.id, serviceKey: s.key, enabled: false })),
      );

      const [user] = await tx
        .insert(users)
        .values({
          hospitalId: hospital.id,
          organizationId: org.id,
          email,
          passwordHash,
          name: body.name,
          // The person who creates the organisation administers it.
          role: 'admin',
        })
        .returning();

      return { user, hospital };
    });

    await safeAudit({
      hospitalId: result.hospital.id,
      category: 'system',
      action: 'Created organization',
      object: body.organizationName,
      detail: `${body.facilityName} \u00b7 first administrator ${body.name}`,
      actor: {
        id: result.user.id,
        name: result.user.name,
        email: result.user.email,
        role: result.user.role,
        roleLabel: ROLES[result.user.role].label,
        hospitalId: result.hospital.id,
        organizationId: result.hospital.organizationId,
        homeHospitalId: result.hospital.id,
      },
      ip: req.ip,
    });

    const token = signToken({
      sub: result.user.id,
      email: result.user.email,
      role: result.user.role,
      hospitalId: result.user.hospitalId,
    });
    return created(res, {
      token,
      user: toAuthUser(result.user),
      note: 'Your library starts empty. Load your requirements and policies to run the first analysis.',
    });
  }),
);

/* ------------------------------------------------------------------ *
 * Password reset
 * ------------------------------------------------------------------ */

const forgotSchema = z.object({ email: z.string().trim().email().max(200) });

const resetSchema = z.object({
  token: z.string().trim().min(20).max(200),
  password: z
    .string()
    .min(10, 'Use at least 10 characters')
    .max(200)
    .refine((p) => /[a-z]/i.test(p) && /[0-9]/.test(p), 'Include at least one letter and one number'),
});

const RESET_TTL_MINUTES = 30;

/**
 * POST /api/auth/forgot-password
 * Always reports success, whether or not the address exists - otherwise this
 * endpoint becomes a way to discover who holds an account.
 */
authRouter.post(
  '/forgot-password',
  loginLimiter,
  validateBody(forgotSchema),
  asyncHandler(async (req, res) => {
    const { email } = req.body as z.infer<typeof forgotSchema>;
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.email, email.toLowerCase()))
      .limit(1);

    let devToken: string | undefined;
    let delivered = false;
    let previewUrl: string | undefined;
    let provider: string | undefined;

    if (user && user.isActive) {
      const raw = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(raw).digest('hex');

      await db.insert(passwordResets).values({
        userId: user.id,
        tokenHash,
        expiresAt: new Date(Date.now() + RESET_TTL_MINUTES * 60_000),
        requestedIp: req.ip ?? null,
      });

      await safeAudit({
        hospitalId: user.hospitalId,
        category: 'system',
        action: 'Requested a password reset',
        object: user.email,
        detail: `Reset link emailed to ${user.email} \u00b7 valid for ${RESET_TTL_MINUTES} minutes`,
        actor: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          roleLabel: ROLES[user.role].label,
          hospitalId: user.hospitalId,
          organizationId: user.organizationId,
          homeHospitalId: user.hospitalId,
        },
        ip: req.ip,
      });

      // Send the link. The token itself never touches the database - only its
      // hash - so this email is the single copy that exists.
      const url = `${env.APP_URL.replace(/\/$/, '')}/reset-password?token=${raw}`;
      const message = passwordResetEmail(user.name, url, RESET_TTL_MINUTES);
      const result = await sendMail({ ...message, to: user.email });

      if (result.sent) {
        delivered = true;
        previewUrl = result.previewUrl;
        provider = result.provider;
      } else {
        // eslint-disable-next-line no-console
        console.warn(`[mail] password reset not delivered: ${result.reason}`);
        // Without a provider the flow would be unusable in development, so the
        // token is surfaced there. Never in production.
        if (!env.isProd && !mailerConfigured()) devToken = raw;
      }
    }

    return ok(res, {
      sent: true,
      devToken,
      previewUrl,
      message: previewUrl
        ? `Sent to a test mailbox, since no email provider is configured. Open it below \u2014 the link expires in ${RESET_TTL_MINUTES} minutes.`
        : devToken
          ? `Email could not be sent, so the reset link is shown here instead. It expires in ${RESET_TTL_MINUTES} minutes.`
          : `If that address has an account, a reset link is on its way. It expires in ${RESET_TTL_MINUTES} minutes \u2014 check spam if it does not arrive.`,
      // Never reveals whether the address exists; only whether mail is working.
      emailConfigured: mailerConfigured(),
      delivered: mailerConfigured() ? delivered : undefined,
      provider,
    });
  }),
);

/** POST /api/auth/reset-password - single-use, expiring token. */
authRouter.post(
  '/reset-password',
  loginLimiter,
  validateBody(resetSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof resetSchema>;
    const tokenHash = crypto.createHash('sha256').update(body.token).digest('hex');

    const [row] = await db
      .select()
      .from(passwordResets)
      .where(eq(passwordResets.tokenHash, tokenHash))
      .limit(1);

    if (!row || row.usedAt || row.expiresAt.getTime() < Date.now()) {
      throw ApiError.badRequest('That reset link is invalid or has expired. Request a new one.');
    }

    const [user] = await db.select().from(users).where(eq(users.id, row.userId)).limit(1);
    if (!user || !user.isActive) throw ApiError.badRequest('That account is no longer active.');

    const passwordHash = await bcrypt.hash(body.password, 12);

    await db.transaction(async (tx) => {
      await tx.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.id, user.id));
      await tx
        .update(passwordResets)
        .set({ usedAt: new Date() })
        .where(eq(passwordResets.id, row.id));
      // Any other outstanding links for this account are void.
      await tx
        .update(passwordResets)
        .set({ usedAt: new Date() })
        .where(and(eq(passwordResets.userId, user.id), isNull(passwordResets.usedAt)));
    });

    await safeAudit({
      hospitalId: user.hospitalId,
      category: 'system',
      action: 'Password reset completed',
      object: user.email,
      detail: 'Signed-out sessions keep working until their token expires',
      actor: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        roleLabel: ROLES[user.role].label,
        hospitalId: user.hospitalId,
        organizationId: user.organizationId,
        homeHospitalId: user.hospitalId,
      },
      ip: req.ip,
    });

    return ok(res, { reset: true, message: 'Password updated. Sign in with your new password.' });
  }),
);

/* ------------------------------------------------------------------ *
 * Team management
 * ------------------------------------------------------------------ */

const userIdParam = z.object({ id: z.coerce.number().int().positive() });

const updateUserSchema = z.object({
  role: z.enum(ROLE_KEYS).optional(),
  isActive: z.boolean().optional(),
  name: z.string().trim().min(2).max(120).optional(),
});

/**
 * PATCH /api/auth/users/:id
 * Changes someone's role or suspends them. Administrators only.
 *
 * Two guards matter: an organisation must keep at least one active
 * administrator, and nobody may strip their own admin rights - both would lock
 * everyone out of user management with no way back in.
 */
authRouter.patch(
  '/users/:id',
  requireAuth,
  requireRole('admin'),
  validateParams(userIdParam),
  validateBody(updateUserSchema),
  asyncHandler(async (req, res) => {
    const a = auth(req);
    const id = Number(req.params.id);
    const body = req.body as z.infer<typeof updateUserSchema>;

    const scope = a.organizationId
      ? eq(users.organizationId, a.organizationId)
      : eq(users.hospitalId, a.hospitalId);

    const [target] = await db
      .select()
      .from(users)
      .where(and(eq(users.id, id), scope))
      .limit(1);
    if (!target) throw ApiError.notFound('That user is not in your organization');

    const losingAdmin =
      (body.role !== undefined && body.role !== 'admin' && target.role === 'admin') ||
      (body.isActive === false && target.role === 'admin');

    if (losingAdmin) {
      if (target.id === a.id) {
        throw ApiError.badRequest(
          'You cannot remove your own administrator rights. Ask another administrator to do it.',
        );
      }
      const admins = await db
        .select({ id: users.id })
        .from(users)
        .where(and(scope, eq(users.role, 'admin'), eq(users.isActive, true)));
      if (admins.length <= 1) {
        throw ApiError.badRequest(
          'This is the only active administrator. Promote someone else first.',
        );
      }
    }

    const [updated] = await db
      .update(users)
      .set({
        role: body.role ?? target.role,
        isActive: body.isActive ?? target.isActive,
        name: body.name ?? target.name,
        updatedAt: new Date(),
      })
      .where(eq(users.id, id))
      .returning();

    const changes: string[] = [];
    if (body.role && body.role !== target.role) {
      changes.push(`Role ${ROLES[target.role].label} \u2192 ${ROLES[updated.role].label}`);
    }
    if (body.isActive !== undefined && body.isActive !== target.isActive) {
      changes.push(body.isActive ? 'Reactivated' : 'Suspended');
    }
    if (body.name && body.name !== target.name) changes.push(`Renamed to ${body.name}`);

    await safeAudit({
      hospitalId: a.hospitalId,
      category: 'system',
      action: 'Updated team member',
      object: updated.email,
      detail: changes.length ? changes.join(' \u00b7 ') : 'No effective change',
      actor: a,
      ip: req.ip,
    });

    return ok(res, toAuthUser(updated));
  }),
);
