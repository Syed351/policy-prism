/**
 * Semantic policy mapping.
 *
 * The deterministic engine compares vocabulary. This one compares meaning: it
 * retrieves the policy sections most semantically related to a requirement,
 * then asks a language model whether those sections actually satisfy it - with
 * the evidence quoted back so a reviewer can check the reasoning.
 *
 * The two are complements, not replacements. Lexical score, negation detection
 * and embedding similarity all feed retrieval and confidence; the coverage
 * determination comes from the model, grounded in retrieved text.
 */

import { CoverageStatus, TH_COV, TH_PAR, TH_TOPIC } from '@policy-prism/shared';
import { env } from '../../config/env';
import { AiError, chatJson, cosine, embedBatch } from './provider';

/* ------------------------------------------------------------------ *
 * The compliance analyst prompt
 * ------------------------------------------------------------------ */

export const COMPLIANCE_SYSTEM_PROMPT = `You are a healthcare regulatory compliance analysis assistant. Your job is to compare a specific regulatory requirement against the provided hospital policy evidence. Do not assume compliance merely because similar words appear. Determine whether the policy actually addresses the requirement. Every conclusion must be supported by the supplied policy evidence. If the evidence is insufficient, say so. Do not invent policy content, regulatory requirements, citations, or evidence. You are not certifying compliance; you are assisting a human reviewer.

How to judge coverage:

- "covered" means the evidence contains a provision that satisfies every material element of the requirement. If the requirement names a timeframe, a frequency, a responsible role or a record, the evidence must address it.
- "partial" means the evidence addresses the subject and some elements, but leaves at least one material element unstated.
- "not_addressed" means the evidence is on the same subject but says nothing that answers the requirement.
- "no_policy" means the evidence is not about this subject at all.
- "contradicted" means the evidence states something incompatible with the requirement - for example permitting what the requirement forbids, or waiving an obligation the requirement imposes.
- "insufficient_evidence" means you cannot tell from what was supplied. Prefer this over guessing.

Rules you must follow:

1. Quote evidence verbatim from the supplied policy text. Never paraphrase into the evidence field, and never quote text that was not supplied.
2. If no supplied evidence supports a conclusion of coverage, you may not answer "covered".
3. Missing provisions must describe what the requirement demands and the policy does not say - not generic advice.
4. Confidence expresses how certain you are given the evidence supplied, not how important the requirement is.
5. Return only JSON matching the requested shape. No prose outside it.`;

/* ------------------------------------------------------------------ *
 * Types
 * ------------------------------------------------------------------ */

export type AiCoverage =
  | 'covered'
  | 'partial'
  | 'not_addressed'
  | 'no_policy'
  | 'contradicted'
  | 'insufficient_evidence';

export interface RetrievedChunk {
  chunkId: number;
  policyId: number;
  policyCode: string;
  policyTitle: string;
  policyVersion: string;
  sectionLabel: string;
  text: string;
  similarity: number;
}

export interface AiEvidence {
  policyId: number;
  policyCode: string;
  policyTitle: string;
  policyVersion: string;
  sectionLabel: string;
  quote: string;
}

export interface AiVerdict {
  status: AiCoverage;
  confidence: number;
  explanation: string;
  evidence: AiEvidence[];
  missingProvisions: string[];
  contradictions: string[];
  /** Gap detail, only requested when the requirement is not fully covered. */
  whatIsCovered?: string;
  whatIsMissing?: string;
  whyInsufficient?: string;
  recommendedChange?: string;
  suggestedPolicyId?: number | null;
}

/** Raw model output before validation. */
interface RawVerdict {
  status?: string;
  confidence?: number | string;
  explanation?: string;
  evidence?: Array<{ chunk_id?: number; quote?: string }>;
  missing_provisions?: string[];
  contradictions?: string[];
  what_is_covered?: string;
  what_is_missing?: string;
  why_insufficient?: string;
  recommended_change?: string;
  suggested_policy_id?: number | null;
}

/* ------------------------------------------------------------------ *
 * Retrieval
 * ------------------------------------------------------------------ */

export interface EmbeddedChunk extends Omit<RetrievedChunk, 'similarity'> {
  embedding: number[];
}

/**
 * Ranks chunks by cosine similarity to the requirement, then keeps the best few
 * while ensuring more than one policy can be represented - a requirement is
 * often answered jointly, and retrieving five chunks of one document would hide
 * that.
 */
