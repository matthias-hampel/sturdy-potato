/**
 * Per-crop model details the crop tabs need beyond the crop-table conditions (which carry the
 * bars and today's BBCH): the FAO-56 root-zone water balance of every crop of a season with its
 * irrigation (reference `getFieldsIrrigationDataForOrg`), the rooting-depth override, and the
 * BBCH dialog's model run with the farmer's observations (reference `buildBbchSnapshots`).
 * Computed per request from the stored weather, loaded once per weather cell.
 */
import { Injectable } from '@nestjs/common';
import type { CropPhenology, CycleWaterBalance, IrrigationMethod, RootDepthInput, SoilTexture, WaterBalanceSummary } from '@agmeo/contracts';
import { sql } from 'kysely';
import type { Ctx } from '../../auth/context.js';
import { badRequest, notFound } from '../../core/errors.js';
import { Database, type Trx } from '../../db/database.js';
import { modelCrop } from '../../models/crops.js';
import { computeFieldWaterBalance } from '../../models/index.js';
import type { IrrigationTransaction } from '../../models/irrigation/data.js';
import { fillRatioPct, getRootDepth, thetaToMm } from '../../models/irrigation/waterBalance.js';
import { CROP_PARAMS } from '../../models/phenology/bbchModel.js';
import { calibrateBbch, runBbchModel, type BbchModelRun } from '../../models/phenology/bbchSnapshot.js';
import { getDefaultSowingDate } from '../../models/phenology/cropCalendar.js';
import { TEXTURE_OF_CLASS, cellWeather } from './cell-weather.js';

const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const today = () => new Date().toISOString().slice(0, 10);

interface Row {
  field_id: string;
  soil_texture: string | null;
  latitude: number;
  lat: string;
  lng: string;
  timezone: string | null;
  utc_offset_seconds: number | null;
  cycle_id: string;
  crop_code: string | null;
  crop_name: string | null;
  harvest_year: number;
  /** Earliest sowing operation of any status, else the planned date (the water balance's start, as in the reference). */
  sowing_date: string | null;
  completed_sowing: string | null;
  planned_sowing: string | null;
  root_depth_m: number | null;
}

type Weather = Awaited<ReturnType<typeof cellWeather>>;

@Injectable()
export class CropModelsService {
  constructor(private readonly db: Database) {}

  /** Root-zone balance with its days and irrigation events for every main crop cycle of the season. */
  waterBalances(ctx: Ctx, seasonId: string): Promise<CycleWaterBalance[]> {
    return this.db.run(ctx, async (trx) => {
      const { rows, weather, irrigation, humus } = await this.load(trx, seasonId);
      const day = today();
      return rows.flatMap((r) => {
        if (!r.cycle_id) return [];
        const w = weather.get(`${r.lat}:${r.lng}`)!;
        const events = irrigation.get(r.cycle_id) ?? [];
        const base = { fieldId: r.field_id, cropCycleId: r.cycle_id, events: events.map((e) => ({ operationId: e.operationId, date: e.date, mm: e.quantityMm, method: (e.actionFqn as IrrigationMethod | null) ?? null, status: e.status })) };
        if (!Object.keys(w.daily).length) {
          const crop = getRootDepth(modelCrop(r.crop_code));
          return [{ ...base, ...emptySummary(r, crop), days: [] }];
        }
        const { summary, days } = this.water(r, w, events, humus.get(r.field_id) ?? null, day);
        return [{ ...base, ...summary, days }];
      });
    });
  }

