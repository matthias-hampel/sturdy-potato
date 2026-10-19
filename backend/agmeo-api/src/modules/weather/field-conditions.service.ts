/**
 * Field conditions from the stored weather and the ported models (src/models): the four condition
 * bars, hourly spray levels, GDD/BBCH since sowing, the FAO-56 water balance with the irrigation
 * recommendation, and trafficability for a machine — what the reference's cultivation timeseries,
 * irrigation and trafficability actions combine per field.
 */
import { Injectable } from '@nestjs/common';
import type { BbchObservationInput, ConditionDay, CropTableConditions, CropTableConditionsRow, DiseaseKey, FieldConditions, FieldDiseaseRisk, FieldTrafficability, SoilTexture } from '@agmeo/contracts';
import { sql } from 'kysely';
import type { Ctx } from '../../auth/context.js';
import type { Out } from '../../core/validation.js';
import { badRequest, notFound } from '../../core/errors.js';
import { Database, type Trx } from '../../db/database.js';
import { CROP_DISEASES, type DiseaseTimeseries } from '../../models/disease/diseaseRisk.js';
import { bbchCalibratable, bbchCalibration, type BbchCalibrationAnchor, computeDiseaseRisk, computeFieldConditionBars, computeFieldWaterBalance, computePhenology } from '../../models/index.js';
import { IsipClient, isipCropOfCode } from '../model-services/disease.js';
import { evaluateFieldsForMachine } from '../../models/trafficability/index.js';
import { projectFieldTrafficability } from '../../models/trafficability/rows.js';
import type { SlimWeatherTimeseries, WeatherDay, WeatherHourlyTimeseries } from '../../models/types.js';
import { computeHourlySpray, computePrecipitationStats } from '../../models/weather/conditions.js';
import { hourlyInstantsMs } from '../../models/weather/hourlyWindow.js';

/**
 * Representative topsoil fractions (%) of the LUFA soil classes, for fields without a measured
 * texture: mid-points of the matching KA5 Bodenarten.
 */
const TEXTURE_OF_CLASS: Record<SoilTexture, { clay: number; silt: number; sand: number }> = {
  S: { clay: 3, silt: 7, sand: 90 },
  lS: { clay: 8, silt: 22, sand: 70 },
  sU: { clay: 5, silt: 60, sand: 35 },
  ssL: { clay: 12, silt: 25, sand: 63 },
  lU: { clay: 12, silt: 70, sand: 18 },
  sL: { clay: 20, silt: 35, sand: 45 },
  uL: { clay: 20, silt: 60, sand: 20 },
  L: { clay: 25, silt: 40, sand: 35 },
  utL: { clay: 33, silt: 55, sand: 12 },
  tL: { clay: 40, silt: 35, sand: 25 },
  T: { clay: 55, silt: 30, sand: 15 },
};

/** The weather grid cell of a field (stored weather is kept per cell). */
interface Cell {
  lat: number;
  lng: number;
  timezone: string | null;
  utcOffsetSeconds: number | null;
}

interface Context extends Cell {
  fieldId: string;
  latitude: number;
  soilTexture: SoilTexture | null;
  humusPct: number | null;
  cycle: { id: string; cropCode: string | null; cropName: string; harvestYear: number; sowingDate: string | null; sowingSource: 'booked' | 'planned' | null } | null;
}

const toReasons = (rs: { key: string; value: number; dimension?: string }[] | undefined) =>
  (rs ?? []).map((r) => ({ key: r.key, value: r.value ?? null, dimension: r.dimension ?? null }));

const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

const cellKey = (r: { lat: string | number; lng: string | number }) => `${Number(r.lat)},${Number(r.lng)}`;

interface CalibrationRow extends BbchCalibrationAnchor {
  observedOn: string;
}

/**
 * The worst ISIP risk of the crop on its last 14 days with data (the table's disease bar runs
 * up to the last simulated day), the diseases at risk as reasons.
 */
