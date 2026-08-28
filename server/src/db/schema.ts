import { relations } from 'drizzle-orm';
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';

/* ------------------------------------------------------------------ *
 * Enums
 * ------------------------------------------------------------------ */

export const roleEnum = pgEnum('role', ['admin', 'reviewer', 'analyst', 'viewer']);
export const serviceKeyEnum = pgEnum('service_key', ['ed', 'lab', 'psych', 'ob', 'swing']);
export const policyScopeEnum = pgEnum('policy_scope', ['regulatory', 'operational', 'governance']);
export const policyStatusEnum = pgEnum('policy_status', ['draft', 'active', 'archived']);
export const docSourceEnum = pgEnum('doc_source', ['demo', 'upload', 'authored', 'import']);
export const frameworkEnum = pgEnum('framework', ['CMS', 'HIPAA', 'EMTALA', 'CLIA', 'State', 'TJC', 'Custom']);
export const runStatusEnum = pgEnum('run_status', ['running', 'completed', 'failed']);
export const runScopeKindEnum = pgEnum('run_scope_kind', ['full', 'selection']);
export const coverageStatusEnum = pgEnum('coverage_status', ['covered', 'partial', 'not_addressed', 'no_policy']);
export const reviewStatusEnum = pgEnum('review_status', ['pending', 'approved', 'rejected']);
export const reviewDecisionEnum = pgEnum('review_decision', ['approved', 'rejected', 'reopened', 'comment']);
export const priorityEnum = pgEnum('priority', ['Critical', 'High', 'Medium']);
export const gapStatusEnum = pgEnum('gap_status', ['open', 'in_progress', 'resolved', 'accepted_risk']);
export const remediationStatusEnum = pgEnum('remediation_status', [
  'open',
  'in_progress',
  'blocked',
  'completed',
  'cancelled',
]);
export const auditCategoryEnum = pgEnum('audit_category', [
  'document',
  'analysis',
  'review',
  'profile',
  'export',
  'system',
]);

/* ------------------------------------------------------------------ *
 * hospitals
 * ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ *
 * organizations - groups the branches of one hospital organisation
 * ------------------------------------------------------------------ */

export const organizations = pgTable('organizations', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 200 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * A `hospitals` row is a branch. Everything else in the schema already hangs
 * off hospital_id, so each branch owns its policies, requirements, runs and
 * findings in isolation.
 */
export const hospitals = pgTable(
  'hospitals',
  {
    id: serial('id').primaryKey(),
    organizationId: integer('organization_id').references(() => organizations.id, {
      onDelete: 'cascade',
    }),
    /** Short label for the branch picker, e.g. "Riverside campus". */
    branchLabel: varchar('branch_label', { length: 160 }),
    isPrimary: boolean('is_primary').notNull().default(false),
    name: varchar('name', { length: 200 }).notNull(),
    beds: integer('beds').notNull().default(0),
    state: varchar('state', { length: 2 }).notNull(),
    facilityType: varchar('facility_type', { length: 120 }).notNull().default('Acute care hospital'),
    licenseType: varchar('license_type', { length: 120 }).notNull().default('General acute care license'),
    medicare: boolean('medicare').notNull().default(true),
    accredited: boolean('accredited').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    stateIdx: index('hospitals_state_idx').on(t.state),
    organizationIdx: index('hospitals_organization_idx').on(t.organizationId),
  }),
);

/* ------------------------------------------------------------------ *
 * hospital_services
 * ------------------------------------------------------------------ */

export const hospitalServices = pgTable(
  'hospital_services',
  {
    id: serial('id').primaryKey(),
    hospitalId: integer('hospital_id')
      .notNull()
      .references(() => hospitals.id, { onDelete: 'cascade' }),
    serviceKey: serviceKeyEnum('service_key').notNull(),
    enabled: boolean('enabled').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniq: uniqueIndex('hospital_services_hospital_key_uq').on(t.hospitalId, t.serviceKey),
  }),
);

/* ------------------------------------------------------------------ *
 * users
 * ------------------------------------------------------------------ */

export const users = pgTable(
  'users',
  {
    id: serial('id').primaryKey(),
    hospitalId: integer('hospital_id')
      .notNull()
      .references(() => hospitals.id, { onDelete: 'cascade' }),
    /** Users belong to the organisation, so one login spans every branch. */
    organizationId: integer('organization_id').references(() => organizations.id, {
      onDelete: 'cascade',
    }),
    email: varchar('email', { length: 200 }).notNull(),
    passwordHash: text('password_hash').notNull(),
    name: varchar('name', { length: 120 }).notNull(),
    role: roleEnum('role').notNull().default('viewer'),
    isActive: boolean('is_active').notNull().default(true),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    emailUq: uniqueIndex('users_email_uq').on(t.email),
    hospitalIdx: index('users_hospital_idx').on(t.hospitalId),
  }),
);

