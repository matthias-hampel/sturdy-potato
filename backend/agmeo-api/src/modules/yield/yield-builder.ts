import { Logger } from '@nestjs/common';
import type { Geometry } from 'geojson';
import { sql, type Kysely, type Transaction } from 'kysely';
import type { DB } from '../../db/schema.js';
import type { Job } from '../../jobs/runner.js';
import { enqueue } from '../../jobs/queue.js';
import type { StorageDriver } from '../../storage/object-storage.js';
import { toBuffer } from '../files/zip.js';
import { boundaryHashOf, computeRecipeHash, computeSourceFingerprint, type EventRaster, mergeEvent, resolveTargetMoisture } from './lib/build.js';
import { encodeRaster, fieldGrid, GridError, round } from './lib/grid.js';
import { dedupeByFingerprint, groupSourcesIntoEvents, type HarvestEvent } from './lib/merge.js';
import { parseYieldPoints, pointsBbox } from './lib/parse.js';
import type { ParsedYieldPoints } from './lib/types.js';
import { planWriteBack } from './lib/writeBack.js';
import { computeZoneYieldsFromRaster, RELATIVE_YIELD_BOUNDS } from './lib/zoneYields.js';

export const YIELD_BUILD = 'yield.build';
export const YIELD_SWEEP = 'yield.sweep';

type Db = Kysely<DB> | Transaction<DB>;

/** Verdicts about the data (no yield column, unsupported CRS, too large): retrying cannot help. */
const PERMANENT_STATUSES = [400, 404, 413, 422];
/** A source failing this often on infrastructure errors is given up on. */
export const MAX_SOURCE_ATTEMPTS = 3;

/** The crop cycle a build works on, with its boundary (the field part's, or the field's). */
export type CycleContext = {
  id: string;
  organizationId: string;
  fieldId: string;
  harvestYear: number;
  /** Code and names, for the crop windows and the reference moisture. */
  cropKey: string;
  cropName: string;
  geometry: Geometry;
  areaHa: number;
};

export async function loadCycleContext(db: Db, cropCycleId: string): Promise<CycleContext | null> {
  const { rows } = await sql<{
    id: string;
    organization_id: string;
    field_id: string;
    harvest_year: number;
    code: string;
    name: string;
    name_de: string | null;
    geometry: string | null;
    area_ha: number | null;
  }>`
    SELECT cc.id, cc.organization_id, cc.field_id, s.harvest_year, c.code, c.name, c.name_de,
           ST_AsGeoJSON(COALESCE(fp.geometry, g.geometry)) AS geometry,
           COALESCE(cc.area_ha, fp.area_ha, g.area_ha)::float8 AS area_ha
    FROM crop_cycles cc
    JOIN growing_seasons s ON s.id = cc.season_id
    JOIN crops c ON c.id = cc.crop_id
    LEFT JOIN field_parts fp ON fp.id = cc.field_part_id
    LEFT JOIN field_current_geometry g ON g.field_id = cc.field_id
    WHERE cc.id = ${cropCycleId}::uuid`.execute(db);
  const row = rows[0];
  if (!row?.geometry) return null;
  return {
    id: row.id,
    organizationId: row.organization_id,
    fieldId: row.field_id,
    harvestYear: row.harvest_year,
    cropKey: [row.code, row.name, row.name_de].filter(Boolean).join(' '),
    cropName: row.name_de ?? row.name,
    geometry: JSON.parse(row.geometry) as Geometry,
    areaHa: row.area_ha ?? 0,
  };
}

type SourceRow = {
  id: string;
  provider: string;
  storage_key: string | null;
  status: string;
  attempts: number;
  included_in_merge: boolean;
  harvested_from: Date | null;
  harvested_to: Date | null;
  fingerprint: string | null;
  created_at: Date;
};

export type BuildSummary = { built: string[]; failedSources: string[]; superseded: number; writeback: string | null };

/**
 * Builds the yield rasters of one crop cycle: parses every included source (failures are
 * recorded per source), groups the sources into harvest events, merges each event on the
 * field grid, computes the zone yields of the field's zonings and fills the documented yield
 * where the guards allow. Idempotent — the recipe hash makes an unchanged event a no-op write.
 */
export class YieldBuilder {
  private readonly logger = new Logger('YieldBuilder');

  constructor(
    private readonly db: Kysely<DB>,
    private readonly storage: StorageDriver,
  ) {}