function trailingDisease(series: DiseaseTimeseries | undefined, cropCode: string | null): ConditionDay[] | null {
  const isipCrop = isipCropOfCode(cropCode);
  if (!isipCrop || !series) return null;
  const keys = CROP_DISEASES[isipCrop] as DiseaseKey[];
  const worst = computeDiseaseRisk(series, cropCode) ?? [];
  return worst.slice(-14).map((d) => ({
    date: d.date,
    value: d.value as ConditionDay['value'],
    reasons: keys.filter((k) => (series[d.date]?.[k] ?? 0) > 0).map((k) => ({ key: `reason.disease.${k}`, value: series[d.date]![k]!, dimension: null })),
  }));
}

@Injectable()
export class FieldConditionsService {
  /** Only asked whether ISIP is configured; the worker fetches the disease risk. */
  private readonly isip = new IsipClient();

  constructor(private readonly db: Database) {}

  conditions(ctx: Ctx, fieldId: string): Promise<FieldConditions> {
    return this.db.run(ctx, async (trx) => {
      const c = await this.context(trx, fieldId);
      const today = new Date().toISOString().slice(0, 10);
      const harvestYear = c.cycle?.harvestYear ?? Number(today.slice(0, 4));
      const { daily, hourly, refreshedAt } = await this.weather(trx, c, addDays(`${harvestYear - 1}-12-01`, -365));
      const calibrations = c.cycle ? await this.calibrations(trx, [c.cycle.id]) : new Map<string, CalibrationRow[]>();
      const { water, bars, phen } = this.model(c, daily, hourly, today, calibrations.get(c.cycle?.id ?? '') ?? []);

      // Hourly spray levels for the next 48 hours.
      const sprayHours: FieldConditions['sprayHours'] = [];
      if (hourly) {
        const instants = hourlyInstantsMs(hourly);
        const from = Date.now() - 3_600_000;
        for (let i = 0; i < hourly.time.length && sprayHours.length < 48; i++) {
          if (instants[i] < from) continue;
          const s = computeHourlySpray(hourly, i);
          sprayHours.push({ time: new Date(instants[i]).toISOString(), level: s.level, reasons: toReasons(s.reasons) });
        }
      }

      const disease = await this.diseaseRisk(trx, c, bars.spraying.map((d) => d.date));
      const rz = water?.rootZone;
      return {
        fieldId,
        refreshedAt,
        cropCycle: c.cycle ? { id: c.cycle.id, cropName: c.cycle.cropName, sowingDate: c.cycle.sowingDate, sowingSource: c.cycle.sowingSource } : null,
        soil: { texture: c.soilTexture, textureSource: c.soilTexture ? 'soil_class' : null },
        bars: {
          spraying: bars.spraying.map((d) => ({ date: d.date, value: d.value, reasons: toReasons(d.reasons) })),
          sowing: bars.sowing.map((d) => ({ date: d.date, value: d.value, reasons: toReasons(d.reasons) })),
          weatherRisk: bars.weatherRisk.map((d) => ({ date: d.date, value: d.value, reasons: toReasons(d.reasons) })),
          trafficability: bars.trafficability?.map((d) => ({ date: d.date, value: d.value, reasons: toReasons(d.reasons) })) ?? null,
          disease: disease.bar,
        },
        disease: disease.risk,
        sprayHours,
        phenology: phen
          ? { sowingDate: phen.sowingDate, gdd: phen.gdd, currentBbch: phen.currentBbch, bbchSource: phen.bbchSource, calibrated: phen.calibrated, bbchByDate: phen.dailyBbch ? Object.fromEntries(phen.dailyBbch) : null }
          : null,
        waterBalance: rz
          ? {
              soilTypeKa5: rz.soilTypeKa5,
              awcMm: rz.awcMm,
              rootDepthM: rz.rootDepthM,
              currentDeficitMm: rz.currentDeficit,
              deficitLevel: rz.deficitLevel,
              totalPrecipitationMm: rz.totalPrecipitation,
              totalEtaMm: rz.totalEta,
              recommendation: rz.recommendation as unknown as Record<string, unknown>,
              days: (rz.days ?? []).map((d) => ({ date: d.date, swcMm: d.swc, deficitMm: d.deficit, etaMm: d.eta, precipitationMm: d.precipitation, forecast: !!d.forecast })),
            }
          : null,
      };
    });
  }

