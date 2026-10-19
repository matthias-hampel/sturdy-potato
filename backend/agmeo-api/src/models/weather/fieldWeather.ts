/**
 * Ported from AGVOLUTION/agmeo src/lib/weather/fieldWeather.ts — the mobile
 * field-weather payload builder. The response type is declared here (the
 * reference took it from its swagger schema `FieldWeatherResponseT`), and the
 * English reason formatter uses a fixed label map instead of the i18n bundle.
 */

import type { WeatherHourlyTimeseries, WeatherTimeseries } from '../types.js';
import { computeHourlySpray, formatReasonValue } from './conditions.js';
import { hourlyInstantsMs } from './hourlyWindow.js';
import {
  englishUnitLabel,
  makeUnitFormatter,
  type MeasurementSystem,
  type UnitFormatter,
} from './units.js';
import type { SprayingLevel } from './conditions.js';

const KMH_TO_MS = 1 / 3.6;
const HOURLY_WINDOW = 48;
const DAILY_WINDOW = 7;

const kmhToMs = (kmh: number) => Math.round(kmh * KMH_TO_MS * 10) / 10;

export type FieldWeatherResponse = {
  fetchedAt: string | null;
  hourly: {
    ts: string;
    tempC: number;
    windMs: number;
    gustMs: number;
    humidityPct: number;
    precipMm: number;
    precipProbPct: number | null;
    spray: { level: SprayingLevel; reasons: string[] };
  }[];
  daily: {
    date: string;
    tempMin: number;
    tempMax: number;
    precipMm: number;
    precipProbPct: number | null;
    windMaxMs: number;
  }[];
};

/**
 * Formatter for the spray-reason strings ("reason.wind: 11 mph"): the reason key stays the
 * untranslated wire key the app maps itself, the value is in the org's measurement system.
 */
export const sprayReasonFormatter = (
  system: MeasurementSystem,
): UnitFormatter => makeUnitFormatter(system, englishUnitLabel, 'en-US');

/**
 * Assemble the mobile field-weather payload: the next 48 h of hourly data
 * with the platform's per-hour spray score (0 = best) and 7 d of daily
 * aggregates. Wind converts from the stored km/h to m/s here — this is the
 * single definition of the wire units. Only the human-readable spray reasons
 * follow the org's measurement system; the numeric fields stay metric.
 */
export function buildFieldWeatherResponse(
  weather: unknown,
  weatherHourly: unknown,
  weatherLastUpdated: Date | null,
  reasonFormatter = sprayReasonFormatter('metric'),
  now = new Date(),
): FieldWeatherResponse {
  const hourlySeries = (weatherHourly ??
    {}) as Partial<WeatherHourlyTimeseries>;
  const dailySeries = (weather ?? {}) as WeatherTimeseries;
  const nowMs = now.getTime();

  const hourly: FieldWeatherResponse['hourly'] = [];
  if (hourlySeries.time) {
    const instants = hourlyInstantsMs(hourlySeries as WeatherHourlyTimeseries);
    for (
      let i = 0;
      i < hourlySeries.time.length && hourly.length < HOURLY_WINDOW;
      i++
    ) {
      if (instants[i] < nowMs - 60 * 60 * 1000) continue;
      const spray = computeHourlySpray(
        hourlySeries as WeatherHourlyTimeseries,
        i,
      );
      hourly.push({
        ts: hourlySeries.time[i],
        tempC: hourlySeries.temp?.[i] ?? 0,
        windMs: kmhToMs(hourlySeries.windSpeed?.[i] ?? 0),
        gustMs: kmhToMs(hourlySeries.windGusts?.[i] ?? 0),
        humidityPct: hourlySeries.humidity?.[i] ?? 0,
        precipMm: hourlySeries.precipitation?.[i] ?? 0,
        precipProbPct: null,
        spray: {
          level: spray.level,
          reasons: spray.reasons.map(
            (r) => `${r.key}: ${formatReasonValue(r, reasonFormatter)}`,
          ),
        },
      });
    }
  }

  const daily: FieldWeatherResponse['daily'] = [];
  for (let i = 0; i < DAILY_WINDOW; i++) {
    const date = new Date(nowMs + i * 24 * 60 * 60 * 1000)
      .toISOString()
      .split('T')[0];
    const day = dailySeries[date];
    if (!day) continue;
    daily.push({
      date,
      tempMin: day.tempMin,
      tempMax: day.tempMax,
      precipMm: day.precipitation,
      precipProbPct: null,
      windMaxMs: kmhToMs(day.windSpeedMax),
    });
  }

  return {
    fetchedAt: weatherLastUpdated?.toISOString() ?? null,
    hourly,
    daily,
  };
}