/* ------------------------------------------------------------------ *
 * policies
 * ------------------------------------------------------------------ */

export const policies = pgTable(
  'policies',
  {
    id: serial('id').primaryKey(),
    hospitalId: integer('hospital_id')
      .notNull()
      .references(() => hospitals.id, { onDelete: 'cascade' }),
    code: varchar('code', { length: 60 }).notNull().default(''),
    title: varchar('title', { length: 240 }).notNull(),
    owner: varchar('owner', { length: 160 }).notNull().default('Unassigned'),
    version: varchar('version', { length: 24 }).notNull().default('1.0'),
    effectiveDate: date('effective_date'),
    status: policyStatusEnum('status').notNull().default('active'),
    scope: policyScopeEnum('scope').notNull().default('regulatory'),
    text: text('text').notNull().default(''),
    source: docSourceEnum('source').notNull().default('authored'),
    fileName: varchar('file_name', { length: 260 }),
    filePath: varchar('file_path', { length: 400 }),
    fileSize: integer('file_size'),
    createdById: integer('created_by_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    hospitalIdx: index('policies_hospital_idx').on(t.hospitalId),
    scopeIdx: index('policies_scope_idx').on(t.scope),
    codeIdx: index('policies_code_idx').on(t.code),
  }),
);

/* ------------------------------------------------------------------ *
 * policy_versions
 * ------------------------------------------------------------------ */

