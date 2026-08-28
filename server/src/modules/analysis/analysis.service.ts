/**
 * Analysis orchestration.
 *
 * Loads the in-scope corpus, runs the matching engine, and persists the result
 * as an immutable run: an `analysis_runs` row, one `policy_mappings` row per
 * requirement, and a `gap_findings` row for every requirement that is not
 * covered. Review decisions from the previous run are carried forward only when
 * the conclusion is unchanged - otherwise the finding returns to the queue.
 */

import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  CoverageCounts,
  CoverageStatus,
  FindingFlag,
  isGap,
  RunScopeKind,
} from '@policy-prism/shared';
import { db } from '../../db';
import {
  analysisRuns,
  gapFindings,
  policies,
  policyMappings,
  regulations,
} from '../../db/schema';
import type { AuthContext } from '../../middleware/auth';
import { safeAudit } from '../../services/audit';
import { aiConfigured } from '../../services/ai/provider';
import {
  analyseSemantically,
  embedRequirements,
  fallbackMessage,
  indexPolicies,
  reconcile,
} from '../../services/ai';
import { env } from '../../config/env';
import { analyze, EnginePolicy, EngineRegulation, PriorDecision } from '../../services/engine';
import { getProfile, toScopeProfile } from '../../services/hospital';
import { remediate } from '../../services/remediation';
import {
  applies,
  profileSignature,
  ProfileSignature,
  scopeDiff,
  signaturesMatch,
} from '../../services/scope';
import { ApiError } from '../../utils/http';

export interface RunOptions {
  trigger?: string;
  regulationIds?: number[];
  policyIds?: number[];
  /** When only policies are selected, narrow requirements to what they speak to. */
  policyScoped?: boolean;
}

/** The prototype's runLabel(). */
function runLabel(kind: RunScopeKind, requirements: number, policyCount: number): string {
  return kind === 'full'
    ? `Full library \u00b7 ${requirements} requirements`
    : `Selection \u00b7 ${policyCount} polic${policyCount === 1 ? 'y' : 'ies'}, ${requirements} requirements`;
}

/** Stable key describing the selection, so scope changes are detectable. */
function selectionKey(regIds: number[] | null, polIds: number[] | null, policyScoped: boolean): string {
  if (!regIds && !polIds) return 'all';
  const derived = polIds && !regIds && policyScoped ? 'derived|' : '';
  return `sel:${derived}${(regIds ?? []).join(',')}|${(polIds ?? []).join(',')}`;
}

export function tallyCounts(
  rows: Array<{
    status: CoverageStatus;
    flags: string[];
    reviewStatus: string;
    needsRereview: unknown;
  }>,
): CoverageCounts {
  const c = { covered: 0, partial: 0, not_addressed: 0, no_policy: 0 };
  rows.forEach((r) => {
    c[r.status] += 1;
  });
  const gap = c.not_addressed + c.no_policy;
  const total = rows.length;
  return {
    ...c,
    gap,
    open: gap + c.partial,
    conflict: rows.filter((r) => r.flags.includes('conflict')).length,
    stale: rows.filter((r) => r.flags.includes('stale')).length,
    total,
    coveragePct: total ? Math.round((c.covered / total) * 100) : 0,
    reviewed: rows.filter((r) => r.reviewStatus !== 'pending').length,
    pending: rows.filter((r) => r.reviewStatus === 'pending').length,
    approved: rows.filter((r) => r.reviewStatus === 'approved').length,
    rejected: rows.filter((r) => r.reviewStatus === 'rejected').length,
    needsRereview: rows.filter((r) => !!r.needsRereview).length,
  };
}

export async function latestRun(hospitalId: number) {
  const [row] = await db
    .select()
    .from(analysisRuns)
    .where(and(eq(analysisRuns.hospitalId, hospitalId), eq(analysisRuns.status, 'completed')))
    .orderBy(desc(analysisRuns.runNumber))
    .limit(1);
  return row ?? null;
}

