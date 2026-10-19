/**
 * The API side of the model services: ESM runs and the N model of the zone optimisation, the ESM
 * crop timeseries, and grassland predictions. Convention while a service is not configured:
 * reads answer `configured: false`, requests that would call it answer 503
 * `service_not_configured`.
 */
import { Injectable, Logger } from '@nestjs/common';
import type {
  CropGrasslandPrediction,
  CropTimeseries,
  EsmModelZone,
  EsmRun,
  GrasslandPredictionInput,
  GrasslandPredictions,
  NitrogenModel,
  PredictionTimeseries,
  PredictionTimeseriesQuery,
  StartEsmRunInput,
  ZoneNitrogenModel,
} from '@agmeo/contracts';
import { sql, type Selectable } from 'kysely';
import type { Ctx } from '../../auth/context.js';
import { badRequest, notFound } from '../../core/errors.js';
import { Database, type Trx } from '../../db/database.js';
import type { EsmRuns } from '../../db/schema.js';
import { enqueue } from '../../jobs/queue.js';
import { cropsWithoutSowingHarvesting, modelCrop } from '../../models/crops.js';
import { hasNitrogenModel } from '../../models/nitrogen/curves.js';
import { esmCropFor } from '../../models/nitrogen/esmCrops.js';
import { getDefaultNResidual, nitrogenCurve, zoneNitrogen } from '../../models/nitrogen/nitrogen.js';
import { ESM_RUN, EsmClient, type EsmRunRequest } from './esm.js';
import { GrasslandClient, shapeGrasslandPredictions } from './grassland.js';
import { notConfigured, unavailable } from './http.js';

/** Crop codes the grassland model applies to. */
export const GRASSLAND_CROP_CODES = ['grassland', 'field_grass', 'clover_grass'];
/** Reference consts: fields under this area, and legumes, get one zone; others five. */
const MIN_HA_FOR_ZONATION = 1.5;
const DEFAULT_ZONES = 5;
/** Humus % assumed without a soil sample (reference DEFAULT_HUMUS_PERCENT); SOC ≈ humus / 1.72. */
const DEFAULT_HUMUS_PCT = 2;

interface CycleContext {
  id: string;
  fieldId: string;
  cropCode: string;
  isLegume: boolean;
  harvestYear: number;
  areaHa: number;
  geometry: EsmRunRequest['cultivation']['geom4326'] | null;
  sowingDate: string | null;
  soilTexture: string | null;
  humusPct: number | null;
  timezone: string;
}

const toRun = (r: Selectable<EsmRuns>): EsmRun => ({
  id: r.id,
  cropCycleId: r.crop_cycle_id,
  zoneCount: r.zone_count,
  status: r.status as EsmRun['status'],
  executionId: r.execution_id,
  error: r.error,
  requestedAt: new Date(r.requested_at).toISOString(),
  finishedAt: r.finished_at ? new Date(r.finished_at).toISOString() : null,
});

const SERIES_KEYS = ['FRESH_MATTER', 'DRY_MATTER', 'DMC', 'BBCH', 'GDD', 'CBD', 'DTU', 'LAI', 'NFK', 'CNMIN', 'CNUP'] as const;

/** The ESM timeseries.json, or null when it is not one (the reference's GeneralTimeseries schema). */
export function parseCropTimeseries(raw: unknown): CropTimeseries | null {
  const o = raw as Record<string, unknown> | null;
  if (!o || !Array.isArray(o.keys) || !o.keys.every((k) => typeof k === 'string')) return null;
  const n = o.keys.length;
  const out: Record<string, unknown> = { keys: (o.keys as string[]).map((k) => k.slice(0, 10)) };
  for (const key of SERIES_KEYS) {
    const s = o[key];
    if (!Array.isArray(s) || s.length !== n || !s.every((v) => typeof v === 'number')) return null;
    out[key] = s;
  }
  return out as unknown as CropTimeseries;
}

/** Today on the farm's calendar. */
const localToday = (timezone: string) => new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

@Injectable()
export class ModelServicesService {
  private readonly logger = new Logger(ModelServicesService.name);
  /** Replaced in tests. */
  esm = new EsmClient();
  grassland = new GrasslandClient();

  constructor(private readonly db: Database) {}

  // --- ESM -------------------------------------------------------------------------------------

