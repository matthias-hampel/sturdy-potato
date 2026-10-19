import { Injectable } from '@nestjs/common';
import {
  type AssignProbeNumbersInput,
  type BatchResult,
  type BatchSamplingPlanInput,
  type BatchZonationInput,
  type FieldSoilZonation,
  type SamplingPlanInput,
  type SamplingPlanPreview,
  type SaveZonesInput,
  type SoilFieldRow,
  type SoilTexture,
  type SoilZonation,
  type SoilZone,
  soilZoneColor,
  type UpdateZoneInput,
} from '@agmeo/contracts';
import type { MultiPolygon, Point } from 'geojson';
import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import type { Ctx } from '../../auth/context.js';
import { badRequest, notFound } from '../../core/errors.js';
import { record } from '../../core/events.js';
import { iso, round } from '../../core/mappers.js';
import type { Out } from '../../core/validation.js';
import { Database, type Trx } from '../../db/database.js';
import { gridCells, type GridAxis, type LngLat, MIN_CELL_M2, planPoints, serpentine, SLIVER_FRACTION, sliverMerges, uniquePoints } from './plan-geometry.js';
import { ZONATION_COLUMNS, type ZonationRow, zonationOut, zoneOut, zonesOf } from './soil-rows.js';

interface FieldGeometry {
  id: string;
  name: string;
  soil_texture: string | null;
  area_ha: number;
  geometry_version_id: string;
  geometry: MultiPolygon;
}

interface PlannedZone {
  geometry: MultiPolygon;
  areaHa: number;
  samplePoint: LngLat;
}

const RELAX_ITERATIONS = 12;

/**
 * PostGIS functions carry high cost estimates that trigger JIT compilation (~100 ms per query)
 * for what are millisecond queries on a few fields.
 */
export const noJit = (trx: Trx) => sql`SET LOCAL jit = off`.execute(trx);

/**
 * The soil sampling planner: zonations per field (satellite runs queued for agmeo-geo, grid and
 * Voronoi plans computed here in PostGIS, productivity zones taken over, the zone editor's
 * result), the active one per field and its history.
 */
@Injectable()
export class SoilZonationService {
  constructor(private readonly db: Database) {}

  // ---------------------------------------------------------------------------
  // Reading
  // ---------------------------------------------------------------------------

  overview(ctx: Ctx): Promise<SoilFieldRow[]> {
    return this.db.run(ctx, async (trx) => {
      await noJit(trx);
      const { rows } = await sql<{
        id: string;
        name: string;
        farm_name: string;
        area_ha: number;
        zid: string | null;
        method: string | null;
        source: string | null;
        zone_count: number | null;
        created_at: Date | null;
        pstatus: string | null;
        pcode: string | null;
        probes: number;
        sampled: number;
        sampled_on: string | null;
        means: Record<string, number> | null;
      }>`
        SELECT f.id, f.name, fa.name AS farm_name, coalesce(g.area_ha, 0)::float8 AS area_ha,
               z.id AS zid, z.method, z.source, z.zone_count, z.created_at,
               p.status AS pstatus, p.status_code AS pcode,
               (SELECT count(*) FROM soil_zones s WHERE s.zonation_id = z.id AND s.probe_nr IS NOT NULL)::int AS probes,
               (SELECT count(*) FROM soil_zones s WHERE s.zonation_id = z.id AND s.property_dates <> '{}'::jsonb)::int AS sampled,
               (SELECT max(d.value) FROM soil_zones s, jsonb_each_text(s.property_dates) d WHERE s.zonation_id = z.id) AS sampled_on,
               (SELECT jsonb_object_agg(m.k, m.v) FROM (
                  SELECT e.key AS k, round((sum((e.value #>> '{}')::numeric * s.area_ha) / nullif(sum(s.area_ha), 0))::numeric, 3) AS v
                  FROM soil_zones s, jsonb_each(s.properties) e
                  WHERE s.zonation_id = z.id AND jsonb_typeof(e.value) = 'number'
                  GROUP BY e.key) m) AS means
        FROM fields f
        JOIN farms fa ON fa.id = f.farm_id
        LEFT JOIN field_current_geometry g ON g.field_id = f.id
        LEFT JOIN soil_zonations z ON z.field_id = f.id AND z.status = 'ready' AND z.superseded_at IS NULL
        LEFT JOIN LATERAL (
          SELECT q.status, q.status_code FROM soil_zonations q
          WHERE q.field_id = f.id AND (q.status IN ('queued', 'running') OR (q.status = 'failed' AND q.created_at > coalesce(z.created_at, '-infinity')))
          ORDER BY q.created_at DESC LIMIT 1) p ON true
        WHERE f.status = 'active'
        ORDER BY f.name`.execute(trx);
      return rows.map((r) => ({
        fieldId: r.id,
        fieldName: r.name,
        farmName: r.farm_name,
        areaHa: round(Number(r.area_ha), 4),
        zonation: r.zid
          ? { id: r.zid, method: r.method as SoilZonation['method'], source: r.source!, zoneCount: r.zone_count ?? 0, createdAt: iso(r.created_at!) }
          : null,
        pending: r.pstatus ? { status: r.pstatus as SoilZonation['status'], statusCode: r.pcode } : null,
        probes: r.probes,
        sampledZones: r.sampled,
        sampledOn: r.sampled_on,
        means: Object.fromEntries(Object.entries(r.means ?? {}).map(([k, v]) => [k, Number(v)])),
      }));
    });
  }