export const policyVersions = pgTable(
  'policy_versions',
  {
    id: serial('id').primaryKey(),
    policyId: integer('policy_id')
      .notNull()
      .references(() => policies.id, { onDelete: 'cascade' }),
    version: varchar('version', { length: 24 }).notNull(),
    text: text('text').notNull().default(''),
    effectiveDate: date('effective_date'),
    supersededAt: timestamp('superseded_at', { withTimezone: true }),
    authorId: integer('author_id').references(() => users.id, { onDelete: 'set null' }),
    authorName: varchar('author_name', { length: 160 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    policyIdx: index('policy_versions_policy_idx').on(t.policyId),
  }),
);

/* ------------------------------------------------------------------ *
 * regulations
 * ------------------------------------------------------------------ */

export const regulations = pgTable(
  'regulations',
  {
    id: serial('id').primaryKey(),
    hospitalId: integer('hospital_id')
      .notNull()
      .references(() => hospitals.id, { onDelete: 'cascade' }),
    framework: frameworkEnum('framework').notNull().default('Custom'),
    citation: varchar('citation', { length: 120 }).notNull(),
    title: varchar('title', { length: 260 }).notNull(),
    requirementText: text('requirement_text').notNull().default(''),
    /** 'always' | 'medicare' | 'accredited' | service key | 'state:OH' */
    applicability: varchar('applicability', { length: 40 }).notNull().default('always'),
    effectiveDate: date('effective_date'),
    sourceRef: varchar('source_ref', { length: 300 }),
    amendedAt: date('amended_at'),
    source: docSourceEnum('source').notNull().default('demo'),
    fileName: varchar('file_name', { length: 260 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    hospitalIdx: index('regulations_hospital_idx').on(t.hospitalId),
    frameworkIdx: index('regulations_framework_idx').on(t.framework),
    applicabilityIdx: index('regulations_applicability_idx').on(t.applicability),
    citationUq: uniqueIndex('regulations_hospital_citation_uq').on(t.hospitalId, t.citation),
  }),
);

/* ------------------------------------------------------------------ *
 * analysis_runs
 * ------------------------------------------------------------------ */

export const analysisRuns = pgTable(
  'analysis_runs',
  {
    id: serial('id').primaryKey(),
    hospitalId: integer('hospital_id')
      .notNull()
      .references(() => hospitals.id, { onDelete: 'cascade' }),
    runNumber: integer('run_number').notNull(),
    status: runStatusEnum('status').notNull().default('running'),
    trigger: varchar('trigger', { length: 60 }).notNull().default('Manual run'),
    scopeKind: runScopeKindEnum('scope_kind').notNull().default('full'),
    label: varchar('label', { length: 200 }).notNull().default(''),
    facilityName: varchar('facility_name', { length: 200 }).notNull().default(''),
    requirementCount: integer('requirement_count').notNull().default(0),
    policyCount: integer('policy_count').notNull().default(0),
    comparisons: integer('comparisons').notNull().default(0),
    covered: integer('covered').notNull().default(0),
    partial: integer('partial').notNull().default(0),
    notAddressed: integer('not_addressed').notNull().default(0),
    noPolicy: integer('no_policy').notNull().default(0),
    coveragePct: integer('coverage_pct').notNull().default(0),
    durationMs: integer('duration_ms').notNull().default(0),
    profileSignature: jsonb('profile_signature').$type<Record<string, unknown>>(),
    scopeChanged: boolean('scope_changed').notNull().default(false),
    scopeDiff: text('scope_diff'),
    coverageDelta: integer('coverage_delta'),
    gapDelta: integer('gap_delta'),
    selectedRegulationIds: jsonb('selected_regulation_ids').$type<number[]>(),
    selectedPolicyIds: jsonb('selected_policy_ids').$type<number[]>(),
    policyScoped: boolean('policy_scoped').notNull().default(true),
    analysisMethod: varchar('analysis_method', { length: 24 }).notNull().default('deterministic'),
    aiModel: varchar('ai_model', { length: 120 }),
    aiEvaluated: integer('ai_evaluated').notNull().default(0),
    aiFailed: integer('ai_failed').notNull().default(0),
    runById: integer('run_by_id').references(() => users.id, { onDelete: 'set null' }),
    runByName: varchar('run_by_name', { length: 160 }).notNull().default('System'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    hospitalIdx: index('analysis_runs_hospital_idx').on(t.hospitalId),
    createdIdx: index('analysis_runs_created_idx').on(t.createdAt),
    runNumberUq: uniqueIndex('analysis_runs_hospital_number_uq').on(t.hospitalId, t.runNumber),
  }),
);

/* ------------------------------------------------------------------ *
 * policy_mappings
 * ------------------------------------------------------------------ */

export const policyMappings = pgTable(
  'policy_mappings',
  {
    id: serial('id').primaryKey(),
    runId: integer('run_id')
      .notNull()
      .references(() => analysisRuns.id, { onDelete: 'cascade' }),
    hospitalId: integer('hospital_id')
      .notNull()
      .references(() => hospitals.id, { onDelete: 'cascade' }),
    regulationId: integer('regulation_id')
      .notNull()
      .references(() => regulations.id, { onDelete: 'cascade' }),
    policyId: integer('policy_id').references(() => policies.id, { onDelete: 'set null' }),
    score: real('score').notNull().default(0),
    status: coverageStatusEnum('status').notNull().default('no_policy'),
    matchedTerms: jsonb('matched_terms').$type<string[]>().notNull().default([]),
    missingTerms: jsonb('missing_terms').$type<string[]>().notNull().default([]),
    contradictoryTerms: jsonb('contradictory_terms').$type<string[]>().notNull().default([]),
    flags: jsonb('flags').$type<string[]>().notNull().default([]),
    alternatives: jsonb('alternatives')
      .$type<Array<{ policyId: number; score: number }>>()
      .notNull()
      .default([]),
    joint: jsonb('joint').$type<{ score: number; policyIds: number[] } | null>(),
    reviewStatus: reviewStatusEnum('review_status').notNull().default('pending'),
    reviewComment: text('review_comment'),
    reviewedById: integer('reviewed_by_id').references(() => users.id, { onDelete: 'set null' }),
    reviewedByName: varchar('reviewed_by_name', { length: 160 }),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    /** Carried-forward decision that no longer matches the current conclusion. */
    /* ---- semantic analysis ---- */
    analysisMethod: varchar('analysis_method', { length: 24 }).notNull().default('deterministic'),
    aiStatus: varchar('ai_status', { length: 24 }),
    aiConfidence: real('ai_confidence'),
    aiExplanation: text('ai_explanation'),
    aiEvidence: jsonb('ai_evidence').$type<Array<Record<string, unknown>>>(),
    aiMissingProvisions: jsonb('ai_missing_provisions').$type<string[]>(),
    aiContradictions: jsonb('ai_contradictions').$type<string[]>(),
    aiModel: varchar('ai_model', { length: 120 }),
    semanticScore: real('semantic_score'),
    aiFallbackReason: varchar('ai_fallback_reason', { length: 200 }),

    needsRereview: jsonb('needs_rereview').$type<{
      review: string;
      by: string;
      comment: string;
      was: string;
    } | null>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    runIdx: index('policy_mappings_run_idx').on(t.runId),
    statusIdx: index('policy_mappings_status_idx').on(t.status),
    reviewIdx: index('policy_mappings_review_idx').on(t.reviewStatus),
    regIdx: index('policy_mappings_regulation_idx').on(t.regulationId),
    polIdx: index('policy_mappings_policy_idx').on(t.policyId),
    runRegUq: uniqueIndex('policy_mappings_run_regulation_uq').on(t.runId, t.regulationId),
  }),
);

/* ------------------------------------------------------------------ *
 * gap_findings
 * ------------------------------------------------------------------ */

export const gapFindings = pgTable(
  'gap_findings',
  {
    id: serial('id').primaryKey(),
    runId: integer('run_id')
      .notNull()
      .references(() => analysisRuns.id, { onDelete: 'cascade' }),
    hospitalId: integer('hospital_id')
      .notNull()
      .references(() => hospitals.id, { onDelete: 'cascade' }),
    mappingId: integer('mapping_id')
      .notNull()
      .references(() => policyMappings.id, { onDelete: 'cascade' }),
    regulationId: integer('regulation_id')
      .notNull()
      .references(() => regulations.id, { onDelete: 'cascade' }),
    policyId: integer('policy_id').references(() => policies.id, { onDelete: 'set null' }),
    coverageStatus: coverageStatusEnum('coverage_status').notNull(),
    score: real('score').notNull().default(0),
    priority: priorityEnum('priority').notNull().default('Medium'),
    action: varchar('action', { length: 160 }).notNull().default(''),
    effort: varchar('effort', { length: 80 }).notNull().default(''),
    suggestedOwner: varchar('suggested_owner', { length: 160 }).notNull().default('Compliance'),
    risk: text('risk').notNull().default(''),
    missingTerms: jsonb('missing_terms').$type<string[]>().notNull().default([]),
    uncoveredClauses: jsonb('uncovered_clauses').$type<string[]>().notNull().default([]),
    steps: jsonb('steps').$type<string[]>().notNull().default([]),
    flags: jsonb('flags').$type<string[]>().notNull().default([]),
    draftLanguage: text('draft_language').notNull().default(''),
    status: gapStatusEnum('status').notNull().default('open'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    runIdx: index('gap_findings_run_idx').on(t.runId),
    priorityIdx: index('gap_findings_priority_idx').on(t.priority),
    statusIdx: index('gap_findings_status_idx').on(t.status),
    mappingUq: uniqueIndex('gap_findings_mapping_uq').on(t.mappingId),
  }),
);

/* ------------------------------------------------------------------ *
 * reviews  (immutable decision log)
 * ------------------------------------------------------------------ */

export const reviews = pgTable(
  'reviews',
  {
    id: serial('id').primaryKey(),
    mappingId: integer('mapping_id')
      .notNull()
      .references(() => policyMappings.id, { onDelete: 'cascade' }),
    runId: integer('run_id')
      .notNull()
      .references(() => analysisRuns.id, { onDelete: 'cascade' }),
    reviewerId: integer('reviewer_id').references(() => users.id, { onDelete: 'set null' }),
    reviewerName: varchar('reviewer_name', { length: 160 }).notNull(),
    reviewerRole: varchar('reviewer_role', { length: 80 }).notNull().default(''),
    decision: reviewDecisionEnum('decision').notNull(),
    comment: text('comment'),
    previousStatus: reviewStatusEnum('previous_status').notNull().default('pending'),
    finalStatus: reviewStatusEnum('final_status').notNull().default('pending'),
    coverageStatus: coverageStatusEnum('coverage_status').notNull(),
    score: real('score').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    mappingIdx: index('reviews_mapping_idx').on(t.mappingId),
    runIdx: index('reviews_run_idx').on(t.runId),
    createdIdx: index('reviews_created_idx').on(t.createdAt),
  }),
);

