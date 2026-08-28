/**
 * Human review workflow.
 *
 * The product rule the prototype was built around: an analysis result is a
 * candidate finding, not a compliance finding. It only becomes a finding when a
 * person with the review permission approves or rejects it, and every decision
 * is written to an immutable `reviews` row plus the audit trail.
 */

import { Request, Router } from 'express';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  COVERAGE_LABEL,
  FindingFlag,
  isGap,
  REVIEW_STATUSES,
} from '@policy-prism/shared';
import { db } from '../../db';
import { analysisRuns, gapFindings, policies, policyMappings, regulations, reviews } from '../../db/schema';
import { auth, requireAuth, requirePermission } from '../../middleware/auth';
import { validateBody, validateParams, validateQuery } from '../../middleware/error';
import { safeAudit } from '../../services/audit';
import { ApiError, asyncHandler, created, ok } from '../../utils/http';
import { latestRun } from '../analysis/analysis.service';
import { policyLookup, toMappingDto } from '../analysis/analysis.routes';

export const reviewsRouter = Router();

const idParam = z.object({ id: z.coerce.number().int().positive() });

const listQuery = z.object({
  runId: z.coerce.number().int().positive().optional(),
  status: z.enum([...REVIEW_STATUSES, 'all']).default('pending'),
  framework: z.string().trim().optional(),
  q: z.string().trim().optional(),
  page: z.coerce.number().int().min(0).default(0),
  perPage: z.coerce.number().int().min(1).max(200).default(50),
});

const decisionSchema = z.object({
  comment: z.string().trim().max(4000).optional(),
});

const commentSchema = z.object({
  comment: z.string().trim().min(1, 'A comment is required').max(4000),
});

async function loadMapping(mappingId: number, hospitalId: number) {
  const [row] = await db
    .select({ mapping: policyMappings, regulation: regulations, policy: policies })
    .from(policyMappings)
    .innerJoin(regulations, eq(regulations.id, policyMappings.regulationId))
    .leftJoin(policies, eq(policies.id, policyMappings.policyId))
    .where(and(eq(policyMappings.id, mappingId), eq(policyMappings.hospitalId, hospitalId)))
    .limit(1);
  if (!row) throw ApiError.notFound('Finding not found');
  return row;
}

/**
 * Advice shown next to a pending item: what would have to change for this to
 * become covered. Ported from the prototype's reviewAdvice().
 */
function buildAdvice(
  mapping: typeof policyMappings.$inferSelect,
  regulation: typeof regulations.$inferSelect,
  policy: typeof policies.$inferSelect | null,
  gap: typeof gapFindings.$inferSelect | null,
): { head: string; body: string } | null {
  if (mapping.reviewStatus !== 'pending') return null;

  const flags = (mapping.flags ?? []) as FindingFlag[];
  const conflict = flags.includes('conflict');
  const stale = flags.includes('stale');

  if (mapping.status === 'covered' && !conflict && !stale && !mapping.needsRereview) return null;

  if (conflict) {
    return {
      head: 'Read the policy before deciding',
      body:
        `It uses this requirement\u2019s language in a negative statement (${(mapping.contradictoryTerms ?? [])
          .slice(0, 4)
          .join(', ')}). If it genuinely contradicts the rule, reject the finding and treat it as a rewrite, not a gap.`,
    };
  }
  if (mapping.status === 'covered' && stale) {
    return {
      head: 'Wording is adequate, document is not current',
      body: `Route ${policy ? policy.code || policy.title : 'the policy'} through review and re-approval. No drafting needed.`,
    };
  }
  if (mapping.status === 'covered') {
    return {
      head: 'Confirm the wording actually satisfies the amended text',
      body: 'Open Evidence and check the highlighted terms against the current requirement before approving.',
    };
  }

  const clauses = gap?.uncoveredClauses ?? [];
  const terms = gap?.missingTerms ?? [];
  let body: string;
  if (clauses.length) {
    body = `The policy is silent on: ${clauses[0].slice(0, 150)}${clauses[0].length > 150 ? '\u2026' : ''}`;
  } else if (terms.length) {
    body = `No policy language on: ${terms.slice(0, 5).join(', ')}`;
  } else {
    body = 'The match is too weak to rely on.';
  }

  return {
    head: `${gap?.action ?? 'Revise the policy'}${gap?.policyId && policy ? ` \u2014 ${policy.code || policy.title}` : ''}`,
    body: `${body} Owner: ${gap?.suggestedOwner ?? 'Compliance'}.`,
  };
}

