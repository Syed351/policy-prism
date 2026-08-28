/**
 * Provider-agnostic AI access.
 *
 * Two capabilities are needed: embeddings for retrieval, and a chat model for
 * evaluation. Both are reached over the OpenAI-compatible HTTP shape, which is
 * implemented by OpenAI, Azure OpenAI, Together, Groq, Fireworks, vLLM and
 * Ollama - so changing provider is a base URL and a model name, not a rewrite.
 * Anthropic uses a different request shape and is handled separately.
 *
 * Nothing here fakes a result. If a provider is not configured or a call fails,
 * the caller is told, and the analysis falls back to the deterministic engine
 * with the finding marked accordingly.
 */

import { env } from '../../config/env';

export type AiFailureReason =
  | 'not_configured'
  | 'missing_api_key'
  | 'timeout'
  | 'rate_limited'
  | 'model_unavailable'
  | 'invalid_response'
  | 'embedding_failed'
  | 'unknown';

export class AiError extends Error {
  readonly reason: AiFailureReason;
  readonly retryable: boolean;

  constructor(reason: AiFailureReason, message: string, retryable = false) {
    super(message);
    this.name = 'AiError';
    this.reason = reason;
    this.retryable = retryable;
  }
}

export function aiConfigured(): boolean {
  return !!env.AI_API_KEY && !!env.AI_BASE_URL;
}

export function aiProviderLabel(): string {
  if (!aiConfigured()) return 'not configured';
  const host = (() => {
    try {
      return new URL(env.AI_BASE_URL!).host;
    } catch {
      return env.AI_BASE_URL ?? 'unknown';
    }
  })();
  return `${host} · ${env.AI_CHAT_MODEL} · ${env.AI_EMBEDDING_MODEL}`;
}

/** Anthropic's API differs enough to warrant its own branch. */
function isAnthropic(): boolean {
  return /anthropic\.com/i.test(env.AI_BASE_URL ?? '');
}

async function withTimeout<T>(fn: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fn(controller.signal);
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw new AiError('timeout', `The AI provider did not respond within ${ms / 1000}s`, true);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** Maps an HTTP failure onto a reason the caller can act on. */
async function toAiError(res: Response): Promise<AiError> {
  const body = await res.text().catch(() => '');
  const detail = body.slice(0, 300);

  if (res.status === 401 || res.status === 403) {
    return new AiError('missing_api_key', `The AI provider rejected the API key (${res.status})`);
  }
  if (res.status === 404) {
    return new AiError('model_unavailable', `Model not found at this provider: ${detail}`);
  }
  if (res.status === 429) {
    return new AiError('rate_limited', 'The AI provider is rate limiting this key', true);
  }
  if (res.status >= 500) {
    return new AiError('model_unavailable', `Provider error ${res.status}: ${detail}`, true);
  }
  return new AiError('unknown', `Provider returned ${res.status}: ${detail}`);
}

/* ------------------------------------------------------------------ *
 * Embeddings
 * ------------------------------------------------------------------ */

/**
 * Embeds a batch of texts. Batching matters: one request per chunk would make
 * indexing a policy library impractically slow and expensive.
 */
export async function embedBatch(texts: string[]): Promise<number[][]> {
  if (!aiConfigured()) throw new AiError('not_configured', 'No AI provider is configured');
  if (!texts.length) return [];

  // Anthropic has no embedding endpoint; Voyage is their recommendation, and
  // any OpenAI-compatible embedding endpoint works here.
  const baseUrl = env.AI_EMBEDDING_BASE_URL || env.AI_BASE_URL!;

  const res = await withTimeout(
    (signal) =>
      fetch(`${baseUrl.replace(/\/$/, '')}/embeddings`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.AI_EMBEDDING_API_KEY || env.AI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: env.AI_EMBEDDING_MODEL,
          input: texts.map((t) => t.slice(0, 8000)),
        }),
        signal,
      }),
    env.AI_TIMEOUT_MS,
  );

  if (!res.ok) throw await toAiError(res);

  const json = (await res.json().catch(() => null)) as
    | { data?: Array<{ embedding?: number[]; index?: number }> }
    | null;

  const rows = json?.data;
  if (!Array.isArray(rows) || rows.length !== texts.length) {
    throw new AiError('embedding_failed', 'The embedding response did not match the input batch');
  }

  // Providers may return out of order; index is authoritative when present.
  const out: number[][] = new Array(texts.length);
  rows.forEach((r, i) => {
    const at = typeof r.index === 'number' ? r.index : i;
    if (!Array.isArray(r.embedding)) {
      throw new AiError('embedding_failed', 'The embedding response contained no vector');
    }
    out[at] = r.embedding;
  });

  return out;
}

