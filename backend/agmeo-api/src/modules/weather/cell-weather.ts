/**
 * Stored weather of one grid cell in the models' shape, and soil-class texture mid-points, for the
 * season-wide computations (same as FieldConditionsService does per field).
 */
import type { SoilTexture } from '@agmeo/contracts';
import type { Trx } from '../../db/database.js';
import type { SlimWeatherTimeseries, WeatherDay, WeatherHourlyTimeseries } from '../../models/types.js';

/**
 * Representative topsoil fractions (%) of the LUFA soil classes, for fields without a measured
 * texture: mid-points of the matching KA5 Bodenarten.
 */
export const TEXTURE_OF_CLASS: Record<SoilTexture, { clay: number; silt: number; sand: number }> = {
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

/** Daily series (model shape, keyed by date) from `from` on and the stored hourly window. */
export async function cellWeather(trx: Trx, c: { lat: number; lng: number; timezone: string | null; utcOffsetSeconds: number | null }, from: string): Promise<{ daily: SlimWeatherTimeseries & Record<string, WeatherDay>; hourly: WeatherHourlyTimeseries | null; refreshedAt: string | null }> {
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
