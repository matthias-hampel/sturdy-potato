import { sql, type Kysely } from 'kysely';
import type { DB } from '../db/schema.js';
import { SEND_EMAIL, sendEmailHandler } from '../mail/mail.js';
import { PURGE_OBJECTS } from '../modules/files/files.service.js';
import { MAIZE_DMC_HARVEST_DETECTION, harvestDetectionHandler } from '../modules/maize-dmc/harvest-detection.job.js';
import { FETCH_MARKET_PRICES, fetchMarketPricesHandler } from '../modules/economics/market-prices.js';
import { RADAR_REFRESH, radarRefreshHandler } from '../modules/radar/radar-store.js';
import { WEATHER_CELL, WEATHER_SCAN, weatherCellHandler, weatherScanHandler } from '../modules/weather/weather-store.js';
import { YIELD_SWEEP, yieldJobHandlers } from '../modules/yield/yield-builder.js';
import { DISEASE_CROP, DISEASE_SCAN, diseaseCropHandler, diseaseScanHandler, IsipClient } from '../modules/model-services/disease.js';
import { ESM_RUN, esmRunHandler } from '../modules/model-services/esm.js';
import { VOICE_TRANSCRIBE, voiceTranscribeHandler } from '../modules/voice/voice.service.js';
import { createStorageDriver } from '../storage/object-storage.js';
import type { JobHandler } from './runner.js';
import type { Schedule } from './scheduler.js';

export const CLEANUP_JOBS = 'jobs.cleanup';

/** Every job kind the worker runs, and its handler. */
export function jobHandlers(db: Kysely<DB>): Record<string, JobHandler> {
  const storage = createStorageDriver();
  // One ISIP client per worker, so its token is cached across jobs.
  const isip = new IsipClient();
  return {
    [SEND_EMAIL]: sendEmailHandler(),
    [WEATHER_SCAN]: weatherScanHandler(db),
    [FETCH_MARKET_PRICES]: fetchMarketPricesHandler(db),
    [WEATHER_CELL]: weatherCellHandler(db),
    [RADAR_REFRESH]: radarRefreshHandler(db, storage),
    // Yield maps: build a crop cycle's rasters; the sweep re-queues sources a lost job left behind.
    ...yieldJobHandlers(db, storage),
    [MAIZE_DMC_HARVEST_DETECTION]: harvestDetectionHandler(db),
    [ESM_RUN]: esmRunHandler(db),
    [DISEASE_SCAN]: diseaseScanHandler(db, isip),
    [DISEASE_CROP]: diseaseCropHandler(db, isip),
    // Voice drafts: speech-to-text of a recording, then the draft operation.
    [VOICE_TRANSCRIBE]: voiceTranscribeHandler(db, storage),
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
  { kind: YIELD_SWEEP, everyMinutes: 15, offsetMinutes: 7 },
  // Daily at 06:30 UTC like the reference's cron, after the morning satellite run; skips itself without maize-dmc-api.
  { kind: MAIZE_DMC_HARVEST_DETECTION, everyMinutes: 24 * 60, offsetMinutes: 6 * 60 + 30 },
  // ISIP disease risk at 06:00 UTC like the reference's cron; skips itself outside Feb 15 – Jun 30
  // and while ISIP is not configured.
  { kind: DISEASE_SCAN, everyMinutes: 24 * 60, offsetMinutes: 6 * 60 },
];
