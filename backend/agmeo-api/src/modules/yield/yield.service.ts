import { Injectable, Logger } from '@nestjs/common';
import {
  type CropCycleYield,
  InspectYieldMapInput,
  RegisterYieldMapInput,
  SaveYieldZoningInput,
  UpdateYieldMapSourceInput,
  YIELD_RAMP,
  YieldEstimateInput,
  type YieldEstimatePreview,
  type YieldEstimateScene,
  type YieldHistoryEntry,
  type YieldMapInspection,
  type YieldMapSource,
  type YieldOverview,
  type YieldOverviewRow,
  type YieldRaster,
  type YieldZoning,
  type ZoneYieldSet,
} from '@agmeo/contracts';
import type { Geometry } from 'geojson';
import { sql, type Selectable } from 'kysely';
import type { Ctx } from '../../auth/context.js';
import { config } from '../../config.js';
import { badRequest, DomainError, notFound } from '../../core/errors.js';
import { record } from '../../core/events.js';
import type { Out } from '../../core/validation.js';
import { Database, type Trx } from '../../db/database.js';
import type { YieldMapSources, YieldRasters } from '../../db/schema.js';
import { enqueue } from '../../jobs/queue.js';
import { ObjectStorage } from '../../storage/object-storage.js';
import { FilesService, type IncomingFile } from '../files/files.service.js';
import { toBuffer } from '../files/zip.js';
import { decodeRaster, fieldGrid, gridCornersLonLat, GridError, type GridDefinition, round } from './lib/grid.js';
import { parseYieldPoints, pointsBbox } from './lib/parse.js';
import { emptyTile, renderTile } from './lib/render.js';
import { syntheticYieldEstimate } from './lib/synthetic.js';
import { classifyYieldRaster, zoneCountForSpread } from './lib/zonation.js';
import { computeZoneYieldsFromRaster, RELATIVE_YIELD_BOUNDS } from './lib/zoneYields.js';
import { type CycleContext, loadCycleContext, YIELD_BUILD } from './yield-builder.js';

/** Largest export the API parses itself to suggest fields; bigger ones are matched by hand. */
const MAX_INSPECT_BYTES = 200 * 1024 * 1024;
/** Points sampled for field matching. */
const MATCH_SAMPLE = 2000;
/** Below this share of the export's points a field is not offered as a match. */
const MIN_MATCH_SHARE = 0.02;
/** How far before the harvest the estimate looks for a clear acquisition [days]. */
const SCENE_LOOKBACK_DAYS = 90;
const MIN_SCENE_VALID_PCT = 80;

type SourceRow = Selectable<YieldMapSources> & { field_name: string; crop_name: string };
type RasterRow = Selectable<YieldRasters>;

/** Decoded rasters, for tiles (a map view requests a dozen tiles of the same raster). */
const rasterCache = new Map<string, { grid: GridDefinition; data: Float64Array; range: [number, number] }>();
const RASTER_CACHE_SIZE = 32;

@Injectable()
export class YieldService {
  private readonly logger = new Logger(YieldService.name);

  constructor(
    private readonly db: Database,
    private readonly storage: ObjectStorage,
    private readonly files: FilesService,
  ) {}

  // -------------------------------------------------------------------------
  // Import
  // -------------------------------------------------------------------------

  /** Stores uploaded exports in the "Ertragskarten" folder and inspects each one. */
  async upload(ctx: Ctx, incoming: IncomingFile[], year: number | null, seasonId: string | null): Promise<YieldMapInspection[]> {
    for (const f of incoming) {
      if (!/\.(zip|aft)$/i.test(f.name)) throw badRequest('invalid_yield_map', 'Yield maps must be a .zip export or a bare .aft file', { name: f.name });
    }
    const folderId = await this.db.run(ctx, (trx) => this.files.systemFolder(trx, ctx, 'yieldMaps'));
    const stored = await this.files.upload(ctx, folderId, year, incoming);
    const out: YieldMapInspection[] = [];
    for (const file of stored) out.push(await this.inspect(ctx, { fileId: file.id, seasonId }));
    return out;
  }

