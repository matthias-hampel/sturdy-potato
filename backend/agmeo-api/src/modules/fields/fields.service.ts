import { Injectable } from '@nestjs/common';
import {
  can,
  type CreateFieldInput,
  type Field,
  type FieldGeometry,
  type FieldGeometryVersion,
  type FieldOverlap,
  type GeometryValidation,
  type ImportFieldsInput,
  type ImportFieldsResult,
  type Tenure,
  type UpdateFieldGeometryInput,
  type UpdateFieldInput,
} from '@agmeo/contracts';
import type { MultiPolygon } from 'geojson';
import { sql } from 'kysely';
import type { Ctx } from '../../auth/context.js';
import { badRequest, forbidden, notFound } from '../../core/errors.js';
import { diff, record } from '../../core/events.js';
import { iso, round } from '../../core/mappers.js';
import type { Out } from '../../core/validation.js';
import { Database, type Trx } from '../../db/database.js';
import { cropName } from '../crops/crop-name.js';
import { resolveSeason } from '../crops/seasons.js';

/** GeoJSON → 2D MultiPolygon in EPSG:4326. Never repairs geometry silently. */
const geom = (g: FieldGeometry) => sql<string>`ST_Multi(ST_Force2D(ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(g)}), 4326)))`;

// Shared boundaries between neighbouring fields are not overlaps; ignore slivers below 1 m².
const MIN_OVERLAP_M2 = 1;

export interface FieldQuery {
  ids?: string[];
  farmId?: string;
  seasonId?: string;
  includeArchived?: boolean;
}

@Injectable()
export class FieldsService {
  constructor(private readonly db: Database) {}

  list(ctx: Ctx, query: FieldQuery): Promise<Field[]> {
    return this.db.run(ctx, (trx) => this.query(trx, query));
  }

  get(ctx: Ctx, id: string): Promise<Field> {
    return this.db.run(ctx, (trx) => this.getIn(trx, id));
  }

  async getIn(trx: Trx, id: string): Promise<Field> {
    const [field] = await this.query(trx, { ids: [id], includeArchived: true });
    if (!field) throw notFound('Field');
    return field;
  }

  validate(ctx: Ctx, geometry: FieldGeometry, excludeFieldId?: string): Promise<GeometryValidation> {
    return this.db.run(ctx, (trx) => this.validateIn(trx, geometry, excludeFieldId));
  }

  private async validateIn(trx: Trx, geometry: FieldGeometry, excludeFieldId?: string): Promise<GeometryValidation> {
    const { rows } = await sql<{ valid: boolean; reason: string; area_ha: number | null }>`
      WITH g AS (SELECT ${geom(geometry)} AS geom)
      SELECT ST_IsValid(geom) AS valid,
             ST_IsValidReason(geom) AS reason,
             CASE WHEN ST_IsValid(geom) THEN ST_Area(geom::geography) / 10000 END AS area_ha
      FROM g`.execute(trx);
    const { valid, reason, area_ha } = rows[0];
    if (!valid) return { valid: false, reason, areaHa: null, overlaps: [] };
    if (!area_ha || area_ha <= 0) return { valid: false, reason: 'Boundary has no area', areaHa: null, overlaps: [] };
    return { valid: true, reason: null, areaHa: round(area_ha, 4), overlaps: await this.overlaps(trx, geometry, excludeFieldId) };
  }

  private async overlaps(trx: Trx, geometry: FieldGeometry, excludeFieldId?: string): Promise<FieldOverlap[]> {
    const { rows } = await sql<{ id: string; name: string; overlap_m2: number }>`
      WITH g AS (SELECT ${geom(geometry)} AS geom)
      SELECT f.id, f.name, ST_Area(ST_Intersection(cg.geometry, g.geom)::geography) AS overlap_m2
      FROM field_current_geometry cg
      JOIN fields f ON f.id = cg.field_id
      CROSS JOIN g
      WHERE f.status = 'active'
        AND ST_Intersects(cg.geometry, g.geom)
        AND f.id IS DISTINCT FROM ${excludeFieldId ?? null}::uuid`.execute(trx);
    return rows
      .filter((r) => r.overlap_m2 >= MIN_OVERLAP_M2)
      .map((r) => ({ fieldId: r.id, fieldName: r.name, overlapHa: round(r.overlap_m2 / 10000, 4) }));
  }

