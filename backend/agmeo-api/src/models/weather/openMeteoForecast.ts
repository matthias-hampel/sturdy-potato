/**
 * Ported from AGVOLUTION/agmeo src/lib/weather/openMeteoForecast.ts — only the
 * request/response mapping and cache-key rule, as pure functions. Fetching and
 * caching (the reference used Upstash Redis with a 3 h TTL) are the caller's.
 *
 * Open-Meteo FORECAST — recent past + upcoming daily weather for a point, for
 * orgs whose fields have no cultivation yet (the reference's weather crawler
 * only fills per-cultivation series). One cache entry per ~1 km grid cell so a
 * farm's dashboard costs one upstream call every few hours.
 */

/**
 * Commercial forecast endpoint. The free api.open-meteo.com host is
 * non-commercial only (see ./openMeteoArchive.ts).
 */
export const FORECAST_URL_CUSTOMER =
  'https://customer-api.open-meteo.com/v1/forecast';

export const FORECAST_PAST_DAYS = 7;
export const FORECAST_FUTURE_DAYS = 7;
export const POINT_FORECAST_CACHE_TTL_SECONDS = 3 * 60 * 60;
const KEY_PREFIX = 'weather:point-forecast';

export type PointWeatherDay = {
  tempMax: number;
  tempMin: number;
  precipitation: number;
};

/** ISO date → day, covering today-7 … today+7. */
export type PointWeatherTimeseries = Record<string, PointWeatherDay>;

export type ForecastResponse = {
  daily?: {
    time?: string[];
    temperature_2m_max?: (number | null)[];
    temperature_2m_min?: (number | null)[];
    precipitation_sum?: (number | null)[];
  };
};

/** ~1 km grid: neighbouring fields share one cache entry and one upstream call. */
export function pointForecastCacheKey(lat: number, lon: number): string {
  return `${KEY_PREFIX}:${lat.toFixed(2)}:${lon.toFixed(2)}`;
}

export function buildPointForecastUrl(
  lat: number,
  lon: number,
  apiKey: string,
  baseUrl: string = FORECAST_URL_CUSTOMER,
): string {
  const params = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    daily: [
      'temperature_2m_max',
      'temperature_2m_min',
      'precipitation_sum',
    ].join(','),
    past_days: String(FORECAST_PAST_DAYS),
    forecast_days: String(FORECAST_FUTURE_DAYS + 1),
    timezone: 'auto',
    apikey: apiKey,
  });
  return `${baseUrl}?${params.toString()}`;
}

/** Forecast response → date-keyed days; days without min/max are dropped. */
export function parsePointForecast(
  body: ForecastResponse,
): PointWeatherTimeseries {
  const d = body.daily;
  const out: PointWeatherTimeseries = {};
  if (!d?.time) return out;
  for (let i = 0; i < d.time.length; i++) {
    const tempMax = d.temperature_2m_max?.[i];
    const tempMin = d.temperature_2m_min?.[i];
    if (tempMax == null || tempMin == null) continue;
    out[d.time[i]] = {
      tempMax,
      tempMin,
      precipitation: d.precipitation_sum?.[i] ?? 0,
    };
  }
  return out;
}
