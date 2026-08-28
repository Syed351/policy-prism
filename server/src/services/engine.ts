/**
 * Policy Prism matching engine.
 *
 * This is a direct, behaviour-preserving port of the scoring logic that ran in
 * the browser prototype. Same stop list, same stemming, same IDF weighting,
 * same negation window, same thresholds - so a corpus that scored 62% in the
 * prototype scores 62% here.
 *
 * What it is: a lexical coverage assessment. It measures how much of a
 * requirement's vocabulary a policy actually uses, weighted by how distinctive
 * each term is across the corpus, and it notices when the policy uses that
 * vocabulary inside a negation.
 *
 * What it is NOT: a legal opinion. Every result is a candidate finding that a
 * human has to confirm.
 */

import {
  CoverageStatus,
  FindingFlag,
  REVIEW_MONTHS,
  TH_COV,
  TH_EDGE,
  TH_PAR,
  TH_TOPIC,
  NEG_SPAN,
} from '@policy-prism/shared';

/* ------------------------------------------------------------------ *
 * Tokenisation
 * ------------------------------------------------------------------ */

const STOP = new Set(
  (
    'a an the and or of to in for on at by with from as is are be been being must shall may can ' +
    'will would should each any all other such that this these those it its his her their our ' +
    'your if then than there when whether within into upon per about over under between during ' +
    'including include includes provide provided providing use used using ensure ensures which ' +
    'who whom what where how'
  ).split(' '),
);

const NEG_CUE = /^(not|no|nor|never|without|except|excluding|excluded|exempt|exempted|prohibited|unnecessary|neither)$/;

const stem = (w: string): string => w.replace(/ies$/, 'y').replace(/(ing|ed|es|s)$/, '');

/** Content tokens, stemmed, stop words removed. */
export function tok(s: unknown): string[] {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w))
    .map(stem);
}

export interface TokenScope {
  pos: Set<string>;
  neg: Set<string>;
}

/**
 * Tokenise while tracking negation, so we can tell "must document" apart from
 * "need not document". Any content word within NEG_SPAN tokens of a negation
 * cue lands in `neg` instead of `pos`.
 */