  /** Reads an export and finds the crop cycles it overlaps (share of its points inside each). */
  async inspect(ctx: Ctx, input: Out<typeof InspectYieldMapInput>): Promise<YieldMapInspection> {
    const file = await this.db.run(ctx, (trx) =>
      trx.selectFrom('files').select(['id', 'name', 'size_bytes', 'storage_key']).where('id', '=', input.fileId).where('deleted_at', 'is', null).executeTakeFirst(),
    );
    if (!file) throw notFound('File');
    const base: YieldMapInspection = {
      fileId: file.id,
      fileName: file.name,
      sizeBytes: Number(file.size_bytes),
      format: null,
      attribute: null,
      crs: null,
      pointCount: 0,
      meanRateTHa: null,
      plausible: null,
      note: null,
      harvestedFrom: null,
      harvestedTo: null,
      bbox: null,
      matches: [],
      error: null,
    };
    if (Number(file.size_bytes) > MAX_INSPECT_BYTES) return { ...base, error: 'too_large_to_inspect' };
    let parsed;
    try {
      parsed = await parseYieldPoints(await toBuffer(await this.storage.get(file.storage_key)));
    } catch (error) {
      if (error instanceof GridError) return { ...base, error: error.message };
      throw error;
    }
    const step = Math.max(1, Math.floor(parsed.points.length / MATCH_SAMPLE));
    const sample = parsed.points.filter((_, i) => i % step === 0);
    const year = parsed.timeRange ? new Date(parsed.timeRange[0]).getUTCFullYear() : null;
    const matches = await this.db.run(ctx, async (trx) => {
      let harvestYear = year;
      if (input.seasonId && !harvestYear) {
        const season = await trx.selectFrom('growing_seasons').select('harvest_year').where('id', '=', input.seasonId).executeTakeFirst();
        harvestYear = season?.harvest_year ?? null;
      }
      const { rows } = await sql<{ id: string; field_id: string; field_name: string; crop_name: string; area_ha: number; points: number }>`
        WITH pts AS (
          SELECT ST_SetSRID(ST_MakePoint(x, y), 4326) AS p FROM unnest(${sample.map((p) => p.lon)}::float8[], ${sample.map((p) => p.lat)}::float8[]) AS t(x, y)
        ), cycles AS (
          SELECT cc.id, cc.field_id, f.name AS field_name, coalesce(c.name_de, c.name) AS crop_name,
                 COALESCE(cc.area_ha, fp.area_ha, g.area_ha)::float8 AS area_ha, COALESCE(fp.geometry, g.geometry) AS geom
          FROM crop_cycles cc
          JOIN growing_seasons s ON s.id = cc.season_id
          JOIN fields f ON f.id = cc.field_id
          JOIN crops c ON c.id = cc.crop_id
          LEFT JOIN field_parts fp ON fp.id = cc.field_part_id
          LEFT JOIN field_current_geometry g ON g.field_id = cc.field_id
          WHERE cc.role = 'main' AND f.status = 'active'
            ${harvestYear ? sql`AND s.harvest_year = ${harvestYear}` : input.seasonId ? sql`AND s.id = ${input.seasonId}::uuid` : sql``}
        )
        SELECT cycles.id, cycles.field_id, cycles.field_name, cycles.crop_name, cycles.area_ha, count(*)::int AS points
        FROM cycles JOIN pts ON ST_Intersects(cycles.geom, pts.p)
        GROUP BY cycles.id, cycles.field_id, cycles.field_name, cycles.crop_name, cycles.area_ha
        ORDER BY points DESC
        LIMIT 50`.execute(trx);
      return rows;
    });
    const [from, to] = parsed.timeRange ?? [null, null];
    return {
      ...base,
      format: parsed.format,
      attribute: parsed.attribute,
      crs: parsed.crs ?? null,
      pointCount: parsed.points.length,
      meanRateTHa: parsed.quality.meanRate,
      plausible: parsed.quality.plausible,
      note: parsed.quality.note ?? null,
      harvestedFrom: from !== null ? new Date(from).toISOString() : null,
      harvestedTo: to !== null ? new Date(to).toISOString() : null,
      bbox: pointsBbox(parsed.points),
      matches: matches
        .map((m) => ({ cropCycleId: m.id, fieldId: m.field_id, fieldName: m.field_name, cropName: m.crop_name, areaHa: round(m.area_ha, 2), share: round(m.points / sample.length, 3), points: m.points }))
        .filter((m) => m.share >= MIN_MATCH_SHARE),
    };
  }

  /** Adds the export as a source of each crop cycle and queues their builds. */
  async register(ctx: Ctx, input: Out<typeof RegisterYieldMapInput>): Promise<YieldMapSource[]> {
    const ids = await this.db.run(ctx, async (trx) => {
      const file = await trx.selectFrom('files').select(['id', 'name', 'storage_key']).where('id', '=', input.fileId).where('deleted_at', 'is', null).executeTakeFirst();
      if (!file) throw notFound('File');
      const cycles = await trx.selectFrom('crop_cycles').select(['id', 'field_id']).where('id', 'in', input.cropCycleIds).execute();
      if (cycles.length !== new Set(input.cropCycleIds).size) throw notFound('Crop cycle');
      const harvested = input.harvestedOn ? new Date(`${input.harvestedOn}T12:00:00Z`) : null;
      const out: string[] = [];
      for (const cycle of cycles) {
        const row = await trx
          .insertInto('yield_map_sources')
          .values({
            organization_id: ctx.orgId,
            crop_cycle_id: cycle.id,
            field_id: cycle.field_id,
            file_id: file.id,
            storage_key: file.storage_key,
            file_name: file.name,
            provider: 'upload',
            machine_label: input.machineLabel ?? null,
            harvested_from: harvested,
            harvested_to: harvested,
            status: 'pending_parse',
            created_by: ctx.userId,
          })
          .onConflict((oc) => oc.columns(['crop_cycle_id', 'file_id']).where('file_id', 'is not', null).doNothing())
          .returning('id')
          .executeTakeFirst();
        const id = row?.id ?? (await trx.selectFrom('yield_map_sources').select('id').where('crop_cycle_id', '=', cycle.id).where('file_id', '=', file.id).executeTakeFirstOrThrow()).id;
        out.push(id);
        await this.queueBuild(trx, ctx, cycle.id);
        await record(trx, ctx, { entityType: 'yield_map_source', entityId: id, action: 'created', changes: { fileId: file.id, cropCycleId: cycle.id } });
      }
      return out;
    });
    return this.sources(ctx, { ids });
  }

  async sources(ctx: Ctx, q: { seasonId?: string; cropCycleId?: string; ids?: string[] }): Promise<YieldMapSource[]> {
    return this.db.run(ctx, (trx) => this.querySources(trx, q));
  }

  private async querySources(trx: Trx, q: { seasonId?: string; cropCycleId?: string; ids?: string[] }): Promise<YieldMapSource[]> {
    let query = trx
      .selectFrom('yield_map_sources as s')
      .innerJoin('crop_cycles as cc', 'cc.id', 's.crop_cycle_id')
      .innerJoin('fields as f', 'f.id', 's.field_id')
      .innerJoin('crops as c', 'c.id', 'cc.crop_id')
      .selectAll('s')
      .select(['f.name as field_name', sql<string>`coalesce(c.name_de, c.name)`.as('crop_name')])
      .where('s.kind', '=', 'yield')
      .orderBy('s.harvested_from', 'desc')
      .orderBy('s.created_at', 'desc');
    if (q.seasonId) query = query.where('cc.season_id', '=', q.seasonId);
    if (q.cropCycleId) query = query.where('s.crop_cycle_id', '=', q.cropCycleId);
    if (q.ids) query = q.ids.length ? query.where('s.id', 'in', q.ids) : query.where(sql<boolean>`false`);
    return (await query.execute()).map((r) => toSource(r as SourceRow));
  }