  /**
   * The crop's ESM phenology with the farmer's observations (reference BBCH dialog): calibrated and
   * raw model stages, vernalization, photoperiod and temperature from sowing to seven days ahead.
   * Sowing as in the crop-table conditions: completed sowing, else the planned date, else the crop
   * calendar's typical day. Observations are entered through `bbch-observations`.
   */
  phenology(ctx: Ctx, cropCycleId: string): Promise<CropPhenology> {
    return this.db.run(ctx, async (trx) => {
      const { r, w, calibrations } = await this.cycle(trx, cropCycleId);
      const day = today();
      const crop = modelCrop(r.crop_code);
      const params = crop ? CROP_PARAMS[crop] : undefined;
      const sowingDate = r.completed_sowing ?? r.planned_sowing ?? (crop ? getDefaultSowingDate(crop, r.harvest_year) : null);
      const run = runBbchModel({ weather: w.daily, crop, latitude: r.latitude, sowingDate, today: day });
      const snap = run && crop ? calibrateBbch(run, crop, calibrations, day) : null;
      const { gs, ...temps } = params ?? ({} as NonNullable<typeof params>);
      return {
        cropCycleId,
        cropName: r.crop_name ?? '',
        supported: !!params,
        sowingDate,
        sowingSource: r.completed_sowing ? 'booked' : r.planned_sowing ? 'planned' : sowingDate ? 'calendar' : null,
        currentBbch: snap?.currentBbch ?? null,
        modelBbch: snap?.modelBbch ?? null,
        bbchOffset: snap?.bbchOffset ?? null,
        days: run && snap ? run.dates.map((d, i) => ({ date: d, bbch: snap.bbchByDate[d], modelBbch: run.bbch[i], vernalization: run.vernalization[i], photoperiod: run.photoperiod[i], tempMean: run.tempMean[i] })) : [],
        observations: calibrations.map((c) => ({ observedOn: c.observedOn, observedBbch: c.observedBbch, modelBbch: c.modelBbch, bdOffset: c.bdOffset })),
        params: params ? (temps as Record<string, number>) : null,
        stageDurations: params ? { ...gs } : null,
      };
    });
  }

  /** Sets or clears (null) the rooting depth of several crop cycles. */
  setRootDepths(ctx: Ctx, input: RootDepthInput): Promise<void> {
    return this.db.run(ctx, async (trx) => {
      for (const u of input.updates) {
        const res = await trx.updateTable('crop_cycles').set({ root_depth_m: u.rootDepthM }).where('id', '=', u.cropCycleId).executeTakeFirst();
        if (!Number(res.numUpdatedRows)) throw notFound('Crop cycle');
      }
    });
  }

  // ---------------------------------------------------------------------------

  private water(r: Row, w: Weather, events: IrrigationTransaction[], humusPct: number | null, day: string): { summary: WaterBalanceSummary; days: CycleWaterBalance['days'] } {
    const texture = r.soil_texture ? { ...TEXTURE_OF_CLASS[r.soil_texture as SoilTexture], soc: humusPct != null ? humusPct / 1.72 : null, bd: null } : null;
    const harvestYear = r.harvest_year;
    const res = computeFieldWaterBalance({
      cropCode: r.crop_code,
      latitude: r.latitude,
      year: harvestYear,
      sowingDate: r.sowing_date,
      weather: w.daily,
      fieldTexture: texture,
      transactions: events,
      rootDepthOverrideM: r.root_depth_m,
      today: day,
    }).rootZone;
    const fcMm = res.thetaFc != null ? thetaToMm(res.thetaFc, res.rootDepthM) : null;
    const pwpMm = res.thetaPwp != null ? thetaToMm(res.thetaPwp, res.rootDepthM) : null;
    return {
      summary: {
        soilTypeKa5: res.soilTypeKa5,
        thetaFc: res.thetaFc,
        thetaPwp: res.thetaPwp,
        fcMm,
        pwpMm,
        awcMm: res.awcMm,
        rootDepthM: res.rootDepthM,
        rootDepthOverrideM: r.root_depth_m,
        cropRootDepthM: getRootDepth(modelCrop(r.crop_code)),
        currentDeficitMm: res.currentDeficit,
        deficitLevel: res.deficitLevel,
        fillPct: fillRatioPct(res.awcMm, res.currentDeficit),
        totalPrecipitationMm: res.totalPrecipitation,
        totalEtaMm: res.totalEta,
        totalIrrigationMm: res.totalIrrigated,
        simulationStartDate: res.startDate,
        sowingDate: r.sowing_date,
        recommendation: res.recommendation as unknown as Record<string, unknown>,
      },
      days: (res.days ?? []).map((d) => ({
        date: d.date,
        swcMm: d.swc,
        precipitationMm: d.precipitation,
        irrigationMm: d.irrigation,
        etaMm: d.eta,
        drainageMm: d.drainage,
        deficitMm: d.deficit,
        forecast: !!d.forecast,
      })),
    };
  }

