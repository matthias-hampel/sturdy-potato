import { Logger } from '@nestjs/common';
import { config } from './config.js';
import { createKysely } from './db/database.js';
import { jobHandlers, schedules } from './jobs/registry.js';
import { JobRunner } from './jobs/runner.js';
import { Scheduler } from './jobs/scheduler.js';
import { OutboxRelay } from './worker/outbox-relay.js';

/**
 * Background worker:
 * - relays outbox events to NATS, as agmeo_outbox_relay (outbox only, no tenant data);
 * - runs queued and scheduled jobs, as agmeo_jobs (tenant data only through policies
 *   granted to that role table by table).
 */
async function main() {
  const logger = new Logger('Worker');
  const relayDb = createKysely(config.relayDatabaseUrl, 2);
  const jobsDb = createKysely(config.jobsDatabaseUrl, 4);

  const relay = new OutboxRelay(relayDb, config.natsUrl);
  await relay.start();
  const runner = new JobRunner(jobsDb, jobHandlers(jobsDb));
  runner.start();
  const scheduler = new Scheduler(jobsDb, schedules);
  scheduler.start();

  const shutdown = async (signal: string) => {
    logger.log(`${signal} received, shutting down`);
    scheduler.stop();
    await runner.stop();
    await relay.stop();
    await Promise.all([relayDb.destroy(), jobsDb.destroy()]);
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

await main();
