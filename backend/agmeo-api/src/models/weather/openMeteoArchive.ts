/**
 * Ported from AGVOLUTION/agmeo src/lib/weather/openMeteoArchive.ts — only the
 * request/response mapping, as pure functions. The caller fetches:
 *
 *   const res = await fetch(buildArchiveDailyUrl(lat, lon, start, end, apiKey));
 *   if (!res.ok) throw …;
 *   const days = parseArchiveDaily(await res.json());
 *
 * Open-Meteo ARCHIVE (ERA5 reanalysis) — historical daily weather for a point,
 * used by the reference's assistant climate-context route to build both the
 * current season series and the multi-year climatology baseline
 * (see ./climateBaseline.ts).
 *
 * Only DAILY variables are requested (one call spans all years). Humidity is
 * intentionally omitted: the archive exposes relative humidity hourly only, so
 * the disease-favorable-days metric degrades to "unavailable".
 *
 * Units are pinned so they match the core's thresholds: windspeed in m/s
 * (STORM_GUST_MS = 17.2), radiation in MJ/m², precip in mm, temp in °C.
 */
import type { ClimateDaily } from './climateBaseline.js';

/**
 * Commercial archive endpoint — the only one the reference may call. The free
 * archive-api.open-meteo.com is non-commercial only (licence problem in a paid
 * product, and it rate-limits to 429 under load), so the reference refused to
 * run without OPENMETEO_API_KEY instead of falling back to it.
 */
export const ARCHIVE_URL_CUSTOMER =
  'https://customer-archive-api.open-meteo.com/v1/archive';

/** ERA5 lags ~5 days; never request days the archive can't have yet. */
export const ARCHIVE_LAG_DAYS = 6;

export const ARCHIVE_DAILY_VARIABLES = [
  'temperature_2m_min',
  'temperature_2m_max',
  'precipitation_sum',
  'shortwave_radiation_sum',
  'windspeed_10m_max',
] as const;

export interface ArchiveResponse {
  daily?: {
    time?: string[];
    temperature_2m_min?: (number | null)[];
    temperature_2m_max?: (number | null)[];
    precipitation_sum?: (number | null)[];
    shortwave_radiation_sum?: (number | null)[];
    windspeed_10m_max?: (number | null)[];
  };
}

/**
 * URL for daily archive weather over [startDate, endDate] (inclusive,
 * YYYY-MM-DD) at a point. `apiKey` is the commercial subscription key.
 */
export function buildArchiveDailyUrl(
  latitude: number,
  longitude: number,
  startDate: string,
  endDate: string,
  apiKey: string,
  baseUrl: string = ARCHIVE_URL_CUSTOMER,
): string {
  const params = new URLSearchParams({
    latitude: latitude.toFixed(4),
    longitude: longitude.toFixed(4),
    start_date: startDate,
    end_date: endDate,
    daily: ARCHIVE_DAILY_VARIABLES.join(','),
    timezone: 'auto',
    windspeed_unit: 'ms',
  });
  params.set('apikey', apiKey);
  return `${baseUrl}?${params.toString()}`;
}

/**
 * Archive response → climate days. Days with no min/max temperature are
 * dropped (the temperature metrics can't be computed for them).
 */
export function parseArchiveDaily(body: ArchiveResponse): ClimateDaily[] {
  const d = body.daily;
  if (!d?.time) return [];

  const out: ClimateDaily[] = [];
  for (let i = 0; i < d.time.length; i++) {
    const tempMin = d.temperature_2m_min?.[i];
    const tempMax = d.temperature_2m_max?.[i];
    if (tempMin == null || tempMax == null) continue; // undated/missing day
    out.push({
      date: d.time[i],
      tempMin,
      tempMax,
      precipMm: d.precipitation_sum?.[i] ?? 0,
      radiationMj: d.shortwave_radiation_sum?.[i] ?? null,
      windMaxMs: d.windspeed_10m_max?.[i] ?? null,
      humidityPct: null,
    });
  }
  return out;
}
