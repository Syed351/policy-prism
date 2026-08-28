import { Router } from 'express';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  AnalysisRunDto,
  ANALYSIS_STEPS,
  CoverageStatus,
  DashboardDto,
  FindingFlag,
  MappingDto,
  PolicyCheckDto,
  POLICY_VERDICT_LABEL,
  PRODUCT_DISCLAIMER,
  REMEDIATION_STATUSES,
  RemediationStatus,
  TH_COV,
  TH_PAR,
} from '@policy-prism/shared';
import { db } from '../../db';
import {
  analysisRuns,
  gapFindings,
  policies,
  policyMappings,
  regulations,
  remediationItems,
} from '../../db/schema';
import { auth, requireAuth, requirePermission } from '../../middleware/auth';
import { validateBody, validateParams, validateQuery } from '../../middleware/error';
import { recentActivity } from '../../services/audit';
import { getProfile, toScopeProfile } from '../../services/hospital';
import { applies, isUpcoming } from '../../services/scope';
import { ApiError, asyncHandler, ok } from '../../utils/http';
import {
  assertRunBelongs,
  latestRun,
  mappingsForRun,
  runAnalysis,
  runsForHospital,
  tallyCounts,
} from './analysis.service';

export const analysisRouter = Router();
export const dashboardRouter = Router();

const idParam = z.object({ id: z.coerce.number().int().positive() });

const runSchema = z.object({
  trigger: z.string().trim().max(60).optional(),
  regulationIds: z.array(z.coerce.number().int().positive()).max(2000).optional(),
  policyIds: z.array(z.coerce.number().int().positive()).max(2000).optional(),
  policyScoped: z.boolean().optional(),
});

const mappingQuery = z.object({
  q: z.string().trim().optional(),
  framework: z.string().trim().optional(),
  status: z.enum(['covered', 'partial', 'not_addressed', 'no_policy']).optional(),
  review: z.enum(['pending', 'approved', 'rejected']).optional(),
  page: z.coerce.number().int().min(0).default(0),
  perPage: z.coerce.number().int().min(1).max(500).default(100),
});

/* ------------------------------------------------------------------ *
 * Serialisation
 * ------------------------------------------------------------------ */

export function toRunDto(row: typeof analysisRuns.$inferSelect): AnalysisRunDto {
  return {
    id: row.id,
    runNumber: row.runNumber,
    status: row.status,
    trigger: row.trigger,
    scopeKind: row.scopeKind,
    label: row.label,
    facilityName: row.facilityName,
    requirementCount: row.requirementCount,
    policyCount: row.policyCount,
    covered: row.covered,
    partial: row.partial,
    notAddressed: row.notAddressed,
    noPolicy: row.noPolicy,
    gaps: row.notAddressed + row.noPolicy,
    coveragePct: row.coveragePct,
    durationMs: row.durationMs,
    scopeChanged: row.scopeChanged,
    scopeDiff: row.scopeDiff,
    coverageDelta: row.coverageDelta,
    gapDelta: row.gapDelta,
    runByName: row.runByName,
    createdAt: row.createdAt.toISOString(),
  };
}

type MappingJoin = {
  mapping: typeof policyMappings.$inferSelect;
  regulation: typeof regulations.$inferSelect;
  policy: typeof policies.$inferSelect | null;
};

/**
 * Looks up every policy for this hospital once, so serialising a page of
 * mappings costs one query rather than one per row. On a remote database a
 * per-row lookup turns a 100-row page into 100 round trips.
 */
export async function policyLookup(hospitalId: number): Promise<Map<number, typeof policies.$inferSelect>> {
  const rows = await db.select().from(policies).where(eq(policies.hospitalId, hospitalId));
  return new Map(rows.map((p) => [p.id, p]));
}

