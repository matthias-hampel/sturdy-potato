/**
 * Ported from AGVOLUTION/agmeo src/lib/irrigation/fieldWaterBalance.ts — logic, numbers and
 * thresholds unchanged; only imports adapted to the rewrite.
 */

/**
 * Per-field FAO-56 water balance — the single shared computation behind both
 * the Irrigation page / machine-compaction map (via `getFieldsIrrigationData`)
 * and the driving-window (weather trafficability) bar. Keeping one
 * implementation guarantees the two surfaces never disagree about how wet a
 * field is.
 *
 * Pure: depends only on `@/lib/*` (no server actions / DB), so any caller that
 * has already loaded a field's weather + soil texture + crop can reuse it
 * without re-running the heavy per-year queries.
 */

import { classifyBodenart } from '../soil.js';
import type { SupportedCrops } from '../crops.js';
import { wostenTopsoilHydraulics } from './pedotransfer.js';
import {
  computeIrrigationRecommendation,
  type IrrigationRecommendation,
} from './recommendation.js';
import {
  adjustKcForClimate,
  BARE_SOIL_KC,
  computeAWC,
  computeTEW,
  computeWaterBalance,
  dayOfYear,
  DEFAULT_KC,
  type DeficitLevel,
  estimateRHmin,
  getCropHeight,
  getDepletionFraction,
  getREWFromTexture,
  getRootDepth,
  hargreavesET0,
  kcFromBbch,
  type WaterBalanceDay,
  type WaterBalanceInput,
} from './waterBalance.js';
import { calculateDailyBbchMap } from '../phenology/bbchModel.js';
import {
  buildCalendarBbchMap,
  getDefaultSowingDate,
  getPreSeasonKc,
} from '../phenology/cropCalendar.js';

/** Topsoil texture snapshot (% values) used to derive hydraulic properties. */
export type FieldTextureSnapshot = {
  clay: number | null;
  silt: number | null;
  sand: number | null;
  soc: number | null;
  bd: number | null;
};

/** Minimal daily weather shape the water balance + BBCH model consume. */
export type WaterBalanceWeatherDay = {
  tempMin: number;
  tempMax: number;
  tempMean: number;
  precipitation: number;
  et0?: number | null;
  windSpeedMean?: number | null;
  humidityMean?: number | null;
  dewPointMean?: number | null;
};

export type WaterBalanceWeatherRecord = Record<string, WaterBalanceWeatherDay>;

export type BuildFieldWaterBalanceInput = {
  crop: SupportedCrops | null;
  /** Topsoil texture; when missing/incomplete the balance can't be computed. */
  texture: FieldTextureSnapshot | null;
  latitude: number;
  /** Booked sowing date; null falls back to the crop calendar's typical date. */
  sowingDate: string | null;
  /** Field's cached weather (date → day). */
  weather: WaterBalanceWeatherRecord;
  /** Applied irrigation per date (mm). Optional — defaults to none. */
  irrigationByDate?: Map<string, number>;
  year: number;
  /** Root-zone depth (m). Defaults to the crop's FAO-56 Table 22 depth. */
  rootDepthM?: number;
  /**
   * Survey-provided available water capacity (mm), e.g. a matched soil zone's
   * nFK. Overrides the pedotransfer-derived AWC: the surveyed value knows
   * about stone content and effective rooting depth, which topsoil texture
   * alone cannot capture. FC stays texture-anchored; PWP is shifted so that
   * TAW = the surveyed nFK (clamped at PWP ≥ 0).
   */
  awcMmOverride?: number | null;
  /** "Today" as yyyy-mm-dd; defaults to the wall clock — inject in tests. */
  today?: string;
};

