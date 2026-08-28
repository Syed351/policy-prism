/**
 * Reporting. Every row in every export is read from Postgres at request time -
 * there are no cached or synthesised numbers.
 */

import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  COVERAGE_LABEL,
  FLAG_LABEL,
  FindingFlag,
  PRODUCT_DISCLAIMER,
  REPORT_FORMATS,
  REPORT_KINDS,
  REPORT_KIND_LABEL,
  ReportFormat,
  ReportKind,
} from '@policy-prism/shared';
import { db } from '../../db';
import { auditLogs, policies } from '../../db/schema';
import { auth, requireAuth, requirePermission } from '../../middleware/auth';
import { validateQuery } from '../../middleware/error';
import { safeAudit } from '../../services/audit';
import {
  CONTENT_TYPE,
  fileName,
  ReportMeta,
  Sheet,
  toCSV,
  toPDF,
  toXLSX,
} from '../../services/export';
import { getProfile } from '../../services/hospital';
import { ApiError, asyncHandler, ok } from '../../utils/http';
import {
  assertRunBelongs,
  latestRun,
  mappingsForRun,
  runsForHospital,
  tallyCounts,
} from '../analysis/analysis.service';
import { gapsForRun } from '../gaps/gaps.routes';
import { allAuditEntries } from '../audit/audit.routes';
import { toRunDto } from '../analysis/analysis.routes';

export const reportsRouter = Router();

const exportQuery = z.object({
  kind: z.enum(REPORT_KINDS).default('mapping'),
  format: z.enum(REPORT_FORMATS).default('pdf'),
  runId: z.coerce.number().int().positive().optional(),
  /** IANA zone from the browser, so the timestamp reads in the user's time. */
  tz: z.string().trim().max(64).optional(),
});

const pct = (n: number) => `${(n * 100).toFixed(0)}%`;

/* ------------------------------------------------------------------ *
 * GET /api/reports/summary - what the Reports page shows on screen
 * ------------------------------------------------------------------ */

reportsRouter.get(
  '/summary',
  requireAuth,
  asyncHandler(async (req, res) => {
    const a = auth(req);
    const profile = await getProfile(a.hospitalId);
    const run = await latestRun(a.hospitalId);

    if (!run) {
      return ok(res, {
        hasAnalysis: false,
        facility: profile.name,
        disclaimer: PRODUCT_DISCLAIMER,
        kinds: REPORT_KINDS.map((k) => ({ key: k, label: REPORT_KIND_LABEL[k] })),
        formats: REPORT_FORMATS,
      });
    }

    const rows = await mappingsForRun(run.id);
    const counts = tallyCounts(
      rows.map((r) => ({
        status: r.mapping.status,
        flags: r.mapping.flags ?? [],
        reviewStatus: r.mapping.reviewStatus,
        needsRereview: r.mapping.needsRereview,
      })),
    );

    const allPolicies = await db.select().from(policies).where(eq(policies.hospitalId, a.hospitalId));
    const runs = await runsForHospital(a.hospitalId, 30);
    const frameworks = [...new Set(rows.map((r) => r.regulation.framework))];

    return ok(res, {
      hasAnalysis: true,
      facility: profile.name,
      run: toRunDto(run),
      counts,
      frameworks,
      policyCounts: {
        total: allPolicies.length,
        regulatory: allPolicies.filter((p) => p.scope === 'regulatory').length,
        outOfScope: allPolicies.filter((p) => p.scope !== 'regulatory').length,
      },
      runCount: runs.length,
      firstPct: runs.length ? runs[runs.length - 1].coveragePct : run.coveragePct,
      latestPct: run.coveragePct,
      unreviewed: counts.pending,
      needsRereview: counts.needsRereview,
      disclaimer: PRODUCT_DISCLAIMER,
      kinds: REPORT_KINDS.map((k) => ({ key: k, label: REPORT_KIND_LABEL[k] })),
      formats: REPORT_FORMATS,
    });
  }),
);