/* ------------------------------------------------------------------ *
 * remediation_items
 * ------------------------------------------------------------------ */

export const remediationItems = pgTable(
  'remediation_items',
  {
    id: serial('id').primaryKey(),
    hospitalId: integer('hospital_id')
      .notNull()
      .references(() => hospitals.id, { onDelete: 'cascade' }),
    gapId: integer('gap_id')
      .notNull()
      .references(() => gapFindings.id, { onDelete: 'cascade' }),
    title: varchar('title', { length: 260 }).notNull(),
    owner: varchar('owner', { length: 160 }).notNull().default('Compliance'),
    priority: priorityEnum('priority').notNull().default('Medium'),
    risk: text('risk').notNull().default(''),
    status: remediationStatusEnum('status').notNull().default('open'),
    recommendedAction: text('recommended_action').notNull().default(''),
    dueDate: date('due_date'),
    notes: text('notes'),
    createdById: integer('created_by_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    hospitalIdx: index('remediation_items_hospital_idx').on(t.hospitalId),
    gapUq: uniqueIndex('remediation_items_gap_uq').on(t.gapId),
    statusIdx: index('remediation_items_status_idx').on(t.status),
  }),
);

/* ------------------------------------------------------------------ *
 * audit_logs  (append only, sequence numbered per hospital)
 * ------------------------------------------------------------------ */

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: serial('id').primaryKey(),
    hospitalId: integer('hospital_id')
      .notNull()
      .references(() => hospitals.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    category: auditCategoryEnum('category').notNull().default('system'),
    action: varchar('action', { length: 200 }).notNull(),
    object: varchar('object', { length: 240 }),
    detail: text('detail'),
    userId: integer('user_id').references(() => users.id, { onDelete: 'set null' }),
    actorName: varchar('actor_name', { length: 160 }).notNull().default('System'),
    actorRole: varchar('actor_role', { length: 80 }),
    ip: varchar('ip', { length: 64 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    hospitalIdx: index('audit_logs_hospital_idx').on(t.hospitalId),
    categoryIdx: index('audit_logs_category_idx').on(t.category),
    createdIdx: index('audit_logs_created_idx').on(t.createdAt),
    seqUq: uniqueIndex('audit_logs_hospital_seq_uq').on(t.hospitalId, t.seq),
  }),
);

