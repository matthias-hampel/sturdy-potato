/**
 * Stored weather (F5) after the reference app's weather crawler (src/app/api/cron/weather-crawler,
 * src/lib/crawlers/weatherSlot.ts): one hourly scan finds the grid cells of active fields; new
 * cells get an archive backfill from the start of their seasons and the forecast window at once,
 * the others are refreshed once a day in the 04:30–05:30 local slot of the farms that use them.
 * Daily values are aggregated from hourly data in the cell's local time.
 */
import { Logger } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { config } from '../../config.js';
import type { DB } from '../../db/schema.js';
import { enqueue } from '../../jobs/queue.js';
import type { JobHandler } from '../../jobs/runner.js';

export const WEATHER_SCAN = 'weather.scan';
export const WEATHER_CELL = 'weather.cell';

/** Local minutes of day, half-open: 04:30 ≤ t < 05:30 (reference CRAWL_SLOT). */
const CRAWL_SLOT = { from: 4 * 60 + 30, to: 5 * 60 + 30 };
/** "Refreshed today" means at or after 04:00 local time of the current local day. */
const FRESH_FROM_MINUTES = 4 * 60;
/** The hourly window kept per cell: today − 7 … today + 14 (reference update jobs). */
const PAST_DAYS = 7;
const FORECAST_DAYS = 16;
/** ERA5 lags about five days; the archive is never asked for days it cannot have yet. */
export const ARCHIVE_LAG_DAYS = 6;
/** Without an archive subscription the forecast API reaches back this far. */
const FORECAST_MAX_PAST_DAYS = 92;
/** Cells fetched per scan, so one scan stays bounded; the rest follow in the next hour. */
const MAX_CELLS_PER_SCAN = 500;

const HOURLY = ['temperature_2m', 'relative_humidity_2m', 'dew_point_2m', 'precipitation', 'wind_speed_10m', 'wind_gusts_10m', 'et0_fao_evapotranspiration', 'shortwave_radiation'];
/** Soil layers differ: the archive (ERA5) has 0–7/7–28 cm, the forecast models 6/18 cm and 3–9/9–27 cm. */
const SOIL_FORECAST = { temp0: 'soil_temperature_6cm', temp7: 'soil_temperature_18cm', moist0: 'soil_moisture_3_to_9cm', moist7: 'soil_moisture_9_to_27cm' };
const SOIL_ARCHIVE = { temp0: 'soil_temperature_0_to_7cm', temp7: 'soil_temperature_7_to_28cm', moist0: 'soil_moisture_0_to_7cm', moist7: 'soil_moisture_7_to_28cm' };

