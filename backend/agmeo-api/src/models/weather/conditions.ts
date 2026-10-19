/**
 * Ported from AGVOLUTION/agmeo src/lib/weather/conditions.ts — logic, numbers and
 * thresholds unchanged; only imports adapted to the rewrite.
 */

import type { TSoilTypeLUFA } from '../types.js';
import type { SupportedCrops } from '../crops.js';
import { type WaterBalanceDay } from '../irrigation/waterBalance.js';
import { calculateBBCH } from '../phenology/bbch.js';
import { computeGDDFromWeather } from '../phenology/gdd.js';
import type {
  SlimWeatherTimeseries,
  WeatherDay,
  WeatherHourlyTimeseries,
} from '../types.js';
import type { UnitFormatter } from './units.js';
import type { Dimension } from './units.js';
import { hourlyInstantsMs, type WallClockToUtc } from './hourlyWindow.js';

// --- Spraying conditions scoring (0-3 levels with Delta T) ---

export type SprayingLevel = 0 | 1 | 2 | 3;

/**
 * Wet bulb temperature via Stull (2011) approximation.
 * Valid for RH 5-99%, temp -20°C to 50°C, accuracy ±1°C.
 */
function computeWetBulbTemperature(temp: number, humidity: number): number {
  const rh = Math.max(5, Math.min(99, humidity));
  return (
    temp * Math.atan(0.151977 * Math.sqrt(rh + 8.313659)) +
    0.00391838 * Math.pow(rh, 1.5) * Math.atan(0.023101 * rh) -
    Math.atan(rh - 1.676331) +
    Math.atan(temp + rh) -
    4.686035
  );
}

function computeDeltaT(temp: number, humidity: number): number {
  return (
    Math.round((temp - computeWetBulbTemperature(temp, humidity)) * 10) / 10
  );
}

function getDeltaTLevel(deltaT: number): SprayingLevel {
  if (deltaT >= 2 && deltaT <= 8) return 0;
  if ((deltaT > 8 && deltaT <= 10) || (deltaT >= 1 && deltaT < 2)) return 1;
  if ((deltaT > 10 && deltaT <= 12) || (deltaT >= 0 && deltaT < 1)) return 2;
  return 3;
}

function getWindSpeedLevel(windSpeed: number): SprayingLevel {
  if (windSpeed < 11) return 0;
  if (windSpeed < 15) return 1;
  if (windSpeed < 20) return 2;
  return 3;
}

function getWindGustsLevel(windGusts: number): SprayingLevel {
  if (windGusts < 20) return 0;
  if (windGusts < 29) return 1;
  if (windGusts < 40) return 2;
  return 3;
}

function getTemperatureLevel(temp: number): SprayingLevel {
  if (temp >= 10 && temp <= 25) return 0;
  if ((temp >= 5 && temp < 10) || (temp > 25 && temp <= 30)) return 1;
  if (temp > 30 && temp <= 35) return 2;
  return 3;
}

function getRainFreeHoursLevel(rainFreeHours: number): SprayingLevel {
  if (rainFreeHours >= 6) return 0;
  if (rainFreeHours >= 4) return 1;
  if (rainFreeHours >= 2) return 2;
  return 3;
}

/**
 * Count consecutive rain-free hours from a starting index in hourly data.
 */
function countRainFreeHours(
  hourly: WeatherHourlyTimeseries,
  fromIndex: number,
): number {
  let hours = 0;
  for (let i = fromIndex; i < hourly.time.length; i++) {
    if ((hourly.precipitation[i] ?? 0) > 0) break;
    hours++;
  }
  return hours;
}

type ReasonKey =
  | 'reason.deltaT'
  | 'reason.frost'
  | 'reason.gusts'
  | 'reason.heat'
  | 'reason.precip3d'
  | 'reason.precip72h'
  | 'reason.rain'
  | 'reason.rainFree'
  | 'reason.smd'
  | 'reason.soil'
  | 'reason.temp'
  | 'reason.wind';

/**
 * A criterion that kept the day off "optimal". `value` is canonical metric (°C, km/h, mm) or a
 * count of hours — consumers format it in the org's units with `formatReasonValue`.
 */
export type ReasonEntry = {
  key: ReasonKey;
  value: number;
  dimension: Dimension | 'hours';
};

type CriterionScore = ReasonEntry & { level: SprayingLevel };

function collectReasons(scores: CriterionScore[]): ReasonEntry[] {
  return scores
    .filter((s) => s.level > 0)
    .map(({ key, value, dimension }) => ({ key, value, dimension }));
}

/** A reason's value in the formatter's units, e.g. "18 km/h" / "11 mph", "31.2 °C" / "88 °F", "6h". */
export function formatReasonValue(
  { value, dimension }: ReasonEntry,
  fmt: UnitFormatter,
): string {
  if (dimension === 'hours') {
    return new Intl.NumberFormat(fmt.locale, {
      style: 'unit',
      unit: 'hour',
      unitDisplay: 'narrow',
    }).format(value);
  }
  // Wind is scored on whole km/h, so the tooltip shows whole numbers too.
  return fmt.format(value, dimension, {
    precision: dimension === 'speed' ? 0 : undefined,
  });
}