/* ------------------------------------------------------------------ *
 * Relations
 * ------------------------------------------------------------------ */

export const hospitalsRelations = relations(hospitals, ({ many }) => ({
  users: many(users),
  services: many(hospitalServices),
  policies: many(policies),
  regulations: many(regulations),
  runs: many(analysisRuns),
  auditLogs: many(auditLogs),
}));

export const hospitalServicesRelations = relations(hospitalServices, ({ one }) => ({
  hospital: one(hospitals, { fields: [hospitalServices.hospitalId], references: [hospitals.id] }),
}));

export const usersRelations = relations(users, ({ one }) => ({
  hospital: one(hospitals, { fields: [users.hospitalId], references: [hospitals.id] }),
}));

export const policiesRelations = relations(policies, ({ one, many }) => ({
  hospital: one(hospitals, { fields: [policies.hospitalId], references: [hospitals.id] }),
  versions: many(policyVersions),
  mappings: many(policyMappings),
}));

export const policyVersionsRelations = relations(policyVersions, ({ one }) => ({
  policy: one(policies, { fields: [policyVersions.policyId], references: [policies.id] }),
}));

export const regulationsRelations = relations(regulations, ({ one, many }) => ({
  hospital: one(hospitals, { fields: [regulations.hospitalId], references: [hospitals.id] }),
  mappings: many(policyMappings),
}));

export const analysisRunsRelations = relations(analysisRuns, ({ one, many }) => ({
  hospital: one(hospitals, { fields: [analysisRuns.hospitalId], references: [hospitals.id] }),
  runBy: one(users, { fields: [analysisRuns.runById], references: [users.id] }),
  mappings: many(policyMappings),
  gaps: many(gapFindings),
}));

export const policyMappingsRelations = relations(policyMappings, ({ one, many }) => ({
  run: one(analysisRuns, { fields: [policyMappings.runId], references: [analysisRuns.id] }),
  regulation: one(regulations, { fields: [policyMappings.regulationId], references: [regulations.id] }),
  policy: one(policies, { fields: [policyMappings.policyId], references: [policies.id] }),
  reviews: many(reviews),
  gap: one(gapFindings, { fields: [policyMappings.id], references: [gapFindings.mappingId] }),
}));

export const gapFindingsRelations = relations(gapFindings, ({ one }) => ({
  run: one(analysisRuns, { fields: [gapFindings.runId], references: [analysisRuns.id] }),
  mapping: one(policyMappings, { fields: [gapFindings.mappingId], references: [policyMappings.id] }),
  regulation: one(regulations, { fields: [gapFindings.regulationId], references: [regulations.id] }),
  policy: one(policies, { fields: [gapFindings.policyId], references: [policies.id] }),
  remediation: one(remediationItems, { fields: [gapFindings.id], references: [remediationItems.gapId] }),
}));