  create(ctx: Ctx, input: Out<typeof CreateFieldInput>): Promise<Field> {
    return this.db.run(ctx, async (trx) => {
      const id = await this.insert(trx, ctx, input, 'drawn');
      return this.getIn(trx, id);
    });
  }

  private async insert(
    trx: Trx,
    ctx: Ctx,
    input: Omit<Out<typeof CreateFieldInput>, 'tenure'> & { tenure?: Tenure },
    source: 'drawn' | 'import',
  ): Promise<string> {
    const check = await this.validateIn(trx, input.geometry);
    if (!check.valid) throw badRequest('invalid_geometry', `Invalid field boundary: ${check.reason}`);
    const farm = await trx.selectFrom('farms').select('id').where('id', '=', input.farmId).executeTakeFirst();
    if (!farm) throw notFound('Farm');

    const { id } = await trx
      .insertInto('fields')
      .values({
        organization_id: ctx.orgId,
        farm_id: input.farmId,
        name: input.name,
        identifier: input.identifier ?? null,
        tenure: input.tenure ?? 'owned',
        soil_type: input.soilType ?? null,
        notes: input.notes ?? null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const version = await this.insertVersion(trx, ctx, id, input.geometry, source);
    await record(trx, ctx, {
      entityType: 'field',
      entityId: id,
      action: 'created',
      changes: { name: input.name, areaHa: version.areaHa, source },
      event: {
        type: 'field.created',
        payload: { fieldId: id, farmId: input.farmId, geometryVersionId: version.id, areaHa: version.areaHa },
      },
    });
    return id;
  }

  private async insertVersion(
    trx: Trx,
    ctx: Ctx,
    fieldId: string,
    geometry: FieldGeometry,
    source: 'drawn' | 'import' | 'edit',
    validFrom?: Date,
    validTo: Date | null = null,
  ) {
    const row = await trx
      .insertInto('field_geometry_versions')
      .values({
        organization_id: ctx.orgId,
        field_id: fieldId,
        geometry: geom(geometry),
        area_ha: sql<number>`round((ST_Area(${geom(geometry)}::geography) / 10000)::numeric, 4)`,
        valid_from: validFrom ?? sql<Date>`now()`,
        valid_to: validTo,
        source,
        created_by: ctx.userId,
      })
      .returning(['id', 'area_ha'])
      .executeTakeFirstOrThrow();
    return { id: row.id, areaHa: row.area_ha };
  }

  update(ctx: Ctx, id: string, input: Out<typeof UpdateFieldInput>): Promise<Field> {
    return this.db.run(ctx, async (trx) => {
      const before = await trx.selectFrom('fields').selectAll().where('id', '=', id).executeTakeFirst();
      if (!before) throw notFound('Field');
      const values = {
        farm_id: input.farmId,
        name: input.name,
        identifier: input.identifier,
        tenure: input.tenure,
        soil_type: input.soilType,
        notes: input.notes,
        status: input.status,
      };
      await trx.updateTable('fields').set(values).where('id', '=', id).execute();
      await record(trx, ctx, {
        entityType: 'field',
        entityId: id,
        action: input.status && input.status !== before.status ? input.status === 'archived' ? 'archived' : 'restored' : 'updated',
        changes: diff(before, values),
        event: { type: 'field.updated', payload: { fieldId: id } },
      });
      return this.getIn(trx, id);
    });
  }

  /**
   * Replaces the boundary from `validFrom` (now by default); earlier versions stay as history. A
   * future date plans the change: the new version takes over until the next planned one, and a
   * change planned for the same date is replaced.
   */
  updateGeometry(ctx: Ctx, id: string, input: Out<typeof UpdateFieldGeometryInput>): Promise<Field> {
    return this.db.run(ctx, async (trx) => {
      // The current version followed by the planned ones.
      const versions = await trx
        .selectFrom('field_geometry_versions')
        .select(['id', 'valid_from', 'valid_to', 'area_ha'])
        .where('field_id', '=', id)
        .where((eb) => eb.or([eb('valid_to', 'is', null), eb('valid_to', '>', sql<Date>`now()`)]))
        .orderBy('valid_from')
        .forUpdate()
        .execute();
      const [current] = versions;
      if (!current) throw notFound('Field');
      const check = await this.validateIn(trx, input.geometry, id);
      if (!check.valid) throw badRequest('invalid_geometry', `Invalid field boundary: ${check.reason}`);

      const { rows } = await sql<{ now: Date }>`SELECT now() AS now`.execute(trx);
      const now = rows[0].now;
      const validFrom = input.validFrom ? new Date(input.validFrom) : now;
      if (validFrom <= current.valid_from) {
        throw badRequest('invalid_valid_from', 'The new boundary must take effect after the current one');
      }
      const same = versions.find((v) => v.valid_from.getTime() === validFrom.getTime());
      let validTo: Date | null;
      if (same) {
        await trx.deleteFrom('field_geometry_versions').where('id', '=', same.id).execute();
        validTo = same.valid_to;
      } else {
        const before = versions.filter((v) => v.valid_from < validFrom).at(-1)!;
        validTo = before.valid_to;
        await trx.updateTable('field_geometry_versions').set({ valid_to: validFrom }).where('id', '=', before.id).execute();
      }
      const version = await this.insertVersion(trx, ctx, id, input.geometry, 'edit', validFrom, validTo);
      const planned = validFrom > now;
      await record(trx, ctx, {
        entityType: 'field',
        entityId: id,
        action: planned ? 'geometry_planned' : 'geometry_updated',
        changes: { areaHa: { from: current.area_ha, to: version.areaHa }, validFrom: validFrom.toISOString() },
        event: {
          // A planned version is picked up by the imagery pipeline once it takes effect.
          type: planned ? 'field.geometry_planned' : 'field.geometry_updated',
          payload: { fieldId: id, geometryVersionId: version.id, previousVersionId: current.id, areaHa: version.areaHa, validFrom: validFrom.toISOString() },
        },
      });
      return this.getIn(trx, id);
    });
  }

  /** Cancels a boundary change that has not taken effect yet; the version before it continues. */
  cancelPlannedGeometry(ctx: Ctx, id: string, versionId: string): Promise<Field> {
    return this.db.run(ctx, async (trx) => {
      const planned = await trx
        .selectFrom('field_geometry_versions')
        .select(['id', 'valid_from', 'valid_to', 'area_ha'])
        .where('id', '=', versionId)
        .where('field_id', '=', id)
        .where('valid_from', '>', sql<Date>`now()`)
        .forUpdate()
        .executeTakeFirst();
      if (!planned) throw notFound('Planned boundary');
      await trx.deleteFrom('field_geometry_versions').where('id', '=', planned.id).execute();
      await trx
        .updateTable('field_geometry_versions')
        .set({ valid_to: planned.valid_to })
        .where('field_id', '=', id)
        .where('valid_to', '=', planned.valid_from)
        .execute();
      await record(trx, ctx, {
        entityType: 'field',
        entityId: id,
        action: 'geometry_plan_cancelled',
        changes: { areaHa: planned.area_ha, validFrom: iso(planned.valid_from) },
        event: { type: 'field.geometry_plan_cancelled', payload: { fieldId: id, geometryVersionId: planned.id } },
      });
      return this.getIn(trx, id);
    });
  }

  geometryHistory(ctx: Ctx, id: string): Promise<FieldGeometryVersion[]> {
    return this.db.run(ctx, async (trx) => {
      const rows = await trx
        .selectFrom('field_geometry_versions')
        .select([
          'id',
          'area_ha',
          'valid_from',
          'valid_to',
          'source',
          sql<FieldGeometryVersion['status']>`CASE WHEN valid_from > now() THEN 'planned' WHEN valid_to <= now() THEN 'past' ELSE 'current' END`.as('status'),
          sql<MultiPolygon>`ST_AsGeoJSON(geometry, 7)::json`.as('geojson'),
        ])
        .where('field_id', '=', id)
        .orderBy('valid_from', 'desc')
        .execute();
      return rows.map((r) => ({
        id: r.id,
        areaHa: r.area_ha,
        validFrom: iso(r.valid_from),
        validTo: iso(r.valid_to),
        status: r.status,
        source: r.source as FieldGeometryVersion['source'],
        geometry: r.geojson,
      }));
    });
  }

  /** Imports valid features and reports invalid ones; overlaps are warnings, not errors. */
  /**
   * Creates one field per valid feature. Features with a crop also get a planned main crop in
   * `seasonId`, keeping the source's land-use code where it differs from the crop's default.
   */
  import(ctx: Ctx, input: Out<typeof ImportFieldsInput>): Promise<ImportFieldsResult> {
    return this.db.run(ctx, async (trx) => {
      const cropIds = [...new Set(input.features.flatMap((f) => (f.cropId ? [f.cropId] : [])))];
      const defaultCodes = new Map<string, string | null>();
      if (cropIds.length) {
        if (!can(ctx.role, 'crop.write')) throw forbidden();
        if (!input.seasonId) throw badRequest('season_required', 'Choose a season for the imported crops');
        const season = await trx.selectFrom('growing_seasons').select('id').where('id', '=', input.seasonId).executeTakeFirst();
        if (!season) throw notFound('Season');
        const crops = await trx.selectFrom('crops').select(['id', 'land_use_code']).where('id', 'in', cropIds).execute();
        if (crops.length !== cropIds.length) throw notFound('Crop');
        for (const c of crops) defaultCodes.set(c.id, c.land_use_code);
      }
      const sourceCodes = [...new Set(input.features.flatMap((f) => (f.cropId && f.landUseCode ? [f.landUseCode] : [])))];
      const knownCodes = new Set(
        sourceCodes.length ? (await trx.selectFrom('land_use_codes').select('code').where('code', 'in', sourceCodes).execute()).map((r) => r.code) : [],
      );

      const result: ImportFieldsResult = { created: [], cropsAssigned: 0, errors: [], overlaps: [] };
      for (const [index, feature] of input.features.entries()) {
        const check = await this.validateIn(trx, feature.geometry);
        if (!check.valid) {
          result.errors.push({ index, name: feature.name, message: check.reason ?? 'Invalid geometry' });
          continue;
        }
        if (check.overlaps.length) result.overlaps.push({ name: feature.name, overlaps: check.overlaps });
        const id = await this.insert(trx, ctx, { ...feature, farmId: input.farmId }, 'import');
        result.created.push({ id, name: feature.name, areaHa: check.areaHa! });
        if (feature.cropId && input.seasonId) {
          // Codes outside the catalogue are dropped; the crop's default code applies then.
          const code = feature.landUseCode && knownCodes.has(feature.landUseCode) ? feature.landUseCode : null;
          const cycle = await trx
            .insertInto('crop_cycles')
            .values({
              organization_id: ctx.orgId,
              field_id: id,
              season_id: input.seasonId,
              crop_id: feature.cropId,
              status: 'planned',
              role: 'main',
              land_use_code: code && code !== defaultCodes.get(feature.cropId) ? code : null,
            })
            .returning('id')
            .executeTakeFirstOrThrow();
          await record(trx, ctx, {
            entityType: 'crop_cycle',
            entityId: cycle.id,
            action: 'created',
            changes: { fieldId: id, cropId: feature.cropId, seasonId: input.seasonId, source: 'import' },
            event: {
              type: 'crop_cycle.created',
              payload: { cropCycleId: cycle.id, fieldId: id, fieldPartId: null, cropId: feature.cropId, seasonId: input.seasonId },
            },
          });
          result.cropsAssigned += 1;
        }
      }
      return result;
    });
  }

  delete(ctx: Ctx, id: string): Promise<void> {
    return this.db.run(ctx, async (trx) => {
      const field = await this.getIn(trx, id);
      const used = await trx.selectFrom('operation_fields').select('id').where('field_id', '=', id).limit(1).executeTakeFirst();
      if (used) throw badRequest('field_in_use', 'This field has recorded operations; archive it instead');
      await trx.deleteFrom('fields').where('id', '=', id).execute();
      await record(trx, ctx, {
        entityType: 'field',
        entityId: id,
        action: 'deleted',
        changes: { name: field.name },
        event: { type: 'field.deleted', payload: { fieldId: id } },
      });
    });
  }

  async query(trx: Trx, q: FieldQuery): Promise<Field[]> {
    const season = await resolveSeason(trx, q.seasonId);
    let query = trx
      .selectFrom('fields as f')
      .innerJoin('farms as fa', 'fa.id', 'f.farm_id')
      .innerJoin('field_current_geometry as g', 'g.field_id', 'f.id')
      .leftJoinLateral(
        (eb) =>
          eb
            .selectFrom('crop_cycles as cc')
            .innerJoin('crops as c', 'c.id', 'cc.crop_id')
            .innerJoin('growing_seasons as s', 's.id', 'cc.season_id')
            .select(['cc.id as crop_cycle_id', cropName('c').as('crop_name'), 'c.color', 's.name as season_name', 'cc.status as cycle_status'])
            .leftJoin('field_parts as fp', 'fp.id', 'cc.field_part_id')
            .whereRef('cc.field_id', '=', 'f.id')
            .where('cc.season_id', '=', season?.id ?? null)
            .orderBy(sql`array_position(array['active','planned','harvested','closed'], cc.status)`)
            // On a divided field, the crop of the largest cropped part.
            .orderBy(sql`(fp.usage = 'cropped') desc nulls first, coalesce(cc.area_ha, fp.area_ha) desc nulls first`)
            .limit(1)
            .as('cur'),
        (join) => join.onTrue(),
      )
      .leftJoinLateral(
        (eb) =>
          eb
            .selectFrom('field_geometry_versions as pv')
            .select(['pv.id as planned_id', 'pv.valid_from as planned_from', 'pv.area_ha as planned_area_ha'])
            .whereRef('pv.field_id', '=', 'f.id')
            .where('pv.valid_from', '>', sql<Date>`now()`)
            .orderBy('pv.valid_from')
            .limit(1)
            .as('planned'),
        (join) => join.onTrue(),
      )
      .leftJoinLateral(
        (eb) =>
          eb
            .selectFrom('field_parts as fp')
            .select([
              sql<number>`count(*)::int`.as('part_count'),
              sql<number | null>`sum(fp.area_ha) FILTER (WHERE fp.usage = 'cropped')`.as('cropped_area_ha'),
            ])
            .whereRef('fp.field_id', '=', 'f.id')
            .where('fp.season_id', '=', season?.id ?? null)
            .as('parts'),
        (join) => join.onTrue(),
      )
      .select([
        'f.id',
        'f.farm_id',
        'fa.name as farm_name',
        'f.name',
        'f.identifier',
        'f.tenure',
        'f.soil_type',
        'f.soil_texture',
        'f.nitrate_sensitive_zone',
        'f.phosphate_sensitive_zone',
        'f.notes',
        'f.status',
        'f.created_at',
        'f.updated_at',
        'g.id as geometry_version_id',
        'g.area_ha',
        sql<MultiPolygon>`ST_AsGeoJSON(g.geometry, 7)::json`.as('geojson'),
        sql<number>`ST_Y(ST_PointOnSurface(g.geometry))`.as('lat'),
        sql<number>`ST_X(ST_PointOnSurface(g.geometry))`.as('lng'),
        'planned.planned_id',
        'planned.planned_from',
        'planned.planned_area_ha',
        'cur.crop_cycle_id',
        'cur.crop_name',
        'cur.color',
        'cur.season_name',
        'cur.cycle_status',
        'parts.part_count',
        'parts.cropped_area_ha',
      ])
      .orderBy('fa.name')
      .orderBy('f.name');
    if (q.ids) query = query.where('f.id', 'in', q.ids.length ? q.ids : ['00000000-0000-0000-0000-000000000000']);
    if (q.farmId) query = query.where('f.farm_id', '=', q.farmId);
    if (!q.includeArchived) query = query.where('f.status', '=', 'active');
    const rows = await query.execute();
    return rows.map((r) => ({
      id: r.id,
      farmId: r.farm_id,
      farmName: r.farm_name,
      name: r.name,
      identifier: r.identifier,
      tenure: r.tenure as Tenure,
      soilType: r.soil_type,
      soilTexture: r.soil_texture,
      nitrateSensitiveZone: r.nitrate_sensitive_zone,
      phosphateSensitiveZone: r.phosphate_sensitive_zone,
      notes: r.notes,
      status: r.status as Field['status'],
      areaHa: r.area_ha ?? 0,
      geometry: r.geojson,
      centroid: { lat: r.lat, lng: r.lng },
      geometryVersionId: r.geometry_version_id!,
      plannedGeometry: r.planned_id ? { id: r.planned_id, validFrom: iso(r.planned_from!), areaHa: r.planned_area_ha! } : null,
      currentCrop: r.crop_cycle_id
        ? { cropCycleId: r.crop_cycle_id, cropName: r.crop_name!, color: r.color!, seasonName: r.season_name!, status: r.cycle_status! }
        : null,
      partCount: r.part_count ?? 0,
      croppedAreaHa: r.part_count ? (r.cropped_area_ha ?? 0) : (r.area_ha ?? 0),
      createdAt: iso(r.created_at),
      updatedAt: iso(r.updated_at),
    }));
  }
}
