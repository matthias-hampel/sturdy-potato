import { Injectable } from '@nestjs/common';
import type {
  ArchiveFieldsInput,
  BulkFieldResult,
  Field,
  FieldGeometry,
  FieldIdsInput,
  MergeFieldsInput,
  MergePreview,
  RenumberFieldsInput,
  RestoreFieldGeometryInput,
} from '@agmeo/contracts';
import type { MultiPolygon } from 'geojson';
import { sql } from 'kysely';
import type { Ctx } from '../../auth/context.js';
import { badRequest, conflict, notFound } from '../../core/errors.js';
import { record } from '../../core/events.js';
import { round } from '../../core/mappers.js';
import type { Out } from '../../core/validation.js';
import { Database, type Trx } from '../../db/database.js';
import { dbNow, FieldsService } from './fields.service.js';

/** Gaps between merged fields up to this width are closed (as in the reference app). */
const MERGE_WELD_M = 2;

@Injectable()
export class FieldManagementService {
  constructor(
    private readonly db: Database,
    private readonly fields: FieldsService,
  ) {}

  /** Archives fields from a date on; their history, crops and records stay. */
  archive(ctx: Ctx, input: Out<typeof ArchiveFieldsInput>): Promise<BulkFieldResult> {
    const from = input.archivedFrom ?? new Date().toLocaleDateString('sv-SE');
    return this.db.run(ctx, async (trx) => {
      const rows = await trx
        .updateTable('fields')
        .set({ status: 'archived', archived_from: from })
        .where('id', 'in', input.fieldIds)
        .where('status', '=', 'active')
        .returning('id')
        .execute();
      for (const r of rows) {
        await record(trx, ctx, { entityType: 'field', entityId: r.id, action: 'archived', changes: { archivedFrom: from }, event: { type: 'field.updated', payload: { fieldId: r.id } } });
      }
      return { done: rows.map((r) => r.id), failed: [] };
    });
  }

  restore(ctx: Ctx, input: Out<typeof FieldIdsInput>): Promise<BulkFieldResult> {
    return this.db.run(ctx, async (trx) => {
      const rows = await trx
        .updateTable('fields')
        .set({ status: 'active', archived_from: null, merged_into_id: null })
        .where('id', 'in', input.fieldIds)
        .where('status', '=', 'archived')
        .returning('id')
        .execute();
      for (const r of rows) {
        await record(trx, ctx, { entityType: 'field', entityId: r.id, action: 'restored', event: { type: 'field.updated', payload: { fieldId: r.id } } });
      }
      return { done: rows.map((r) => r.id), failed: [] };
    });
  }

  /** Deletes fields that have no records; fields with operations are reported and kept (archive them instead). */
  deleteMany(ctx: Ctx, input: Out<typeof FieldIdsInput>): Promise<BulkFieldResult> {
    return this.db.run(ctx, async (trx) => {
      const fields = await trx.selectFrom('fields').select(['id', 'name']).where('id', 'in', input.fieldIds).execute();
      const used = new Set(
        (await trx.selectFrom('operation_fields').select('field_id').distinct().where('field_id', 'in', input.fieldIds).execute()).map((r) => r.field_id),
      );
      const result: BulkFieldResult = { done: [], failed: [] };
      for (const f of fields) {
        if (used.has(f.id)) {
          result.failed.push({ fieldId: f.id, fieldName: f.name, code: 'field_in_use', message: 'This field has recorded operations; archive it instead' });
          continue;
        }
        await trx.deleteFrom('fields').where('id', '=', f.id).execute();
        await record(trx, ctx, { entityType: 'field', entityId: f.id, action: 'deleted', changes: { name: f.name }, event: { type: 'field.deleted', payload: { fieldId: f.id } } });
        result.done.push(f.id);
      }
      return result;
    });
  }

  /** Sets the field numbers to start, start+1, … in the given order. */
  renumber(ctx: Ctx, input: Out<typeof RenumberFieldsInput>): Promise<void> {
    return this.db.run(ctx, async (trx) => {
      for (const [i, id] of input.fieldIds.entries()) {
        await trx.updateTable('fields').set({ parcel_number: String(input.start + i) }).where('id', '=', id).execute();
      }
      await record(trx, ctx, { entityType: 'field', entityId: input.fieldIds[0], action: 'renumbered', changes: { count: input.fieldIds.length, start: input.start } });
    });
  }