function worstLevel(scores: CriterionScore[]): SprayingLevel {
  return Math.max(...scores.map((s) => s.level)) as SprayingLevel;
}

function getHourlySprayingScores(
  hourly: WeatherHourlyTimeseries,
  index: number,
): CriterionScore[] {
  const temp = hourly.temp[index];
  const humidity = hourly.humidity[index];
  const windSpeed = hourly.windSpeed[index];
  const windGusts = hourly.windGusts[index];
  const deltaT = computeDeltaT(temp, humidity);
  const rainFreeHours = countRainFreeHours(hourly, index);

  return [
    {
      level: getDeltaTLevel(deltaT),
      key: 'reason.deltaT',
      value: deltaT,
      dimension: 'temperatureDelta',
    },
    {
      level: getWindSpeedLevel(windSpeed),
      key: 'reason.wind',
      value: windSpeed,
      dimension: 'speed',
    },
    {
      level: getWindGustsLevel(windGusts),
      key: 'reason.gusts',
      value: windGusts,
      dimension: 'speed',
    },
    {
      level: getTemperatureLevel(temp),
      key: 'reason.temp',
      value: temp,
      dimension: 'temperature',
    },
    {
      level: getRainFreeHoursLevel(rainFreeHours),
      key: 'reason.rainFree',
      value: rainFreeHours,
      dimension: 'hours',
    },
  ];
}

function getDailySprayingScores(
  day: WeatherDay,
  nextDayPrecipitation: number,
): CriterionScore[] {
  const deltaT = computeDeltaT(day.tempMean, day.humidityMean);
  const rainFreeHours =
    day.precipitation === 0 && nextDayPrecipitation === 0
      ? 6
      : day.precipitation === 0
        ? 4
        : 0;

  return [
    {
      level: getDeltaTLevel(deltaT),
      key: 'reason.deltaT',
      value: deltaT,
      dimension: 'temperatureDelta',
    },
    {
      level: getWindSpeedLevel(day.windSpeedMax),
      key: 'reason.wind',
      value: day.windSpeedMax,
      dimension: 'speed',
    },
    {
      level: getWindGustsLevel(day.windGustsMax),
      key: 'reason.gusts',
      value: day.windGustsMax,
      dimension: 'speed',
    },
    {
      level: getTemperatureLevel(day.tempMean),
      key: 'reason.temp',
      value: day.tempMean,
      dimension: 'temperature',
    },
    {
      level: getRainFreeHoursLevel(rainFreeHours),
      key: 'reason.rainFree',
      value: rainFreeHours,
      dimension: 'hours',
    },
  ];
}

export type SprayingDay = {
  date: string;
  value: SprayingLevel | null;
  reasons?: ReasonEntry[];
};

/**
 * Compute spraying forecast for the next N days.
 * Uses hourly data where available (best hour per day), falls back to daily aggregates.
 */
export function computeSprayingForecast(
  weather: SlimWeatherTimeseries,
  weatherHourly?: WeatherHourlyTimeseries,
  days = 14,
): SprayingDay[] {
  const today = new Date();
  const result: SprayingDay[] = [];

  // Build hourly index: map dateStr → array of hourly indices for that day
  const hourlyByDate = new Map<string, number[]>();
  if (weatherHourly?.time) {
    for (let i = 0; i < weatherHourly.time.length; i++) {
      const dateStr = weatherHourly.time[i].split('T')[0];
      const indices = hourlyByDate.get(dateStr);
      if (indices) indices.push(i);
      else hourlyByDate.set(dateStr, [i]);
    }
  }

  for (let i = 0; i < days; i++) {
    const date = new Date(today);
    date.setDate(date.getDate() + i);
    const dateStr = date.toISOString().split('T')[0];
    // Forecast loop only reads dates >= today; the slim-weather projection keeps
    // full WeatherDay for every day >= today-8 (see src/lib/db/slimWeather.ts).
    const day = weather[dateStr] as WeatherDay | undefined;

    if (!day) {
      result.push({ date: dateStr, value: null });
      continue;
    }

    const hourlyIndices = hourlyByDate.get(dateStr);

    // Use hourly data: pick the best (lowest level) hour of the day
    if (weatherHourly && hourlyIndices && hourlyIndices.length > 0) {
      let bestScores: CriterionScore[] | null = null;
      let bestLevel: SprayingLevel = 3;
      for (const idx of hourlyIndices) {
        const scores = getHourlySprayingScores(weatherHourly, idx);
        const level = worstLevel(scores);
        if (level < bestLevel) {
          bestLevel = level;
          bestScores = scores;
        }
      }
      const reasons = bestScores ? collectReasons(bestScores) : [];
      result.push({
        date: dateStr,
        value: bestLevel,
        reasons: reasons.length > 0 ? reasons : undefined,
      });
      continue;
    }

    // Fall back to daily data
    const nextDate = new Date(date);
    nextDate.setDate(nextDate.getDate() + 1);
    const nextDateStr = nextDate.toISOString().split('T')[0];
    const nextDayPrecip = weather[nextDateStr]?.precipitation ?? 0;

    const scores = getDailySprayingScores(day, nextDayPrecip);
    const level = worstLevel(scores);
    const reasons = collectReasons(scores);
    result.push({
      date: dateStr,
      value: level,
      reasons: reasons.length > 0 ? reasons : undefined,
    });
  }

  return result;
}

