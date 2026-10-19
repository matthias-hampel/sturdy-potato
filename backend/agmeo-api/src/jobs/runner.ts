import { Logger } from '@nestjs/common';
import { sql, type Kysely, type Selectable } from 'kysely';
import type { DB, Jobs } from '../db/schema.js';

export type Job = Selectable<Jobs> & { payload: Record<string, unknown> };

/** Thrown by a handler to fail a job at once instead of retrying it. */
export class PermanentJobError extends Error {}

export type JobHandler = (job: Job) => Promise<void>;

interface RunnerOptions {
  /** Jobs claimed per poll. */
  batchSize: number;
  /** Poll interval when the queue is empty. */
  idleMs: number;
  /** How long a claimed job stays invisible to other workers; a crashed worker's jobs return after this. */
  leaseSeconds: number;
}

/**
 * Runs queued jobs. Several runners can share the queue: claiming takes row locks with
 * SKIP LOCKED and sets a lease, so each job runs on one worker at a time. Delivery is
 * at-least-once (a crash after the work but before marking the job finished repeats it),
 * so handlers must be idempotent.
 */
export class JobRunner {
  private readonly logger = new Logger(JobRunner.name);
  private stopped = false;
  private timer?: NodeJS.Timeout;
  private running?: Promise<unknown>;

  constructor(
    private readonly db: Kysely<DB>,
    private readonly handlers: Record<string, JobHandler>,
    private readonly opts: RunnerOptions = { batchSize: 10, idleMs: 2000, leaseSeconds: 600 },
  ) {}

  start() {
    this.logger.log(`Running jobs: ${Object.keys(this.handlers).sort().join(', ')}`);
    void this.loop();
  }

  async stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    await this.running;
  }

  private async loop() {
    if (this.stopped) return;
    let claimed = 0;
    try {
      const batch = this.runBatch();
      this.running = batch;
      claimed = await batch;
    } catch (e) {
      this.logger.error(`Job batch failed: ${(e as Error).message}`);
    }
    this.timer = setTimeout(() => void this.loop(), claimed === this.opts.batchSize ? 0 : this.opts.idleMs);
  }

  /** Claims due jobs and runs them one after another. Returns how many were claimed. */
  async runBatch(): Promise<number> {
    const kinds = Object.keys(this.handlers);
    if (!kinds.length) return 0;
    const { rows } = await sql<Job>`
      UPDATE jobs SET locked_until = now() + make_interval(secs => ${this.opts.leaseSeconds}), attempts = attempts + 1
      WHERE id IN (
        SELECT id FROM jobs
        WHERE finished_at IS NULL AND failed_at IS NULL AND run_at <= now()
          AND (locked_until IS NULL OR locked_until < now())
          AND kind = ANY(${kinds}::text[])
        ORDER BY run_at, id
        LIMIT ${this.opts.batchSize}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING *`.execute(this.db);

    for (const job of rows) {
      if (this.stopped) break;
      await this.runOne(job);
    }
    return rows.length;
  }

  private async runOne(job: Job) {
    const started = Date.now();
    try {
      await this.handlers[job.kind](job);
      await this.db.updateTable('jobs').set({ finished_at: sql`now()`, locked_until: null, last_error: null }).where('id', '=', job.id).execute();
      this.logger.debug(`${job.kind} #${job.id} done in ${Date.now() - started} ms`);
    } catch (e) {
      const message = String((e as Error).message ?? e).slice(0, 2000);
      const permanent = e instanceof PermanentJobError || job.attempts >= job.max_attempts;
      if (permanent) {
        await this.db.updateTable('jobs').set({ failed_at: sql`now()`, locked_until: null, last_error: message }).where('id', '=', job.id).execute();
        this.logger.error(`${job.kind} #${job.id} failed for good after ${job.attempts} attempt(s): ${message}`);
      } else {
        await this.db
          .updateTable('jobs')
          .set({ run_at: new Date(Date.now() + retryDelayMs(job.attempts)), locked_until: null, last_error: message })
          .where('id', '=', job.id)
          .execute();
        this.logger.warn(`${job.kind} #${job.id} attempt ${job.attempts} failed, retrying: ${message}`);
      }
    }
  }
}

/** Exponential backoff: 30 s, 1 min, 2 min, … capped at 6 h. */
export function retryDelayMs(attempt: number): number {
  return Math.min(30_000 * 2 ** Math.max(0, attempt - 1), 6 * 3600_000);
}
