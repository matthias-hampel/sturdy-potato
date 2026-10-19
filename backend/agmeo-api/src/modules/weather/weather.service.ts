import { Injectable, Logger } from '@nestjs/common';
import type { FieldWeather, LatLng, SprayWindow, StoredWeatherDay, WeatherDay, WeatherForecast, WeatherHour, WeatherNotice } from '@agmeo/contracts';
import { sql } from 'kysely';
import type { Ctx } from '../../auth/context.js';
import { config } from '../../config.js';
import { DomainError, badRequest, notFound } from '../../core/errors.js';
import { round } from '../../core/mappers.js';
import { Database } from '../../db/database.js';

interface OpenMeteoResponse {
  timezone: string;
  current?: Record<string, number | string>;
  hourly: Record<string, (number | null)[]> & { time: string[] };
  daily: Record<string, (number | null)[]> & { time: string[] };
}

// Typical label thresholds for ground spraying; products and local rules may be stricter.
const SPRAY = { maxWindKmh: 15, maxGustKmh: 25, minTempC: 5, maxTempC: 25, maxRainProbabilityPct: 20, minHours: 2 };
const GDD_BASE_C = 5;

/** Farm-level weather from Open-Meteo (no API key; CC BY 4.0), cached per location. */
@Injectable()
export class WeatherService {
  private readonly logger = new Logger(WeatherService.name);
  private readonly cache = new Map<string, { at: number; data: OpenMeteoResponse }>();

  constructor(private readonly db: Database) {}

  /**
   * Stored weather of a field's grid cell: daily values in [from, to] (default: the last 30 days
   * and the forecast) and the next 48 hours.
   */
  fieldWeather(ctx: Ctx, fieldId: string, opts: { from?: string; to?: string } = {}): Promise<FieldWeather> {
    return this.db.run(ctx, async (trx) => {
      const { rows } = await sql<{ lat: string; lng: string }>`
        SELECT c.lat, c.lng FROM fields f JOIN field_current_geometry g ON g.field_id = f.id
        CROSS JOIN LATERAL app.weather_cell(ST_PointOnSurface(g.geometry)) c WHERE f.id = ${fieldId}`.execute(trx);
      if (!rows[0]) throw notFound('Field');
      const lat = Number(rows[0].lat);
      const lng = Number(rows[0].lng);
      const cell = await trx.selectFrom('weather_cells').selectAll().where('lat', '=', lat).where('lng', '=', lng).executeTakeFirst();
      const from = opts.from ?? new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
      let q = trx.selectFrom('weather_daily').selectAll().where('lat', '=', lat).where('lng', '=', lng).where('date', '>=', from).orderBy('date');
      if (opts.to) q = q.where('date', '<=', opts.to);
      const [days, first, hours] = await Promise.all([
        q.execute(),
        trx.selectFrom('weather_daily').select(sql<string>`min(date)`.as('d')).where('lat', '=', lat).where('lng', '=', lng).executeTakeFirst(),
        trx
          .selectFrom('weather_hourly')
          .selectAll()
          .where('lat', '=', lat)
          .where('lng', '=', lng)
          .where('time', '>=', sql<Date>`date_trunc('hour', now())`)
          .orderBy('time')
          .limit(48)
          .execute(),
      ]);
      return {
        fieldId,
        cell: { lat, lng, timezone: cell?.timezone ?? null },
        refreshedAt: cell?.refreshed_at ? new Date(cell.refreshed_at).toISOString() : null,
        storedFrom: first?.d ?? null,
        daily: days.map(
          (d): StoredWeatherDay => ({
            date: d.date,
            tempMin: d.temp_min,
            tempMax: d.temp_max,
            tempMean: d.temp_mean,
            precipitation: d.precipitation,
            humidityMin: d.humidity_min,
            humidityMax: d.humidity_max,
            humidityMean: d.humidity_mean,
            dewPointMean: d.dew_point_mean,
            windSpeedMax: d.wind_speed_max,
            windSpeedMean: d.wind_speed_mean,
            windGustsMax: d.wind_gusts_max,
            et0: d.et0,
            radiationSum: d.radiation_sum,
            soilTemp0to7cm: d.soil_temp_0_7,
            soilTemp7to28cm: d.soil_temp_7_28,
            soilMoisture0to7cm: d.soil_moisture_0_7,
            soilMoisture7to28cm: d.soil_moisture_7_28,
            source: d.source as StoredWeatherDay['source'],
          }),
        ),
        hourly: hours.map((h) => ({
          time: new Date(h.time).toISOString(),
          tempC: h.temp,
          humidityPct: h.humidity,
          dewPointC: h.dew_point,
          precipitationMm: h.precipitation,
          precipitationProbabilityPct: h.precipitation_probability,
          windKmh: h.wind_speed,
          gustKmh: h.wind_gusts,
        })),
      };
    });
  }