  async updateSource(ctx: Ctx, id: string, input: Out<typeof UpdateYieldMapSourceInput>): Promise<YieldMapSource> {
    return this.db.run(ctx, async (trx) => {
      const source = await trx.selectFrom('yield_map_sources').select(['id', 'crop_cycle_id', 'status']).where('id', '=', id).executeTakeFirst();
      if (!source) throw notFound('Yield map');
      const harvested = input.harvestedOn ? new Date(`${input.harvestedOn}T12:00:00Z`) : input.harvestedOn === null ? null : undefined;
      await trx
        .updateTable('yield_map_sources')
        .set({
          ...(input.includedInMerge !== undefined ? { included_in_merge: input.includedInMerge, excluded_reason: input.includedInMerge ? null : 'user' } : {}),
          ...(harvested !== undefined ? { harvested_from: harvested, harvested_to: harvested } : {}),
          ...(input.machineLabel !== undefined ? { machine_label: input.machineLabel } : {}),
          // An included source that failed before is tried again.
          ...(input.includedInMerge && source.status === 'failed' ? { status: 'pending_parse', attempts: 0, error: null } : {}),
        })
        .where('id', '=', id)
        .execute();
      await this.queueBuild(trx, ctx, source.crop_cycle_id);
      await record(trx, ctx, { entityType: 'yield_map_source', entityId: id, action: 'updated', changes: input as Record<string, unknown> });
      return (await this.querySources(trx, { ids: [id] }))[0];
    });
  }

  /** Removes a source; the stored file stays in the file browser. */
  async deleteSource(ctx: Ctx, id: string): Promise<void> {
    await this.db.run(ctx, async (trx) => {
      const source = await trx.selectFrom('yield_map_sources').select(['id', 'crop_cycle_id']).where('id', '=', id).executeTakeFirst();
      if (!source) throw notFound('Yield map');
      await trx.deleteFrom('yield_map_sources').where('id', '=', id).execute();
      await this.queueBuild(trx, ctx, source.crop_cycle_id);
      await record(trx, ctx, { entityType: 'yield_map_source', entityId: id, action: 'deleted' });
    });
  }

  /** Re-queues failed sources of a crop cycle and rebuilds its rasters. */
  async rebuild(ctx: Ctx, cropCycleId: string): Promise<void> {
    await this.db.run(ctx, async (trx) => {
      const cycle = await trx.selectFrom('crop_cycles').select('id').where('id', '=', cropCycleId).executeTakeFirst();
      if (!cycle) throw notFound('Crop cycle');
      await trx
        .updateTable('yield_map_sources')
        .set({ status: 'pending_parse', attempts: 0, error: null })
        .where('crop_cycle_id', '=', cropCycleId)
        .where('status', '=', 'failed')
        .execute();
      await this.queueBuild(trx, ctx, cropCycleId);
    });
  }

  private queueBuild(trx: Trx, ctx: Ctx, cropCycleId: string) {
    return enqueue(trx, { kind: YIELD_BUILD, organizationId: ctx.orgId, payload: { cropCycleId }, maxAttempts: 4 });
  }

  // -------------------------------------------------------------------------
  // Reading
  // -------------------------------------------------------------------------

  /** The crop cycle's yield view: sources, rasters, zone yields, documented yield, yield zonings. */
  async cropCycle(ctx: Ctx, cropCycleId: string): Promise<CropCycleYield> {
    return this.db.run(ctx, async (trx) => {
      const cycle = await loadCycleContext(trx, cropCycleId);
      if (!cycle) throw notFound('Crop cycle');
      const field = await trx.selectFrom('fields').select('name').where('id', '=', cycle.fieldId).executeTakeFirstOrThrow();
      const sources = await this.querySources(trx, { cropCycleId });
      const rows = await trx.selectFrom('yield_rasters').selectAll().where('crop_cycle_id', '=', cropCycleId).where('superseded_at', 'is', null).orderBy('event_from', 'desc').execute();
      const scales = await this.cropScales(trx, cycle);
      const rasters = rows.map((r) => toRaster(r, scales));
      const zoneYields = rows[0] ? await this.zoneYields(trx, cycle, rows[0]) : [];
      const harvests = await trx.selectFrom('harvests').select(['quantity_t', 'harvested_area_ha', 'yield_raster_id']).where('crop_cycle_id', '=', cropCycleId).execute();
      const quantityT = harvests.reduce((s, h) => s + Number(h.quantity_t), 0);
      const area = harvests.reduce<number | null>((max, h) => (max === null || Number(h.harvested_area_ha) > max ? Number(h.harvested_area_ha) : max), null);
      const { rows: sameCropRows } = await sql<{ mean: number | null }>`
        SELECT avg(r.mean_t_ha)::float8 AS mean
        FROM yield_rasters r
        JOIN crop_cycles cc ON cc.id = r.crop_cycle_id
        JOIN crop_cycles me ON me.id = ${cropCycleId}::uuid
        WHERE r.superseded_at IS NULL AND cc.crop_id = me.crop_id AND cc.season_id = me.season_id`.execute(trx);
      const sameCrop = sameCropRows[0];
      return {
        cropCycleId,
        fieldId: cycle.fieldId,
        fieldName: field.name,
        cropName: cycle.cropName,
        areaHa: round(cycle.areaHa, 4),
        harvestYear: cycle.harvestYear,
        sources,
        rasters,
        zoneYields,
        documented: {
          quantityT: round(quantityT, 3),
          areaHa: area,
          yieldTHa: quantityT > 0 && area ? round(quantityT / Math.min(area, cycle.areaHa || area), 2) : null,
          fromMap: harvests.some((h) => h.yield_raster_id),
        },
        zonings: await this.yieldZonings(trx, cropCycleId),
        cropSeasonMeanTHa: sameCrop?.mean != null ? round(sameCrop.mean, 2) : null,
      };
    });
  }

