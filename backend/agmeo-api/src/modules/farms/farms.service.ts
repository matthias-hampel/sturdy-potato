import { Injectable } from '@nestjs/common';
import type { Farm, FarmInput, LatLng } from '@agmeo/contracts';
import { sql } from 'kysely';
import type { Ctx } from '../../auth/context.js';
import { badRequest, notFound } from '../../core/errors.js';
import { diff, record } from '../../core/events.js';
import { iso } from '../../core/mappers.js';
import type { Out } from '../../core/validation.js';
import { Database, type Trx } from '../../db/database.js';

const point = (loc: LatLng | null | undefined) =>
  loc ? sql<string>`ST_SetSRID(ST_MakePoint(${loc.lng}, ${loc.lat}), 4326)` : null;

@Injectable()
export class FarmsService {
  constructor(private readonly db: Database) {}

  list(ctx: Ctx, includeArchived = false): Promise<Farm[]> {
    return this.db.run(ctx, (trx) => this.query(trx, { includeArchived }));
  }

  get(ctx: Ctx, id: string): Promise<Farm> {
    return this.db.run(ctx, (trx) => this.getIn(trx, id));
  }

  async getIn(trx: Trx, id: string): Promise<Farm> {
    const [farm] = await this.query(trx, { id, includeArchived: true });
    if (!farm) throw notFound('Farm');
    return farm;
  }

  create(ctx: Ctx, input: Out<typeof FarmInput>): Promise<Farm> {
    return this.db.run(ctx, async (trx) => {
      const { id } = await trx
        .insertInto('farms')
        .values({
          organization_id: ctx.orgId,
          name: input.name,
          address: input.address ?? null,
          country: input.country,
          timezone: input.timezone,
          location: point(input.location),
          map_zoom: input.location ? (input.mapZoom ?? null) : null,
          notes: input.notes ?? null,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await record(trx, ctx, {
        entityType: 'farm',
        entityId: id,
        action: 'created',
        changes: { name: input.name },
        event: { type: 'farm.created', payload: { farmId: id, name: input.name, location: input.location ?? null } },
      });
      return this.getIn(trx, id);
    });
  }

  update(ctx: Ctx, id: string, input: Out<typeof FarmInput> & { archived?: boolean }): Promise<Farm> {
    return this.db.run(ctx, async (trx) => {
      const before = await this.getIn(trx, id);
      await trx
        .updateTable('farms')
        .set({
          name: input.name,
          address: input.address ?? null,
          country: input.country,
          timezone: input.timezone,
          location: point(input.location),
          map_zoom: input.location ? (input.mapZoom ?? null) : null,
          notes: input.notes ?? null,
        })
        .where('id', '=', id)
        .execute();
      const after = await this.getIn(trx, id);
      await record(trx, ctx, {
        entityType: 'farm',
        entityId: id,
        action: 'updated',
        changes: diff(before as unknown as Record<string, unknown>, after as unknown as Record<string, unknown>),
        event: { type: 'farm.updated', payload: { farmId: id } },
      });
      return after;
    });
  }

  setArchived(ctx: Ctx, id: string, archived: boolean): Promise<Farm> {
    return this.db.run(ctx, async (trx) => {
      await this.getIn(trx, id);
      await trx
        .updateTable('farms')
        .set({ archived_at: archived ? sql`now()` : null })
        .where('id', '=', id)
        .execute();
      await record(trx, ctx, { entityType: 'farm', entityId: id, action: archived ? 'archived' : 'restored' });
      return this.getIn(trx, id);
    });
  }

  delete(ctx: Ctx, id: string): Promise<void> {
    return this.db.run(ctx, async (trx) => {
      const farm = await this.getIn(trx, id);
      if (farm.fieldCount > 0) throw badRequest('farm_not_empty', 'Move or delete the fields of this farm first, or archive it');
      await trx.deleteFrom('farms').where('id', '=', id).execute();
      await record(trx, ctx, { entityType: 'farm', entityId: id, action: 'deleted', changes: { name: farm.name } });
    });
  }

  private async query(trx: Trx, opts: { id?: string; includeArchived: boolean }): Promise<Farm[]> {
    let q = trx
      .selectFrom('farms as fa')
      .select([
        'fa.id',
        'fa.name',
        'fa.address',
        'fa.country',
        'fa.timezone',
        'fa.map_zoom',
        'fa.notes',
        'fa.archived_at',
        'fa.created_at',
        sql<number | null>`ST_Y(fa.location)`.as('lat'),
        sql<number | null>`ST_X(fa.location)`.as('lng'),
        (eb) =>
          eb
            .selectFrom('fields as f')
            .select((e) => e.fn.countAll<number>().as('n'))
            .whereRef('f.farm_id', '=', 'fa.id')
            .where('f.status', '=', 'active')
            .as('field_count'),
        (eb) =>
          eb
            .selectFrom('fields as f')
            .innerJoin('field_current_geometry as g', 'g.field_id', 'f.id')
            .select(sql<number>`coalesce(sum(g.area_ha), 0)`.as('a'))
            .whereRef('f.farm_id', '=', 'fa.id')
            .where('f.status', '=', 'active')
            .as('total_area_ha'),
      ])
      .orderBy('fa.name');
    if (opts.id) q = q.where('fa.id', '=', opts.id);
    if (!opts.includeArchived) q = q.where('fa.archived_at', 'is', null);
    const rows = await q.execute();
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      address: r.address,
      country: r.country,
      timezone: r.timezone,
      location: r.lat != null && r.lng != null ? { lat: r.lat, lng: r.lng } : null,
      mapZoom: r.map_zoom,
      notes: r.notes,
      archivedAt: iso(r.archived_at),
      fieldCount: Number(r.field_count ?? 0),
      totalAreaHa: Number(r.total_area_ha ?? 0),
      createdAt: iso(r.created_at),
    }));
  }
}