/* ------------------------------------------------------------------ *
 * Sheet builders
 * ------------------------------------------------------------------ */

async function buildMappingSheet(runId: number): Promise<Sheet> {
  const rows = await mappingsForRun(runId);
  return {
    name: 'Coverage',
    head: [
      'Framework', 'Citation', 'Requirement', 'Coverage', 'Match %', 'Matched policy',
      'Flags', 'Review',
    ],
    widths: [10, 20, 60, 16, 10, 42, 26, 26],
    rows: rows
      .slice()
      .sort((x, y) => x.mapping.score - y.mapping.score)
      .map((r) => {
        const m = r.mapping;
        const noMatch = m.status === 'not_addressed' || m.status === 'no_policy' || !r.policy;
        // Policy code and title in one cell, and the whole review story in
        // another - the reviewer, their comment and any re-review flag. Thirteen
        // narrow columns wrapped into unreadable vertical stacks.
        const policyCell = noMatch
          ? ''
          : [r.policy!.code, r.policy!.title].filter(Boolean).join(' \u00b7 ');

        const reviewCell = [
          m.reviewStatus,
          m.reviewedByName ? `by ${m.reviewedByName}` : '',
          m.reviewComment || '',
          m.needsRereview ? `needs re-review (was ${m.needsRereview.review})` : '',
        ]
          .filter(Boolean)
          .join(' \u00b7 ');

        const flagCell = [
          ((m.flags ?? []) as FindingFlag[]).map((f) => FLAG_LABEL[f]).join('; '),
          (m.contradictoryTerms ?? []).length
            ? `contradicts: ${(m.contradictoryTerms ?? []).join(', ')}`
            : '',
        ]
          .filter(Boolean)
          .join(' \u00b7 ');

        return [
          r.regulation.framework,
          r.regulation.citation,
          r.regulation.title,
          COVERAGE_LABEL[m.status],
          Number((m.score * 100).toFixed(0)),
          policyCell,
          flagCell,
          reviewCell,
        ];
      }),
  };
}

async function buildCoverageSheet(runId: number, hospitalId: number): Promise<Sheet> {
  const rows = await mappingsForRun(runId);
  const counts = tallyCounts(
    rows.map((r) => ({
      status: r.mapping.status,
      flags: r.mapping.flags ?? [],
      reviewStatus: r.mapping.reviewStatus,
      needsRereview: r.mapping.needsRereview,
    })),
  );
  const frameworks = [...new Set(rows.map((r) => r.regulation.framework))];

  const body: Array<Array<string | number>> = frameworks.map((f) => {
    const rs = rows.filter((r) => r.regulation.framework === f);
    const covered = rs.filter((r) => r.mapping.status === 'covered').length;
    const partial = rs.filter((r) => r.mapping.status === 'partial').length;
    const notAddressed = rs.filter((r) => r.mapping.status === 'not_addressed').length;
    const noPolicy = rs.filter((r) => r.mapping.status === 'no_policy').length;
    return [
      f,
      rs.length,
      covered,
      partial,
      notAddressed,
      noPolicy,
      `${Math.round((covered / rs.length) * 100)}%`,
      rs.filter((r) => r.mapping.reviewStatus !== 'pending').length,
    ];
  });

  body.push([
    'All frameworks',
    counts.total,
    counts.covered,
    counts.partial,
    counts.not_addressed,
    counts.no_policy,
    `${counts.coveragePct}%`,
    counts.reviewed,
  ]);

  return {
    name: 'Coverage summary',
    head: ['Framework', 'Requirements', 'Covered', 'Partial', 'Not addressed', 'No policy', 'Coverage', 'Reviewed'],
    widths: [18, 14, 11, 10, 15, 12, 11, 11],
    rows: body,
  };
}