  /**
   * The table values of every crop of a season in one pass: stored weather is loaded once per
   * grid cell, satellite values, disease risk and BBCH observations once for all crops.
   */
  seasonTable(ctx: Ctx, seasonId: string): Promise<CropTableConditions> {
    return this.db.run(ctx, async (trx) => {
      const season = await trx.selectFrom('growing_seasons').select(['id', 'harvest_year', 'start_date']).where('id', '=', seasonId).executeTakeFirst();
      if (!season) throw notFound('Season');
      const cycles = await this.cycleRows(trx, { seasonId });
      const today = new Date().toISOString().slice(0, 10);
      const ids = cycles.map((r) => r.id);
      const fieldIds = [...new Set(cycles.map((r) => r.field_id))];

      // Stored weather per grid cell, shared by the fields in it.
      const cells = new Map<string, Cell>();
      for (const r of cycles) cells.set(cellKey(r), { lat: Number(r.lat), lng: Number(r.lng), timezone: r.timezone, utcOffsetSeconds: r.utc_offset_seconds });
      const from = addDays(`${season.harvest_year - 1}-12-01`, -365);
      const weatherOf = new Map<string, Awaited<ReturnType<FieldConditionsService['weather']>>>();
      for (const [key, cell] of cells) weatherOf.set(key, await this.weather(trx, cell, from));

      const [diseaseRows, calibrations, satellite] = await Promise.all([
        ids.length
          ? trx.selectFrom('disease_risk_days').select(['crop_cycle_id', 'date', 'disease', 'level']).where('crop_cycle_id', 'in', ids).orderBy('date').execute()
          : Promise.resolve([]),
        this.calibrations(trx, ids),
        fieldIds.length
          ? sql<{ field_id: string; index_type: string; observed_on: string; mean: number }>`
              SELECT DISTINCT ON (field_id, index_type) field_id, index_type, observed_on::text AS observed_on, mean::float8 AS mean
              FROM field_observations
              WHERE field_id = ANY(${fieldIds}::uuid[]) AND index_type IN ('ndvi', 'lai') AND status = 'valid' AND mean IS NOT NULL
              ORDER BY field_id, index_type, observed_on DESC, valid_pixel_pct DESC`.execute(trx).then((r) => r.rows)
          : Promise.resolve([]),
      ]);
      const diseaseOf = new Map<string, DiseaseTimeseries>();
      for (const r of diseaseRows) {
        const series = diseaseOf.get(r.crop_cycle_id) ?? {};
        (series[r.date] ??= {})[r.disease as DiseaseKey] = r.level as 0 | 1 | 2 | 3;
        diseaseOf.set(r.crop_cycle_id, series);
      }
      const satelliteOf = (fieldId: string, index: 'ndvi' | 'lai') => {
        const o = satellite.find((x) => x.field_id === fieldId && x.index_type === index);
        return o ? { value: Math.round(o.mean * 1000) / 1000, observedOn: o.observed_on } : null;
      };

      const rows: CropTableConditionsRow[] = cycles.map((r) => {
        const sowingDate = r.booked ?? r.sowing_date;
        const own = calibrations.get(r.id) ?? [];
        const w = weatherOf.get(cellKey(r));
        const base: CropTableConditionsRow = {
          cropCycleId: r.id,
          fieldId: r.field_id,
          sowingDate,
          sowingSource: r.booked ? 'booked' : r.sowing_date ? 'planned' : null,
          gdd: null,
          bbch: null,
          bbchSource: null,
          bbchCalibrated: false,
          bbchCalibratable: bbchCalibratable(r.code),
          bbchObservedToday: own.find((x) => x.observedOn === today)?.observedBbch ?? null,
          ndvi: satelliteOf(r.field_id, 'ndvi'),
          lai: satelliteOf(r.field_id, 'lai'),
          precipitation: { seasonMm: null, last24hMm: null, last7dMm: null, next24hMm: null, next7dMm: null },
          bars: { spraying: null, sowing: null, weatherRisk: null, trafficability: null, disease: trailingDisease(diseaseOf.get(r.id), r.code) },
        };
        if (!w || !Object.keys(w.daily).length) return base;
        const c = {
          latitude: r.latitude,
          soilTexture: r.soil_texture as SoilTexture | null,
          humusPct: r.humus_pct,
          cycle: { cropCode: r.code, harvestYear: season.harvest_year, sowingDate },
        };
        const { bars, phen } = this.model(c, w.daily, w.hourly, today, own);
        const precip = computePrecipitationStats(w.daily, w.hourly ?? undefined, new Date(`${season.start_date}T00:00:00Z`), sowingDate);
        const day = (d: { date: string; value: number | null; reasons?: { key: string; value: number; dimension?: string }[] }): ConditionDay => ({ date: d.date, value: d.value as ConditionDay['value'], reasons: toReasons(d.reasons) });
        return {
          ...base,
          // Since a known sowing only (the reference's column), not from the crop calendar's typical date.
          gdd: sowingDate && sowingDate <= today && phen?.gdd != null ? Math.round(phen.gdd) : null,
          bbch: phen?.currentBbch ?? null,
          bbchSource: phen?.bbchSource ?? null,
          bbchCalibrated: phen?.calibrated ?? false,
          precipitation: {
            // Since sowing only: before it, the sum says little about the crop.
            seasonMm: sowingDate ? precip.season : null,
            last24hMm: precip.last24h,
            last7dMm: precip.last7d,
            next24hMm: precip.upcoming24h,
            next7dMm: precip.upcoming7d,
          },
          bars: {
            ...base.bars,
            spraying: bars.spraying.map(day),
            sowing: bars.sowing.map(day),
            weatherRisk: bars.weatherRisk.map(day),
            trafficability: bars.trafficability?.map(day) ?? null,
          },
        };
      });
      const refreshed = [...weatherOf.values()].map((w) => w.refreshedAt).filter((d): d is string => !!d).sort();
      return { seasonId, refreshedAt: refreshed[0] ?? null, rows };
    });
  }