  private async cycle(trx: Trx, id: string): Promise<CycleContext> {
    const { rows } = await sql<{
      id: string; field_id: string; code: string; is_legume: boolean; harvest_year: number; area_ha: number | null; geometry: string | null;
      sowing_date: string | null; booked: string | null; soil_texture: string | null; timezone: string;
    }>`
      SELECT cc.id, cc.field_id, c.code, c.is_legume, s.harvest_year,
             coalesce(cc.area_ha, fp.area_ha, g.area_ha)::float8 AS area_ha,
             ST_AsGeoJSON(coalesce(fp.geometry, g.geometry), 7) AS geometry,
             cc.sowing_date::text AS sowing_date,
             (SELECT min((o.performed_at AT TIME ZONE 'Europe/Berlin')::date)::text FROM operations o JOIN operation_fields ofl ON ofl.operation_id = o.id
               WHERE ofl.crop_cycle_id = cc.id AND o.type = 'sowing' AND o.status = 'completed') AS booked,
             f.soil_texture, fa.timezone
      FROM crop_cycles cc
      JOIN crops c ON c.id = cc.crop_id
      JOIN growing_seasons s ON s.id = cc.season_id
      JOIN fields f ON f.id = cc.field_id
      JOIN farms fa ON fa.id = f.farm_id
      LEFT JOIN field_current_geometry g ON g.field_id = cc.field_id
      LEFT JOIN field_parts fp ON fp.id = cc.field_part_id
      WHERE cc.id = ${id}`.execute(trx);
    const r = rows[0];
    if (!r) throw notFound('Crop');
    const humus = await trx
      .selectFrom('soil_samples')
      .select('humus_pct')
      .where('field_id', '=', r.field_id)
      .where('humus_pct', 'is not', null)
      .orderBy('sampled_on', 'desc')
      .limit(1)
      .executeTakeFirst();
    return {
      id: r.id,
      fieldId: r.field_id,
      cropCode: r.code,
      isLegume: r.is_legume,
      harvestYear: r.harvest_year,
      areaHa: Number(r.area_ha ?? 0),
      geometry: r.geometry ? JSON.parse(r.geometry) : null,
      sowingDate: r.booked ?? r.sowing_date,
      soilTexture: r.soil_texture,
      humusPct: humus?.humus_pct ?? null,
      timezone: r.timezone,
    };
  }

  /** The ESM crop of a crop code; null when the ESM does not model it (or there is nothing to model). */
  private esmCrop(code: string): string | null {
    const crop = modelCrop(code);
    if (!crop || cropsWithoutSowingHarvesting.includes(crop)) return null;
    return esmCropFor(crop);
  }

  /** The /esm/run body for a crop (reference _callEsmRun), assembled in the user's context. */
  private runRequest(c: CycleContext, esmCrop: string, zoneCount: number): EsmRunRequest {
    const soc = (c.humusPct ?? DEFAULT_HUMUS_PCT) / 1.72;
    return {
      cultivation: {
        id: c.id,
        year: c.harvestYear,
        crop: esmCrop,
        geom4326: c.geometry!,
        // Without one the ESM worker falls back to the crop's default sowing date.
        ...(c.sowingDate ? { sowingDate: `${c.sowingDate}T00:00:00.000Z` } : {}),
        // The field's soil class as a one-zone soil map; without it the ESM uses its own soil data.
        ...(c.soilTexture
          ? { soil: { map: { type: 'FeatureCollection' as const, features: [{ type: 'Feature' as const, geometry: c.geometry, properties: { soilTypeLUFA: c.soilTexture, soilOrganicCarbon: Math.round(soc * 100) / 100 } }] } } }
          : {}),
      },
      parameters: { nrZones: zoneCount },
      meta: { sourceDomain: this.esm.writebackDomain, includeResultInResponse: true },
    };
  }

