import { Logger } from '@nestjs/common';
import { config } from './config.js';
import { createKysely } from './db/database.js';
import { BsaClient } from './refdata/bsa.js';
import { syncBsa } from './refdata/bsa-sync.js';

/**
 * One-shot job: refreshes the Bundessortenamt variety catalogue. Runs with its own database role
 * (agmeo_refdata), which can write the catalogue but read no tenant data. Pass species codes
 * (e.g. `WW M`) to sync only those; by default every species a crop maps to is synced.
 * The BSA updates its register continuously; a weekly run is plenty.
 */
async function main() {
  const logger = new Logger('BsaSync');
  const db = createKysely(config.refdataDatabaseUrl, 1);
  try {
    const codes = process.argv.slice(2).filter((a) => !a.startsWith('-'));
    const results = await syncBsa(db, new BsaClient(), { codes: codes.length ? codes : undefined, delayMs: 2000 });
    logger.log(`Synced ${results.reduce((s, r) => s + r.varieties, 0)} varieties of ${results.length} species`);
  } finally {
    await db.destroy();
  }
}

await main();
