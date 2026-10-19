import { Logger } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { DB } from '../db/schema.js';
import { enqueue } from './queue.js';

export interface Schedule {
  /** Job kind to enqueue. */
  kind: string;
  /** One job per slot of this many minutes, aligned to UTC midnight (60 = every full hour). */
  everyMinutes: number;
  /** Offset into the slot, so schedules of the same period do not all start together. */
  offsetMinutes?: number;
  payload?: Record<string, unknown>;
}

/** Start of the slot containing `now`. */
export function slotStart(schedule: Schedule, now: Date): Date {
  const period = schedule.everyMinutes * 60_000;
  const offset = (schedule.offsetMinutes ?? 0) * 60_000;
  return new Date(Math.floor((now.getTime() - offset) / period) * period + offset);
}

/**
 * Enqueues each schedule's job once per slot. The slot start is the job's dedupe key, so
 * several schedulers (one per worker) never queue a slot twice, and a worker that was down
 * catches up on the current slot, not on every slot it missed.
 */
export class Scheduler {
  private readonly logger = new Logger(Scheduler.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly db: Kysely<DB>,
    private readonly schedules: Schedule[],
    private readonly tickMs = 30_000,
  ) {}

  start() {
    this.logger.log(`Schedules: ${this.schedules.map((s) => `${s.kind} every ${s.everyMinutes} min`).join(', ') || 'none'}`);
    void this.tick();
  }

  stop() {
    clearTimeout(this.timer);
  }

  async tick(now = new Date()) {
    for (const schedule of this.schedules) {
      const slot = slotStart(schedule, now);
      try {
        const queued = await enqueue(this.db, { kind: schedule.kind, payload: schedule.payload, dedupeKey: `slot:${slot.toISOString()}`, maxAttempts: 3 });
        if (queued) this.logger.debug(`Queued ${schedule.kind} for ${slot.toISOString()}`);
      } catch (e) {
        this.logger.error(`Scheduling ${schedule.kind} failed: ${(e as Error).message}`);
      }
    }
    this.timer = setTimeout(() => void this.tick(), this.tickMs);
  }
}
