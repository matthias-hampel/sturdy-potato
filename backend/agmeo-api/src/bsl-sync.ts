import { Logger } from '@nestjs/common';
import { config } from './config.js';
import { createKysely } from './db/database.js';
import { syncBsl } from './refdata/bsl.js';

/**
 * One-shot job: loads the Beschreibende Sortenliste (data/bsl/varieties.json.gz) into
 * bsl_varieties and links it to the BSA register, with the reference-data role (agmeo_refdata).
 * Run it after `sync:bsa`, so the register links resolve.
 */
async function main() {
  const logger = new Logger('BslSync');
  const db = createKysely(config.refdataDatabaseUrl, 1);
  try {
    const { varieties, linked } = await syncBsl(db);
    logger.log(`Loaded ${varieties} BSL varieties (${linked} linked to the BSA register)`);
  } finally {
    await db.destroy();
  }
}

await main();