/** Decisions from the previous run, keyed by requirement. */
async function loadPriorDecisions(runId: number | null): Promise<Map<number, PriorDecision>> {
  const map = new Map<number, PriorDecision>();
  if (!runId) return map;

  const rows = await db.select().from(policyMappings).where(eq(policyMappings.runId, runId));
  rows.forEach((r) => {
    map.set(r.regulationId, {
      regulationId: r.regulationId,
      policyId: r.policyId,
      score: r.score,
      status: r.status,
      reviewStatus: r.reviewStatus,
      comment: r.reviewComment,
      reviewedByName: r.reviewedByName,
      needsRereview: r.needsRereview ?? null,
    });
  });
  return map;
}

export async function runAnalysis(
  actor: AuthContext,
  options: RunOptions,
  ip?: string,
): Promise<{ runId: number }> {
  const started = Date.now();
  const hospitalId = actor.hospitalId;

  const profile = await getProfile(hospitalId);
  const scopeProfile = toScopeProfile(profile);

  const [allRegs, allPolicies] = await Promise.all([
    db.select().from(regulations).where(eq(regulations.hospitalId, hospitalId)),
    db.select().from(policies).where(eq(policies.hospitalId, hospitalId)),
  ]);

  if (!allPolicies.length) {
    throw ApiError.badRequest('Load at least one policy before running the analysis.');
  }

  const inScope = allRegs.filter((r) => applies(r, scopeProfile));
  if (!inScope.length) {
    throw ApiError.badRequest(
      'No requirements are in scope for this facility profile. Check the profile or add requirements.',
    );
  }

  // Only regulatory-scope policies are matched. Operational and governance
  // documents stay in the library and are never force-mapped to a citation.
  const regulatoryPolicies = allPolicies.filter((p) => p.scope === 'regulatory');
  if (!regulatoryPolicies.length) {
    throw ApiError.badRequest(
      'No regulatory-scope policies exist. Operational and governance policies are never mapped to citations.',
    );
  }

  const regIds = options.regulationIds?.length ? options.regulationIds : null;
  const polIds = options.policyIds?.length ? options.policyIds : null;

  const selectedRegs = regIds ? inScope.filter((r) => regIds.includes(r.id)) : inScope;
  const selectedPols = polIds
    ? regulatoryPolicies.filter((p) => polIds.includes(p.id))
    : regulatoryPolicies;

  if (regIds && !selectedRegs.length) {
    throw ApiError.badRequest('Your requirement selection is empty. Clear it or select at least one.');
  }
  if (polIds && !selectedPols.length) {
    throw ApiError.badRequest('Your policy selection is empty. Clear it or select at least one.');
  }

  const policyScoped = options.policyScoped !== false && !!polIds && !regIds;
  const scopeKind: RunScopeKind = regIds || polIds ? 'selection' : 'full';

  const toEngineReg = (r: typeof regulations.$inferSelect): EngineRegulation => ({
    id: r.id,
    framework: r.framework,
    citation: r.citation,
    title: r.title,
    requirementText: r.requirementText,
  });
  const toEnginePol = (p: typeof policies.$inferSelect): EnginePolicy => ({
    id: p.id,
    code: p.code,
    title: p.title,
    owner: p.owner,
    version: p.version,
    effectiveDate: p.effectiveDate,
    text: p.text,
  });

  const previous = await latestRun(hospitalId);
  const priorDecisions = await loadPriorDecisions(previous?.id ?? null);

  const result = analyze({
    scopeRegulations: inScope.map(toEngineReg),
    selectedRegulations: selectedRegs.map(toEngineReg),
    selectedPolicies: selectedPols.map(toEnginePol),
    corpusPolicies: allPolicies.map(toEnginePol),
    policyScoped,
    priorDecisions,
  });

  /* ---- semantic layer -------------------------------------------
   * The deterministic result above is the baseline and the fallback. Where
   * the AI layer is available it supersedes the coverage determination for
   * that requirement, carrying its evidence; where it is not, the lexical
   * result stands and the finding says so.                              */
  const semantic = await runSemanticLayer(hospitalId, selectedRegs, allPolicies, result.mappings);

  const durationMs = Date.now() - started;

  // ---- scope comparability -------------------------------------------
  const signature = profileSignature(scopeProfile, selectionKey(regIds, polIds, policyScoped));
  const prevSignature = (previous?.profileSignature as unknown as ProfileSignature) ?? null;
  const scopeChanged = previous ? !signaturesMatch(prevSignature, signature) : false;
  const diff = previous && scopeChanged ? scopeDiff(prevSignature, signature) : '';

  // Apply the semantic verdict to the in-memory mappings before tallying, so
  // the run's headline numbers match what is stored.
  result.mappings.forEach((m) => {
    const s = semantic.get(m.regulationId);
    if (s?.status) {
      m.status = s.status;
      s.extraFlags.forEach((f) => {
        if (!m.flags.includes(f as (typeof m.flags)[number])) {
          m.flags.push(f as (typeof m.flags)[number]);
        }
      });
    }
  });

  const aiEvaluated = [...semantic.values()].filter((v) => v.analysisMethod === 'semantic').length;
  const aiFailed = semantic.size - aiEvaluated;

  const counts = tallyCounts(
    result.mappings.map((m) => ({
      status: m.status,
      flags: m.flags,
      reviewStatus: m.reviewStatus,
      needsRereview: m.needsRereview,
    })),
  );

  const previousGaps = previous ? previous.notAddressed + previous.noPolicy : null;

  // ---- persist --------------------------------------------------------
  const runId = await db.transaction(async (tx) => {
    const [maxRow] = await tx
      .select({ maxNumber: sql<number>`COALESCE(MAX(${analysisRuns.runNumber}), 0)::int` })
      .from(analysisRuns)
      .where(eq(analysisRuns.hospitalId, hospitalId));

    const runNumber = Number(maxRow?.maxNumber ?? 0) + 1;

    const [run] = await tx
      .insert(analysisRuns)
      .values({
        hospitalId,
        runNumber,
        status: 'completed',
        trigger: options.trigger || 'Manual run',
        scopeKind,
        label: runLabel(scopeKind, result.mappings.length, selectedPols.length),
        facilityName: profile.name,
        requirementCount: result.mappings.length,
        policyCount: selectedPols.length,
        comparisons: result.comparisons,
        covered: counts.covered,
        partial: counts.partial,
        notAddressed: counts.not_addressed,
        noPolicy: counts.no_policy,
        coveragePct: counts.coveragePct,
        durationMs,
        analysisMethod: aiEvaluated > 0 ? 'semantic' : 'deterministic',
        aiModel: aiEvaluated > 0 ? env.AI_CHAT_MODEL : null,
        aiEvaluated,
        aiFailed,
        profileSignature: signature as unknown as Record<string, unknown>,
        scopeChanged,
        scopeDiff: diff || null,
        coverageDelta: previous && !scopeChanged ? counts.coveragePct - previous.coveragePct : null,
        gapDelta:
          previous && !scopeChanged && previousGaps !== null ? counts.gap - previousGaps : null,
        selectedRegulationIds: regIds,
        selectedPolicyIds: polIds,
        policyScoped,
        runById: actor.id,
        runByName: actor.name,
      })
      .returning();

    const regById = new Map(allRegs.map((r) => [r.id, r]));
    const polById = new Map(allPolicies.map((p) => [p.id, p]));

    const mappingRows = await tx
      .insert(policyMappings)
      .values(
        result.mappings.map((m) => ({
          runId: run.id,
          hospitalId,
          regulationId: m.regulationId,
          policyId: m.policyId,
          score: m.score,
          status: m.status,
          matchedTerms: m.matched,
          missingTerms: m.missing,
          contradictoryTerms: m.contra,
          flags: m.flags,
          alternatives: m.alternatives,
          joint: m.joint,
          reviewStatus: m.reviewStatus,
          reviewComment: m.comment,
          reviewedByName: m.reviewedByName,
          reviewedAt: m.reviewStatus !== 'pending' ? new Date() : null,
          needsRereview: m.needsRereview,
          ...(semantic.get(m.regulationId) ?? {}),
        })),
      )
      .returning();

    // ---- derive gap findings + remediation plans ----------------------
    const gapRows = mappingRows
      .filter((m) => m.status !== 'covered')
      .map((m) => {
        const reg = regById.get(m.regulationId)!;
        const pol = m.policyId ? polById.get(m.policyId) ?? null : null;

        const plan = remediate(
          {
            status: m.status,
            score: m.score,
            missing: m.missingTerms,
            flags: m.flags as FindingFlag[],
          },
          {
            framework: reg.framework,
            citation: reg.citation,
            title: reg.title,
            requirementText: reg.requirementText,
          },
          pol
            ? {
                id: pol.id,
                code: pol.code,
                title: pol.title,
                owner: pol.owner,
                version: pol.version,
              }
            : null,
          profile.name,
        );

        return {
          runId: run.id,
          hospitalId,
          mappingId: m.id,
          regulationId: m.regulationId,
          policyId: plan.targetPolicyId,
          coverageStatus: m.status,
          score: m.score,
          priority: plan.priority,
          action: plan.action,
          effort: plan.effort,
          suggestedOwner: plan.owner,
          risk: plan.risk,
          missingTerms: plan.missingTerms,
          uncoveredClauses: plan.uncoveredClauses,
          steps: plan.steps,
          flags: m.flags,
          draftLanguage: plan.draft,
          status: 'open' as const,
        };
      });

    if (gapRows.length) {
      await tx.insert(gapFindings).values(gapRows);
    }

    return run.id;
  });

  await safeAudit({
    hospitalId,
    category: 'analysis',
    action: 'Analysis run',
    object: `${result.mappings.length} reqs \u00d7 ${selectedPols.length} policies`,
    detail:
      `${counts.covered} covered, ${counts.partial} partial, ${counts.gap} gaps \u00b7 ` +
      `${result.comparisons.toLocaleString()} comparisons in ${durationMs} ms` +
      (scopeChanged ? ` \u00b7 scope changed: ${diff}` : ''),
    actor,
    ip,
  });

  return { runId };
}

