/**
 * Conditions of every crop cycle of a season at once, for the crop tables (reference
 * `getOrgCultivationTimeseries`, `getCultivationsBbchSnapshotBatch` and
 * `getFieldsIrrigationDataForOrg`): sowing and spraying traffic lights, the ISIP disease risk,
 * the calibrated BBCH, and the FAO-56 root-zone balance with the season's irrigation.
 * Computed per request from the stored weather, loaded once per weather cell.
 */
import { Injectable } from '@nestjs/common';
import type {
  BbchCalibrationInput,
  BbchSnapshot,
  ConditionDay,
  CropPhenology,
  CycleWaterBalance,
  DiseaseKey,
  IrrigationMethod,
  RootDepthInput,
  SeasonFieldConditions,
  SoilTexture,
  WaterBalanceSummary,
} from '@agmeo/contracts';
import { sql } from 'kysely';
import type { Ctx } from '../../auth/context.js';
import { record } from '../../core/events.js';
import { badRequest, notFound } from '../../core/errors.js';
import { Database, type Trx } from '../../db/database.js';
import { modelCrop } from '../../models/crops.js';
import { CROP_DISEASES, type DiseaseTimeseries } from '../../models/disease/diseaseRisk.js';
import { computeDiseaseRisk, computeFieldConditionBars, computeFieldWaterBalance } from '../../models/index.js';
import type { IrrigationTransaction } from '../../models/irrigation/data.js';
import { fillRatioPct, getRootDepth, thetaToMm } from '../../models/irrigation/waterBalance.js';
import { CROP_PARAMS } from '../../models/phenology/bbchModel.js';
import { calibrateBbch, calibrationAnchor, runBbchModel, type BbchModelRun } from '../../models/phenology/bbchSnapshot.js';
import { isipCropOfCode } from '../model-services/disease.js';
import { TEXTURE_OF_CLASS, cellWeather } from './cell-weather.js';

const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const today = () => new Date().toISOString().slice(0, 10);
const toReasons = (rs: { key: string; value: number; dimension?: string }[] | undefined) =>
  (rs ?? []).map((r) => ({ key: r.key, value: r.value ?? null, dimension: r.dimension ?? null }));

interface Row {
  field_id: string;
  soil_texture: string | null;
  latitude: number;
  lat: string;
  lng: string;
  timezone: string | null;
  utc_offset_seconds: number | null;
  cycle_id: string | null;
  crop_code: string | null;
  crop_name: string | null;
  harvest_year: number;
  sowing_date: string | null;
  root_depth_m: number | null;
}

type Weather = Awaited<ReturnType<typeof cellWeather>>;

@Injectable()
export class SeasonConditionsService {
  constructor(private readonly db: Database) {}

  /** One entry per main crop cycle of the season, and one per active field without a crop. */
  season(ctx: Ctx, seasonId: string): Promise<SeasonFieldConditions[]> {
    return this.db.run(ctx, async (trx) => {
      const { rows, weather, calibrations, irrigation, humus } = await this.load(trx, seasonId);
      const disease = await this.disease(trx, rows);
      const day = today();
      return rows.map((r) => {
        const w = weather.get(`${r.lat}:${r.lng}`)!;
        const hasWeather = Object.keys(w.daily).length > 0;
        const bars = hasWeather
          ? computeFieldConditionBars({ cropCode: r.crop_code, weather: w.daily, weatherHourly: w.hourly ?? undefined, soilTexture: r.soil_texture as SoilTexture | null, sowingDate: r.sowing_date })
          : null;
        const run = r.cycle_id ? this.bbchRun(r, w, day) : null;
        return {
          fieldId: r.field_id,
          cropCycleId: r.cycle_id,
          refreshedAt: w.refreshedAt,
          sowing: (bars?.sowing ?? []).map((d) => ({ date: d.date, value: d.value, reasons: toReasons(d.reasons) })),
          spraying: (bars?.spraying ?? []).map((d) => ({ date: d.date, value: d.value, reasons: toReasons(d.reasons) })),
          disease: r.cycle_id ? (disease.get(r.cycle_id) ?? null) : null,
          bbch: run && r.cycle_id ? snapshot(run, r, calibrations.get(r.cycle_id) ?? [], day) : null,
          water: r.cycle_id && hasWeather ? this.water(r, w, irrigation.get(r.cycle_id) ?? [], humus.get(r.field_id) ?? null, day).summary : null,
        };
      });
    });
  }

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