async function buildGapSheet(hospitalId: number, runId: number): Promise<Sheet> {
  const gaps = await gapsForRun(hospitalId, runId);
  return {
    name: 'Gaps',
    head: [
      'Priority', 'Citation', 'Requirement', 'Coverage', 'Match %',
      'Recommended action', 'Owner', 'Status', 'Risk if unresolved',
    ],
    widths: [11, 22, 52, 16, 10, 40, 24, 20, 44],
    rows: gaps.map((g) => [
      g.priority,
      // Framework and citation belong together; splitting them wasted a column.
      `${g.regulation.framework} ${g.regulation.citation}`,
      g.regulation.title,
      COVERAGE_LABEL[g.coverageStatus],
      Number((g.score * 100).toFixed(0)),
      // The action and its target policy read as one instruction.
      [g.action, g.targetPolicyCode ? `\u2192 ${g.targetPolicyCode}` : ''].filter(Boolean).join(' '),
      g.owner,
      [g.status, g.effort].filter(Boolean).join(' \u00b7 '),
      g.risk,
    ]),
  };
}

async function buildRemediationSheet(hospitalId: number, runId: number): Promise<Sheet> {
  const gaps = await gapsForRun(hospitalId, runId);
  return {
    name: 'Remediation',
    head: [
      'Priority', 'Citation', 'Requirement', 'Coverage', 'Action',
      'Owner', 'Tracking', 'Uncovered provisions', 'Risk if unresolved',
    ],
    widths: [11, 22, 46, 14, 38, 22, 26, 60, 40],
    rows: gaps.map((g) => [
      g.priority,
      `${g.regulation.framework} ${g.regulation.citation}`,
      g.regulation.title,
      `${COVERAGE_LABEL[g.coverageStatus]} ${(g.score * 100).toFixed(0)}%`,
      [g.action, g.targetPolicyCode ? `\u2192 ${g.targetPolicyCode}` : ''].filter(Boolean).join(' '),
      g.remediation?.owner ?? g.owner,
      // Status, effort and due date are one story about the work item.
      [
        g.remediation?.status ?? 'not tracked',
        g.effort,
        g.remediation?.dueDate ? `due ${g.remediation.dueDate}` : '',
      ]
        .filter(Boolean)
        .join(' \u00b7 '),
      g.uncoveredClauses.join(' | '),
      g.risk,
    ]),
  };
}

async function buildAuditSheet(hospitalId: number): Promise<Sheet> {
  const rows = await allAuditEntries(hospitalId);
  return {
    name: 'Audit trail',
    head: ['Seq', 'Timestamp', 'Category', 'Action', 'Object', 'Detail', 'User', 'Role'],
    widths: [7, 22, 12, 38, 26, 58, 22, 20],
    rows: rows
      .slice()
      .reverse()
      .map((l) => [
        l.seq,
        l.createdAt.toISOString(),
        l.category,
        l.action,
        l.object ?? '',
        l.detail ?? '',
        l.actorName,
        l.actorRole ?? '',
      ]),
  };
}

async function buildRunsSheet(hospitalId: number): Promise<Sheet> {
  const runs = await runsForHospital(hospitalId, 200);
  return {
    name: 'Analysis history',
    head: [
      'Run', 'When', 'Trigger', 'Scope', 'Library', 'Breakdown', 'Coverage %', 'Change', 'Run by',
    ],
    widths: [8, 30, 18, 46, 20, 46, 14, 20, 26],
    rows: runs
      .slice()
      .reverse()
      .map((r) => [
        r.runNumber,
        r.createdAt.toISOString().replace('T', ' ').slice(0, 16),
        r.trigger,
        r.scopeChanged ? `changed: ${r.scopeDiff ?? 'yes'}` : (r.scopeDiff ?? ''),
        `${r.requirementCount} reqs \u00b7 ${r.policyCount} policies`,
        `${r.covered} covered \u00b7 ${r.partial} partial \u00b7 ${r.notAddressed} not addressed \u00b7 ${r.noPolicy} no policy`,
        r.coveragePct,
        [
          r.coverageDelta !== null && r.coverageDelta !== undefined ? `cov ${r.coverageDelta}` : '',
          r.gapDelta !== null && r.gapDelta !== undefined ? `gaps ${r.gapDelta}` : '',
        ]
          .filter(Boolean)
          .join(' \u00b7 '),
        r.runByName,
      ]),
  };
}