export function tokScope(text: unknown): TokenScope {
  const raw = String(text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  const pos = new Set<string>();
  const neg = new Set<string>();
  let countdown = 0;

  for (let i = 0; i < raw.length; i++) {
    const w = raw[i];
    if (NEG_CUE.test(w) || (w === 'need' && raw[i + 1] === 'not')) {
      countdown = NEG_SPAN;
      continue;
    }
    if (w.length <= 2 || STOP.has(w)) {
      if (countdown > 0) countdown--;
      continue;
    }
    const t = stem(w);
    if (countdown > 0) {
      neg.add(t);
      countdown--;
    } else {
      pos.add(t);
    }
  }
  return { pos, neg };
}

/* ------------------------------------------------------------------ *
 * Scoring
 * ------------------------------------------------------------------ */

export type Idf = Record<string, number>;

/** Inverse document frequency over the whole corpus (requirements + policies). */
export function buildIdf(docs: string[]): Idf {
  const df: Record<string, number> = {};
  const N = docs.length;
  const idf: Idf = {};
  docs.forEach((d) => {
    new Set(tok(d)).forEach((w) => {
      df[w] = (df[w] || 0) + 1;
    });
  });
  Object.keys(df).forEach((w) => {
    idf[w] = Math.log((N + 1) / (df[w] + 0.5));
  });
  return idf;
}

export interface ScoreResult {
  score: number;
  matched: string[];
  missing: string[];
  contra: string[];
}

/**
 * Weighted recall of the requirement's vocabulary inside the policy.
 * Terms found under a negation are reported as contradictions rather than hits.
 */
export function scoreSets(requirementTerms: string[], policy: TokenScope, idf: Idf): ScoreResult {
  let tot = 0;
  let hit = 0;
  const matched: string[] = [];
  const missing: string[] = [];
  const contra: string[] = [];

  for (let i = 0; i < requirementTerms.length; i++) {
    const w = requirementTerms[i];
    const wt = idf[w] ?? 1.6;
    tot += wt;
    if (policy.pos.has(w)) {
      hit += wt;
      matched.push(w);
    } else if (policy.neg.has(w)) {
      contra.push(w);
    } else if (wt > 1.4 && missing.length < 8) {
      missing.push(w);
    }
  }
  return { score: tot ? hit / tot : 0, matched, missing, contra };
}

export function scorePair(requirementText: string, policyText: string, idf: Idf): ScoreResult {
  return scoreSets([...new Set(tok(requirementText))], tokScope(policyText), idf);
}

/** Map a raw score onto the four coverage classes. */
export function classify(score: number, topical: boolean): CoverageStatus {
  if (score >= TH_COV) return 'covered';
  if (score >= TH_PAR) return 'partial';
  return topical || score >= TH_TOPIC ? 'not_addressed' : 'no_policy';
}

/* ------------------------------------------------------------------ *
 * Engine inputs and outputs
 * ------------------------------------------------------------------ */

export interface EngineRegulation {
  id: number;
  framework: string;
  citation: string;
  title: string;
  requirementText: string;
}

export interface EnginePolicy {
  id: number;
  code: string;
  title: string;
  owner: string;
  version: string;
  effectiveDate: string | null;
  text: string;
}

export interface PriorDecision {
  regulationId: number;
  policyId: number | null;
  score: number;
  status: CoverageStatus;
  reviewStatus: 'pending' | 'approved' | 'rejected';
  comment: string | null;
  reviewedByName: string | null;
  needsRereview: { review: string; by: string; comment: string; was: string } | null;
}

export interface EngineMapping {
  regulationId: number;
  policyId: number | null;
  score: number;
  status: CoverageStatus;
  matched: string[];
  missing: string[];
  contra: string[];
  flags: FindingFlag[];
  joint: { score: number; policyIds: number[] } | null;
  alternatives: Array<{ policyId: number; score: number }>;
  reviewStatus: 'pending' | 'approved' | 'rejected';
  comment: string | null;
  reviewedByName: string | null;
  needsRereview: { review: string; by: string; comment: string; was: string } | null;
}

export interface PolicyHit {
  regulationId: number;
  score: number;
  status: CoverageStatus;
  missing: string[];
  contra: string[];
  best: boolean;
}

export interface EngineResult {
  mappings: EngineMapping[];
  byPolicy: Record<number, PolicyHit[]>;
  comparisons: number;
}

const COVERAGE_LABEL_SHORT: Record<CoverageStatus, string> = {
  covered: 'Covered',
  partial: 'Partial',
  not_addressed: 'Not addressed',
  no_policy: 'No policy',
};

/** Whole months since a date, or null if unparseable. */
export function monthsSince(d: string | null | undefined): number | null {
  if (!d) return null;
  const t = Date.parse(d);
  if (Number.isNaN(t)) return null;
  return Math.round((Date.now() - t) / (1000 * 60 * 60 * 24 * 30.44));
}

/* ------------------------------------------------------------------ *
 * analyze()
 * ------------------------------------------------------------------ */

export interface AnalyzeInput {
  /** Requirements in scope for this facility, already filtered by applicability. */
  scopeRegulations: EngineRegulation[];
  /** Requirements the user narrowed the run to (subset of scopeRegulations). */
  selectedRegulations: EngineRegulation[];
  /** Regulatory-scope policies the run may match against. */
  selectedPolicies: EnginePolicy[];
  /** Every policy in the library - used only to build a stable IDF. */
  corpusPolicies: EnginePolicy[];
  /** When only policies were picked, derive the requirement set from them. */
  policyScoped: boolean;
  /** Decisions carried forward from the previous run. */
  priorDecisions: Map<number, PriorDecision>;
}

export function analyze(input: AnalyzeInput): EngineResult {
  const {
    scopeRegulations,
    selectedRegulations,
    selectedPolicies,
    corpusPolicies,
    policyScoped,
    priorDecisions,
  } = input;

  const idf = buildIdf([
    ...scopeRegulations.map((r) => r.requirementText),
    ...corpusPolicies.map((p) => p.text),
  ]);

  const ptok = selectedPolicies.map((p) => ({ policyId: p.id, sets: tokScope(p.text) }));
  const policyById = new Map(selectedPolicies.map((p) => [p.id, p]));

  // When the user picked policies but no requirements, restrict the universe to
  // the requirements those policies actually speak to.
  let scope = selectedRegulations;
  if (policyScoped && ptok.length) {
    const narrowed = selectedRegulations.filter((r) => {
      const rt = [...new Set(tok(r.requirementText))];
      for (let i = 0; i < ptok.length; i++) {
        if (scoreSets(rt, ptok[i].sets, idf).score >= TH_TOPIC) return true;
      }
      return false;
    });
    scope = narrowed.length ? narrowed : selectedRegulations;
  }

  const byPolicy: Record<number, PolicyHit[]> = {};
  selectedPolicies.forEach((p) => {
    byPolicy[p.id] = [];
  });

  const mappings: EngineMapping[] = scope.map((r) => {
    const rt = [...new Set(tok(r.requirementText))];

    const ranked = ptok
      .map((pt) => ({ policyId: pt.policyId, ...scoreSets(rt, pt.sets, idf) }))
      .sort((a, b) => b.score - a.score);

    ranked.forEach((x, xi) => {
      if (x.score >= TH_TOPIC) {
        byPolicy[x.policyId].push({
          regulationId: r.id,
          score: x.score,
          status: classify(x.score, true),
          missing: x.missing,
          contra: x.contra,
          best: xi === 0,
        });
      }
    });

    const best =
      ranked[0] ?? { policyId: null as number | null, score: 0, matched: [], missing: [], contra: [] };

    const prev = priorDecisions.get(r.id);
    const keep = !!prev && prev.policyId === best.policyId && Math.abs(prev.score - best.score) < 0.001;
    const topical = best.score >= TH_TOPIC;
    const status = classify(best.score, topical);
    const flags: FindingFlag[] = [];

    // Coverage spread across several policies, which one-best-match would miss.
    let joint: { score: number; policyIds: number[] } | null = null;
    if (status !== 'covered' && ranked.length > 1) {
      const union: TokenScope = { pos: new Set(), neg: new Set() };
      const top = ranked.slice(0, 3).filter((x) => x.score >= TH_TOPIC);
      top.forEach((x) => {
        const st = ptok.find((z) => z.policyId === x.policyId)!.sets;
        st.pos.forEach((w) => union.pos.add(w));
        st.neg.forEach((w) => union.neg.add(w));
      });
      if (top.length > 1) {
        const cs = scoreSets(rt, union, idf);
        if (cs.score >= TH_COV) {
          joint = { score: cs.score, policyIds: top.map((x) => x.policyId) };
          flags.push('joint');
        }
      }
    }

    if (best.contra && best.contra.length) flags.push('conflict');
    if (Math.abs(best.score - TH_COV) < TH_EDGE || Math.abs(best.score - TH_PAR) < TH_EDGE) {
      flags.push('borderline');
    }

    const matchedPolicy = best.policyId != null ? policyById.get(best.policyId) : undefined;
    if (matchedPolicy && status !== 'no_policy') {
      const age = monthsSince(matchedPolicy.effectiveDate);
      if (age !== null && age > REVIEW_MONTHS) flags.push('stale');
      if (
        !matchedPolicy.owner ||
        matchedPolicy.owner === 'Unassigned' ||
        !matchedPolicy.version ||
        !matchedPolicy.effectiveDate
      ) {
        flags.push('unproven');
      }
    }

    // A decision that no longer describes the current conclusion is surfaced
    // for re-review rather than silently carried forward.
    const needsRereview = keep
      ? prev!.needsRereview ?? null
      : prev && prev.reviewStatus !== 'pending'
        ? {
            review: prev.reviewStatus,
            by: prev.reviewedByName ?? '',
            comment: prev.comment ?? '',
            was: COVERAGE_LABEL_SHORT[prev.status],
          }
        : null;

    return {
      regulationId: r.id,
      policyId: best.policyId ?? null,
      score: best.score,
      status,
      matched: best.matched,
      missing: best.missing,
      contra: best.contra ?? [],
      flags,
      joint,
      alternatives: ranked.slice(1, 4).map((x) => ({ policyId: x.policyId, score: x.score })),
      reviewStatus: keep ? prev!.reviewStatus : 'pending',
      comment: keep ? prev!.comment : null,
      reviewedByName: keep ? prev!.reviewedByName : null,
      needsRereview,
    };
  });

  Object.keys(byPolicy).forEach((k) => {
    byPolicy[Number(k)].sort((a, b) => b.score - a.score);
  });

  return {
    mappings,
    byPolicy,
    comparisons: scope.length * selectedPolicies.length,
  };
}
