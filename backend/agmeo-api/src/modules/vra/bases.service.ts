import { Injectable } from '@nestjs/common';
import {
  BasePatch,
  isOwnBase,
  ManualBaseInput,
  plainTargets,
  SatelliteBaseInput,
  syntheticRelative,
  weightedTargets,
  type BaseSource,
  type BaseZone,
  type BaseZoning,
  type UploadBaseResult,
  type VraBases,
  type ZoningJob,
} from '@agmeo/contracts';
import type { MultiPolygon, Polygon } from 'geojson';
import { sql } from 'kysely';
import type { Ctx } from '../../auth/context.js';
import { badRequest, conflict, notFound } from '../../core/errors.js';
import { record } from '../../core/events.js';
import { iso, round } from '../../core/mappers.js';
import type { Out } from '../../core/validation.js';
import { Database, type Trx } from '../../db/database.js';
import { parseZoneFile, type ZoneFileError } from './bases/zone-file.js';

export interface FieldBoundary {
  id: string;
  name: string;
  geometry_version_id: string;
  area_ha: number;
  geometry: MultiPolygon;
  centroid: [number, number];
}

/** A zone to store: geometry (unclipped) and its relative yield (1 = mean) when known. */
export interface NewZone {
  geometry: Polygon | MultiPolygon | (Polygon | MultiPolygon)[];
  relative: number | null;
}

interface ZoningRow {
  id: string;
  field_id: string;
  source: BaseSource;
  name: string | null;
  zone_count: number;
  is_default: boolean;
  listed: boolean;
  current: boolean;
  crop_cycle_id: string | null;
  params: Record<string, unknown> | null;
  created_at: Date;
  map_count: number;
}

const UPLOAD_MESSAGES: Record<ZoneFileError, string> = {
  not_json: 'The file is not valid JSON',
  not_geojson: 'The file is not a GeoJSON FeatureCollection',
  empty: 'The file holds no zones',
  no_target: 'No rate column or nutrient target (target_n, target_p2o5, target_k2o, target_mgo) found',
  no_polygons: 'No usable zones with polygon geometry found',
  no_grid: 'No rate grid found in the ZIP (expected ISO-XML TASKDATA or a Shapefile)',
  too_many_rates: 'The map has too many distinct rates; upload a zoned map',
  unsupported_crs: 'Unsupported coordinate system',
  not_zip: 'The ZIP file cannot be read',
};

/**
 * Base zonations of application maps (reference: CultivationBaseZones and the base-zonation
 * actions): every zoning of a field a map can be made on, and the ones made for maps — copied
 * from the soil zonation, uploaded, classified from satellite scenes, edited with the brush
 * editor, or uniform.
 */
@Injectable()
export class VraBasesService {
  constructor(private readonly db: Database) {}

  list(ctx: Ctx, fieldId: string): Promise<VraBases> {
    return this.db.run(ctx, async (trx) => {
      const field = await this.field(trx, fieldId);
      const zonings = await this.zonings(trx, fieldId);
      const soil = await sql<{ id: string; zone_count: number | null; method: string; created_at: Date; copied: string | null }>`
        SELECT s.id, s.zone_count, s.method, s.created_at,
               (SELECT z.id FROM zonings z WHERE z.field_id = s.field_id AND z.source = 'soil' AND z.listed AND z.params->>'soilZonationId' = s.id::text
                ORDER BY z.created_at DESC LIMIT 1) AS copied
        FROM soil_zonations s
        WHERE s.field_id = ${fieldId}::uuid AND s.status = 'ready' AND s.superseded_at IS NULL`.execute(trx);
      const s = soil.rows[0];
      return {
        fieldId,
        fieldName: field.name,
        fieldAreaHa: field.area_ha,
        boundary: field.geometry,
        zonings,
        soilZonation: s ? { id: s.id, zoneCount: s.zone_count ?? 0, method: s.method, createdAt: iso(s.created_at), copiedZoningId: s.copied } : null,
        jobs: await this.jobs(trx, fieldId),
      };
    });
  }

