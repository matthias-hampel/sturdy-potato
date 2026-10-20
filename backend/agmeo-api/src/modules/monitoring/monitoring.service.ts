import { Injectable } from '@nestjs/common';
import type { FieldMonitoringSummary, FieldObservation, ImageryDate, ImageryStatus, VegetationIndex } from '@agmeo/contracts';
import { sql } from 'kysely';
import type { Ctx } from '../../auth/context.js';
import { round } from '../../core/mappers.js';
import { Database } from '../../db/database.js';
import { resolveSeason } from '../crops/seasons.js';

/**
 * Read side of satellite monitoring. Observations are produced by the geospatial worker
 * (Sentinel-2 L2A zonal statistics per field boundary) and only read here.
 */
@Injectable()
export class MonitoringService {
  constructor(private readonly db: Database) {}

  /**
   * One observation per acquisition date: overlapping tiles (and the local archive) can
   * deliver the same pass twice; the clearest one is kept.
   */
  observations(ctx: Ctx, fieldId: string, index: VegetationIndex, from?: string): Promise<FieldObservation[]> {
    return this.db.run(ctx, async (trx) => {
      const { rows } = await sql<{
        id: string; field_id: string; observed_on: string; index_type: string; mean: number | null; median: number | null;
        p10: number | null; p20: number | null; p80: number | null; p90: number | null; stddev: number | null; valid_pixel_pct: number; status: string;
        source: string; processing_version: string;
      }>`
        SELECT DISTINCT ON (observed_on) id, field_id, observed_on, index_type, mean, median, p10, p20, p80, p90, stddev,
               valid_pixel_pct, status, source, processing_version
        FROM field_observations
        WHERE field_id = ${fieldId}::uuid AND index_type = ${index}
          AND (${from ?? null}::date IS NULL OR observed_on >= ${from ?? null}::date)
        ORDER BY observed_on, (status = 'valid') DESC, valid_pixel_pct DESC`.execute(trx);
      return rows.map((r) => ({
        id: r.id,
        fieldId: r.field_id,
        observedOn: r.observed_on,
        indexType: r.index_type as VegetationIndex,
        mean: r.mean,
        median: r.median,
        p10: r.p10,
        p20: r.p20,
        p80: r.p80,
        p90: r.p90,
        stddev: r.stddev,
        validPixelPct: r.valid_pixel_pct,
        status: r.status as FieldObservation['status'],
        source: r.source,
        processingVersion: r.processing_version,
      }));
    });
  }

  /** Latest valid observation per field, and its change against the previous valid one. */
  summary(ctx: Ctx, index: VegetationIndex): Promise<FieldMonitoringSummary[]> {
    return this.db.run(ctx, async (trx) => {
      const season = await resolveSeason(trx);
      const { rows } = await sql<{
        id: string; name: string; area_ha: number; crop_name: string | null; color: string | null;
        observed_on: string | null; mean: number | null; prev_mean: number | null; valid_count: number;
      }>`
        SELECT f.id, f.name, g.area_ha, cur.crop_name, cur.color, last.observed_on, last.mean, last.prev_mean,
               coalesce(cnt.n, 0) AS valid_count
        FROM fields f
        JOIN field_current_geometry g ON g.field_id = f.id
        LEFT JOIN LATERAL (
          SELECT coalesce(c.name_de, c.name) AS crop_name, coalesce((SELECT occ.color FROM org_crop_colors occ WHERE occ.crop_id = c.id), c.color) AS color FROM crop_cycles cc JOIN crops c ON c.id = cc.crop_id
          WHERE cc.field_id = f.id AND cc.season_id = ${season?.id ?? null}::uuid LIMIT 1
        ) cur ON true
        LEFT JOIN LATERAL (
          SELECT d.observed_on, d.mean, lead(d.mean) OVER (ORDER BY d.observed_on DESC) AS prev_mean
          FROM (
            SELECT DISTINCT ON (o.observed_on) o.observed_on, o.mean FROM field_observations o
            WHERE o.field_id = f.id AND o.index_type = ${index} AND o.status = 'valid'
            ORDER BY o.observed_on DESC, o.valid_pixel_pct DESC
          ) d
          ORDER BY d.observed_on DESC LIMIT 2
        ) last ON true
        LEFT JOIN LATERAL (
          SELECT count(DISTINCT o.observed_on) AS n FROM field_observations o
          WHERE o.field_id = f.id AND o.index_type = ${index} AND o.status = 'valid'
        ) cnt ON true
        WHERE f.status = 'active'
        ORDER BY f.name, last.observed_on DESC`.execute(trx);

      const seen = new Set<string>();
      const out: FieldMonitoringSummary[] = [];
      for (const r of rows) {
        if (seen.has(r.id)) continue;
        seen.add(r.id);
        out.push({
          fieldId: r.id,
          fieldName: r.name,
          areaHa: r.area_ha,
          cropName: r.crop_name,
          cropColor: r.color,
          latest: r.observed_on
            ? { observedOn: r.observed_on, mean: r.mean, change: r.mean != null && r.prev_mean != null ? round(r.mean - r.prev_mean, 3) : null }
            : null,
          validObservations: Number(r.valid_count),
        });
      }
      return out;
    });
  }

