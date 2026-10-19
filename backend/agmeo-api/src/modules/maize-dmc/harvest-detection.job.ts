/**
 * Daily satellite harvest detection for every maize crop with a DMC run (reference
 * lib/maizeDmc/harvestDetectionJob.ts + harvestDetectionDb.ts, cron /api/cron/dmc-harvest-detection
 * at 06:30 UTC after the satellite crawler). Runs as agmeo_jobs: inputs come from
 * app.maize_dmc_detection_inputs(), the rest from the maize_dmc_* tables it is granted.
 *
 * Pure logic lives in harvest-detection.ts. Without a configured maize-dmc-api the job skips
 * itself (no new runs are made, so there is nothing to detect against).
 */
import { Logger } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { config } from '../../config.js';
import type { DB } from '../../db/schema.js';
import type { JobHandler } from '../../jobs/runner.js';
import { detectHarvest, eligibleScenes, type HarvestDetection, type SceneObservation, siteContaminatedDates } from './harvest-detection.js';
import { storedValueOn } from './forecast.js';

export const MAIZE_DMC_HARVEST_DETECTION = 'maize_dmc.harvest_detection';

/** Scenes before this need no evaluation: silage maize is never cut before June. */
const SCENE_SERIES_START_MONTH_DAY = '06-01';
/** Without a DM run on the scene day, drops before this date are not considered harvests. */
const SEASON_START_MONTH_DAY = '08-01';
/** Standard-run DM is loaded from here (the agronomic gate only looks at scene days). */
const DM_START_MONTH_DAY = '07-15';
/**
 * Our observations carry the share of valid (cloud-free) pixels, not a cloud cover: a scene
 * counts as clear (cloud cover 0, as the detector expects) at ≥ 99 % valid pixels.
 */
const CLEAR_MIN_VALID_PIXEL_PCT = 99;

export interface DetectionField {
  organizationId: string;
  cropCycleId: string;
  fieldId: string;
  fieldName: string | null;
  lat: number | null;
  lng: number | null;
  scenes: SceneObservation[];
}

/**
 * Site key for the contamination check: a location number at the start of the field name
 * ("14 - ISLANDO" → "loc-14"), else the 0.1° grid cell of the centroid (~11 × 7 km — same
 * Sentinel-2 pass, same weather). Per organization: sites never span tenants.
 */
export function siteKeyFor(field: Pick<DetectionField, 'organizationId' | 'fieldName' | 'lat' | 'lng'>): string | null {
  const loc = field.fieldName?.match(/^(\d{1,2})\s*-\s*/);
  if (loc) return `${field.organizationId}:loc-${loc[1]}`;
  if (field.lat == null || field.lng == null) return null;
  return `${field.organizationId}:${Math.floor(field.lat * 10)}_${Math.floor(field.lng * 10)}`;
}

/** An observation row of the inputs function as a detector scene. */
export function sceneOf(o: { date: string; ndvi: number | string | null; validPixelPct: number | string | null; status?: string }): SceneObservation {
  const valid = o.validPixelPct == null ? null : Number(o.validPixelPct);
  return {
    date: o.date,
    ndvi: o.ndvi == null ? null : Number(o.ndvi),
    cloudCover: valid == null ? null : valid >= CLEAR_MIN_VALID_PIXEL_PCT && o.status !== 'insufficient_coverage' ? 0 : Math.round(100 - valid),
  };
}

export interface DetectionPlan {
  detections: (HarvestDetection & { field: DetectionField })[];
  satelliteStatus: { field: DetectionField; date: string; ndvi: number }[];
  contaminatedSiteScenes: number;
  vetoed: number;
}

/**
 * The detector over all fields: site contamination, latest clear scene per field (the
 * standing-crop veto), candidates without the DM gate, then the real run with the standard-run
 * DM and the "still standing" measurement dates. Pure.
 */
