-- Multiple branches per hospital organisation.
--
-- Each existing `hospitals` row becomes a branch. An `organizations` row groups
-- branches, and users belong to the organisation rather than a single branch,
-- so one login can move between them. Everything else in the schema is already
-- scoped by hospital_id, so branch isolation comes for free.

CREATE TABLE IF NOT EXISTS "organizations" (
  "id" serial PRIMARY KEY NOT NULL,
  "name" varchar(200) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

ALTER TABLE "hospitals" ADD COLUMN IF NOT EXISTS "organization_id" integer;
--> statement-breakpoint
ALTER TABLE "hospitals" ADD COLUMN IF NOT EXISTS "branch_label" varchar(160);
--> statement-breakpoint
ALTER TABLE "hospitals" ADD COLUMN IF NOT EXISTS "is_primary" boolean DEFAULT false NOT NULL;
--> statement-breakpoint

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "organization_id" integer;
--> statement-breakpoint

-- Backfill: every existing hospital joins one organisation named after the
-- first facility, so a single-branch deployment keeps working untouched.
DO $$
DECLARE
  org_id integer;
  first_name varchar(200);
BEGIN
  IF EXISTS (SELECT 1 FROM "hospitals" WHERE "organization_id" IS NULL) THEN
    SELECT "name" INTO first_name FROM "hospitals" ORDER BY "id" LIMIT 1;
    INSERT INTO "organizations" ("name") VALUES (COALESCE(first_name, 'My organization'))
      RETURNING "id" INTO org_id;

    UPDATE "hospitals" SET "organization_id" = org_id WHERE "organization_id" IS NULL;
    UPDATE "users" SET "organization_id" = org_id WHERE "organization_id" IS NULL;

    -- The lowest-numbered branch is the default one a user lands on.
    UPDATE "hospitals" SET "is_primary" = true
      WHERE "id" = (SELECT MIN("id") FROM "hospitals");

    UPDATE "hospitals" SET "branch_label" = "name" WHERE "branch_label" IS NULL;
  END IF;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "hospitals" ADD CONSTRAINT "hospitals_organization_id_fk"
    FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "users" ADD CONSTRAINT "users_organization_id_fk"
    FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "hospitals_organization_idx" ON "hospitals" ("organization_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "users_organization_idx" ON "users" ("organization_id");
