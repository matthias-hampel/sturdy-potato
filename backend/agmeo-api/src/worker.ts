import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { config } from './config.js';
import { createKysely, Database } from './db/database.js';
import { RecommendationsService } from './modules/recommendations/recommendations.service.js';
import { OutboxRelay } from './worker/outbox-relay.js';
import { DEFAULT_SCHEDULER_OPTIONS, RecommendationScheduler } from './worker/recommendation-scheduler.js';
import { RecommenderModule } from './worker/recommender.module.js';

/**
 * Background worker:
 * - relays outbox events to NATS, as agmeo_outbox_relay (outbox only, no tenant data);
 * - recalculates field recommendations daily and after changes, as agmeo_recommender
 *   (one organization at a time, reading what the rule set needs).
 */
async function main() {
  const logger = new Logger('Worker');
  const db = createKysely(config.relayDatabaseUrl, 2);
  const relay = new OutboxRelay(db, config.natsUrl);
  // Creates the event stream the recommendation consumer reads from.
  await relay.start();

  const schedule = config.recommendationSchedule;
  const recommender = schedule.enabled ? await NestFactory.createApplicationContext(RecommenderModule, { logger: ['log', 'warn', 'error'] }) : null;
  const scheduler = recommender
    ? new RecommendationScheduler(recommender.get(Database), recommender.get(RecommendationsService), {
        ...DEFAULT_SCHEDULER_OPTIONS,
        daily: { at: schedule.dailyAt, timeZone: schedule.timeZone },
      })
    : null;
  await scheduler?.start(config.natsUrl);

  const shutdown = async (signal: string) => {
    logger.log(`${signal} received, shutting down`);
    await scheduler?.stop();
    await recommender?.close();
    await relay.stop();
    await db.destroy();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

await main();