  async forecast(ctx: Ctx, farmId: string): Promise<WeatherForecast> {
    const farm = await this.db.run(ctx, async (trx) => {
      // Farm location, or the centre of its fields when no location was set.
      const { rows } = await sql<{ name: string; lat: number | null; lng: number | null; timezone: string }>`
        SELECT fa.name, fa.timezone,
               coalesce(ST_Y(fa.location), ST_Y(c.p)) AS lat,
               coalesce(ST_X(fa.location), ST_X(c.p)) AS lng
        FROM farms fa
        LEFT JOIN LATERAL (
          SELECT ST_Centroid(ST_Collect(g.geometry)) AS p
          FROM fields f JOIN field_current_geometry g ON g.field_id = f.id
          WHERE f.farm_id = fa.id AND f.status = 'active'
        ) c ON true
        WHERE fa.id = ${farmId}`.execute(trx);
      return rows[0];
    });
    if (!farm) throw new DomainError(404, 'not_found', 'Farm not found');
    if (farm.lat == null || farm.lng == null) {
      throw badRequest('farm_without_location', 'Set a farm location or add fields to get a weather forecast');
    }
    const location = { lat: round(farm.lat, 3), lng: round(farm.lng, 3) };
    const { data, fetchedAt } = await this.fetch(location, farm.timezone);
    return this.toForecast(farmId, farm.name, location, data, fetchedAt);
  }

  private async fetch(loc: LatLng, timezone: string) {
    const key = `${loc.lat},${loc.lng},${timezone}`;
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < config.weather.cacheMinutes * 60_000) return { data: hit.data, fetchedAt: new Date(hit.at) };

    const params = new URLSearchParams({
      latitude: String(loc.lat),
      longitude: String(loc.lng),
      timezone,
      past_days: '7',
      forecast_days: '10',
      current: 'temperature_2m,relative_humidity_2m,wind_speed_10m,precipitation,weather_code',
      daily: 'temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max,et0_fao_evapotranspiration,weather_code',
      hourly: 'temperature_2m,precipitation,precipitation_probability,wind_speed_10m,wind_gusts_10m,relative_humidity_2m',
    });
    try {
      const res = await fetch(`${config.weather.baseUrl}?${params}`, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw new Error(`Open-Meteo responded ${res.status}`);
      const data = (await res.json()) as OpenMeteoResponse;
      this.cache.set(key, { at: Date.now(), data });
      return { data, fetchedAt: new Date() };
    } catch (e) {
      this.logger.warn(`Weather fetch failed: ${(e as Error).message}`);
      // Serve stale data rather than nothing, with its original timestamp.
      if (hit) return { data: hit.data, fetchedAt: new Date(hit.at) };
      throw new DomainError(503, 'weather_unavailable', 'The weather service is currently unavailable');
    }
  }

  private toForecast(farmId: string, farmName: string, location: LatLng, d: OpenMeteoResponse, fetchedAt: Date): WeatherForecast {
    const todayLocal = new Date().toLocaleDateString('sv-SE', { timeZone: d.timezone });
    const days: WeatherDay[] = d.daily.time.map((date, i) => {
      const tMin = d.daily.temperature_2m_min[i];
      const tMax = d.daily.temperature_2m_max[i];
      return {
        date,
        tempMinC: tMin,
        tempMaxC: tMax,
        precipitationMm: d.daily.precipitation_sum[i],
        precipitationProbabilityPct: d.daily.precipitation_probability_max[i],
        windMaxKmh: d.daily.wind_speed_10m_max[i],
        gustMaxKmh: d.daily.wind_gusts_10m_max[i],
        et0Mm: d.daily.et0_fao_evapotranspiration[i],
        weatherCode: d.daily.weather_code[i],
        gdd: tMin != null && tMax != null ? round(Math.max(0, (tMin + tMax) / 2 - GDD_BASE_C), 1) : null,
      };
    });
    const past = days.filter((x) => x.date < todayLocal);
    const daily = days.filter((x) => x.date >= todayLocal);

    const nowLocal = new Date().toLocaleString('sv-SE', { timeZone: d.timezone }).replace(' ', 'T').slice(0, 13);
    const hourly: WeatherHour[] = d.hourly.time
      .map((time, i) => ({
        time,
        tempC: d.hourly.temperature_2m[i],
        precipitationMm: d.hourly.precipitation[i],
        precipitationProbabilityPct: d.hourly.precipitation_probability[i],
        windKmh: d.hourly.wind_speed_10m[i],
        gustKmh: d.hourly.wind_gusts_10m[i],
        humidityPct: d.hourly.relative_humidity_2m[i],
      }))
      .filter((h) => h.time.slice(0, 13) >= nowLocal)
      .slice(0, 72);

    const rainLast7 = past.reduce((s, x) => s + (x.precipitationMm ?? 0), 0);
    return {
      farmId,
      farmName,
      location,
      provider: 'Open-Meteo',
      providerUrl: 'https://open-meteo.com/',
      fetchedAt: fetchedAt.toISOString(),
      timezone: d.timezone,
      current: d.current
        ? {
            time: String(d.current.time),
            tempC: Number(d.current.temperature_2m),
            humidityPct: Number(d.current.relative_humidity_2m),
            windKmh: Number(d.current.wind_speed_10m),
            precipitationMm: Number(d.current.precipitation),
            weatherCode: Number(d.current.weather_code),
          }
        : null,
      precipitationLast7dMm: past.length ? round(rainLast7, 1) : null,
      past,
      daily,
      hourly,
      notices: this.notices(daily, rainLast7),
      sprayWindows: this.sprayWindows(hourly),
    };
  }

