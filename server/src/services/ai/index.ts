/**
 * Orchestration: index policies, retrieve evidence, evaluate, fall back.
 *
 * This is the layer the analysis run calls. It owns the decision about whether
 * a semantic result is available, and guarantees that a failure anywhere -
 * missing key, timeout, rate limit, bad JSON - degrades to the deterministic
 * engine with the reason recorded rather than failing the run.
 */

import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../../db';
import { policies, policyChunks, regulationEmbeddings } from '../../db/schema';
import { env } from '../../config/env';
import { AiError, aiConfigured, embedBatch } from './provider';
import { chunkFingerprint, chunkPolicy } from './chunking';
import {
  AiVerdict,
  EmbeddedChunk,
  RetrievedChunk,
  embedRequirement,
  evaluateRequirement,
  reconcile,
  retrieve,
} from './semantic';

export interface SemanticResult {
  available: true;
  verdict: AiVerdict;
  retrieved: RetrievedChunk[];
  topSimilarity: number;
  model: string;
}

export interface SemanticUnavailable {
  available: false;
  reason: string;
}

export type SemanticOutcome = SemanticResult | SemanticUnavailable;

/** A short, human-readable reason for the banner shown next to a finding. */
export function fallbackMessage(err: unknown): string {
  if (err instanceof AiError) {
    switch (err.reason) {
      case 'not_configured':
        return 'Deterministic analysis \u2014 AI semantic analysis not configured';
      case 'missing_api_key':
        return 'Deterministic analysis \u2014 AI provider rejected the API key';
      case 'timeout':
        return 'Deterministic analysis \u2014 AI provider timed out';
      case 'rate_limited':
        return 'Deterministic analysis \u2014 AI provider rate limit reached';
      case 'model_unavailable':
        return 'Deterministic analysis \u2014 AI model unavailable';
      case 'invalid_response':
        return 'Deterministic analysis \u2014 AI returned an unusable response';
      case 'embedding_failed':
        return 'Deterministic analysis \u2014 embedding failed';
      default:
        return 'Deterministic analysis \u2014 AI semantic analysis unavailable';
    }
  }
  return 'Deterministic analysis \u2014 AI semantic analysis unavailable';
}

/* ------------------------------------------------------------------ *
 * Indexing
 * ------------------------------------------------------------------ */

/**
 * Chunks and embeds any policy whose text has changed since it was last
 * indexed. Returns the full embedded corpus for this facility.
 *
 * Fingerprinting matters: embedding is the slow, paid step, and a policy that
 * has not changed does not need re-embedding on every run.
 */
export async function indexPolicies(
  hospitalId: number,
  policyRows: Array<{ id: number; code: string; title: string; version: string; text: string }>,
): Promise<EmbeddedChunk[]> {
  const existing = await db
    .select()
    .from(policyChunks)
    .where(eq(policyChunks.hospitalId, hospitalId));

  const byPolicy = new Map<number, typeof existing>();
  existing.forEach((c) => {
    const list = byPolicy.get(c.policyId) ?? [];
    list.push(c);
    byPolicy.set(c.policyId, list);
  });

  const stale: number[] = [];
  const toEmbed: Array<{
    policyId: number;
    ordinal: number;
    sectionLabel: string;
    text: string;
    charStart: number;
    charEnd: number;
    fingerprint: string;
  }> = [];

  for (const p of policyRows) {
    const fingerprint = chunkFingerprint(p.text);
    const current = byPolicy.get(p.id) ?? [];

    const upToDate =
      current.length > 0 &&
      current.every((c) => c.fingerprint === fingerprint && c.embedding !== null) &&
      current[0].embeddingModel === env.AI_EMBEDDING_MODEL;

    if (upToDate) continue;

    if (current.length) stale.push(p.id);
    chunkPolicy(p.text, p.code).forEach((c) =>
      toEmbed.push({ policyId: p.id, fingerprint, ...c }),
    );
  }

  if (stale.length) {
    await db.delete(policyChunks).where(inArray(policyChunks.policyId, stale));
  }

  // Embed in batches so a large library does not become one enormous request.
  for (let i = 0; i < toEmbed.length; i += env.AI_EMBED_BATCH) {
    const slice = toEmbed.slice(i, i + env.AI_EMBED_BATCH);
    const vectors = await embedBatch(slice.map((c) => c.text));

    await db.insert(policyChunks).values(
      slice.map((c, j) => ({
        hospitalId,
        policyId: c.policyId,
        ordinal: c.ordinal,
        sectionLabel: c.sectionLabel.slice(0, 200),
        text: c.text,
        charStart: c.charStart,
        charEnd: c.charEnd,
        fingerprint: c.fingerprint,
        embedding: vectors[j],
        embeddingModel: env.AI_EMBEDDING_MODEL,
      })),
    );
  }

  // Read back the full corpus with policy metadata for citation.
  const rows = await db
    .select({ chunk: policyChunks, policy: policies })
    .from(policyChunks)
    .innerJoin(policies, eq(policies.id, policyChunks.policyId))
    .where(eq(policyChunks.hospitalId, hospitalId));

  return rows
    .filter((r) => Array.isArray(r.chunk.embedding))
    .map((r) => ({
      chunkId: r.chunk.id,
      policyId: r.policy.id,
      policyCode: r.policy.code,
      policyTitle: r.policy.title,
      policyVersion: r.policy.version,
      sectionLabel: r.chunk.sectionLabel,
      text: r.chunk.text,
      embedding: r.chunk.embedding as unknown as number[],
    }));
}