export function retrieve(
  requirementEmbedding: number[],
  chunks: EmbeddedChunk[],
  topK = env.AI_RETRIEVAL_K,
): RetrievedChunk[] {
  const scored = chunks
    .map((c) => ({ ...c, similarity: cosine(requirementEmbedding, c.embedding) }))
    .sort((a, b) => b.similarity - a.similarity);

  const picked: RetrievedChunk[] = [];
  const perPolicy = new Map<number, number>();
  const MAX_PER_POLICY = 3;

  for (const c of scored) {
    if (picked.length >= topK) break;
    const used = perPolicy.get(c.policyId) ?? 0;
    if (used >= MAX_PER_POLICY) continue;
    perPolicy.set(c.policyId, used + 1);
    const { embedding: _drop, ...rest } = c;
    picked.push(rest);
  }

  return picked;
}

export async function embedRequirement(text: string): Promise<number[]> {
  const [vec] = await embedBatch([text]);
  if (!vec) throw new AiError('embedding_failed', 'No embedding returned for the requirement');
  return vec;
}

/* ------------------------------------------------------------------ *
 * Evaluation
 * ------------------------------------------------------------------ */

function buildUserPrompt(
  requirement: { framework: string; citation: string; title: string; text: string },
  chunks: RetrievedChunk[],
): string {
  const evidence = chunks
    .map(
      (c) =>
        `--- EVIDENCE chunk_id=${c.chunkId} ---\n` +
        `Policy: ${c.policyCode || c.policyTitle} v${c.policyVersion} — ${c.policyTitle}\n` +
        `Section: ${c.sectionLabel}\n` +
        `Text: ${c.text}`,
    )
    .join('\n\n');

  return `REGULATORY REQUIREMENT
Framework: ${requirement.framework}
Citation: ${requirement.citation}
Title: ${requirement.title}
Text: ${requirement.text}

POLICY EVIDENCE RETRIEVED FROM THIS FACILITY'S LIBRARY
${evidence || '(no policy sections were retrieved for this requirement)'}

Return JSON exactly in this shape:

{
  "status": "covered" | "partial" | "not_addressed" | "no_policy" | "contradicted" | "insufficient_evidence",
  "confidence": 0.0,
  "explanation": "Two or three sentences explaining the determination, referring to the evidence.",
  "evidence": [{ "chunk_id": 0, "quote": "verbatim sentence from that chunk" }],
  "missing_provisions": ["what the requirement demands that the evidence does not state"],
  "contradictions": ["any evidence incompatible with the requirement"],
  "what_is_covered": "what the policy set already addresses, if anything",
  "what_is_missing": "the specific provision absent from the policy",
  "why_insufficient": "why the current coverage does not satisfy the requirement",
  "recommended_change": "the change that would close the gap",
  "suggested_policy_id": null
}

Omit what_is_covered, what_is_missing, why_insufficient and recommended_change when status is "covered".
Set suggested_policy_id to the policy_id of the document that should be amended, or null when none is a suitable home.`;
}

const VALID_STATUS = new Set<AiCoverage>([
  'covered',
  'partial',
  'not_addressed',
  'no_policy',
  'contradicted',
  'insufficient_evidence',
]);

/**
 * Validates the model's answer against the evidence it was given.
 *
 * This is the guard that stops a hallucinated conclusion reaching a reviewer: a
 * quote must actually appear in the chunk it cites, and "covered" without
 * surviving evidence is downgraded rather than trusted.
 */
