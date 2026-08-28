DO $$ BEGIN CREATE TYPE "public"."audit_category" AS ENUM('document', 'analysis', 'review', 'profile', 'export', 'system'); EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN CREATE TYPE "public"."coverage_status" AS ENUM('covered', 'partial', 'not_addressed', 'no_policy'); EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN CREATE TYPE "public"."doc_source" AS ENUM('demo', 'upload', 'authored', 'import'); EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN CREATE TYPE "public"."framework" AS ENUM('CMS', 'HIPAA', 'EMTALA', 'CLIA', 'State', 'TJC', 'Custom'); EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN CREATE TYPE "public"."gap_status" AS ENUM('open', 'in_progress', 'resolved', 'accepted_risk'); EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN CREATE TYPE "public"."policy_scope" AS ENUM('regulatory', 'operational', 'governance'); EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN CREATE TYPE "public"."policy_status" AS ENUM('draft', 'active', 'archived'); EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN CREATE TYPE "public"."priority" AS ENUM('Critical', 'High', 'Medium'); EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN CREATE TYPE "public"."remediation_status" AS ENUM('open', 'in_progress', 'blocked', 'completed', 'cancelled'); EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN CREATE TYPE "public"."review_decision" AS ENUM('approved', 'rejected', 'reopened', 'comment'); EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN CREATE TYPE "public"."review_status" AS ENUM('pending', 'approved', 'rejected'); EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN CREATE TYPE "public"."role" AS ENUM('admin', 'reviewer', 'analyst', 'viewer'); EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN CREATE TYPE "public"."run_scope_kind" AS ENUM('full', 'selection'); EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN CREATE TYPE "public"."run_status" AS ENUM('running', 'completed', 'failed'); EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN CREATE TYPE "public"."service_key" AS ENUM('ed', 'lab', 'psych', 'ob', 'swing'); EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "hospitals" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(200) NOT NULL,
	"beds" integer DEFAULT 0 NOT NULL,
	"state" varchar(2) NOT NULL,
	"facility_type" varchar(120) DEFAULT 'Acute care hospital' NOT NULL,
	"license_type" varchar(120) DEFAULT 'General acute care license' NOT NULL,
	"medicare" boolean DEFAULT true NOT NULL,
	"accredited" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "hospital_services" (
	"id" serial PRIMARY KEY NOT NULL,
	"hospital_id" integer NOT NULL,
	"service_key" "service_key" NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"hospital_id" integer NOT NULL,
	"email" varchar(200) NOT NULL,
	"password_hash" text NOT NULL,
	"name" varchar(120) NOT NULL,
	"role" "role" DEFAULT 'viewer' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "policies" (
	"id" serial PRIMARY KEY NOT NULL,
	"hospital_id" integer NOT NULL,
	"code" varchar(60) DEFAULT '' NOT NULL,
	"title" varchar(240) NOT NULL,
	"owner" varchar(160) DEFAULT 'Unassigned' NOT NULL,
	"version" varchar(24) DEFAULT '1.0' NOT NULL,
	"effective_date" date,
	"status" "policy_status" DEFAULT 'active' NOT NULL,
	"scope" "policy_scope" DEFAULT 'regulatory' NOT NULL,
	"text" text DEFAULT '' NOT NULL,
	"source" "doc_source" DEFAULT 'authored' NOT NULL,
	"file_name" varchar(260),
	"file_path" varchar(400),
	"file_size" integer,
	"created_by_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "policy_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"policy_id" integer NOT NULL,
	"version" varchar(24) NOT NULL,
	"text" text DEFAULT '' NOT NULL,
	"effective_date" date,
	"superseded_at" timestamp with time zone,
	"author_id" integer,
	"author_name" varchar(160),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "regulations" (
	"id" serial PRIMARY KEY NOT NULL,
	"hospital_id" integer NOT NULL,
	"framework" "framework" DEFAULT 'Custom' NOT NULL,
	"citation" varchar(120) NOT NULL,
	"title" varchar(260) NOT NULL,
	"requirement_text" text DEFAULT '' NOT NULL,
	"applicability" varchar(40) DEFAULT 'always' NOT NULL,
	"effective_date" date,
	"source_ref" varchar(300),
	"amended_at" date,
	"source" "doc_source" DEFAULT 'demo' NOT NULL,
	"file_name" varchar(260),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "analysis_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"hospital_id" integer NOT NULL,
	"run_number" integer NOT NULL,
	"status" "run_status" DEFAULT 'running' NOT NULL,
	"trigger" varchar(60) DEFAULT 'Manual run' NOT NULL,
	"scope_kind" "run_scope_kind" DEFAULT 'full' NOT NULL,
	"label" varchar(200) DEFAULT '' NOT NULL,
	"facility_name" varchar(200) DEFAULT '' NOT NULL,
	"requirement_count" integer DEFAULT 0 NOT NULL,
	"policy_count" integer DEFAULT 0 NOT NULL,
	"comparisons" integer DEFAULT 0 NOT NULL,
	"covered" integer DEFAULT 0 NOT NULL,
	"partial" integer DEFAULT 0 NOT NULL,
	"not_addressed" integer DEFAULT 0 NOT NULL,
	"no_policy" integer DEFAULT 0 NOT NULL,
	"coverage_pct" integer DEFAULT 0 NOT NULL,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"profile_signature" jsonb,
	"scope_changed" boolean DEFAULT false NOT NULL,
	"scope_diff" text,
	"coverage_delta" integer,
	"gap_delta" integer,
	"selected_regulation_ids" jsonb,
	"selected_policy_ids" jsonb,
	"policy_scoped" boolean DEFAULT true NOT NULL,
	"run_by_id" integer,
	"run_by_name" varchar(160) DEFAULT 'System' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "policy_mappings" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" integer NOT NULL,
	"hospital_id" integer NOT NULL,
	"regulation_id" integer NOT NULL,
	"policy_id" integer,
	"score" real DEFAULT 0 NOT NULL,
	"status" "coverage_status" DEFAULT 'no_policy' NOT NULL,
	"matched_terms" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"missing_terms" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"contradictory_terms" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"alternatives" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"joint" jsonb,
	"review_status" "review_status" DEFAULT 'pending' NOT NULL,
	"review_comment" text,
	"reviewed_by_id" integer,
	"reviewed_by_name" varchar(160),
	"reviewed_at" timestamp with time zone,
	"needs_rereview" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "gap_findings" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" integer NOT NULL,
	"hospital_id" integer NOT NULL,
	"mapping_id" integer NOT NULL,
	"regulation_id" integer NOT NULL,
	"policy_id" integer,
	"coverage_status" "coverage_status" NOT NULL,
	"score" real DEFAULT 0 NOT NULL,
	"priority" "priority" DEFAULT 'Medium' NOT NULL,
	"action" varchar(160) DEFAULT '' NOT NULL,
	"effort" varchar(80) DEFAULT '' NOT NULL,
	"suggested_owner" varchar(160) DEFAULT 'Compliance' NOT NULL,
	"risk" text DEFAULT '' NOT NULL,
	"missing_terms" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"uncovered_clauses" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"draft_language" text DEFAULT '' NOT NULL,
	"status" "gap_status" DEFAULT 'open' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "reviews" (
	"id" serial PRIMARY KEY NOT NULL,
	"mapping_id" integer NOT NULL,
	"run_id" integer NOT NULL,
	"reviewer_id" integer,
	"reviewer_name" varchar(160) NOT NULL,
	"reviewer_role" varchar(80) DEFAULT '' NOT NULL,
	"decision" "review_decision" NOT NULL,
	"comment" text,
	"previous_status" "review_status" DEFAULT 'pending' NOT NULL,
	"final_status" "review_status" DEFAULT 'pending' NOT NULL,
	"coverage_status" "coverage_status" NOT NULL,
	"score" real DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "remediation_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"hospital_id" integer NOT NULL,
	"gap_id" integer NOT NULL,
	"title" varchar(260) NOT NULL,
	"owner" varchar(160) DEFAULT 'Compliance' NOT NULL,
	"priority" "priority" DEFAULT 'Medium' NOT NULL,
	"risk" text DEFAULT '' NOT NULL,
	"status" "remediation_status" DEFAULT 'open' NOT NULL,
	"recommended_action" text DEFAULT '' NOT NULL,
	"due_date" date,
	"notes" text,
	"created_by_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "audit_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"hospital_id" integer NOT NULL,
	"seq" integer NOT NULL,
	"category" "audit_category" DEFAULT 'system' NOT NULL,
	"action" varchar(200) NOT NULL,
	"object" varchar(240),
	"detail" text,
	"user_id" integer,
	"actor_name" varchar(160) DEFAULT 'System' NOT NULL,
	"actor_role" varchar(80),
	"ip" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "hospital_services" ADD CONSTRAINT "hospital_services_hospital_id_fk" FOREIGN KEY ("hospital_id") REFERENCES "public"."hospitals"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "users" ADD CONSTRAINT "users_hospital_id_fk" FOREIGN KEY ("hospital_id") REFERENCES "public"."hospitals"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "policies" ADD CONSTRAINT "policies_hospital_id_fk" FOREIGN KEY ("hospital_id") REFERENCES "public"."hospitals"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "policies" ADD CONSTRAINT "policies_created_by_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "policy_versions" ADD CONSTRAINT "policy_versions_policy_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."policies"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "policy_versions" ADD CONSTRAINT "policy_versions_author_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "regulations" ADD CONSTRAINT "regulations_hospital_id_fk" FOREIGN KEY ("hospital_id") REFERENCES "public"."hospitals"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "analysis_runs" ADD CONSTRAINT "analysis_runs_hospital_id_fk" FOREIGN KEY ("hospital_id") REFERENCES "public"."hospitals"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "analysis_runs" ADD CONSTRAINT "analysis_runs_run_by_id_fk" FOREIGN KEY ("run_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "policy_mappings" ADD CONSTRAINT "policy_mappings_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."analysis_runs"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "policy_mappings" ADD CONSTRAINT "policy_mappings_hospital_id_fk" FOREIGN KEY ("hospital_id") REFERENCES "public"."hospitals"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "policy_mappings" ADD CONSTRAINT "policy_mappings_regulation_id_fk" FOREIGN KEY ("regulation_id") REFERENCES "public"."regulations"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "policy_mappings" ADD CONSTRAINT "policy_mappings_policy_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."policies"("id") ON DELETE set null ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "policy_mappings" ADD CONSTRAINT "policy_mappings_reviewed_by_id_fk" FOREIGN KEY ("reviewed_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "gap_findings" ADD CONSTRAINT "gap_findings_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."analysis_runs"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "gap_findings" ADD CONSTRAINT "gap_findings_hospital_id_fk" FOREIGN KEY ("hospital_id") REFERENCES "public"."hospitals"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "gap_findings" ADD CONSTRAINT "gap_findings_mapping_id_fk" FOREIGN KEY ("mapping_id") REFERENCES "public"."policy_mappings"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "gap_findings" ADD CONSTRAINT "gap_findings_regulation_id_fk" FOREIGN KEY ("regulation_id") REFERENCES "public"."regulations"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "gap_findings" ADD CONSTRAINT "gap_findings_policy_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."policies"("id") ON DELETE set null ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "reviews" ADD CONSTRAINT "reviews_mapping_id_fk" FOREIGN KEY ("mapping_id") REFERENCES "public"."policy_mappings"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "reviews" ADD CONSTRAINT "reviews_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."analysis_runs"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "reviews" ADD CONSTRAINT "reviews_reviewer_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "remediation_items" ADD CONSTRAINT "remediation_items_hospital_id_fk" FOREIGN KEY ("hospital_id") REFERENCES "public"."hospitals"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "remediation_items" ADD CONSTRAINT "remediation_items_gap_id_fk" FOREIGN KEY ("gap_id") REFERENCES "public"."gap_findings"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "remediation_items" ADD CONSTRAINT "remediation_items_created_by_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_hospital_id_fk" FOREIGN KEY ("hospital_id") REFERENCES "public"."hospitals"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hospitals_state_idx" ON "hospitals" USING btree ("state");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "hospital_services_hospital_key_uq" ON "hospital_services" USING btree ("hospital_id","service_key");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "users_email_uq" ON "users" USING btree ("email");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "users_hospital_idx" ON "users" USING btree ("hospital_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "policies_hospital_idx" ON "policies" USING btree ("hospital_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "policies_scope_idx" ON "policies" USING btree ("scope");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "policies_code_idx" ON "policies" USING btree ("code");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "policy_versions_policy_idx" ON "policy_versions" USING btree ("policy_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "regulations_hospital_idx" ON "regulations" USING btree ("hospital_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "regulations_framework_idx" ON "regulations" USING btree ("framework");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "regulations_applicability_idx" ON "regulations" USING btree ("applicability");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "regulations_hospital_citation_uq" ON "regulations" USING btree ("hospital_id","citation");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "analysis_runs_hospital_idx" ON "analysis_runs" USING btree ("hospital_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "analysis_runs_created_idx" ON "analysis_runs" USING btree ("created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "analysis_runs_hospital_number_uq" ON "analysis_runs" USING btree ("hospital_id","run_number");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "policy_mappings_run_idx" ON "policy_mappings" USING btree ("run_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "policy_mappings_status_idx" ON "policy_mappings" USING btree ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "policy_mappings_review_idx" ON "policy_mappings" USING btree ("review_status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "policy_mappings_regulation_idx" ON "policy_mappings" USING btree ("regulation_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "policy_mappings_policy_idx" ON "policy_mappings" USING btree ("policy_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "policy_mappings_run_regulation_uq" ON "policy_mappings" USING btree ("run_id","regulation_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gap_findings_run_idx" ON "gap_findings" USING btree ("run_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gap_findings_priority_idx" ON "gap_findings" USING btree ("priority");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gap_findings_status_idx" ON "gap_findings" USING btree ("status");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "gap_findings_mapping_uq" ON "gap_findings" USING btree ("mapping_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reviews_mapping_idx" ON "reviews" USING btree ("mapping_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reviews_run_idx" ON "reviews" USING btree ("run_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reviews_created_idx" ON "reviews" USING btree ("created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "remediation_items_hospital_idx" ON "remediation_items" USING btree ("hospital_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "remediation_items_gap_uq" ON "remediation_items" USING btree ("gap_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "remediation_items_status_idx" ON "remediation_items" USING btree ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_logs_hospital_idx" ON "audit_logs" USING btree ("hospital_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_logs_category_idx" ON "audit_logs" USING btree ("category");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_logs_created_idx" ON "audit_logs" USING btree ("created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "audit_logs_hospital_seq_uq" ON "audit_logs" USING btree ("hospital_id","seq");