/* ------------------------------------------------------------------ *
 * Chat completion, JSON only
 * ------------------------------------------------------------------ */

export interface ChatRequest {
  system: string;
  user: string;
  /** Keeps evaluations reproducible; compliance work should not be creative. */
  temperature?: number;
  maxTokens?: number;
}

export async function chatJson<T>(req: ChatRequest): Promise<T> {
  if (!aiConfigured()) throw new AiError('not_configured', 'No AI provider is configured');

  const raw = isAnthropic() ? await callAnthropic(req) : await callOpenAiCompatible(req);

  // Models sometimes wrap JSON in prose or fences despite instruction.
  const cleaned = raw
    .replace(/^[\s\S]*?```(?:json)?/i, (m) => (m.includes('```') ? '' : m))
    .replace(/```[\s\S]*$/i, '')
    .trim();

  const candidate = cleaned.startsWith('{') || cleaned.startsWith('[') ? cleaned : extractJson(raw);

  try {
    return JSON.parse(candidate) as T;
  } catch {
    throw new AiError(
      'invalid_response',
      `The model did not return valid JSON: ${raw.slice(0, 200)}`,
    );
  }
}

/** Finds the first balanced JSON object in a noisy response. */
function extractJson(text: string): string {
  const start = text.indexOf('{');
  if (start < 0) return text;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return text.slice(start);
}

async function callOpenAiCompatible(req: ChatRequest): Promise<string> {
  const res = await withTimeout(
    (signal) =>
      fetch(`${env.AI_BASE_URL!.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.AI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: env.AI_CHAT_MODEL,
          temperature: req.temperature ?? 0,
          max_tokens: req.maxTokens ?? 1200,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: req.system },
            { role: 'user', content: req.user },
          ],
        }),
        signal,
      }),
    env.AI_TIMEOUT_MS,
  );

  if (!res.ok) throw await toAiError(res);

  const json = (await res.json().catch(() => null)) as
    | { choices?: Array<{ message?: { content?: string } }> }
    | null;

  const content = json?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    throw new AiError('invalid_response', 'The model returned an empty completion');
  }
  return content;
}

async function callAnthropic(req: ChatRequest): Promise<string> {
  const res = await withTimeout(
    (signal) =>
      fetch(`${env.AI_BASE_URL!.replace(/\/$/, '')}/messages`, {
        method: 'POST',
        headers: {
          'x-api-key': env.AI_API_KEY!,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: env.AI_CHAT_MODEL,
          max_tokens: req.maxTokens ?? 1200,
          temperature: req.temperature ?? 0,
          system: req.system,
          messages: [{ role: 'user', content: req.user }],
        }),
        signal,
      }),
    env.AI_TIMEOUT_MS,
  );

  if (!res.ok) throw await toAiError(res);

  const json = (await res.json().catch(() => null)) as
    | { content?: Array<{ type?: string; text?: string }> }
    | null;

  const text = json?.content?.find((c) => c.type === 'text')?.text;
  if (typeof text !== 'string' || !text.trim()) {
    throw new AiError('invalid_response', 'The model returned an empty completion');
  }
  return text;
}

/* ------------------------------------------------------------------ *
 * Vector maths
 * ------------------------------------------------------------------ */

/** Cosine similarity. Vectors from these providers are already normalised, but
 *  dividing by the norms costs little and makes the function safe generally. */
export function cosine(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
