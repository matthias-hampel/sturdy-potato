import { Logger } from '@nestjs/common';
import { config } from './config.js';
import { createKysely } from './db/database.js';
import { OutboxRelay } from './worker/outbox-relay.js';

/**
 * Background worker: relays outbox events to NATS. Runs with its own database role
 * (agmeo_outbox_relay), which can read and update the outbox but no tenant data.
 */
async function main() {
  const logger = new Logger('Worker');
  const db = createKysely(config.relayDatabaseUrl, 2);
  const relay = new OutboxRelay(db, config.natsUrl);
  await relay.start();

  const shutdown = async (signal: string) => {
    logger.log(`${signal} received, shutting down`);
    await relay.stop();
    await db.destroy();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

await main();