  fieldZonation(ctx: Ctx, fieldId: string): Promise<FieldSoilZonation> {
    return this.db.run(ctx, (trx) => this.queryField(trx, fieldId));
  }

  async queryField(trx: Trx, fieldId: string): Promise<FieldSoilZonation> {
    const field = await this.field(trx, fieldId);
    const { rows } = await sql<ZonationRow>`
      SELECT ${ZONATION_COLUMNS} FROM soil_zonations n
      WHERE n.field_id = ${fieldId}::uuid AND (n.superseded_at IS NULL OR n.status <> 'ready')
      ORDER BY n.created_at DESC LIMIT 20`.execute(trx);
    const active = rows.find((r) => r.status === 'ready' && !r.superseded_at) ?? null;
    const pending = rows.filter((r) => r.status === 'queued' || r.status === 'running' || (r.status === 'failed' && (!active || r.created_at > active.created_at)));
    const zones = active ? await zonesOf(trx, [active.id]) : [];
    return {
      field: { id: field.id, name: field.name, areaHa: field.area_ha, geometry: field.geometry },
      zonation: active ? { ...zonationOut(active), zones: zones.map((z) => zoneOut(z, field.soil_texture as SoilTexture | null)) } : null,
      pending: pending.slice(0, 1).map(zonationOut),
    };
  }

  /** Every zonation of the field, newest first, with its zones. */
  history(ctx: Ctx, fieldId: string): Promise<(SoilZonation & { zones: SoilZone[] })[]> {
    return this.db.run(ctx, async (trx) => {
      const field = await this.field(trx, fieldId);
      const { rows } = await sql<ZonationRow>`
        SELECT ${ZONATION_COLUMNS} FROM soil_zonations n
        WHERE n.field_id = ${fieldId}::uuid AND n.status = 'ready'
        ORDER BY n.created_at DESC`.execute(trx);
      const zones = await zonesOf(
        trx,
        rows.map((r) => r.id),
      );
      return rows.map((r) => ({
        ...zonationOut(r),
        zones: zones.filter((z) => z.zonation_id === r.id).map((z) => zoneOut(z, field.soil_texture as SoilTexture | null)),
      }));
    });
  }

  batchStatus(ctx: Ctx, batchId: string): Promise<SoilZonation[]> {
    return this.db.run(ctx, async (trx) => {
      const { rows } = await sql<ZonationRow>`
        SELECT ${ZONATION_COLUMNS} FROM soil_zonations n WHERE n.batch_id = ${batchId}::uuid ORDER BY n.created_at`.execute(trx);
      return rows.map(zonationOut);
    });
  }

  // ---------------------------------------------------------------------------
  // Satellite zonations (computed by agmeo-geo)
  // ---------------------------------------------------------------------------