  /** Zone yields of the field's zonings, computed on the raster's grid (always current). */
  private async zoneYields(trx: Trx, cycle: CycleContext, raster: RasterRow): Promise<ZoneYieldSet[]> {
    const { rows } = await sql<{ zoning_id: string; source: string; zone_count: number; zone_no: number; area_ha: number; relative_productivity: number | null; geometry: string }>`
      SELECT z.id AS zoning_id, z.source, z.zone_count, zz.zone_no, zz.area_ha::float8 AS area_ha,
             zz.relative_productivity::float8 AS relative_productivity, ST_AsGeoJSON(zz.geometry) AS geometry
      FROM zonings z
      JOIN zoning_zones zz ON zz.zoning_id = z.id
      JOIN field_current_geometry g ON g.field_id = z.field_id AND g.id = z.geometry_version_id
      WHERE z.field_id = ${cycle.fieldId}::uuid AND (z.crop_cycle_id IS NULL OR z.crop_cycle_id = ${cycle.id}::uuid)
      ORDER BY z.source, z.zone_count, z.created_at DESC, zz.zone_no`.execute(trx);
    const grid = gridOf(raster);
    const data = decodeRaster(raster.data);
    const zonings = new Map<string, typeof rows>();
    for (const r of rows) zonings.set(r.zoning_id, [...(zonings.get(r.zoning_id) ?? []), r]);
    const clip = (v: number) => Math.min(RELATIVE_YIELD_BOUNDS[1], Math.max(RELATIVE_YIELD_BOUNDS[0], v));
    return [...zonings.values()].map((zones) => {
      const result = computeZoneYieldsFromRaster(
        data,
        grid,
        zones.map((z) => ({ id: String(z.zone_no), geometry: JSON.parse(z.geometry) as Geometry })),
      );
      return {
        zoningId: zones[0].zoning_id,
        source: zones[0].source as ZoneYieldSet['source'],
        zoneCount: zones[0].zone_count,
        fieldMeanTHa: result.fieldMeanTpHa > 0 ? round(result.fieldMeanTpHa, 2) : null,
        zones: zones.map((z, i) => ({
          zoneNo: z.zone_no,
          areaHa: round(z.area_ha, 2),
          meanTHa: result.zones[i].yieldInTpHa === null ? null : round(result.zones[i].yieldInTpHa!, 2),
          relativeYield: result.zones[i].relativeYield === null ? null : round(clip(result.zones[i].relativeYield!), 3),
          pixels: result.zones[i].pixels,
          relativeProductivity: z.relative_productivity,
        })),
      };
    });
  }

  private async yieldZonings(trx: Trx, cropCycleId: string): Promise<YieldZoning[]> {
    const { rows } = await sql<{ id: string; source: string; zone_count: number; params: Record<string, unknown> | null; created_at: Date; zone_no: number; area_ha: number; mean_yield_t_ha: number | null; relative_productivity: number | null; geometry: string }>`
      SELECT z.id, z.source, z.zone_count, z.params, z.created_at, zz.zone_no, zz.area_ha::float8 AS area_ha,
             zz.mean_yield_t_ha::float8 AS mean_yield_t_ha, zz.relative_productivity::float8 AS relative_productivity, ST_AsGeoJSON(zz.geometry, 7) AS geometry
      FROM zonings z JOIN zoning_zones zz ON zz.zoning_id = z.id
      WHERE z.crop_cycle_id = ${cropCycleId}::uuid AND z.source IN ('yield_map', 'yield_estimate')
      ORDER BY z.created_at DESC, zz.zone_no`.execute(trx);
    const out = new Map<string, YieldZoning>();
    for (const r of rows) {
      const zoning = out.get(r.id) ?? { id: r.id, source: r.source as YieldZoning['source'], zoneCount: r.zone_count, params: r.params, createdAt: r.created_at.toISOString(), zones: [] };
      zoning.zones.push({ zoneNo: r.zone_no, areaHa: round(r.area_ha, 2), meanYieldTHa: r.mean_yield_t_ha, relativeProductivity: r.relative_productivity, color: zoneRamp(r.zone_no, r.zone_count), geometry: r.geometry });
      out.set(r.id, zoning);
    }
    return [...out.values()];
  }

  /** Shared colour range of the crop in the season — from stored quantiles, no raster reads. */
  private async cropScales(trx: Trx, cycle: CycleContext): Promise<[number, number] | null> {
    const { rows } = await sql<{ lo: number | null; hi: number | null }>`
      SELECT percentile_disc(0.1) WITHIN GROUP (ORDER BY coalesce(r.q20_t_ha, r.min_t_ha)) AS lo,
             percentile_disc(0.9) WITHIN GROUP (ORDER BY coalesce(r.q80_t_ha, r.max_t_ha)) AS hi
      FROM yield_rasters r
      JOIN crop_cycles cc ON cc.id = r.crop_cycle_id
      JOIN crop_cycles me ON me.id = ${cycle.id}::uuid
      WHERE r.superseded_at IS NULL AND cc.crop_id = me.crop_id AND cc.season_id = me.season_id`.execute(trx);
    const r = rows[0];
    return r && r.lo != null && r.hi != null && r.hi > r.lo ? [r.lo, r.hi] : null;
  }

  /** XYZ tile of a raster; `scale=crop` uses the crop's shared range, else the map's own stretch. */
  async tile(ctx: Ctx, rasterId: string, z: number, x: number, y: number, range?: [number, number]): Promise<Buffer> {
    let cached = rasterCache.get(rasterId);
    if (!cached) {
      const row = await this.db.run(ctx, (trx) => trx.selectFrom('yield_rasters').selectAll().where('id', '=', rasterId).executeTakeFirst());
      if (!row) throw notFound('Yield raster');
      cached = { grid: gridOf(row), data: decodeRaster(row.data), range: ownRange(row) };
      if (rasterCache.size >= RASTER_CACHE_SIZE) rasterCache.delete(rasterCache.keys().next().value!);
      rasterCache.set(rasterId, cached);
    } else {
      // Tenant check on every request, even when the pixels are cached.
      const visible = await this.db.run(ctx, (trx) => trx.selectFrom('yield_rasters').select('id').where('id', '=', rasterId).executeTakeFirst());
      if (!visible) throw notFound('Yield raster');
    }
    return renderTile(cached.grid, cached.data, z, x, y, YIELD_RAMP, range ?? cached.range) ?? emptyTile();
  }