  /** The cycle's phenology with model details and calibration history (reference BBCH dialog). */
  phenology(ctx: Ctx, cropCycleId: string): Promise<CropPhenology> {
    return this.db.run(ctx, async (trx) => {
      const { r, w, calibrations } = await this.cycle(trx, cropCycleId);
      const day = today();
      const crop = modelCrop(r.crop_code);
      const params = crop ? CROP_PARAMS[crop] : undefined;
      const run = this.bbchRun(r, w, day);
      const snap = run ? snapshot(run, r, calibrations, day) : null;
      const { gs, ...temps } = params ?? ({} as NonNullable<typeof params>);
      return {
        cropCycleId,
        cropName: r.crop_name ?? '',
        supported: !!params,
        sowingDate: r.sowing_date,
        snapshot: snap,
        days: run ? run.dates.map((d, i) => ({ date: d, bbch: snap!.bbchByDate[d], modelBbch: run.bbch[i], vernalization: run.vernalization[i], photoperiod: run.photoperiod[i], tempMean: run.tempMean[i] })) : [],
        calibrations: calibrations.map((c) => ({ observedOn: c.observedOn, observedBbch: c.observedBbch, modelBbch: c.modelBbch, bdOffset: c.bdOffset })),
        params: params ? (temps as Record<string, number>) : null,
        stageDurations: params ? { ...gs } : null,
      };
    });
  }

  /** Stores an observed BBCH stage as a calibration anchor; one per crop cycle and day. */
  calibrate(ctx: Ctx, cropCycleId: string, input: BbchCalibrationInput): Promise<CropPhenology> {
    return this.db
      .run(ctx, async (trx) => {
        const { r, w } = await this.cycle(trx, cropCycleId);
        const crop = modelCrop(r.crop_code);
        const anchor = calibrationAnchor(this.bbchRun(r, w, today()), crop, input.observedOn, input.observedBbch);
        if (typeof anchor === 'string') throw badRequest(anchor.toLowerCase(), CALIBRATION_ERRORS[anchor]);
        await trx.deleteFrom('crop_cycle_bbch_calibrations').where('crop_cycle_id', '=', cropCycleId).where('observed_on', '=', input.observedOn).execute();
        await trx
          .insertInto('crop_cycle_bbch_calibrations')
          .values({ organization_id: ctx.orgId, crop_cycle_id: cropCycleId, observed_on: input.observedOn, observed_bbch: input.observedBbch, model_bbch: anchor.modelBbch, bd_offset: anchor.bdOffset, created_by: ctx.userId || null })
          .execute();
        await record(trx, ctx, { entityType: 'crop_cycle', entityId: cropCycleId, action: 'bbch_calibrated', changes: { observedOn: input.observedOn, observedBbch: input.observedBbch } });
      })
      .then(() => this.phenology(ctx, cropCycleId));
  }