  /** The zonings of a field offered as bases: listed ones; productivity of the latest analysis on the current boundary. */
  async zonings(trx: Trx, fieldId: string, ids?: string[]): Promise<BaseZoning[]> {
    const { rows } = await sql<ZoningRow>`
      SELECT z.id, z.field_id, z.source, z.name, z.zone_count, z.is_default, z.listed, (z.geometry_version_id = g.id) AS current,
             z.crop_cycle_id, z.params, z.created_at,
             (SELECT count(*) FROM vra_maps m WHERE m.zoning_id = z.id)::int AS map_count
      FROM zonings z
      JOIN field_current_geometry g ON g.field_id = z.field_id
      WHERE z.field_id = ${fieldId}::uuid
        ${
          ids
            ? sql`AND z.id = ANY(${ids}::uuid[])`
            : sql`AND z.listed AND (
          z.source NOT IN ('productivity', 'yield_map', 'yield_estimate')
          OR (z.source IN ('yield_map', 'yield_estimate') AND z.geometry_version_id = g.id)
          OR z.analysis_id = (SELECT a.id FROM productivity_analyses a WHERE a.geometry_version_id = g.id AND a.status = 'finished'
                              ORDER BY a.finished_at DESC NULLS LAST LIMIT 1))`
        }
      ORDER BY z.is_default DESC, CASE WHEN z.source = 'productivity' THEN 0 ELSE 1 END, z.created_at DESC, z.zone_count`.execute(trx);
    if (!rows.length) return [];
    const zones = await sql<{ zoning_id: string; zone_no: number; area_ha: number; relative_productivity: number | null; mean_yield_t_ha: number | null; geometry: string }>`
      SELECT zoning_id, zone_no, area_ha::float8 AS area_ha, relative_productivity::float8 AS relative_productivity, mean_yield_t_ha::float8 AS mean_yield_t_ha,
             ST_AsGeoJSON(geometry, 7) AS geometry
      FROM zoning_zones WHERE zoning_id = ANY(${rows.map((r) => r.id)}::uuid[])
      ORDER BY zoning_id, zone_no`.execute(trx);
    const byZoning = new Map<string, BaseZone[]>();
    for (const z of zones.rows) {
      const list = byZoning.get(z.zoning_id) ?? [];
      list.push({
        zoneNo: z.zone_no,
        areaHa: round(Number(z.area_ha), 4),
        sharePct: 0,
        relativeProductivity: z.relative_productivity == null ? null : Number(z.relative_productivity),
        meanYieldTHa: z.mean_yield_t_ha == null ? null : Number(z.mean_yield_t_ha),
        geometry: JSON.parse(z.geometry) as MultiPolygon,
      });
      byZoning.set(z.zoning_id, list);
    }
    return rows.map((r) => {
      const list = byZoning.get(r.id) ?? [];
      const total = list.reduce((s, z) => s + z.areaHa, 0);
      return {
        id: r.id,
        fieldId: r.field_id,
        source: r.source,
        name: r.name,
        zoneCount: r.zone_count,
        isDefault: r.is_default,
        listed: r.listed,
        current: r.current,
        cropCycleId: r.crop_cycle_id,
        params: r.params,
        createdAt: iso(r.created_at),
        mapCount: r.map_count,
        zones: list.map((z) => ({ ...z, sharePct: total ? round((100 * z.areaHa) / total, 1) : 0 })),
      };
    });
  }

  async jobs(trx: Trx, fieldId: string): Promise<ZoningJob[]> {
    const rows = await trx
      .selectFrom('zoning_jobs')
      .select(['id', 'field_id', 'index_type', 'scene_dates', 'zone_count', 'name', 'status', 'status_code', 'zoning_id', 'created_at', 'finished_at'])
      .where('field_id', '=', fieldId)
      .orderBy('created_at', 'desc')
      .limit(10)
      .execute();
    return rows.map((r) => ({
      id: r.id,
      fieldId: r.field_id,
      indexType: r.index_type as ZoningJob['indexType'],
      sceneDates: (r.scene_dates as unknown as (string | Date)[]).map((d) => (typeof d === 'string' ? d.slice(0, 10) : iso(d).slice(0, 10))),
      zoneCount: r.zone_count,
      name: r.name,
      status: r.status as ZoningJob['status'],
      statusCode: r.status_code,
      zoningId: r.zoning_id,
      createdAt: iso(r.created_at),
      finishedAt: iso(r.finished_at),
    }));
  }

