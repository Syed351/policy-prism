/**
 * Policy Prism - shared domain vocabulary.
 *
 * Every label, threshold and enum in this file is carried over from the
 * Policy Prism prototype so the backend, the database and the UI all speak
 * exactly the same language.
 */

/* ------------------------------------------------------------------ *
 * Coverage classification
 * ------------------------------------------------------------------ */

export const COVERAGE_STATUSES = ['covered', 'partial', 'not_addressed', 'no_policy'] as const;
export type CoverageStatus = (typeof COVERAGE_STATUSES)[number];

/** Human labels exactly as the prototype rendered them. */
export const COVERAGE_LABEL: Record<CoverageStatus, string> = {
  covered: 'Covered',
  partial: 'Partial',
  not_addressed: 'Not addressed',
  no_policy: 'No policy',
};

/** Short description of what each class actually means. */
export const COVERAGE_MEANING: Record<CoverageStatus, string> = {
  covered: 'A policy demonstrably answers this obligation.',
  partial: 'Mapped to a policy but the language is thin.',
  not_addressed: 'A policy exists on the subject but is silent on this.',
  no_policy: 'Nothing in the library covers this subject.',
};

/** Pill styling key used by the UI. */
export const COVERAGE_PILL: Record<CoverageStatus, 'cov' | 'par' | 'gap'> = {
  covered: 'cov',
  partial: 'par',
  not_addressed: 'gap',
  no_policy: 'gap',
};

export const isGap = (s: CoverageStatus): boolean => s === 'not_addressed' || s === 'no_policy';
export const isOpen = (s: CoverageStatus): boolean => s !== 'covered';

/* ------------------------------------------------------------------ *
 * Engine thresholds (prototype values - do not drift)
 * ------------------------------------------------------------------ */

export const TH_COV = 0.68;
export const TH_PAR = 0.34;
export const TH_TOPIC = 0.12;
export const TH_EDGE = 0.05;
/** A policy older than this many months is administratively stale. */
export const REVIEW_MONTHS = 36;
/** How many tokens after a negation cue stay "negated". */
export const NEG_SPAN = 7;

export const ANALYSIS_STEPS = [
  'Reading hospital profile',
  'Resolving applicable frameworks',
  'Indexing policy corpus',
  'Tokenizing regulatory clauses',
  'Computing semantic similarity',
  'Classifying coverage',
  'Building review queue',
];

/* ------------------------------------------------------------------ *
 * Finding flags
 * ------------------------------------------------------------------ */

export const FINDING_FLAGS = ['borderline', 'stale', 'unproven', 'conflict', 'joint'] as const;
export type FindingFlag = (typeof FINDING_FLAGS)[number];

export const FLAG_LABEL: Record<FindingFlag, string> = {
  borderline: 'Borderline',
  stale: 'Policy overdue for review',
  unproven: 'Cannot be proven',
  conflict: 'Contradicts requirement',
  joint: 'Covered jointly',
};

/* ------------------------------------------------------------------ *
 * Review workflow
 * ------------------------------------------------------------------ */

export const REVIEW_STATUSES = ['pending', 'approved', 'rejected'] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export const REVIEW_DECISIONS = ['approve', 'reject', 'reset', 'comment'] as const;
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];

/* ------------------------------------------------------------------ *
 * Roles and permissions (prototype ROLES map)
 * ------------------------------------------------------------------ */

export const ROLE_KEYS = ['admin', 'reviewer', 'analyst', 'viewer'] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];

export type Permission = 'edit' | 'review' | 'profile' | 'run' | 'export';

export interface RoleDefinition {
  label: string;
  can: Record<Permission, boolean>;
}

export const ROLES: Record<RoleKey, RoleDefinition> = {
  admin: {
    label: 'Compliance manager',
    can: { edit: true, review: true, profile: true, run: true, export: true },
  },
  reviewer: {
    label: 'Compliance reviewer',
    can: { edit: false, review: true, profile: false, run: true, export: true },
  },
  analyst: {
    label: 'Policy analyst',
    can: { edit: true, review: false, profile: true, run: true, export: true },
  },
  viewer: {
    label: 'Auditor (read only)',
    can: { edit: false, review: false, profile: false, run: false, export: true },
  },
};

