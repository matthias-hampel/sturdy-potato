/**
 * Stored radar frames (reference src/lib/dwd/r2-sync.ts, radar-demand.ts, app/api/cron/radar-refresh).
 *
 * A scheduled job every 5 minutes renders the DWD frames that are missing — the newest nowcast
 * run first (one download, bounded), then the RY analyses of the last 6 hours — stores the PNGs
 * under radar/ in object storage, indexes them in `radar_frames` and prunes old ones.
 *
 * Demand: rendering costs real CPU, so the job does nothing unless someone loaded the radar in
 * the last 6 hours. The reference keeps that timestamp in Redis; here it is
 * `radar_state.last_viewed_at`, stamped by the manifest endpoint. When the manifest it serves is
 * stale (the radar sat idle), the endpoint also queues a refresh at once instead of waiting for
 * the next slot — the reference's "kickstart", debounced by the jobs table's dedupe key.
 */
import { Logger } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { DB } from '../../db/schema.js';
import type { JobHandler } from '../../jobs/runner.js';
import type { StorageDriver } from '../../storage/object-storage.js';
import { dwdSource, type RadarSource } from './dwd.js';
import { timestampToDate } from './radolan.js';

export const RADAR_REFRESH = 'radar.refresh';

export const FRAME_INTERVAL_MIN = 5;
/** Analyses kept in the manifest: 6 hours. */
export const ANALYSIS_COUNT = 72;
/** Stored analyses are deleted an hour after they leave the window. */
const ANALYSIS_KEEP_MS = (ANALYSIS_COUNT * FRAME_INTERVAL_MIN + 60) * 60_000;
/** Nowcast lead times: +5 … +120 minutes. */
export const NOWCAST_STEPS = Array.from({ length: 24 }, (_, i) => (i + 1) * 5);
/** Frames of a superseded nowcast run stay an hour for clients that still show them. */
const NOWCAST_GRACE_MS = 60 * 60_000;
/** The radar counts as in demand this long after it was last loaded. */
export const DEMAND_WINDOW_MS = 6 * 60 * 60_000;
/** A manifest whose newest analysis is older than this triggers an immediate refresh. */
export const STALE_AFTER_MS = 15 * 60_000;

export const analysisKey = (ts: string) => ts;
export const nowcastKey = (run: string, step: number) => `${run}-${String(step).padStart(3, '0')}`;
export const storageKeyFor = (key: string) => (key.includes('-') ? `radar/nowcast/${key.slice(0, 10)}/${key.slice(11)}.png` : `radar/analysis/${key}.png`);

export function inDemand(lastViewedAt: Date | null, now = new Date()): boolean {
  return !!lastViewedAt && now.getTime() - lastViewedAt.getTime() < DEMAND_WINDOW_MS;
}

const logger = new Logger('RadarStore');

export interface RefreshResult {
  analyses: { rendered: number; cached: number; failed: number };
  nowcast: { run: string | null; rendered: number };
  pruned: number;
}