  /**
   * Copies the field's active soil zonation (reference previewFromSoilZonation): zones verbatim,
   * relative yield spread 0.8–1.2 by humus (or the layer mean of a satellite zonation, else the
   * zone order). A zonation copied before is returned as it is.
   */
  createFromSoil(ctx: Ctx, fieldId: string, name: string | null | undefined): Promise<BaseZoning> {
    return this.db.run(ctx, async (trx) => {
      const id = await this.soilZoning(trx, ctx, fieldId, name ?? null);
      if (!id) throw badRequest('no_soil_zonation', 'The field has no soil zonation');
      return (await this.zonings(trx, fieldId, [id]))[0];
    });
  }

  /** The zoning copied from the active soil zonation (made when missing); null without one. */
  async soilZoning(trx: Trx, ctx: Ctx, fieldId: string, name: string | null): Promise<string | null> {
    const soil = await trx
      .selectFrom('soil_zonations')
      .select(['id', 'method'])
      .where('field_id', '=', fieldId)
      .where('status', '=', 'ready')
      .where('superseded_at', 'is', null)
      .executeTakeFirst();
    if (!soil) return null;
    const copied = await sql<{ id: string }>`
      SELECT id FROM zonings WHERE field_id = ${fieldId}::uuid AND source = 'soil' AND listed AND params->>'soilZonationId' = ${soil.id}
      ORDER BY created_at DESC LIMIT 1`.execute(trx);
    if (copied.rows[0]) return copied.rows[0].id;
    const zones = await sql<{ zone_no: number; geometry: string; humus: number | null; mean_value: number | null }>`
      SELECT zone_no, ST_AsGeoJSON(geometry, 9) AS geometry,
             coalesce(nullif(properties->>'humus', '')::float8, nullif(properties->>'soc', '')::float8 * 1.724) AS humus, mean_value
      FROM soil_zones WHERE zonation_id = ${soil.id}::uuid ORDER BY zone_no`.execute(trx);
    if (!zones.rows.length) return null;
    const byHumus = zones.rows.every((z) => z.humus != null);
    const relative = syntheticRelative(zones.rows.map((z) => ({ key: z.zone_no, metric: byHumus ? z.humus : z.mean_value, rank: z.zone_no })));
    const field = await this.field(trx, fieldId);
    return this.insertZoning(trx, ctx, field, {
      source: 'soil',
      name,
      params: { soilZonationId: soil.id, method: soil.method, metric: byHumus ? 'humus' : 'mean_value' },
      zones: zones.rows.map((z) => ({ geometry: JSON.parse(z.geometry) as MultiPolygon, relative: relative.get(z.zone_no) ?? 1 })),
    });
  }

  /** One zone over the whole field: a flat rate (reference saveUniformBaseZonation). */
  createUniform(ctx: Ctx, fieldId: string, name: string | null | undefined): Promise<BaseZoning> {
    return this.db.run(ctx, async (trx) => {
      const id = await this.uniformZoning(trx, ctx, fieldId, name ?? null);
      return (await this.zonings(trx, fieldId, [id]))[0];
    });
  }

  async uniformZoning(trx: Trx, ctx: Ctx, fieldId: string, name: string | null): Promise<string> {
    const field = await this.field(trx, fieldId);
    const existing = await trx
      .selectFrom('zonings')
      .select('id')
      .where('field_id', '=', fieldId)
      .where('source', '=', 'uniform')
      .where('listed', '=', true)
      .where('geometry_version_id', '=', field.geometry_version_id)
      .executeTakeFirst();
    if (existing) return existing.id;
    return this.insertZoning(trx, ctx, field, { source: 'uniform', name, params: {}, zones: [{ geometry: field.geometry, relative: 1 }] });
  }

