import { Injectable } from '@nestjs/common';
import type { AnnotationGeometry, AnnotationInput, AnnotationKind, AnnotationPatch, SatelliteAnnotation } from '@agmeo/contracts';
import { sql } from 'kysely';
import type { Ctx } from '../../auth/context.js';
import { notFound } from '../../core/errors.js';
import { iso } from '../../core/mappers.js';
import type { Out } from '../../core/validation.js';
import { Database, type Trx } from '../../db/database.js';

const COLUMNS = [
  'a.id',
  'a.field_id',
  sql<string>`to_char(a.observed_on, 'YYYY-MM-DD')`.as('date'),
  'a.layer',
  'a.kind',
  'a.color',
  'a.note',
  sql<string>`ST_AsGeoJSON(a.geometry, 7)`.as('geojson'),
  'a.created_at',
  'a.created_by',
] as const;

type Row = {
  id: string;
  field_id: string;
  date: string;
  layer: string | null;
  kind: string;
  color: string;
  note: string | null;
  geojson: string;
  created_at: Date;
  created_by: string | null;
};

const toAnnotation = (r: Row): SatelliteAnnotation => ({
  id: r.id,
  fieldId: r.field_id,
  date: r.date,
  layer: r.layer,
  kind: r.kind as AnnotationKind,
  color: r.color,
  note: r.note,
  geometry: JSON.parse(r.geojson) as AnnotationGeometry,
  createdAt: iso(r.created_at),
  createdBy: r.created_by,
});

/** Notes drawn on a field's satellite scenes. */
@Injectable()
export class AnnotationsService {
  constructor(private readonly db: Database) {}

  list(ctx: Ctx, fieldId: string, filter: { date?: string }): Promise<SatelliteAnnotation[]> {
    return this.db.run(ctx, async (trx) => {
      await this.requireField(trx, fieldId);
      let q = trx.selectFrom('field_annotations as a').select(COLUMNS).where('a.field_id', '=', fieldId);
      if (filter.date) q = q.where('a.observed_on', '=', filter.date);
      const rows = await q.orderBy('a.observed_on', 'desc').orderBy('a.created_at').execute();
      return rows.map((r) => toAnnotation(r as Row));
    });
  }

  create(ctx: Ctx, fieldId: string, input: Out<typeof AnnotationInput>): Promise<SatelliteAnnotation> {
    return this.db.run(ctx, async (trx) => {
      await this.requireField(trx, fieldId);
      const { id } = await trx
        .insertInto('field_annotations')
        .values({
          organization_id: ctx.orgId,
          field_id: fieldId,
          observed_on: input.date,
          layer: input.layer ?? null,
          kind: input.kind,
          color: input.color,
          note: input.note || null,
          geometry: sql<string>`ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(input.geometry)}), 4326)`,
          created_by: ctx.userId,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return this.get(trx, fieldId, id);
    });
  }

  update(ctx: Ctx, fieldId: string, id: string, patch: Out<typeof AnnotationPatch>): Promise<SatelliteAnnotation> {
    return this.db.run(ctx, async (trx) => {
      const res = await trx
        .updateTable('field_annotations')
        .set({ note: patch.note || null, updated_at: new Date() })
        .where('id', '=', id)
        .where('field_id', '=', fieldId)
        .executeTakeFirst();
      if (!res.numUpdatedRows) throw notFound('Annotation');
      return this.get(trx, fieldId, id);
    });
  }

  remove(ctx: Ctx, fieldId: string, id: string): Promise<void> {
    return this.db.run(ctx, async (trx) => {
      const res = await trx.deleteFrom('field_annotations').where('id', '=', id).where('field_id', '=', fieldId).executeTakeFirst();
      if (!res.numDeletedRows) throw notFound('Annotation');
    });
  }

  private async get(trx: Trx, fieldId: string, id: string): Promise<SatelliteAnnotation> {
    const row = await trx.selectFrom('field_annotations as a').select(COLUMNS).where('a.id', '=', id).where('a.field_id', '=', fieldId).executeTakeFirst();
    if (!row) throw notFound('Annotation');
    return toAnnotation(row as Row);
  }

  private async requireField(trx: Trx, fieldId: string) {
    const field = await trx.selectFrom('fields').select('id').where('id', '=', fieldId).executeTakeFirst();
    if (!field) throw notFound('Field');
  }
}