  queueBatch(ctx: Ctx, input: Out<typeof BatchZonationInput>): Promise<BatchResult> {
    return this.db.run(ctx, async (trx) => {
      const batchId = randomUUID();
      const fields = await trx
        .selectFrom('fields as f')
        .leftJoin('field_current_geometry as g', 'g.field_id', 'f.id')
        .select(['f.id', 'f.status', 'g.id as gv'])
        .where('f.id', 'in', input.fieldIds)
        .execute();
      const results: BatchResult['results'] = [];
      for (const fieldId of input.fieldIds) {
        const field = fields.find((f) => f.id === fieldId);
        if (!field) {
          results.push({ fieldId, status: 'failed', reason: 'field-not-found' });
          continue;
        }
        if (!field.gv || field.status !== 'active') {
          results.push({ fieldId, status: 'skipped', reason: 'no-geometry' });
          continue;
        }
        const zoneCount = input.zoneCounts?.[fieldId] ?? input.zoneCount;
        const params = { zoneCount, minZoneHa: input.minZoneHa, coarseness: input.coarseness, cleanup: input.cleanup, sceneDate: input.sceneDate ?? null };
        // A newer request for the same field replaces one that has not started yet.
        await trx.deleteFrom('soil_zonations').where('field_id', '=', fieldId).where('status', '=', 'queued').execute();
        const row = await trx
          .insertInto('soil_zonations')
          .values({
            organization_id: ctx.orgId,
            field_id: fieldId,
            geometry_version_id: field.gv,
            method: input.method,
            source: input.source,
            params: JSON.stringify(params),
            status: 'queued',
            batch_id: batchId,
            created_by: ctx.userId,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        results.push({ fieldId, status: 'queued', zonationId: row.id });
      }
      await record(trx, ctx, { entityType: 'soil_zonation_batch', entityId: batchId, action: 'queued', changes: { method: input.method, source: input.source, fields: input.fieldIds.length } });
      return { batchId, results };
    });
  }

  // ---------------------------------------------------------------------------
  // Sampling plans: grid, Voronoi, productivity zones
  // ---------------------------------------------------------------------------

  previewPlan(ctx: Ctx, fieldId: string, input: Out<typeof SamplingPlanInput>): Promise<SamplingPlanPreview> {
    return this.db.run(ctx, async (trx) => this.plan(trx, await this.field(trx, fieldId), input));
  }

  createPlan(ctx: Ctx, fieldId: string, input: Out<typeof SamplingPlanInput>): Promise<FieldSoilZonation> {
    return this.db.run(ctx, async (trx) => {
      const field = await this.field(trx, fieldId);
      const plan = await this.plan(trx, field, input);
      if (plan.tooMany) throw badRequest('too_many_cells', 'The cell size is too small for this field');
      if (!plan.zones.length) throw badRequest('no_zones', 'The plan has no zones');
      await this.storeZonation(trx, ctx, field, input.mode === 'zones' ? 'zoning' : input.mode, input.mode === 'zones' ? 'zoning' : input.mode, this.planParams(input), plan.zones, null);
      return this.queryField(trx, fieldId);
    });
  }

  createPlans(ctx: Ctx, input: Out<typeof BatchSamplingPlanInput>): Promise<BatchResult> {
    return this.db.run(ctx, async (trx) => {
      const batchId = randomUUID();
      const results: BatchResult['results'] = [];
      for (const fieldId of input.fieldIds) {
        const field = await this.field(trx, fieldId).catch(() => null);
        if (!field) {
          results.push({ fieldId, status: 'skipped', reason: 'no-geometry' });
          continue;
        }
        const planInput: Out<typeof SamplingPlanInput> = { mode: input.mode, cellHa: input.cellHa, axis: null, points: null, zoningId: null };
        if (input.mode === 'zones') {
          planInput.zoningId = await this.latestZoning(trx, fieldId);
          if (!planInput.zoningId) {
            results.push({ fieldId, status: 'skipped', reason: 'no-zoning' });
            continue;
          }
        }
        const plan = await this.plan(trx, field, planInput);
        if (plan.tooMany || !plan.zones.length) {
          results.push({ fieldId, status: 'skipped', reason: plan.tooMany ? 'too-many-cells' : 'no-zones' });
          continue;
        }
        const mode = input.mode === 'zones' ? 'zoning' : input.mode;
        const id = await this.storeZonation(trx, ctx, field, mode, mode, this.planParams(planInput), plan.zones, batchId);
        results.push({ fieldId, status: 'created', zonationId: id, zoneCount: plan.zones.length });
      }
      return { batchId, results };
    });
  }

  private planParams(input: Out<typeof SamplingPlanInput>) {
    return input.mode === 'zones' ? { zoningId: input.zoningId } : { cellHa: input.cellHa, axis: input.axis ?? null, customPoints: !!input.points?.length };
  }

  private async latestZoning(trx: Trx, fieldId: string): Promise<string | null> {
    const { rows } = await sql<{ id: string }>`
      SELECT z.id FROM zonings z
      JOIN field_current_geometry g ON g.id = z.geometry_version_id
      WHERE z.field_id = ${fieldId}::uuid
      ORDER BY z.created_at DESC, z.zone_count = 5 DESC LIMIT 1`.execute(trx);
    return rows[0]?.id ?? null;
  }

  private async plan(trx: Trx, field: FieldGeometry, input: Out<typeof SamplingPlanInput>): Promise<SamplingPlanPreview> {
    await noJit(trx);
    if (input.mode === 'grid') return this.gridPlan(trx, field, input.cellHa, (input.axis as GridAxis | null) ?? null);
    if (input.mode === 'voronoi') return this.voronoiPlan(trx, field, input.cellHa, (input.axis as GridAxis | null) ?? null, (input.points as LngLat[] | null) ?? null);
    const zoningId = input.zoningId ?? (await this.latestZoning(trx, field.id));
    if (!zoningId) throw badRequest('no_zoning', 'The field has no productivity zones');
    const { rows } = await sql<{ geometry: MultiPolygon; m2: number; point: Point }>`
      SELECT ST_AsGeoJSON(ST_Multi(i), 7)::json AS geometry, ST_Area(i::geography) AS m2, ST_AsGeoJSON(ST_PointOnSurface(i), 7)::json AS point
      FROM (
        SELECT zz.zone_no, ST_CollectionExtract(ST_Intersection(zz.geometry, g.geometry), 3) AS i
        FROM zoning_zones zz JOIN zonings z ON z.id = zz.zoning_id, field_current_geometry g
        WHERE zz.zoning_id = ${zoningId}::uuid AND z.field_id = ${field.id}::uuid AND g.field_id = ${field.id}::uuid
      ) s
      WHERE NOT ST_IsEmpty(i)
      ORDER BY zone_no`.execute(trx);
    if (!rows.length) throw notFound('Zoning');
    return {
      zones: rows.map((r) => ({ geometry: r.geometry, areaHa: round(r.m2 / 10_000, 4), samplePoint: r.point.coordinates.slice(0, 2) as LngLat })),
      points: [],
      lines: [],
      tooMany: false,
    };
  }

  private async gridPlan(trx: Trx, field: FieldGeometry, cellHa: number, axis: GridAxis | null): Promise<SamplingPlanPreview> {
    const { cells, lines, tooMany } = gridCells(field.geometry, cellHa, axis);
    if (tooMany) return { zones: [], points: [], lines: [], tooMany: true };
    const payload = cells.map((c) => ({ key: `${c.column}:${c.row}`, cell: c.polygon }));
    const { rows: clipped } = await sql<{ key: string; geometry: MultiPolygon; m2: number }>`
      WITH f AS (SELECT geometry AS g FROM field_current_geometry WHERE field_id = ${field.id}::uuid),
      c AS (SELECT key, ST_SetSRID(ST_GeomFromGeoJSON(cell::text), 4326) AS cg FROM jsonb_to_recordset(${JSON.stringify(payload)}::jsonb) AS x(key text, cell jsonb))
      SELECT key, ST_AsGeoJSON(i)::json AS geometry, ST_Area(i::geography) AS m2
      FROM (SELECT key, ST_CollectionExtract(ST_Intersection(cg, f.g), 3) AS i FROM c, f WHERE ST_Intersects(cg, f.g)) s
      WHERE NOT ST_IsEmpty(i)`.execute(trx);
    const kept = clipped.filter((c) => c.m2 >= MIN_CELL_M2);
    const into = sliverMerges(new Map(kept.map((c) => [c.key, c.m2])), cellHa * 10_000 * SLIVER_FRACTION);
    const groups = kept.map((c) => ({ key: into.get(c.key) ?? c.key, geom: c.geometry }));
    const { rows } = await sql<{ key: string; geometry: MultiPolygon; m2: number; point: Point }>`
      SELECT key, ST_AsGeoJSON(ST_Multi(u), 7)::json AS geometry, ST_Area(u::geography) AS m2, ST_AsGeoJSON(ST_PointOnSurface(u), 7)::json AS point
      FROM (
        SELECT key, ST_CollectionExtract(ST_Union(ST_SetSRID(ST_GeomFromGeoJSON(geom::text), 4326)), 3) AS u
        FROM jsonb_to_recordset(${JSON.stringify(groups)}::jsonb) AS x(key text, geom jsonb)
        GROUP BY key
      ) s`.execute(trx);
    const ordered = serpentine(
      rows.map((r) => {
        const [column, row] = r.key.split(':').map(Number);
        return { along: column, row, r };
      }),
    );
    return {
      zones: ordered.map(({ r }) => ({ geometry: r.geometry, areaHa: round(r.m2 / 10_000, 4), samplePoint: r.point.coordinates.slice(0, 2) as LngLat })),
      points: [],
      lines,
      tooMany: false,
    };
  }

  /** Voronoi cells of the points, clipped to the field, in the points' order. */
  private async voronoiCells(trx: Trx, field: FieldGeometry, points: LngLat[]): Promise<{ ord: number; geometry: MultiPolygon; m2: number; center: Point }[]> {
    const unique = uniquePoints(points);
    if (unique.length === 0) return [];
    const payload = unique.map(([x, y], ord) => ({ ord, x, y }));
    const { rows } = await sql<{ ord: number; geometry: MultiPolygon; m2: number; center: Point }>`
      WITH f AS (SELECT geometry AS g FROM field_current_geometry WHERE field_id = ${field.id}::uuid),
      p AS (SELECT ord, ST_SetSRID(ST_MakePoint(x, y), 4326) AS pt FROM jsonb_to_recordset(${JSON.stringify(payload)}::jsonb) AS x(ord int, x float8, y float8)),
      v AS (
        SELECT (ST_Dump(ST_VoronoiPolygons(ST_Collect(p.pt), 0, ST_Expand(ST_Envelope(f.g), 0.01)))).geom AS cell
        FROM p, f WHERE (SELECT count(*) FROM p) > 1 GROUP BY f.g
        UNION ALL
        SELECT ST_Expand(ST_Envelope(f.g), 0.01) FROM f WHERE (SELECT count(*) FROM p) = 1
      ),
      m AS (SELECT p.ord, ST_CollectionExtract(ST_Intersection(v.cell, f.g), 3) AS g FROM v JOIN p ON ST_Intersects(v.cell, p.pt), f)
      SELECT DISTINCT ON (ord) ord, ST_AsGeoJSON(ST_Multi(g), 7)::json AS geometry, ST_Area(g::geography) AS m2,
             ST_AsGeoJSON(CASE WHEN ST_Contains(g, ST_Centroid(g)) THEN ST_Centroid(g) ELSE ST_PointOnSurface(g) END, 7)::json AS center
      FROM m WHERE NOT ST_IsEmpty(g)
      ORDER BY ord, ST_Area(g) DESC`.execute(trx);
    return rows.filter((r) => r.m2 >= MIN_CELL_M2);
  }

  private async voronoiPlan(trx: Trx, field: FieldGeometry, cellHa: number, axis: GridAxis | null, custom: LngLat[] | null): Promise<SamplingPlanPreview> {
    let points: LngLat[];
    if (custom?.length) {
      points = uniquePoints(custom);
    } else {
      points = planPoints(field.geometry, field.area_ha, cellHa, axis);
      if (points.length === 0) return { zones: [], points: [], lines: [], tooMany: !!field.area_ha };
      // Lloyd relaxation: generators move to their cell's centre of mass.
      for (let step = 0; step < RELAX_ITERATIONS; step++) {
        const cells = await this.voronoiCells(trx, field, points);
        if (cells.length !== points.length) break;
        points = cells.map((c) => c.center.coordinates.slice(0, 2) as LngLat);
      }
    }
    const cells = await this.voronoiCells(trx, field, points);
    const unique = uniquePoints(points);
    return {
      zones: cells.map((c) => ({ geometry: c.geometry, areaHa: round(c.m2 / 10_000, 4), samplePoint: unique[c.ord] })),
      points: unique,
      lines: [],
      tooMany: false,
    };
  }

  // ---------------------------------------------------------------------------
  // Storing and editing
  // ---------------------------------------------------------------------------

  /** Stores a finished zonation and makes it the field's active one. */
  private async storeZonation(
    trx: Trx,
    ctx: Ctx,
    field: FieldGeometry,
    method: string,
    source: string,
    params: Record<string, unknown>,
    zones: PlannedZone[],
    batchId: string | null,
  ): Promise<string> {
    await this.supersedeActive(trx, field.id);
    const { id } = await trx
      .insertInto('soil_zonations')
      .values({
        organization_id: ctx.orgId,
        field_id: field.id,
        geometry_version_id: field.geometry_version_id,
        method,
        source,
        params: JSON.stringify(params),
        zone_count: zones.length,
        status: 'ready',
        status_code: 'ok',
        batch_id: batchId,
        created_by: ctx.userId,
        finished_at: new Date(),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const payload = zones.map((z, i) => ({ no: i + 1, geom: z.geometry, x: z.samplePoint[0], y: z.samplePoint[1], color: soilZoneColor(i) }));
    await sql`
      INSERT INTO soil_zones (organization_id, zonation_id, zone_no, label, color, geometry, area_ha, sample_point)
      SELECT ${ctx.orgId}::uuid, ${id}::uuid, no, 'Zone ' || no, color, g, round((ST_Area(g::geography) / 10000)::numeric, 4), ST_SetSRID(ST_MakePoint(x, y), 4326)
      FROM (
        SELECT no, color, x, y, ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(geom::text), 4326)), 3)) AS g
        FROM jsonb_to_recordset(${JSON.stringify(payload)}::jsonb) AS r(no int, geom jsonb, x float8, y float8, color text)
      ) s`.execute(trx);
    await record(trx, ctx, { entityType: 'field', entityId: field.id, action: 'soil_zonation_created', changes: { zonationId: id, method, zones: zones.length } });
    return id;
  }

  private async supersedeActive(trx: Trx, fieldId: string) {
    await trx
      .updateTable('soil_zonations')
      .set({ superseded_at: new Date() })
      .where('field_id', '=', fieldId)
      .where('status', '=', 'ready')
      .where('superseded_at', 'is', null)
      .execute();
  }

  /**
   * Saves the zone editor's result on the active zonation: zones are made valid, clipped to the
   * field and to each other in order (no overlaps); kept ids keep probe number and values.
   */
  saveZones(ctx: Ctx, fieldId: string, input: Out<typeof SaveZonesInput>): Promise<FieldSoilZonation> {
    return this.db.run(ctx, async (trx) => {
      await noJit(trx);
      const field = await this.field(trx, fieldId);
      let zonation = await trx
        .selectFrom('soil_zonations')
        .select(['id', 'params'])
        .where('field_id', '=', fieldId)
        .where('status', '=', 'ready')
        .where('superseded_at', 'is', null)
        .executeTakeFirst();
      if (!zonation) {
        const id = await this.storeZonation(trx, ctx, field, 'manual', 'manual', {}, [], null);
        zonation = { id, params: {} };
      }
      const existing = await trx.selectFrom('soil_zones').select(['id', 'color']).where('zonation_id', '=', zonation.id).execute();
      const known = new Set(existing.map((z) => z.id));
      const payload = input.zones.map((z, i) => ({
        ord: i,
        id: z.id && known.has(z.id) ? z.id : null,
        label: z.label,
        color: z.color ?? existing.find((e) => e.id === z.id)?.color ?? soilZoneColor(i),
        geom: z.geometry,
      }));
      const { rows } = await sql<{ ord: number; id: string | null; label: string; color: string; geometry: string; ha: number }>`
        WITH f AS (SELECT geometry AS g FROM field_current_geometry WHERE field_id = ${fieldId}::uuid),
        z AS (
          SELECT ord, id, label, color,
                 ST_CollectionExtract(ST_Intersection(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(geom::text), 4326)), f.g), 3) AS g
          FROM jsonb_to_recordset(${JSON.stringify(payload)}::jsonb) AS x(ord int, id uuid, label text, color text, geom jsonb), f
        ),
        d AS (
          SELECT z.ord, z.id, z.label, z.color,
                 ST_CollectionExtract(ST_Difference(z.g, coalesce((SELECT ST_Union(z2.g) FROM z z2 WHERE z2.ord < z.ord), ST_SetSRID('GEOMETRYCOLLECTION EMPTY'::geometry, 4326))), 3) AS g
          FROM z
        )
        SELECT ord, id, label, color, ST_Multi(g)::text AS geometry, ST_Area(g::geography) / 10000 AS ha FROM d
        WHERE NOT ST_IsEmpty(g) AND ST_Area(g::geography) >= 1
        ORDER BY ord`.execute(trx);
      if (!rows.length) throw badRequest('no_zones', 'No zone lies inside the field');
      const kept = new Set(rows.map((r) => r.id).filter((x): x is string => !!x));
      const removed = existing.filter((e) => !kept.has(e.id)).map((e) => e.id);
      if (removed.length) await trx.deleteFrom('soil_zones').where('id', 'in', removed).execute();
      for (const [i, r] of rows.entries()) {
        const values = { zone_no: i + 1, label: r.label, color: r.color, area_ha: round(Number(r.ha), 4) };
        if (r.id) {
          await sql`
            UPDATE soil_zones SET zone_no = ${values.zone_no}, label = ${values.label}, color = ${values.color}, area_ha = ${values.area_ha},
              geometry = ${r.geometry}::geometry,
              sample_point = CASE WHEN sample_point IS NOT NULL AND ST_Intersects(sample_point, ${r.geometry}::geometry) THEN sample_point ELSE ST_PointOnSurface(${r.geometry}::geometry) END
            WHERE id = ${r.id}::uuid`.execute(trx);
        } else {
          await sql`
            INSERT INTO soil_zones (organization_id, zonation_id, zone_no, label, color, geometry, area_ha, sample_point)
            VALUES (${ctx.orgId}::uuid, ${zonation.id}::uuid, ${values.zone_no}, ${values.label}, ${values.color}, ${r.geometry}::geometry, ${values.area_ha}, ST_PointOnSurface(${r.geometry}::geometry))`.execute(
            trx,
          );
        }
      }
      await trx
        .updateTable('soil_zonations')
        .set({ zone_count: rows.length, params: JSON.stringify({ ...((zonation.params as object) ?? {}), edited: true }) })
        .where('id', '=', zonation.id)
        .execute();
      await record(trx, ctx, { entityType: 'field', entityId: fieldId, action: 'soil_zones_edited', changes: { zonationId: zonation.id, zones: rows.length, removed: removed.length } });
      return this.queryField(trx, fieldId);
    });
  }

  updateZone(ctx: Ctx, zoneId: string, input: Out<typeof UpdateZoneInput>): Promise<SoilZone> {
    return this.db.run(ctx, async (trx) => {
      const zone = await trx
        .selectFrom('soil_zones as z')
        .innerJoin('soil_zonations as n', 'n.id', 'z.zonation_id')
        .innerJoin('fields as f', 'f.id', 'n.field_id')
        .select(['z.id', 'z.properties', 'z.property_dates', 'n.field_id', 'f.soil_texture'])
        .where('z.id', '=', zoneId)
        .executeTakeFirst();
      if (!zone) throw notFound('Zone');
      const patch: Record<string, unknown> = {};
      if (input.label !== undefined) patch.label = input.label;
      if (input.probeNr !== undefined) patch.probe_nr = input.probeNr;
      if (input.values) {
        const properties = { ...((zone.properties as Record<string, unknown>) ?? {}) };
        const dates = { ...((zone.property_dates as Record<string, unknown>) ?? {}) };
        const day = input.sampledOn ?? new Date().toISOString().slice(0, 10);
        for (const [k, v] of Object.entries(input.values)) {
          if (v == null) {
            delete properties[k];
            delete dates[k];
          } else {
            properties[k] = v;
            dates[k] = day;
          }
        }
        patch.properties = JSON.stringify(properties);
        patch.property_dates = JSON.stringify(dates);
      }
      if (Object.keys(patch).length) await trx.updateTable('soil_zones').set(patch).where('id', '=', zoneId).execute();
      await record(trx, ctx, { entityType: 'field', entityId: zone.field_id, action: 'soil_zone_updated', changes: { zoneId, ...input } });
      const [row] = await sql<Parameters<typeof zoneOut>[0]>`
        SELECT z.id, z.zonation_id, z.zone_no, z.label, z.color, z.area_ha, z.probe_nr, z.mean_value,
          ST_AsGeoJSON(z.geometry, 7)::json AS geojson, ST_AsGeoJSON(z.sample_point, 7)::json AS point,
          z.properties, z.property_methods, z.property_dates, z.lab_extras
        FROM soil_zones z WHERE z.id = ${zoneId}::uuid`
        .execute(trx)
        .then((r) => r.rows);
      return zoneOut(row, zone.soil_texture as SoilTexture | null);
    });
  }

  /** Stamps probe numbers on the active zones of the fields (sample card order: field name, zone). */
  assignProbeNumbers(ctx: Ctx, input: Out<typeof AssignProbeNumbersInput>): Promise<{ zoneId: string; fieldId: string; probeNr: number }[]> {
    return this.db.run(ctx, (trx) => this.stampProbeNumbers(trx, ctx, input.fieldIds, input.start ?? null));
  }

  async stampProbeNumbers(trx: Trx, ctx: Ctx, fieldIds: string[], start: number | null) {
    const zones = await sql<{ id: string; field_id: string; probe_nr: number | null }>`
      SELECT z.id, n.field_id, z.probe_nr
      FROM soil_zones z JOIN soil_zonations n ON n.id = z.zonation_id JOIN fields f ON f.id = n.field_id
      WHERE n.field_id = ANY(${fieldIds}::uuid[]) AND n.status = 'ready' AND n.superseded_at IS NULL
      ORDER BY f.name, f.id, z.zone_no`
      .execute(trx)
      .then((r) => r.rows);
    let next: number;
    if (start != null) next = start - 1;
    else {
      const max = await sql<{ max: number | null }>`
        SELECT max(z.probe_nr) AS max FROM soil_zones z JOIN soil_zonations n ON n.id = z.zonation_id
        WHERE n.status = 'ready' AND n.superseded_at IS NULL`
        .execute(trx)
        .then((r) => r.rows[0]?.max ?? 0);
      next = Math.max(max ?? 0, ...zones.map((z) => z.probe_nr ?? 0));
    }
    const out: { zoneId: string; fieldId: string; probeNr: number }[] = [];
    for (const z of zones) {
      const probeNr = start != null ? ++next : (z.probe_nr ?? ++next);
      if (probeNr !== z.probe_nr) await trx.updateTable('soil_zones').set({ probe_nr: probeNr }).where('id', '=', z.id).execute();
      out.push({ zoneId: z.id, fieldId: z.field_id, probeNr });
    }
    if (out.length) await record(trx, ctx, { entityType: 'soil_zonation_batch', entityId: randomUUID(), action: 'probe_numbers_assigned', changes: { fields: fieldIds.length, zones: out.length, start } });
    return out;
  }

  /** Makes an earlier zonation the active one again. */
  restore(ctx: Ctx, fieldId: string, zonationId: string): Promise<FieldSoilZonation> {
    return this.db.run(ctx, async (trx) => {
      const target = await trx
        .selectFrom('soil_zonations')
        .select(['id', 'superseded_at'])
        .where('id', '=', zonationId)
        .where('field_id', '=', fieldId)
        .where('status', '=', 'ready')
        .executeTakeFirst();
      if (!target) throw notFound('Zonation');
      if (target.superseded_at) {
        await this.supersedeActive(trx, fieldId);
        await trx.updateTable('soil_zonations').set({ superseded_at: null }).where('id', '=', zonationId).execute();
        await record(trx, ctx, { entityType: 'field', entityId: fieldId, action: 'soil_zonation_restored', changes: { zonationId } });
      }
      return this.queryField(trx, fieldId);
    });
  }

  /** Retires the active zonation (it stays in the history). */
  remove(ctx: Ctx, fieldId: string): Promise<void> {
    return this.db.run(ctx, async (trx) => {
      await this.field(trx, fieldId);
      await this.supersedeActive(trx, fieldId);
      await trx.deleteFrom('soil_zonations').where('field_id', '=', fieldId).where('status', 'in', ['queued', 'failed']).execute();
      await record(trx, ctx, { entityType: 'field', entityId: fieldId, action: 'soil_zonation_removed', changes: {} });
    });
  }

  async field(trx: Trx, fieldId: string): Promise<FieldGeometry> {
    const { rows } = await sql<FieldGeometry>`
      SELECT f.id, f.name, f.soil_texture, g.area_ha::float8 AS area_ha, g.id AS geometry_version_id, ST_AsGeoJSON(g.geometry, 7)::json AS geometry
      FROM fields f JOIN field_current_geometry g ON g.field_id = f.id
      WHERE f.id = ${fieldId}::uuid`.execute(trx);
    if (!rows[0]) throw notFound('Field');
    return { ...rows[0], area_ha: Number(rows[0].area_ha) };
  }
}