/** Per-hour spray score for the mobile weather endpoint (0 = best). */
export function computeHourlySpray(
  hourly: WeatherHourlyTimeseries,
  index: number,
): { level: SprayingLevel; reasons: ReasonEntry[] } {
  const scores = getHourlySprayingScores(hourly, index);
  return { level: worstLevel(scores), reasons: collectReasons(scores) };
}

// --- Sowing conditions scoring (0-3 levels, crop-specific) ---

export type SowingLevel = 0 | 1 | 2 | 3;

/**
 * Crop-specific soil temperature thresholds for sowing [optimal_low, acceptable_low, marginal_low, unsuitable_below].
 * Upper optimal bound is also defined.
 */
type SowingCropConfig = {
  soilTempOptimal: [number, number]; // [low, high] for level 0
  soilTempAcceptable: number; // low bound for level 1
  soilTempMarginal: number; // low bound for level 2
  isWinterCrop: boolean;
};

const SOWING_CROP_CONFIG: Partial<Record<SupportedCrops, SowingCropConfig>> = {
  winterWheat: {
    soilTempOptimal: [8, 15],
    soilTempAcceptable: 5,
    soilTempMarginal: 3,
    isWinterCrop: true,
  },
  hardWheat: {
    soilTempOptimal: [8, 15],
    soilTempAcceptable: 5,
    soilTempMarginal: 3,
    isWinterCrop: true,
  },
  winterBarleyFodder: {
    soilTempOptimal: [8, 15],
    soilTempAcceptable: 5,
    soilTempMarginal: 2,
    isWinterCrop: true,
  },
  winterRyeBaking: {
    soilTempOptimal: [5, 12],
    soilTempAcceptable: 2,
    soilTempMarginal: 0.5,
    isWinterCrop: true,
  },
  triticaleFodder: {
    soilTempOptimal: [8, 15],
    soilTempAcceptable: 5,
    soilTempMarginal: 3,
    isWinterCrop: true,
  },
  ryeWholePlantSilage: {
    soilTempOptimal: [5, 12],
    soilTempAcceptable: 2,
    soilTempMarginal: 0.5,
    isWinterCrop: true,
  },
  springBarleyMalting: {
    soilTempOptimal: [10, 20],
    soilTempAcceptable: 7,
    soilTempMarginal: 5,
    isWinterCrop: false,
  },
  springOatsFodder: {
    soilTempOptimal: [8, 18],
    soilTempAcceptable: 5,
    soilTempMarginal: 3,
    isWinterCrop: false,
  },
  spelt: {
    soilTempOptimal: [8, 15],
    soilTempAcceptable: 5,
    soilTempMarginal: 3,
    isWinterCrop: true,
  },
};

const DEFAULT_SOWING_CONFIG: SowingCropConfig = {
  soilTempOptimal: [8, 15],
  soilTempAcceptable: 5,
  soilTempMarginal: 3,
  isWinterCrop: false,
};

function getSowingCropConfig(crop: SupportedCrops | null): SowingCropConfig {
  return (crop && SOWING_CROP_CONFIG[crop]) || DEFAULT_SOWING_CONFIG;
}

function getSoilTempLevel(
  soilTemp: number,
  crop: SupportedCrops | null,
): SowingLevel {
  const cfg = getSowingCropConfig(crop);
  if (soilTemp >= cfg.soilTempOptimal[0] && soilTemp <= cfg.soilTempOptimal[1])
    return 0;
  if (soilTemp >= cfg.soilTempAcceptable) return 1;
  if (soilTemp >= cfg.soilTempMarginal) return 2;
  return 3;
}

/**
 * Frost risk level. For established winter crops (BBCH ≥ 10), thresholds shift down 3°C
 * since they tolerate frost after tillering.
 */
function getSowingFrostLevel(
  tempMin: number,
  bbch: number | null,
  crop: SupportedCrops | null,
): SowingLevel {
  const cfg = getSowingCropConfig(crop);
  const shift = cfg.isWinterCrop && bbch !== null && bbch >= 10 ? 3 : 0;
  if (tempMin > 3 - shift) return 0;
  if (tempMin > 1 - shift) return 1;
  if (tempMin > 0 - shift) return 2;
  return 3;
}

/**
 * Soil workability based on 3-day cumulative precipitation and soil type.
 * Heavier soils need more drying time.
 */
function getSoilWorkabilityLevel(
  precip3d: number,
  soilType: TSoilTypeLUFA | null,
): SowingLevel {
  const category = getSoilCategory(soilType);
  const thresholds = WORKABILITY_THRESHOLDS[category];
  if (precip3d < thresholds[0]) return 0;
  if (precip3d < thresholds[1]) return 1;
  if (precip3d < thresholds[2]) return 2;
  return 3;
}

// Workability precipitation thresholds per soil category [optimal, acceptable, marginal]
const WORKABILITY_THRESHOLDS = {
  light: [8, 15, 25],
  medium: [5, 10, 20],
  heavy: [3, 8, 15],
} as const;