export const can = (role: RoleKey | undefined | null, permission: Permission): boolean =>
  !!(role && ROLES[role] && ROLES[role].can[permission]);

/* ------------------------------------------------------------------ *
 * Facility profile
 * ------------------------------------------------------------------ */

export const STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME',
  'MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA',
  'RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY',
] as const;
export type StateCode = (typeof STATES)[number];

export const SERVICE_KEYS = ['ed', 'lab', 'psych', 'ob', 'swing'] as const;
export type ServiceKey = (typeof SERVICE_KEYS)[number];

export interface ServiceDefinition {
  key: ServiceKey;
  name: string;
  description: string;
}

export const SERVICES: ServiceDefinition[] = [
  { key: 'ed', name: 'Emergency department', description: 'Brings EMTALA and CMS emergency services into scope' },
  { key: 'lab', name: 'Clinical laboratory', description: 'Brings CLIA into scope' },
  { key: 'psych', name: 'Psychiatric unit', description: 'Brings CMS psychiatric conditions into scope' },
  { key: 'ob', name: 'Obstetrics', description: 'Labor and delivery screening duties' },
  { key: 'swing', name: 'Swing beds', description: 'Long term care requirements' },
];

export const FACILITY_TYPES = [
  'Acute care hospital',
  'Critical access hospital',
  'Psychiatric hospital',
  'Rehabilitation hospital',
  'Long term care hospital',
  'Children\u2019s hospital',
] as const;

/* ------------------------------------------------------------------ *
 * Regulatory library
 * ------------------------------------------------------------------ */

export const FRAMEWORKS = ['CMS', 'HIPAA', 'EMTALA', 'CLIA', 'State', 'TJC', 'Custom'] as const;
export type Framework = (typeof FRAMEWORKS)[number];

/** Enforcement weight, drives remediation priority. */
export const FW_WEIGHT: Record<Framework, number> = {
  CMS: 3, EMTALA: 3, HIPAA: 3, CLIA: 2, State: 2, TJC: 2, Custom: 1,
};

/** What is actually at stake if the gap stays open. */
export const FW_RISK: Record<Framework, string> = {
  CMS: 'Condition-level deficiency on survey; risk to Medicare participation.',
  EMTALA: 'Civil monetary penalties per violation and possible termination.',
  HIPAA: 'OCR enforcement and civil penalties per violation category.',
  CLIA: 'Sanctions on the laboratory certificate, up to suspension of testing.',
  State: 'State licensing citation, plan of correction, possible fine.',
  TJC: 'Accreditation finding; Requirement for Improvement and follow-up survey.',
  Custom: 'Internal standard \u2014 risk set by your own governance.',
};

/** Applicability keys. `state:XX` is also valid and matched by prefix. */
export const APPLICABILITY_OPTIONS: Array<[string, string]> = [
  ['always', 'All facilities'],
  ['accredited', 'Accredited facilities only'],
  ['medicare', 'Medicare certified only'],
  ['ed', 'Emergency department'],
  ['lab', 'Clinical laboratory'],
  ['psych', 'Psychiatric unit'],
  ['ob', 'Obstetrics'],
  ['swing', 'Swing beds'],
  ['state', 'This state only'],
];

/* ------------------------------------------------------------------ *
 * Policies
 * ------------------------------------------------------------------ */

export const POLICY_SCOPES = ['regulatory', 'operational', 'governance'] as const;
export type PolicyScope = (typeof POLICY_SCOPES)[number];

export const POLICY_SCOPE_OPTIONS: Array<[PolicyScope, string]> = [
  ['regulatory', 'Regulatory \u2014 answers an obligation'],
  ['operational', 'Operational \u2014 internal working rule'],
  ['governance', 'Governance \u2014 required by internal governance'],
];

export const POLICY_SCOPE_LABEL: Record<PolicyScope, string> = {
  regulatory: 'Regulatory',
  operational: 'Operational',
  governance: 'Governance',
};