/** Requirements the run did not include, e.g. when a selection narrowed it. */
export async function excludedRegulationIds(runId: number, hospitalId: number): Promise<number[]> {
  const [included, all] = await Promise.all([
    db.select({ id: policyMappings.regulationId }).from(policyMappings).where(eq(policyMappings.runId, runId)),
    db.select({ id: regulations.id }).from(regulations).where(eq(regulations.hospitalId, hospitalId)),
  ]);
  const seen = new Set(included.map((r) => r.id));
  return all.map((r) => r.id).filter((id) => !seen.has(id));
}

export async function assertRunBelongs(runId: number, hospitalId: number) {
  const [run] = await db
    .select()
    .from(analysisRuns)
    .where(and(eq(analysisRuns.id, runId), eq(analysisRuns.hospitalId, hospitalId)))
    .limit(1);
  if (!run) throw ApiError.notFound('Analysis run not found');
  return run;
}

export async function mappingsForRun(runId: number) {
  return db
    .select({
      mapping: policyMappings,
      regulation: regulations,
      policy: policies,
    })
    .from(policyMappings)
    .innerJoin(regulations, eq(regulations.id, policyMappings.regulationId))
    .leftJoin(policies, eq(policies.id, policyMappings.policyId))
    .where(eq(policyMappings.runId, runId))
    .orderBy(asc(policyMappings.score));
}

