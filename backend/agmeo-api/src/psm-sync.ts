import { Logger } from '@nestjs/common';
import { config } from './config.js';
import { createKysely } from './db/database.js';
import { PsmClient } from './refdata/psm.js';
import { syncPsm } from './refdata/psm-sync.js';

/**
 * One-shot job: refreshes the BVL plant-protection register. Runs with its own database role
 * (agmeo_refdata), which can write the register but read no tenant data. The BVL publishes
 * changes about twice a month; a weekly run is plenty.
 */
async function main() {
  const logger = new Logger('PsmSync');
  const db = createKysely(config.refdataDatabaseUrl, 1);
  try {
    const r = await syncPsm(db, new PsmClient());
    logger.log(`Synced ${r.products} products, ${r.uses} uses, ${r.cropGroups} crop group links, ${r.codes} code texts`);
  } finally {
    await db.destroy();
  }
}

await main();
