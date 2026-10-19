import { sql, type Kysely } from 'kysely';
import type { DB } from '../db/schema.js';
import { SEND_EMAIL, sendEmailHandler } from '../mail/mail.js';
import { PURGE_OBJECTS } from '../modules/files/files.service.js';
import { MAIZE_DMC_HARVEST_DETECTION, harvestDetectionHandler } from '../modules/maize-dmc/harvest-detection.job.js';
import { FETCH_MARKET_PRICES, fetchMarketPricesHandler } from '../modules/economics/market-prices.js';
import { RADAR_REFRESH, radarRefreshHandler } from '../modules/radar/radar-store.js';
import { WEATHER_CELL, WEATHER_SCAN, weatherCellHandler, weatherScanHandler } from '../modules/weather/weather-store.js';
import { createStorageDriver } from '../storage/object-storage.js';
import type { JobHandler } from './runner.js';
import type { Schedule } from './scheduler.js';

export const CLEANUP_JOBS = 'jobs.cleanup';

/** Every job kind the worker runs, and its handler. */
export function jobHandlers(db: Kysely<DB>): Record<string, JobHandler> {
  const storage = createStorageDriver();
  return {
    [SEND_EMAIL]: sendEmailHandler(),
    [WEATHER_SCAN]: weatherScanHandler(db),
    [FETCH_MARKET_PRICES]: fetchMarketPricesHandler(db),
    [WEATHER_CELL]: weatherCellHandler(db),
    [RADAR_REFRESH]: radarRefreshHandler(db, storage),
    [MAIZE_DMC_HARVEST_DETECTION]: harvestDetectionHandler(db),
    // Objects of files deleted from the trash; deleting a missing object is not an error.
    [PURGE_OBJECTS]: async (job) => {
      for (const key of (job.payload.keys as string[] | undefined) ?? []) await storage.delete(key);
    },
    // Finished jobs are kept two weeks for inspection, failed ones three months.
    [CLEANUP_JOBS]: async () => {
      await db
        .deleteFrom('jobs')
        .where((eb) =>
          eb.or([
            eb('finished_at', '<', sql<Date>`now() - interval '14 days'`),
            eb('failed_at', '<', sql<Date>`now() - interval '90 days'`),
          ]),
        )
        .execute();
    },
  };
}

/** Recurring jobs. Slots are aligned to UTC; jobs that depend on local time check each organization's time zone themselves. */
export const schedules: Schedule[] = [
  { kind: CLEANUP_JOBS, everyMinutes: 24 * 60, offsetMinutes: 3 * 60 },
  // At :30 like the reference's crawler, so each morning slot (04:30–05:30 local) is hit once.
  { kind: WEATHER_SCAN, everyMinutes: 60, offsetMinutes: 30 },
  // Daily: the feed publishes weekly but on varying days; the upsert keeps it idempotent.
  { kind: FETCH_MARKET_PRICES, everyMinutes: 24 * 60, offsetMinutes: 7 * 60 },
  // DWD publishes a radar frame every 5 minutes; the job skips itself while nobody looks at the radar.
  { kind: RADAR_REFRESH, everyMinutes: 5 },
  // Daily at 06:30 UTC like the reference's cron, after the morning satellite run; skips itself without maize-dmc-api.
  { kind: MAIZE_DMC_HARVEST_DETECTION, everyMinutes: 24 * 60, offsetMinutes: 6 * 60 + 30 },
];
