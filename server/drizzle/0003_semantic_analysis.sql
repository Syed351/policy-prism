-- Semantic analysis: embeddings, retrievable policy chunks, and the evidence
-- behind every AI conclusion.
--
-- Embeddings are stored as jsonb rather than a pgvector column. That is a
-- deliberate trade: pgvector is faster and the right answer at scale, but it
-- requires an extension the database may not permit, and at this size
-- (hundreds of chunks per facility) similarity is computed in the application
-- in a few milliseconds. Moving to pgvector later changes one query, not the
-- schema's meaning.

CREATE TABLE IF NOT EXISTS "policy_chunks" (
  "id" serial PRIMARY KEY NOT NULL,
  "hospital_id" integer NOT NULL,
  "policy_id" integer NOT NULL,
  "ordinal" integer NOT NULL,
  "section_label" varchar(200) NOT NULL,
  "text" text NOT NULL,
  "char_start" integer NOT NULL DEFAULT 0,
  "char_end" integer NOT NULL DEFAULT 0,
  -- Fingerprint of the source policy text; a change invalidates the chunk.
  "fingerprint" varchar(40) NOT NULL,
  "embedding" jsonb,
  "embedding_model" varchar(120),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "regulation_embeddings" (
  "id" serial PRIMARY KEY NOT NULL,
  "hospital_id" integer NOT NULL,
  "regulation_id" integer NOT NULL,
  "fingerprint" varchar(40) NOT NULL,
  "embedding" jsonb NOT NULL,
  "embedding_model" varchar(120) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- The AI verdict and its evidence, hanging off the existing mapping row so the
-- deterministic result and the semantic one sit side by side and stay
-- comparable.
ALTER TABLE "policy_mappings" ADD COLUMN IF NOT EXISTS "analysis_method" varchar(24) DEFAULT 'deterministic' NOT NULL;
--> statement-breakpoint
ALTER TABLE "policy_mappings" ADD COLUMN IF NOT EXISTS "ai_status" varchar(24);
--> statement-breakpoint
ALTER TABLE "policy_mappings" ADD COLUMN IF NOT EXISTS "ai_confidence" real;
--> statement-breakpoint
ALTER TABLE "policy_mappings" ADD COLUMN IF NOT EXISTS "ai_explanation" text;
--> statement-breakpoint
ALTER TABLE "policy_mappings" ADD COLUMN IF NOT EXISTS "ai_evidence" jsonb;
--> statement-breakpoint
ALTER TABLE "policy_mappings" ADD COLUMN IF NOT EXISTS "ai_missing_provisions" jsonb;
--> statement-breakpoint
ALTER TABLE "policy_mappings" ADD COLUMN IF NOT EXISTS "ai_contradictions" jsonb;
--> statement-breakpoint
ALTER TABLE "policy_mappings" ADD COLUMN IF NOT EXISTS "ai_model" varchar(120);
--> statement-breakpoint
ALTER TABLE "policy_mappings" ADD COLUMN IF NOT EXISTS "semantic_score" real;
--> statement-breakpoint
ALTER TABLE "policy_mappings" ADD COLUMN IF NOT EXISTS "ai_fallback_reason" varchar(200);
--> statement-breakpoint

-- Richer remediation, written by the model against the retrieved evidence.
ALTER TABLE "gap_findings" ADD COLUMN IF NOT EXISTS "ai_what_is_missing" text;
--> statement-breakpoint
ALTER TABLE "gap_findings" ADD COLUMN IF NOT EXISTS "ai_what_is_covered" text;
--> statement-breakpoint
ALTER TABLE "gap_findings" ADD COLUMN IF NOT EXISTS "ai_why_insufficient" text;
--> statement-breakpoint
ALTER TABLE "gap_findings" ADD COLUMN IF NOT EXISTS "ai_recommended_change" text;
--> statement-breakpoint

ALTER TABLE "analysis_runs" ADD COLUMN IF NOT EXISTS "analysis_method" varchar(24) DEFAULT 'deterministic' NOT NULL;
--> statement-breakpoint
ALTER TABLE "analysis_runs" ADD COLUMN IF NOT EXISTS "ai_model" varchar(120);
--> statement-breakpoint
ALTER TABLE "analysis_runs" ADD COLUMN IF NOT EXISTS "ai_evaluated" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "analysis_runs" ADD COLUMN IF NOT EXISTS "ai_failed" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "policy_chunks" ADD CONSTRAINT "policy_chunks_hospital_id_fk"
    FOREIGN KEY ("hospital_id") REFERENCES "public"."hospitals"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "policy_chunks" ADD CONSTRAINT "policy_chunks_policy_id_fk"
    FOREIGN KEY ("policy_id") REFERENCES "public"."policies"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "regulation_embeddings" ADD CONSTRAINT "regulation_embeddings_regulation_id_fk"
    FOREIGN KEY ("regulation_id") REFERENCES "public"."regulations"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "policy_chunks_hospital_idx" ON "policy_chunks" ("hospital_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "policy_chunks_policy_idx" ON "policy_chunks" ("policy_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "policy_chunks_policy_ordinal_uq" ON "policy_chunks" ("policy_id", "ordinal");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "regulation_embeddings_regulation_uq" ON "regulation_embeddings" ("regulation_id");
