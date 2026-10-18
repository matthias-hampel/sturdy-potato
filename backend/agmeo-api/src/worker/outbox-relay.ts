import { Logger } from '@nestjs/common';
import { jetstream, jetstreamManager, type JetStreamClient } from '@nats-io/jetstream';
import { connect, type NatsConnection } from '@nats-io/transport-node';
import { sql, type Kysely } from 'kysely';
import type { DB } from '../db/schema.js';

export const STREAM = 'AGMEO_EVENTS';
export const SUBJECT_PREFIX = 'agmeo.events';

/**
 * Relays committed domain events from the transactional outbox to NATS JetStream.
 *
 * Delivery is at-least-once: a crash between publish and marking a row can republish it.
 * The JetStream message id (= outbox event_id) deduplicates within the stream's duplicate
 * window, and consumers must still be idempotent on `eventId`.
 */
export class OutboxRelay {
  private readonly logger = new Logger(OutboxRelay.name);
  private nc?: NatsConnection;
  private js?: JetStreamClient;
  private stopped = false;
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly db: Kysely<DB>,
    private readonly natsUrl: string,
    private readonly opts = { batchSize: 100, intervalMs: 1000, maxAttempts: 25 },
  ) {}

  async start() {
    this.nc = await connect({ servers: this.natsUrl, name: 'agmeo-outbox-relay', maxReconnectAttempts: -1 });
    const jsm = await jetstreamManager(this.nc);
    const config = { name: STREAM, subjects: [`${SUBJECT_PREFIX}.>`], duplicate_window: 2 * 60 * 1_000_000_000, max_age: 30 * 24 * 3600 * 1_000_000_000 };
    try {
      await jsm.streams.info(STREAM);
      await jsm.streams.update(STREAM, config);
    } catch {
      await jsm.streams.add(config);
    }
    this.js = jetstream(this.nc);
    this.logger.log(`Relaying outbox events to ${this.natsUrl} (stream ${STREAM})`);
    void this.loop();
  }

  async stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    await this.nc?.drain();
  }

  private async loop() {
    if (this.stopped) return;
    let published = 0;
    try {
      published = await this.relayBatch();
    } catch (e) {
      this.logger.error(`Relay batch failed: ${(e as Error).message}`);
    }
    // Drain backlogs quickly; otherwise poll.
    this.timer = setTimeout(() => void this.loop(), published === this.opts.batchSize ? 0 : this.opts.intervalMs);
  }

  /** Publishes one batch inside a transaction holding row locks (safe with several relays). */
  async relayBatch(): Promise<number> {
    return this.db.transaction().execute(async (trx) => {
      const rows = await trx
        .selectFrom('outbox_events')
        .selectAll()
        .where('published_at', 'is', null)
        .where('attempts', '<', this.opts.maxAttempts)
        .orderBy('id')
        .limit(this.opts.batchSize)
        .forUpdate()
        .skipLocked()
        .execute();

      let ok = 0;
      for (const row of rows) {
        const subject = `${SUBJECT_PREFIX}.${row.event_type}`;
        const message = {
          eventId: row.event_id,
          type: row.event_type,
          aggregateType: row.aggregate_type,
          aggregateId: row.aggregate_id,
          organizationId: row.organization_id,
          occurredAt: row.created_at.toISOString(),
          payload: row.payload,
        };
        try {
          await this.js!.publish(subject, JSON.stringify(message), { msgID: row.event_id });
          await trx.updateTable('outbox_events').set({ published_at: sql`now()`, attempts: row.attempts + 1, last_error: null }).where('id', '=', row.id).execute();
          ok += 1;
        } catch (e) {
          // Keep order per aggregate: stop the batch at the first failure and retry later.
          await trx.updateTable('outbox_events').set({ attempts: row.attempts + 1, last_error: String((e as Error).message).slice(0, 1000) }).where('id', '=', row.id).execute();
          this.logger.warn(`Publishing ${subject} (${row.event_id}) failed: ${(e as Error).message}`);
          break;
        }
      }
      if (ok) this.logger.debug(`Published ${ok} event(s)`);
      return rows.length === ok ? ok : -1;
    });
  }
}
