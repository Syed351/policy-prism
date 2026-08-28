/**
 * Branches.
 *
 * A branch is a `hospitals` row grouped under an organisation. Because every
 * other table hangs off hospital_id, a branch owns its own policies,
 * requirements, analysis runs, findings and audit trail with no mixing.
 */

import { Router } from 'express';
import { and, asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { FACILITY_TYPES, SERVICES, STATES } from '@policy-prism/shared';
import { db } from '../../db';
import {
  analysisRuns,
  hospitalServices,
  hospitals,
  organizations,
  policies,
  regulations,
} from '../../db/schema';
import { auth, requireAuth, requirePermission } from '../../middleware/auth';
import { validateBody, validateParams } from '../../middleware/error';
import { safeAudit } from '../../services/audit';
import { ApiError, asyncHandler, created, ok } from '../../utils/http';

export const branchesRouter = Router();

const idParam = z.object({ id: z.coerce.number().int().positive() });

const createSchema = z.object({
  name: z.string().trim().min(2).max(200),
  branchLabel: z.string().trim().max(160).optional(),
  beds: z.coerce.number().int().min(0).max(5000).default(0),
  state: z.enum(STATES as unknown as [string, ...string[]]),
  facilityType: z.string().trim().max(120).default('Acute care hospital'),
  licenseType: z.string().trim().max(120).default('General acute care license'),
  medicare: z.boolean().default(true),
  accredited: z.boolean().default(true),
  services: z.record(z.boolean()).optional(),
  /** Copy the requirement library from this branch, so setup is not repeated. */
  copyRegulationsFrom: z.coerce.number().int().positive().nullable().optional(),
});

const patchSchema = z.object({
  branchLabel: z.string().trim().max(160).optional(),
  isPrimary: z.boolean().optional(),
});

/**
 * GET /api/branches
 * Every branch in the user's organisation, with enough detail for the picker.
 */
branchesRouter.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const a = auth(req);

    // A single-branch deployment has no organisation row until one is needed;
    // fall back to the user's own branch so nothing breaks.
    const rows = a.organizationId
      ? await db
          .select()
          .from(hospitals)
          .where(eq(hospitals.organizationId, a.organizationId))
          .orderBy(asc(hospitals.id))
      : await db.select().from(hospitals).where(eq(hospitals.id, a.homeHospitalId));

    const ids = rows.map((r) => r.id);

    const [policyCounts, regCounts, runCounts] = await Promise.all([
      db
        .select({ hospitalId: policies.hospitalId, count: sql<number>`count(*)::int` })
        .from(policies)
        .groupBy(policies.hospitalId),
      db
        .select({ hospitalId: regulations.hospitalId, count: sql<number>`count(*)::int` })
        .from(regulations)
        .groupBy(regulations.hospitalId),
      db
        .select({
          hospitalId: analysisRuns.hospitalId,
          count: sql<number>`count(*)::int`,
          latestPct: sql<number>`max("analysis_runs"."coverage_pct")::int`,
        })
        .from(analysisRuns)
        .groupBy(analysisRuns.hospitalId),
    ]);

    const byId = <T extends { hospitalId: number }>(list: T[]) =>
      new Map(list.filter((x) => ids.includes(x.hospitalId)).map((x) => [x.hospitalId, x]));

    const pol = byId(policyCounts);
    const reg = byId(regCounts);
    const run = byId(runCounts);

    const services = ids.length
      ? await db.select().from(hospitalServices)
      : [];

    let organizationName: string | null = null;
    if (a.organizationId) {
      const [org] = await db
        .select()
        .from(organizations)
        .where(eq(organizations.id, a.organizationId))
        .limit(1);
      organizationName = org?.name ?? null;
    }

    return ok(
      res,
      rows.map((h) => ({
        id: h.id,
        name: h.name,
        branchLabel: h.branchLabel ?? h.name,
        isPrimary: h.isPrimary,
        state: h.state,
        beds: h.beds,
        facilityType: h.facilityType,
        licenseType: h.licenseType,
        medicare: h.medicare,
        accredited: h.accredited,
        services: services
          .filter((s) => s.hospitalId === h.id && s.enabled)
          .map((s) => s.serviceKey),
        policyCount: pol.get(h.id)?.count ?? 0,
        regulationCount: reg.get(h.id)?.count ?? 0,
        runCount: run.get(h.id)?.count ?? 0,
      })),
      {
        organizationId: a.organizationId,
        organizationName,
        activeBranchId: a.hospitalId,
        homeBranchId: a.homeHospitalId,
      },
    );
  }),
);