  /**
   * Stores the BBCH stage the farmer saw on the field as an offset against the phenology model on
   * that day (one per crop and day); the crop's modelled stages follow it from then on.
   */
  observeBbch(ctx: Ctx, cropCycleId: string, input: Out<typeof BbchObservationInput>): Promise<void> {
    return this.db.run(ctx, async (trx) => {
      const [r] = await this.cycleRows(trx, { cropCycleId });
      if (!r) throw notFound('Crop');
      const today = new Date().toISOString().slice(0, 10);
      const date = input.date ?? today;
      if (date > today) throw badRequest('future_date', 'A BBCH stage can only be entered for today or earlier');
      const { daily } = await this.weather(trx, { lat: Number(r.lat), lng: Number(r.lng), timezone: r.timezone, utcOffsetSeconds: r.utc_offset_seconds }, addDays(`${r.harvest_year - 1}-12-01`, -365));
      const res = bbchCalibration({ cropCode: r.code, weather: daily, sowingDate: r.booked ?? r.sowing_date, harvestYear: r.harvest_year, latitude: r.latitude, date, observedBbch: input.bbch });
      if (!res.ok) {
        const messages = {
          unsupported_crop: 'The phenology model of this crop takes no BBCH observations',
          model_unavailable: 'There is not enough stored weather since sowing for the phenology model yet',
          date_out_of_range: 'The date lies before sowing or outside the stored weather',
        } as const;
        throw badRequest(res.reason, messages[res.reason]);
      }
      await trx
        .insertInto('crop_cycle_bbch_calibrations')
        .values({ organization_id: ctx.orgId, crop_cycle_id: cropCycleId, observed_on: date, observed_bbch: input.bbch, model_bbch: res.modelBbch, bd_offset: res.bdOffset, created_by: ctx.userId })
        .onConflict((oc) => oc.columns(['crop_cycle_id', 'observed_on']).doUpdateSet({ observed_bbch: input.bbch, model_bbch: res.modelBbch, bd_offset: res.bdOffset, created_by: ctx.userId, created_at: new Date() }))
        .execute();
    });
  }

  deleteBbchObservation(ctx: Ctx, cropCycleId: string, date: string): Promise<void> {
    return this.db.run(ctx, async (trx) => {
      const res = await trx.deleteFrom('crop_cycle_bbch_calibrations').where('crop_cycle_id', '=', cropCycleId).where('observed_on', '=', date).executeTakeFirst();
      if (!res.numDeletedRows) throw notFound('BBCH observation');
    });
  }

