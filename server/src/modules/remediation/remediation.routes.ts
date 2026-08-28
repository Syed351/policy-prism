/**
 * Remediation tracking.
 *
 * A gap finding says what is wrong. A remediation item is the piece of work
 * somebody owns to fix it: owner, priority, risk, due date and status.
 */

import { Router } from 'express';
import { and, asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  PRIORITIES,
  PRIORITY_ORDER,
  Priority,
  REMEDIATION_STATUSES,
  RemediationItemDto,
  RemediationStatus,
} from '@policy-prism/shared';
import { db } from '../../db';
import { gapFindings, regulations, remediationItems } from '../../db/schema';
import { auth, requireAuth, requirePermission } from '../../middleware/auth';
import { validateBody, validateParams, validateQuery } from '../../middleware/error';
import { safeAudit } from '../../services/audit';
import { ApiError, asyncHandler, created, ok } from '../../utils/http';
import { latestRun } from '../analysis/analysis.service';

export const remediationRouter = Router();

const idParam = z.object({ id: z.coerce.number().int().positive() });

const listQuery = z.object({
  status: z.enum(REMEDIATION_STATUSES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  owner: z.string().trim().optional(),
  runId: z.coerce.number().int().positive().optional(),
});

const createSchema = z.object({
  gapId: z.coerce.number().int().positive(),
  title: z.string().trim().max(260).optional(),
  owner: z.string().trim().max(160).optional(),
  priority: z.enum(PRIORITIES).optional(),
  risk: z.string().trim().max(2000).optional(),
  recommendedAction: z.string().trim().max(2000).optional(),
  dueDate: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
    .nullable()
    .optional(),
  notes: z.string().trim().max(4000).nullable().optional(),
});

const updateSchema = z.object({
  title: z.string().trim().max(260).optional(),
  owner: z.string().trim().max(160).optional(),
  priority: z.enum(PRIORITIES).optional(),
  risk: z.string().trim().max(2000).optional(),
  status: z.enum(REMEDIATION_STATUSES).optional(),
  recommendedAction: z.string().trim().max(2000).optional(),
  dueDate: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
    .nullable()
    .optional(),
  notes: z.string().trim().max(4000).nullable().optional(),
});

function toDto(row: typeof remediationItems.$inferSelect): RemediationItemDto {
  return {
    id: row.id,
    gapId: row.gapId,
    title: row.title,
    owner: row.owner,
    priority: row.priority,
    risk: row.risk,
    status: row.status,
    recommendedAction: row.recommendedAction,
    dueDate: row.dueDate,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Default due date: Critical in 30 days, High 60, Medium 90. */
function defaultDueDate(priority: Priority): string {
  const days = priority === 'Critical' ? 30 : priority === 'High' ? 60 : 90;
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/** GET /api/remediation */
remediationRouter.get(
  '/',
  requireAuth,
  validateQuery(listQuery),
  asyncHandler(async (req, res) => {
    const a = auth(req);
    const q = req.query as unknown as z.infer<typeof listQuery>;

    const filters = [eq(remediationItems.hospitalId, a.hospitalId)];
    if (q.status) filters.push(eq(remediationItems.status, q.status));
    if (q.priority) filters.push(eq(remediationItems.priority, q.priority));

    let rows = await db
      .select({ item: remediationItems, gap: gapFindings, regulation: regulations })
      .from(remediationItems)
      .innerJoin(gapFindings, eq(gapFindings.id, remediationItems.gapId))
      .innerJoin(regulations, eq(regulations.id, gapFindings.regulationId))
      .where(and(...filters))
      .orderBy(asc(remediationItems.dueDate));

    if (q.owner) {
      const needle = q.owner.toLowerCase();
      rows = rows.filter((r) => r.item.owner.toLowerCase().includes(needle));
    }
    if (q.runId) rows = rows.filter((r) => r.gap.runId === q.runId);

    rows.sort(
      (x, y) =>
        PRIORITY_ORDER[x.item.priority as Priority] - PRIORITY_ORDER[y.item.priority as Priority] ||
        String(x.item.dueDate ?? '9999').localeCompare(String(y.item.dueDate ?? '9999')),
    );

    const tally = {} as Record<RemediationStatus, number>;
    REMEDIATION_STATUSES.forEach((s) => {
      tally[s] = 0;
    });
    rows.forEach((r) => {
      tally[r.item.status] += 1;
    });

    const today = new Date().toISOString().slice(0, 10);

    return ok(
      res,
      rows.map((r) => ({
        ...toDto(r.item),
        overdue:
          !!r.item.dueDate && r.item.dueDate < today && r.item.status !== 'completed' && r.item.status !== 'cancelled',
        citation: r.regulation.citation,
        framework: r.regulation.framework,
        requirementTitle: r.regulation.title,
        coverageStatus: r.gap.coverageStatus,
        gapStatus: r.gap.status,
      })),
      { total: rows.length, tally },
    );
  }),
);

/**
 * POST /api/remediation
 * Opens a tracked item for a gap. Defaults are lifted from the engine's plan so
 * the user does not retype the owner, risk and action it already worked out.
 */
remediationRouter.post(
  '/',
  requireAuth,
  requirePermission('edit'),
  validateBody(createSchema),
  asyncHandler(async (req, res) => {
    const a = auth(req);
    const body = req.body as z.infer<typeof createSchema>;

    const [row] = await db
      .select({ gap: gapFindings, regulation: regulations })
      .from(gapFindings)
      .innerJoin(regulations, eq(regulations.id, gapFindings.regulationId))
      .where(and(eq(gapFindings.id, body.gapId), eq(gapFindings.hospitalId, a.hospitalId)))
      .limit(1);
    if (!row) throw ApiError.notFound('Gap not found');

    const [existing] = await db
      .select()
      .from(remediationItems)
      .where(eq(remediationItems.gapId, body.gapId))
      .limit(1);
    if (existing) throw ApiError.conflict('A remediation item already exists for this gap');

    const priority = body.priority ?? (row.gap.priority as Priority);

    const [item] = await db
      .insert(remediationItems)
      .values({
        hospitalId: a.hospitalId,
        gapId: body.gapId,
        title: body.title ?? `${row.regulation.citation} \u2014 ${row.regulation.title}`,
        owner: body.owner ?? row.gap.suggestedOwner,
        priority,
        risk: body.risk ?? row.gap.risk,
        recommendedAction: body.recommendedAction ?? row.gap.action,
        dueDate: body.dueDate !== undefined ? body.dueDate : defaultDueDate(priority),
        notes: body.notes ?? null,
        status: 'open',
        createdById: a.id,
      })
      .returning();

    await db
      .update(gapFindings)
      .set({ status: 'in_progress', updatedAt: new Date() })
      .where(eq(gapFindings.id, body.gapId));

    await safeAudit({
      hospitalId: a.hospitalId,
      category: 'review',
      action: 'Opened remediation item',
      object: row.regulation.citation,
      detail: `${item.priority} \u00b7 owner ${item.owner} \u00b7 due ${item.dueDate ?? 'unset'}`,
      actor: a,
      ip: req.ip,
    });

    return created(res, toDto(item));
  }),
);

/** PATCH /api/remediation/:id */
remediationRouter.patch(
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
      .from(remediationItems)
      .where(and(eq(remediationItems.id, id), eq(remediationItems.hospitalId, a.hospitalId)))
      .limit(1);
    if (!existing) throw ApiError.notFound('Remediation item not found');

    const [item] = await db
      .update(remediationItems)
      .set({
        title: body.title ?? existing.title,
        owner: body.owner ?? existing.owner,
        priority: body.priority ?? existing.priority,
        risk: body.risk ?? existing.risk,
        status: body.status ?? existing.status,
        recommendedAction: body.recommendedAction ?? existing.recommendedAction,
        dueDate: body.dueDate !== undefined ? body.dueDate : existing.dueDate,
        notes: body.notes !== undefined ? body.notes : existing.notes,
        updatedAt: new Date(),
      })
      .where(eq(remediationItems.id, id))
      .returning();

    // Completing the work moves the underlying gap along too.
    if (body.status && body.status !== existing.status) {
      const gapStatus =
        body.status === 'completed' ? 'resolved' : body.status === 'cancelled' ? 'accepted_risk' : 'in_progress';
      await db
        .update(gapFindings)
        .set({ status: gapStatus, updatedAt: new Date() })
        .where(eq(gapFindings.id, existing.gapId));
    }

    const changes: string[] = [];
    if (body.status && body.status !== existing.status) changes.push(`Status ${existing.status} \u2192 ${body.status}`);
    if (body.owner && body.owner !== existing.owner) changes.push(`Owner ${existing.owner} \u2192 ${body.owner}`);
    if (body.priority && body.priority !== existing.priority) {
      changes.push(`Priority ${existing.priority} \u2192 ${body.priority}`);
    }
    if (body.dueDate !== undefined && body.dueDate !== existing.dueDate) {
      changes.push(`Due ${existing.dueDate ?? 'unset'} \u2192 ${body.dueDate ?? 'unset'}`);
    }

    await safeAudit({
      hospitalId: a.hospitalId,
      category: 'review',
      action: 'Updated remediation item',
      object: item.title.slice(0, 200),
      detail: changes.length ? changes.join(' \u00b7 ') : 'Details updated',
      actor: a,
      ip: req.ip,
    });

    return ok(res, toDto(item));
  }),
);

/** DELETE /api/remediation/:id */
remediationRouter.delete(
  '/:id',
  requireAuth,
  requirePermission('edit'),
  validateParams(idParam),
  asyncHandler(async (req, res) => {
    const a = auth(req);
    const id = Number(req.params.id);

    const [existing] = await db
      .select()
      .from(remediationItems)
      .where(and(eq(remediationItems.id, id), eq(remediationItems.hospitalId, a.hospitalId)))
      .limit(1);
    if (!existing) throw ApiError.notFound('Remediation item not found');

    await db.delete(remediationItems).where(eq(remediationItems.id, id));
    await db
      .update(gapFindings)
      .set({ status: 'open', updatedAt: new Date() })
      .where(eq(gapFindings.id, existing.gapId));

    await safeAudit({
      hospitalId: a.hospitalId,
      category: 'review',
      action: 'Removed remediation item',
      object: existing.title.slice(0, 200),
      detail: `Gap returned to open`,
      actor: a,
      ip: req.ip,
    });

    return ok(res, { id, deleted: true });
  }),
);

/**
 * POST /api/remediation/bulk-open
 * Opens tracked items for every gap in the current run that does not have one.
 * Turns a gap report into an owned work list in a single action.
 */
remediationRouter.post(
  '/bulk-open',
  requireAuth,
  requirePermission('edit'),
  asyncHandler(async (req, res) => {
    const a = auth(req);
    const run = await latestRun(a.hospitalId);
    if (!run) throw ApiError.badRequest('Run the analysis before opening remediation items.');

    const rows = await db
      .select({ gap: gapFindings, regulation: regulations, item: remediationItems })
      .from(gapFindings)
      .innerJoin(regulations, eq(regulations.id, gapFindings.regulationId))
      .leftJoin(remediationItems, eq(remediationItems.gapId, gapFindings.id))
      .where(and(eq(gapFindings.hospitalId, a.hospitalId), eq(gapFindings.runId, run.id)));

    const pending = rows.filter((r) => !r.item);
    if (!pending.length) {
      return ok(res, [], { created: 0, message: 'Every gap in this run already has a remediation item.' });
    }

    const inserted = await db
      .insert(remediationItems)
      .values(
        pending.map((r) => ({
          hospitalId: a.hospitalId,
          gapId: r.gap.id,
          title: `${r.regulation.citation} \u2014 ${r.regulation.title}`,
          owner: r.gap.suggestedOwner,
          priority: r.gap.priority,
          risk: r.gap.risk,
          recommendedAction: r.gap.action,
          dueDate: defaultDueDate(r.gap.priority as Priority),
          status: 'open' as const,
          createdById: a.id,
        })),
      )
      .returning();

    await db
      .update(gapFindings)
      .set({ status: 'in_progress', updatedAt: new Date() })
      .where(
        and(
          eq(gapFindings.runId, run.id),
          sql`${gapFindings.id} IN (${sql.join(pending.map((p) => sql`${p.gap.id}`), sql`, `)})`,
        ),
      );

    await safeAudit({
      hospitalId: a.hospitalId,
      category: 'review',
      action: 'Opened remediation plan',
      object: `Run ${run.runNumber}`,
      detail: `${inserted.length} item(s) created from open gaps`,
      actor: a,
      ip: req.ip,
    });

    return created(res, inserted.map(toDto), { created: inserted.length });
  }),
);