  private async load(trx: Trx, seasonId: string, cropCycleId: string | null = null) {
    const season = await trx.selectFrom('growing_seasons').select(['id', 'harvest_year']).where('id', '=', seasonId).executeTakeFirst();
    if (!season) throw notFound('Season');
    const { rows } = await sql<Row>`
      SELECT f.id AS field_id, f.soil_texture, ST_Y(ST_PointOnSurface(g.geometry)) AS latitude, c.lat, c.lng,
             wc.timezone, wc.utc_offset_seconds, cc.id AS cycle_id, cr.code AS crop_code,
             coalesce(cr.name_de, cr.name) AS crop_name, ${season.harvest_year}::int AS harvest_year,
             coalesce(
               (SELECT min(coalesce((o.performed_at AT TIME ZONE 'Europe/Berlin')::date, o.planned_on))::text
                  FROM operations o JOIN operation_fields ofl ON ofl.operation_id = o.id
                 WHERE ofl.crop_cycle_id = cc.id AND o.type = 'sowing' AND o.status <> 'canceled'),
               cc.sowing_date::text) AS sowing_date,
             (SELECT min((o.performed_at AT TIME ZONE 'Europe/Berlin')::date)::text
                FROM operations o JOIN operation_fields ofl ON ofl.operation_id = o.id
               WHERE ofl.crop_cycle_id = cc.id AND o.type = 'sowing' AND o.status = 'completed') AS completed_sowing,
             cc.sowing_date::text AS planned_sowing,
             cc.root_depth_m::float8 AS root_depth_m
      FROM fields f
      JOIN field_current_geometry g ON g.field_id = f.id
      CROSS JOIN LATERAL app.weather_cell(ST_PointOnSurface(g.geometry)) c
      LEFT JOIN weather_cells wc ON wc.lat = c.lat AND wc.lng = c.lng
      JOIN crop_cycles cc ON cc.field_id = f.id AND cc.season_id = ${seasonId} AND cc.role = 'main'
      JOIN crops cr ON cr.id = cc.crop_id
      WHERE f.status = 'active' AND (${cropCycleId}::uuid IS NULL OR cc.id = ${cropCycleId}::uuid)
      ORDER BY f.name, cc.created_at`.execute(trx);

    // Weather once per cell, from the December before the previous season (water balance and
    // autumn sowings).
    const from = addDays(`${season.harvest_year - 1}-12-01`, -365);
    const weather = new Map<string, Weather>();
    for (const r of rows) {
      const key = `${r.lat}:${r.lng}`;
      if (!weather.has(key)) weather.set(key, await cellWeather(trx, { lat: Number(r.lat), lng: Number(r.lng), timezone: r.timezone, utcOffsetSeconds: r.utc_offset_seconds }, from));
    }
    const cycleIds = rows.map((r) => r.cycle_id);
    const fieldIds = [...new Set(rows.map((r) => r.field_id))];
    const [cal, irr, hum] = await Promise.all([
      cycleIds.length
        ? trx.selectFrom('crop_cycle_bbch_calibrations').selectAll().where('crop_cycle_id', 'in', cycleIds).orderBy('observed_on', 'desc').orderBy('created_at', 'desc').execute()
        : [],
      cycleIds.length ? irrigationEvents(trx, cycleIds) : new Map<string, IrrigationTransaction[]>(),
      fieldIds.length
        ? trx.selectFrom('soil_samples').select(['field_id', 'humus_pct']).where('field_id', 'in', fieldIds).where('humus_pct', 'is not', null).orderBy('sampled_on', 'desc').execute()
        : [],
    ]);
    const calibrations = new Map<string, Calibration[]>();
    for (const c of cal) calibrations.set(c.crop_cycle_id, [...(calibrations.get(c.crop_cycle_id) ?? []), toCalibration(c)]);
    const humus = new Map<string, number>();
    for (const h of hum) if (!humus.has(h.field_id) && h.humus_pct != null) humus.set(h.field_id, h.humus_pct);
    return { rows, weather, calibrations, irrigation: irr, humus };
  }