  removeCalibration(ctx: Ctx, cropCycleId: string, observedOn: string): Promise<CropPhenology> {
    return this.db
      .run(ctx, async (trx) => {
        const res = await trx.deleteFrom('crop_cycle_bbch_calibrations').where('crop_cycle_id', '=', cropCycleId).where('observed_on', '=', observedOn).executeTakeFirst();
        if (!Number(res.numDeletedRows)) throw notFound('Calibration');
      })
      .then(() => this.phenology(ctx, cropCycleId));
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

  private bbchRun(r: Row, w: Weather, day: string): BbchModelRun | null {
    return runBbchModel({ weather: w.daily, crop: modelCrop(r.crop_code), latitude: r.latitude, sowingDate: r.sowing_date, today: day });
  }

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

  /** Worst ISIP level per day over the crop's diseases, the last 14 days with data. */
  private async disease(trx: Trx, rows: Row[]): Promise<Map<string, ConditionDay[] | null>> {
    const out = new Map<string, ConditionDay[] | null>();
    const supported = rows.filter((r) => r.cycle_id && isipCropOfCode(r.crop_code));
    for (const r of rows) if (r.cycle_id) out.set(r.cycle_id, null);
    if (!supported.length) return out;
    const days = await trx
      .selectFrom('disease_risk_days')
      .select(['crop_cycle_id', 'date', 'disease', 'level'])
      .where(
        'crop_cycle_id',
        'in',
        supported.map((r) => r.cycle_id!),
      )
      .orderBy('date')
      .execute();
    const byCycle = new Map<string, DiseaseTimeseries>();
    for (const d of days) {
      const series = byCycle.get(d.crop_cycle_id) ?? {};
      (series[d.date] ??= {})[d.disease as DiseaseKey] = d.level as 0 | 1 | 2 | 3;
      byCycle.set(d.crop_cycle_id, series);
    }
    for (const r of supported) {
      const series = byCycle.get(r.cycle_id!) ?? {};
      const keys = CROP_DISEASES[isipCropOfCode(r.crop_code)!] as DiseaseKey[];
      const worst = (computeDiseaseRisk(series, r.crop_code) ?? []).slice(-14);
      out.set(
        r.cycle_id!,
        worst.map((d) => ({
          date: d.date,
          value: d.value,
          reasons: keys.filter((k) => (series[d.date]?.[k] ?? 0) > 0).map((k) => ({ key: `reason.disease.${k}`, value: series[d.date]![k]!, dimension: null })),
        })),
      );
    }
    return out;
  }

  private async load(trx: Trx, seasonId: string) {
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
             cc.root_depth_m::float8 AS root_depth_m
      FROM fields f
      JOIN field_current_geometry g ON g.field_id = f.id
      CROSS JOIN LATERAL app.weather_cell(ST_PointOnSurface(g.geometry)) c
      LEFT JOIN weather_cells wc ON wc.lat = c.lat AND wc.lng = c.lng
      LEFT JOIN crop_cycles cc ON cc.field_id = f.id AND cc.season_id = ${seasonId} AND cc.role = 'main'
      LEFT JOIN crops cr ON cr.id = cc.crop_id
      WHERE f.status = 'active' OR cc.id IS NOT NULL
      ORDER BY f.name, cc.created_at`.execute(trx);

    // Weather once per cell, from the December before the previous season (water balance and
    // autumn sowings).
    const from = addDays(`${season.harvest_year - 1}-12-01`, -365);
    const weather = new Map<string, Weather>();
    for (const r of rows) {
      const key = `${r.lat}:${r.lng}`;
      if (!weather.has(key)) weather.set(key, await cellWeather(trx, { lat: Number(r.lat), lng: Number(r.lng), timezone: r.timezone, utcOffsetSeconds: r.utc_offset_seconds }, from));
    }
    const cycleIds = rows.flatMap((r) => (r.cycle_id ? [r.cycle_id] : []));
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
    const { rows, weather, calibrations } = await this.load(trx, cc.season_id);
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

const CALIBRATION_ERRORS = {
  UNSUPPORTED_CROP: 'The phenology model has no parameters for this crop',
  MODEL_UNAVAILABLE: 'No model run: the crop needs a sowing date and stored weather since sowing',
  DATE_OUT_OF_RANGE: 'The date lies outside the modelled days (sowing to seven days ahead)',
} as const;

function snapshot(run: BbchModelRun, r: Row, calibrations: Calibration[], day: string): BbchSnapshot {
  const s = calibrateBbch(run, modelCrop(r.crop_code)!, calibrations, day);
  return {
    sowingDate: s.sowingDate,
    currentBbch: s.currentBbch,
    modelBbch: s.modelBbch,
    bbchOffset: s.bbchOffset,
    calibrationDate: calibrations[0]?.observedOn ?? null,
    calibrationBbch: calibrations[0]?.observedBbch ?? null,
    calibrationDates: calibrations.map((c) => c.observedOn),
    bbchByDate: s.bbchByDate,
  };
}

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