  async buildCropCycle(cropCycleId: string): Promise<BuildSummary> {
    const summary: BuildSummary = { built: [], failedSources: [], superseded: 0, writeback: null };
    const cycle = await loadCycleContext(this.db, cropCycleId);
    if (!cycle) return summary;
    const near = centre(cycle.geometry);

    const sources = await this.db
      .selectFrom('yield_map_sources')
      .select(['id', 'provider', 'storage_key', 'status', 'attempts', 'included_in_merge', 'harvested_from', 'harvested_to', 'fingerprint', 'created_at'])
      .where('crop_cycle_id', '=', cropCycleId)
      .where('kind', '=', 'yield')
      .execute();

    // 1. Parse every included source once. A source that cannot be parsed is marked and
    //    skipped; one bad export must not cost the crop cycle its other maps.
    const parsed = new Map<string, ParsedYieldPoints>();
    for (const source of sources as SourceRow[]) {
      if (!source.included_in_merge || !source.storage_key || source.status === 'failed' || source.status === 'skipped') continue;
      try {
        const result = await parseYieldPoints(await toBuffer(await this.storage.get(source.storage_key)), { crop: cycle.cropKey, near });
        parsed.set(source.id, result);
        const bbox = pointsBbox(result.points);
        const fingerprint = computeSourceFingerprint({ pointCount: result.points.length, bbox4326: bbox, meanTHa: result.quality.meanRate, basis: result.basis, format: result.format });
        const [from, to] = result.timeRange ?? [null, null];
        await this.db
          .updateTable('yield_map_sources')
          .set({
            format: result.format,
            attribute: result.attribute,
            basis: result.basis,
            crs: result.crs ?? null,
            point_count: result.points.length,
            total_features: result.totalFeatures,
            mean_rate_t_ha: result.quality.meanRate,
            bbox,
            fingerprint,
            quality: JSON.stringify({ quality: result.quality, cleaning: result.cleaning, sources: result.sources, moisture: result.moisture ?? null }),
            // The logged times are the real harvest window; a date the user typed stays.
            harvested_from: source.harvested_from ?? (from !== null ? new Date(from) : null),
            harvested_to: source.harvested_to ?? (to !== null ? new Date(to) : null),
            status: 'ok',
            error: null,
            attempts: 0,
            parsed_at: new Date(),
          })
          .where('id', '=', source.id)
          .execute();
        source.fingerprint = fingerprint;
        if (!source.harvested_from && from !== null) source.harvested_from = new Date(from);
        source.status = 'ok';
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const permanent = error instanceof GridError && PERMANENT_STATUSES.includes(error.status);
        const attempts = source.attempts + 1;
        summary.failedSources.push(source.id);
        await this.db
          .updateTable('yield_map_sources')
          .set({ status: permanent || attempts >= MAX_SOURCE_ATTEMPTS ? 'failed' : 'pending_parse', error: message.slice(0, 2000), attempts })
          .where('id', '=', source.id)
          .execute();
        if (!permanent) this.logger.warn(`yield source ${source.id} failed (attempt ${attempts}): ${message}`);
      }
    }

    // 2. Harvest events of the parsed sources; the fingerprint tier drops byte-identical copies.
    const usable = (sources as SourceRow[]).filter((s) => parsed.has(s.id));
    const fingerprintDuplicates = dedupeByFingerprint(usable.map((s) => ({ id: s.id, fingerprint: s.fingerprint, createdAt: s.created_at.toISOString() })));
    const events = groupSourcesIntoEvents(
      usable.filter((s) => !fingerprintDuplicates.has(s.id)).map((s) => ({ id: s.id, productArticleId: null, harvestedFrom: s.harvested_from, provider: s.provider })),
    );

    const grid = fieldGrid([cycle.geometry]);
    const boundaryHash = boundaryHashOf(cycle.geometry);
    const liveEventKeys: string[] = [];
    for (const event of events) {
      liveEventKeys.push(event.key);
      const rasterId = await this.buildEvent(cycle, grid, boundaryHash, event, parsed, fingerprintDuplicates);
      if (rasterId) summary.built.push(rasterId);
    }

    // 3. Rasters of events that no longer exist (a source removed or excluded) are retired.
    let retire = this.db.updateTable('yield_rasters').set({ superseded_at: new Date() }).where('crop_cycle_id', '=', cropCycleId).where('superseded_at', 'is', null);
    if (liveEventKeys.length) retire = retire.where('harvest_event_key', 'not in', liveEventKeys);
    summary.superseded = Number((await retire.executeTakeFirst()).numUpdatedRows ?? 0);

    // 4. The documented yield, from the merged map.
    summary.writeback = await this.writeBack(cycle);
    return summary;
  }