export const POLICY_STATUSES = ['draft', 'active', 'archived'] as const;
export type PolicyStatus = (typeof POLICY_STATUSES)[number];

export const DOC_SOURCES = ['demo', 'upload', 'authored', 'import'] as const;
export type DocSource = (typeof DOC_SOURCES)[number];

/* ------------------------------------------------------------------ *
 * Gaps and remediation
 * ------------------------------------------------------------------ */

export const PRIORITIES = ['Critical', 'High', 'Medium'] as const;
export type Priority = (typeof PRIORITIES)[number];

export const PRIORITY_ORDER: Record<Priority, number> = { Critical: 0, High: 1, Medium: 2 };

export const GAP_STATUSES = ['open', 'in_progress', 'resolved', 'accepted_risk'] as const;
export type GapStatus = (typeof GAP_STATUSES)[number];

export const GAP_STATUS_LABEL: Record<GapStatus, string> = {
  open: 'Open',
  in_progress: 'In progress',
  resolved: 'Resolved',
  accepted_risk: 'Risk accepted',
};

export const REMEDIATION_STATUSES = ['open', 'in_progress', 'blocked', 'completed', 'cancelled'] as const;
export type RemediationStatus = (typeof REMEDIATION_STATUSES)[number];

export const REMEDIATION_STATUS_LABEL: Record<RemediationStatus, string> = {
  open: 'Open',
  in_progress: 'In progress',
  blocked: 'Blocked',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

/* ------------------------------------------------------------------ *
 * Analysis runs
 * ------------------------------------------------------------------ */

export const RUN_STATUSES = ['running', 'completed', 'failed'] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const RUN_TRIGGERS = ['Manual run', 'Profile change', 'Document import', 'Policy revision'] as const;
export type RunTrigger = (typeof RUN_TRIGGERS)[number];

export const RUN_SCOPE_KINDS = ['full', 'selection'] as const;
export type RunScopeKind = (typeof RUN_SCOPE_KINDS)[number];

/* ------------------------------------------------------------------ *
 * Audit trail
 * ------------------------------------------------------------------ */

export const AUDIT_CATEGORIES = ['document', 'analysis', 'review', 'profile', 'export', 'system'] as const;
export type AuditCategory = (typeof AUDIT_CATEGORIES)[number];

export const AUDIT_CATEGORY_LABEL: Record<AuditCategory, string> = {
  document: 'Document',
  analysis: 'Analysis',
  review: 'Review',
  profile: 'Profile',
  export: 'Export',
  system: 'System',
};

/* ------------------------------------------------------------------ *
 * Reports
 * ------------------------------------------------------------------ */

export const REPORT_KINDS = ['coverage', 'mapping', 'gaps', 'remediation', 'audit', 'runs'] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

export const REPORT_FORMATS = ['pdf', 'xlsx', 'csv'] as const;
export type ReportFormat = (typeof REPORT_FORMATS)[number];

export const REPORT_KIND_LABEL: Record<ReportKind, string> = {
  coverage: 'Coverage summary',
  mapping: 'Mapping report',
  gaps: 'Gap report',
  remediation: 'Remediation plan',
  audit: 'Audit trail',
  runs: 'Analysis history',
};

/* ------------------------------------------------------------------ *
 * API envelope
 * ------------------------------------------------------------------ */

export interface ApiSuccess<T> {
  success: true;
  data: T;
  meta?: Record<string, unknown>;
}

export interface ApiFailure {
  success: false;
  error: {
    message: string;
    code?: string;
    details?: unknown;
  };
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

/* ------------------------------------------------------------------ *
 * Transport shapes shared by client and server
 * ------------------------------------------------------------------ */

export interface AuthUser {
  id: number;
  email: string;
  name: string;
  role: RoleKey;
  roleLabel: string;
  hospitalId: number;
  /** False when an administrator has suspended the account. */
  isActive?: boolean;
  permissions: Record<Permission, boolean>;
}

export interface HospitalProfile {
  id: number;
  name: string;
  beds: number;
  state: string;
  facilityType: string;
  licenseType: string;
  medicare: boolean;
  accredited: boolean;
  services: Record<ServiceKey, boolean>;
  createdAt: string;
  updatedAt: string;
}

export interface RegulationDto {
  /** Coverage from the latest analysis run, or null if never analysed. */
  coverageStatus?: CoverageStatus | null;
  id: number;
  framework: Framework;
  citation: string;
  title: string;
  requirementText: string;
  applicability: string;
  effectiveDate: string | null;
  sourceRef: string | null;
  amendedAt: string | null;
  source: DocSource;
  applies: boolean;
  upcoming: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PolicyVersionDto {
  id: number;
  version: string;
  text: string;
  effectiveDate: string | null;
  supersededAt: string | null;
  authorName: string | null;
}

export interface PolicyDto {
  id: number;
  code: string;
  title: string;
  owner: string;
  version: string;
  effectiveDate: string | null;
  status: PolicyStatus;
  scope: PolicyScope;
  text: string;
  source: DocSource;
  fileName: string | null;
  monthsSinceEffective: number | null;
  stale: boolean;
  versions?: PolicyVersionDto[];
  createdAt: string;
  updatedAt: string;
}

export interface MappingAlternative {
  policyId: number | null;
  policyCode: string | null;
  policyTitle: string | null;
  score: number;
}

/** One quoted, located piece of policy text supporting an AI conclusion. */
export interface AiEvidenceDto {
  policyId: number;
  policyCode: string;
  policyTitle: string;
  policyVersion: string;
  sectionLabel: string;
  quote: string;
}

export const AI_STATUS_LABEL: Record<string, string> = {
  covered: 'Fully covers the requirement',
  partial: 'Partially covers the requirement',
  not_addressed: 'Does not address the requirement',
  no_policy: 'No policy on this subject',
  contradicted: 'Contradicts the requirement',
  insufficient_evidence: 'Insufficient evidence to determine',
};

export interface MappingDto {
  /** How this finding was reached. */
  analysisMethod?: 'semantic' | 'deterministic';
  aiStatus?: string | null;
  aiConfidence?: number | null;
  aiExplanation?: string | null;
  aiEvidence?: AiEvidenceDto[] | null;
  aiMissingProvisions?: string[] | null;
  aiContradictions?: string[] | null;
  aiModel?: string | null;
  semanticScore?: number | null;
  /** Why the deterministic result is being shown instead. */
  aiFallbackReason?: string | null;
  id: number;
  runId: number;
  regulationId: number;
  policyId: number | null;
  score: number;
  status: CoverageStatus;
  matchedTerms: string[];
  missingTerms: string[];
  contradictoryTerms: string[];
  flags: FindingFlag[];
  alternatives: MappingAlternative[];
  joint: { score: number; policyIds: number[] } | null;
  reviewStatus: ReviewStatus;
  reviewComment: string | null;
  reviewedByName: string | null;
  reviewedAt: string | null;
  needsRereview: { review: ReviewStatus; by: string; comment: string; was: string } | null;
  regulation: Pick<RegulationDto, 'id' | 'framework' | 'citation' | 'title' | 'requirementText' | 'applicability' | 'amendedAt' | 'effectiveDate'>;
  policy: Pick<PolicyDto, 'id' | 'code' | 'title' | 'owner' | 'version' | 'effectiveDate' | 'text'> | null;
}

export interface RemediationPlan {
  action: string;
  effort: string;
  priority: Priority;
  owner: string;
  risk: string;
  targetPolicyId: number | null;
  targetPolicyCode: string | null;
  targetPolicyVersion: string | null;
  missingTerms: string[];
  uncoveredClauses: string[];
  steps: string[];
  draft: string;
}

export interface GapDto extends RemediationPlan {
  id: number;
  runId: number;
  mappingId: number;
  regulationId: number;
  policyId: number | null;
  status: GapStatus;
  score: number;
  coverageStatus: CoverageStatus;
  flags: FindingFlag[];
  notes: string | null;
  regulation: Pick<RegulationDto, 'id' | 'framework' | 'citation' | 'title' | 'requirementText'>;
  remediation: RemediationItemDto | null;
  createdAt: string;
  updatedAt: string;
}

export interface RemediationItemDto {
  id: number;
  gapId: number;
  title: string;
  owner: string;
  priority: Priority;
  risk: string;
  status: RemediationStatus;
  recommendedAction: string;
  dueDate: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AnalysisRunDto {
  id: number;
  runNumber: number;
  status: RunStatus;
  trigger: string;
  scopeKind: RunScopeKind;
  label: string;
  facilityName: string;
  requirementCount: number;
  policyCount: number;
  covered: number;
  partial: number;
  notAddressed: number;
  noPolicy: number;
  gaps: number;
  coveragePct: number;
  durationMs: number;
  scopeChanged: boolean;
  scopeDiff: string | null;
  coverageDelta: number | null;
  gapDelta: number | null;
  runByName: string;
  createdAt: string;
}

export interface CoverageCounts {
  covered: number;
  partial: number;
  not_addressed: number;
  no_policy: number;
  gap: number;
  open: number;
  conflict: number;
  stale: number;
  total: number;
  coveragePct: number;
  reviewed: number;
  pending: number;
  approved: number;
  rejected: number;
  needsRereview: number;
}

export interface FrameworkBreakdown {
  framework: string;
  total: number;
  covered: number;
  partial: number;
  gap: number;
}

export interface DashboardDto {
  hasAnalysis: boolean;
  /**
   * False when this run's per-requirement detail no longer exists, because the
   * requirements it referenced were deleted. Headline totals still apply.
   */
  detailAvailable?: boolean;
  run: AnalysisRunDto | null;
  runs: AnalysisRunDto[];
  counts: CoverageCounts;
  byFramework: FrameworkBreakdown[];
  strip: Array<{ regulationId: number; citation: string; status: CoverageStatus; score: number }>;
  riskiestGaps: Array<{ mappingId: number; regulationId: number; framework: string; citation: string; title: string; score: number }>;
  upcomingRegulations: Array<{ id: number; framework: string; citation: string; title: string; effectiveDate: string; status: CoverageStatus | null }>;
  amendedRegulations: Array<{ id: number; citation: string; amendedAt: string }>;
  remediation: Record<RemediationStatus, number>;
  activity: AuditEntryDto[];
  policyCount: number;
  regulationCount: number;
  inScopeCount: number;
}

export interface AuditEntryDto {
  id: number;
  seq: number;
  category: AuditCategory;
  action: string;
  object: string | null;
  detail: string | null;
  actorName: string;
  actorRole: string | null;
  createdAt: string;
}

export interface PolicyCheckDto {
  policy: Pick<PolicyDto, 'id' | 'code' | 'title' | 'owner' | 'version' | 'effectiveDate' | 'scope'>;
  verdict: 'meets' | 'partly' | 'insufficient' | 'unmatched';
  verdictLabel: string;
  covered: number;
  partial: number;
  weak: number;
  contra: number;
  hits: Array<{ regulationId: number; citation: string; title: string; framework: string; score: number; status: CoverageStatus; best: boolean }>;
  related: Array<{ regulationId: number; citation: string; title: string; framework: string; score: number }>;
}

export const POLICY_VERDICT_LABEL: Record<PolicyCheckDto['verdict'], string> = {
  meets: 'Meets its requirements',
  partly: 'Partly meets',
  insufficient: 'Insufficient',
  unmatched: 'No regulatory match',
};

/* ------------------------------------------------------------------ *
 * Product positioning - shown in the UI and printed on every report.
 * ------------------------------------------------------------------ */

export const PRODUCT_DISCLAIMER =
  'Policy Prism is a policy analysis and coverage assessment tool. It reports how well ' +
  'your policy language lines up with a regulatory requirement library. It is not a ' +
  'legally certified compliance engine and its output is not a compliance determination. ' +
  'Nothing becomes a finding until a person reviews it.';

export const PRODUCT_FOOTER = 'Policy Prism \u00b7 policy coverage, not a compliance certification';