function getSoilCategory(
  soilType: TSoilTypeLUFA | null,
): 'light' | 'medium' | 'heavy' {
  if (!soilType) return 'medium';
  if (LIGHT_SOILS.includes(soilType)) return 'light';
  if (HEAVY_SOILS.includes(soilType)) return 'heavy';
  return 'medium';
}

function getSowingPrecipLevelDaily(
  dayPrecip: number,
  nextDayPrecip: number,
): SowingLevel {
  if (dayPrecip === 0 && nextDayPrecip < 1) return 0;
  if (dayPrecip < 1 && nextDayPrecip < 3) return 1;
  if (dayPrecip <= 3) return 2;
  return 3;
}

function getSowingRainFreeHoursLevel(rainFreeHours: number): SowingLevel {
  if (rainFreeHours >= 12) return 0;
  if (rainFreeHours >= 8) return 1;
  if (rainFreeHours >= 4) return 2;
  return 3;
}

function getSowingWindLevel(windSpeed: number): SowingLevel {
  if (windSpeed < 15) return 0;
  if (windSpeed < 25) return 1;
  if (windSpeed < 35) return 2;
  return 3;
}

/**
 * Sum precipitation over the last N hours from hourly data, counting backwards from a given index.
 */
function sumPrecipLookback(
  hourly: WeatherHourlyTimeseries,
  fromIndex: number,
  hours: number,
): number {
  let total = 0;
  for (let i = fromIndex; i >= Math.max(0, fromIndex - hours + 1); i--) {
    total += hourly.precipitation[i] ?? 0;
  }
  return Math.round(total * 10) / 10;
}

/**
 * Sum precipitation from daily data for the last N days (including the given date going back).
 */
function sumPrecipLookbackDaily(
  weather: SlimWeatherTimeseries,
  dateStr: string,
  days: number,
): number {
  let total = 0;
  const date = new Date(dateStr);
  for (let i = 0; i < days; i++) {
    const d = new Date(date);
    d.setDate(d.getDate() - i);
    const ds = d.toISOString().split('T')[0];
    total += weather[ds]?.precipitation ?? 0;
  }
  return Math.round(total * 10) / 10;
}

export type SowingDay = {
  date: string;
  value: SowingLevel | null;
  reasons?: ReasonEntry[];
};

/**
 * Compute sowing forecast for the next N days.
 * Uses crop-specific thresholds, precipitation-based soil workability, and frost risk adjusted by BBCH.
 * Hourly data used where available (best hour per day), daily fallback.
 */
export function computeSowingForecast(
  weather: SlimWeatherTimeseries,
  weatherHourly?: WeatherHourlyTimeseries,
  soilType?: TSoilTypeLUFA | null,
  crop?: SupportedCrops | null,
  sowingDate?: string | null,
  days = 14,
): SowingDay[] {
  const today = new Date();
  const result: SowingDay[] = [];

  // Compute BBCH for frost tolerance adjustment
  const bbch =
    weather && crop
      ? calculateBBCH(computeGDDFromWeather(weather, crop, sowingDate), crop)
      : null;

  // Build hourly index
  const hourlyByDate = new Map<string, number[]>();
  if (weatherHourly?.time) {
    for (let i = 0; i < weatherHourly.time.length; i++) {
      const dateStr = weatherHourly.time[i].split('T')[0];
      const indices = hourlyByDate.get(dateStr);
      if (indices) indices.push(i);
      else hourlyByDate.set(dateStr, [i]);
    }
  }

  for (let i = 0; i < days; i++) {
    const date = new Date(today);
    date.setDate(date.getDate() + i);
    const dateStr = date.toISOString().split('T')[0];
    // Forecast loop only reads dates >= today; the slim-weather projection keeps
    // full WeatherDay for every day >= today-8 (see src/lib/db/slimWeather.ts).
    const day = weather[dateStr] as WeatherDay | undefined;

    if (!day) {
      result.push({ date: dateStr, value: null });
      continue;
    }

    const soilTemp = day.soilTemp0to7cm;
    const hourlyIndices = hourlyByDate.get(dateStr);

    // Hourly path: pick the best hour
    if (weatherHourly && hourlyIndices && hourlyIndices.length > 0) {
      let bestScores: CriterionScore[] | null = null;
      let bestLevel: SowingLevel = 3;
      for (const idx of hourlyIndices) {
        const temp = weatherHourly.temp[idx];
        const windSpeed = weatherHourly.windSpeed[idx];
        const precip72h = sumPrecipLookback(weatherHourly, idx, 72);
        const rainFreeHours = countRainFreeHours(weatherHourly, idx);

        const scores: CriterionScore[] = [
          {
            level: getSoilTempLevel(soilTemp, crop ?? null),
            key: 'reason.soil',
            value: soilTemp,
            dimension: 'temperature',
          },
          {
            level: getSowingFrostLevel(temp, bbch, crop ?? null),
            key: 'reason.frost',
            value: temp,
            dimension: 'temperature',
          },
          {
            level: getSoilWorkabilityLevel(precip72h, soilType ?? null),
            key: 'reason.precip72h',
            value: precip72h,
            dimension: 'precipDepth',
          },
          {
            level: getSowingRainFreeHoursLevel(rainFreeHours),
            key: 'reason.rainFree',
            value: rainFreeHours,
            dimension: 'hours',
          },
          {
            level: getSowingWindLevel(windSpeed),
            key: 'reason.wind',
            value: windSpeed,
            dimension: 'speed',
          },
        ];
        const level = worstLevel(scores);
        if (level < bestLevel) {
          bestLevel = level;
          bestScores = scores;
        }
      }
      const reasons = bestScores ? collectReasons(bestScores) : [];
      result.push({
        date: dateStr,
        value: bestLevel,
        reasons: reasons.length > 0 ? reasons : undefined,
      });
      continue;
    }

    // Daily fallback
    const precip3d = sumPrecipLookbackDaily(weather, dateStr, 3);
    const nextDate = new Date(date);
    nextDate.setDate(nextDate.getDate() + 1);
    const nextDayPrecip =
      weather[nextDate.toISOString().split('T')[0]]?.precipitation ?? 0;

    const scores: CriterionScore[] = [
      {
        level: getSoilTempLevel(soilTemp, crop ?? null),
        key: 'reason.soil',
        value: soilTemp,
        dimension: 'temperature',
      },
      {
        level: getSowingFrostLevel(day.tempMin, bbch, crop ?? null),
        key: 'reason.frost',
        value: day.tempMin,
        dimension: 'temperature',
      },
      {
        level: getSoilWorkabilityLevel(precip3d, soilType ?? null),
        key: 'reason.precip3d',
        value: precip3d,
        dimension: 'precipDepth',
      },
      {
        level: getSowingPrecipLevelDaily(day.precipitation, nextDayPrecip),
        key: 'reason.rain',
        value: day.precipitation,
        dimension: 'precipDepth',
      },
      {
        level: getSowingWindLevel(day.windSpeedMax),
        key: 'reason.wind',
        value: day.windSpeedMax,
        dimension: 'speed',
      },
    ];
    const level = worstLevel(scores);
    const reasons = collectReasons(scores);
    result.push({
      date: dateStr,
      value: level,
      reasons: reasons.length > 0 ? reasons : undefined,
    });
  }

  return result;
}