  mergePreview(ctx: Ctx, input: Out<typeof MergeFieldsInput>): Promise<MergePreview> {
    return this.db.run(ctx, (trx) => this.planMerge(trx, input));
  }

  /**
   * Merges two fields: the survivor gets the union of both boundaries from `validFrom`
   * (gaps up to 2 m closed), the other field is archived and points at the survivor. The
   * other field's crops in seasons starting after the merge are removed; records before the
   * merge stay on it. Refused while the other field has work dated after the merge, or the
   * survivor is divided into parts in a season the merge falls in.
   */
  merge(ctx: Ctx, input: Out<typeof MergeFieldsInput>): Promise<Field> {
    return this.db.run(ctx, async (trx) => {
      const plan = await this.planMerge(trx, input);
      if (plan.blockers.length) throw conflict('merge_blocked', 'The fields cannot be merged yet', { blockers: plan.blockers });
      const validFrom = plan.validFrom;
      const current = await trx
        .selectFrom('field_geometry_versions')
        .select(['id', 'area_ha'])
        .where('field_id', '=', input.survivorId)
        .where('valid_to', 'is', null)
        .executeTakeFirstOrThrow();
      await trx.updateTable('field_geometry_versions').set({ valid_to: validFrom }).where('id', '=', current.id).execute();
      const version = await trx
        .insertInto('field_geometry_versions')
        .values({
          organization_id: ctx.orgId,
          field_id: input.survivorId,
          geometry: sql<string>`ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(plan.geometry)}), 4326)`,
          area_ha: plan.areaHa,
          valid_from: validFrom,
          source: 'merge',
          reason: input.reason ?? null,
          created_by: ctx.userId,
        })
        .returning('id')
        .executeTakeFirstOrThrow();

      // Crops of the merged-away field in seasons that start after the merge.
      await trx
        .deleteFrom('crop_cycles')
        .where('field_id', '=', input.otherId)
        .where('season_id', 'in', (eb) => eb.selectFrom('growing_seasons').select('id').where('start_date', '>=', validFrom.toLocaleDateString('sv-SE')))
        .execute();
      await trx
        .updateTable('fields')
        .set({ status: 'archived', archived_from: validFrom.toLocaleDateString('sv-SE'), merged_into_id: input.survivorId })
        .where('id', '=', input.otherId)
        .execute();
      // Group memberships carry over to the survivor.
      await sql`INSERT INTO field_group_members (organization_id, group_id, field_id)
                SELECT organization_id, group_id, ${input.survivorId}::uuid FROM field_group_members WHERE field_id = ${input.otherId}::uuid
                ON CONFLICT DO NOTHING`.execute(trx);

      await record(trx, ctx, {
        entityType: 'field',
        entityId: input.survivorId,
        action: 'merged',
        changes: { mergedFieldId: input.otherId, areaHa: { from: current.area_ha, to: plan.areaHa }, validFrom: validFrom.toISOString(), reason: input.reason ?? null },
        event: { type: 'field.geometry_updated', payload: { fieldId: input.survivorId, geometryVersionId: version.id, previousVersionId: current.id, areaHa: plan.areaHa } },
      });
      await record(trx, ctx, {
        entityType: 'field',
        entityId: input.otherId,
        action: 'merged_into',
        changes: { survivorId: input.survivorId },
        event: { type: 'field.updated', payload: { fieldId: input.otherId } },
      });
      return this.fields.getIn(trx, input.survivorId);
    });
  }

