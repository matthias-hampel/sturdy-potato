import { Injectable } from '@nestjs/common';
import type { FieldGeometry, FieldPart, FieldPartUsage, FieldSplitPreview, SplitFieldInput } from '@agmeo/contracts';
import type { MultiPolygon } from 'geojson';
import { sql } from 'kysely';
import type { Ctx } from '../../auth/context.js';
import { badRequest, notFound } from '../../core/errors.js';
import { record } from '../../core/events.js';
import { round } from '../../core/mappers.js';
import type { Out } from '../../core/validation.js';
import { Database, type Trx } from '../../db/database.js';
import { cropName } from '../crops/crop-name.js';
import { resolveSeason } from '../crops/seasons.js';

type Input = Out<typeof SplitFieldInput>;

const geom = (g: FieldGeometry) => sql<string>`ST_Multi(ST_Force2D(ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(g)}), 4326)))`;
const fromHex = (hex: string | null) => sql<string>`ST_GeomFromEWKB(decode(${hex}::text, 'hex'))`;

/** Polygon pieces of `g` of at least 1 m² as a MultiPolygon, or NULL: drops slivers left by clipping. */
const clean = (g: ReturnType<typeof sql>) => sql<string>`(
  SELECT ST_Multi(ST_Collect(d.geom)) FROM ST_Dump(ST_CollectionExtract(${g}, 3)) d
  WHERE ST_Area(d.geom::geography) >= 1)`;

interface ComputedPart {
  index: number;
  id?: string;
  name: string;
  usage: FieldPartUsage;
  notes: string | null;
  isRemainder: boolean;
  /** Hex EWKB of the clipped geometry. */
  wkb: string;
  areaHa: number;
  geometry: MultiPolygon;
}

export interface FieldPartQuery {
  /** Defaults to the current season. */
  seasonId?: string;
  fieldId?: string;
  farmId?: string;
}

/**
 * Part fields (Teilschläge). A field is divided per season; the parts are cut from the field's
 * current boundary, never overlap, and together cover it. Crops and operations can then be
 * recorded on a part instead of the whole field.
 */
@Injectable()
export class FieldPartsService {
  constructor(private readonly db: Database) {}

  list(ctx: Ctx, q: FieldPartQuery): Promise<FieldPart[]> {
    return this.db.run(ctx, async (trx) => {
      const season = await resolveSeason(trx, q.seasonId);
      return season ? this.query(trx, { ...q, seasonId: season.id }) : [];
    });
  }

  preview(ctx: Ctx, fieldId: string, input: Input): Promise<FieldSplitPreview> {
    return this.db.run(ctx, async (trx) => {
      const { field, parts } = await this.compute(trx, fieldId, input);
      return {
        fieldAreaHa: field.area_ha,
        parts: parts.map(({ index, name, usage, isRemainder, areaHa, geometry }) => ({ index, name, usage, isRemainder, areaHa, geometry })),
      };
    });
  }