  /** Crops of a season (or one crop) with what their conditions need: crop, sowing, weather cell, soil. */
  private async cycleRows(trx: Trx, by: { seasonId: string } | { cropCycleId: string }) {
    const { rows } = await sql<{
      id: string; field_id: string; code: string | null; harvest_year: number; sowing_date: string | null; booked: string | null;
      lat: string; lng: string; latitude: number; soil_texture: string | null; timezone: string | null; utc_offset_seconds: number | null; humus_pct: number | null;
    }>`
      SELECT cc.id, cc.field_id, c.code, s.harvest_year, cc.sowing_date::text AS sowing_date,
             (SELECT min((o.performed_at AT TIME ZONE 'Europe/Berlin')::date)::text FROM operations o JOIN operation_fields ofl ON ofl.operation_id = o.id
               WHERE ofl.crop_cycle_id = cc.id AND o.type = 'sowing' AND o.status = 'completed') AS booked,
             wc.lat, wc.lng, ST_Y(p.pt) AS latitude, f.soil_texture, cell.timezone, cell.utc_offset_seconds,
             (SELECT ss.humus_pct FROM soil_samples ss WHERE ss.field_id = f.id AND ss.humus_pct IS NOT NULL ORDER BY ss.sampled_on DESC LIMIT 1) AS humus_pct
      FROM crop_cycles cc
      JOIN growing_seasons s ON s.id = cc.season_id
      JOIN crops c ON c.id = cc.crop_id
      JOIN fields f ON f.id = cc.field_id
      JOIN field_current_geometry g ON g.field_id = f.id
      CROSS JOIN LATERAL (SELECT ST_PointOnSurface(g.geometry) AS pt) p
      CROSS JOIN LATERAL app.weather_cell(p.pt) wc
      LEFT JOIN weather_cells cell ON cell.lat = wc.lat AND cell.lng = wc.lng
      WHERE f.status = 'active'
        AND ${'seasonId' in by ? sql`cc.season_id = ${by.seasonId}::uuid` : sql`cc.id = ${by.cropCycleId}::uuid`}`.execute(trx);
    return rows;
  }

  /** BBCH observations per crop, newest first. */
  private async calibrations(trx: Trx, cropCycleIds: string[]): Promise<Map<string, CalibrationRow[]>> {
    const out = new Map<string, CalibrationRow[]>();
    if (!cropCycleIds.length) return out;
    const rows = await trx
      .selectFrom('crop_cycle_bbch_calibrations')
      .select(['crop_cycle_id', 'observed_on', 'observed_bbch', 'bd_offset'])
      .where('crop_cycle_id', 'in', cropCycleIds)
      .orderBy('observed_on', 'desc')
      .execute();
    for (const r of rows) out.set(r.crop_cycle_id, [...(out.get(r.crop_cycle_id) ?? []), { observedOn: r.observed_on, observedBbch: r.observed_bbch, bdOffset: r.bd_offset }]);
    return out;
  }

  /** Water balance, condition bars and phenology of a crop at a place from its stored weather. */
  private model(
    c: { latitude: number; soilTexture: SoilTexture | null; humusPct: number | null; cycle: { cropCode: string | null; harvestYear: number; sowingDate: string | null } | null },
    daily: SlimWeatherTimeseries & Record<string, WeatherDay>,
    hourly: WeatherHourlyTimeseries | null,
    today: string,
    calibrations: BbchCalibrationAnchor[],
  ) {
    const harvestYear = c.cycle?.harvestYear ?? Number(today.slice(0, 4));
    const texture = c.soilTexture ? { ...TEXTURE_OF_CLASS[c.soilTexture], soc: c.humusPct != null ? c.humusPct / 1.72 : null, bd: null } : null;
    const waterInput = Object.fromEntries(
      Object.entries(daily).map(([d, w]) => [
        d,
        { tempMin: w.tempMin, tempMax: w.tempMax, tempMean: w.tempMean, precipitation: w.precipitation, et0: w.et0, windSpeedMean: w.windSpeedMean, humidityMean: w.humidityMean, dewPointMean: w.dewPointMean },
      ]),
    );
    const water = Object.keys(daily).length
      ? computeFieldWaterBalance({
          cropCode: c.cycle?.cropCode ?? null,
          latitude: c.latitude,
          year: harvestYear,
          sowingDate: c.cycle?.sowingDate ?? null,
          weather: waterInput,
          fieldTexture: texture,
          withTopsoilBalance: true,
          today,
        })
      : null;
    const bars = computeFieldConditionBars({
      cropCode: c.cycle?.cropCode ?? null,
      weather: daily,
      weatherHourly: hourly ?? undefined,
      soilTexture: c.soilTexture,
      sowingDate: c.cycle?.sowingDate ?? null,
      waterBalance: water?.rootZone.days ?? null,
      awcMm: water?.rootZone.awcMm ?? null,
    });
    const phen = c.cycle
      ? computePhenology({ cropCode: c.cycle.cropCode, weather: daily, sowingDate: c.cycle.sowingDate, harvestYear, latitude: c.latitude, today, calibrations })
      : null;
    return { water, bars, phen };
  }