// --- Weather risk scoring (0-3 levels, crop- and BBCH-aware) ---

type WeatherRiskLevel = 0 | 1 | 2 | 3;

type WeatherRiskPhase =
  'dormant' | 'vegetative' | 'elongation' | 'reproductive' | 'ripening';

function getWeatherRiskPhase(bbch: number | null): WeatherRiskPhase {
  if (bbch === null || bbch < 10) return 'dormant';
  if (bbch < 30) return 'vegetative';
  if (bbch < 50) return 'elongation';
  if (bbch < 70) return 'reproductive';
  return 'ripening';
}

type WeatherRiskCropConfig = {
  frostShift: number;
  isWinterCrop: boolean;
};

const WEATHER_RISK_CROP_CONFIG: Partial<
  Record<SupportedCrops, WeatherRiskCropConfig>
> = {
  winterWheat: { frostShift: 0, isWinterCrop: true },
  hardWheat: { frostShift: 0, isWinterCrop: true },
  winterBarleyFodder: { frostShift: 0, isWinterCrop: true },
  winterRyeBaking: { frostShift: -3, isWinterCrop: true },
  ryeWholePlantSilage: { frostShift: -3, isWinterCrop: true },
  triticaleFodder: { frostShift: -1, isWinterCrop: true },
  spelt: { frostShift: 0, isWinterCrop: true },
  springBarleyMalting: { frostShift: 0, isWinterCrop: false },
  springOatsFodder: { frostShift: 0, isWinterCrop: false },
  silageMaize: { frostShift: 3, isWinterCrop: false },
  grainMaize: { frostShift: 3, isWinterCrop: false },
};

const DEFAULT_RISK_CROP_CONFIG: WeatherRiskCropConfig = {
  frostShift: 0,
  isWinterCrop: false,
};

function getRiskCropConfig(crop: SupportedCrops | null): WeatherRiskCropConfig {
  return (crop && WEATHER_RISK_CROP_CONFIG[crop]) || DEFAULT_RISK_CROP_CONFIG;
}

// Frost thresholds [level1, level2, level3] — temp below level3 = high risk
const FROST_THRESHOLDS: Record<string, [number, number, number]> = {
  'dormant-winter': [-5, -10, -15],
  'dormant-spring': [0, -2, -5],
  'vegetative-winter': [-2, -5, -10],
  'vegetative-spring': [0, -2, -4],
  elongation: [0, -1, -2],
  reproductive: [1, 0, -1],
  ripening: [0, -1, -2],
};

function getRiskFrostLevel(
  tempMin: number,
  phase: WeatherRiskPhase,
  crop: SupportedCrops | null,
): WeatherRiskLevel {
  const cfg = getRiskCropConfig(crop);
  const key =
    phase === 'dormant' || phase === 'vegetative'
      ? `${phase}-${cfg.isWinterCrop ? 'winter' : 'spring'}`
      : phase;
  const [t1, t2, t3] =
    FROST_THRESHOLDS[key] || FROST_THRESHOLDS['vegetative-spring'];
  const shift = cfg.frostShift;
  if (tempMin > t1 + shift) return 0;
  if (tempMin > t2 + shift) return 1;
  if (tempMin > t3 + shift) return 2;
  return 3;
}

