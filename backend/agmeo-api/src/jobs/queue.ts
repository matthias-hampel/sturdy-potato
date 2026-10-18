import { sql, type Kysely, type Transaction } from 'kysely';
import type { DB } from '../db/schema.js';

export interface NewJob {
  kind: string;
  payload?: Record<string, unknown>;
  organizationId?: string | null;
  /** With a key, a second job of the same kind and key is dropped instead of queued. */
  dedupeKey?: string;
  runAt?: Date;
  maxAttempts?: number;
}

/**
 * Queues a background job. Call it inside the transaction of the change that needs the job,
 * so the job exists exactly when the change commits. Returns false when a job with the same
 * kind and dedupe key already exists.
 */
export async function enqueue(db: Kysely<DB> | Transaction<DB>, job: NewJob): Promise<boolean> {
  const result = await db
    .insertInto('jobs')
    .values({
      kind: job.kind,
      payload: JSON.stringify(job.payload ?? {}),
      organization_id: job.organizationId ?? null,
      dedupe_key: job.dedupeKey ?? null,
      run_at: job.runAt ?? sql<Date>`now()`,
      max_attempts: job.maxAttempts,
    })
    .onConflict((oc) => oc.columns(['kind', 'dedupe_key']).where('dedupe_key', 'is not', null).doNothing())
    .executeTakeFirst();
  return Number(result.numInsertedOrUpdatedRows ?? 0) > 0;
}