export function validateVerdict(raw: RawVerdict, chunks: RetrievedChunk[]): AiVerdict {
  const byId = new Map(chunks.map((c) => [c.chunkId, c]));

  const status = (String(raw.status ?? '').toLowerCase() as AiCoverage) || 'insufficient_evidence';
  if (!VALID_STATUS.has(status)) {
    throw new AiError('invalid_response', `Unrecognised coverage status "${raw.status}"`);
  }

  const confidenceRaw = typeof raw.confidence === 'string' ? Number(raw.confidence) : raw.confidence;
  const confidence = Number.isFinite(confidenceRaw)
    ? Math.min(1, Math.max(0, Number(confidenceRaw)))
    : 0.5;

  // Keep only quotes that genuinely appear in the cited chunk. A model that
  // invents supporting text is the failure mode this product cannot tolerate.
  const evidence: AiEvidence[] = [];
  (raw.evidence ?? []).forEach((e) => {
    const chunk = byId.get(Number(e.chunk_id));
    const quote = String(e.quote ?? '').trim();
    if (!chunk || quote.length < 12) return;

    const haystack = normalise(chunk.text);
    if (!haystack.includes(normalise(quote))) return;

    evidence.push({
      policyId: chunk.policyId,
      policyCode: chunk.policyCode,
      policyTitle: chunk.policyTitle,
      policyVersion: chunk.policyVersion,
      sectionLabel: chunk.sectionLabel,
      quote,
    });
  });

  // Rule 2 of the prompt, enforced rather than trusted.
  let finalStatus = status;
  if ((status === 'covered' || status === 'partial') && evidence.length === 0) {
    finalStatus = 'insufficient_evidence';
  }

  return {
    status: finalStatus,
    confidence: finalStatus === status ? confidence : Math.min(confidence, 0.4),
    explanation: String(raw.explanation ?? '').trim() || 'The model returned no explanation.',
    evidence,
    missingProvisions: cleanList(raw.missing_provisions),
    contradictions: cleanList(raw.contradictions),
    whatIsCovered: optional(raw.what_is_covered),
    whatIsMissing: optional(raw.what_is_missing),
    whyInsufficient: optional(raw.why_insufficient),
    recommendedChange: optional(raw.recommended_change),
    suggestedPolicyId:
      typeof raw.suggested_policy_id === 'number' ? raw.suggested_policy_id : null,
  };
}

const normalise = (s: string): string => s.toLowerCase().replace(/\s+/g, ' ').trim();
const optional = (s?: string): string | undefined => {
  const t = String(s ?? '').trim();
  return t ? t : undefined;
};
const cleanList = (l?: string[]): string[] =>
  (Array.isArray(l) ? l : [])
    .map((x) => String(x ?? '').trim())
    .filter((x) => x.length > 3)
    .slice(0, 8);

/** Runs one requirement through the model. Throws AiError on any failure. */
export async function evaluateRequirement(
  requirement: { framework: string; citation: string; title: string; text: string },
  chunks: RetrievedChunk[],
): Promise<AiVerdict> {
  const raw = await chatJson<RawVerdict>({
    system: COMPLIANCE_SYSTEM_PROMPT,
    user: buildUserPrompt(requirement, chunks),
    temperature: 0,
  });
  return validateVerdict(raw, chunks);
}

/* ------------------------------------------------------------------ *
 * Hybrid reconciliation
 * ------------------------------------------------------------------ */

/**
 * Maps the model's verdict onto the product's four coverage classes, using the
 * lexical and embedding signals to decide the two cases the classes do not
 * cover directly.
 *
 * "contradicted" is not a coverage class - a policy that negates a requirement
 * is not covering it - so it becomes a gap carrying the conflict flag, which is
 * how the deterministic engine has always treated it.
 */
export function reconcile(
  ai: AiVerdict,
  signals: { lexicalScore: number; topSimilarity: number; hasTopicalOverlap: boolean },
): { status: CoverageStatus; flags: string[] } {
  const flags: string[] = [];

  if (ai.status === 'contradicted' || ai.contradictions.length > 0) {
    flags.push('conflict');
  }

  switch (ai.status) {
    case 'covered':
      // A confident model with weak lexical support is exactly the case
      // semantic analysis exists for, so the score does not veto it - but a
      // low-confidence "covered" is reported as partial.
      return { status: ai.confidence >= 0.6 ? 'covered' : 'partial', flags };

    case 'partial':
      return { status: 'partial', flags };

    case 'contradicted':
      return { status: 'not_addressed', flags };

    case 'not_addressed':
      return { status: 'not_addressed', flags };

    case 'no_policy':
      // Trust the retrieval over the model here: if nothing came back similar,
      // there genuinely is no policy on the subject.
      return {
        status:
          signals.topSimilarity >= env.AI_TOPICAL_SIMILARITY || signals.hasTopicalOverlap
            ? 'not_addressed'
            : 'no_policy',
        flags,
      };

    case 'insufficient_evidence':
    default:
      flags.push('unproven');
      return {
        status:
          signals.lexicalScore >= TH_COV
            ? 'partial'
            : signals.lexicalScore >= TH_PAR
              ? 'partial'
              : signals.hasTopicalOverlap || signals.lexicalScore >= TH_TOPIC
                ? 'not_addressed'
                : 'no_policy',
        flags,
      };
  }
}