// Heat thresholds [level1, level2, level3] — temp above level3 = high risk
const HEAT_THRESHOLDS: Record<WeatherRiskPhase, [number, number, number]> = {
  dormant: [28, 32, 35],
  vegetative: [28, 32, 35],
  elongation: [27, 30, 33],
  reproductive: [25, 28, 30],
  ripening: [28, 32, 35],
};

function getRiskHeatLevel(
  tempMax: number,
  phase: WeatherRiskPhase,
): WeatherRiskLevel {
  const [t1, t2, t3] = HEAT_THRESHOLDS[phase];
  if (tempMax < t1) return 0;
  if (tempMax < t2) return 1;
  if (tempMax < t3) return 2;
  return 3;
}

// Precipitation thresholds [level1, level2, level3] — precip above level3 = high risk
const PRECIP_RISK_THRESHOLDS: Record<
  WeatherRiskPhase,
  [number, number, number]
> = {
  dormant: [10, 20, 30],
  vegetative: [10, 20, 30],
  elongation: [8, 15, 25],
  reproductive: [5, 10, 20],
  ripening: [3, 8, 15],
};

function getRiskPrecipLevel(
  precip: number,
  phase: WeatherRiskPhase,
): WeatherRiskLevel {
  const [t1, t2, t3] = PRECIP_RISK_THRESHOLDS[phase];
  if (precip < t1) return 0;
  if (precip < t2) return 1;
  if (precip < t3) return 2;
  return 3;
}

// Wind gust thresholds [level1, level2, level3] in km/h
const WIND_RISK_THRESHOLDS: Record<WeatherRiskPhase, [number, number, number]> =
  {
    dormant: [40, 55, 70],
    vegetative: [40, 55, 70],
    elongation: [35, 50, 65],
    reproductive: [30, 45, 60],
    ripening: [25, 40, 55],
  };

function getRiskWindLevel(
  windGusts: number,
  precip: number,
  phase: WeatherRiskPhase,
): WeatherRiskLevel {
  const [t1, t2, t3] = WIND_RISK_THRESHOLDS[phase];
  // Rain compounding: when wet, shift thresholds down one level (~30% reduction)
  const wet = precip > 10;
  const shift = wet ? t1 - t2 : 0; // negative value, shifts thresholds lower
  if (windGusts < t1 + shift) return 0;
  if (windGusts < t2 + shift) return 1;
  if (windGusts < t3 + shift) return 2;
  return 3;
}

function getHourlyRiskScores(
  temp: number,
  windGusts: number,
  precip: number,
  phase: WeatherRiskPhase,
  crop: SupportedCrops | null,
): CriterionScore[] {
  return [
    {
      level: getRiskFrostLevel(temp, phase, crop),
      key: 'reason.frost',
      value: temp,
      dimension: 'temperature',
    },
    {
      level: getRiskHeatLevel(temp, phase),
      key: 'reason.heat',
      value: temp,
      dimension: 'temperature',
    },
    {
      level: getRiskPrecipLevel(precip, phase),
      key: 'reason.rain',
      value: precip,
      dimension: 'precipDepth',
    },
    {
      level: getRiskWindLevel(windGusts, precip, phase),
      key: 'reason.wind',
      value: windGusts,
      dimension: 'speed',
    },
  ];
}

function getDailyRiskScores(
  day: WeatherDay,
  phase: WeatherRiskPhase,
  crop: SupportedCrops | null,
): CriterionScore[] {
  return [
    {
      level: getRiskFrostLevel(day.tempMin, phase, crop),
      key: 'reason.frost',
      value: day.tempMin,
      dimension: 'temperature',
    },
    {
      level: getRiskHeatLevel(day.tempMax, phase),
      key: 'reason.heat',
      value: day.tempMax,
      dimension: 'temperature',
    },
    {
      level: getRiskPrecipLevel(day.precipitation, phase),
      key: 'reason.rain',
      value: day.precipitation,
      dimension: 'precipDepth',
    },
    {
      level: getRiskWindLevel(day.windGustsMax, day.precipitation, phase),
      key: 'reason.wind',
      value: day.windGustsMax,
      dimension: 'speed',
    },
  ];
}

export type WeatherRiskDay = {
  date: string;
  value: WeatherRiskLevel | null;
  reasons?: ReasonEntry[];
};

/**
 * Compute weather risk for the next N days.
 * Crop- and BBCH-aware: frost, heat, precipitation, and wind/lodging thresholds
 * shift based on the crop's current growth phase.
 * Uses hourly data where available (worst hour per day), daily fallback.
 * Returns all non-optimal risk criteria for tooltip display.
 */
