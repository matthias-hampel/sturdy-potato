/**
 * Ported from AGVOLUTION/agmeo src/lib/dates.ts — UTC-safe calendar-date helpers, unchanged.
 */

/**
 * UTC-safe helpers for calendar dates written as `YYYY-MM-DD`.
 *
 * A plain `new Date("2026-01-01")` parses as UTC midnight, but `getDate()`,
 * `getMonth()` and `getFullYear()` read the *local* clock. West of Greenwich
 * that pair reports the previous day, so `dayOfYear("2026-01-01")` returned
 * 365 and a BESYD export printed `14.01.2025` for `2025-01-15`. Day arithmetic
 * on a fixed 86_400_000 ms step has the same problem across a DST boundary: it
 * loses or gains an hour and rounds to the wrong day.
 *
 * These helpers stay in UTC end to end, so their output does not depend on
 * where the process runs. Use them for dates that identify a **day** — sowing,
 * harvest, a weather record. Local formatting for display is a different job
 * and should keep using the locale-aware formatters.
 */

const MS_PER_DAY = 86_400_000;

/** `YYYY-MM-DD` at UTC midnight. Throws on anything that is not a calendar date. */
export function parseIsoDateUtc(iso: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) throw new Error(`Not an ISO calendar date: ${iso}`);
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (Number.isNaN(date.getTime())) throw new Error(`Not a valid date: ${iso}`);
  return date;
}

/** The `YYYY-MM-DD` of a Date, read in UTC. */
export function toIsoDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

/**
 * Day of year, 1 on January 1st. 366 in a leap year — callers that index a
 * 365-long table must clamp rather than wrap.
 */
export function dayOfYearUtc(iso: string): number {
  const date = parseIsoDateUtc(iso);
  const yearStart = Date.UTC(date.getUTCFullYear(), 0, 1);
  return Math.round((date.getTime() - yearStart) / MS_PER_DAY) + 1;
}

/** Whole days from `from` to `to`; negative when `to` is earlier. */
export function diffDaysUtc(from: string, to: string): number {
  return Math.round(
    (parseIsoDateUtc(to).getTime() - parseIsoDateUtc(from).getTime()) /
      MS_PER_DAY,
  );
}

/** `iso` shifted by whole days, as `YYYY-MM-DD`. */
export function addDaysUtc(iso: string, days: number): string {
  const date = parseIsoDateUtc(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return toIsoDate(date);
}

/** Days in the calendar year — 366 when it is a leap year. */
export function daysInYearUtc(year: number): number {
  return (Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / MS_PER_DAY;
}