  /** Every main crop cycle of the season with its yield knowledge, coverage and colour scales. */
  async overview(ctx: Ctx, seasonId: string): Promise<YieldOverview> {
    return this.db.run(ctx, async (trx) => {
      const { rows } = await sql<{
        id: string;
        field_id: string;
        field_name: string;
        crop_name: string;
        crop_color: string | null;
        area_ha: number;
        total: number;
        ok: number;
        pending: number;
        failed: number;
        raster_id: string | null;
        mean_t_ha: number | null;
        total_t: number | null;
        field_coverage: number | null;
        p05: number | null;
        p95: number | null;
        q20: number | null;
        q80: number | null;
        min: number | null;
        max: number | null;
        quantity_t: number;
        harvest_area: number | null;
        from_map: boolean;
        has_estimate: boolean;
      }>`
        SELECT cc.id, cc.field_id, f.name AS field_name, coalesce(c.name_de, c.name) AS crop_name, c.color AS crop_color,
               COALESCE(cc.area_ha, fp.area_ha, g.area_ha)::float8 AS area_ha,
               (SELECT count(*)::int FROM yield_map_sources s WHERE s.crop_cycle_id = cc.id AND s.kind = 'yield') AS total,
               (SELECT count(*)::int FROM yield_map_sources s WHERE s.crop_cycle_id = cc.id AND s.kind = 'yield' AND s.status = 'ok') AS ok,
               (SELECT count(*)::int FROM yield_map_sources s WHERE s.crop_cycle_id = cc.id AND s.kind = 'yield' AND s.status IN ('pending_parse', 'pending_download')) AS pending,
               (SELECT count(*)::int FROM yield_map_sources s WHERE s.crop_cycle_id = cc.id AND s.kind = 'yield' AND s.status = 'failed') AS failed,
               r.id AS raster_id, r.mean_t_ha, r.total_t, r.field_coverage, r.p05_t_ha AS p05, r.p95_t_ha AS p95, r.q20_t_ha AS q20, r.q80_t_ha AS q80, r.min_t_ha AS min, r.max_t_ha AS max,
               COALESCE((SELECT sum(h.quantity_t)::float8 FROM harvests h WHERE h.crop_cycle_id = cc.id), 0) AS quantity_t,
               (SELECT max(h.harvested_area_ha)::float8 FROM harvests h WHERE h.crop_cycle_id = cc.id) AS harvest_area,
               EXISTS (SELECT 1 FROM harvests h WHERE h.crop_cycle_id = cc.id AND h.yield_raster_id IS NOT NULL) AS from_map,
               EXISTS (SELECT 1 FROM zonings z WHERE z.crop_cycle_id = cc.id AND z.source = 'yield_estimate') AS has_estimate
        FROM crop_cycles cc
        JOIN fields f ON f.id = cc.field_id
        JOIN crops c ON c.id = cc.crop_id
        LEFT JOIN field_parts fp ON fp.id = cc.field_part_id
        LEFT JOIN field_current_geometry g ON g.field_id = cc.field_id
        LEFT JOIN LATERAL (
          SELECT * FROM yield_rasters r WHERE r.crop_cycle_id = cc.id AND r.superseded_at IS NULL ORDER BY r.event_from DESC NULLS LAST LIMIT 1
        ) r ON true
        WHERE cc.season_id = ${seasonId}::uuid AND cc.role = 'main' AND f.status = 'active' AND c.category NOT IN ('cover')
        ORDER BY f.name`.execute(trx);

      const out: YieldOverviewRow[] = rows.map((r) => {
        const documented = r.quantity_t > 0 ? round(r.quantity_t / Math.min(r.harvest_area ?? r.area_ha, r.area_ha || Infinity), 2) : null;
        const hasMap = !!r.raster_id || r.ok + r.pending > 0;
        return {
          cropCycleId: r.id,
          fieldId: r.field_id,
          fieldName: r.field_name,
          cropName: r.crop_name,
          cropColor: r.crop_color,
          areaHa: round(r.area_ha, 2),
          sources: { total: r.total, ok: r.ok, pending: r.pending, failed: r.failed },
          raster: r.raster_id
            ? { id: r.raster_id, meanTHa: r.mean_t_ha, totalT: r.total_t, fieldCoverage: r.field_coverage, displayRange: rangeOf(r) }
            : null,
          documentedYieldTHa: documented,
          documentedFromMap: r.from_map,
          hasEstimate: r.has_estimate,
          bucket: hasMap ? 'map' : r.has_estimate ? 'estimate' : documented ? 'documented' : 'nothing',
        };
      });
      const sum = (b: YieldOverviewRow['bucket']) => round(out.filter((r) => r.bucket === b).reduce((s, r) => s + r.areaHa, 0), 1);
      const withYield = out.filter((r) => r.documentedYieldTHa);
      const yieldArea = withYield.reduce((s, r) => s + r.areaHa, 0);
      const scales = new Map<string, { lo: number[]; hi: number[]; ids: string[] }>();
      for (const r of rows) {
        if (!r.raster_id) continue;
        const entry = scales.get(r.crop_name) ?? { lo: [], hi: [], ids: [] };
        const lo = r.q20 ?? r.min;
        const hi = r.q80 ?? r.max;
        if (lo != null) entry.lo.push(lo);
        if (hi != null) entry.hi.push(hi);
        entry.ids.push(r.id);
        scales.set(r.crop_name, entry);
      }
      return {
        rows: out,
        coverage: {
          totalFields: out.length,
          withMap: out.filter((r) => r.bucket === 'map').length,
          withEstimate: out.filter((r) => r.bucket === 'estimate').length,
          withDocumentedOnly: out.filter((r) => r.bucket === 'documented').length,
          withNothing: out.filter((r) => r.bucket === 'nothing').length,
          haMap: sum('map'),
          haEstimate: sum('estimate'),
          haDocumentedOnly: sum('documented'),
          haNothing: sum('nothing'),
          avgYieldTHa: yieldArea > 0 ? round(withYield.reduce((s, r) => s + r.documentedYieldTHa! * r.areaHa, 0) / yieldArea, 2) : null,
        },
        scales: [...scales.entries()].map(([cropName, e]) => ({ cropName, range: [percentile(e.lo, 0.1), percentile(e.hi, 0.9)] as [number, number], cropCycleIds: e.ids })),
      };
    });
  }

