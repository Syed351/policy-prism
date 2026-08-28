import 'dotenv/config';
import path from 'node:path';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DATABASE_SSL: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  JWT_EXPIRES_IN: z.string().default('12h'),
  CLIENT_URL: z.string().default('http://localhost:5173'),
  UPLOAD_DIR: z.string().default('uploads'),
  MAX_UPLOAD_MB: z.coerce.number().positive().default(8),
  SEED_PASSWORD: z.string().min(8).default('PolicyPrism!2026'),
  LOG_LEVEL: z.enum(['dev', 'combined', 'tiny', 'silent']).default('dev'),

  /* ---- email ---------------------------------------------------- */
  /** Public URL of the app, used to build links inside emails. */
  APP_URL: z.string().trim().url().default('http://localhost:4000'),
  MAIL_FROM: z.string().trim().default('Policy Prism <onboarding@resend.dev>'),
  /** Either set RESEND_API_KEY, or the SMTP_* group. Neither disables email. */
  RESEND_API_KEY: z.string().trim().optional(),
  SMTP_HOST: z.string().trim().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: z.string().trim().optional(),
  SMTP_PASSWORD: z.string().trim().optional(),

  /* ---- AI semantic analysis ------------------------------------- *
   * Provider-agnostic: any OpenAI-compatible endpoint works (OpenAI,
   * Azure, Together, Groq, Fireworks, vLLM, Ollama). Anthropic is
   * detected from the base URL and uses its own request shape.
   * Unset, the deterministic engine runs alone and says so.            */
  AI_API_KEY: z.string().trim().optional(),
  AI_BASE_URL: z.string().trim().optional(),
  AI_CHAT_MODEL: z.string().trim().default('gpt-4o-mini'),
  AI_EMBEDDING_MODEL: z.string().trim().default('text-embedding-3-small'),
  /** Only needed when embeddings come from a different provider to chat. */
  AI_EMBEDDING_BASE_URL: z.string().trim().optional(),
  AI_EMBEDDING_API_KEY: z.string().trim().optional(),
  AI_TIMEOUT_MS: z.coerce.number().int().positive().default(45_000),
  /** Policy sections retrieved per requirement and sent as evidence. */
  AI_RETRIEVAL_K: z.coerce.number().int().min(1).max(20).default(6),
  AI_EMBED_BATCH: z.coerce.number().int().min(1).max(256).default(64),
  /** Above this similarity, a subject is considered present in the library. */
  AI_TOPICAL_SIMILARITY: z.coerce.number().min(0).max(1).default(0.35),
  /** Requirements evaluated concurrently; raise carefully against rate limits. */
  AI_CONCURRENCY: z.coerce.number().int().min(1).max(20).default(4),
  /** Retries on a rate-limit response, with exponential backoff. */
  AI_MAX_RETRIES: z.coerce.number().int().min(0).max(8).default(4),
  AI_RETRY_BASE_MS: z.coerce.number().int().min(100).max(30_000).default(2_000),
  /** Pause between requests; free tiers meter requests per minute. */
  AI_REQUEST_DELAY_MS: z.coerce.number().int().min(0).max(10_000).default(0),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  // eslint-disable-next-line no-console
  console.error(`\nInvalid environment configuration:\n${issues}\n\nCopy .env.example to .env and fill it in.\n`);
  process.exit(1);
}

const raw = parsed.data;

/** Comma separated list of allowed browser origins. */
const origins = raw.CLIENT_URL.split(',')
  .map((s) => s.trim())
  .filter(Boolean);

export const env = {
  ...raw,
  isProd: raw.NODE_ENV === 'production',
  isDev: raw.NODE_ENV === 'development',
  corsOrigins: origins,
  uploadDir: path.isAbsolute(raw.UPLOAD_DIR)
    ? raw.UPLOAD_DIR
    : path.resolve(process.cwd(), raw.UPLOAD_DIR),
  maxUploadBytes: raw.MAX_UPLOAD_MB * 1024 * 1024,
};

export type Env = typeof env;