export async function toMappingDto(
  row: MappingJoin,
  altById?: Map<number, typeof policies.$inferSelect>,
): Promise<MappingDto> {
  const m = row.mapping;
  if (!altById) {
    // Fallback for single-row callers; page callers pass the shared map in.
    const altIds = (m.alternatives ?? []).map((a) => a.policyId).filter((x): x is number => !!x);
    const found = altIds.length
      ? await db.select().from(policies).where(inArray(policies.id, altIds))
      : [];
    altById = new Map(found.map((p) => [p.id, p]));
  }

  return {
    analysisMethod: (m.analysisMethod as 'semantic' | 'deterministic') ?? 'deterministic',
    aiStatus: m.aiStatus,
    aiConfidence: m.aiConfidence,
    aiExplanation: m.aiExplanation,
    aiEvidence: (m.aiEvidence as MappingDto['aiEvidence']) ?? null,
    aiMissingProvisions: m.aiMissingProvisions ?? null,
    aiContradictions: m.aiContradictions ?? null,
    aiModel: m.aiModel,
    semanticScore: m.semanticScore,
    aiFallbackReason: m.aiFallbackReason,
    id: m.id,
    runId: m.runId,
    regulationId: m.regulationId,
    policyId: m.policyId,
    score: m.score,
    status: m.status,
    matchedTerms: m.matchedTerms ?? [],
    missingTerms: m.missingTerms ?? [],
    contradictoryTerms: m.contradictoryTerms ?? [],
    flags: (m.flags ?? []) as FindingFlag[],
    alternatives: (m.alternatives ?? []).map((a) => ({
      policyId: a.policyId,
      policyCode: altById.get(a.policyId)?.code ?? null,
      policyTitle: altById.get(a.policyId)?.title ?? null,
      score: a.score,
    })),
    joint: m.joint ?? null,
    reviewStatus: m.reviewStatus,
    reviewComment: m.reviewComment,
    reviewedByName: m.reviewedByName,
    reviewedAt: m.reviewedAt ? m.reviewedAt.toISOString() : null,
    needsRereview: (m.needsRereview as MappingDto['needsRereview']) ?? null,
    regulation: {
      id: row.regulation.id,
      framework: row.regulation.framework,
      citation: row.regulation.citation,
      title: row.regulation.title,
      requirementText: row.regulation.requirementText,
      applicability: row.regulation.applicability,
      amendedAt: row.regulation.amendedAt,
      effectiveDate: row.regulation.effectiveDate,
    },
    policy: row.policy
      ? {
          id: row.policy.id,
          code: row.policy.code,
          title: row.policy.title,
          owner: row.policy.owner,
          version: row.policy.version,
          effectiveDate: row.policy.effectiveDate,
          text: row.policy.text,
        }
      : null,
  };
}

/* ------------------------------------------------------------------ *
 * POST /api/analysis/run
 * ------------------------------------------------------------------ */

analysisRouter.post(
  '/run',
  requireAuth,
  requirePermission('run'),
  validateBody(runSchema),
  asyncHandler(async (req, res) => {
    const a = auth(req);
    const body = req.body as z.infer<typeof runSchema>;

    const { runId } = await runAnalysis(a, body, req.ip);
    const run = await assertRunBelongs(runId, a.hospitalId);

    return ok(
      res,
      { run: toRunDto(run) },
      {
        steps: ANALYSIS_STEPS,
        disclaimer: PRODUCT_DISCLAIMER,
        note: 'Every finding starts as pending. Nothing counts until a reviewer confirms it.',
      },
    );
  }),
);

/** GET /api/analysis - run history */
analysisRouter.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const a = auth(req);
    const rows = await runsForHospital(a.hospitalId, 30);
    return ok(res, rows.map(toRunDto));
  }),
);

/** GET /api/analysis/latest */
analysisRouter.get(
  '/latest',
  requireAuth,
  asyncHandler(async (req, res) => {
    const a = auth(req);
    const run = await latestRun(a.hospitalId);
    if (!run) {
      return ok(res, null, { message: 'No analysis has been run yet.' });
    }
    return ok(res, toRunDto(run));
  }),
);

/** GET /api/analysis/:id */
analysisRouter.get(
  '/:id',
  requireAuth,
  validateParams(idParam),
  asyncHandler(async (req, res) => {
    const a = auth(req);
    const run = await assertRunBelongs(Number(req.params.id), a.hospitalId);

    const rows = await mappingsForRun(run.id);
    const counts = tallyCounts(
      rows.map((r) => ({
        status: r.mapping.status,
        flags: r.mapping.flags ?? [],
        reviewStatus: r.mapping.reviewStatus,
        needsRereview: r.mapping.needsRereview,
      })),
    );

    return ok(res, { run: toRunDto(run), counts });
  }),
);