/** Minutes of day and the date on the wall clock of `tz`. */
export function localParts(now: Date, tz: string): { date: string; minutes: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

export const isInCrawlSlot = (now: Date, tz: string) => {
  const { minutes } = localParts(now, tz);
  return minutes >= CRAWL_SLOT.from && minutes < CRAWL_SLOT.to;
};

/** Whether a cell refreshed at `refreshedAt` already has today's refresh in `tz`. */
export function refreshedToday(refreshedAt: Date, now: Date, tz: string): boolean {
  const today = localParts(now, tz).date;
  const at = localParts(refreshedAt, tz);
  return at.date === today && at.minutes >= FRESH_FROM_MINUTES;
}

export interface CellDemand {
  lat: number;
  lng: number;
  timezones: string[];
  seasonStart: string | null;
}

export interface CellState {
  lat: number;
  lng: number;
  backfilledFrom: string | null;
  refreshedAt: Date | null;
}

const cellKey = (c: { lat: number; lng: number }) => `${c.lat.toFixed(2)},${c.lng.toFixed(2)}`;
const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/**
 * First day a cell should have daily values for: its earliest season start, else 180 days back.
 * Without an archive subscription no more than the forecast API's 92 past days can be had.
 */
export function wantedStart(d: CellDemand, today: string, archive = config.weather.apiKey !== ''): string {
  const start = d.seasonStart ?? addDays(today, -180);
  const reachable = addDays(today, -FORECAST_MAX_PAST_DAYS);
  return archive || start > reachable ? start : reachable;
}

/**
 * Which cells to fetch now: new cells and cells missing their backfill at once, the others when one
 * of their farms is in the morning slot and the cell has not been refreshed since local 04:00.
 */
export function dueCells(demand: CellDemand[], states: CellState[], now: Date): { cell: CellDemand; backfill: boolean }[] {
  const byKey = new Map(states.map((s) => [cellKey(s), s]));
  const today = now.toISOString().slice(0, 10);
  const out: { cell: CellDemand; backfill: boolean }[] = [];
  for (const d of demand) {
    const s = byKey.get(cellKey(d));
    const backfill = !s?.backfilledFrom || s.backfilledFrom > wantedStart(d, today);
    if (!s?.refreshedAt || backfill) {
      out.push({ cell: d, backfill });
      continue;
    }
    if (d.timezones.some((tz) => isInCrawlSlot(now, tz) && !refreshedToday(s.refreshedAt!, now, tz))) out.push({ cell: d, backfill: false });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Open-Meteo
// ---------------------------------------------------------------------------

interface HourlyResponse {
  timezone: string;
  utc_offset_seconds: number;
  hourly: Record<string, (number | null)[]> & { time: string[] };
}

/** Customer endpoints when a subscription key is configured; the free API otherwise (development). */
const endpoint = (kind: 'forecast' | 'archive') =>
  config.weather.apiKey
    ? kind === 'forecast'
      ? 'https://customer-api.open-meteo.com/v1/forecast'
      : 'https://customer-archive-api.open-meteo.com/v1/archive'
    : kind === 'forecast'
      ? config.weather.baseUrl
      : null;

export function forecastUrl(lat: number, lng: number, pastDays = PAST_DAYS): string {
  const params = new URLSearchParams({
    latitude: lat.toFixed(2),
    longitude: lng.toFixed(2),
    timezone: 'auto',
    past_days: String(pastDays),
    forecast_days: String(FORECAST_DAYS),
    hourly: [...HOURLY, 'precipitation_probability', ...Object.values(SOIL_FORECAST)].join(','),
  });
  if (config.weather.apiKey) params.set('apikey', config.weather.apiKey);
  return `${endpoint('forecast')}?${params}`;
}

export function archiveUrl(lat: number, lng: number, start: string, end: string): string | null {
  const base = endpoint('archive');
  if (!base) return null;
  const params = new URLSearchParams({
    latitude: lat.toFixed(2),
    longitude: lng.toFixed(2),
    timezone: 'auto',
    start_date: start,
    end_date: end,
    hourly: [...HOURLY, ...Object.values(SOIL_ARCHIVE)].join(','),
  });
  params.set('apikey', config.weather.apiKey);
  return `${base}?${params}`;
}

export interface DailyRow {
  date: string;
  temp_min: number | null;
  temp_max: number | null;
  temp_mean: number | null;
  precipitation: number | null;
  humidity_min: number | null;
  humidity_max: number | null;
  humidity_mean: number | null;
  dew_point_min: number | null;
  dew_point_max: number | null;
  dew_point_mean: number | null;
  wind_speed_max: number | null;
  wind_speed_mean: number | null;
  wind_gusts_max: number | null;
  wind_gusts_mean: number | null;
  et0: number | null;
  radiation_sum: number | null;
  soil_temp_0_7: number | null;
  soil_temp_7_28: number | null;
  soil_moisture_0_7: number | null;
  soil_moisture_7_28: number | null;
}

const r1 = (v: number | null) => (v == null ? null : Math.round(v * 10) / 10);
const r3 = (v: number | null) => (v == null ? null : Math.round(v * 1000) / 1000);
function stats(values: (number | null | undefined)[]) {
  const xs = values.filter((v): v is number => v != null && Number.isFinite(v));
  if (!xs.length) return { min: null, max: null, mean: null, sum: null };
  const sum = xs.reduce((a, b) => a + b, 0);
  return { min: Math.min(...xs), max: Math.max(...xs), mean: sum / xs.length, sum };
}

/**
 * Daily values from hourly ones, per local day. Days with fewer than 20 hours (the edges of a
 * request) are left out so a partial day never overwrites a full one.
 */
export function aggregateDaily(h: HourlyResponse['hourly'], soil: typeof SOIL_FORECAST): DailyRow[] {
  const days = new Map<string, number[]>();
  h.time.forEach((t, i) => {
    const d = t.slice(0, 10);
    days.set(d, [...(days.get(d) ?? []), i]);
  });
  const col = (name: string, idx: number[]) => idx.map((i) => h[name]?.[i] ?? null);
  const out: DailyRow[] = [];
  for (const [date, idx] of days) {
    if (idx.length < 20) continue;
    const temp = stats(col('temperature_2m', idx));
    if (temp.mean == null) continue;
    const hum = stats(col('relative_humidity_2m', idx));
    const dew = stats(col('dew_point_2m', idx));
    const wind = stats(col('wind_speed_10m', idx));
    const gust = stats(col('wind_gusts_10m', idx));
    out.push({
      date,
      temp_min: r1(temp.min),
      temp_max: r1(temp.max),
      temp_mean: r1(temp.mean),
      precipitation: r1(stats(col('precipitation', idx)).sum),
      humidity_min: r1(hum.min),
      humidity_max: r1(hum.max),
      humidity_mean: r1(hum.mean),
      dew_point_min: r1(dew.min),
      dew_point_max: r1(dew.max),
      dew_point_mean: r1(dew.mean),
      wind_speed_max: r1(wind.max),
      wind_speed_mean: r1(wind.mean),
      wind_gusts_max: r1(gust.max),
      wind_gusts_mean: r1(gust.mean),
      et0: r1(stats(col('et0_fao_evapotranspiration', idx)).sum),
      // W/m² hourly means → MJ/m² per day.
      radiation_sum: r1(stats(col('shortwave_radiation', idx)).sum == null ? null : stats(col('shortwave_radiation', idx)).sum! * 0.0036),
      soil_temp_0_7: r1(stats(col(soil.temp0, idx)).mean),
      soil_temp_7_28: r1(stats(col(soil.temp7, idx)).mean),
      soil_moisture_0_7: r3(stats(col(soil.moist0, idx)).mean),
      soil_moisture_7_28: r3(stats(col(soil.moist7, idx)).mean),
    });
  }
  return out;
}

async function getJson(url: string): Promise<HourlyResponse> {
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}: ${(await res.text().catch(() => '')).slice(0, 300)}`);
  return (await res.json()) as HourlyResponse;
}

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

const logger = new Logger('WeatherStore');

/** Hourly: queue one fetch per due cell. */
export const weatherScanHandler =
  (db: Kysely<DB>): JobHandler =>
  async () => {
    const now = new Date();
    const { rows } = await sql<{ lat: string; lng: string; timezones: string[]; season_start: string | null }>`SELECT * FROM app.weather_cell_demand()`.execute(db);
    const demand: CellDemand[] = rows.map((r) => ({ lat: Number(r.lat), lng: Number(r.lng), timezones: r.timezones, seasonStart: r.season_start }));
    const states = (await db.selectFrom('weather_cells').select(['lat', 'lng', 'backfilled_from', 'refreshed_at']).execute()).map((s) => ({
      lat: Number(s.lat),
      lng: Number(s.lng),
      backfilledFrom: s.backfilled_from,
      refreshedAt: s.refreshed_at ? new Date(s.refreshed_at) : null,
    }));
    const due = dueCells(demand, states, now).slice(0, MAX_CELLS_PER_SCAN);
    const today = now.toISOString().slice(0, 10);
    for (const { cell, backfill } of due) {
      await enqueue(db, {
        kind: WEATHER_CELL,
        payload: { lat: cell.lat, lng: cell.lng, backfillFrom: backfill ? wantedStart(cell, today) : null },
        // One fetch per cell and hour.
        dedupeKey: `${cellKey(cell)}:${now.toISOString().slice(0, 13)}`,
        maxAttempts: 4,
      });
    }
    if (due.length) logger.log(`Queued ${due.length} weather cells (${due.filter((d) => d.backfill).length} with backfill)`);
  };

/** Fetches one cell: the archive from the wanted start if it is missing, then the forecast window. */
export const weatherCellHandler =
  (db: Kysely<DB>): JobHandler =>
  async (job) => {
    const { lat, lng, backfillFrom } = job.payload as { lat: number; lng: number; backfillFrom: string | null };
    try {
      await refreshCell(db, lat, lng, backfillFrom);
    } catch (e) {
      await db
        .insertInto('weather_cells')
        .values({ lat, lng, last_error: (e as Error).message.slice(0, 1000), last_error_at: new Date() })
        .onConflict((oc) => oc.columns(['lat', 'lng']).doUpdateSet({ last_error: (e as Error).message.slice(0, 1000), last_error_at: new Date() }))
        .execute();
      throw e;
    }
  };

export async function refreshCell(db: Kysely<DB>, lat: number, lng: number, backfillFrom: string | null) {
  const today = new Date().toISOString().slice(0, 10);
  let archiveFrom: string | null = null;
  const archive = backfillFrom ? archiveUrl(lat, lng, backfillFrom, addDays(today, -ARCHIVE_LAG_DAYS)) : null;
  const archiveData = archive && backfillFrom && backfillFrom <= addDays(today, -ARCHIVE_LAG_DAYS) ? await getJson(archive) : null;
  if (archiveData) archiveFrom = backfillFrom;
  // Without an archive subscription the forecast API covers the last 92 days of the backfill.
  const pastDays = backfillFrom && !archiveData ? FORECAST_MAX_PAST_DAYS : PAST_DAYS;
  const forecast = await getJson(forecastUrl(lat, lng, pastDays));

  await db.transaction().execute(async (trx) => {
    await trx
      .insertInto('weather_cells')
      .values({ lat, lng, timezone: forecast.timezone, utc_offset_seconds: forecast.utc_offset_seconds, refreshed_at: new Date(), last_error: null })
      .onConflict((oc) =>
        oc.columns(['lat', 'lng']).doUpdateSet({ timezone: forecast.timezone, utc_offset_seconds: forecast.utc_offset_seconds, refreshed_at: new Date(), last_error: null }),
      )
      .execute();
    const upsertDaily = async (rows: DailyRow[], source: 'archive' | 'forecast') => {
      for (let i = 0; i < rows.length; i += 500) {
        const chunk = rows.slice(i, i + 500).map((r) => ({ lat, lng, ...r, source }));
        if (!chunk.length) continue;
        await trx
          .insertInto('weather_daily')
          .values(chunk)
          .onConflict((oc) => {
            const set = Object.fromEntries(Object.keys(chunk[0]).filter((k) => !['lat', 'lng', 'date'].includes(k)).map((k) => [k, sql.ref(`excluded.${k}`)]));
            // Archive days are final: a forecast never overwrites one.
            return source === 'archive' ? oc.columns(['lat', 'lng', 'date']).doUpdateSet(set) : oc.columns(['lat', 'lng', 'date']).doUpdateSet(set).where('weather_daily.source', '=', 'forecast');
          })
          .execute();
      }
    };
    if (archiveData) await upsertDaily(aggregateDaily(archiveData.hourly, SOIL_ARCHIVE), 'archive');
    await upsertDaily(aggregateDaily(forecast.hourly, SOIL_FORECAST), 'forecast');

    // The hourly window is replaced as a whole.
    const offset = forecast.utc_offset_seconds;
    const h = forecast.hourly;
    const since = new Date(Date.now() - PAST_DAYS * 86_400_000);
    const hourly = h.time
      .map((t, i) => ({
        lat,
        lng,
        // Open-Meteo applies one offset to every time of a response.
        time: new Date(Date.parse(`${t}:00Z`) - offset * 1000),
        temp: h.temperature_2m?.[i] ?? null,
        humidity: h.relative_humidity_2m?.[i] ?? null,
        dew_point: h.dew_point_2m?.[i] ?? null,
        precipitation: h.precipitation?.[i] ?? null,
        precipitation_probability: h.precipitation_probability?.[i] ?? null,
        wind_speed: h.wind_speed_10m?.[i] ?? null,
        wind_gusts: h.wind_gusts_10m?.[i] ?? null,
      }))
      .filter((x) => x.time >= since);
    await trx.deleteFrom('weather_hourly').where('lat', '=', lat).where('lng', '=', lng).execute();
    for (let i = 0; i < hourly.length; i += 500) await trx.insertInto('weather_hourly').values(hourly.slice(i, i + 500)).execute();

    const first = archiveFrom ?? (backfillFrom ? addDays(today, -FORECAST_MAX_PAST_DAYS) : null);
    if (first) {
      await trx
        .updateTable('weather_cells')
        .set({ backfilled_from: sql<string>`least(coalesce(backfilled_from, ${first}::date), ${first}::date)` })
        .where('lat', '=', lat)
        .where('lng', '=', lng)
        .execute();
    }
  });
}