  /** Yield per harvest year of a field: the map mean next to the documented yield. */
  async history(ctx: Ctx, fieldId: string): Promise<YieldHistoryEntry[]> {
    return this.db.run(ctx, async (trx) => {
      const { rows } = await sql<{ harvest_year: number; id: string; crop_name: string; map_mean: number | null; quantity_t: number | null; area: number | null; cycle_area: number | null }>`
        SELECT s.harvest_year, cc.id, coalesce(c.name_de, c.name) AS crop_name,
               (SELECT avg(r.mean_t_ha)::float8 FROM yield_rasters r WHERE r.crop_cycle_id = cc.id AND r.superseded_at IS NULL) AS map_mean,
               (SELECT sum(h.quantity_t)::float8 FROM harvests h WHERE h.crop_cycle_id = cc.id) AS quantity_t,
               (SELECT max(h.harvested_area_ha)::float8 FROM harvests h WHERE h.crop_cycle_id = cc.id) AS area,
               cc.area_ha::float8 AS cycle_area
        FROM crop_cycles cc
        JOIN growing_seasons s ON s.id = cc.season_id
        JOIN crops c ON c.id = cc.crop_id
        WHERE cc.field_id = ${fieldId}::uuid AND cc.role = 'main'
        ORDER BY s.harvest_year DESC`.execute(trx);
      return rows
        .map((r) => ({
          harvestYear: r.harvest_year,
          cropCycleId: r.id,
          cropName: r.crop_name,
          mapMeanTHa: r.map_mean != null ? round(r.map_mean, 2) : null,
          documentedYieldTHa: r.quantity_t && r.area ? round(r.quantity_t / Math.min(r.area, r.cycle_area ?? r.area), 2) : null,
        }))
        .filter((r) => r.mapMeanTHa != null || r.documentedYieldTHa != null);
    });
  }

  // -------------------------------------------------------------------------
  // Yield zones and the satellite estimate
  // -------------------------------------------------------------------------

  /**
   * Yield estimate where no monitor map exists (the soil-map principle): a clear NDVI
   * acquisition before the harvest distributes the documented mean yield. Display and zones
   * only; it is never stored as monitor data.
   */
  async estimate(ctx: Ctx, cropCycleId: string, input: Out<typeof YieldEstimateInput>): Promise<YieldEstimatePreview> {
    const { cycle, scenes } = await this.db.run(ctx, async (trx) => {
      const cycle = await loadCycleContext(trx, cropCycleId);
      if (!cycle) throw notFound('Crop cycle');
      const harvest = await trx.selectFrom('harvests').select(sql<string | null>`max(harvest_date)::text`.as('date')).where('crop_cycle_id', '=', cropCycleId).executeTakeFirst();
      const planned = await trx.selectFrom('crop_cycles').select('expected_harvest_date').where('id', '=', cropCycleId).executeTakeFirst();
      const harvestDate = harvest?.date ?? planned?.expected_harvest_date ?? `${cycle.harvestYear}-08-15`;
      const { rows } = await sql<{ id: string; date: string; valid: number }>`
        SELECT r.id, r.observed_on::text AS date, r.valid_pixel_pct::float8 AS valid
        FROM field_rasters r
        JOIN field_current_geometry g ON g.id = r.geometry_version_id
        WHERE r.field_id = ${cycle.fieldId}::uuid AND 'ndvi' = ANY(r.bands) AND r.valid_pixel_pct >= ${MIN_SCENE_VALID_PCT}
          AND r.observed_on <= LEAST(${harvestDate}::date, current_date)
          AND r.observed_on >= LEAST(${harvestDate}::date, current_date) - ${SCENE_LOOKBACK_DAYS}::int
        ORDER BY r.observed_on DESC`.execute(trx);
      return { cycle, scenes: rows.map((r) => ({ id: r.id, date: r.date, validPixelPct: round(r.valid, 1) })) };
    });
    if (!scenes.length) return { ok: false, reason: 'no_scene', scenes };
    const scene = (input.sceneId && scenes.find((s) => s.id === input.sceneId)) || bestScene(scenes);
    let ndvi;
    try {
      ndvi = await this.fieldRasterValues(ctx, scene.id, 'ndvi');
    } catch (error) {
      this.logger.warn(`NDVI values for ${scene.id} unavailable: ${(error as Error).message}`);
      return { ok: false, reason: 'no_scene', scenes };
    }
    const grid = fieldGrid([cycle.geometry]);
    let estimate: Float64Array;
    try {
      estimate = syntheticYieldEstimate(grid, cycle.geometry, ndvi, input.meanYieldTHa, { spread: input.spread });
    } catch (error) {
      if (error instanceof GridError) return { ok: false, reason: 'not_covered', scenes };
      throw error;
    }
    const zones = await this.zonesFor(ctx, cycle, grid, estimate, input.zoneCount);
    return { ok: true, sceneId: scene.id, sceneDate: scene.date, meanYieldTHa: input.meanYieldTHa, spread: input.spread, zones, scenes };
  }