export type FieldWaterBalance = {
  soilTypeKa5: string | null;
  thetaFc: number | null;
  thetaPwp: number | null;
  /** Available water capacity over the root zone (FC − PWP) in mm. */
  awcMm: number | null;
  rootDepthM: number;
  /** First simulated day: min(sowing − 10 d, Dec 1 of the prior year). */
  startDate: string;
  /** Daily water balance (deficit = FC − SWC, mm), or null when uncomputable. */
  days: WaterBalanceDay[] | null;
  currentDeficit: number | null;
  deficitLevel: DeficitLevel | null;
  totalIrrigated: number;
  totalPrecipitation: number;
  totalEta: number;
  /** Timing + quantity recommendation from the forecast tail of the series. */
  recommendation: IrrigationRecommendation;
  /** Last BBCH stage of the Kc curve (from the phenology model or the crop calendar). */
  bbchStage: number | null;
  /**
   * Where the BBCH/Kc curve came from: weather-responsive phenology model
   * ("model") or the static FAO-56 crop-calendar estimate ("calendar").
   */
  bbchSource: 'model' | 'calendar' | null;
};

/**
 * When the FAO-56 simulation starts: 10 days before sowing when that is
 * earlier than the prior December (autumn-sown crops need the autumn/winter
 * recharge), otherwise from the prior December.
 */
function computeSimulationStartDate(
  year: number,
  sowingDate: string | null,
): string {
  const december = `${year - 1}-12-01`;
  if (!sowingDate) return december;
  const d = new Date(sowingDate);
  d.setDate(d.getDate() - 10);
  const sowingMinus10 = d.toISOString().split('T')[0];
  return sowingMinus10 < december ? sowingMinus10 : december;
}

/**
 * Run the FAO-56 dual-Kc water balance for one field. Returns soil hydraulics
 * plus the daily balance, or a soil-only / empty result when texture or weather
 * is missing (mirrors `getFieldsIrrigationData`'s degraded paths exactly).
 */