/* ------------------------------------------------------------------ *
 * GET /api/reports/export
 * ------------------------------------------------------------------ */

reportsRouter.get(
  '/export',
  requireAuth,
  requirePermission('export'),
  validateQuery(exportQuery),
  asyncHandler(async (req, res) => {
    const a = auth(req);
    const q = req.query as unknown as z.infer<typeof exportQuery>;
    const profile = await getProfile(a.hospitalId);

    const needsRun: ReportKind[] = ['coverage', 'mapping', 'gaps', 'remediation'];
    let runId: number | null = null;

    if (needsRun.includes(q.kind)) {
      const run = q.runId
        ? await assertRunBelongs(q.runId, a.hospitalId)
        : await latestRun(a.hospitalId);
      if (!run) throw ApiError.badRequest('Run the analysis before exporting this report.');
      runId = run.id;
    }

    let sheets: Sheet[];
    const meta: ReportMeta = {
      title: REPORT_KIND_LABEL[q.kind],
      facility: profile.name,
      generatedBy: `${a.name} \u00b7 ${a.roleLabel}`,
      timeZone: q.tz,
    };

    if (runId) {
      const run = await assertRunBelongs(runId, a.hospitalId);
      const rows = await mappingsForRun(runId);
      const counts = tallyCounts(
        rows.map((r) => ({
          status: r.mapping.status,
          flags: r.mapping.flags ?? [],
          reviewStatus: r.mapping.reviewStatus,
          needsRereview: r.mapping.needsRereview,
        })),
      );

      meta.subtitle =
        `${profile.beds} beds \u00b7 ${profile.facilityType} \u00b7 ${profile.state}` +
        `${profile.medicare ? '  \u00b7  Medicare certified' : ''}${profile.accredited ? '  \u00b7  Accredited' : ''}`;

      meta.summary = [
        ['Run', `${run.runNumber} \u00b7 ${new Date(run.createdAt).toLocaleString()} \u00b7 ${run.trigger}`],
        ['Scope', run.scopeKind === 'full' ? `Full library \u2014 ${counts.total} applicable requirements` : run.label],
        ['Frameworks', [...new Set(rows.map((r) => r.regulation.framework))].join(', ')],
        ['Policies compared', String(run.policyCount)],
        [
          'Coverage',
          `${counts.coveragePct}% \u00b7 ${counts.covered} covered, ${counts.partial} partial, ` +
            `${counts.not_addressed} not addressed, ${counts.no_policy} no policy`,
        ],
        ['Reviewed', `${counts.reviewed} of ${counts.total} confirmed by a person`],
      ];

      meta.warnings = [];
      if (counts.pending) {
        meta.warnings.push(
          `${counts.pending} finding(s) in this report have not been confirmed by a reviewer.`,
        );
      }
      if (counts.conflict) {
        meta.warnings.push(
          `${counts.conflict} finding(s) matched a policy that appears to negate the requirement.`,
        );
      }
      if (counts.needsRereview) {
        meta.warnings.push(
          `${counts.needsRereview} finding(s) were reviewed against wording or a policy match that has since changed.`,
        );
      }
    }

    switch (q.kind) {
      case 'coverage':
        sheets = [await buildCoverageSheet(runId!, a.hospitalId), await buildMappingSheet(runId!)];
        break;
      case 'mapping':
        sheets = [await buildMappingSheet(runId!)];
        break;
      case 'gaps':
        sheets = [await buildGapSheet(a.hospitalId, runId!)];
        break;
      case 'remediation':
        sheets = [await buildRemediationSheet(a.hospitalId, runId!)];
        break;
      case 'audit':
        sheets = [await buildAuditSheet(a.hospitalId)];
        meta.summary = [['Entries', String((await allAuditEntries(a.hospitalId)).length)]];
        break;
      case 'runs':
        sheets = [await buildRunsSheet(a.hospitalId)];
        break;
      default:
        throw ApiError.badRequest('Unknown report kind');
    }

    const rowCount = sheets.reduce((n, s) => n + s.rows.length, 0);
    if (!rowCount && q.kind === 'gaps') {
      throw ApiError.badRequest('No open gaps to export \u2014 every applicable requirement is covered.');
    }

    const name = fileName(q.kind, q.format as ReportFormat);
    let buffer: Buffer;

    if (q.format === 'csv') {
      // CSV is a single flat table, so the primary sheet wins.
      buffer = toCSV(sheets[sheets.length - 1]);
    } else if (q.format === 'xlsx') {
      buffer = await toXLSX(sheets, meta);
    } else {
      buffer = await toPDF(sheets, meta);
    }

    await safeAudit({
      hospitalId: a.hospitalId,
      category: 'export',
      action: `Downloaded ${REPORT_KIND_LABEL[q.kind].toLowerCase()}`,
      object: name,
      detail:
        `Downloaded by ${a.name} (${a.roleLabel}) \u00b7 ${q.format.toUpperCase()} \u00b7 ` +
        `${rowCount} row(s)${runId ? ` \u00b7 from run ${runId}` : ''}` +
        ` \u00b7 ${(buffer.length / 1024).toFixed(0)} KB`,
      actor: a,
      ip: req.ip,
    });

    res.setHeader('Content-Type', CONTENT_TYPE[q.format as ReportFormat]);
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.setHeader('Content-Length', String(buffer.length));
    res.setHeader('X-Report-Rows', String(rowCount));
    res.send(buffer);
  }),
);