/** GET /api/analysis/:id/mappings */
analysisRouter.get(
  '/:id/mappings',
  requireAuth,
  validateParams(idParam),
  validateQuery(mappingQuery),
  asyncHandler(async (req, res) => {
    const a = auth(req);
    const q = req.query as unknown as z.infer<typeof mappingQuery>;
    const run = await assertRunBelongs(Number(req.params.id), a.hospitalId);

    let rows = await mappingsForRun(run.id);

    // Weakest coverage first. Ordering by score alone nearly does this, but
    // grouping by coverage class keeps the classes contiguous - a reviewer
    // works down from "no policy" to "covered", not through an interleaving.
    const CLASS_ORDER: Record<string, number> = {
      no_policy: 0,
      not_addressed: 1,
      partial: 2,
      covered: 3,
    };
    rows.sort(
      (a, b) =>
        (CLASS_ORDER[a.mapping.status] ?? 9) - (CLASS_ORDER[b.mapping.status] ?? 9) ||
        a.mapping.score - b.mapping.score,
    );

    if (q.framework) rows = rows.filter((r) => r.regulation.framework === q.framework);
    if (q.status) rows = rows.filter((r) => r.mapping.status === q.status);
    if (q.review) rows = rows.filter((r) => r.mapping.reviewStatus === q.review);
    if (q.q) {
      const needle = q.q.toLowerCase();
      rows = rows.filter((r) =>
        `${r.regulation.title} ${r.regulation.citation} ${r.policy?.title ?? ''} ${r.policy?.code ?? ''}`
          .toLowerCase()
          .includes(needle),
      );
    }

    const total = rows.length;
    const paged = rows.slice(q.page * q.perPage, q.page * q.perPage + q.perPage);
    const lookup = await policyLookup(a.hospitalId);
    const dtos = await Promise.all(paged.map((r) => toMappingDto(r, lookup)));

    const frameworks = [...new Set(rows.map((r) => r.regulation.framework))];

    return ok(res, dtos, { total, page: q.page, perPage: q.perPage, frameworks });
  }),
);

/**
 * GET /api/analysis/:id/policy-check
 * Flips the mapping around: each policy judged on the requirements it owns.
 * Ported from the prototype's policyVerdict().
 */
analysisRouter.get(
  '/:id/policy-check',
  requireAuth,
  validateParams(idParam),
  asyncHandler(async (req, res) => {
    const a = auth(req);
    const run = await assertRunBelongs(Number(req.params.id), a.hospitalId);

    const rows = await mappingsForRun(run.id);
    const allPolicies = await db
      .select()
      .from(policies)
      .where(and(eq(policies.hospitalId, a.hospitalId), eq(policies.scope, 'regulatory')));

    const out: PolicyCheckDto[] = allPolicies.map((p) => {
      // Requirements this policy is closest to, or clears the partial bar on.
      const own = rows.filter((r) => r.mapping.policyId === p.id);
      const alt = rows.filter(
        (r) =>
          r.mapping.policyId !== p.id &&
          (r.mapping.alternatives ?? []).some((x) => x.policyId === p.id && x.score >= TH_PAR),
      );

      const hits = [
        ...own.map((r) => ({ row: r, score: r.mapping.score, best: true })),
        ...alt.map((r) => ({
          row: r,
          score: (r.mapping.alternatives ?? []).find((x) => x.policyId === p.id)!.score,
          best: false,
        })),
      ];

      const related = rows
        .filter(
          (r) =>
            r.mapping.policyId !== p.id &&
            (r.mapping.alternatives ?? []).some((x) => x.policyId === p.id && x.score < TH_PAR),
        )
        .map((r) => ({
          regulationId: r.regulation.id,
          citation: r.regulation.citation,
          title: r.regulation.title,
          framework: r.regulation.framework,
          score: (r.mapping.alternatives ?? []).find((x) => x.policyId === p.id)!.score,
        }));

      const covered = hits.filter((h) => h.score >= TH_COV).length;
      const partial = hits.filter((h) => h.score >= TH_PAR && h.score < TH_COV).length;
      const weak = hits.length - covered - partial;
      const contra = hits.filter((h) => (h.row.mapping.contradictoryTerms ?? []).length > 0).length;

      let verdict: PolicyCheckDto['verdict'] = 'unmatched';
      if (hits.length) {
        if (covered && !partial && !weak) verdict = 'meets';
        else if (covered || partial) verdict = 'partly';
        else verdict = 'insufficient';
      }
      if (contra) verdict = 'insufficient';

      return {
        policy: {
          id: p.id,
          code: p.code,
          title: p.title,
          owner: p.owner,
          version: p.version,
          effectiveDate: p.effectiveDate,
          scope: p.scope,
        },
        verdict,
        verdictLabel: POLICY_VERDICT_LABEL[verdict],
        covered,
        partial,
        weak,
        contra,
        hits: hits
          .sort((x, y) => y.score - x.score)
          .map((h) => ({
            regulationId: h.row.regulation.id,
            citation: h.row.regulation.citation,
            title: h.row.regulation.title,
            framework: h.row.regulation.framework,
            score: h.score,
            status: h.row.mapping.status as CoverageStatus,
            best: h.best,
          })),
        related: related.sort((x, y) => y.score - x.score),
      };
    });

    return ok(res, out, { runId: run.id });
  }),
);

