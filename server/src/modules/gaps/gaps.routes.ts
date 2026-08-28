import { Router } from 'express';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  FindingFlag,
  GAP_STATUSES,
  GapDto,
  PRIORITIES,
  PRIORITY_ORDER,
  Priority,
} from '@policy-prism/shared';
import { db } from '../../db';
import { gapFindings, policies, regulations, remediationItems } from '../../db/schema';
import { auth, requireAuth, requirePermission } from '../../middleware/auth';
import { validateBody, validateParams, validateQuery } from '../../middleware/error';
import { safeAudit } from '../../services/audit';
import { ApiError, asyncHandler, ok } from '../../utils/http';
import { latestRun } from '../analysis/analysis.service';

export const gapsRouter = Router();

const idParam = z.object({ id: z.coerce.number().int().positive() });

const listQuery = z.object({
  runId: z.coerce.number().int().positive().optional(),
  priority: z.enum(PRIORITIES).optional(),
  status: z.enum(GAP_STATUSES).optional(),
  framework: z.string().trim().optional(),
  q: z.string().trim().optional(),
  /** Focus a single requirement, for links arriving from the mapping table. */
  regulationId: z.coerce.number().int().positive().optional(),
  page: z.coerce.number().int().min(0).default(0),
  perPage: z.coerce.number().int().min(1).max(200).default(50),
});

const patchSchema = z.object({
  status: z.enum(GAP_STATUSES).optional(),
  suggestedOwner: z.string().trim().max(160).optional(),
  priority: z.enum(PRIORITIES).optional(),
  notes: z.string().trim().max(4000).nullable().optional(),
  /** The edited draft. Generated text is a starting point, not the answer. */
  draftLanguage: z.string().max(20_000).optional(),
});

type GapJoin = {
  gap: typeof gapFindings.$inferSelect;
  regulation: typeof regulations.$inferSelect;
  policy: typeof policies.$inferSelect | null;
  remediation: typeof remediationItems.$inferSelect | null;
};

function toGapDto(row: GapJoin): GapDto {
  const g = row.gap;
  return {
    id: g.id,
    runId: g.runId,
    mappingId: g.mappingId,
    regulationId: g.regulationId,
    policyId: g.policyId,
    status: g.status,
    score: g.score,
    coverageStatus: g.coverageStatus,
    flags: (g.flags ?? []) as FindingFlag[],
    notes: g.notes,
    action: g.action,
    effort: g.effort,
    priority: g.priority,
    owner: g.suggestedOwner,
    risk: g.risk,
    targetPolicyId: g.policyId,
    targetPolicyCode: row.policy ? row.policy.code || row.policy.title : null,
    targetPolicyVersion: row.policy?.version ?? null,
    missingTerms: g.missingTerms ?? [],
    uncoveredClauses: g.uncoveredClauses ?? [],
    steps: g.steps ?? [],
    draft: g.draftLanguage,
    regulation: {
      id: row.regulation.id,
      framework: row.regulation.framework,
      citation: row.regulation.citation,
      title: row.regulation.title,
      requirementText: row.regulation.requirementText,
    },
    remediation: row.remediation
      ? {
          id: row.remediation.id,
          gapId: row.remediation.gapId,
          title: row.remediation.title,
          owner: row.remediation.owner,
          priority: row.remediation.priority,
          risk: row.remediation.risk,
          status: row.remediation.status,
          recommendedAction: row.remediation.recommendedAction,
          dueDate: row.remediation.dueDate,
          notes: row.remediation.notes,
          createdAt: row.remediation.createdAt.toISOString(),
          updatedAt: row.remediation.updatedAt.toISOString(),
        }
      : null,
    createdAt: g.createdAt.toISOString(),
    updatedAt: g.updatedAt.toISOString(),
  };
}

async function resolveRunId(hospitalId: number, requested?: number): Promise<number | null> {
  if (requested) return requested;
  const run = await latestRun(hospitalId);
  return run?.id ?? null;
}