export function gapCount(counts: CoverageCounts): number {
  return counts.gap;
}

export const statusIsGap = isGap;

export async function runsForHospital(hospitalId: number, limit = 20) {
  return db
    .select()
    .from(analysisRuns)
    .where(eq(analysisRuns.hospitalId, hospitalId))
    .orderBy(desc(analysisRuns.runNumber))
    .limit(limit);
}

export async function regulationsByIds(ids: number[]) {
  if (!ids.length) return [];
  return db.select().from(regulations).where(inArray(regulations.id, ids));
}

/* ------------------------------------------------------------------ *
 * Semantic layer
 * ------------------------------------------------------------------ */

interface SemanticFields {
  analysisMethod: 'semantic' | 'deterministic';
  aiStatus: string | null;
  aiConfidence: number | null;
  aiExplanation: string | null;
  aiEvidence: Array<Record<string, unknown>> | null;
  aiMissingProvisions: string[] | null;
  aiContradictions: string[] | null;
  aiModel: string | null;
  semanticScore: number | null;
  aiFallbackReason: string | null;
  /** Applied to the mapping before tallying, so counts match what is stored. */
  status?: CoverageStatus;
  extraFlags: string[];
}

/**
 * Runs semantic analysis over the requirements in this run.
 *
 * Indexing failures are fatal to the whole layer - without embeddings there is
 * no retrieval - but a failure on a single requirement is not, so one bad
 * response cannot cost the run its other results.
 */