  startRun(ctx: Ctx, cropCycleId: string, input: StartEsmRunInput): Promise<EsmRun> {
    if (!this.esm.configured) throw notConfigured('esm');
    return this.db.run(ctx, async (trx) => {
      const c = await this.cycle(trx, cropCycleId);
      const esmCrop = this.esmCrop(c.cropCode);
      if (!esmCrop) throw badRequest('crop_not_modelled', 'The ecosystem model does not model this crop');
      if (!c.geometry) throw badRequest('no_geometry', 'The field has no boundary');
      const pending = await trx
        .selectFrom('esm_runs')
        .selectAll()
        .where('crop_cycle_id', '=', cropCycleId)
        .where('status', 'in', ['queued', 'running'])
        .where('requested_at', '>', sql<Date>`now() - interval '15 minutes'`)
        .executeTakeFirst();
      if (pending) return toRun(pending);
      const zoneCount = input.zoneCount ?? (c.areaHa < MIN_HA_FOR_ZONATION || c.isLegume ? 1 : DEFAULT_ZONES);
      const run = await trx
        .insertInto('esm_runs')
        .values({
          organization_id: ctx.orgId,
          crop_cycle_id: cropCycleId,
          zone_count: zoneCount,
          request: JSON.stringify(this.runRequest(c, esmCrop, zoneCount)),
          requested_by: ctx.userId,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      await enqueue(trx, { kind: ESM_RUN, organizationId: ctx.orgId, payload: { runId: run.id }, dedupeKey: run.id, maxAttempts: 1 });
      return toRun(run);
    });
  }

  nitrogenModel(ctx: Ctx, cropCycleId: string, zoningId?: string): Promise<NitrogenModel> {
    return this.db.run(ctx, async (trx) => {
      const c = await this.cycle(trx, cropCycleId);
      const crop = modelCrop(c.cropCode);
      const runs = await trx.selectFrom('esm_runs').selectAll().where('crop_cycle_id', '=', cropCycleId).orderBy('requested_at', 'desc').limit(20).execute();
      const latest = runs[0] ?? null;
      const done = runs.find((r) => r.status === 'succeeded') ?? null;
      const base: NitrogenModel = {
        configured: this.esm.configured,
        cropCycleId,
        esmCrop: this.esmCrop(c.cropCode),
        hasNitrogenModel: !!crop && hasNitrogenModel(crop),
        latestRun: latest ? toRun(latest) : null,
        run: done ? toRun(done) : null,
        modelZones: [],
        zoningId: null,
        zones: [],
      };
      if (!done) return base;

      const { rows: modelRows } = await sql<{
        zone_no: number; area_ha: number; area_fraction: number; yield_t_ha: number; n_crop_kg_ha: number | null; n_min_kg_ha: number; n_min_spring_kg_ha: number;
        n_loss_kg_ha: number; soil_type_lufa: string | null; soil_organic_carbon_pct: number | null; geometry: string;
      }>`SELECT zone_no, area_ha, area_fraction, yield_t_ha, n_crop_kg_ha, n_min_kg_ha, n_min_spring_kg_ha, n_loss_kg_ha, soil_type_lufa, soil_organic_carbon_pct,
               ST_AsGeoJSON(geometry, 7) AS geometry
         FROM esm_run_zones WHERE run_id = ${done.id} ORDER BY zone_no`.execute(trx);
      base.modelZones = modelRows.map(
        (z): EsmModelZone => ({
          zoneNo: z.zone_no,
          areaHa: Number(z.area_ha),
          areaFraction: Number(z.area_fraction),
          yieldTHa: z.yield_t_ha,
          nCropKgHa: z.n_crop_kg_ha,
          nMinKgHa: z.n_min_kg_ha,
          nMinSpringKgHa: z.n_min_spring_kg_ha,
          nLossKgHa: z.n_loss_kg_ha,
          soilTypeLufa: z.soil_type_lufa,
          soilOrganicCarbonPct: z.soil_organic_carbon_pct,
          geometry: JSON.parse(z.geometry),
        }),
      );
      if (!zoningId) return base;

      const zoning = await trx.selectFrom('zonings').select('field_id').where('id', '=', zoningId).executeTakeFirst();
      if (!zoning || zoning.field_id !== c.fieldId) throw notFound('Zoning');
      // The ESM zones on each productivity zone, weighted by the overlapping area.
      const { rows } = await sql<{
        zone_no: number; zone_m2: number; overlap_m2: number; yield_t_ha: number; n_crop_kg_ha: number | null; n_min_kg_ha: number; n_min_spring_kg_ha: number; n_loss_kg_ha: number; soil_type_lufa: string | null;
      }>`
        WITH o AS (
          SELECT z.zone_no, ST_Area(z.geometry::geography) AS zone_m2, e.yield_t_ha, e.n_crop_kg_ha, e.n_min_kg_ha, e.n_min_spring_kg_ha, e.n_loss_kg_ha, e.soil_type_lufa, ST_Area(ST_Intersection(z.geometry, e.geometry)::geography) AS a
          FROM zoning_zones z JOIN esm_run_zones e ON e.run_id = ${done.id} AND ST_Intersects(z.geometry, e.geometry)
          WHERE z.zoning_id = ${zoningId}
        )
        SELECT zone_no, max(zone_m2) AS zone_m2, sum(a) AS overlap_m2,
               sum(yield_t_ha * a) / nullif(sum(a), 0) AS yield_t_ha,
               CASE WHEN bool_and(n_crop_kg_ha IS NOT NULL) THEN sum(n_crop_kg_ha * a) / nullif(sum(a), 0) END AS n_crop_kg_ha,
               sum(n_min_kg_ha * a) / nullif(sum(a), 0) AS n_min_kg_ha,
               sum(n_min_spring_kg_ha * a) / nullif(sum(a), 0) AS n_min_spring_kg_ha,
               sum(n_loss_kg_ha * a) / nullif(sum(a), 0) AS n_loss_kg_ha,
               (array_agg(soil_type_lufa ORDER BY a DESC))[1] AS soil_type_lufa
        FROM o WHERE a > 0 GROUP BY zone_no ORDER BY zone_no`.execute(trx);
      const nResidual = crop ? getDefaultNResidual(crop) : 0;
      base.zoningId = zoningId;
      base.zones = rows.map((r): ZoneNitrogenModel => {
        const terms = { yieldTHa: Number(r.yield_t_ha), nMin: Number(r.n_min_kg_ha), nMinSpring: Number(r.n_min_spring_kg_ha), nLoss: Number(r.n_loss_kg_ha), nResidual };
        const n = crop ? zoneNitrogen({ crop, ...terms }) : null;
        return {
          zoneNo: r.zone_no,
          coverage: Math.min(1, Number(r.overlap_m2) / (Number(r.zone_m2) || 1)),
          yieldTHa: terms.yieldTHa,
          nCropKgHa: r.n_crop_kg_ha == null ? null : Number(r.n_crop_kg_ha),
          nMinKgHa: terms.nMin,
          nMinSpringKgHa: terms.nMinSpring,
          nLossKgHa: terms.nLoss,
          nResidualKgHa: nResidual,
          nDemandKgHa: n ? n.nDemand : null,
          soilTypeLufa: r.soil_type_lufa,
        };
      });
      return base;
    });
  }

  async timeseries(ctx: Ctx, q: PredictionTimeseriesQuery): Promise<PredictionTimeseries> {
    const cycle = await this.db.run(ctx, async (trx) => {
      if (q.cropCycleId) {
        const r = await trx
          .selectFrom('crop_cycles as cc')
          .innerJoin('growing_seasons as s', 's.id', 'cc.season_id')
          .select(['cc.id', 's.harvest_year'])
          .where('cc.id', '=', q.cropCycleId)
          .executeTakeFirst();
        if (!r) throw notFound('Crop');
        return r;
      }
      // The field's main crop of that harvest year, the whole-field crop first.
      const r = await trx
        .selectFrom('crop_cycles as cc')
        .innerJoin('growing_seasons as s', 's.id', 'cc.season_id')
        .select(['cc.id', 's.harvest_year'])
        .where('cc.field_id', '=', q.fieldId!)
        .where('s.harvest_year', '=', q.year!)
        .where('cc.role', '=', 'main')
        .orderBy(sql`cc.field_part_id IS NULL`, 'desc')
        .orderBy('cc.created_at')
        .executeTakeFirst();
      if (!r) throw notFound('Crop');
      return r;
    });
    const out: PredictionTimeseries = { configured: this.esm.configured, cropCycleId: cycle.id, harvestYear: cycle.harvest_year, available: false, timeseries: null, nitrogenCurve: [] };
    if (!this.esm.configured) return out;
    let raw: unknown;
    try {
      raw = await this.esm.timeseries(cycle.harvest_year, cycle.id);
    } catch (e) {
      // As the reference: a missing or broken timeseries is an empty one, not an error.
      this.logger.warn(`ESM timeseries of ${cycle.id}: ${(e as Error).message}`);
      return out;
    }
    const ts = raw == null ? null : parseCropTimeseries(raw);
    if (raw != null && !ts) this.logger.warn(`ESM timeseries of ${cycle.id} has an unexpected shape`);
    if (!ts) return out;
    return { ...out, available: true, timeseries: ts, nitrogenCurve: nitrogenCurve(ts) };
  }

  // --- Grassland -------------------------------------------------------------------------------

  async grasslandPredictions(ctx: Ctx, input: GrasslandPredictionInput): Promise<GrasslandPredictions> {
    if (!this.grassland.configured) return { configured: false, serviceVersion: null, total: null, fields: [] };
    const year = input.year ?? new Date().getFullYear();
    const { fields, satellite, timezone } = await this.db.run(ctx, async (trx) => {
      const { rows } = await sql<{ id: string; area_ha: number; geometry: string; timezone: string }>`
        SELECT f.id, g.area_ha::float8 AS area_ha, ST_AsGeoJSON(g.geometry, 7) AS geometry, fa.timezone
        FROM fields f JOIN field_current_geometry g ON g.field_id = f.id JOIN farms fa ON fa.id = f.farm_id
        WHERE f.id = ANY (${input.fieldIds}::uuid[])`.execute(trx);
      if (rows.length !== new Set(input.fieldIds).size) throw notFound('Field');
      // Field-mean NDMI of the season, so grassland-api fetches only the scenes it lacks (best effort).
      const obs = await trx
        .selectFrom('field_observations')
        .select(['field_id', 'observed_on', 'mean'])
        .where('field_id', 'in', input.fieldIds)
        .where('index_type', '=', 'ndmi')
        .where('status', '=', 'valid')
        .where('mean', 'is not', null)
        .where('observed_on', '>=', `${year}-01-01`)
        .where('observed_on', '<=', `${year}-12-31`)
        .orderBy('observed_on')
        .execute();
      const satellite = new Map<string, { date: string; ndmi: number }[]>();
      for (const o of obs) satellite.set(o.field_id, [...(satellite.get(o.field_id) ?? []), { date: o.observed_on, ndmi: Number(o.mean) }]);
      return { fields: rows, satellite, timezone: rows[0]?.timezone ?? 'Europe/Berlin' };
    });
    let res;
    try {
      res = await this.grassland.predict({
        fields: fields.map((f) => ({ id: f.id, geometry: JSON.parse(f.geometry), areaInHa: Number(f.area_ha), satellite: satellite.get(f.id) })),
        year,
        lastHarvest: input.lastHarvest ?? undefined,
        targetDMC: input.targetDMC,
      });
    } catch (e) {
      this.logger.error(`grassland-api: ${(e as Error).message}`);
      throw unavailable('grassland', e);
    }
    return shapeGrasslandPredictions({
      fields: input.fieldIds.map((id) => ({ id, areaHa: Number(fields.find((f) => f.id === id)!.area_ha) })),
      series: new Map((res.fields ?? []).map((f) => [f.id, f.timeseries])),
      year,
      today: localToday(timezone),
      lastHarvest: input.lastHarvest ?? null,
      targetDMC: input.targetDMC,
      serviceVersion: res.serviceVersion ?? null,
    });
  }

  async cropGrasslandPrediction(ctx: Ctx, cropCycleId: string, targetDMC: number): Promise<CropGrasslandPrediction> {
    const c = await this.db.run(ctx, async (trx) => {
      const r = await trx
        .selectFrom('crop_cycles as cc')
        .innerJoin('crops as c', 'c.id', 'cc.crop_id')
        .innerJoin('growing_seasons as s', 's.id', 'cc.season_id')
        .select(['cc.id', 'cc.field_id', 'c.code', 's.harvest_year'])
        .where('cc.id', '=', cropCycleId)
        .executeTakeFirst();
      if (!r) throw notFound('Crop');
      const cuts = await trx.selectFrom('harvests').select('harvest_date').where('crop_cycle_id', '=', cropCycleId).orderBy('harvest_date').execute();
      return { ...r, cuts: cuts.map((h) => h.harvest_date) };
    });
    const applicable = GRASSLAND_CROP_CODES.includes(c.code);
    if (!applicable || !this.grassland.configured) return { configured: this.grassland.configured, applicable, prediction: null };
    const p = await this.grasslandPredictions(ctx, { fieldIds: [c.field_id], year: c.harvest_year, lastHarvest: c.cuts.length ? c.cuts : null, targetDMC });
    return { configured: true, applicable, prediction: p.fields[0] ?? null };
  }
}