/**
 * POST /api/branches
 * Creates a branch. Optionally copies a requirement library across, since two
 * branches of one organisation usually answer to the same frameworks.
 */
branchesRouter.post(
  '/',
  requireAuth,
  requirePermission('profile'),
  validateBody(createSchema),
  asyncHandler(async (req, res) => {
    const a = auth(req);
    const body = req.body as z.infer<typeof createSchema>;

    let organizationId = a.organizationId;

    const newId = await db.transaction(async (tx) => {
      // First extra branch: create the organisation and adopt the existing one.
      if (!organizationId) {
        const [home] = await tx
          .select()
          .from(hospitals)
          .where(eq(hospitals.id, a.homeHospitalId))
          .limit(1);
        const [org] = await tx
          .insert(organizations)
          .values({ name: home?.name ?? 'My organization' })
          .returning();
        organizationId = org.id;

        await tx
          .update(hospitals)
          .set({ organizationId, isPrimary: true, branchLabel: home?.branchLabel ?? home?.name })
          .where(eq(hospitals.id, a.homeHospitalId));
      }

      const [branch] = await tx
        .insert(hospitals)
        .values({
          organizationId,
          name: body.name,
          branchLabel: body.branchLabel || body.name,
          beds: body.beds,
          state: body.state,
          facilityType: body.facilityType,
          licenseType: body.licenseType,
          medicare: body.medicare,
          accredited: body.accredited,
        })
        .returning();

      // Services default to off unless supplied.
      await tx.insert(hospitalServices).values(
        SERVICES.map((s) => ({
          hospitalId: branch.id,
          serviceKey: s.key,
          enabled: body.services?.[s.key] ?? false,
        })),
      );

      // Optional: seed the requirement library from a sibling branch.
      if (body.copyRegulationsFrom) {
        const [source] = await tx
          .select({ id: hospitals.id })
          .from(hospitals)
          .where(
            and(
              eq(hospitals.id, body.copyRegulationsFrom),
              eq(hospitals.organizationId, organizationId),
            ),
          )
          .limit(1);
        if (!source) throw ApiError.badRequest('That branch is not in your organisation.');

        const src = await tx.select().from(regulations).where(eq(regulations.hospitalId, source.id));
        if (src.length) {
          const CHUNK = 500;
          for (let i = 0; i < src.length; i += CHUNK) {
            await tx.insert(regulations).values(
              src.slice(i, i + CHUNK).map((r) => ({
                hospitalId: branch.id,
                framework: r.framework,
                citation: r.citation,
                title: r.title,
                requirementText: r.requirementText,
                applicability: r.applicability,
                effectiveDate: r.effectiveDate,
                sourceRef: r.sourceRef,
                source: r.source,
                createdById: a.id,
              })),
            );
          }
        }
      }

      return branch.id;
    });

    await safeAudit({
      hospitalId: newId,
      category: 'profile',
      action: 'Created branch',
      object: body.name,
      detail:
        `${body.beds} beds \u00b7 ${body.state} \u00b7 ${body.facilityType}` +
        (body.copyRegulationsFrom ? ' \u00b7 requirement library copied' : ''),
      actor: a,
      ip: req.ip,
    });

    const [branch] = await db.select().from(hospitals).where(eq(hospitals.id, newId)).limit(1);
    return created(res, {
      id: branch.id,
      name: branch.name,
      branchLabel: branch.branchLabel ?? branch.name,
      isPrimary: branch.isPrimary,
    });
  }),
);

/** PATCH /api/branches/:id - rename a branch or make it the default. */
branchesRouter.patch(
  '/:id',
  requireAuth,
  requirePermission('profile'),
  validateParams(idParam),
  validateBody(patchSchema),
  asyncHandler(async (req, res) => {
    const a = auth(req);
    const id = Number(req.params.id);
    const body = req.body as z.infer<typeof patchSchema>;

    if (!a.organizationId) throw ApiError.badRequest('This account has only one branch.');

    const [branch] = await db
      .select()
      .from(hospitals)
      .where(and(eq(hospitals.id, id), eq(hospitals.organizationId, a.organizationId)))
      .limit(1);
    if (!branch) throw ApiError.notFound('Branch not found');

    if (body.isPrimary) {
      // Exactly one primary per organisation.
      await db
        .update(hospitals)
        .set({ isPrimary: false })
        .where(eq(hospitals.organizationId, a.organizationId));
    }

    const [updated] = await db
      .update(hospitals)
      .set({
        branchLabel: body.branchLabel ?? branch.branchLabel,
        isPrimary: body.isPrimary ?? branch.isPrimary,
        updatedAt: new Date(),
      })
      .where(eq(hospitals.id, id))
      .returning();

    await safeAudit({
      hospitalId: id,
      category: 'profile',
      action: 'Updated branch',
      object: updated.branchLabel ?? updated.name,
      detail: body.isPrimary ? 'Set as the default branch' : 'Renamed',
      actor: a,
      ip: req.ip,
    });

    return ok(res, {
      id: updated.id,
      name: updated.name,
      branchLabel: updated.branchLabel ?? updated.name,
      isPrimary: updated.isPrimary,
    });
  }),
);

