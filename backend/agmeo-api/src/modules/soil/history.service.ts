import { Injectable } from '@nestjs/common';
import {
  type FieldSoilHistory,
  isSoilParameter,
  PH_METHODS,
  type PhMethod,
  type SoilAnalysisPayload,
  type SoilCampaign,
  type SoilHistoryState,
  type SoilParameter,
  type SoilSample,
  type SoilTexture,
  type SoilZone,
  soilClassOf,
} from '@agmeo/contracts';
import { sql } from 'kysely';
import type { Ctx } from '../../auth/context.js';
import { conflict, notFound } from '../../core/errors.js';
import { record } from '../../core/events.js';
import { iso, round } from '../../core/mappers.js';
import { Database, type Trx } from '../../db/database.js';
import { limeRequirement } from '../nutrients/lib/base-fertilization.js';
import { NutrientsService } from '../nutrients/nutrients.service.js';
import { ZONATION_COLUMNS, type ZonationRow, zoneClasses, zoneOut, zonesOf } from './soil-rows.js';
import { noJit, SoilZonationService } from './zonation.service.js';

/** Area-weighted means of the measured values of a set of zones. */
export function zoneMeans(zones: Pick<SoilZone, 'areaHa' | 'values'>[]): Partial<Record<SoilParameter, number>> {
  const acc = new Map<SoilParameter, [number, number]>();
  for (const z of zones) {
    for (const [p, v] of Object.entries(z.values)) {
      if (!isSoilParameter(p) || v == null) continue;
      const a = acc.get(p) ?? [0, 0];
      a[0] += v * z.areaHa;
      a[1] += z.areaHa;
      acc.set(p, a);
    }
  }
  return Object.fromEntries([...acc].filter(([, a]) => a[1] > 0).map(([p, a]) => [p, round(a[0] / a[1], 3)]));
}

/**
 * Sampling history of a field (campaigns = zonations with their lab values), the history of the
 * zone maps of several fields with bulk restore, and the analysis dashboard's data. Ported from
 * the reference's HistoryDrawer, HistoryCompareModal and soil/analyse.
 */
@Injectable()
export class SoilHistoryService {
  constructor(
    private readonly db: Database,
    private readonly zonations: SoilZonationService,
    private readonly nutrients: NutrientsService,
  ) {}

  async fieldHistory(ctx: Ctx, fieldId: string): Promise<FieldSoilHistory> {
    const [campaigns, samples] = await Promise.all([this.zonations.history(ctx, fieldId), this.nutrients.soilSamples(ctx, fieldId)]);
    const field = await this.db.run(ctx, (trx) => this.zonations.field(trx, fieldId));
    return {
      field: { id: field.id, name: field.name, areaHa: field.area_ha, geometry: field.geometry },
      campaigns: campaigns.map(
        (c): SoilCampaign => ({
          zonationId: c.id,
          method: c.method,
          source: c.source,
          createdAt: c.createdAt,
          active: c.active,
          sampledOn: c.sampledOn,
          means: zoneMeans(c.zones),
          zones: c.zones,
        }),
      ),
      samples: samples as SoilSample[],
    };
  }

  /**
   * Past states of the selected fields' zone maps: each batch run, and the end of every day on
   * which a zone map changed. Compared with today's active zone maps.
   */
  states(ctx: Ctx, fieldIds: string[]): Promise<SoilHistoryState[]> {
    return this.db.run(ctx, async (trx) => {
      const { rows } = await sql<{ id: string; field_id: string; batch_id: string | null; created_at: Date; superseded_at: Date | null }>`
        SELECT id, field_id, batch_id, created_at, superseded_at FROM soil_zonations
        WHERE field_id = ANY(${fieldIds}::uuid[]) AND status = 'ready'
        ORDER BY created_at`.execute(trx);
      const current = new Map(rows.filter((r) => !r.superseded_at).map((r) => [r.field_id, r.id]));
      const compare = (fields: { fieldId: string; zonationId: string }[]) => {
        const changed = fields.filter((f) => current.get(f.fieldId) !== f.zonationId).length;
        return { willChange: changed, unchanged: fields.length - changed, noZonation: fieldIds.length - fields.length };
      };
      const states: SoilHistoryState[] = [];
      const batches = new Map<string, typeof rows>();
      for (const r of rows) if (r.batch_id) batches.set(r.batch_id, [...(batches.get(r.batch_id) ?? []), r]);
      for (const [batchId, members] of batches) {
        const fields = members.map((m) => ({ fieldId: m.field_id, zonationId: m.id }));
        states.push({ key: `batch:${batchId}`, kind: 'batch', at: iso(members[0].created_at), fields, ...compare(fields) });
      }
      const dayEnd = (d: Date) => new Date(`${d.toISOString().slice(0, 10)}T23:59:59.999Z`);
      const days = new Set(rows.flatMap((r) => [dayEnd(r.created_at).toISOString(), ...(r.superseded_at ? [dayEnd(r.superseded_at).toISOString()] : [])]));
      for (const day of days) {
        const at = new Date(day);
        const fields = fieldIds.flatMap((fieldId) => {
          const active = rows.filter((r) => r.field_id === fieldId && r.created_at <= at && (!r.superseded_at || r.superseded_at > at)).at(-1);
          return active ? [{ fieldId, zonationId: active.id }] : [];
        });
        if (fields.length) states.push({ key: `day:${day.slice(0, 10)}`, kind: 'day', at: day, fields, ...compare(fields) });
      }
      return states.sort((a, b) => b.at.localeCompare(a.at));
    });
  }