/** GET /api/reviews - the review queue */
reviewsRouter.get(
  '/',
  requireAuth,
  validateQuery(listQuery),
  asyncHandler(async (req, res) => {
    const a = auth(req);
    const q = req.query as unknown as z.infer<typeof listQuery>;

    const runId = q.runId ?? (await latestRun(a.hospitalId))?.id ?? null;
    if (!runId) {
      return ok(res, [], {
        total: 0,
        runId: null,
        tally: { pending: 0, approved: 0, rejected: 0 },
        message: 'Findings appear here once the analysis has run.',
      });
    }

    const all = await db
      .select({ mapping: policyMappings, regulation: regulations, policy: policies })
      .from(policyMappings)
      .innerJoin(regulations, eq(regulations.id, policyMappings.regulationId))
      .leftJoin(policies, eq(policies.id, policyMappings.policyId))
      .where(eq(policyMappings.runId, runId))
      .orderBy(desc(policyMappings.score));

    const tally = {
      pending: all.filter((r) => r.mapping.reviewStatus === 'pending').length,
      approved: all.filter((r) => r.mapping.reviewStatus === 'approved').length,
      rejected: all.filter((r) => r.mapping.reviewStatus === 'rejected').length,
    };

    let rows = all;
    if (q.status !== 'all') rows = rows.filter((r) => r.mapping.reviewStatus === q.status);
    if (q.framework) rows = rows.filter((r) => r.regulation.framework === q.framework);
    if (q.q) {
      const needle = q.q.toLowerCase();
      rows = rows.filter((r) =>
        `${r.regulation.title} ${r.regulation.citation} ${r.policy?.code ?? ''}`.toLowerCase().includes(needle),
      );
    }

    const total = rows.length;
    const paged = rows.slice(q.page * q.perPage, q.page * q.perPage + q.perPage);

    const gaps = await db.select().from(gapFindings).where(eq(gapFindings.runId, runId));
    const gapByMapping = new Map(gaps.map((g) => [g.mappingId, g]));

    const lookup = await policyLookup(a.hospitalId);
    const items = await Promise.all(
      paged.map(async (row) => ({
        ...(await toMappingDto(row, lookup)),
        advice: buildAdvice(row.mapping, row.regulation, row.policy, gapByMapping.get(row.mapping.id) ?? null),
      })),
    );

    return ok(res, items, {
      total,
      page: q.page,
      perPage: q.perPage,
      runId,
      tally,
      frameworks: [...new Set(all.map((r) => r.regulation.framework))],
      rule: 'Analysis findings are not compliance findings until a reviewer confirms them.',
    });
  }),
);

/** GET /api/reviews/:id/history - every decision ever made on this finding */
reviewsRouter.get(
  '/:id/history',
  requireAuth,
  validateParams(idParam),
  asyncHandler(async (req, res) => {
    const a = auth(req);
    await loadMapping(Number(req.params.id), a.hospitalId);

    const rows = await db
      .select()
      .from(reviews)
      .where(eq(reviews.mappingId, Number(req.params.id)))
      .orderBy(desc(reviews.createdAt));

    return ok(
      res,
      rows.map((r) => ({
        id: r.id,
        decision: r.decision,
        comment: r.comment,
        previousStatus: r.previousStatus,
        finalStatus: r.finalStatus,
        coverageStatus: r.coverageStatus,
        score: r.score,
        reviewerName: r.reviewerName,
        reviewerRole: r.reviewerRole,
        createdAt: r.createdAt.toISOString(),
      })),
    );
  }),
);

/** Shared writer for approve / reject / reopen. */
async function decide(
  req: Request,
  kind: 'approved' | 'rejected' | 'reopened',
  comment: string | null,
) {
  const a = auth(req);
  const mappingId = Number(req.params.id);
  const row = await loadMapping(mappingId, a.hospitalId);
  const m = row.mapping;

  const previousStatus = m.reviewStatus;
  const finalStatus = kind === 'reopened' ? 'pending' : kind;

  await db
    .update(policyMappings)
    .set({
      reviewStatus: finalStatus,
      reviewComment: kind === 'reopened' ? null : comment,
      reviewedById: kind === 'reopened' ? null : a.id,
      reviewedByName: kind === 'reopened' ? null : a.name,
      reviewedAt: kind === 'reopened' ? null : new Date(),
      // Confirming the current conclusion clears the re-review flag.
      needsRereview: null,
      updatedAt: new Date(),
    })
    .where(eq(policyMappings.id, mappingId));

  const [review] = await db
    .insert(reviews)
    .values({
      mappingId,
      runId: m.runId,
      reviewerId: a.id,
      reviewerName: a.name,
      reviewerRole: a.roleLabel,
      decision: kind,
      comment,
      previousStatus,
      finalStatus,
      coverageStatus: m.status,
      score: m.score,
    })
    .returning();

  const verb =
    kind === 'approved' ? 'Approved finding' : kind === 'rejected' ? 'Rejected finding' : 'Reopened finding';

  await safeAudit({
    hospitalId: a.hospitalId,
    category: 'review',
    action: verb,
    object: row.regulation.citation,
    detail:
      kind === 'reopened'
        ? `Was ${previousStatus} \u00b7 now pending`
        : `${COVERAGE_LABEL[m.status]} at ${(m.score * 100).toFixed(0)}%` +
          (m.needsRereview ? ' (re-review after change)' : '') +
          (comment ? ` \u00b7 \u201c${comment.slice(0, 80)}\u201d` : ''),
    actor: a,
    ip: req.ip,
  });

  const updated = await loadMapping(mappingId, a.hospitalId);
  return { review, mapping: await toMappingDto(updated) };
}