  private async buildEvent(
    cycle: CycleContext,
    grid: ReturnType<typeof fieldGrid>,
    boundaryHash: string,
    event: HarvestEvent<{ id: string; productArticleId: string | null; harvestedFrom: Date | null; provider: string }>,
    parsed: Map<string, ParsedYieldPoints>,
    fingerprintDuplicates: Map<string, string>,
  ): Promise<string | null> {
    const started = Date.now();
    const recipeHash = computeRecipeHash({
      sourceFingerprints: event.sources.map((s) => `${s.id}:${parsed.get(s.id)!.points.length}`),
      crop: cycle.cropKey,
      resolution: grid.resolution,
      targetMoisture: resolveTargetMoisture(cycle.cropKey),
      boundaryHash,
    });
    const existing = await this.db
      .selectFrom('yield_rasters')
      .select(['id', 'superseded_at'])
      .where('crop_cycle_id', '=', cycle.id)
      .where('recipe_hash', '=', recipeHash)
      .executeTakeFirst();
    if (existing && !existing.superseded_at) return existing.id;

    const documented = await this.documentedTotalT(cycle.id);
    const result = mergeEvent({
      grid,
      boundary: cycle.geometry,
      sources: event.sources.map((s) => ({ sourceId: s.id, provider: s.provider, parsed: parsed.get(s.id)! })),
      crop: cycle.cropKey,
      documentedTotalT: documented,
    });
    if (!result) {
      for (const s of event.sources) {
        await this.db
          .updateTable('yield_map_sources')
          .set({ included_in_merge: false, excluded_reason: 'no_overlap', error: 'No point of this export lies on the field' })
          .where('id', '=', s.id)
          .execute();
      }
      return null;
    }
    // The fingerprint tier dropped copies before parsing them into the merge; name them anyway.
    for (const [sourceId, kept] of fingerprintDuplicates) {
      if (event.sources.some((s) => s.id === kept)) {
        result.merged.contributions.push({ sourceId, pixels: 0, overlapPixels: 0, calibrationFactor: 1, massT: 0, excluded: `duplicate of ${kept}` });
      }
    }

    const rasterId = await this.db.transaction().execute(async (trx) => {
      await trx
        .updateTable('yield_rasters')
        .set({ superseded_at: new Date() })
        .where('crop_cycle_id', '=', cycle.id)
        .where('harvest_event_key', '=', event.key)
        .where('superseded_at', 'is', null)
        .execute();
      const values = rasterValues(cycle, event, recipeHash, boundaryHash, result, Date.now() - started);
      const row = await trx
        .insertInto('yield_rasters')
        .values(values)
        .onConflict((oc) => oc.columns(['crop_cycle_id', 'recipe_hash']).doUpdateSet({ ...values, superseded_at: null, built_at: new Date() }))
        .returning('id')
        .executeTakeFirstOrThrow();

      for (const source of result.sources) {
        const cleaning = result.cleaning.find((c) => c.sourceId === source.sourceId);
        await trx
          .updateTable('yield_map_sources')
          .set({
            pixel_mean_t_ha: source.pixelMeanTHa,
            covered_ha: source.coveredHa,
            // The track filters run in the merge; the source shows the whole cleaning report.
            ...(cleaning ? { quality: sql`coalesce(quality, '{}'::jsonb) || jsonb_build_object('cleaning', ${JSON.stringify(cleaning)}::jsonb)` } : {}),
            ...(source.duplicate ? { included_in_merge: false, excluded_reason: 'duplicate' } : {}),
          })
          .where('id', '=', source.sourceId)
          .execute();
      }
      for (const [sourceId] of fingerprintDuplicates) {
        await trx.updateTable('yield_map_sources').set({ excluded_reason: 'duplicate' }).where('id', '=', sourceId).execute();
      }
      await this.writeZoneYields(trx, cycle, row.id, result);
      return row.id;
    });
    return rasterId;
  }