async function runSemanticLayer(
  hospitalId: number,
  regs: Array<typeof regulations.$inferSelect>,
  pols: Array<typeof policies.$inferSelect>,
  mappings: Array<{ regulationId: number; score: number; status: CoverageStatus }>,
): Promise<Map<number, SemanticFields>> {
  const out = new Map<number, SemanticFields>();

  const unavailable = (reason: string): Map<number, SemanticFields> => {
    regs.forEach((r) =>
      out.set(r.id, {
        analysisMethod: 'deterministic',
        aiStatus: null,
        aiConfidence: null,
        aiExplanation: null,
        aiEvidence: null,
        aiMissingProvisions: null,
        aiContradictions: null,
        aiModel: null,
        semanticScore: null,
        aiFallbackReason: reason,
        extraFlags: [],
      }),
    );
    return out;
  };

  if (!aiConfigured()) {
    return unavailable('Deterministic analysis \u2014 AI semantic analysis not configured');
  }

  let corpus;
  let requirementVectors;
  try {
    const regulatory = pols.filter((p) => p.scope === 'regulatory');
    corpus = await indexPolicies(hospitalId, regulatory);
    requirementVectors = await embedRequirements(hospitalId, regs);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[ai] indexing failed: ${(err as Error).message}`);
    return unavailable(fallbackMessage(err));
  }

  const byRegulation = new Map(mappings.map((m) => [m.regulationId, m]));

  // Bounded concurrency: enough to be quick, low enough to respect rate limits.
  const queue = [...regs];
  const workers = Array.from({ length: Math.min(env.AI_CONCURRENCY, queue.length) }, async () => {
    for (;;) {
      const reg = queue.shift();
      if (!reg) return;

      const lexical = byRegulation.get(reg.id);
      const outcome = await analyseSemantically(reg, requirementVectors.get(reg.id), corpus);

      if (!outcome.available) {
        out.set(reg.id, {
          analysisMethod: 'deterministic',
          aiStatus: null,
          aiConfidence: null,
          aiExplanation: null,
          aiEvidence: null,
          aiMissingProvisions: null,
          aiContradictions: null,
          aiModel: null,
          semanticScore: null,
          aiFallbackReason: outcome.reason,
          extraFlags: [],
        });
        continue;
      }

      const { verdict, retrieved, topSimilarity, model } = outcome;
      const { status, flags } = reconcile(verdict, {
        lexicalScore: lexical?.score ?? 0,
        topSimilarity,
        hasTopicalOverlap: (lexical?.status ?? 'no_policy') !== 'no_policy',
      });

      out.set(reg.id, {
        analysisMethod: 'semantic',
        aiStatus: verdict.status,
        aiConfidence: verdict.confidence,
        aiExplanation: verdict.explanation,
        aiEvidence: verdict.evidence as unknown as Array<Record<string, unknown>>,
        aiMissingProvisions: verdict.missingProvisions,
        aiContradictions: verdict.contradictions,
        aiModel: model,
        semanticScore: topSimilarity,
        aiFallbackReason: null,
        status,
        extraFlags: flags,
      });
    }
  });

  await Promise.all(workers);
  return out;
}