  private notices(days: WeatherDay[], rainLast7: number): WeatherNotice[] {
    const notices: WeatherNotice[] = [];
    for (const day of days.slice(0, 7)) {
      if (day.tempMinC != null && day.tempMinC <= 0) {
        notices.push({ kind: 'frost', severity: 'warning', date: day.date, message: `Frost forecast (min ${day.tempMinC} °C).` });
      } else if (day.tempMinC != null && day.tempMinC <= 2) {
        notices.push({ kind: 'frost', severity: 'info', date: day.date, message: `Ground frost possible (min ${day.tempMinC} °C).` });
      }
      if (day.precipitationMm != null && day.precipitationMm >= 20) {
        notices.push({ kind: 'heavy_rain', severity: 'warning', date: day.date, message: `Heavy rain forecast (${day.precipitationMm} mm).` });
      }
      if (day.gustMaxKmh != null && day.gustMaxKmh >= 60) {
        notices.push({ kind: 'strong_wind', severity: 'warning', date: day.date, message: `Strong gusts forecast (up to ${day.gustMaxKmh} km/h).` });
      }
      if (day.tempMaxC != null && day.tempMaxC >= 30) {
        notices.push({ kind: 'heat', severity: 'info', date: day.date, message: `Hot day forecast (max ${day.tempMaxC} °C).` });
      }
    }
    const rainNext5 = days.slice(0, 5).reduce((s, x) => s + (x.precipitationMm ?? 0), 0);
    if (rainLast7 < 2 && rainNext5 < 2 && days.length) {
      notices.push({
        kind: 'dry_spell',
        severity: 'info',
        date: days[0].date,
        message: `Dry period: ${round(rainLast7, 1)} mm in the last 7 days and ${round(rainNext5, 1)} mm forecast for the next 5.`,
      });
    }
    return notices;
  }

  /** Consecutive forecast hours meeting the spray thresholds. Indicative only. */
  private sprayWindows(hours: WeatherHour[]): SprayWindow[] {
    const ok = (h: WeatherHour) =>
      h.windKmh != null && h.windKmh <= SPRAY.maxWindKmh &&
      (h.gustKmh ?? 0) <= SPRAY.maxGustKmh &&
      h.tempC != null && h.tempC >= SPRAY.minTempC && h.tempC <= SPRAY.maxTempC &&
      (h.precipitationMm ?? 0) === 0 &&
      (h.precipitationProbabilityPct ?? 0) <= SPRAY.maxRainProbabilityPct;
    const windows: SprayWindow[] = [];
    let start: number | null = null;
    hours.forEach((h, i) => {
      const good = ok(h);
      if (good && start === null) start = i;
      const last = i === hours.length - 1;
      if (start !== null && (!good || last)) {
        const end = good && last ? i : i - 1;
        const length = end - start + 1;
        if (length >= SPRAY.minHours) {
          windows.push({ start: hours[start].time, end: addHour(hours[end].time), hours: length });
        }
        start = null;
      }
    });
    return windows;
  }
}

function addHour(localIso: string) {
  const [date, time] = localIso.split('T');
  const h = Number(time.slice(0, 2)) + 1;
  if (h < 24) return `${date}T${String(h).padStart(2, '0')}:00`;
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return `${next.toISOString().slice(0, 10)}T00:00`;
}