/** Embeds requirements, reusing any stored vector whose text is unchanged. */
export async function embedRequirements(
  hospitalId: number,
  regs: Array<{ id: number; citation: string; title: string; requirementText: string }>,
): Promise<Map<number, number[]>> {
  const stored = await db
    .select()
    .from(regulationEmbeddings)
    .where(eq(regulationEmbeddings.hospitalId, hospitalId));

  const byReg = new Map(stored.map((r) => [r.regulationId, r]));
  const out = new Map<number, number[]>();
  const pending: typeof regs = [];

  for (const r of regs) {
    const fingerprint = chunkFingerprint(r.requirementText);
    const row = byReg.get(r.id);
    if (row && row.fingerprint === fingerprint && row.embeddingModel === env.AI_EMBEDDING_MODEL) {
      out.set(r.id, row.embedding as unknown as number[]);
    } else {
      pending.push(r);
    }
  }

  for (let i = 0; i < pending.length; i += env.AI_EMBED_BATCH) {
    const slice = pending.slice(i, i + env.AI_EMBED_BATCH);
    const vectors = await embedBatch(
      slice.map((r) => `${r.citation} ${r.title}\n${r.requirementText}`),
    );

    for (let j = 0; j < slice.length; j++) {
      const r = slice[j];
      const fingerprint = chunkFingerprint(r.requirementText);
      out.set(r.id, vectors[j]);

      await db
        .delete(regulationEmbeddings)
        .where(eq(regulationEmbeddings.regulationId, r.id));
      await db.insert(regulationEmbeddings).values({
        hospitalId,
        regulationId: r.id,
        fingerprint,
        embedding: vectors[j],
        embeddingModel: env.AI_EMBEDDING_MODEL,
      });
    }
  }

  return out;
}

/* ------------------------------------------------------------------ *
 * Per-requirement analysis
 * ------------------------------------------------------------------ */

export async function analyseSemantically(
  requirement: { framework: string; citation: string; title: string; requirementText: string },
  requirementEmbedding: number[] | undefined,
  corpus: EmbeddedChunk[],
): Promise<SemanticOutcome> {
  if (!aiConfigured()) {
    return { available: false, reason: fallbackMessage(new AiError('not_configured', '')) };
  }

  try {
    const embedding = requirementEmbedding ?? (await embedRequirement(requirement.requirementText));
    const retrieved = retrieve(embedding, corpus);
    const topSimilarity = retrieved[0]?.similarity ?? 0;

    const verdict = await evaluateRequirement(
      {
        framework: requirement.framework,
        citation: requirement.citation,
        title: requirement.title,
        text: requirement.requirementText,
      },
      retrieved,
    );

    return { available: true, verdict, retrieved, topSimilarity, model: env.AI_CHAT_MODEL };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      `[ai] ${requirement.citation}: ${(err as Error).message}`,
    );
    return { available: false, reason: fallbackMessage(err) };
  }
}

export { reconcile };