export const reviewsRelations = relations(reviews, ({ one }) => ({
  mapping: one(policyMappings, { fields: [reviews.mappingId], references: [policyMappings.id] }),
  reviewer: one(users, { fields: [reviews.reviewerId], references: [users.id] }),
}));

export const remediationItemsRelations = relations(remediationItems, ({ one }) => ({
  gap: one(gapFindings, { fields: [remediationItems.gapId], references: [gapFindings.id] }),
}));

export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  hospital: one(hospitals, { fields: [auditLogs.hospitalId], references: [hospitals.id] }),
  user: one(users, { fields: [auditLogs.userId], references: [users.id] }),
}));

/* ------------------------------------------------------------------ *
 * Inferred row types
 * ------------------------------------------------------------------ */

export type Hospital = typeof hospitals.$inferSelect;
export type HospitalService = typeof hospitalServices.$inferSelect;
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Policy = typeof policies.$inferSelect;
export type NewPolicy = typeof policies.$inferInsert;
export type PolicyVersion = typeof policyVersions.$inferSelect;
export type Regulation = typeof regulations.$inferSelect;
export type NewRegulation = typeof regulations.$inferInsert;
export type AnalysisRun = typeof analysisRuns.$inferSelect;
export type PolicyMapping = typeof policyMappings.$inferSelect;
export type GapFinding = typeof gapFindings.$inferSelect;
export type Review = typeof reviews.$inferSelect;
export type RemediationItem = typeof remediationItems.$inferSelect;
export type AuditLog = typeof auditLogs.$inferSelect;

/* ------------------------------------------------------------------ *
 * password_resets
 * ------------------------------------------------------------------ */

/**
 * Only the hash of a reset token is stored, so the table is useless to an
 * attacker who reads it. Tokens are single-use and expire quickly.
 */
export const passwordResets = pgTable(
  'password_resets',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: varchar('token_hash', { length: 128 }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    requestedIp: varchar('requested_ip', { length: 64 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tokenUq: uniqueIndex('password_resets_token_uq').on(t.tokenHash),
    userIdx: index('password_resets_user_idx').on(t.userId),
  }),
);

/* ------------------------------------------------------------------ *
 * Semantic analysis
 * ------------------------------------------------------------------ */

/**
 * Retrievable, citable slices of a policy. Embeddings are jsonb rather than a
 * pgvector column so the schema works on any Postgres; similarity is computed
 * in the application, which is fast enough at this scale.
 */
export const policyChunks = pgTable(
  'policy_chunks',
  {
    id: serial('id').primaryKey(),
    hospitalId: integer('hospital_id')
      .notNull()
      .references(() => hospitals.id, { onDelete: 'cascade' }),
    policyId: integer('policy_id')
      .notNull()
      .references(() => policies.id, { onDelete: 'cascade' }),
    ordinal: integer('ordinal').notNull(),
    sectionLabel: varchar('section_label', { length: 200 }).notNull(),
    text: text('text').notNull(),
    charStart: integer('char_start').notNull().default(0),
    charEnd: integer('char_end').notNull().default(0),
    fingerprint: varchar('fingerprint', { length: 40 }).notNull(),
    embedding: jsonb('embedding').$type<number[]>(),
    embeddingModel: varchar('embedding_model', { length: 120 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    hospitalIdx: index('policy_chunks_hospital_idx').on(t.hospitalId),
    policyIdx: index('policy_chunks_policy_idx').on(t.policyId),
    policyOrdinalUq: uniqueIndex('policy_chunks_policy_ordinal_uq').on(t.policyId, t.ordinal),
  }),
);

export const regulationEmbeddings = pgTable(
  'regulation_embeddings',
  {
    id: serial('id').primaryKey(),
    hospitalId: integer('hospital_id')
      .notNull()
      .references(() => hospitals.id, { onDelete: 'cascade' }),
    regulationId: integer('regulation_id')
      .notNull()
      .references(() => regulations.id, { onDelete: 'cascade' }),
    fingerprint: varchar('fingerprint', { length: 40 }).notNull(),
    embedding: jsonb('embedding').$type<number[]>().notNull(),
    embeddingModel: varchar('embedding_model', { length: 120 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    regulationUq: uniqueIndex('regulation_embeddings_regulation_uq').on(t.regulationId),
  }),
);