export function planDetections(args: {
  fields: DetectionField[];
  year: number;
  dmByCycle: ReadonlyMap<string, ReadonlyMap<string, number>>;
  standingByCycle: ReadonlyMap<string, readonly string[]>;
}): DetectionPlan {
  const sites = new Map<string, Map<string, SceneObservation[]>>();
  for (const f of args.fields) {
    const key = siteKeyFor(f);
    if (!key || !f.scenes.length) continue;
    const site = sites.get(key) ?? new Map<string, SceneObservation[]>();
    site.set(f.cropCycleId, f.scenes);
    sites.set(key, site);
  }
  const contaminatedBySite = new Map<string, Set<string>>();
  let contaminatedSiteScenes = 0;
  for (const [key, site] of sites) {
    const dates = siteContaminatedDates(site);
    contaminatedSiteScenes += dates.size;
    contaminatedBySite.set(key, dates);
  }

  const none = new Set<string>();
  const noDm = new Map<string, number>();
  const satelliteStatus: DetectionPlan['satelliteStatus'] = [];
  const detections: DetectionPlan['detections'] = [];
  let vetoed = 0;
  for (const f of args.fields) {
    const eligible = eligibleScenes(f.scenes, contaminatedBySite.get(siteKeyFor(f) ?? '') ?? none);
    const latest = eligible.at(-1);
    if (latest) satelliteStatus.push({ field: f, date: latest.date, ndvi: latest.ndvi });
    // Pass 1: candidates without the DM gate (the gate can only remove candidates).
    if (!detectHarvest({ scenes: eligible, contaminatedDates: none, dmByDate: noDm, standingDates: [], seasonStart: `${args.year}-01-01` })) continue;
    // Pass 2: the real run.
    const detection = detectHarvest({
      scenes: eligible,
      contaminatedDates: none,
      dmByDate: args.dmByCycle.get(f.cropCycleId) ?? noDm,
      standingDates: args.standingByCycle.get(f.cropCycleId) ?? [],
      seasonStart: `${args.year}-${SEASON_START_MONTH_DAY}`,
    });
    if (!detection) continue;
    if (detection.status === 'rejected' && detection.rejectedReason?.startsWith('crop sampled')) vetoed += 1;
    detections.push({ ...detection, field: f });
  }
  return { detections, satelliteStatus, contaminatedSiteScenes, vetoed };
}

