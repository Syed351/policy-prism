import { Router } from 'express';
import { and, asc, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  DOC_SOURCES,
  PolicyDto,
  POLICY_SCOPES,
  POLICY_STATUSES,
  REVIEW_MONTHS,
} from '@policy-prism/shared';
import { db } from '../../db';
import { policies, policyVersions, users } from '../../db/schema';
import { auth, requireAuth, requirePermission } from '../../middleware/auth';
import { validateBody, validateParams, validateQuery } from '../../middleware/error';
import { discardUpload, upload } from '../../middleware/upload';
import { safeAudit } from '../../services/audit';
import { monthsSince } from '../../services/engine';
import { assertReadable, ingestPolicyFile } from '../../services/ingest';
import { ApiError, asyncHandler, created, ok } from '../../utils/http';

export const policiesRouter = Router();

const idParam = z.object({ id: z.coerce.number().int().positive() });

const listQuery = z.object({
  q: z.string().trim().optional(),
  scope: z.enum(POLICY_SCOPES).optional(),
  status: z.enum(POLICY_STATUSES).optional(),
  owner: z.string().trim().optional(),
  source: z.enum(DOC_SOURCES).optional(),
  page: z.coerce.number().int().min(0).default(0),
  perPage: z.coerce.number().int().min(1).max(200).default(50),
  sort: z.enum(['title', 'code', 'owner', 'effectiveDate', 'updatedAt']).default('code'),
  dir: z.enum(['asc', 'desc']).default('asc'),
});

const createSchema = z.object({
  code: z.string().trim().max(60).default(''),
  title: z.string().trim().min(2, 'Title is required').max(240),
  owner: z.string().trim().max(160).default('Unassigned'),
  version: z.string().trim().max(24).default('1.0'),
  effectiveDate: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
    .optional()
    .nullable(),
  status: z.enum(POLICY_STATUSES).default('active'),
  scope: z.enum(POLICY_SCOPES).default('regulatory'),
  text: z.string().trim().min(40, 'A policy needs at least a short paragraph of text (40 characters)'),
});

const updateSchema = createSchema.partial().extend({
  /** When true the previous text is filed as a superseded version. */
  keepVersionHistory: z.boolean().default(true),
});

/** Version bump identical to the prototype's bumpVer(). */
export function bumpVersion(v: string): string {
  const m = String(v || '').match(/^(\d+)\.(\d+)$/);
  if (m) return `${m[1]}.${Number(m[2]) + 1}`;
  const n = String(v || '').match(/^(\d+)$/);
  if (n) return `${n[1]}.1`;
  return String(v || '1.0');
}

