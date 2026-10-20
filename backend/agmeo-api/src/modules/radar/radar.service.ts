import { Readable } from 'node:stream';
import { Injectable } from '@nestjs/common';
import type { RadarFrame, RadarManifest } from '@agmeo/contracts';
import { notFound } from '../../core/errors.js';
import { Database } from '../../db/database.js';
import { enqueue } from '../../jobs/queue.js';
import { ObjectStorage } from '../../storage/object-storage.js';
import { ANALYSIS_COUNT, FRAME_INTERVAL_MIN, RADAR_REFRESH, STALE_AFTER_MS } from './radar-store.js';
import { RADAR_RASTER } from './warp.js';

/** Analyses `YYMMDDHHMM`, nowcast frames `YYMMDDHHMM-SSS`. */
export const FRAME_KEY = /^\d{10}(-\d{3})?$/;

/**
 * The radar for signed-in users (reference app/api/radar/manifest, app/api/radar/frame). Radar
 * is the same for everyone and not organization data; reads still go through `Database.run` with
 * the user, like every API query.
 */
@Injectable()
export class RadarService {
  constructor(
    private readonly db: Database,
    private readonly storage: ObjectStorage,
  ) {}

  async manifest(userId: string, now = new Date()): Promise<RadarManifest> {
    return this.db.run({ userId }, async (trx) => {
      // Demand signal for the worker, written at most once a minute.
      const state = await trx
        .updateTable('radar_state')
        .set({ last_viewed_at: now })
        .where((eb) => eb.or([eb('last_viewed_at', 'is', null), eb('last_viewed_at', '<', new Date(now.getTime() - 60_000))]))
        .returning(['nowcast_run_at', 'refreshed_at'])
        .executeTakeFirst()
        .then(async (r) => r ?? (await trx.selectFrom('radar_state').select(['nowcast_run_at', 'refreshed_at']).executeTakeFirst()));

      const analyses = (
        await trx
          .selectFrom('radar_frames')
          .select(['key', 'valid_at', 'lead_minutes'])
          .where('kind', '=', 'analysis')
          .orderBy('valid_at', 'desc')
          .limit(ANALYSIS_COUNT)
          .execute()
      ).reverse();
      const newest = analyses.at(-1)?.valid_at ? new Date(analyses.at(-1)!.valid_at) : null;
      const nowcast = state?.nowcast_run_at
        ? await trx
            .selectFrom('radar_frames')
            .select(['key', 'valid_at', 'lead_minutes'])
            .where('kind', '=', 'nowcast')
            .where('run_at', '=', new Date(state.nowcast_run_at))
            // A nowcast frame never stands in for a time an analysis already covers.
            .$if(!!newest, (q) => q.where('valid_at', '>', newest!))
            .orderBy('lead_minutes')
            .execute()
        : [];

      // Idle radar: queue a refresh now rather than at the next slot; one per 5-minute slot.
      if (!newest || now.getTime() - newest.getTime() > STALE_AFTER_MS) {
        const slot = Math.floor(now.getTime() / (FRAME_INTERVAL_MIN * 60_000)) * FRAME_INTERVAL_MIN * 60_000;
        await enqueue(trx, { kind: RADAR_REFRESH, dedupeKey: `view:${new Date(slot).toISOString()}`, maxAttempts: 2 });
      }

      const frame = (kind: RadarFrame['kind']) => (f: { key: string; valid_at: Date | string; lead_minutes: number }): RadarFrame => ({
        key: f.key,
        time: new Date(f.valid_at).toISOString(),
        kind,
        leadMinutes: f.lead_minutes,
      });
      return {
        bounds: RADAR_RASTER.bounds,
        width: RADAR_RASTER.width,
        height: RADAR_RASTER.height,
        frames: [...analyses.map(frame('analysis')), ...nowcast.map(frame('nowcast'))],
        nowIndex: analyses.length - 1,
        refreshedAt: state?.refreshed_at ? new Date(state.refreshed_at).toISOString() : null,
      };
    });
  }

  async frame(userId: string, key: string): Promise<Readable> {
    if (!FRAME_KEY.test(key)) throw notFound('Radar frame');
    const row = await this.db.run({ userId }, (trx) => trx.selectFrom('radar_frames').select('storage_key').where('key', '=', key).executeTakeFirst());
    if (!row) throw notFound('Radar frame');
    try {
      return await this.storage.get(row.storage_key);
    } catch {
      // Pruned between the lookup and the read.
      throw notFound('Radar frame');
    }
  }
}