/** GET /api/gaps */
gapsRouter.get(
  '/',
  requireAuth,
  validateQuery(listQuery),
  asyncHandler(async (req, res) => {
    const a = auth(req);
    const q = req.query as unknown as z.infer<typeof listQuery>;

    const runId = await resolveRunId(a.hospitalId, q.runId);
    if (!runId) {
      return ok(res, [], { total: 0, byPriority: { Critical: 0, High: 0, Medium: 0 }, runId: null });
    }

    const filters = [eq(gapFindings.hospitalId, a.hospitalId), eq(gapFindings.runId, runId)];
    if (q.priority) filters.push(eq(gapFindings.priority, q.priority));
    if (q.status) filters.push(eq(gapFindings.status, q.status));

    let rows = await db
      .select({
        gap: gapFindings,
        regulation: regulations,
        policy: policies,
        remediation: remediationItems,
      })
      .from(gapFindings)
      .innerJoin(regulations, eq(regulations.id, gapFindings.regulationId))
      .leftJoin(policies, eq(policies.id, gapFindings.policyId))
      .leftJoin(remediationItems, eq(remediationItems.gapId, gapFindings.id))
      .where(and(...filters))
      .orderBy(asc(gapFindings.score));

    if (q.regulationId) rows = rows.filter((r) => r.gap.regulationId === q.regulationId);
    if (q.framework) rows = rows.filter((r) => r.regulation.framework === q.framework);
    if (q.q) {
      const needle = q.q.toLowerCase();
      rows = rows.filter((r) =>
        `${r.regulation.title} ${r.regulation.citation} ${r.gap.suggestedOwner}`
          .toLowerCase()
          .includes(needle),
      );
    }

    // Critical first, then weakest match first - the prototype's ordering.
    rows.sort(
      (x, y) =>
        PRIORITY_ORDER[x.gap.priority as Priority] - PRIORITY_ORDER[y.gap.priority as Priority] ||
        x.gap.score - y.gap.score,
    );

    const byPriority: Record<Priority, number> = { Critical: 0, High: 0, Medium: 0 };
    rows.forEach((r) => {
      byPriority[r.gap.priority as Priority] += 1;
    });

    const total = rows.length;
    const paged = rows.slice(q.page * q.perPage, q.page * q.perPage + q.perPage);

    return ok(res, paged.map(toGapDto), {
      total,
      page: q.page,
      perPage: q.perPage,
      byPriority,
      runId,
      frameworks: [...new Set(rows.map((r) => r.regulation.framework))],
    });
  }),
);

/** GET /api/gaps/:id */
gapsRouter.get(
  '/:id',
  requireAuth,
  validateParams(idParam),
  asyncHandler(async (req, res) => {
    const a = auth(req);
    const [row] = await db
      .select({
        gap: gapFindings,
        regulation: regulations,
        policy: policies,
        remediation: remediationItems,
      })
      .from(gapFindings)
      .innerJoin(regulations, eq(regulations.id, gapFindings.regulationId))
      .leftJoin(policies, eq(policies.id, gapFindings.policyId))
      .leftJoin(remediationItems, eq(remediationItems.gapId, gapFindings.id))
      .where(and(eq(gapFindings.id, Number(req.params.id)), eq(gapFindings.hospitalId, a.hospitalId)))
      .limit(1);

    if (!row) throw ApiError.notFound('Gap not found');
    return ok(res, toGapDto(row));
  }),
);

/**
 * PATCH /api/gaps/:id
 * Lets a team triage a finding: reassign the owner, change the priority the
 * engine suggested, or mark it resolved / risk-accepted.
 */
gapsRouter.patch(
  '/:id',
  requireAuth,
  requirePermission('edit'),
  validateParams(idParam),
  validateBody(patchSchema),
  asyncHandler(async (req, res) => {
    const a = auth(req);
    const id = Number(req.params.id);
    const body = req.body as z.infer<typeof patchSchema>;

    const [existing] = await db
      .select()
      .from(gapFindings)
      .where(and(eq(gapFindings.id, id), eq(gapFindings.hospitalId, a.hospitalId)))
      .limit(1);
    if (!existing) throw ApiError.notFound('Gap not found');

    await db
      .update(gapFindings)
      .set({
        status: body.status ?? existing.status,
        suggestedOwner: body.suggestedOwner ?? existing.suggestedOwner,
        priority: body.priority ?? existing.priority,
        draftLanguage: body.draftLanguage ?? existing.draftLanguage,
        notes: body.notes !== undefined ? body.notes : existing.notes,
        updatedAt: new Date(),
      })
      .where(eq(gapFindings.id, id));

    const [row] = await db
      .select({
        gap: gapFindings,
        regulation: regulations,
        policy: policies,
        remediation: remediationItems,
      })
      .from(gapFindings)
      .innerJoin(regulations, eq(regulations.id, gapFindings.regulationId))
      .leftJoin(policies, eq(policies.id, gapFindings.policyId))
      .leftJoin(remediationItems, eq(remediationItems.gapId, gapFindings.id))
      .where(eq(gapFindings.id, id))
      .limit(1);

    const draftEdited =
      body.draftLanguage !== undefined && body.draftLanguage !== existing.draftLanguage;

    const changes: string[] = [];
    if (draftEdited) changes.push('Draft language edited');
    if (body.status && body.status !== existing.status) {
      changes.push(`Status ${existing.status} \u2192 ${body.status}`);
    }
    if (body.priority && body.priority !== existing.priority) {
      changes.push(`Priority ${existing.priority} \u2192 ${body.priority}`);
    }
    if (body.suggestedOwner && body.suggestedOwner !== existing.suggestedOwner) {
      changes.push(`Owner ${existing.suggestedOwner} \u2192 ${body.suggestedOwner}`);
    }

    await safeAudit({
      hospitalId: a.hospitalId,
      category: 'review',
      action: 'Updated gap finding',
      object: row.regulation.citation,
      detail: changes.length ? changes.join(' \u00b7 ') : 'Notes updated',
      actor: a,
      ip: req.ip,
    });

    return ok(res, toGapDto(row));
  }),
);

