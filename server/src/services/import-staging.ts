/**
 * Short-lived staging for import previews.
 *
 * A parsed document can be several megabytes of requirement text. Sending all
 * of it to the browser and back again makes an import feel broken on a slow
 * link. Instead the parsed rows stay here, the preview carries only a snippet
 * per row, and the commit references rows by key.
 *
 * In-memory on purpose: a staged import is worthless after a restart, and the
 * user simply re-uploads. Entries expire so a large import cannot pin memory.
 */

import crypto from 'node:crypto';

const TTL_MS = 30 * 60_000;
const MAX_BATCHES = 40;

interface Batch<T> {
  hospitalId: number;
  rows: Map<string, T>;
  createdAt: number;
}

const batches = new Map<string, Batch<unknown>>();

function sweep(): void {
  const cutoff = Date.now() - TTL_MS;
  for (const [id, b] of batches) {
    if (b.createdAt < cutoff) batches.delete(id);
  }
  // Hard ceiling: drop the oldest if a session stages many imports.
  while (batches.size > MAX_BATCHES) {
    let oldestId: string | null = null;
    let oldest = Infinity;
    for (const [id, b] of batches) {
      if (b.createdAt < oldest) {
        oldest = b.createdAt;
        oldestId = id;
      }
    }
    if (!oldestId) break;
    batches.delete(oldestId);
  }
}

/** Stages parsed rows and returns the id the client sends back on commit. */
export function stageImport<T>(hospitalId: number, rows: Array<[string, T]>): string {
  sweep();
  const id = crypto.randomBytes(12).toString('hex');
  batches.set(id, { hospitalId, rows: new Map(rows), createdAt: Date.now() });
  return id;
}

/** Retrieves a staged row, scoped to the hospital that staged it. */
export function stagedRow<T>(importId: string, hospitalId: number, key: string): T | null {
  const batch = batches.get(importId);
  if (!batch || batch.hospitalId !== hospitalId) return null;
  return (batch.rows.get(key) as T) ?? null;
}

export function stagedExists(importId: string, hospitalId: number): boolean {
  const batch = batches.get(importId);
  return !!batch && batch.hospitalId === hospitalId;
}

export function discardImport(importId: string): void {
  batches.delete(importId);
}
