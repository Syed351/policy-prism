import { Router } from 'express';
import { and, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { AUDIT_CATEGORIES, AUDIT_CATEGORY_LABEL, AuditEntryDto } from '@policy-prism/shared';
import { db } from '../../db';
import { auditLogs } from '../../db/schema';
import { auth, requireAuth } from '../../middleware/auth';
import { validateQuery } from '../../middleware/error';
import { asyncHandler, ok } from '../../utils/http';

export const auditRouter = Router();

const listQuery = z.object({
  q: z.string().trim().optional(),
  category: z.enum(AUDIT_CATEGORIES).optional(),
  page: z.coerce.number().int().min(0).default(0),
  perPage: z.coerce.number().int().min(1).max(200).default(60),
});

export function toAuditDto(row: typeof auditLogs.$inferSelect): AuditEntryDto {
  return {
    id: row.id,
    seq: row.seq,
    category: row.category,
    action: row.action,
    object: row.object,
    detail: row.detail,
    actorName: row.actorName,
    actorRole: row.actorRole,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * GET /api/audit
 * Readable by every role including the read-only auditor - that is the point of
 * the trail. Entries are append-only and numbered per facility, so a missing
 * sequence number is visible.
 */
auditRouter.get(
  '/',
  requireAuth,
  validateQuery(listQuery),
  asyncHandler(async (req, res) => {
    const a = auth(req);
    const q = req.query as unknown as z.infer<typeof listQuery>;

    const filters = [eq(auditLogs.hospitalId, a.hospitalId)];
    if (q.category) filters.push(eq(auditLogs.category, q.category));
    if (q.q) {
      const term = `%${q.q}%`;
      filters.push(
        or(
          ilike(auditLogs.action, term),
          ilike(auditLogs.object, term),
          ilike(auditLogs.detail, term),
          ilike(auditLogs.actorName, term),
        )!,
      );
    }

    const where = and(...filters);

    const [rows, [countRow], tallyRows, [totalRow]] = await Promise.all([
      db
        .select()
        .from(auditLogs)
        .where(where)
        .orderBy(desc(auditLogs.seq))
        .limit(q.perPage)
        .offset(q.page * q.perPage),
      db.select({ count: sql<number>`count(*)::int` }).from(auditLogs).where(where),
      db
        .select({ category: auditLogs.category, count: sql<number>`count(*)::int` })
        .from(auditLogs)
        .where(eq(auditLogs.hospitalId, a.hospitalId))
        .groupBy(auditLogs.category),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(auditLogs)
        .where(eq(auditLogs.hospitalId, a.hospitalId)),
    ]);

    const tally: Record<string, number> = {};
    AUDIT_CATEGORIES.forEach((c) => {
      tally[c] = 0;
    });
    tallyRows.forEach((r) => {
      tally[r.category] = Number(r.count);
    });

    return ok(res, rows.map(toAuditDto), {
      total: Number(countRow?.count ?? 0),
      grandTotal: Number(totalRow?.count ?? 0),
      page: q.page,
      perPage: q.perPage,
      tally,
      categories: AUDIT_CATEGORIES.map((c) => ({ key: c, label: AUDIT_CATEGORY_LABEL[c], count: tally[c] })),
      note: 'Entries are append-only and numbered in sequence, so a missing number is visible.',
    });
  }),
);

/** GET /api/audit/:seq - a single entry by its sequence number. */
auditRouter.get(
  '/:seq',
  requireAuth,
  asyncHandler(async (req, res) => {
    const a = auth(req);
    const seq = Number(req.params.seq);
    const [row] = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.hospitalId, a.hospitalId), eq(auditLogs.seq, seq)))
      .limit(1);
    if (!row) return ok(res, null, { message: `No entry numbered ${seq}` });
    return ok(res, toAuditDto(row));
  }),
);

export async function allAuditEntries(hospitalId: number) {
  return db
    .select()
    .from(auditLogs)
    .where(eq(auditLogs.hospitalId, hospitalId))
    .orderBy(desc(auditLogs.seq));
}
