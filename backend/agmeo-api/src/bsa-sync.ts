import { Logger } from '@nestjs/common';
import { config } from './config.js';
import { createKysely } from './db/database.js';
import { BsaClient } from './refdata/bsa.js';
import { syncBsa } from './refdata/bsa-sync.js';
import { EupvpClient } from './refdata/eupvp.js';
import { syncEu } from './refdata/eupvp-sync.js';

/**
 * One-shot job: refreshes the variety catalogues, first the Bundessortenamt register, then the
 * EU Common Catalogue (EU Plant Variety Portal). Runs with its own database role (agmeo_refdata),
 * which can write the catalogues but read no tenant data. Pass species codes (e.g. `WW M`) to
 * sync only those and the EU species of the crops they belong to; by default every species a crop
 * maps to is synced. `--skip-bsa` or `--skip-eu` leaves out one catalogue.
 * Both registers change continuously; a weekly run is plenty.
 */
async function main() {
  const logger = new Logger('BsaSync');
  const db = createKysely(config.refdataDatabaseUrl, 1);
  try {
    const args = process.argv.slice(2);
    const codes = args.filter((a) => !a.startsWith('-'));
    if (!args.includes('--skip-bsa')) {
      const results = await syncBsa(db, new BsaClient(), { codes: codes.length ? codes : undefined, delayMs: 2000 });
      logger.log(`Synced ${results.reduce((s, r) => s + r.varieties, 0)} BSA varieties of ${results.length} species`);
    }
    if (!args.includes('--skip-eu')) {
      const results = await syncEu(db, new EupvpClient(), { only: codes.length ? codes : undefined, delayMs: 2000 });
      logger.log(`Synced ${results.reduce((s, r) => s + r.varieties, 0)} EU catalogue varieties of ${results.length} species`);
    }
  } finally {
    await db.destroy();
  }
}

await main();