  /** Classify a raster into zones and clip them to the boundary (PostGIS). */
  private async zonesFor(ctx: Ctx, cycle: CycleContext, grid: GridDefinition, raster: Float64Array, zoneCount: number) {
    const { zones } = classifyYieldRaster(grid, raster, zoneCount, { boundary: cycle.geometry });
    const k = zones.length;
    return this.db.run(ctx, async (trx) => {
      const out: { zoneNo: number; color: string; meanTHa: number; areaHa: number; geometry: string }[] = [];
      for (const [i, zone] of zones.entries()) {
        const { rows } = await sql<{ geometry: string | null; area_ha: number | null }>`
          WITH z AS (
            SELECT ST_Multi(ST_CollectionExtract(ST_Intersection(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(zone.geometry)}), 4326)),
                   ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(cycle.geometry)}), 4326))), 3)) AS g
          )
          SELECT ST_AsGeoJSON(g, 7) AS geometry, (ST_Area(g::geography) / 10000)::float8 AS area_ha FROM z WHERE NOT ST_IsEmpty(g)`.execute(trx);
        if (!rows[0]?.geometry) continue;
        out.push({ zoneNo: i + 1, color: zoneRamp(i + 1, k), meanTHa: zone.meanValue, areaHa: round(rows[0].area_ha ?? zone.areaHa, 2), geometry: rows[0].geometry });
      }
      return out;
    });
  }

  /** Values of an index layer of a field raster, from the satellite pipeline's raster service. */
  private async fieldRasterValues(ctx: Ctx, fieldRasterId: string, layer: string) {
    let res: globalThis.Response;
    try {
      res = await fetch(`${config.geoTilesUrl}/rasters/${fieldRasterId}/values?organization=${ctx.orgId}&layer=${layer}`, { signal: AbortSignal.timeout(20_000) });
    } catch {
      throw new DomainError(503, 'tiles_unavailable', 'The satellite raster service is not reachable');
    }
    if (!res.ok) throw new DomainError(res.status === 404 ? 404 : 502, 'raster_error', 'Raster not available');
    const body = (await res.json()) as { epsg: number; originX: number; originY: number; resolution: number; width: number; height: number; values: string };
    const bytes = Buffer.from(body.values, 'base64');
    const values = new Float64Array(body.width * body.height);
    for (let i = 0; i < values.length; i++) values[i] = bytes.readFloatLE(i * 4);
    return { epsg: body.epsg, originX: body.originX, originY: body.originY, resolution: body.resolution, width: body.width, height: body.height, values };
  }

  /** Saves yield zones of the crop cycle, from the merged map or the estimate. */
  async saveZoning(ctx: Ctx, cropCycleId: string, input: Out<typeof SaveYieldZoningInput>): Promise<YieldZoning> {
    const cycle = await this.db.run(ctx, (trx) => loadCycleContext(trx, cropCycleId));
    if (!cycle) throw notFound('Crop cycle');
    let zones: { zoneNo: number; meanTHa: number; areaHa: number; geometry: string }[];
    let params: Record<string, unknown>;
    let rasterId: string | null = null;
    if (input.source === 'yield_map') {
      const raster = await this.db.run(ctx, (trx) => trx.selectFrom('yield_rasters').selectAll().where('id', '=', input.rasterId).where('crop_cycle_id', '=', cropCycleId).executeTakeFirst());
      if (!raster) throw notFound('Yield raster');
      const count = input.zoneCount ?? zoneCountForSpread({ meanTHa: raster.mean_t_ha, q20THa: raster.q20_t_ha, q80THa: raster.q80_t_ha }, cycle.areaHa);
      try {
        zones = await this.zonesFor(ctx, cycle, gridOf(raster), decodeRaster(raster.data), count);
      } catch (error) {
        if (error instanceof GridError) throw new DomainError(422, 'no_zones', error.message);
        throw error;
      }
      params = { zoneCount: count, rasterId: raster.id };
      rasterId = raster.id;
    } else {
      const preview = await this.estimate(ctx, cropCycleId, input.estimate);
      if (!preview.ok) throw new DomainError(422, preview.reason, 'No yield estimate could be computed');
      zones = preview.zones;
      params = { sceneId: preview.sceneId, sceneDate: preview.sceneDate, meanYieldTHa: preview.meanYieldTHa, spread: preview.spread };
    }
    if (zones.length < 2) throw new DomainError(422, 'no_zones', 'The map does not support at least two zones');
    const fieldMean = zones.reduce((s, z) => s + z.meanTHa * z.areaHa, 0) / zones.reduce((s, z) => s + z.areaHa, 0);
    const id = await this.db.run(ctx, async (trx) => {
      const version = await trx.selectFrom('field_current_geometry').select('id').where('field_id', '=', cycle.fieldId).executeTakeFirstOrThrow();
      // One zoning per source and crop cycle: a new one replaces the previous.
      await trx.deleteFrom('zonings').where('crop_cycle_id', '=', cropCycleId).where('source', '=', input.source).execute();
      const row = await trx
        .insertInto('zonings')
        .values({ organization_id: ctx.orgId, field_id: cycle.fieldId, geometry_version_id: version.id!, source: input.source, zone_count: zones.length, crop_cycle_id: cropCycleId, yield_raster_id: rasterId, params: JSON.stringify(params) })
        .returning('id')
        .executeTakeFirstOrThrow();
      for (const z of zones) {
        await sql`
          INSERT INTO zoning_zones (organization_id, zoning_id, zone_no, geometry, area_ha, relative_productivity, mean_yield_t_ha)
          VALUES (${ctx.orgId}::uuid, ${row.id}::uuid, ${z.zoneNo}, ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(${z.geometry}), 4326)), ${z.areaHa},
                  ${fieldMean > 0 ? round((z.meanTHa / fieldMean) * 100, 2) : null}, ${round(z.meanTHa, 2)})`.execute(trx);
      }
      await record(trx, ctx, { entityType: 'zoning', entityId: row.id, action: 'created', changes: { source: input.source, cropCycleId } });
      return row.id;
    });
    return this.db.run(ctx, async (trx) => (await this.yieldZonings(trx, cropCycleId)).find((z) => z.id === id)!);
  }