/** GET /api/gaps/:id/draft - the generated policy language for this gap. */
gapsRouter.get(
  '/:id/draft',
  requireAuth,
  validateParams(idParam),
  asyncHandler(async (req, res) => {
    const a = auth(req);
    const [row] = await db
      .select({ gap: gapFindings, regulation: regulations, policy: policies })
      .from(gapFindings)
      .innerJoin(regulations, eq(regulations.id, gapFindings.regulationId))
      .leftJoin(policies, eq(policies.id, gapFindings.policyId))
      .where(and(eq(gapFindings.id, Number(req.params.id)), eq(gapFindings.hospitalId, a.hospitalId)))
      .limit(1);
    if (!row) throw ApiError.notFound('Gap not found');

    return ok(res, {
      /** Which document to amend, named - "add it somewhere" is not an instruction. */
      targetPolicyCode: row.policy?.code ?? null,
      targetPolicyTitle: row.policy?.title ?? null,
      citation: row.regulation.citation,
      title: row.regulation.title,
      framework: row.regulation.framework,
      priority: row.gap.priority,
      owner: row.gap.suggestedOwner,
      /** Enough for the drawer to say what to do, not just that something must be done. */
      id: row.gap.id,
      recommendedAction: row.gap.action,
      uncoveredProvisions: row.gap.uncoveredClauses ?? [],
      steps: row.gap.steps ?? [],
      targetPolicyId: row.gap.policyId,
      draft: row.gap.draftLanguage,
      note:
        'A starting draft generated from the requirement text, in policy voice. ' +
        'Edit it to match your document conventions before approval \u2014 it is a scaffold, not an approved policy.',
    });
  }),
);

/** Summary used by the dashboard and reports. */
export async function gapSummary(hospitalId: number, runId: number) {
  const rows = await db
    .select({ priority: gapFindings.priority, count: sql<number>`count(*)::int` })
    .from(gapFindings)
    .where(and(eq(gapFindings.hospitalId, hospitalId), eq(gapFindings.runId, runId)))
    .groupBy(gapFindings.priority);

  const out: Record<Priority, number> = { Critical: 0, High: 0, Medium: 0 };
  rows.forEach((r) => {
    out[r.priority as Priority] = Number(r.count);
  });
  return out;
}

export async function gapsForRun(hospitalId: number, runId: number) {
  const rows = await db
    .select({
      gap: gapFindings,
      regulation: regulations,
      policy: policies,
      remediation: remediationItems,
    })
    .from(gapFindings)
    .innerJoin(regulations, eq(regulations.id, gapFindings.regulationId))
    .leftJoin(policies, eq(policies.id, gapFindings.policyId))
    .leftJoin(remediationItems, eq(remediationItems.gapId, gapFindings.id))
    .where(and(eq(gapFindings.hospitalId, hospitalId), eq(gapFindings.runId, runId)))
    .orderBy(desc(gapFindings.priority), asc(gapFindings.score));

  rows.sort(
    (x, y) =>
      PRIORITY_ORDER[x.gap.priority as Priority] - PRIORITY_ORDER[y.gap.priority as Priority] ||
      x.gap.score - y.gap.score,
  );
  return rows.map(toGapDto);
}