function toDto(row: typeof policies.$inferSelect): PolicyDto {
  const age = monthsSince(row.effectiveDate);
  return {
    id: row.id,
    code: row.code,
    title: row.title,
    owner: row.owner,
    version: row.version,
    effectiveDate: row.effectiveDate,
    status: row.status,
    scope: row.scope,
    text: row.text,
    source: row.source,
    fileName: row.fileName,
    monthsSinceEffective: age,
    stale: age !== null && age > REVIEW_MONTHS,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** GET /api/policies */
policiesRouter.get(
  '/',
  requireAuth,
  validateQuery(listQuery),
  asyncHandler(async (req, res) => {
    const a = auth(req);
    const q = req.query as unknown as z.infer<typeof listQuery>;

    const filters = [eq(policies.hospitalId, a.hospitalId)];
    if (q.scope) filters.push(eq(policies.scope, q.scope));
    if (q.status) filters.push(eq(policies.status, q.status));
    if (q.source) filters.push(eq(policies.source, q.source));
    if (q.owner) filters.push(ilike(policies.owner, `%${q.owner}%`));
    if (q.q) {
      const term = `%${q.q}%`;
      filters.push(
        or(
          ilike(policies.title, term),
          ilike(policies.code, term),
          ilike(policies.owner, term),
          ilike(policies.text, term),
        )!,
      );
    }

    const where = and(...filters);
    const column = {
      title: policies.title,
      code: policies.code,
      owner: policies.owner,
      effectiveDate: policies.effectiveDate,
      updatedAt: policies.updatedAt,
    }[q.sort];

    const [rows, [countRow]] = await Promise.all([
      db
        .select()
        .from(policies)
        .where(where)
        .orderBy(q.dir === 'desc' ? desc(column) : asc(column))
        .limit(q.perPage)
        .offset(q.page * q.perPage),
      db.select({ count: sql<number>`count(*)::int` }).from(policies).where(where),
    ]);

    const [tally] = await db
      .select({
        total: sql<number>`count(*)::int`,
        regulatory: sql<number>`count(*) FILTER (WHERE ${policies.scope} = 'regulatory')::int`,
        operational: sql<number>`count(*) FILTER (WHERE ${policies.scope} = 'operational')::int`,
        governance: sql<number>`count(*) FILTER (WHERE ${policies.scope} = 'governance')::int`,
      })
      .from(policies)
      .where(eq(policies.hospitalId, a.hospitalId));

    return ok(res, rows.map(toDto), {
      total: Number(countRow?.count ?? 0),
      page: q.page,
      perPage: q.perPage,
      tally,
    });
  }),
);

/** GET /api/policies/:id */
policiesRouter.get(
  '/:id',
  requireAuth,
  validateParams(idParam),
  asyncHandler(async (req, res) => {
    const a = auth(req);
    const id = Number(req.params.id);

    const [row] = await db
      .select()
      .from(policies)
      .where(and(eq(policies.id, id), eq(policies.hospitalId, a.hospitalId)))
      .limit(1);
    if (!row) throw ApiError.notFound('Policy not found');

    const versions = await db
      .select()
      .from(policyVersions)
      .where(eq(policyVersions.policyId, id))
      .orderBy(desc(policyVersions.createdAt));

    const dto = toDto(row);
    dto.versions = versions.map((v) => ({
      id: v.id,
      version: v.version,
      text: v.text,
      effectiveDate: v.effectiveDate,
      supersededAt: v.supersededAt ? v.supersededAt.toISOString() : null,
      authorName: v.authorName,
    }));

    return ok(res, dto);
  }),
);

/** POST /api/policies */
policiesRouter.post(
  '/',
  requireAuth,
  requirePermission('edit'),
  validateBody(createSchema),
  asyncHandler(async (req, res) => {
    const a = auth(req);
    const body = req.body as z.infer<typeof createSchema>;

    const [row] = await db
      .insert(policies)
      .values({
        hospitalId: a.hospitalId,
        code: body.code,
        title: body.title,
        owner: body.owner || 'Unassigned',
        version: body.version || '1.0',
        effectiveDate: body.effectiveDate ?? new Date().toISOString().slice(0, 10),
        status: body.status,
        scope: body.scope,
        text: body.text,
        source: 'authored',
        createdById: a.id,
      })
      .returning();

    await db.insert(policyVersions).values({
      policyId: row.id,
      version: row.version,
      text: row.text,
      effectiveDate: row.effectiveDate,
      authorId: a.id,
      authorName: a.name,
    });

    await safeAudit({
      hospitalId: a.hospitalId,
      category: 'document',
      action: 'Created policy',
      object: row.code || row.title,
      detail: `v${row.version} \u00b7 owner ${row.owner} \u00b7 ${row.scope}`,
      actor: a,
      ip: req.ip,
    });

    return created(res, toDto(row));
  }),
);

/**
 * PATCH /api/policies/:id
 * Saving supersedes the previous version rather than overwriting it - the old
 * text goes to version history, which is what an auditor will ask for.
 */
policiesRouter.patch(
  '/:id',
  requireAuth,
  requirePermission('edit'),
  validateParams(idParam),
  validateBody(updateSchema),
  asyncHandler(async (req, res) => {
    const a = auth(req);
    const id = Number(req.params.id);
    const body = req.body as z.infer<typeof updateSchema>;

    const [existing] = await db
      .select()
      .from(policies)
      .where(and(eq(policies.id, id), eq(policies.hospitalId, a.hospitalId)))
      .limit(1);
    if (!existing) throw ApiError.notFound('Policy not found');

    const textChanged = body.text !== undefined && body.text !== existing.text;

    if (textChanged && body.keepVersionHistory !== false) {
      await db.insert(policyVersions).values({
        policyId: existing.id,
        version: existing.version,
        text: existing.text,
        effectiveDate: existing.effectiveDate,
        supersededAt: new Date(),
        authorId: a.id,
        authorName: a.name,
      });
    }

    const nextVersion =
      body.version ?? (textChanged ? bumpVersion(existing.version) : existing.version);

    const [row] = await db
      .update(policies)
      .set({
        code: body.code ?? existing.code,
        title: body.title ?? existing.title,
        owner: body.owner ?? existing.owner,
        version: nextVersion,
        effectiveDate: body.effectiveDate ?? existing.effectiveDate,
        status: body.status ?? existing.status,
        scope: body.scope ?? existing.scope,
        text: body.text ?? existing.text,
        updatedAt: new Date(),
      })
      .where(eq(policies.id, id))
      .returning();

    if (textChanged) {
      await db.insert(policyVersions).values({
        policyId: row.id,
        version: row.version,
        text: row.text,
        effectiveDate: row.effectiveDate,
        authorId: a.id,
        authorName: a.name,
      });
    }

    await safeAudit({
      hospitalId: a.hospitalId,
      category: 'document',
      action: 'Revised policy',
      object: row.code || row.title,
      detail: textChanged
        ? `v${existing.version} \u2192 v${row.version} \u00b7 ${existing.text.length} \u2192 ${row.text.length} chars`
        : 'Metadata updated',
      actor: a,
      ip: req.ip,
    });

    return ok(res, toDto(row), {
      textChanged,
      note: textChanged
        ? 'Re-run the analysis to see whether this revision closes any gaps.'
        : null,
    });
  }),
);

/** DELETE /api/policies/:id */
policiesRouter.delete(
  '/:id',
  requireAuth,
  requirePermission('edit'),
  validateParams(idParam),
  asyncHandler(async (req, res) => {
    const a = auth(req);
    const id = Number(req.params.id);

    const [existing] = await db
      .select()
      .from(policies)
      .where(and(eq(policies.id, id), eq(policies.hospitalId, a.hospitalId)))
      .limit(1);
    if (!existing) throw ApiError.notFound('Policy not found');

    await db.delete(policies).where(eq(policies.id, id));

    await safeAudit({
      hospitalId: a.hospitalId,
      category: 'document',
      action: 'Deleted policy',
      object: existing.code || existing.title,
      detail: `v${existing.version} \u00b7 owner ${existing.owner}. Historic mappings keep the citation but lose the policy link.`,
      actor: a,
      ip: req.ip,
    });

    return ok(res, { id, deleted: true });
  }),
);

/**
 * POST /api/policies/upload
 * Accepts .txt/.md/.csv/.tsv/.json/.docx. A CSV or JSON file can carry many
 * policies; a prose document becomes one.
 */
policiesRouter.post(
  '/upload',
  requireAuth,
  requirePermission('edit'),
  upload.array('files', 10),
  asyncHandler(async (req, res) => {
    const a = auth(req);
    const files = (req.files as Express.Multer.File[]) ?? [];
    if (!files.length) throw ApiError.badRequest('Attach at least one file under the field name "files"');

    // Preview mode parses the files and reports what WOULD be imported, so the
    // user can review, rename and deselect rows before anything is written.
    if (String((req.query as Record<string, unknown>).preview ?? '') === 'true') {
      const items: Array<Record<string, unknown>> = [];
      const previewErrors: string[] = [];

      const existing = await db
        .select({ id: policies.id, code: policies.code, title: policies.title })
        .from(policies)
        .where(eq(policies.hospitalId, a.hospitalId));
      const byCode = new Map(existing.filter((e) => e.code).map((e) => [e.code.toLowerCase(), e]));

      for (const file of files) {
        const result = await ingestPolicyFile(file.path, file.originalname);
        previewErrors.push(...result.errors);
        result.found.forEach((p, i) => {
          const match = p.code ? byCode.get(p.code.toLowerCase()) : undefined;
          items.push({
            key: `${file.originalname}:${i}`,
            code: p.code,
            title: p.title,
            owner: p.owner,
            version: p.version,
            effectiveDate: p.effectiveDate,
            scope: p.scope,
            text: p.text,
            fileName: file.originalname,
            existingId: match?.id ?? null,
            existingTitle: match?.title ?? null,
          });
        });
      }

      files.forEach((f) => discardUpload(f.path));
      return ok(res, items, {
        errors: previewErrors,
        currentCount: existing.length,
        preview: true,
      });
    }

    const inserted: PolicyDto[] = [];
    const errors: string[] = [];

    try {
      for (const file of files) {
        const result = await ingestPolicyFile(file.path, file.originalname);
        errors.push(...result.errors);

        if (!result.found.length) continue;

        const rows = await db
          .insert(policies)
          .values(
            result.found.map((p) => ({
              hospitalId: a.hospitalId,
              code: p.code,
              title: p.title,
              owner: p.owner,
              version: p.version,
              effectiveDate: p.effectiveDate,
              scope: p.scope,
              status: 'active' as const,
              text: p.text,
              source: 'upload' as const,
              fileName: file.originalname,
              filePath: file.path,
              fileSize: file.size,
              createdById: a.id,
            })),
          )
          .returning();

        await db.insert(policyVersions).values(
          rows.map((row) => ({
            policyId: row.id,
            version: row.version,
            text: row.text,
            effectiveDate: row.effectiveDate,
            authorId: a.id,
            authorName: a.name,
          })),
        );

        rows.forEach((row) => inserted.push(toDto(row)));
      }
    } catch (err) {
      files.forEach((f) => discardUpload(f.path));
      throw err;
    }

    if (!inserted.length) {
      files.forEach((f) => discardUpload(f.path));
      assertReadable({ found: inserted, errors });
    }

    await safeAudit({
      hospitalId: a.hospitalId,
      category: 'document',
      action: 'Uploaded policy documents',
      object: files.map((f) => f.originalname).join(', ').slice(0, 240),
      detail: `${inserted.length} polic${inserted.length === 1 ? 'y' : 'ies'} added${errors.length ? ` \u00b7 ${errors.length} file(s) rejected` : ''}`,
      actor: a,
      ip: req.ip,
    });

    return created(res, inserted, {
      errors,
      note: 'Re-run the analysis to map these documents against the requirement library.',
    });
  }),
);

/** GET /api/policies/:id/versions */
policiesRouter.get(
  '/:id/versions',
  requireAuth,
  validateParams(idParam),
  asyncHandler(async (req, res) => {
    const a = auth(req);
    const id = Number(req.params.id);

    const [row] = await db
      .select()
      .from(policies)
      .where(and(eq(policies.id, id), eq(policies.hospitalId, a.hospitalId)))
      .limit(1);
    if (!row) throw ApiError.notFound('Policy not found');

    const versions = await db
      .select({
        id: policyVersions.id,
        version: policyVersions.version,
        text: policyVersions.text,
        effectiveDate: policyVersions.effectiveDate,
        supersededAt: policyVersions.supersededAt,
        authorName: policyVersions.authorName,
        authorEmail: users.email,
      })
      .from(policyVersions)
      .leftJoin(users, eq(users.id, policyVersions.authorId))
      .where(eq(policyVersions.policyId, id))
      .orderBy(desc(policyVersions.createdAt));

    return ok(res, versions);
  }),
);

/**
 * POST /api/policies/import-commit
 * Writes the rows the user confirmed in the import preview. `replace` clears
 * the existing library first - the prototype's "Replace the policy set".
 */
const importItemSchema = z.object({
  code: z.string().trim().max(60).default(''),
  title: z.string().trim().min(1).max(260),
  owner: z.string().trim().max(160).default('Unassigned'),
  version: z.string().trim().max(20).default('1.0'),
  effectiveDate: z.string().trim().nullable().optional(),
  scope: z.enum(POLICY_SCOPES).default('regulatory'),
  text: z.string().trim().min(40, 'Policy text must be at least 40 characters'),
  fileName: z.string().trim().max(260).optional(),
});

const importCommitSchema = z.object({
  mode: z.enum(['replace', 'append']).default('append'),
  items: z.array(importItemSchema).min(1, 'Select at least one row to import').max(5000),
});

policiesRouter.post(
  '/import-commit',
  requireAuth,
  requirePermission('edit'),
  validateBody(importCommitSchema),
  asyncHandler(async (req, res) => {
    const a = auth(req);
    const body = req.body as z.infer<typeof importCommitSchema>;

    let removed = 0;
    const inserted: PolicyDto[] = [];

    await db.transaction(async (tx) => {
      if (body.mode === 'replace') {
        const gone = await tx
          .delete(policies)
          .where(eq(policies.hospitalId, a.hospitalId))
          .returning({ id: policies.id });
        removed = gone.length;
      }

      // Two statements for the whole import, not two per row. On a remote
      // database a per-row loop is one network round trip each - hundreds of
      // rows took minutes.
      const CHUNK = 500;
      // Policy codes are not unique-constrained, but importing the same code
      // twice in one file is almost always a mistake in the source document.
      const items = body.items;
      for (let i = 0; i < items.length; i += CHUNK) {
        const slice = items.slice(i, i + CHUNK);

        const rows = await tx
          .insert(policies)
          .values(
            slice.map((p) => ({
              hospitalId: a.hospitalId,
              code: p.code,
              title: p.title,
              owner: p.owner,
              version: p.version,
              effectiveDate: p.effectiveDate || null,
              scope: p.scope,
              status: 'active' as const,
              text: p.text,
              source: 'upload' as const,
              fileName: p.fileName ?? null,
              createdById: a.id,
            })),
          )
          .returning();

        await tx.insert(policyVersions).values(
          rows.map((row) => ({
            policyId: row.id,
            version: row.version,
            text: row.text,
            effectiveDate: row.effectiveDate,
            authorId: a.id,
            authorName: a.name,
          })),
        );

        rows.forEach((row) => inserted.push(toDto(row)));
      }
    });

    await safeAudit({
      hospitalId: a.hospitalId,
      category: 'document',
      action: body.mode === 'replace' ? 'Replaced policy set' : 'Imported policies',
      object: `${inserted.length} policies`,
      detail:
        body.mode === 'replace'
          ? `${removed} removed, ${inserted.length} imported`
          : `${inserted.length} added to the existing library`,
      actor: a,
      ip: req.ip,
    });

    return created(res, inserted, { imported: inserted.length, removed, mode: body.mode });
  }),
);