  /** Measured means per zone of every zoning of the field's current boundary. */
  private async writeZoneYields(trx: Transaction<DB>, cycle: CycleContext, rasterId: string, result: EventRaster) {
    const { rows } = await sql<{ zoning_id: string; zone_no: number; geometry: string }>`
      SELECT zz.zoning_id, zz.zone_no, ST_AsGeoJSON(zz.geometry) AS geometry
      FROM zonings z
      JOIN zoning_zones zz ON zz.zoning_id = z.id
      JOIN field_current_geometry g ON g.field_id = z.field_id AND g.id = z.geometry_version_id
      WHERE z.field_id = ${cycle.fieldId}::uuid`.execute(trx);
    const byZoning = new Map<string, { id: string; geometry: Geometry; zoneNo: number }[]>();
    for (const r of rows) {
      const list = byZoning.get(r.zoning_id) ?? [];
      list.push({ id: `${r.zoning_id}:${r.zone_no}`, geometry: JSON.parse(r.geometry) as Geometry, zoneNo: r.zone_no });
      byZoning.set(r.zoning_id, list);
    }
    await trx.deleteFrom('yield_zone_yields').where('yield_raster_id', '=', rasterId).execute();
    const clip = (v: number) => Math.min(RELATIVE_YIELD_BOUNDS[1], Math.max(RELATIVE_YIELD_BOUNDS[0], v));
    for (const [zoningId, zones] of byZoning) {
      const yields = computeZoneYieldsFromRaster(result.raster, result.grid, zones);
      const values = yields.zones.map((z, i) => ({
        organization_id: cycle.organizationId,
        yield_raster_id: rasterId,
        zoning_id: zoningId,
        zone_no: zones[i].zoneNo,
        mean_t_ha: z.yieldInTpHa === null ? null : round(z.yieldInTpHa, 3),
        relative_yield: z.relativeYield === null ? null : round(clip(z.relativeYield), 4),
        pixels: z.pixels,
      }));
      if (values.length) await trx.insertInto('yield_zone_yields').values(values).execute();
    }
  }

  /** Documented harvest total [t], for calibrating the map to a weighbridge figure. */
  private async documentedTotalT(cropCycleId: string): Promise<number | null> {
    const row = await this.db
      .selectFrom('harvests')
      .select(sql<number>`sum(quantity_t)::float8`.as('total'))
      .where('crop_cycle_id', '=', cropCycleId)
      .where('yield_raster_id', 'is', null)
      .executeTakeFirst();
    return row?.total && row.total > 0 ? row.total : null;
  }