/* ------------------------------------------------------------------ *
 * GET /api/dashboard - every number here comes from Postgres
 * ------------------------------------------------------------------ */

dashboardRouter.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const a = auth(req);
    const profile = await getProfile(a.hospitalId);
    const scopeProfile = toScopeProfile(profile);

    const [allRegs, policyCountRow, runs, activity] = await Promise.all([
      db.select().from(regulations).where(eq(regulations.hospitalId, a.hospitalId)),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(policies)
        .where(eq(policies.hospitalId, a.hospitalId)),
      runsForHospital(a.hospitalId, 50),
      recentActivity(a.hospitalId, 7),
    ]);

    const inScope = allRegs.filter((r) => applies(r, scopeProfile));

    // ?runId= lets the user open any previous report, not just the newest.
    const wantedId = Number((req.query as Record<string, unknown>).runId ?? 0);
    let run = wantedId ? runs.find((r) => r.id === wantedId && r.status === 'completed') ?? null : null;

    if (wantedId && !run) {
      // Older than the recent list: load it directly rather than silently
      // falling back to the newest run.
      const [older] = await db
        .select()
        .from(analysisRuns)
        .where(
          and(
            eq(analysisRuns.id, wantedId),
            eq(analysisRuns.hospitalId, a.hospitalId),
            eq(analysisRuns.status, 'completed'),
          ),
        )
        .limit(1);
      run = older ?? null;
    }

    if (!run) run = runs.find((r) => r.status === 'completed') ?? null;

    const remediationTally = {} as Record<RemediationStatus, number>;
    REMEDIATION_STATUSES.forEach((s) => {
      remediationTally[s] = 0;
    });
    const remRows = await db
      .select({ status: remediationItems.status, count: sql<number>`count(*)::int` })
      .from(remediationItems)
      .where(eq(remediationItems.hospitalId, a.hospitalId))
      .groupBy(remediationItems.status);
    remRows.forEach((r) => {
      remediationTally[r.status] = Number(r.count);
    });

    const base = {
      hasAnalysis: !!run,
      run: run ? toRunDto(run) : null,
      runs: runs.map(toRunDto),
      remediation: remediationTally,
      activity: activity.map((l) => ({
        id: l.id,
        seq: l.seq,
        category: l.category,
        action: l.action,
        object: l.object,
        detail: l.detail,
        actorName: l.actorName,
        actorRole: l.actorRole,
        createdAt: l.createdAt.toISOString(),
      })),
      policyCount: Number(policyCountRow[0]?.count ?? 0),
      regulationCount: allRegs.length,
      inScopeCount: inScope.length,
    };

    if (!run) {
      const empty: DashboardDto = {
        ...base,
        counts: {
          covered: 0, partial: 0, not_addressed: 0, no_policy: 0, gap: 0, open: 0,
          conflict: 0, stale: 0, total: 0, coveragePct: 0, reviewed: 0, pending: 0,
          approved: 0, rejected: 0, needsRereview: 0,
        },
        byFramework: [],
        strip: [],
        riskiestGaps: [],
        upcomingRegulations: [],
        amendedRegulations: [],
      };
      return ok(res, empty, { disclaimer: PRODUCT_DISCLAIMER });
    }

    const rows = await mappingsForRun(run.id);

    // A run's mappings are deleted when its requirements are (replacing the
    // library cascades). The run row keeps its own totals, so an older report
    // still shows the headline numbers even when the detail is gone.
    const detailAvailable = rows.length > 0;

    const counts = detailAvailable
      ? tallyCounts(
          rows.map((r) => ({
            status: r.mapping.status,
            flags: r.mapping.flags ?? [],
            reviewStatus: r.mapping.reviewStatus,
            needsRereview: r.mapping.needsRereview,
          })),
        )
      : {
          covered: run.covered,
          partial: run.partial,
          not_addressed: run.notAddressed,
          no_policy: run.noPolicy,
          gap: run.notAddressed + run.noPolicy,
          open: run.notAddressed + run.noPolicy + run.partial,
          conflict: 0,
          stale: 0,
          total: run.requirementCount,
          coveragePct: run.coveragePct,
          reviewed: 0,
          pending: 0,
          approved: 0,
          rejected: 0,
          needsRereview: 0,
        };

    const frameworks = [...new Set(rows.map((r) => r.regulation.framework))];
    const byFramework = frameworks.map((f) => {
      const rs = rows.filter((r) => r.regulation.framework === f);
      return {
        framework: f,
        total: rs.length,
        covered: rs.filter((r) => r.mapping.status === 'covered').length,
        partial: rs.filter((r) => r.mapping.status === 'partial').length,
        gap: rs.filter((r) => r.mapping.status === 'not_addressed' || r.mapping.status === 'no_policy')
          .length,
      };
    });

    const statusByReg = new Map(rows.map((r) => [r.regulation.id, r.mapping.status]));

    const dashboard: DashboardDto = {
      ...base,
      detailAvailable,
      counts,
      byFramework,
      strip: rows.map((r) => ({
        regulationId: r.regulation.id,
        citation: r.regulation.citation,
        status: r.mapping.status,
        score: r.mapping.score,
      })),
      riskiestGaps: rows
        .filter((r) => r.mapping.status === 'not_addressed' || r.mapping.status === 'no_policy')
        .sort((x, y) => x.mapping.score - y.mapping.score)
        .slice(0, 5)
        .map((r) => ({
          mappingId: r.mapping.id,
          regulationId: r.regulation.id,
          framework: r.regulation.framework,
          citation: r.regulation.citation,
          title: r.regulation.title,
          score: r.mapping.score,
        })),
      upcomingRegulations: inScope
        .filter(isUpcoming)
        .sort((x, y) => String(x.effectiveDate).localeCompare(String(y.effectiveDate)))
        .map((r) => ({
          id: r.id,
          framework: r.framework,
          citation: r.citation,
          title: r.title,
          effectiveDate: r.effectiveDate!,
          status: statusByReg.get(r.id) ?? null,
        })),
      amendedRegulations: inScope
        .filter((r) => !!r.amendedAt)
        .map((r) => ({ id: r.id, citation: r.citation, amendedAt: r.amendedAt! })),
    };

    return ok(res, dashboard, { disclaimer: PRODUCT_DISCLAIMER });
  }),
);

