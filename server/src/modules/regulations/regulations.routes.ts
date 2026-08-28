import { Router } from 'express';
import { and, asc, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { FRAMEWORKS, RegulationDto } from '@policy-prism/shared';
import { db } from '../../db';
import { analysisRuns, policyMappings, regulations } from '../../db/schema';
import { auth, requireAuth, requirePermission } from '../../middleware/auth';
import { validateBody, validateParams, validateQuery } from '../../middleware/error';
import { discardUpload, upload } from '../../middleware/upload';
import { safeAudit } from '../../services/audit';
import { getProfile, toScopeProfile } from '../../services/hospital';
import { assertReadable, ingestRegulationFile } from '../../services/ingest';
import { discardImport, stageImport, stagedRow } from '../../services/import-staging';
import { applies, isUpcoming, ScopeProfile } from '../../services/scope';
import { ApiError, asyncHandler, created, ok } from '../../utils/http';

export const regulationsRouter = Router();

/** Coverage per requirement from the most recent completed run. */
async function coverageMap(hospitalId: number): Promise<Map<number, string>> {
  const [run] = await db
    .select({ id: analysisRuns.id })
    .from(analysisRuns)
    .where(and(eq(analysisRuns.hospitalId, hospitalId), eq(analysisRuns.status, 'completed')))
    .orderBy(desc(analysisRuns.runNumber))
    .limit(1);
  if (!run) return new Map();

  const rows = await db
    .select({ regulationId: policyMappings.regulationId, status: policyMappings.status })
    .from(policyMappings)
    .where(eq(policyMappings.runId, run.id));
  return new Map(rows.map((r) => [r.regulationId, r.status as string]));
}


const idParam = z.object({ id: z.coerce.number().int().positive() });

const applicabilitySchema = z
  .string()
  .trim()
  .max(40)
  .refine(
    (v) =>
      ['always', 'medicare', 'accredited', 'ed', 'lab', 'psych', 'ob', 'swing'].includes(v) ||
      /^state:[A-Z]{2}$/.test(v),
    'Applicability must be one of always, medicare, accredited, ed, lab, psych, ob, swing, or state:XX',
  );

const listQuery = z.object({
  q: z.string().trim().optional(),
  framework: z.enum(FRAMEWORKS).optional(),
  applicability: z.string().trim().optional(),
  /** 'in' = applies to this facility, 'out' = does not, omitted = everything. */
  scope: z.enum(['in', 'out', 'all']).default('all'),
  upcoming: z.coerce.boolean().optional(),
  page: z.coerce.number().int().min(0).default(0),
  perPage: z.coerce.number().int().min(1).max(300).default(100),
});

const createSchema = z.object({
  framework: z.enum(FRAMEWORKS).default('Custom'),
  citation: z.string().trim().min(1, 'Citation is required').max(120),
  title: z.string().trim().min(2, 'Title is required').max(260),
  requirementText: z.string().trim().min(40, 'Requirement text must be at least 40 characters'),
  applicability: applicabilitySchema.default('always'),
  effectiveDate: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
    .nullable()
    .optional(),
  sourceRef: z.string().trim().max(300).nullable().optional(),
  amendedAt: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
    .nullable()
    .optional(),
});

const updateSchema = createSchema.partial();

function toDto(
  row: typeof regulations.$inferSelect,
  profile: ScopeProfile,
  coverage?: Map<number, string>,
): RegulationDto {
  return {
    id: row.id,
    framework: row.framework,
    citation: row.citation,
    title: row.title,
    requirementText: row.requirementText,
    applicability: row.applicability,
    effectiveDate: row.effectiveDate,
    sourceRef: row.sourceRef,
    amendedAt: row.amendedAt,
    source: row.source,
    applies: applies(row, profile),
    upcoming: isUpcoming(row),
    coverageStatus: (coverage?.get(row.id) as RegulationDto['coverageStatus']) ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** GET /api/regulations */
regulationsRouter.get(
  '/',
  requireAuth,
  validateQuery(listQuery),
  asyncHandler(async (req, res) => {
    const a = auth(req);
    const q = req.query as unknown as z.infer<typeof listQuery>;
    const profile = toScopeProfile(await getProfile(a.hospitalId));

    const filters = [eq(regulations.hospitalId, a.hospitalId)];
    if (q.framework) filters.push(eq(regulations.framework, q.framework));
    if (q.applicability) filters.push(eq(regulations.applicability, q.applicability));
    if (q.q) {
      const term = `%${q.q}%`;
      filters.push(
        or(
          ilike(regulations.title, term),
          ilike(regulations.citation, term),
          ilike(regulations.requirementText, term),
        )!,
      );
    }

    const rows = await db
      .select()
      .from(regulations)
      .where(and(...filters))
      .orderBy(asc(regulations.framework), asc(regulations.citation));

    const coverage = await coverageMap(a.hospitalId);
    let dtos = rows.map((r) => toDto(r, profile, coverage));
    if (q.scope === 'in') dtos = dtos.filter((d) => d.applies);
    if (q.scope === 'out') dtos = dtos.filter((d) => !d.applies);
    if (q.upcoming) dtos = dtos.filter((d) => d.upcoming);

    const total = dtos.length;
    const paged = dtos.slice(q.page * q.perPage, q.page * q.perPage + q.perPage);

    const frameworkTally: Record<string, number> = {};
    dtos.forEach((d) => {
      frameworkTally[d.framework] = (frameworkTally[d.framework] || 0) + 1;
    });

    return ok(res, paged, {
      total,
      page: q.page,
      perPage: q.perPage,
      inScope: rows.filter((r) => applies(r, profile)).length,
      library: rows.length,
      frameworkTally,
    });
  }),
);

/** GET /api/regulations/:id */
regulationsRouter.get(
  '/:id',
  requireAuth,
  validateParams(idParam),
  asyncHandler(async (req, res) => {
    const a = auth(req);
    const profile = toScopeProfile(await getProfile(a.hospitalId));
    const [row] = await db
      .select()
      .from(regulations)
      .where(and(eq(regulations.id, Number(req.params.id)), eq(regulations.hospitalId, a.hospitalId)))
      .limit(1);
    if (!row) throw ApiError.notFound('Requirement not found');
    return ok(res, toDto(row, profile));
  }),
);

/** POST /api/regulations */
regulationsRouter.post(
  '/',
  requireAuth,
  requirePermission('edit'),
  validateBody(createSchema),
  asyncHandler(async (req, res) => {
    const a = auth(req);
    const body = req.body as z.infer<typeof createSchema>;
    const profile = toScopeProfile(await getProfile(a.hospitalId));

    const [dupe] = await db
      .select()
      .from(regulations)
      .where(and(eq(regulations.hospitalId, a.hospitalId), eq(regulations.citation, body.citation)))
      .limit(1);
    if (dupe) throw ApiError.conflict(`${body.citation} is already in the library`);

    const [row] = await db
      .insert(regulations)
      .values({
        hospitalId: a.hospitalId,
        framework: body.framework,
        citation: body.citation,
        title: body.title,
        requirementText: body.requirementText,
        applicability: body.applicability,
        effectiveDate: body.effectiveDate ?? null,
        sourceRef: body.sourceRef ?? null,
        amendedAt: body.amendedAt ?? null,
        source: 'authored',
      })
      .returning();

    await safeAudit({
      hospitalId: a.hospitalId,
      category: 'document',
      action: 'Added regulatory requirement',
      object: row.citation,
      detail: `${row.framework} \u00b7 ${row.title} \u00b7 applies to ${row.applicability}`,
      actor: a,
      ip: req.ip,
    });

    return created(res, toDto(row, profile));
  }),
);

/** PATCH /api/regulations/:id */
regulationsRouter.patch(
  '/:id',
  requireAuth,
  requirePermission('edit'),
  validateParams(idParam),
  validateBody(updateSchema),
  asyncHandler(async (req, res) => {
    const a = auth(req);
    const id = Number(req.params.id);
    const body = req.body as z.infer<typeof updateSchema>;
    const profile = toScopeProfile(await getProfile(a.hospitalId));

    const [existing] = await db
      .select()
      .from(regulations)
      .where(and(eq(regulations.id, id), eq(regulations.hospitalId, a.hospitalId)))
      .limit(1);
    if (!existing) throw ApiError.notFound('Requirement not found');

    const textChanged =
      body.requirementText !== undefined && body.requirementText !== existing.requirementText;

    const [row] = await db
      .update(regulations)
      .set({
        framework: body.framework ?? existing.framework,
        citation: body.citation ?? existing.citation,
        title: body.title ?? existing.title,
        requirementText: body.requirementText ?? existing.requirementText,
        applicability: body.applicability ?? existing.applicability,
        effectiveDate: body.effectiveDate !== undefined ? body.effectiveDate : existing.effectiveDate,
        sourceRef: body.sourceRef !== undefined ? body.sourceRef : existing.sourceRef,
        // Amending the wording stamps the amendment date so the dashboard can
        // flag findings that were reviewed against the old text.
        amendedAt:
          body.amendedAt !== undefined
            ? body.amendedAt
            : textChanged
              ? new Date().toISOString().slice(0, 10)
              : existing.amendedAt,
        updatedAt: new Date(),
      })
      .where(eq(regulations.id, id))
      .returning();

    await safeAudit({
      hospitalId: a.hospitalId,
      category: 'document',
      action: textChanged ? 'Amended requirement text' : 'Updated requirement',
      object: row.citation,
      detail: textChanged
        ? `${existing.requirementText.length} \u2192 ${row.requirementText.length} chars. Findings reviewed against the old text need re-confirmation.`
        : `${row.framework} \u00b7 applies to ${row.applicability}`,
      actor: a,
      ip: req.ip,
    });

    return ok(res, toDto(row, profile), { textChanged });
  }),
);

/** DELETE /api/regulations/:id */
regulationsRouter.delete(
  '/:id',
  requireAuth,
  requirePermission('edit'),
  validateParams(idParam),
  asyncHandler(async (req, res) => {
    const a = auth(req);
    const id = Number(req.params.id);

    const [existing] = await db
      .select()
      .from(regulations)
      .where(and(eq(regulations.id, id), eq(regulations.hospitalId, a.hospitalId)))
      .limit(1);
    if (!existing) throw ApiError.notFound('Requirement not found');

    await db.delete(regulations).where(eq(regulations.id, id));

    await safeAudit({
      hospitalId: a.hospitalId,
      category: 'document',
      action: 'Removed regulatory requirement',
      object: existing.citation,
      detail: `${existing.framework} \u00b7 ${existing.title}`,
      actor: a,
      ip: req.ip,
    });

    return ok(res, { id, deleted: true });
  }),
);

/** POST /api/regulations/upload */
regulationsRouter.post(
  '/upload',
  requireAuth,
  requirePermission('edit'),
  upload.array('files', 10),
  asyncHandler(async (req, res) => {
    const a = auth(req);
    const files = (req.files as Express.Multer.File[]) ?? [];
    if (!files.length) throw ApiError.badRequest('Attach at least one file under the field name "files"');

    // Preview: parse and report what WOULD be imported. Documents split into
    // many requirements, and parsing picks up noise, so the user checks first.
    if (String((req.query as Record<string, unknown>).preview ?? '') === 'true') {
      const items: Array<Record<string, unknown>> = [];
      const previewErrors: string[] = [];
      const staged: Array<[string, unknown]> = [];

      const existing = await db
        .select({ id: regulations.id, citation: regulations.citation, title: regulations.title })
        .from(regulations)
        .where(eq(regulations.hospitalId, a.hospitalId));
      const byCitation = new Map(existing.map((e) => [e.citation.toLowerCase(), e]));

      for (const file of files) {
        const result = await ingestRegulationFile(file.path, file.originalname);
        previewErrors.push(...result.errors);
        result.found.forEach((r, i) => {
          const match = byCitation.get(String(r.citation).toLowerCase());
          const key = `${file.originalname}:${i}`;
          staged.push([key, r]);
          items.push({
            key,
            framework: r.framework,
            citation: r.citation,
            title: r.title,
            // Snippet only: the full text stays on the server. Shipping every
            // requirement twice is what made a large import crawl.
            snippet: r.requirementText.slice(0, 220),
            textLength: r.requirementText.length,
            applicability: r.applicability,
            fileName: file.originalname,
            existingId: match?.id ?? null,
            existingTitle: match?.title ?? null,
          });
        });
      }

      // Flag repeats within the upload so the user can see them before import.
      const seen = new Map<string, number>();
      items.forEach((i) => {
        const key = String(i.citation).toLowerCase();
        seen.set(key, (seen.get(key) ?? 0) + 1);
      });
      items.forEach((i) => {
        i.duplicateInFile = (seen.get(String(i.citation).toLowerCase()) ?? 0) > 1;
      });

      files.forEach((f) => discardUpload(f.path));
      const importId = stageImport(a.hospitalId, staged);

      return ok(res, items, {
        importId,
        errors: previewErrors,
        currentCount: existing.length,
        existingMatches: items.filter((i) => i.existingId).length,
        duplicatesInFile: items.filter((i) => i.duplicateInFile).length,
        preview: true,
      });
    }

    const profile = toScopeProfile(await getProfile(a.hospitalId));
    const inserted: RegulationDto[] = [];
    const errors: string[] = [];
    const skipped: string[] = [];

    try {
      const existing = await db
        .select({ citation: regulations.citation })
        .from(regulations)
        .where(eq(regulations.hospitalId, a.hospitalId));
      const seen = new Set(existing.map((e) => e.citation));

      for (const file of files) {
        const result = await ingestRegulationFile(file.path, file.originalname);
        errors.push(...result.errors);

        for (const r of result.found) {
          if (seen.has(r.citation)) {
            skipped.push(r.citation);
            continue;
          }
          seen.add(r.citation);

          const [row] = await db
            .insert(regulations)
            .values({
              hospitalId: a.hospitalId,
              framework: r.framework,
              citation: r.citation,
              title: r.title,
              requirementText: r.requirementText,
              applicability: /^state:[A-Z]{2}$/.test(r.applicability) ? r.applicability : 'always',
              source: 'upload',
              fileName: file.originalname,
            })
            .returning();
          inserted.push(toDto(row, profile));
        }
        // The requirement text is stored in Postgres; the raw file is not needed.
        discardUpload(file.path);
      }
    } catch (err) {
      files.forEach((f) => discardUpload(f.path));
      throw err;
    }

    if (!inserted.length && !skipped.length) {
      assertReadable({ found: inserted, errors });
    }

    await safeAudit({
      hospitalId: a.hospitalId,
      category: 'document',
      action: 'Imported regulatory requirements',
      object: files.map((f) => f.originalname).join(', ').slice(0, 240),
      detail: `${inserted.length} added${skipped.length ? ` \u00b7 ${skipped.length} duplicate citation(s) skipped` : ''}${errors.length ? ` \u00b7 ${errors.length} error(s)` : ''}`,
      actor: a,
      ip: req.ip,
    });

    return created(res, inserted, { errors, skipped });
  }),
);

/**
 * POST /api/regulations/import-commit
 * Writes the requirements confirmed in the import preview. Amending an existing
 * citation keeps one entry and stamps it, preserving its wording history.
 */
const regImportItemSchema = z.object({
  /** Key from the preview; the requirement text is fetched from staging. */
  key: z.string().trim().min(1).max(400),
  framework: z.enum(FRAMEWORKS).default('Custom'),
  citation: z.string().trim().min(1).max(120),
  title: z.string().trim().min(1).max(260),
  applicability: z.string().trim().max(40).default('always'),
});

const regImportCommitSchema = z.object({
  importId: z.string().trim().min(1).max(64),
  mode: z.enum(['replace', 'append']).default('append'),
  items: z.array(regImportItemSchema).min(1, 'Select at least one requirement').max(20000),
});

regulationsRouter.post(
  '/import-commit',
  requireAuth,
  requirePermission('edit'),
  validateBody(regImportCommitSchema),
  asyncHandler(async (req, res) => {
    const a = auth(req);
    const body = req.body as z.infer<typeof regImportCommitSchema>;
    const profile = toScopeProfile(await getProfile(a.hospitalId));

    // Rehydrate the parsed text from staging; the client sent keys and edits.
    type Staged = { requirementText: string; fileName?: string };
    const resolved = body.items.map((i) => {
      const staged = stagedRow<Staged>(body.importId, a.hospitalId, i.key);
      if (!staged) {
        throw ApiError.badRequest(
          'This import has expired. Upload the file again and confirm within 30 minutes.',
        );
      }
      return { ...i, requirementText: staged.requirementText, fileName: staged.fileName };
    });

    let removed = 0;
    let amended = 0;
    let collapsed = 0;
    const inserted: RegulationDto[] = [];

    await db.transaction(async (tx) => {
      if (body.mode === 'replace') {
        const gone = await tx
          .delete(regulations)
          .where(eq(regulations.hospitalId, a.hospitalId))
          .returning({ id: regulations.id });
        removed = gone.length;
      }

      const existing = await tx
        .select({ id: regulations.id, citation: regulations.citation, requirementText: regulations.requirementText })
        .from(regulations)
        .where(eq(regulations.hospitalId, a.hospitalId));
      const byCitation = new Map(existing.map((e) => [e.citation.toLowerCase(), e]));

      // A single document often repeats a citation, and one requirement can
      // only exist once per facility. Collapse duplicates within the import,
      // keeping the last occurrence, before touching the database.
      const deduped = new Map<string, (typeof resolved)[number]>();
      resolved.forEach((r) => deduped.set(r.citation.toLowerCase(), r));
      collapsed = resolved.length - deduped.size;
      const unique = [...deduped.values()];

      // Split into amendments and new rows so the new ones insert in one
      // statement instead of one round trip each.
      const fresh = unique.filter((r) => !byCitation.get(r.citation.toLowerCase()));
      const updates = unique.filter((r) => byCitation.get(r.citation.toLowerCase()));

      const CHUNK = 500;
      for (let i = 0; i < fresh.length; i += CHUNK) {
        const rows = await tx
          .insert(regulations)
          .values(
            fresh.slice(i, i + CHUNK).map((r) => ({
              hospitalId: a.hospitalId,
              framework: r.framework,
              citation: r.citation,
              title: r.title,
              requirementText: r.requirementText,
              applicability: r.applicability,
              source: 'upload' as const,
              fileName: r.fileName ?? null,
              createdById: a.id,
            })),
          )
          .returning();
        rows.forEach((row) => inserted.push(toDto(row, profile)));
      }

      for (const r of updates) {
        const match = byCitation.get(r.citation.toLowerCase());

        if (match) {
          // One entry per citation: amend in place and stamp the change.
          const changed = match.requirementText !== r.requirementText;
          const [row] = await tx
            .update(regulations)
            .set({
              framework: r.framework,
              title: r.title,
              requirementText: r.requirementText,
              applicability: r.applicability,
              amendedAt: changed ? new Date().toISOString().slice(0, 10) : undefined,
              updatedAt: new Date(),
            })
            .where(eq(regulations.id, match.id))
            .returning();
          inserted.push(toDto(row, profile));
          if (changed) amended += 1;
        }
      }
    });

    await safeAudit({
      hospitalId: a.hospitalId,
      category: 'document',
      action: body.mode === 'replace' ? 'Replaced requirement library' : 'Imported requirements',
      object: `${inserted.length} requirements`,
      detail:
        `${removed} removed \u00b7 ${amended} amended \u00b7 ${inserted.length - amended} new` +
        (collapsed ? ` \u00b7 ${collapsed} duplicate citation(s) collapsed` : ''),
      actor: a,
      ip: req.ip,
    });

    discardImport(body.importId);
    return created(res, inserted, {
      imported: inserted.length,
      removed,
      amended,
      collapsed,
      mode: body.mode,
    });
  }),
);