export function computeWeatherRisk(
  weather: SlimWeatherTimeseries,
  weatherHourly?: WeatherHourlyTimeseries,
  crop?: SupportedCrops | null,
  sowingDate?: string | null,
  days = 14,
): WeatherRiskDay[] {
  const today = new Date();
  const result: WeatherRiskDay[] = [];

  // Compute BBCH for growth-stage-dependent thresholds
  const bbch =
    weather && crop
      ? calculateBBCH(computeGDDFromWeather(weather, crop, sowingDate), crop)
      : null;
  const phase = getWeatherRiskPhase(bbch);

  // Build hourly index
  const hourlyByDate = new Map<string, number[]>();
  if (weatherHourly?.time) {
    for (let i = 0; i < weatherHourly.time.length; i++) {
      const dateStr = weatherHourly.time[i].split('T')[0];
      const indices = hourlyByDate.get(dateStr);
      if (indices) indices.push(i);
      else hourlyByDate.set(dateStr, [i]);
    }
  }

  for (let i = 0; i < days; i++) {
    const date = new Date(today);
    date.setDate(date.getDate() + i);
    const dateStr = date.toISOString().split('T')[0];
    // Forecast loop only reads dates >= today; the slim-weather projection keeps
    // full WeatherDay for every day >= today-8 (see src/lib/db/slimWeather.ts).
    const day = weather[dateStr] as WeatherDay | undefined;

    if (!day) {
      result.push({ date: dateStr, value: null });
      continue;
    }

    const hourlyIndices = hourlyByDate.get(dateStr);

    // Hourly path: take worst hour of the day
    if (weatherHourly && hourlyIndices && hourlyIndices.length > 0) {
      let worstScores: CriterionScore[] | null = null;
      let worstLvl: WeatherRiskLevel = 0;
      for (const idx of hourlyIndices) {
        const scores = getHourlyRiskScores(
          weatherHourly.temp[idx],
          weatherHourly.windGusts[idx],
          weatherHourly.precipitation[idx] ?? 0,
          phase,
          crop ?? null,
        );
        const lvl = worstLevel(scores);
        if (lvl > worstLvl) {
          worstLvl = lvl;
          worstScores = scores;
        }
      }
      const reasons = worstScores ? collectReasons(worstScores) : [];
      result.push({
        date: dateStr,
        value: worstLvl,
        reasons: reasons.length > 0 ? reasons : undefined,
      });
      continue;
    }

    // Daily fallback
    const scores = getDailyRiskScores(day, phase, crop ?? null);
    const level = worstLevel(scores);
    const reasons = collectReasons(scores);
    result.push({
      date: dateStr,
      value: level,
      reasons: reasons.length > 0 ? reasons : undefined,
    });
  }

  return result;
}

/**
 * Compute precipitation for a date range
 */
function computePrecipitation(
  weather: SlimWeatherTimeseries,
  startDate: Date,
  endDate: Date,
): number {
  let total = 0;
  const current = new Date(startDate);

  while (current <= endDate) {
    const dateStr = current.toISOString().split('T')[0];
    const day = weather[dateStr];
    if (day) total += day.precipitation;
    current.setDate(current.getDate() + 1);
  }

  return Math.round(total * 10) / 10;
}

export type PrecipitationStats = {
  season: number | null;
  last24h: number | null;
  last7d: number | null;
  upcoming24h: number | null;
  upcoming7d: number | null;
};

/**
 * Compute precipitation from hourly data for a specific time range.
 * Returns the sum of hourly precipitation values within the range.
 */
function computePrecipitationFromHourly(
  hourly: WeatherHourlyTimeseries,
  instants: number[],
  startTime: Date,
  endTime: Date,
): number {
  let total = 0;

  const start = startTime.getTime();
  const end = endTime.getTime();
  for (let i = 0; i < hourly.time.length; i++) {
    const timestamp = instants[i];
    if (timestamp >= start && timestamp < end) {
      total += hourly.precipitation[i] ?? 0;
    }
  }

  return Math.round(total * 10) / 10;
}

/**
 * Compute all precipitation stats using daily data for longer periods
 * and hourly data for 24h periods (when available).
 */
export function computePrecipitationStats(
  weather: SlimWeatherTimeseries,
  weatherHourly: WeatherHourlyTimeseries | undefined,
  harvestYearStart: Date,
  sowingDate?: string | null,
  toUtc?: WallClockToUtc,
): PrecipitationStats {
  // Check if we have any weather data
  const weatherDates = Object.keys(weather);
  if (weatherDates.length === 0) {
    return {
      season: null,
      last24h: null,
      last7d: null,
      upcoming24h: null,
      upcoming7d: null,
    };
  }

  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];

  // Time boundaries (use start of day for daily calculations)
  const today = new Date(todayStr);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const weekAgo = new Date(today);
  weekAgo.setDate(weekAgo.getDate() - 7);
  const weekAhead = new Date(today);
  weekAhead.setDate(weekAhead.getDate() + 7);

  const seasonStart = sowingDate ? new Date(sowingDate) : harvestYearStart;
  const seasonStartStr = seasonStart.toISOString().split('T')[0];
  const earliestWeatherDate = weatherDates.reduce((a, b) => (a < b ? a : b));
  const season =
    earliestWeatherDate <= seasonStartStr
      ? computePrecipitation(weather, seasonStart, today)
      : null;

  // Last 7 days (excluding today)
  const last7d = computePrecipitation(weather, weekAgo, yesterday);

  // Upcoming 7 days (including today)
  const upcoming7d = computePrecipitation(weather, today, weekAhead);

  // For 24h calculations, use hourly data if available
  let last24h: number;
  let upcoming24h: number;

  if (weatherHourly && weatherHourly.time && weatherHourly.time.length > 0) {
    // Use hourly data for accurate 24h precipitation
    const last24hStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const upcoming24hEnd = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const instants = hourlyInstantsMs(weatherHourly, toUtc);
    last24h = computePrecipitationFromHourly(
      weatherHourly,
      instants,
      last24hStart,
      now,
    );
    upcoming24h = computePrecipitationFromHourly(
      weatherHourly,
      instants,
      now,
      upcoming24hEnd,
    );
  } else {
    // Fall back to daily data: yesterday for last24h, today for upcoming24h
    last24h =
      weather[yesterday.toISOString().split('T')[0]]?.precipitation ?? 0;
    upcoming24h = weather[todayStr]?.precipitation ?? 0;
    last24h = Math.round(last24h * 10) / 10;
    upcoming24h = Math.round(upcoming24h * 10) / 10;
  }

  return {
    season,
    last24h,
    last7d,
    upcoming24h,
    upcoming7d,
  };
}