  async deleteZoning(ctx: Ctx, cropCycleId: string, zoningId: string): Promise<void> {
    await this.db.run(ctx, async (trx) => {
      const res = await trx.deleteFrom('zonings').where('id', '=', zoningId).where('crop_cycle_id', '=', cropCycleId).where('source', 'in', ['yield_map', 'yield_estimate']).executeTakeFirst();
      if (!Number(res.numDeletedRows)) throw notFound('Zoning');
      await record(trx, ctx, { entityType: 'zoning', entityId: zoningId, action: 'deleted' });
    });
  }
}

// ---------------------------------------------------------------------------

const zoneRamp = (zoneNo: number, count: number) => {
  // YlGn as in the reference's yield zones, from the yield ramp's green end.
  const ramp = ['#d9f0a3', '#addd8e', '#78c679', '#41ab5d', '#238443', '#006837', '#004529'];
  if (count <= 1) return ramp[3];
  return ramp[Math.round(((zoneNo - 1) * (ramp.length - 1)) / (count - 1))];
};

function bestScene(scenes: YieldEstimateScene[]): YieldEstimateScene {
  // The latest acquisition with the clearest view among the near-cloudless ones.
  const clear = scenes.filter((s) => s.validPixelPct >= 95);
  return (clear.length ? clear : scenes).toSorted((a, b) => b.date.localeCompare(a.date))[0];
}

function percentile(values: number[], q: number): number {
  if (!values.length) return 0;
  const sorted = values.toSorted((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
}

export function gridOf(r: Pick<RasterRow, 'grid_epsg' | 'grid_origin_x' | 'grid_origin_y' | 'grid_resolution' | 'grid_width' | 'grid_height'>): GridDefinition {
  return { epsg: r.grid_epsg, originX: r.grid_origin_x, originY: r.grid_origin_y, resolution: r.grid_resolution, width: r.grid_width, height: r.grid_height };
}

const rangeOf = (r: { p05: number | null; p95: number | null; min: number | null; max: number | null }): [number, number] => {
  const lo = r.p05 ?? r.min ?? 0;
  const hi = r.p95 ?? r.max ?? lo + 1;
  return hi > lo ? [round(lo, 2), round(hi, 2)] : [round(lo - 0.5, 2), round(lo + 0.5, 2)];
};
const ownRange = (r: RasterRow) => rangeOf({ p05: r.p05_t_ha, p95: r.p95_t_ha, min: r.min_t_ha, max: r.max_t_ha });

function toRaster(r: RasterRow, cropScale: [number, number] | null): YieldRaster {
  const grid = gridOf(r);
  const corners = gridCornersLonLat(grid);
  const lons = corners.map((c) => c[0]);
  const lats = corners.map((c) => c[1]);
  const json = <T>(v: unknown, fallback: T): T => (v == null ? fallback : typeof v === 'string' ? (JSON.parse(v) as T) : (v as T));
  return {
    id: r.id,
    cropCycleId: r.crop_cycle_id,
    fieldId: r.field_id,
    harvestEventKey: r.harvest_event_key,
    eventFrom: r.event_from?.toISOString() ?? null,
    eventTo: r.event_to?.toISOString() ?? null,
    grid,
    bounds: [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)],
    unit: r.unit,
    attribute: r.attribute,
    format: r.format as YieldRaster['format'],
    basis: r.basis as YieldRaster['basis'],
    targetMoisture: r.target_moisture,
    stats: { mean: r.mean_t_ha, median: r.median_t_ha, stddev: r.stddev_t_ha, min: r.min_t_ha, max: r.max_t_ha, q20: r.q20_t_ha, q80: r.q80_t_ha, p05: r.p05_t_ha, p95: r.p95_t_ha },
    validPixels: r.valid_pixels,
    coveredPixels: r.covered_pixels,
    filledPixels: r.filled_pixels,
    areaHa: r.area_ha,
    harvestedHa: r.harvested_ha,
    totalT: r.total_t,
    fieldCoverage: r.field_coverage,
    totalCalibrationFactor: r.total_calibration_factor,
    histogram: json(r.histogram, []),
    contributions: json(r.contributions, []),
    cleaning: json(r.cleaning, []),
    quality: json(r.quality, null),
    displayRange: cropScale ?? ownRange(r),
    builtAt: (r.built_at as Date).toISOString(),
    writeback: { status: r.writeback_status as YieldRaster['writeback']['status'], reason: r.writeback_reason, harvestId: r.writeback_harvest_id },
  };
}

function toSource(r: SourceRow): YieldMapSource {
  const q = (r.quality ?? null) as { quality?: YieldMapSource['quality']; cleaning?: YieldMapSource['cleaning']; moisture?: YieldMapSource['moisture'] } | null;
  return {
    id: r.id,
    cropCycleId: r.crop_cycle_id,
    fieldId: r.field_id,
    fieldName: r.field_name,
    cropName: r.crop_name,
    fileId: r.file_id,
    fileName: r.file_name,
    provider: r.provider as YieldMapSource['provider'],
    machineLabel: r.machine_label,
    harvestedFrom: r.harvested_from?.toISOString() ?? null,
    harvestedTo: r.harvested_to?.toISOString() ?? null,
    format: r.format as YieldMapSource['format'],
    attribute: r.attribute,
    basis: r.basis as YieldMapSource['basis'],
    crs: r.crs,
    pointCount: r.point_count,
    totalFeatures: r.total_features,
    meanRateTHa: r.mean_rate_t_ha,
    pixelMeanTHa: r.pixel_mean_t_ha,
    coveredHa: r.covered_ha,
    includedInMerge: r.included_in_merge,
    excludedReason: r.excluded_reason as YieldMapSource['excludedReason'],
    status: r.status as YieldMapSource['status'],
    error: r.error,
    quality: q?.quality ?? null,
    cleaning: q?.cleaning ?? null,
    moisture: q?.moisture ?? null,
    createdAt: (r.created_at as Date).toISOString(),
  };
}