  /** Queues a satellite zoning for the geospatial worker; every scene must have imagery of the index. */
  queueSatellite(ctx: Ctx, fieldId: string, input: Out<typeof SatelliteBaseInput>, batchId: string | null = null): Promise<ZoningJob> {
    return this.db.run(ctx, async (trx) => {
      const field = await this.field(trx, fieldId);
      const { rows } = await sql<{ day: string }>`
        SELECT DISTINCT observed_on::text AS day FROM field_rasters
        WHERE geometry_version_id = ${field.geometry_version_id}::uuid AND ${input.indexType} = ANY(bands) AND observed_on = ANY(${input.sceneDates}::date[])`.execute(trx);
      const have = new Set(rows.map((r) => r.day));
      const missing = input.sceneDates.filter((d) => !have.has(d));
      if (missing.length) throw badRequest('no_imagery', `No ${input.indexType} imagery of the field on ${missing.join(', ')}`, { missing });
      const { id } = await trx
        .insertInto('zoning_jobs')
        .values({
          organization_id: ctx.orgId,
          field_id: fieldId,
          index_type: input.indexType,
          scene_dates: input.sceneDates,
          zone_count: input.zoneCount,
          params: JSON.stringify({ method: input.method }),
          name: input.name ?? null,
          batch_id: batchId,
          created_by: ctx.userId,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await record(trx, ctx, { entityType: 'field', entityId: fieldId, action: 'vra_base_queued', changes: { jobId: id, index: input.indexType, scenes: input.sceneDates } });
      return (await this.jobs(trx, fieldId)).find((j) => j.id === id)!;
    });
  }

  /**
   * Zones from the brush editor: made valid, clipped to the field and to the zones before them,
   * so nothing overlaps. Replacing an own zoning keeps its name and default; a zoning maps are
   * made on cannot be replaced (their rates follow its zones).
   */
  saveManual(ctx: Ctx, fieldId: string, input: Out<typeof ManualBaseInput>): Promise<BaseZoning> {
    return this.db.run(ctx, async (trx) => {
      const field = await this.field(trx, fieldId);
      let keep: { name: string | null; is_default: boolean } | null = null;
      if (input.replaceId) {
        const old = await this.own(trx, fieldId, input.replaceId);
        if (old.map_count > 0) throw conflict('zoning_in_use', 'Application maps are made on this zoning; save the zones as a new zoning');
        keep = { name: old.name, is_default: old.is_default };
        await trx.deleteFrom('zonings').where('id', '=', input.replaceId).execute();
      }
      const id = await this.insertZoning(trx, ctx, field, {
        source: 'manual',
        name: input.name ?? keep?.name ?? null,
        params: { baseZoningId: input.baseZoningId ?? null },
        listed: input.listed,
        zones: input.zones.map((z) => ({ geometry: z.geometry, relative: z.relativeProductivity == null ? null : z.relativeProductivity / 100 })),
        keepRelative: true,
      });
      if (keep?.is_default) await trx.updateTable('zonings').set({ is_default: true }).where('id', '=', id).execute();
      return (await this.zonings(trx, fieldId, [id]))[0];
    });
  }

  /** A zone file (GeoJSON, Shapefile ZIP, ISO-XML grid) as a zoning; relative yield by the file's values. */
  upload(ctx: Ctx, fieldId: string, file: { name: string; data: Buffer }): Promise<UploadBaseResult> {
    return this.db.run(ctx, async (trx) => {
      const field = await this.field(trx, fieldId);
      const parsed = await parseZoneFile(file.name, file.data, field.centroid);
      if (!parsed.ok) throw badRequest(`upload_${parsed.code}`, parsed.message ?? UPLOAD_MESSAGES[parsed.code]);
      const clipped = await this.clip(trx, field, parsed.zones.map((z) => ({ geometry: z.geometries, relative: null })));
      if (!clipped.length) throw badRequest('upload_outside_field', 'No zone of the file lies inside the field');
      const targets = clipped.map((c) => ({ target: parsed.zones[c.ord].target, areaHa: c.ha }));
      const { relative, mean } = parsed.targetKey === 'rate' ? weightedTargets(targets) : plainTargets(targets);
      const label = file.name.replace(/\.((geo)?json|zip)$/i, '').slice(0, 100) || 'Upload';
      const id = await this.insertClipped(trx, ctx, field, {
        source: 'upload',
        name: label,
        params: { fileName: file.name, format: parsed.format, targetKey: parsed.targetKey, unit: parsed.unit, meanTarget: round(mean, 4), targets: targets.map((t) => t.target) },
        listed: true,
        zones: clipped.map((c, i) => ({ ...c, relative: relative[i] })),
      });
      await record(trx, ctx, { entityType: 'zoning', entityId: id, action: 'vra_base_uploaded', changes: { fieldId, file: file.name, zones: clipped.length } });
      return {
        zoning: (await this.zonings(trx, fieldId, [id]))[0],
        targetKey: parsed.targetKey,
        unit: parsed.unit,
        meanTarget: round(mean, 4),
        dropped: parsed.dropped,
      };
    });
  }

  update(ctx: Ctx, fieldId: string, zoningId: string, input: Out<typeof BasePatch>): Promise<BaseZoning> {
    return this.db.run(ctx, async (trx) => {
      const zoning = await trx.selectFrom('zonings').select(['id', 'source']).where('id', '=', zoningId).where('field_id', '=', fieldId).executeTakeFirst();
      if (!zoning) throw notFound('Zoning');
      if (input.isDefault) await trx.updateTable('zonings').set({ is_default: false }).where('field_id', '=', fieldId).where('is_default', '=', true).execute();
      const set: { name?: string | null; is_default?: boolean; listed?: boolean } = {};
      if (input.name !== undefined) set.name = input.name;
      if (input.isDefault !== undefined) set.is_default = input.isDefault;
      if (input.listed !== undefined) set.listed = input.listed;
      if (Object.keys(set).length) await trx.updateTable('zonings').set(set).where('id', '=', zoningId).execute();
      await record(trx, ctx, { entityType: 'zoning', entityId: zoningId, action: 'vra_base_updated', changes: { ...input } });
      return (await this.zonings(trx, fieldId, [zoningId]))[0];
    });
  }

  delete(ctx: Ctx, fieldId: string, zoningId: string): Promise<void> {
    return this.db.run(ctx, async (trx) => {
      const zoning = await this.own(trx, fieldId, zoningId);
      if (zoning.map_count > 0) throw conflict('zoning_in_use', 'Application maps are made on this zoning; delete them first');
      await trx.deleteFrom('zonings').where('id', '=', zoningId).execute();
      await record(trx, ctx, { entityType: 'zoning', entityId: zoningId, action: 'vra_base_deleted', changes: { fieldId, source: zoning.source } });
    });
  }

  deleteJob(ctx: Ctx, fieldId: string, jobId: string): Promise<void> {
    return this.db.run(ctx, async (trx) => {
      const gone = await trx.deleteFrom('zoning_jobs').where('id', '=', jobId).where('field_id', '=', fieldId).where('status', '!=', 'running').returning('id').executeTakeFirst();
      if (!gone) throw notFound('Zoning job');
    });
  }

  private async own(trx: Trx, fieldId: string, zoningId: string) {
    const { rows } = await sql<{ id: string; source: string; name: string | null; is_default: boolean; map_count: number }>`
      SELECT z.id, z.source, z.name, z.is_default, (SELECT count(*) FROM vra_maps m WHERE m.zoning_id = z.id)::int AS map_count
      FROM zonings z WHERE z.id = ${zoningId}::uuid AND z.field_id = ${fieldId}::uuid`.execute(trx);
    const row = rows[0];
    if (!row) throw notFound('Zoning');
    if (!isOwnBase(row.source)) throw badRequest('zoning_not_own', 'Productivity and yield zonings are managed where they are computed');
    return row;
  }

  async field(trx: Trx, fieldId: string): Promise<FieldBoundary> {
    const { rows } = await sql<{ id: string; name: string; geometry_version_id: string; area_ha: number; geometry: string; centroid: string }>`
      SELECT f.id, f.name, g.id AS geometry_version_id, g.area_ha::float8 AS area_ha, ST_AsGeoJSON(ST_Multi(g.geometry), 9) AS geometry,
             ST_AsGeoJSON(ST_PointOnSurface(g.geometry)) AS centroid
      FROM fields f JOIN field_current_geometry g ON g.field_id = f.id
      WHERE f.id = ${fieldId}::uuid`.execute(trx);
    const r = rows[0];
    if (!r) throw notFound('Field');
    return {
      id: r.id,
      name: r.name,
      geometry_version_id: r.geometry_version_id,
      area_ha: Number(r.area_ha),
      geometry: JSON.parse(r.geometry) as MultiPolygon,
      centroid: (JSON.parse(r.centroid) as { coordinates: [number, number] }).coordinates,
    };
  }

  /**
   * Zones clipped to the field, in order: each zone loses what the zones before it cover. Empty
   * zones and slivers under 1 m² are left out; `ord` is the input position.
   */
  private async clip(trx: Trx, field: FieldBoundary, zones: NewZone[]) {
    const payload = zones.map((z, ord) => ({ ord, geoms: Array.isArray(z.geometry) ? z.geometry : [z.geometry] }));
    const { rows } = await sql<{ ord: number; geometry: string; ha: number }>`
      WITH f AS (SELECT geometry AS g FROM field_current_geometry WHERE field_id = ${field.id}::uuid),
      parts AS (
        SELECT x.ord, ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(p.value::text), 4326)) AS g
        FROM jsonb_to_recordset(${JSON.stringify(payload)}::jsonb) AS x(ord int, geoms jsonb), jsonb_array_elements(x.geoms) p
      ),
      z AS (
        SELECT parts.ord, ST_CollectionExtract(ST_Intersection(ST_UnaryUnion(ST_Collect(parts.g)), f.g), 3) AS g
        FROM parts, f GROUP BY parts.ord, f.g
      ),
      d AS (
        SELECT z.ord,
               ST_CollectionExtract(ST_Difference(z.g, coalesce((SELECT ST_Union(z2.g) FROM z z2 WHERE z2.ord < z.ord), ST_SetSRID('GEOMETRYCOLLECTION EMPTY'::geometry, 4326))), 3) AS g
        FROM z
      )
      SELECT ord, ST_AsGeoJSON(ST_Multi(g), 9) AS geometry, ST_Area(g::geography) / 10000 AS ha FROM d
      WHERE NOT ST_IsEmpty(g) AND ST_Area(g::geography) >= 1
      ORDER BY ord`.execute(trx);
    return rows.map((r) => ({ ord: r.ord, geometry: r.geometry, ha: Number(r.ha), relative: zones[r.ord].relative }));
  }

  /**
   * Stores a zoning made for maps: zones clipped to the field. Relative yields are normalised to
   * an area-weighted mean of 100 % unless `keepRelative` (edited zones keep what was typed).
   */
  async insertZoning(
    trx: Trx,
    ctx: Ctx,
    field: FieldBoundary,
    z: { source: BaseSource; name: string | null; params: Record<string, unknown>; zones: NewZone[]; listed?: boolean; keepRelative?: boolean; cropCycleId?: string | null },
  ): Promise<string> {
    const clipped = await this.clip(trx, field, z.zones);
    if (!clipped.length) throw badRequest('no_zones', 'No zone lies inside the field');
    let relative = clipped.map((c) => c.relative);
    if (!z.keepRelative && relative.every((r) => r != null)) {
      const area = clipped.reduce((s, c) => s + c.ha, 0);
      const mean = area > 0 ? clipped.reduce((s, c, i) => s + relative[i]! * c.ha, 0) / area : 1;
      if (mean > 0) relative = relative.map((r) => r! / mean);
    }
    return this.insertClipped(trx, ctx, field, { ...z, listed: z.listed ?? true, zones: clipped.map((c, i) => ({ ...c, relative: relative[i] })) });
  }

  private async insertClipped(
    trx: Trx,
    ctx: Ctx,
    field: FieldBoundary,
    z: { source: BaseSource; name: string | null; params: Record<string, unknown>; listed: boolean; cropCycleId?: string | null; zones: { geometry: string; ha: number; relative: number | null }[] },
  ): Promise<string> {
    if (z.zones.length > 50) throw badRequest('too_many_zones', 'A zoning has at most 50 zones');
    const { id } = await trx
      .insertInto('zonings')
      .values({
        organization_id: ctx.orgId,
        field_id: field.id,
        geometry_version_id: field.geometry_version_id,
        source: z.source,
        zone_count: z.zones.length,
        name: z.name,
        params: JSON.stringify(z.params),
        listed: z.listed,
        crop_cycle_id: z.cropCycleId ?? null,
        created_by: ctx.userId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const payload = z.zones.map((zone, i) => ({ no: i + 1, geom: zone.geometry, ha: round(zone.ha, 4), rel: zone.relative == null ? null : round(zone.relative * 100, 2) }));
    await sql`
      INSERT INTO zoning_zones (organization_id, zoning_id, zone_no, geometry, area_ha, relative_productivity)
      SELECT ${ctx.orgId}::uuid, ${id}::uuid, no, ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(geom), 4326)), ha, rel
      FROM jsonb_to_recordset(${JSON.stringify(payload)}::jsonb) AS r(no int, geom text, ha numeric, rel numeric)`.execute(trx);
    await record(trx, ctx, { entityType: 'zoning', entityId: id, action: 'vra_base_created', changes: { fieldId: field.id, source: z.source, zones: z.zones.length } });
    return id;
  }
}