  /**
   * The ISIP disease risk the worker stored for the crop: the worst level per day on the bar's
   * days (reasons: the diseases at risk), and per disease the last 14 days with data.
   */
  private async diseaseRisk(trx: Trx, c: Context, barDays: string[]): Promise<{ bar: ConditionDay[] | null; risk: FieldDiseaseRisk }> {
    const isipCrop = isipCropOfCode(c.cycle?.cropCode);
    const risk: FieldDiseaseRisk = { configured: this.isip.configured, supported: !!isipCrop, refreshedAt: null, diseases: [] };
    if (!c.cycle || !isipCrop) return { bar: null, risk };
    const [rows, state] = await Promise.all([
      trx.selectFrom('disease_risk_days').select(['date', 'disease', 'level']).where('crop_cycle_id', '=', c.cycle.id).orderBy('date').execute(),
      trx.selectFrom('disease_risk_state').select('refreshed_at').where('crop_cycle_id', '=', c.cycle.id).executeTakeFirst(),
    ]);
    risk.refreshedAt = state?.refreshed_at ? new Date(state.refreshed_at).toISOString() : null;
    const series: DiseaseTimeseries = {};
    for (const r of rows) (series[r.date] ??= {})[r.disease as DiseaseKey] = r.level as 0 | 1 | 2 | 3;
    const worst = new Map((computeDiseaseRisk(series, c.cycle.cropCode) ?? []).map((d) => [d.date, d.value]));
    const keys = CROP_DISEASES[isipCrop] as DiseaseKey[];
    const bar = barDays.map((date) => ({
      date,
      value: worst.get(date) ?? null,
      reasons: keys.filter((k) => (series[date]?.[k] ?? 0) > 0).map((k) => ({ key: `reason.disease.${k}`, value: series[date]![k]!, dimension: null })),
    }));
    const recent = Object.keys(series).slice(-14);
    risk.diseases = recent.length ? keys.map((key) => ({ key, days: recent.map((date) => ({ date, value: series[date]?.[key] ?? 0 })) })) : [];
    return { bar, risk };
  }