/** GET /api/analysis/:id/mappings/:mappingId - evidence drawer */
analysisRouter.get(
  '/mapping/:id',
  requireAuth,
  validateParams(idParam),
  asyncHandler(async (req, res) => {
    const a = auth(req);
    const id = Number(req.params.id);

    const [row] = await db
      .select({ mapping: policyMappings, regulation: regulations, policy: policies })
      .from(policyMappings)
      .innerJoin(regulations, eq(regulations.id, policyMappings.regulationId))
      .leftJoin(policies, eq(policies.id, policyMappings.policyId))
      .where(and(eq(policyMappings.id, id), eq(policyMappings.hospitalId, a.hospitalId)))
      .limit(1);

    if (!row) throw ApiError.notFound('Finding not found');

    const dto = await toMappingDto(row);

    const [gap] = await db
      .select()
      .from(gapFindings)
      .where(eq(gapFindings.mappingId, id))
      .limit(1);

    return ok(res, {
      mapping: dto,
      gap: gap
        ? {
            id: gap.id,
            priority: gap.priority,
            action: gap.action,
            effort: gap.effort,
            owner: gap.suggestedOwner,
            risk: gap.risk,
            steps: gap.steps,
            uncoveredClauses: gap.uncoveredClauses,
            missingTerms: gap.missingTerms,
            draft: gap.draftLanguage,
            status: gap.status,
          }
        : null,
    });
  }),
);

/** GET /api/analysis/:id/runs-history - alias used by the history panel */
analysisRouter.get(
  '/history/all',
  requireAuth,
  asyncHandler(async (req, res) => {
    const a = auth(req);
    const rows = await db
      .select()
      .from(analysisRuns)
      .where(eq(analysisRuns.hospitalId, a.hospitalId))
      .orderBy(desc(analysisRuns.runNumber));
    return ok(res, rows.map(toRunDto));
  }),
);
