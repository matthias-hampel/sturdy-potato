/**
 * Entry points for the ported agmeo models, taking the rewrite's crop codes
 * (`crops.code`, e.g. `winter_wheat`). Each converts the code once with
 * `modelCrop` and calls the reference model, whose tables stay keyed by the
 * reference crop keys. Everything here is pure: weather, soil and bookings are
 * loaded by the caller.
 *
 * Not ported code itself — the glue mirrors how the reference's server actions
 * (src/actions/cultivationTimeseries.ts, src/actions/trafficability.ts,
 * src/lib/irrigation/data.ts) combined the models.
 */

import { modelCrop, type SupportedCrops } from './crops.js';
import {
  collapseDiseaseRisk,
  type DiseaseRiskDay,
  type DiseaseTimeseries,
} from './disease/diseaseRisk.js';
import {
  computeFieldIrrigation,
  type FieldIrrigation,
  type FieldIrrigationInput,
} from './irrigation/data.js';
import type { WaterBalanceDay } from './irrigation/waterBalance.js';
import { calculateBBCH } from './phenology/bbch.js';
import { calculateDailyBbchMap } from './phenology/bbchModel.js';
import {
  buildCalendarBbchMap,
  getDefaultSowingDate,
} from './phenology/cropCalendar.js';
import { computeGDDFromWeather } from './phenology/gdd.js';
import type {
  SlimWeatherTimeseries,
  TSoilTypeLUFA,
  WeatherHourlyTimeseries,
} from './types.js';
import {
  computeSowingForecast,
  computeSprayingForecast,
  computeWeatherRisk,
  computeWeatherTrafficabilityForecast,
  type SowingDay,
  type SprayingDay,
  type WeatherRiskDay,
  type WeatherTrafficabilityDay,
} from './weather/conditions.js';

export { modelCrop, MODEL_CROP_BY_CODE, type SupportedCrops } from './crops.js';

// ── Condition bars ─────────────────────────────────────────────────────────

export type FieldConditionInput = {
  /** Rewrite crop code of the field's current crop cycle; null when none. */
  cropCode: string | null;
  /** Daily weather keyed by ISO date; full WeatherDay from today−8 on. */
  weather: SlimWeatherTimeseries;
  /** Hourly series (preferred where present: best/worst hour per day). */
  weatherHourly?: WeatherHourlyTimeseries;
  /** LUFA texture group (`fields.soil_texture`), drives sowing workability. */
  soilTexture?: TSoilTypeLUFA | null;
  /** Sowing date (yyyy-mm-dd) — GDD/BBCH for frost and risk thresholds. */
  sowingDate?: string | null;
  /** Root-zone FAO-56 balance (computeFieldWaterBalance().rootZone.days). */
  waterBalance?: WaterBalanceDay[] | null;
  /** Root-zone AWC in mm (computeFieldWaterBalance().rootZone.awcMm). */
  awcMm?: number | null;
  /** Number of days from today (wall clock). Default 14. */
  days?: number;
};

export type FieldConditionBars = {
  spraying: SprayingDay[];
  sowing: SowingDay[];
  weatherRisk: WeatherRiskDay[];
  /** null without a water balance / AWC. */
  trafficability: WeatherTrafficabilityDay[] | null;
};

/** The four 0..3 condition bars of a field, one entry per day from today. */
export function computeFieldConditionBars(
  input: FieldConditionInput,
): FieldConditionBars {
  const crop = modelCrop(input.cropCode);
  const days = input.days ?? 14;
  return {
    spraying: computeSprayingForecast(input.weather, input.weatherHourly, days),
    sowing: computeSowingForecast(
      input.weather,
      input.weatherHourly,
      input.soilTexture ?? null,
      crop,
      input.sowingDate ?? null,
      days,
    ),
    weatherRisk: computeWeatherRisk(
      input.weather,
      input.weatherHourly,
      crop,
      input.sowingDate ?? null,
      days,
    ),
    trafficability: computeWeatherTrafficabilityForecast(
      input.waterBalance,
      input.awcMm,
      days,
    ),
  };
}