// --- WeatherTrafficability scoring (0-3 levels, water balance model) ---

export type WeatherTrafficabilityLevel = 0 | 1 | 2 | 3;

/**
 * Soil type categories (LUFA classification):
 * - Light soils: drain fast, trafficable at higher moisture
 * - Medium soils: moderate sensitivity
 * - Heavy soils: poor trafficability when wet
 */
const LIGHT_SOILS: TSoilTypeLUFA[] = ['S', 'lS'];
// Medium soils (fallback in getSoilCategory): sU, ssL, lU, sL, uL, L
const HEAVY_SOILS: TSoilTypeLUFA[] = ['utL', 'tL', 'T'];

/**
 * Relative soil-water depletion thresholds, D = deficit / AWC, where deficit =
 * field capacity − current soil water (mm). D = 0 means the soil is at field
 * capacity (wettest, worst trafficability); D = 1 means wilting point (driest,
 * best). Soil-normalised, so one set of breakpoints fits every soil type — a
 * heavy soil at 50% depletion is as trafficable as a light one at 50%.
 *
 * TUNABLE: these are the agronomic knobs for the driving-window bar.
 */
const DEPLETION_THRESHOLDS = {
  /** D ≥ good → level 0 (dry enough, good). */
  good: 0.5,
  /** D ≥ moderate → level 1. */
  moderate: 0.3,
  /** D ≥ poor → level 2; below → level 3 (near field capacity, not passable). */
  poor: 0.15,
} as const;

function getWeatherTrafficabilityDepletionLevel(
  depletionRatio: number,
): WeatherTrafficabilityLevel {
  if (depletionRatio >= DEPLETION_THRESHOLDS.good) return 0;
  if (depletionRatio >= DEPLETION_THRESHOLDS.moderate) return 1;
  if (depletionRatio >= DEPLETION_THRESHOLDS.poor) return 2;
  return 3;
}

function getWeatherTrafficabilityPrecipPenalty(
  precip: number,
): WeatherTrafficabilityLevel {
  if (precip < 2) return 0;
  if (precip < 8) return 1;
  if (precip < 20) return 2;
  return 3;
}

export type WeatherTrafficabilityDay = {
  date: string;
  value: WeatherTrafficabilityLevel | null;
  reasons?: ReasonEntry[];
};

/**
 * Driving-window (weather trafficability) forecast.
 *
 * Reads the SAME FAO-56 water balance the Irrigation page and the machine-
 * compaction map consume (via the shared `buildFieldWaterBalance`), so the bar
 * and the map can never disagree about how wet a field is. Each day is scored on
 * the relative soil-water depletion D = deficit / AWC (worst-of with a rain
 * penalty) — not a private bucket model.
 *
 * @param waterBalance per-day FAO-56 balance (deficit = FC − SWC, mm)
 * @param awcMm        available water capacity over the root zone (FC − PWP, mm)
 */
export function computeWeatherTrafficabilityForecast(
  waterBalance: WaterBalanceDay[] | null | undefined,
  awcMm: number | null | undefined,
  days = 14,
): WeatherTrafficabilityDay[] | null {
  if (!waterBalance || waterBalance.length === 0 || !awcMm || awcMm <= 0)
    return null;

  const byDate = new Map(waterBalance.map((d) => [d.date, d]));
  const today = new Date();
  const result: WeatherTrafficabilityDay[] = [];

  for (let i = 0; i < days; i++) {
    const date = new Date(today);
    date.setDate(date.getDate() + i);
    const dateStr = date.toISOString().split('T')[0];
    const wb = byDate.get(dateStr);

    if (!wb) {
      result.push({ date: dateStr, value: null });
      continue;
    }

    // D = deficit / AWC, clamped to [0,1]. Higher = drier = more trafficable.
    const depletionRatio = Math.max(0, Math.min(1, wb.deficit / awcMm));

    const scores: CriterionScore[] = [
      {
        level: getWeatherTrafficabilityDepletionLevel(depletionRatio),
        key: 'reason.smd',
        value: wb.deficit,
        dimension: 'precipDepth',
      },
      {
        level: getWeatherTrafficabilityPrecipPenalty(wb.precipitation),
        key: 'reason.rain',
        value: wb.precipitation,
        dimension: 'precipDepth',
      },
    ];
    const value = worstLevel(scores);
    const reasons = collectReasons(scores);

    result.push({
      date: dateStr,
      value,
      reasons: reasons.length > 0 ? reasons : undefined,
    });
  }

  return result;
}