  /** Replaces the parts of a field in a season; parts listed with their id keep their crops and operations. */
  split(ctx: Ctx, fieldId: string, input: Input): Promise<FieldPart[]> {
    return this.db.run(ctx, async (trx) => {
      const { field, parts: computed } = await this.compute(trx, fieldId, input);
      // A single part is the whole field: no division.
      const target = computed.length > 1 ? computed : [];

      const existing = await trx
        .selectFrom('field_parts')
        .select(['id', 'name', 'is_remainder', 'area_ha'])
        .where('field_id', '=', fieldId)
        .where('season_id', '=', input.seasonId)
        .forUpdate()
        .execute();
      const existingIds = new Set(existing.map((p) => p.id));
      for (const p of computed) if (p.id && !existingIds.has(p.id)) throw notFound('Part field');
      const kept = new Set(target.flatMap((p) => (p.id ? [p.id] : [])));
      const removed = existing.filter((p) => !kept.has(p.id));

      if (removed.length) {
        const used = await trx
          .selectFrom('operation_fields as of')
          .innerJoin('field_parts as fp', 'fp.id', 'of.field_part_id')
          .select('fp.name')
          .where('of.field_part_id', 'in', removed.map((p) => p.id))
          .executeTakeFirst();
        if (used) throw badRequest('field_part_in_use', `Operations are recorded on part "${used.name}"; it cannot be removed`);

        const cycles = await trx
          .selectFrom('crop_cycles')
          .select(['id', 'field_part_id'])
          .where('field_part_id', 'in', removed.map((p) => p.id))
          .execute();
        // Undividing hands the crop of the old main part back to the whole field.
        const main = target.length === 0 ? largest(existing, cycles) : null;
        const blocking = cycles.find((c) => c.field_part_id !== main);
        if (blocking) {
          const part = existing.find((p) => p.id === blocking.field_part_id)!;
          throw badRequest('field_part_in_use', `Part "${part.name}" has a crop; move or remove the crop before removing the part`);
        }
        if (main) await trx.updateTable('crop_cycles').set({ field_part_id: null }).where('field_part_id', '=', main).execute();
        await trx.deleteFrom('field_parts').where('id', 'in', removed.map((p) => p.id)).execute();
      }

      // The remainder flag is unique per field and season; clear it before reassigning.
      if (kept.size) await trx.updateTable('field_parts').set({ is_remainder: false }).where('id', 'in', [...kept]).execute();
      const ids: string[] = [];
      for (const [sortOrder, p] of target.entries()) {
        const values = {
          name: p.name,
          usage: p.usage,
          is_remainder: p.isRemainder,
          geometry: fromHex(p.wkb),
          area_ha: p.areaHa,
          geometry_version_id: field.id,
          sort_order: sortOrder,
          notes: p.notes,
        };
        if (p.id) {
          await trx.updateTable('field_parts').set(values).where('id', '=', p.id).execute();
          ids.push(p.id);
        } else {
          const row = await trx
            .insertInto('field_parts')
            .values({ ...values, organization_id: ctx.orgId, field_id: fieldId, season_id: input.seasonId })
            .returning('id')
            .executeTakeFirstOrThrow();
          ids.push(row.id);
        }
      }

      // First division: crops planned on the whole field move to the main part.
      if (existing.length === 0 && target.length) {
        const main = target.findIndex((p) => p.isRemainder);
        const pick = main >= 0 ? main : largestIndex(target);
        await trx
          .updateTable('crop_cycles')
          .set({ field_part_id: ids[pick] })
          .where('field_id', '=', fieldId)
          .where('season_id', '=', input.seasonId)
          .where('field_part_id', 'is', null)
          .execute();
      }

      await record(trx, ctx, {
        entityType: 'field',
        entityId: fieldId,
        action: 'parts_updated',
        changes: { seasonId: input.seasonId, parts: target.map((p) => ({ name: p.name, usage: p.usage, areaHa: p.areaHa })) },
        event: { type: 'field.parts_updated', payload: { fieldId, seasonId: input.seasonId, partIds: ids } },
      });
      return this.query(trx, { fieldId, seasonId: input.seasonId });
    });
  }

  /**
   * Clips the drawn parts to the field boundary in order (a part only takes what earlier parts
   * left) and gives the rest to the remainder part.
   */
  private async compute(trx: Trx, fieldId: string, input: Input) {
    const field = await trx
      .selectFrom('field_current_geometry')
      .select(['id', 'area_ha'])
      .where('field_id', '=', fieldId)
      .executeTakeFirst();
    if (!field) throw notFound('Field');
    const season = await trx.selectFrom('growing_seasons').select('id').where('id', '=', input.seasonId).executeTakeFirst();
    if (!season) throw notFound('Season');
    const boundary = sql`(SELECT geometry FROM field_geometry_versions WHERE id = ${field.id!})`;

    const parts: ComputedPart[] = [];
    if (input.parts.length === 0) return { field: { id: field.id!, area_ha: field.area_ha ?? 0 }, parts };
    let taken: string | null = null;
    for (const [index, p] of input.parts.entries()) {
      if (!p.geometry) continue;
      const { rows: check } = await sql<{ valid: boolean; reason: string }>`
        SELECT ST_IsValid(${geom(p.geometry)}) AS valid, ST_IsValidReason(${geom(p.geometry)}) AS reason`.execute(trx);
      if (!check[0].valid) throw badRequest('invalid_geometry', `Invalid shape of part "${p.name}": ${check[0].reason}`);

      const piece = clean(sql`ST_Difference(ST_Intersection(${geom(p.geometry)}, ${boundary}), coalesce(${fromHex(taken)}, 'SRID=4326;POLYGON EMPTY'::geometry))`);
      const res: { rows: { wkb: string | null; area_m2: number | null; geojson: MultiPolygon | null; taken: string }[] } = await sql<{
        wkb: string | null; area_m2: number | null; geojson: MultiPolygon | null; taken: string;
      }>`
        WITH p AS (SELECT ${piece} AS g)
        SELECT encode(ST_AsEWKB(p.g), 'hex') AS wkb,
               ST_Area(p.g::geography) AS area_m2,
               ST_AsGeoJSON(p.g, 7)::json AS geojson,
               encode(ST_AsEWKB(ST_Union(coalesce(${fromHex(taken)}, 'SRID=4326;POLYGON EMPTY'::geometry), coalesce(p.g, 'SRID=4326;POLYGON EMPTY'::geometry))), 'hex') AS taken
        FROM p`.execute(trx);
      const r = res.rows[0];
      if (!r.wkb || !r.area_m2) throw badRequest('field_part_empty', `Part "${p.name}" does not cover any area of the field that is not already taken`);
      taken = r.taken;
      parts.push({ index, id: p.id, name: p.name, usage: p.usage, notes: p.notes ?? null, isRemainder: false, wkb: r.wkb, areaHa: round(r.area_m2 / 10000, 4), geometry: r.geojson! });
    }

    const { rows } = await sql<{ wkb: string | null; area_m2: number | null; geojson: MultiPolygon | null }>`
      WITH r AS (SELECT ${clean(sql`ST_Difference(${boundary}, coalesce(${fromHex(taken)}, 'SRID=4326;POLYGON EMPTY'::geometry))`)} AS g)
      SELECT encode(ST_AsEWKB(r.g), 'hex') AS wkb, ST_Area(r.g::geography) AS area_m2, ST_AsGeoJSON(r.g, 7)::json AS geojson FROM r`.execute(trx);
    const rest = rows[0];
    const remainderIndex = input.parts.findIndex((p) => !p.geometry);
    if (rest.wkb && rest.area_m2) {
      if (remainderIndex < 0) {
        throw badRequest('field_not_covered', `The parts leave ${round(rest.area_m2 / 10000, 4)} ha of the field uncovered; add a part for the remaining area`);
      }
      const p = input.parts[remainderIndex];
      parts.push({ index: remainderIndex, id: p.id, name: p.name, usage: p.usage, notes: p.notes ?? null, isRemainder: true, wkb: rest.wkb, areaHa: round(rest.area_m2 / 10000, 4), geometry: rest.geojson! });
    }
    // Keep the order of the input.
    parts.sort((a, b) => a.index - b.index);
    return { field: { id: field.id!, area_ha: field.area_ha ?? 0 }, parts };
  }