/** Brings the stored frames up to date. Idempotent: anything already stored is skipped. */
export async function refreshRadar(db: Kysely<DB>, storage: StorageDriver, source: RadarSource = dwdSource, now = new Date()): Promise<RefreshResult> {
  const errors: string[] = [];
  const state = await db.selectFrom('radar_state').select('nowcast_run_at').executeTakeFirst();

  // Nowcast first. On failure the previous run stays current.
  const nowcast: RefreshResult['nowcast'] = { run: null, rendered: 0 };
  let currentRunAt = state?.nowcast_run_at ? new Date(state.nowcast_run_at) : null;
  try {
    const run = await source.latestNowcastRun();
    nowcast.run = run;
    if (run) {
      const runAt = timestampToDate(run);
      const stored = await db.selectFrom('radar_frames').select((eb) => eb.fn.countAll<number>().as('n')).where('kind', '=', 'nowcast').where('run_at', '=', runAt).executeTakeFirstOrThrow();
      if (Number(stored.n) < NOWCAST_STEPS.length) {
        const frames = await source.renderNowcast(run, NOWCAST_STEPS);
        for (const f of frames) {
          const key = nowcastKey(run, f.step);
          await storage.put(storageKeyFor(key), f.png, 'image/png', f.png.length);
          await upsertFrame(db, { key, kind: 'nowcast', valid_at: new Date(runAt.getTime() + f.step * 60_000), run_at: runAt, lead_minutes: f.step, storage_key: storageKeyFor(key) });
        }
        nowcast.rendered = frames.length;
      }
      if (!currentRunAt || runAt > currentRunAt) {
        currentRunAt = runAt;
        await db.updateTable('radar_state').set({ nowcast_run_at: runAt }).execute();
      }
    }
  } catch (e) {
    errors.push(`nowcast: ${(e as Error).message}`);
    logger.warn(`Nowcast refresh failed, keeping the previous run: ${(e as Error).message}`);
  }

  // Analyses: render the ones not stored yet; a failed frame is retried on the next run.
  const analyses = { rendered: 0, cached: 0, failed: 0 };
  const wanted = await source.listAnalyses(ANALYSIS_COUNT);
  const existing = new Set(
    wanted.length ? (await db.selectFrom('radar_frames').select('key').where('kind', '=', 'analysis').where('key', 'in', wanted).execute()).map((r) => r.key) : [],
  );
  for (const ts of wanted) {
    if (existing.has(ts)) {
      analyses.cached++;
      continue;
    }
    try {
      const png = await source.renderAnalysis(ts);
      const key = analysisKey(ts);
      await storage.put(storageKeyFor(key), png, 'image/png', png.length);
      const at = timestampToDate(ts);
      await upsertFrame(db, { key, kind: 'analysis', valid_at: at, run_at: at, lead_minutes: 0, storage_key: storageKeyFor(key) });
      analyses.rendered++;
    } catch (e) {
      analyses.failed++;
      errors.push(`${ts}: ${(e as Error).message}`);
      logger.warn(`Radar frame ${ts} failed: ${(e as Error).message}`);
    }
  }

  const pruned = await pruneFrames(db, storage, currentRunAt, now);
  await db
    .updateTable('radar_state')
    .set(errors.length ? { refreshed_at: now, last_error: errors.join('; ').slice(0, 2000), last_error_at: now } : { refreshed_at: now, last_error: null })
    .execute();
  return { analyses, nowcast, pruned };
}

async function upsertFrame(db: Kysely<DB>, row: { key: string; kind: 'analysis' | 'nowcast'; valid_at: Date; run_at: Date; lead_minutes: number; storage_key: string }) {
  await db
    .insertInto('radar_frames')
    .values(row)
    .onConflict((oc) => oc.column('key').doUpdateSet({ storage_key: row.storage_key, created_at: sql`now()` }))
    .execute();
}

/** Deletes analyses past the window and superseded nowcast runs past their grace period: object first, then row. */
export async function pruneFrames(db: Kysely<DB>, storage: StorageDriver, currentRunAt: Date | null, now = new Date()): Promise<number> {
  const old = await db
    .selectFrom('radar_frames')
    .select(['key', 'storage_key'])
    .where((eb) =>
      eb.or([
        eb.and([eb('kind', '=', 'analysis'), eb('valid_at', '<', new Date(now.getTime() - ANALYSIS_KEEP_MS))]),
        eb.and([
          eb('kind', '=', 'nowcast'),
          eb('run_at', '<', new Date(now.getTime() - NOWCAST_GRACE_MS)),
          ...(currentRunAt ? [eb('run_at', '<>', currentRunAt)] : []),
        ]),
      ]),
    )
    .execute();
  for (const f of old) {
    await storage.delete(f.storage_key);
    await db.deleteFrom('radar_frames').where('key', '=', f.key).execute();
  }
  return old.length;
}

/** Every 5 minutes (and when a viewer finds the radar stale): refresh while the radar is in demand. */
export const radarRefreshHandler =
  (db: Kysely<DB>, storage: StorageDriver, source: RadarSource = dwdSource): JobHandler =>
  async () => {
    const state = await db.selectFrom('radar_state').select('last_viewed_at').executeTakeFirst();
    if (!inDemand(state?.last_viewed_at ? new Date(state.last_viewed_at) : null)) return;
    const result = await refreshRadar(db, storage, source);
    if (result.analyses.rendered || result.nowcast.rendered || result.pruned) logger.log(`Radar refreshed: ${JSON.stringify(result)}`);
  };