  /** Makes the given (earlier) zonations active again, one per field. */
  restoreMany(ctx: Ctx, zonationIds: string[]): Promise<{ restored: number; unchanged: number }> {
    return this.db.run(ctx, async (trx) => {
      const targets = await trx.selectFrom('soil_zonations').select(['id', 'field_id', 'superseded_at']).where('id', 'in', zonationIds).where('status', '=', 'ready').execute();
      if (targets.length !== new Set(zonationIds).size) throw notFound('Zonation');
      const org = await trx.selectFrom('organizations').select('lock_zoned_fields').where('id', '=', ctx.orgId).executeTakeFirst();
      if (org?.lock_zoned_fields && targets.some((t) => t.superseded_at)) {
        const active = await trx
          .selectFrom('soil_zonations')
          .select('field_id')
          .where('field_id', 'in', targets.map((t) => t.field_id))
          .where('status', '=', 'ready')
          .where('superseded_at', 'is', null)
          .execute();
        if (active.length) throw conflict('zonation_locked', 'Fields with a soil zonation are locked in this organization (Settings → Soil)');
      }
      let restored = 0;
      for (const t of targets) {
        if (!t.superseded_at) continue;
        await trx.updateTable('soil_zonations').set({ superseded_at: new Date() }).where('field_id', '=', t.field_id).where('status', '=', 'ready').where('superseded_at', 'is', null).execute();
        await trx.updateTable('soil_zonations').set({ superseded_at: null }).where('id', '=', t.id).execute();
        await record(trx, ctx, { entityType: 'field', entityId: t.field_id, action: 'soil_zonation_restored', changes: { zonationId: t.id } });
        restored++;
      }
      return { restored, unchanged: targets.length - restored };
    });
  }

  analysis(ctx: Ctx): Promise<SoilAnalysisPayload> {
    return this.db.run(ctx, (trx) => this.queryAnalysis(trx));
  }

  private async queryAnalysis(trx: Trx): Promise<SoilAnalysisPayload> {
    await noJit(trx);
    const { rows: fields } = await sql<{ id: string; name: string; soil_texture: string | null; zonation_id: string | null; bbox: [number, number, number, number] | null }>`
      SELECT f.id, f.name, f.soil_texture, n.id AS zonation_id,
             CASE WHEN g.geometry IS NULL THEN NULL ELSE json_build_array(ST_XMin(g.geometry), ST_YMin(g.geometry), ST_XMax(g.geometry), ST_YMax(g.geometry)) END AS bbox
      FROM fields f
      LEFT JOIN field_current_geometry g ON g.field_id = f.id
      LEFT JOIN soil_zonations n ON n.field_id = f.id AND n.status = 'ready' AND n.superseded_at IS NULL
      WHERE f.status = 'active'
      ORDER BY f.name`.execute(trx);
    const zonationIds = fields.map((f) => f.zonation_id).filter((id): id is string => !!id);
    const zoneRows = await zonesOf(trx, zonationIds);
    const out: SoilAnalysisPayload = { zones: [], fields: [], totalFieldCount: fields.length };
    for (const f of fields) {
      if (!f.zonation_id) continue;
      const texture = f.soil_texture as SoilTexture | null;
      const soil = soilClassOf(texture);
      const zones = zoneRows.filter((z) => z.zonation_id === f.zonation_id).map((z) => zoneOut(z, texture));
      const sampled = zones.filter((z) => Object.keys(z.dates).length > 0);
      if (!sampled.length) continue;
      for (const z of sampled) {
        const phMethod = (PH_METHODS as readonly string[]).includes(z.methods.ph ?? '') ? (z.methods.ph as PhMethod) : null;
        const rate = limeRequirement(z.values.ph ?? null, phMethod, soil, z.values.humus ?? null);
        const year = Object.values(z.dates).sort().at(-1)?.slice(0, 4);
        out.zones.push({
          fieldId: f.id,
          year: year ? Number(year) : null,
          areaHa: z.areaHa,
          values: { ph: z.values.ph, p2o5: z.values.p2o5, k2o: z.values.k2o, mgo: z.values.mgo, humus: z.values.humus },
          classes: z.classes,
          limeDt: rate == null ? null : round(rate * z.areaHa, 1),
        });
      }
      const means = zoneMeans(sampled);
      out.fields.push({
        id: f.id,
        name: f.name,
        sampleCount: sampled.length,
        soilTexture: f.soil_texture,
        bbox: f.bbox,
        classes: zoneClasses(means, {}, texture),
      });
    }
    return out;
  }
}