  /**
   * Acquisition dates with field imagery, newest first. Imagery is kept for acquisitions where
   * at least 30 % of a field was clear; `valid` marks those meeting the statistics threshold.
   */
  imageryDates(ctx: Ctx, fieldId?: string): Promise<ImageryDate[]> {
    return this.db.run(ctx, async (trx) => {
      const field = fieldId ?? null;
      const { rows } = await sql<{
        observed_on: string; field_count: number; field_ids: string[]; clear_pct: number; valid: boolean; has_rgb: boolean; ndvi: number | null;
      }>`
        WITH best AS (
          SELECT DISTINCT ON (r.field_id, r.observed_on) r.field_id, r.observed_on, r.valid_pixel_pct, r.has_rgb
          FROM field_rasters r
          JOIN field_current_geometry g ON g.id = r.geometry_version_id
          JOIN fields f ON f.id = r.field_id AND f.status = 'active'
          WHERE (${field}::uuid IS NULL OR r.field_id = ${field}::uuid)
          ORDER BY r.field_id, r.observed_on, r.valid_pixel_pct DESC
        )
        SELECT b.observed_on, count(*)::int AS field_count, array_agg(b.field_id::text) AS field_ids, round(avg(b.valid_pixel_pct), 1)::float AS clear_pct,
               bool_or(b.valid_pixel_pct >= 65) AS valid, bool_or(b.has_rgb) AS has_rgb,
               CASE WHEN ${field}::uuid IS NULL THEN NULL ELSE (
                 SELECT o.mean FROM field_observations o
                 WHERE o.field_id = ${field}::uuid AND o.observed_on = b.observed_on AND o.index_type = 'ndvi'
                   AND o.status = 'valid'
                 ORDER BY o.valid_pixel_pct DESC LIMIT 1
               ) END AS ndvi
        FROM best b
        GROUP BY b.observed_on
        ORDER BY b.observed_on DESC`.execute(trx);
      return rows.map((r) => ({
        date: r.observed_on,
        fieldCount: r.field_count,
        fieldIds: r.field_ids,
        clearPct: r.clear_pct,
        valid: r.valid,
        hasRgb: r.has_rgb,
        ndvi: r.ndvi,
      }));
    });
  }

  /** Progress of the imagery backfill for one field, or summed over the organization's fields. */
  imageryStatus(ctx: Ctx, fieldId?: string): Promise<ImageryStatus> {
    return this.db.run(ctx, async (trx) => {
      const field = fieldId ?? null;
      const { rows } = await sql<{
        fields: number; queued: number; running: number; failed: number; finished: number; total: number; done: number;
        covered_until: string | null; history_from: string | null; error: string | null;
      }>`
        SELECT count(*)::int AS fields,
               count(*) FILTER (WHERE j.status = 'queued')::int AS queued,
               count(*) FILTER (WHERE j.status = 'running')::int AS running,
               count(*) FILTER (WHERE j.status = 'failed')::int AS failed,
               count(*) FILTER (WHERE j.status = 'finished')::int AS finished,
               coalesce(sum(j.scenes_total), 0)::int AS total, coalesce(sum(j.scenes_done), 0)::int AS done,
               min(j.covered_until)::text AS covered_until, min(j.date_from)::text AS history_from,
               max(j.error) AS error
        FROM field_imagery_jobs j
        JOIN field_current_geometry g ON g.id = j.geometry_version_id
        JOIN fields f ON f.id = j.field_id AND f.status = 'active'
        WHERE (${field}::uuid IS NULL OR j.field_id = ${field}::uuid)`.execute(trx);
      const r = rows[0];
      const state: ImageryStatus['state'] =
        r.fields === 0 ? 'none' : r.running > 0 ? 'running' : r.queued > 0 ? 'queued' : r.failed > 0 ? 'failed' : 'finished';
      return {
        state,
        fields: r.fields,
        scenesTotal: r.total,
        scenesDone: Math.min(r.done, r.total),
        coveredUntil: r.covered_until,
        historyFrom: r.history_from,
        error: r.error,
      };
    });
  }
}
