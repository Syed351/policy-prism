import { and, desc, eq, sql } from 'drizzle-orm';
import type { AuditCategory } from '@policy-prism/shared';
import { db } from '../db';
import { auditLogs } from '../db/schema';
import type { AuthContext } from '../middleware/auth';

export interface AuditInput {
  hospitalId: number;
  category: AuditCategory;
  action: string;
  object?: string | null;
  detail?: string | null;
  actor?: AuthContext | null;
  ip?: string | null;
}

/**
 * Append-only trail. The sequence number is allocated per hospital so a missing
 * number is visible - the prototype made the same promise in its UI copy.
 */
export async function recordAudit(input: AuditInput): Promise<void> {
  const nextSeq = sql<number>`(
    SELECT COALESCE(MAX(${auditLogs.seq}), 0) + 1
    FROM ${auditLogs}
    WHERE ${auditLogs.hospitalId} = ${input.hospitalId}
  )`;

  await db.insert(auditLogs).values({
    hospitalId: input.hospitalId,
    seq: nextSeq,
    category: input.category,
    action: input.action.slice(0, 200),
    object: input.object ? input.object.slice(0, 240) : null,
    detail: input.detail ?? null,
    userId: input.actor?.id ?? null,
    actorName: input.actor ? input.actor.name : 'System',
    actorRole: input.actor ? input.actor.roleLabel : null,
    ip: input.ip ? input.ip.slice(0, 64) : null,
  });
}

/** Never let an audit write break the action it was recording. */
export async function safeAudit(input: AuditInput): Promise<void> {
  try {
    await recordAudit(input);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[audit] failed to record entry:', (err as Error).message);
  }
}

export async function recentActivity(hospitalId: number, limit = 7) {
  return db
    .select()
    .from(auditLogs)
    .where(eq(auditLogs.hospitalId, hospitalId))
    .orderBy(desc(auditLogs.seq))
    .limit(limit);
}

export async function auditCategoryTally(hospitalId: number) {
  const rows = await db
    .select({ category: auditLogs.category, count: sql<number>`count(*)::int` })
    .from(auditLogs)
    .where(eq(auditLogs.hospitalId, hospitalId))
    .groupBy(auditLogs.category);
  return rows;
}

export async function auditForCategory(hospitalId: number, category: AuditCategory) {
  return db
    .select()
    .from(auditLogs)
    .where(and(eq(auditLogs.hospitalId, hospitalId), eq(auditLogs.category, category)))
    .orderBy(desc(auditLogs.seq));
}
