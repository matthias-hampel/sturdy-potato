/**
 * Ported from AGVOLUTION/agmeo src/lib/weather/hourlyWindow.ts — logic, numbers and
 * thresholds unchanged; only imports adapted to the rewrite.
 */

/**
 * Instants of the hourly weather series and fixed-window sums over it.
 *
 * Open-Meteo returns hourly `time` as wall-clock strings without an offset
 * ("2026-09-26T06:00") and stamps the WHOLE range with the single offset in force at
 * request time (`utc_offset_seconds`; no DST step inside a range — verified 2026-09-27
 * against the archive API). The crawler stores that offset and the zone in the payload;
 * payloads from before that were all requested as Europe/Berlin. Parsing the strings with
 * `new Date()` would read them as UTC on Vercel, one to two hours off in Europe and many
 * more elsewhere — every reader goes through {@link hourlyInstantsMs} instead.
 */
import { addDaysUtc } from '../dates.js';
import type { WeatherHourlyTimeseries } from '../types.js';
import {
  isValidTimeZone,
  localDayBoundary,
  zonedWallClockToUtc,
} from '../timezone.js';

/** Zone every hourly payload was requested in before the crawler stored one. */
const LEGACY_HOURLY_TIMEZONE = 'Europe/Berlin';

const HOUR_MS = 60 * 60 * 1000;

const hasExplicitOffset = (time: string) =>
  /(?:Z|[+-]\d{2}:?\d{2})$/.test(time);

/** Wall clock in a zone → UTC instant, e.g. {@link zonedWallClockToUtc} or a caller's memo of it. */
export type WallClockToUtc = (isoLocal: string, tz: string) => Date;

/**
 * UTC instants (ms) of every entry of the series; NaN for entries that cannot be read.
 * Precedence: an explicit offset in the string → the payload's fixed `utcOffsetSeconds`
 * (exactly how Open-Meteo produced the strings) → the payload's `timezone` read as a
 * DST-aware wall clock (defensive, for hand-made payloads) → legacy Berlin wall clock.
 * Org-wide readers pass a memoized `toUtc`: every field carries the same timestamps.
 */
export function hourlyInstantsMs(
  hourly: Pick<
    WeatherHourlyTimeseries,
    'time' | 'timezone' | 'utcOffsetSeconds'
  >,
  toUtc: WallClockToUtc = zonedWallClockToUtc,
): number[] {
  const offsetMs =
    typeof hourly.utcOffsetSeconds === 'number'
      ? hourly.utcOffsetSeconds * 1000
      : null;
  const zone = isValidTimeZone(hourly.timezone) ? hourly.timezone : null;
  return hourly.time.map((time) => {
    if (hasExplicitOffset(time)) return Date.parse(time);
    try {
      if (offsetMs !== null)
        return (
          Date.parse(`${time.length === 16 ? `${time}:00` : time}Z`) - offsetMs
        );
      return toUtc(time, zone ?? LEGACY_HOURLY_TIMEZONE).getTime();
    } catch {
      return Number.NaN;
    }
  });
}

/** Share of the window's hours that must be present for a sum to count. */
const MIN_COVERAGE = 0.8;

/**
 * Sum of hourly precipitation for entries with `startUtc <= t < endUtc`. Null when the
 * series covers fewer than 80 % of the window's hours — a partial sum would read as
 * "little rain" where the truth is "no data".
 */
export function sumHourlyPrecipitation(
  hourly: WeatherHourlyTimeseries | null | undefined,
  startUtc: Date,
  endUtc: Date,
): { mm: number; hours: number } | null {
  if (!hourly?.time?.length) return null;
  const instants = hourlyInstantsMs(hourly);
  const start = startUtc.getTime();
  const end = endUtc.getTime();
  let total = 0;
  let hours = 0;
  for (let i = 0; i < instants.length; i++) {
    const t = instants[i];
    if (Number.isNaN(t) || t < start || t >= end) continue;
    total += hourly.precipitation[i] ?? 0;
    hours++;
  }
  const expected = Math.round((end - start) / HOUR_MS);
  if (expected <= 0 || hours < expected * MIN_COVERAGE) return null;
  return { mm: Math.round(total * 10) / 10, hours };
}

export type RainWindow = {
  startUtc: Date;
  endUtc: Date;
  /** Wall-clock labels in the org's zone, for the mail. */
  startLocal: string;
  endLocal: string;
};

/** The digest window: `hour` local on the day before `localDate` up to `hour` local on `localDate`. */
export function rainWindowFor(
  localDate: string,
  tz: string,
  hour = '06:00',
): RainWindow {
  const previous = addDaysUtc(localDate, -1);
  return {
    startUtc: localDayBoundary(previous, hour, tz),
    endUtc: localDayBoundary(localDate, hour, tz),
    startLocal: `${previous}T${hour}`,
    endLocal: `${localDate}T${hour}`,
  };
}