/**
 * DELETE /api/branches/:id
 * Removes a hospital profile and everything scoped to it. Guarded: the last
 * profile cannot be deleted, and neither can one that still has users other
 * than through the organisation.
 */
branchesRouter.delete(
  '/:id',
  requireAuth,
  requirePermission('profile'),
  validateParams(idParam),
  asyncHandler(async (req, res) => {
    const a = auth(req);
    const id = Number(req.params.id);

    if (!a.organizationId) {
      throw ApiError.badRequest('This account has a single profile, which cannot be deleted.');
    }

    const siblings = await db
      .select({ id: hospitals.id, name: hospitals.name, isPrimary: hospitals.isPrimary })
      .from(hospitals)
      .where(eq(hospitals.organizationId, a.organizationId));

    const target = siblings.find((h) => h.id === id);
    if (!target) throw ApiError.notFound('Profile not found');

    if (siblings.length <= 1) {
      throw ApiError.badRequest('This is the only hospital profile, so it cannot be deleted.');
    }
    if (id === a.homeHospitalId) {
      throw ApiError.badRequest(
        'This is your account\u2019s home profile. Make another profile the default first.',
      );
    }

    // Report what is about to go, so the audit entry is meaningful.
    const [counts] = await db
      .select({
        policies: sql<number>`(SELECT count(*) FROM policies WHERE hospital_id = ${id})::int`,
        regulations: sql<number>`(SELECT count(*) FROM regulations WHERE hospital_id = ${id})::int`,
        runs: sql<number>`(SELECT count(*) FROM analysis_runs WHERE hospital_id = ${id})::int`,
      })
      .from(hospitals)
      .where(eq(hospitals.id, id))
      .limit(1);

    // Every child table cascades from hospitals, so one delete clears it all.
    await db.delete(hospitals).where(eq(hospitals.id, id));

    // If the deleted one was the default, promote the lowest remaining profile.
    if (target.isPrimary) {
      const remaining = siblings.filter((h) => h.id !== id).sort((x, y) => x.id - y.id)[0];
      if (remaining) {
        await db.update(hospitals).set({ isPrimary: true }).where(eq(hospitals.id, remaining.id));
      }
    }

    await safeAudit({
      hospitalId: a.homeHospitalId,
      category: 'profile',
      action: 'Deleted hospital profile',
      object: target.name,
      detail:
        `${counts?.policies ?? 0} policies \u00b7 ${counts?.regulations ?? 0} requirements \u00b7 ` +
        `${counts?.runs ?? 0} analysis run(s) removed`,
      actor: a,
      ip: req.ip,
    });

    return ok(res, { id, deleted: true, movedTo: a.homeHospitalId });
  }),
);

/**
 * POST /api/branches/:id/viewed
 * Records that a user opened a profile. Switching profile changes which
 * facility's data someone is looking at, which is exactly the kind of thing an
 * audit trail exists to answer.
 */
branchesRouter.post(
  '/:id/viewed',
  requireAuth,
  validateParams(idParam),
  asyncHandler(async (req, res) => {
    const a = auth(req);
    const id = Number(req.params.id);

    const [branch] = await db
      .select({ id: hospitals.id, name: hospitals.name, branchLabel: hospitals.branchLabel })
      .from(hospitals)
      .where(
        a.organizationId
          ? and(eq(hospitals.id, id), eq(hospitals.organizationId, a.organizationId))
          : eq(hospitals.id, a.homeHospitalId),
      )
      .limit(1);

    if (!branch) throw ApiError.forbidden('That profile does not belong to your organisation.');

    await safeAudit({
      hospitalId: branch.id,
      category: 'profile',
      action: 'Switched to this hospital profile',
      object: branch.branchLabel ?? branch.name,
      detail: `${a.name} (${a.roleLabel}) is now working in this profile`,
      actor: a,
      ip: req.ip,
    });

    return ok(res, { id: branch.id, recorded: true });
  }),
);