export function buildFieldWaterBalance(
  input: BuildFieldWaterBalanceInput,
): FieldWaterBalance {
  const { crop, texture, latitude, weather, year } = input;
  // Crop-specific effective rooting depth from FAO-56 Table 22; entries the table
  // has no row for fall back inside getRootDepth.
  const rootDepthM = input.rootDepthM ?? getRootDepth(crop);
  const today = input.today ?? new Date().toISOString().split('T')[0];
  // Without a booked PLANTING transaction, fall back to the crop's typical
  // sowing date — never let a spring crop "grow" from the simulation start.
  const sowingDate =
    input.sowingDate ?? (crop ? getDefaultSowingDate(crop, year) : null);
  const startDate = computeSimulationStartDate(year, sowingDate);

  const empty: FieldWaterBalance = {
    soilTypeKa5: null,
    thetaFc: null,
    thetaPwp: null,
    awcMm: null,
    rootDepthM,
    startDate,
    days: null,
    currentDeficit: null,
    deficitLevel: null,
    totalIrrigated: 0,
    totalPrecipitation: 0,
    totalEta: 0,
    recommendation: { status: 'missing_data' },
    bbchStage: null,
    bbchSource: null,
  };

  if (
    !texture ||
    texture.clay == null ||
    texture.silt == null ||
    texture.sand == null
  ) {
    return empty;
  }

  const hydraulics = wostenTopsoilHydraulics({
    clayPct: texture.clay,
    siltPct: texture.silt,
    socPct: texture.soc,
    bulkDensity: texture.bd,
  });
  // Wösten returns θ as fractions (0..1); the pipeline expects % vol.
  const thetaFc = hydraulics.thetaFc * 100;
  const thetaPwp = hydraulics.thetaPwp * 100;
  const soilTypeKa5 = classifyBodenart(
    texture.clay,
    texture.silt,
    texture.sand,
  );
  let { fc, pwp, awc } = computeAWC(thetaFc, thetaPwp, rootDepthM);
  if (input.awcMmOverride != null && input.awcMmOverride > 0) {
    awc = input.awcMmOverride;
    pwp = Math.max(0, fc - awc);
    fc = pwp + awc; // exact TAW even if the survey nFK exceeds the texture FC
  }
  const awcMm = Math.round(awc * 10) / 10;

  const weatherDates = Object.keys(weather)
    .filter((d) => d >= startDate)
    .sort();

  if (weatherDates.length === 0) {
    return { ...empty, soilTypeKa5, thetaFc, thetaPwp, awcMm };
  }

  const irrigByDate = input.irrigationByDate ?? new Map<string, number>();
  // ESM phenology model when it has the crop; FAO-56 day-based calendar curve
  // otherwise (both anchored at sowing, both capped at today).
  const modelBbchMap =
    crop && sowingDate
      ? calculateDailyBbchMap(weather, crop, latitude, sowingDate, today)
      : null;
  const bbchMap =
    modelBbchMap ??
    (crop && sowingDate
      ? buildCalendarBbchMap(weatherDates, crop, sowingDate, today)
      : null);
  const bbchSource: FieldWaterBalance['bbchSource'] = bbchMap
    ? modelBbchMap
      ? 'model'
      : 'calendar'
    : null;
  // The BBCH curve stops at today (never projects past observed weather), so
  // forecast days would otherwise fall back to DEFAULT_KC — a canopy that
  // vanishes at midnight. Carry the last modeled stage forward instead.
  let lastBbchDate: string | null = null;
  let lastBbch: number | null = null;
  if (bbchMap) {
    for (const [date, bbch] of bbchMap) {
      if (lastBbchDate === null || date > lastBbchDate) {
        lastBbchDate = date;
        lastBbch = bbch;
      }
    }
  }
  const preSeasonKc = crop ? getPreSeasonKc(crop) : null;
  const getKcForDate = (date: string): { kc: number; kcb?: number } => {
    // Before sowing: dormant cover for perennials, bare soil for the rest
    // (Kcb 0 → transpiration off, only Ke surface evaporation runs). Only
    // when a BBCH curve exists — crops without one keep flat DEFAULT_KC.
    if (bbchMap && sowingDate && date < sowingDate) {
      if (preSeasonKc !== null) return { kc: preSeasonKc };
      return { kc: BARE_SOIL_KC, kcb: 0 };
    }
    const bbch = bbchMap?.get(date);
    if (bbch !== undefined) return { kc: kcFromBbch(bbch, crop) };
    if (lastBbchDate !== null && lastBbch !== null && date > lastBbchDate) {
      return { kc: kcFromBbch(lastBbch, crop) };
    }
    return { kc: DEFAULT_KC };
  };
  const cropHeight = getCropHeight(crop);

  const inputs: WaterBalanceInput[] = weatherDates.map((date) => {
    const w = weather[date];
    // FAO-56 PM ET0 from Open-Meteo when available, Hargreaves as fallback.
    const et0 =
      w.et0 != null && w.et0 > 0
        ? w.et0
        : hargreavesET0(
            w.tempMin,
            w.tempMax,
            w.tempMean,
            latitude,
            dayOfYear(date),
          );
    const u2 = w.windSpeedMean ?? 2;
    const rhMin = estimateRHmin(w.tempMax, w.dewPointMean, w.humidityMean);
    const { kc: rawKc, kcb } = getKcForDate(date);
    const kc = adjustKcForClimate(rawKc, cropHeight, u2, rhMin);
    return {
      date,
      precipitation: w.precipitation ?? 0,
      et0,
      kc,
      kcb,
      irrigation: irrigByDate.get(date) ?? 0,
    };
  });

  // FAO-56 dual-Kc: separate top-layer (bare-soil evaporation) balance.
  const surface = {
    tew: computeTEW(thetaFc, thetaPwp),
    rew: getREWFromTexture(texture.clay, texture.sand),
  };
  const result = computeWaterBalance(
    { fc, pwp, p: getDepletionFraction(crop), surface, todayOverride: today },
    inputs,
  );

  const tempMaxByDate: Record<string, number> = {};
  for (const date of weatherDates) {
    if (date > today) tempMaxByDate[date] = weather[date].tempMax;
  }

  const recommendation = computeIrrigationRecommendation({
    crop,
    fcMm: fc,
    awcMm,
    days: result.days,
    today,
    tempMaxByDate,
    bbchStage: lastBbch,
  });

  return {
    soilTypeKa5,
    thetaFc,
    thetaPwp,
    awcMm,
    rootDepthM,
    startDate,
    days: result.days,
    currentDeficit: result.currentDeficit,
    deficitLevel: result.deficitLevel,
    totalIrrigated: result.totalIrrigated,
    totalPrecipitation: result.totalPrecipitation,
    totalEta: result.totalEta,
    recommendation,
    bbchStage: lastBbch,
    bbchSource,
  };
}