// ── Phenology ──────────────────────────────────────────────────────────────

export type PhenologyInput = {
  cropCode: string | null;
  /** Daily weather keyed by ISO date (tempMin/tempMax required). */
  weather: Record<
    string,
    {
      tempMin: number;
      tempMax: number;
      tempMean?: number;
      precipitation?: number;
    }
  >;
  /** Booked sowing date; null → the crop calendar's typical date for `harvestYear`. */
  sowingDate: string | null;
  harvestYear: number;
  /** Field latitude (photoperiod in the ESM model). */
  latitude: number;
  /** yyyy-mm-dd; defaults to the wall clock. */
  today?: string;
};

export type PhenologyResult = {
  crop: SupportedCrops | null;
  sowingDate: string | null;
  /** Cumulative GDD since sowing (crop base temperature); null without a model or when weather starts after sowing. */
  gdd: number | null;
  /** BBCH from the GDD threshold table (null without GDD; 0 for crops without thresholds). */
  bbchFromGdd: number | null;
  /** Daily BBCH from sowing to today: ESM model where it has the crop, FAO-56 calendar curve otherwise. */
  dailyBbch: Map<string, number> | null;
  /** Last value of dailyBbch. */
  currentBbch: number | null;
  bbchSource: 'model' | 'calendar' | null;
};

/** GDD and BBCH since sowing for a crop cycle. */
export function computePhenology(input: PhenologyInput): PhenologyResult {
  const crop = modelCrop(input.cropCode);
  const today = input.today ?? new Date().toISOString().split('T')[0];
  const sowingDate =
    input.sowingDate ??
    (crop ? getDefaultSowingDate(crop, input.harvestYear) : null);
  const empty: PhenologyResult = {
    crop,
    sowingDate,
    gdd: null,
    bbchFromGdd: null,
    dailyBbch: null,
    currentBbch: null,
    bbchSource: null,
  };
  if (!crop || !sowingDate) return empty;

  const pastWeather = Object.fromEntries(
    Object.entries(input.weather).filter(([date]) => date <= today),
  );
  const gdd = computeGDDFromWeather(pastWeather, crop, sowingDate);
  const modelMap = calculateDailyBbchMap(
    input.weather,
    crop,
    input.latitude,
    sowingDate,
    today,
  );
  const dailyBbch =
    modelMap ??
    buildCalendarBbchMap(
      Object.keys(input.weather).sort(),
      crop,
      sowingDate,
      today,
    );
  let currentBbch: number | null = null;
  let lastDate = '';
  for (const [date, bbch] of dailyBbch ?? []) {
    if (date > lastDate) {
      lastDate = date;
      currentBbch = bbch;
    }
  }
  return {
    crop,
    sowingDate,
    gdd,
    bbchFromGdd: calculateBBCH(gdd, crop),
    dailyBbch,
    currentBbch,
    bbchSource: dailyBbch ? (modelMap ? 'model' : 'calendar') : null,
  };
}

// ── Water balance + irrigation recommendation ──────────────────────────────

export type FieldWaterBalanceInput = Omit<FieldIrrigationInput, 'crop'> & {
  cropCode: string | null;
};

/**
 * FAO-56 dual-Kc water balance over the season (root zone, optionally also
 * the plough layer for trafficability) plus the irrigation recommendation.
 */
export function computeFieldWaterBalance(
  input: FieldWaterBalanceInput,
): FieldIrrigation {
  const { cropCode, ...rest } = input;
  return computeFieldIrrigation({ ...rest, crop: modelCrop(cropCode) });
}

// ── Disease risk ───────────────────────────────────────────────────────────

/** Worst daily ISIP disease risk (0..3) for the crop; null for crops ISIP does not model. */
export function computeDiseaseRisk(
  disease: DiseaseTimeseries | null | undefined,
  cropCode: string | null,
): DiseaseRiskDay[] | null {
  return collapseDiseaseRisk(disease, modelCrop(cropCode));
}