  private async cycle(trx: Trx, cropCycleId: string) {
    const cc = await trx.selectFrom('crop_cycles').select(['season_id']).where('id', '=', cropCycleId).executeTakeFirst();
    if (!cc) throw notFound('Crop cycle');
    const { rows, weather, calibrations } = await this.load(trx, cc.season_id, cropCycleId);
    const r = rows.find((x) => x.cycle_id === cropCycleId);
    if (!r) throw badRequest('not_a_main_crop', 'Phenology is modelled for main crops only');
    return { r, w: weather.get(`${r.lat}:${r.lng}`)!, calibrations: calibrations.get(cropCycleId) ?? [] };
  }
}

interface Calibration {
  observedOn: string;
  observedBbch: number;
  modelBbch: number | null;
  bdOffset: number;
}

const toCalibration = (c: { observed_on: string; observed_bbch: number; model_bbch: number | null; bd_offset: number }): Calibration => ({
  observedOn: c.observed_on,
  observedBbch: c.observed_bbch,
  modelBbch: c.model_bbch,
  bdOffset: c.bd_offset,
});

function emptySummary(r: Row, cropRootDepthM: number): WaterBalanceSummary {
  return {
    soilTypeKa5: null,
    thetaFc: null,
    thetaPwp: null,
    fcMm: null,
    pwpMm: null,
    awcMm: null,
    rootDepthM: r.root_depth_m ?? cropRootDepthM,
    rootDepthOverrideM: r.root_depth_m,
    cropRootDepthM,
    currentDeficitMm: null,
    deficitLevel: null,
    fillPct: null,
    totalPrecipitationMm: 0,
    totalEtaMm: 0,
    totalIrrigationMm: 0,
    simulationStartDate: `${r.harvest_year - 1}-12-01`,
    sowingDate: r.sowing_date,
    recommendation: {},
  };
}

/**
 * Irrigation operations of the crop cycles that are not canceled, planned ones included as in the
 * reference: date = performed day, else the planned day; amount = `details.waterMm`.
 */
async function irrigationEvents(trx: Trx, cycleIds: string[]): Promise<Map<string, IrrigationTransaction[]>> {
  const { rows } = await sql<{ crop_cycle_id: string; id: string; date: string | null; mm: number | null; method: string | null; status: string }>`
    SELECT DISTINCT ON (ofl.crop_cycle_id, o.id) ofl.crop_cycle_id, o.id,
           coalesce((o.performed_at AT TIME ZONE 'Europe/Berlin')::date, o.planned_on)::text AS date,
           (o.details ->> 'waterMm')::float8 AS mm, o.details ->> 'method' AS method, o.status
    FROM operations o JOIN operation_fields ofl ON ofl.operation_id = o.id
    WHERE o.type = 'irrigation' AND o.status <> 'canceled' AND ofl.crop_cycle_id = ANY(${cycleIds}::uuid[])`.execute(trx);
  const out = new Map<string, IrrigationTransaction[]>();
  for (const r of rows) {
    if (!r.date) continue;
    const list = out.get(r.crop_cycle_id) ?? [];
    list.push({ id: r.id, operationId: r.id, date: r.date, quantityMm: r.mm ?? 0, actionFqn: r.method, status: r.status });
    out.set(r.crop_cycle_id, list);
  }
  for (const list of out.values()) list.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}