  private async planMerge(trx: Trx, input: Out<typeof MergeFieldsInput>): Promise<MergePreview & { validFrom: Date }> {
    if (input.survivorId === input.otherId) throw badRequest('invalid_merge', 'Choose two different fields');
    const fields = await trx
      .selectFrom('fields as f')
      .innerJoin('field_current_geometry as g', 'g.field_id', 'f.id')
      .select(['f.id', 'f.name', 'f.status', 'g.valid_from'])
      .where('f.id', 'in', [input.survivorId, input.otherId])
      .forUpdate(['f'])
      .execute();
    const survivor = fields.find((f) => f.id === input.survivorId);
    const other = fields.find((f) => f.id === input.otherId);
    if (!survivor || !other) throw notFound('Field');
    if (survivor.status !== 'active' || other.status !== 'active') throw badRequest('field_archived', 'Archived fields cannot be merged');

    const validFrom = input.validFrom ? new Date(input.validFrom) : await dbNow(trx);
    if (validFrom > new Date(Date.now() + 60_000)) throw badRequest('invalid_valid_from', 'A boundary change cannot take effect in the future');
    if (survivor.valid_from && validFrom <= survivor.valid_from) throw badRequest('invalid_valid_from', 'The merge must take effect after the current boundary');

    const { rows } = await sql<{ geojson: MultiPolygon; area_ha: number; parts: number }>`
      WITH u AS (
        SELECT ST_Union(a.geometry, b.geometry) AS g
        FROM field_current_geometry a, field_current_geometry b
        WHERE a.field_id = ${input.survivorId}::uuid AND b.field_id = ${input.otherId}::uuid
      ), utm AS (
        SELECT g, (CASE WHEN ST_Y(ST_Centroid(g)) >= 0 THEN 32600 ELSE 32700 END) + floor((ST_X(ST_Centroid(g)) + 180) / 6)::int + 1 AS srid FROM u
      ), welded AS (
        SELECT ST_Multi(CASE WHEN ST_NumGeometries(g) > 1
          THEN ST_CollectionExtract(ST_MakeValid(ST_Transform(
                 ST_Buffer(ST_Buffer(ST_Transform(g, srid), ${MERGE_WELD_M}, 'join=mitre'), ${-MERGE_WELD_M}, 'join=mitre'), 4326)), 3)
          ELSE g END) AS g
        FROM utm
      )
      SELECT ST_AsGeoJSON(g, 7)::json AS geojson,
             round((ST_Area(g::geography) / 10000)::numeric, 4) AS area_ha,
             ST_NumGeometries(g) AS parts
      FROM welded`.execute(trx);
    const merged = rows[0];

    const blockers: string[] = [];
    const work = await trx
      .selectFrom('operation_fields as of')
      .innerJoin('operations as o', 'o.id', 'of.operation_id')
      .select(['o.id', 'o.type'])
      .where('of.field_id', '=', input.otherId)
      .where('o.status', '<>', 'canceled')
      .where(sql<boolean>`coalesce(o.performed_at, o.planned_on::timestamptz) >= ${validFrom}`)
      .execute();
    if (work.length) blockers.push(`operations_after_merge:${work.length}`);
    const divided = await trx
      .selectFrom('field_parts as fp')
      .innerJoin('growing_seasons as s', 's.id', 'fp.season_id')
      .select('fp.id')
      .where('fp.field_id', '=', input.survivorId)
      .where('s.end_date', '>=', validFrom.toLocaleDateString('sv-SE'))
      .limit(1)
      .executeTakeFirst();
    if (divided) blockers.push('survivor_divided');
    const removed = await trx
      .selectFrom('crop_cycles as cc')
      .innerJoin('growing_seasons as s', 's.id', 'cc.season_id')
      .select(['cc.id'])
      .select((eb) => [
        eb.exists(eb.selectFrom('harvests as h').select('h.id').whereRef('h.crop_cycle_id', '=', 'cc.id')).as('has_harvest'),
        eb.exists(eb.selectFrom('cost_entries as c').select('c.id').whereRef('c.crop_cycle_id', '=', 'cc.id')).as('has_costs'),
      ])
      .where('cc.field_id', '=', input.otherId)
      .where('s.start_date', '>=', validFrom.toLocaleDateString('sv-SE'))
      .execute();
    if (removed.some((r) => r.has_harvest || r.has_costs)) blockers.push('crops_with_records_after_merge');

    return { geometry: merged.geojson, areaHa: round(merged.area_ha, 4), parts: merged.parts, removedCropCycles: removed.length, blockers, validFrom };
  }

  /** Makes an earlier boundary current again, from `validFrom` on, as a new version. */
  restoreGeometry(ctx: Ctx, fieldId: string, input: Out<typeof RestoreFieldGeometryInput>): Promise<Field> {
    return this.db.run(ctx, async (trx) => {
      const old = await trx
        .selectFrom('field_geometry_versions')
        .select(['id', 'valid_to', sql<MultiPolygon>`ST_AsGeoJSON(geometry, 7)::json`.as('geojson')])
        .where('id', '=', input.versionId)
        .where('field_id', '=', fieldId)
        .executeTakeFirst();
      if (!old) throw notFound('Boundary version');
      if (!old.valid_to) throw badRequest('already_current', 'This boundary is already the current one');
      return this.fields.replaceGeometry(trx, ctx, fieldId, old.geojson as FieldGeometry, { validFrom: input.validFrom, reason: input.reason, source: 'restore' });
    });
  }
}