export async function runHarvestDetection(db: Kysely<DB>, year: number, logger = new Logger('MaizeDmcHarvestDetection')) {
  const { rows } = await sql<{
    organization_id: string;
    crop_cycle_id: string;
    field_id: string;
    field_name: string | null;
    lat: number | null;
    lng: number | null;
    scenes: { date: string; ndvi: number | null; validPixelPct: number | null; status: string }[];
  }>`SELECT * FROM app.maize_dmc_detection_inputs(${year}::int, ${`${year}-${SCENE_SERIES_START_MONTH_DAY}`}::date)`.execute(db);
  const fields: DetectionField[] = rows.map((r) => ({
    organizationId: r.organization_id,
    cropCycleId: r.crop_cycle_id,
    fieldId: r.field_id,
    fieldName: r.field_name,
    lat: r.lat == null ? null : Number(r.lat),
    lng: r.lng == null ? null : Number(r.lng),
    scenes: (r.scenes ?? []).map(sceneOf),
  }));
  if (!fields.length) return { fields: 0, written: 0, satelliteStatusWritten: 0, contaminatedSiteScenes: 0, vetoed: 0 };
  const ids = fields.map((f) => f.cropCycleId);

  // Standard-run DM per cycle and run day (the first predicted day of the newest run of that day).
  const runs = await db
    .selectFrom('maize_dmc_runs')
    .select(['crop_cycle_id', 'run_date', 'pred_from_date', 'pred_medians', 'created_at'])
    .where('crop_cycle_id', 'in', ids)
    .where('harvest_year', '=', year)
    .where('mode', '=', 'standard')
    .where('run_date', '>=', `${year}-${DM_START_MONTH_DAY}`)
    .orderBy('created_at', 'desc')
    .execute();
  const dmByCycle = new Map<string, Map<string, number>>();
  for (const r of runs) {
    const m = dmByCycle.get(r.crop_cycle_id) ?? new Map<string, number>();
    const v = storedValueOn({ pred_from_date: r.pred_from_date, pred_medians: r.pred_medians, pred_p10: null, pred_p90: null }, r.run_date);
    if (v && !m.has(r.run_date)) m.set(r.run_date, v.median);
    dmByCycle.set(r.crop_cycle_id, m);
  }
  // A DM sample proves the crop was still standing that day (superseded samples included).
  const samples = await db.selectFrom('maize_dmc_calibrations').select(['crop_cycle_id', 'measurement_date']).where('crop_cycle_id', 'in', ids).where('harvest_year', '=', year).execute();
  const standingByCycle = new Map<string, string[]>();
  for (const s of samples) standingByCycle.set(s.crop_cycle_id, [...(standingByCycle.get(s.crop_cycle_id) ?? []), s.measurement_date].sort());

  const plan = planDetections({ fields, year, dmByCycle, standingByCycle });

  await db.transaction().execute(async (trx) => {
    for (const s of plan.satelliteStatus) {
      await trx
        .insertInto('maize_dmc_satellite_status')
        .values({ crop_cycle_id: s.field.cropCycleId, organization_id: s.field.organizationId, field_id: s.field.fieldId, harvest_year: year, latest_clear_date: s.date, latest_clear_ndvi: s.ndvi })
        .onConflict((oc) => oc.column('crop_cycle_id').doUpdateSet({ latest_clear_date: s.date, latest_clear_ndvi: s.ndvi, updated_at: new Date() }))
        .execute();
    }
    for (const d of plan.detections) {
      // confirmed_at is set the first time a row is confirmed; a confirmed row is only
      // downgraded by a ground-truth veto (rejected with a "crop sampled" reason).
      await trx
        .insertInto('maize_dmc_harvest_detections')
        .values({
          crop_cycle_id: d.field.cropCycleId,
          organization_id: d.field.organizationId,
          field_id: d.field.fieldId,
          harvest_year: year,
          status: d.status,
          trust: d.trust,
          window_start: d.windowStart,
          window_end: d.windowEnd,
          confirm_date: d.confirmDate,
          rejected_reason: d.rejectedReason,
          evidence: JSON.stringify({ referenceNdvi: d.referenceNdvi, dropNdvi: d.dropNdvi, drop: d.drop, confirmNdvi: d.confirmNdvi }),
          confirmed_at: d.status === 'confirmed' ? new Date() : null,
        })
        .onConflict((oc) =>
          oc.column('crop_cycle_id').doUpdateSet({
            status: sql`CASE
              WHEN maize_dmc_harvest_detections.status = 'confirmed' AND excluded.status <> 'rejected' THEN maize_dmc_harvest_detections.status
              WHEN maize_dmc_harvest_detections.status = 'confirmed' AND excluded.rejected_reason NOT LIKE 'crop sampled%' THEN maize_dmc_harvest_detections.status
              ELSE excluded.status END`,
            trust: sql`CASE WHEN maize_dmc_harvest_detections.status = 'confirmed' AND excluded.status <> 'rejected' THEN maize_dmc_harvest_detections.trust ELSE excluded.trust END`,
            window_start: sql`excluded.window_start`,
            window_end: sql`excluded.window_end`,
            confirm_date: sql`coalesce(excluded.confirm_date, maize_dmc_harvest_detections.confirm_date)`,
            rejected_reason: sql`excluded.rejected_reason`,
            evidence: sql`excluded.evidence`,
            confirmed_at: sql`coalesce(maize_dmc_harvest_detections.confirmed_at, excluded.confirmed_at)`,
            updated_at: new Date(),
          }),
        )
        .execute();
    }
  });
  const result = { fields: fields.length, written: plan.detections.length, satelliteStatusWritten: plan.satelliteStatus.length, contaminatedSiteScenes: plan.contaminatedSiteScenes, vetoed: plan.vetoed };
  logger.log(`harvest detection ${year}: ${JSON.stringify(result)}`);
  return result;
}

export const harvestDetectionHandler =
  (db: Kysely<DB>): JobHandler =>
  async (job) => {
    const logger = new Logger('MaizeDmcHarvestDetection');
    if (!config.maizeDmc.apiUrl) {
      logger.debug('maize-dmc-api is not configured; skipping harvest detection');
      return;
    }
    const year = Number(job.payload.year) || new Date().getUTCFullYear();
    await runHarvestDetection(db, year, logger);
  };