  /** Soil compaction index of a machine on the field, today and for the next seven days. */
  trafficability(ctx: Ctx, fieldId: string, opts: { equipmentId: string; frontKpa?: number; rearKpa?: number }): Promise<FieldTrafficability> {
    return this.db.run(ctx, async (trx) => {
      const c = await this.context(trx, fieldId);
      const machine = await trx.selectFrom('equipment').selectAll().where('id', '=', opts.equipmentId).executeTakeFirst();
      if (!machine) throw notFound('Machine');
      if (machine.class !== 'machine') throw badRequest('not_a_machine', 'Choose a machine, not an implement');
      if (!c.soilTexture) throw badRequest('no_soil_texture', 'Set the field’s soil class to compute trafficability');
      const today = new Date().toISOString().slice(0, 10);
      const harvestYear = c.cycle?.harvestYear ?? Number(today.slice(0, 4));
      const { daily } = await this.weather(trx, c, addDays(`${harvestYear - 1}-12-01`, -365));
      const water = computeFieldWaterBalance({
        cropCode: c.cycle?.cropCode ?? null,
        latitude: c.latitude,
        year: harvestYear,
        sowingDate: c.cycle?.sowingDate ?? null,
        weather: daily,
        fieldTexture: { ...TEXTURE_OF_CLASS[c.soilTexture], soc: c.humusPct != null ? c.humusPct / 1.72 : null, bd: null },
        withTopsoilBalance: true,
        today,
      });
      const delta = projectFieldTrafficability(water.topsoil?.days, water.topsoil?.soilTypeKa5 ?? null, today);
      if (!delta) throw badRequest('no_water_balance', 'Not enough stored weather for the soil water balance yet');
      const tyre = (t: unknown) => (t ? { widthM: (t as { widthM?: number }).widthM ?? null, recommendedPressureKpa: (t as { recommendedPressureKpa?: number }).recommendedPressureKpa ?? null } : null);
      const m = { operatingMassKg: machine.operating_mass_kg, frontAxleFraction: machine.front_axle_fraction, frontTyre: tyre(machine.front_tyre), rearTyre: tyre(machine.rear_tyre) };
      const frontKpa = opts.frontKpa ?? m.frontTyre?.recommendedPressureKpa ?? 160;
      const rearKpa = opts.rearKpa ?? m.rearTyre?.recommendedPressureKpa ?? 160;
      const days = [{ date: today, offset: 0 }, ...delta.forecast.map((f, i) => ({ date: f.date, offset: i + 1 }))];
      return {
        fieldId,
        equipmentId: machine.id,
        ka5: delta.ka5,
        frontKpa,
        rearKpa,
        sciReady: machine.front_tyre != null && machine.rear_tyre != null && machine.operating_mass_kg != null && machine.front_axle_fraction != null,
        days: days.map(({ date, offset }) => {
          const [r] = evaluateFieldsForMachine({ fields: [delta], machine: m, frontInflationKpa: frontKpa, rearInflationKpa: rearKpa, dayOffset: offset });
          const res = r.result as unknown as { pf: number | null; precompressionKpa: number | null; stressAtDepthKpa: number | null; sci: number | null; band: string | null };
          return { date, pf: res.pf, precompressionKpa: res.precompressionKpa, stressAtDepthKpa: res.stressAtDepthKpa, sci: res.sci, band: res.band };
        }),
      };
    });
  }

  private async context(trx: Trx, fieldId: string): Promise<Context> {
    const { rows } = await sql<{ lat: string; lng: string; latitude: number; soil_texture: string | null; timezone: string | null; utc_offset_seconds: number | null }>`
      SELECT c.lat, c.lng, ST_Y(ST_PointOnSurface(g.geometry)) AS latitude, f.soil_texture, wc.timezone, wc.utc_offset_seconds
      FROM fields f JOIN field_current_geometry g ON g.field_id = f.id
      CROSS JOIN LATERAL app.weather_cell(ST_PointOnSurface(g.geometry)) c
      LEFT JOIN weather_cells wc ON wc.lat = c.lat AND wc.lng = c.lng
      WHERE f.id = ${fieldId}`.execute(trx);
    const f = rows[0];
    if (!f) throw notFound('Field');
    // The field's current main crop: the season running today, else the next one.
    const { rows: cycles } = await sql<{ id: string; code: string | null; name: string; harvest_year: number; sowing_date: string | null; booked: string | null }>`
      SELECT cc.id, c.code, coalesce(c.name_de, c.name) AS name, s.harvest_year, cc.sowing_date,
             (SELECT min((o.performed_at AT TIME ZONE 'Europe/Berlin')::date)::text FROM operations o JOIN operation_fields ofl ON ofl.operation_id = o.id
               WHERE ofl.crop_cycle_id = cc.id AND o.type = 'sowing' AND o.status = 'completed') AS booked
      FROM crop_cycles cc JOIN growing_seasons s ON s.id = cc.season_id JOIN crops c ON c.id = cc.crop_id
      WHERE cc.field_id = ${fieldId} AND cc.role = 'main' AND s.end_date >= current_date
      -- The season running today first, then the whole field's crop, then the one already growing.
      ORDER BY (s.start_date <= current_date) DESC, s.start_date, (cc.field_part_id IS NULL) DESC,
               array_position(ARRAY['active', 'planned', 'harvested', 'closed'], cc.status), cc.created_at
      LIMIT 1`.execute(trx);
    const humus = await trx
      .selectFrom('soil_samples')
      .select('humus_pct')
      .where('field_id', '=', fieldId)
      .where('humus_pct', 'is not', null)
      .orderBy('sampled_on', 'desc')
      .limit(1)
      .executeTakeFirst();
    const cy = cycles[0];
    return {
      fieldId,
      lat: Number(f.lat),
      lng: Number(f.lng),
      latitude: f.latitude,
      timezone: f.timezone,
      utcOffsetSeconds: f.utc_offset_seconds,
      soilTexture: f.soil_texture as SoilTexture | null,
      humusPct: humus?.humus_pct ?? null,
      cycle: cy
        ? { id: cy.id, cropCode: cy.code, cropName: cy.name, harvestYear: cy.harvest_year, sowingDate: cy.booked ?? cy.sowing_date, sowingSource: cy.booked ? 'booked' : cy.sowing_date ? 'planned' : null }
        : null,
    };
  }