/**
 * GET /api/reports/workspace
 * Full JSON snapshot - the prototype's "export workspace", now sourced from the
 * database rather than browser memory.
 */
reportsRouter.get(
  '/workspace',
  requireAuth,
  requirePermission('export'),
  asyncHandler(async (req, res) => {
    const a = auth(req);
    const profile = await getProfile(a.hospitalId);
    const run = await latestRun(a.hospitalId);

    const [allPolicies, logs, runs] = await Promise.all([
      db.select().from(policies).where(eq(policies.hospitalId, a.hospitalId)),
      db.select().from(auditLogs).where(eq(auditLogs.hospitalId, a.hospitalId)),
      runsForHospital(a.hospitalId, 100),
    ]);

    const mappings = run ? await mappingsForRun(run.id) : [];
    const gaps = run ? await gapsForRun(a.hospitalId, run.id) : [];

    const payload = {
      version: 3,
      exportedAt: new Date().toISOString(),
      exportedBy: `${a.name} (${a.roleLabel})`,
      disclaimer: PRODUCT_DISCLAIMER,
      profile,
      policies: allPolicies,
      runs: runs.map(toRunDto),
      latestRun: run ? toRunDto(run) : null,
      mappings: mappings.map((m) => ({
        citation: m.regulation.citation,
        framework: m.regulation.framework,
        requirement: m.regulation.title,
        status: m.mapping.status,
        score: m.mapping.score,
        policyCode: m.policy?.code ?? null,
        reviewStatus: m.mapping.reviewStatus,
        reviewComment: m.mapping.reviewComment,
        reviewedBy: m.mapping.reviewedByName,
      })),
      gaps,
      auditTrail: logs.map((l) => ({
        seq: l.seq,
        at: l.createdAt.toISOString(),
        category: l.category,
        action: l.action,
        object: l.object,
        detail: l.detail,
        by: l.actorName,
      })),
    };

    const name = `policy-prism-workspace-${new Date().toISOString().slice(0, 10)}.json`;

    await safeAudit({
      hospitalId: a.hospitalId,
      category: 'export',
      action: 'Downloaded workspace export',
      object: name,
      detail:
        `Downloaded by ${a.name} (${a.roleLabel}) \u00b7 ${allPolicies.length} policies \u00b7 ` +
        `${mappings.length} mappings \u00b7 ${logs.length} audit entries`,
      actor: a,
      ip: req.ip,
    });

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.send(JSON.stringify(payload, null, 2));
  }),
);
