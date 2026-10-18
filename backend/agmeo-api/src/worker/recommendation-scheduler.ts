import { Logger } from '@nestjs/common';
import { AckPolicy, DeliverPolicy, jetstream, jetstreamManager, type ConsumerMessages } from '@nats-io/jetstream';
import { connect, type NatsConnection } from '@nats-io/transport-node';
import { sql } from 'kysely';
import { systemCtx } from '../auth/context.js';
import type { Database } from '../db/database.js';
import {
  assertDailySchedule,
  type DailySchedule,
  type Debounce,
  dueAfterChanges,
  dueForDailyRun,
  noteChange,
  type PendingChange,
  RECALCULATING_EVENTS,
  recalculates,
} from '../modules/recommendations/lib/schedule.js';
import type { RecommendationsService } from '../modules/recommendations/recommendations.service.js';
import { STREAM, SUBJECT_PREFIX } from './outbox-relay.js';

const CONSUMER = 'agmeo-recommendations';
// Only one worker runs the daily pass at a time; the others skip their tick.
const DAILY_LOCK = 'recommendations:daily';

export interface RecommendationSchedulerOptions {
  daily: DailySchedule;
  debounce: Debounce;
  /** How often the daily pass checks for due organizations. */
  dailyTickMs: number;
  /** How often settled changes are recalculated. */
  changeTickMs: number;
  /** An organization whose recalculation failed waits this long before the daily pass retries it. */
  retryMs: number;
}

export const DEFAULT_SCHEDULER_OPTIONS: Omit<RecommendationSchedulerOptions, 'daily'> = {
  debounce: { quietMs: 2 * 60_000, maxWaitMs: 15 * 60_000 },
  dailyTickMs: 5 * 60_000,
  changeTickMs: 15_000,
  retryMs: 60 * 60_000,
};

/**
 * Recalculates field recommendations without a user: once a day per organization with open
 * crop cycles, and after operations or crop cycles change (domain events from NATS,
 * debounced per organization). Organizations are processed one at a time; a failure is
 * logged and does not stop the others.
 *
 * Changes are acknowledged when noted, so a crash before the recalculation loses it until
 * the next daily run or user refresh.
 */
export class RecommendationScheduler {
  private readonly logger = new Logger(RecommendationScheduler.name);
  private readonly pending = new Map<string, PendingChange>();
  private readonly running = new Set<string>();
  private readonly retryAt = new Map<string, number>();
  private readonly timers: { daily?: NodeJS.Timeout; changes?: NodeJS.Timeout } = {};
  private nc?: NatsConnection;
  private messages?: ConsumerMessages;
  private stopped = false;
  private readonly busy = new Set<Promise<unknown>>();

  constructor(
    private readonly db: Database,
    private readonly recommendations: RecommendationsService,
    private readonly opts: RecommendationSchedulerOptions,
  ) {
    assertDailySchedule(opts.daily);
  }

  async start(natsUrl: string) {
    this.logger.log(`Recalculating recommendations daily at ${this.opts.daily.at} ${this.opts.daily.timeZone} and after ${RECALCULATING_EVENTS.join('/')} events`);
    this.nc = await connect({ servers: natsUrl, name: 'agmeo-recommendations', maxReconnectAttempts: -1 });
    void this.consume(this.nc).catch((e) => this.logger.error(`Event consumer stopped: ${(e as Error).message}`));
    this.loop('daily', this.opts.dailyTickMs, () => this.runDaily());
    this.loop('changes', this.opts.changeTickMs, () => this.runChanges());
  }

  async stop() {
    this.stopped = true;
    clearTimeout(this.timers.daily);
    clearTimeout(this.timers.changes);
    await this.messages?.close();
    await Promise.allSettled(this.busy);
    await this.nc?.drain();
  }

  private loop(name: 'daily' | 'changes', everyMs: number, tick: () => Promise<void>) {
    if (this.stopped) return;
    const run = tick().catch((e) => this.logger.error(`${name} pass failed: ${(e as Error).message}`));
    this.busy.add(run);
    void run.finally(() => {
      this.busy.delete(run);
      if (!this.stopped) this.timers[name] = setTimeout(() => this.loop(name, everyMs, tick), everyMs);
    });
  }

  /** Recalculates every organization that is due for today's run. */
  async runDaily(now = new Date()) {
    await this.db.kysely.connection().execute(async (conn) => {
      const { rows } = await sql<{ ok: boolean }>`SELECT pg_try_advisory_lock(hashtext(${DAILY_LOCK})) AS ok`.execute(conn);
      if (!rows[0].ok) return;
      try {
        const state = await sql<{ organization_id: string; open_cycles: number; last_run_at: Date | null }>`
          SELECT organization_id, open_cycles, last_run_at FROM app.recommendation_schedule()`.execute(conn);
        const due = dueForDailyRun(
          state.rows.map((r) => ({ organizationId: r.organization_id, openCycles: r.open_cycles, lastRunAt: r.last_run_at })),
          now,
          this.opts.daily,
          this.retryAt,
        );
        if (!due.length) return;
        this.logger.log(`Daily recalculation for ${due.length} organization(s)`);
        for (const orgId of due) {
          if (this.stopped) break;
          await this.refresh(orgId, 'daily');
        }
      } finally {
        await sql`SELECT pg_advisory_unlock(hashtext(${DAILY_LOCK}))`.execute(conn);
      }
    });
  }

  /** Recalculates the organizations whose changes have settled. */
  async runChanges(now = Date.now()) {
    for (const orgId of dueAfterChanges(this.pending, now, this.opts.debounce)) {
      if (this.stopped) break;
      // Changes during a running recalculation wait for the next tick.
      if (this.running.has(orgId)) continue;
      this.pending.delete(orgId);
      await this.refresh(orgId, 'change');
    }
  }

  private async refresh(orgId: string, reason: 'daily' | 'change') {
    if (this.running.has(orgId)) return;
    this.running.add(orgId);
    const started = Date.now();
    try {
      const list = await this.recommendations.refresh(systemCtx(orgId));
      this.retryAt.delete(orgId);
      this.logger.log(`Recalculated ${orgId} (${reason}): ${list.items.length} open in ${Date.now() - started} ms`);
    } catch (e) {
      this.retryAt.set(orgId, Date.now() + this.opts.retryMs);
      this.logger.error(`Recalculating ${orgId} (${reason}) failed: ${(e as Error).message}`);
    } finally {
      this.running.delete(orgId);
    }
  }

  /** Notes changes from a durable JetStream consumer shared by all workers. */
  private async consume(nc: NatsConnection) {
    const jsm = await jetstreamManager(nc);
    const filter_subjects = RECALCULATING_EVENTS.map((t) => `${SUBJECT_PREFIX}.${t}.>`);
    try {
      await jsm.consumers.info(STREAM, CONSUMER);
      await jsm.consumers.update(STREAM, CONSUMER, { filter_subjects });
    } catch {
      await jsm.consumers.add(STREAM, { durable_name: CONSUMER, ack_policy: AckPolicy.Explicit, deliver_policy: DeliverPolicy.New, filter_subjects });
    }
    const consumer = await jetstream(nc).consumers.get(STREAM, CONSUMER);
    this.messages = await consumer.consume();
    for await (const m of this.messages) {
      try {
        const event = m.json<{ type: string; organizationId: string | null }>();
        if (event.organizationId && recalculates(event.type)) noteChange(this.pending, event.organizationId, Date.now());
      } catch (e) {
        this.logger.warn(`Ignoring malformed event ${m.subject}: ${(e as Error).message}`);
      }
      m.ack();
    }
  }
}