  /**
   * Fill the documented yield from the live raster — only with a single harvest event and
   * every guard of planWriteBack. The outcome is recorded on the raster.
   */
  private async writeBack(cycle: CycleContext): Promise<string | null> {
    const rasters = await this.db
      .selectFrom('yield_rasters')
      .select(['id', 'mean_t_ha', 'area_ha', 'event_from', 'event_to'])
      .where('crop_cycle_id', '=', cycle.id)
      .where('superseded_at', 'is', null)
      .orderBy('event_from', 'desc')
      .execute();
    if (!rasters.length) return null;
    const record = (id: string, status: 'filled' | 'skipped', reason: string | null, harvestId: string | null) =>
      this.db.updateTable('yield_rasters').set({ writeback_status: status, writeback_reason: reason, writeback_harvest_id: harvestId, writeback_at: new Date() }).where('id', '=', id).execute();
    if (rasters.length > 1) {
      for (const r of rasters) await record(r.id, 'skipped', 'multi-cut', null);
      return 'skipped:multi-cut';
    }
    const raster = rasters[0];
    const harvests = await this.db
      .selectFrom('harvests')
      .select(['id', 'harvest_date', 'harvested_area_ha', 'quantity_t', 'yield_raster_id'])
      .where('crop_cycle_id', '=', cycle.id)
      .execute();
    const plan = planWriteBack({
      rows: harvests.map((h) => ({ id: h.id, operationId: null, date: new Date(h.harvest_date), quantityT: Number(h.quantity_t), areaHa: Number(h.harvested_area_ha), yieldRasterId: h.yield_raster_id })),
      cultivationAreaHa: cycle.areaHa,
      pixelMeanTHa: raster.mean_t_ha ?? 0,
      coveredHa: raster.area_ha ?? 0,
      hasEventDate: !!raster.event_from,
    });
    if (plan.action === 'skip') {
      await record(raster.id, 'skipped', plan.reason, null);
      return `skipped:${plan.reason}`;
    }
    let harvestId: string;
    if (plan.action === 'update') {
      await this.db.updateTable('harvests').set({ quantity_t: plan.quantityT, yield_raster_id: raster.id }).where('id', '=', plan.harvestId).execute();
      harvestId = plan.harvestId;
    } else {
      const day = (raster.event_to ?? raster.event_from)!.toISOString().slice(0, 10);
      const row = await this.db
        .insertInto('harvests')
        .values({
          organization_id: cycle.organizationId,
          crop_cycle_id: cycle.id,
          harvest_date: day,
          harvested_area_ha: round(plan.areaHa, 4),
          quantity_t: plan.quantityT,
          notes: 'Ertragskarte',
          yield_raster_id: raster.id,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      harvestId = row.id;
    }
    await record(raster.id, 'filled', null, harvestId);
    return 'filled';
  }
}

function rasterValues(cycle: CycleContext, event: HarvestEvent<{ id: string; productArticleId: string | null; harvestedFrom: Date | null }>, recipeHash: string, boundaryHash: string, result: EventRaster, buildMs: number) {
  const s = result.stats?.statistics;
  return {
    organization_id: cycle.organizationId,
    crop_cycle_id: cycle.id,
    field_id: cycle.fieldId,
    harvest_event_key: event.key,
    event_from: event.from,
    event_to: event.to,
    recipe_hash: recipeHash,
    boundary_hash: boundaryHash,
    grid_epsg: result.grid.epsg,
    grid_origin_x: result.grid.originX,
    grid_origin_y: result.grid.originY,
    grid_resolution: result.grid.resolution,
    grid_width: result.grid.width,
    grid_height: result.grid.height,
    data: encodeRaster(result.raster),
    attribute: [...new Set(result.sources.map((x) => x.parsed.attribute))].join(' + '),
    format: result.sources[0]?.parsed.format ?? null,
    basis: result.basis,
    target_moisture: result.targetMoisture,
    mean_t_ha: s?.mean ?? round(result.merged.pixelMean, 4),
    median_t_ha: s?.median ?? null,
    stddev_t_ha: s?.stddev ?? null,
    min_t_ha: s?.min ?? null,
    max_t_ha: s?.max ?? null,
    q20_t_ha: s?.q20 ?? null,
    q80_t_ha: s?.q80 ?? null,
    p05_t_ha: s?.p05 ?? null,
    p95_t_ha: s?.p95 ?? null,
    valid_pixels: result.stats?.validPixels ?? result.merged.coveredPixels,
    covered_pixels: result.merged.coveredPixels,
    filled_pixels: result.filledPixels,
    area_ha: result.coveredHa,
    harvested_ha: result.harvestedHa,
    total_t: result.totalT,
    field_coverage: result.fieldCoverage,
    total_calibration_factor: result.totalCalibration.applied ? round(result.totalCalibration.factor, 4) : null,
    histogram: JSON.stringify(result.stats?.histogram ?? []),
    contributions: JSON.stringify(result.merged.contributions.map((c) => ({ ...c, massT: round(c.massT, 3), calibrationFactor: round(c.calibrationFactor, 4) }))),
    cleaning: JSON.stringify(result.cleaning),
    quality: JSON.stringify(result.quality),
    status: 'ready',
    superseded_at: null,
    built_at: new Date(),
    build_ms: buildMs,
  };
}

function centre(geometry: Geometry): [number, number] {
  const ring = geometry.type === 'Polygon' ? geometry.coordinates[0] : geometry.type === 'MultiPolygon' ? geometry.coordinates[0][0] : [];
  if (!ring.length) return [0, 0];
  return [ring.reduce((s, p) => s + p[0], 0) / ring.length, ring.reduce((s, p) => s + p[1], 0) / ring.length];
}

/** Job handlers: build one crop cycle; the sweep re-queues sources a lost job left behind. */
export function yieldJobHandlers(db: Kysely<DB>, storage: StorageDriver) {
  const builder = new YieldBuilder(db, storage);
  return {
    [YIELD_BUILD]: async (job: Job) => {
      const cropCycleId = job.payload.cropCycleId as string | undefined;
      if (cropCycleId) await builder.buildCropCycle(cropCycleId);
    },
    [YIELD_SWEEP]: async () => {
      const due = await db
        .selectFrom('yield_map_sources')
        .select(['crop_cycle_id', 'organization_id'])
        .distinct()
        .where('status', '=', 'pending_parse')
        .where('attempts', '<', MAX_SOURCE_ATTEMPTS)
        .where('updated_at', '<', sql<Date>`now() - interval '10 minutes'`)
        .limit(50)
        .execute();
      for (const row of due) await enqueue(db, { kind: YIELD_BUILD, organizationId: row.organization_id, payload: { cropCycleId: row.crop_cycle_id } });
    },
  };
}