/** POST /api/reviews/:id/approve */
reviewsRouter.post(
  '/:id/approve',
  requireAuth,
  requirePermission('review'),
  validateParams(idParam),
  validateBody(decisionSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof decisionSchema>;
    const result = await decide(req, 'approved', body.comment?.trim() || null);
    return ok(res, result);
  }),
);

/**
 * POST /api/reviews/:id/reject
 * A rejection always needs a reason - the prototype enforced this in the UI and
 * the rule belongs on the server.
 */
reviewsRouter.post(
  '/:id/reject',
  requireAuth,
  requirePermission('review'),
  validateParams(idParam),
  validateBody(commentSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof commentSchema>;
    const result = await decide(req, 'rejected', body.comment.trim());
    return ok(res, result);
  }),
);

/** POST /api/reviews/:id/reopen - undo a decision, back to pending. */
reviewsRouter.post(
  '/:id/reopen',
  requireAuth,
  requirePermission('review'),
  validateParams(idParam),
  asyncHandler(async (req, res) => {
    const result = await decide(req, 'reopened', null);
    return ok(res, result);
  }),
);

/** POST /api/reviews/:id/comment - annotate without deciding. */
reviewsRouter.post(
  '/:id/comment',
  requireAuth,
  requirePermission('review'),
  validateParams(idParam),
  validateBody(commentSchema),
  asyncHandler(async (req, res) => {
    const a = auth(req);
    const mappingId = Number(req.params.id);
    const row = await loadMapping(mappingId, a.hospitalId);
    const body = req.body as z.infer<typeof commentSchema>;

    const [review] = await db
      .insert(reviews)
      .values({
        mappingId,
        runId: row.mapping.runId,
        reviewerId: a.id,
        reviewerName: a.name,
        reviewerRole: a.roleLabel,
        decision: 'comment',
        comment: body.comment.trim(),
        previousStatus: row.mapping.reviewStatus,
        finalStatus: row.mapping.reviewStatus,
        coverageStatus: row.mapping.status,
        score: row.mapping.score,
      })
      .returning();

    await safeAudit({
      hospitalId: a.hospitalId,
      category: 'review',
      action: 'Commented on finding',
      object: row.regulation.citation,
      detail: body.comment.slice(0, 200),
      actor: a,
      ip: req.ip,
    });

    return created(res, {
      id: review.id,
      comment: review.comment,
      reviewerName: review.reviewerName,
      createdAt: review.createdAt.toISOString(),
    });
  }),
);

/** GET /api/reviews/summary - counts for the nav badge and dashboard. */
reviewsRouter.get(
  '/summary',
  requireAuth,
  asyncHandler(async (req, res) => {
    const a = auth(req);
    const run = await latestRun(a.hospitalId);
    if (!run) return ok(res, { pending: 0, approved: 0, rejected: 0, needsRereview: 0, runId: null });

    const rows = await db.select().from(policyMappings).where(eq(policyMappings.runId, run.id));
    return ok(res, {
      runId: run.id,
      pending: rows.filter((r) => r.reviewStatus === 'pending').length,
      approved: rows.filter((r) => r.reviewStatus === 'approved').length,
      rejected: rows.filter((r) => r.reviewStatus === 'rejected').length,
      needsRereview: rows.filter((r) => !!r.needsRereview).length,
      gaps: rows.filter((r) => isGap(r.status)).length,
    });
  }),
);

export async function reviewsForRun(runId: number) {
  return db
    .select({ review: reviews, regulation: regulations })
    .from(reviews)
    .innerJoin(policyMappings, eq(policyMappings.id, reviews.mappingId))
    .innerJoin(regulations, eq(regulations.id, policyMappings.regulationId))
    .where(eq(reviews.runId, runId))
    .orderBy(desc(reviews.createdAt));
}

export async function runExists(runId: number, hospitalId: number) {
  const [r] = await db
    .select()
    .from(analysisRuns)
    .where(and(eq(analysisRuns.id, runId), eq(analysisRuns.hospitalId, hospitalId)))
    .limit(1);
  return !!r;
}