  /** Daily series (model shape, keyed by date) from `from` on and the stored hourly window. */
  private async weather(trx: Trx, c: Cell, from: string): Promise<{ daily: SlimWeatherTimeseries & Record<string, WeatherDay>; hourly: WeatherHourlyTimeseries | null; refreshedAt: string | null }> {
    const [days, hours, cell] = await Promise.all([
      trx.selectFrom('weather_daily').selectAll().where('lat', '=', c.lat).where('lng', '=', c.lng).where('date', '>=', from).orderBy('date').execute(),
      trx.selectFrom('weather_hourly').selectAll().where('lat', '=', c.lat).where('lng', '=', c.lng).orderBy('time').execute(),
      trx.selectFrom('weather_cells').select('refreshed_at').where('lat', '=', c.lat).where('lng', '=', c.lng).executeTakeFirst(),
    ]);
    const n = (v: number | null) => v ?? 0;
    const daily: Record<string, WeatherDay> = {};
    for (const d of days) {
      if (d.temp_min == null || d.temp_max == null) continue;
      daily[d.date] = {
        tempMin: d.temp_min,
        tempMax: d.temp_max,
        tempMean: d.temp_mean ?? (d.temp_min + d.temp_max) / 2,
        precipitation: n(d.precipitation),
        humidityMin: n(d.humidity_min),
        humidityMax: n(d.humidity_max),
        humidityMean: n(d.humidity_mean),
        dewPointMin: n(d.dew_point_min),
        dewPointMax: n(d.dew_point_max),
        dewPointMean: n(d.dew_point_mean),
        windSpeedMax: n(d.wind_speed_max),
        windSpeedMean: n(d.wind_speed_mean),
        windGustsMax: n(d.wind_gusts_max),
        windGustsMean: n(d.wind_gusts_mean),
        et0: n(d.et0),
        soilTemp0to7cm: n(d.soil_temp_0_7),
        soilTemp7to28cm: n(d.soil_temp_7_28),
        soilMoisture0to7cm: n(d.soil_moisture_0_7),
        soilMoisture7to28cm: n(d.soil_moisture_7_28),
      };
    }
    let hourly: WeatherHourlyTimeseries | null = null;
    if (hours.length && c.utcOffsetSeconds != null) {
      // Wall-clock times with one offset per series, as Open-Meteo returns them.
      const offset = c.utcOffsetSeconds;
      hourly = {
        time: hours.map((h) => new Date(new Date(h.time).getTime() + offset * 1000).toISOString().slice(0, 16)),
        timezone: c.timezone ?? undefined,
        utcOffsetSeconds: offset,
        temp: hours.map((h) => n(h.temp)),
        humidity: hours.map((h) => n(h.humidity)),
        precipitation: hours.map((h) => n(h.precipitation)),
        windSpeed: hours.map((h) => n(h.wind_speed)),
        windGusts: hours.map((h) => n(h.wind_gusts)),
      };
    }
    return { daily, hourly, refreshedAt: cell?.refreshed_at ? new Date(cell.refreshed_at).toISOString() : null };
  }
}