  async query(trx: Trx, q: FieldPartQuery & { seasonId: string }): Promise<FieldPart[]> {
    let query = trx
      .selectFrom('field_parts as fp')
      .innerJoin('fields as f', 'f.id', 'fp.field_id')
      .leftJoin('field_current_geometry as g', 'g.field_id', 'fp.field_id')
      .select([
        'fp.id',
        'fp.field_id',
        'f.name as field_name',
        'fp.season_id',
        'fp.name',
        'fp.usage',
        'fp.is_remainder',
        'fp.area_ha',
        'fp.notes',
        sql<MultiPolygon>`ST_AsGeoJSON(fp.geometry, 7)::json`.as('geojson'),
        sql<boolean>`fp.geometry_version_id IS DISTINCT FROM g.id`.as('outdated'),
      ])
      .where('fp.season_id', '=', q.seasonId)
      .orderBy('f.name')
      .orderBy('fp.sort_order');
    if (q.fieldId) query = query.where('fp.field_id', '=', q.fieldId);
    if (q.farmId) query = query.where('f.farm_id', '=', q.farmId);
    const rows = await query.execute();
    const cycles = rows.length
      ? await trx
          .selectFrom('crop_cycles as cc')
          .innerJoin('crops as c', 'c.id', 'cc.crop_id')
          .select(['cc.id', 'cc.field_part_id', cropName('c').as('name'), 'c.color', 'cc.status'])
          .where('cc.field_part_id', 'in', rows.map((r) => r.id))
          .orderBy('cc.created_at')
          .execute()
      : [];
    return rows.map((r) => ({
      id: r.id,
      fieldId: r.field_id,
      fieldName: r.field_name,
      seasonId: r.season_id,
      name: r.name,
      usage: r.usage as FieldPartUsage,
      isRemainder: r.is_remainder,
      areaHa: r.area_ha,
      geometry: r.geojson,
      notes: r.notes,
      outdated: r.outdated,
      crops: cycles
        .filter((c) => c.field_part_id === r.id)
        .map((c) => ({ cropCycleId: c.id, cropName: c.name, color: c.color, status: c.status })),
    }));
  }
}

/** The part whose crop goes back to the whole field when the division is removed. */
function largest(parts: { id: string; is_remainder: boolean; area_ha: number }[], cycles: { field_part_id: string | null }[]) {
  const withCrop = parts.filter((p) => cycles.some((c) => c.field_part_id === p.id));
  if (withCrop.length === 0) return null;
  return (withCrop.find((p) => p.is_remainder) ?? withCrop.reduce((a, b) => (b.area_ha > a.area_ha ? b : a))).id;
}

function largestIndex(parts: { usage: FieldPartUsage; areaHa: number }[]) {
  let best = -1;
  for (const [i, p] of parts.entries()) {
    if (p.usage !== 'cropped') continue;
    if (best < 0 || p.areaHa > parts[best].areaHa) best = i;
  }
  return best >= 0 ? best : parts.reduce((b, p, i) => (p.areaHa > parts[b].areaHa ? i : b), 0);
}
