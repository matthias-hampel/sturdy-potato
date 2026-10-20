/**
 * The `weather.daily` block of a predict call, from our stored daily weather (weather_daily of
 * the field's 0.01° cell), ported from the reference's lib/maizeDmc/weatherBlock.ts. The
 * service then fetches only the days we could not supply, normally none.
 *
 * Only what the mechanistic model consumes is sent: daily mean temperature (GDD) and
 * precipitation (3-day antecedent term). The block is withheld (null) when the stored weather
 * is stale or too sparse; the service then fetches Open-Meteo itself.
 */
import type { WeatherBlockInput, WeatherDayInput } from './types.js';

export interface StoredWeatherDay {
  tempMean?: number | null;
  precipitation?: number | null;
}

/** maize-dmc forecasts today + 7 days (DMC_FORECAST_HORIZON_DAYS in the service). */
export const DMC_FORECAST_HORIZON_DAYS = 7;
/** Weather older than this is not trusted to be current. */
const MAX_CACHE_AGE_HOURS = 48;
/** Below this share of covered days the block is not worth sending. */
const MIN_COVERAGE = 0.8;
/** Physical bounds mirrored from the service's WeatherDay validation. */
const TMEAN_MIN = -30;
const TMEAN_MAX = 45;

export function addDaysUTC(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function daysInclusive(from: string, to: string): number {
  return (
    Math.round(
      (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
        86_400_000,
    ) + 1
  );
}

/**
 * Select and map the stored days for [sowingDate, today + horizon].
 * Returns null when the weather is stale, sparse, or the range is empty.
 */
export function buildWeatherBlock(args: {
  series: Record<string, StoredWeatherDay> | null | undefined;
  lastUpdated: Date | string | null | undefined;
  sowingDate: string;
  today: string;
  now?: Date;
}): WeatherBlockInput | null {
  if (!args.series || !args.lastUpdated) return null;
  const updated =
    typeof args.lastUpdated === 'string'
      ? new Date(args.lastUpdated)
      : args.lastUpdated;
  const now = args.now ?? new Date();
  if (
    !Number.isFinite(updated.getTime()) ||
    now.getTime() - updated.getTime() > MAX_CACHE_AGE_HOURS * 3_600_000
  ) {
    return null;
  }
  const end = addDaysUTC(args.today, DMC_FORECAST_HORIZON_DAYS);
  if (args.sowingDate > end) return null;

  const daily: WeatherDayInput[] = [];
  for (const [date, day] of Object.entries(args.series)) {
    if (
      date < args.sowingDate ||
      date > end ||
      !/^\d{4}-\d{2}-\d{2}$/.test(date)
    )
      continue;
    const tmean = day?.tempMean;
    if (
      tmean == null ||
      !Number.isFinite(tmean) ||
      tmean < TMEAN_MIN ||
      tmean > TMEAN_MAX
    )
      continue;
    const precip = day?.precipitation;
    daily.push({
      date,
      tmean_c: tmean,
      precip_mm:
        precip == null || !Number.isFinite(precip) ? 0 : Math.max(0, precip),
    });
  }
  daily.sort((a, b) => a.date.localeCompare(b.date));

  const expected = daysInclusive(args.sowingDate, end);
  if (daily.length === 0 || daily.length / expected < MIN_COVERAGE) return null;
  return { daily };
}
