/**
 * Shared utilities for export modules
 *
 * Pure functions with no server dependencies — safe for client import.
 *
 * The Düngejahr is a twelve-month window that starts in the month the farm
 * chose (`duengejahrbeginn`). With the default JANUAR it is the calendar year
 * of the export; a JULI start yields 1 July (year-1) → 30 June (year).
 */

import type { DuengejahrbeginnType, DuengejahrWindow } from './types.js';

const EUROPE_BERLIN = 'Europe/Berlin';

export const DUENGEJAHRBEGINN_MONTH: Record<DuengejahrbeginnType, number> = {
  JANUAR: 1,
  FEBRUAR: 2,
  MAERZ: 3,
  APRIL: 4,
  MAI: 5,
  JUNI: 6,
  JULI: 7,
  AUGUST: 8,
  SEPTEMBER: 9,
  OKTOBER: 10,
  NOVEMBER: 11,
  DEZEMBER: 12,
};

export function createBerlinDate(
  year: number,
  month: number,
  day: number,
  endOfDay = false,
): Date {
  const isDST = isDateInBerlinDST(year, month, day);
  const offsetHours = isDST ? 2 : 1;

  const hours = endOfDay ? 23 : 0;
  const minutes = endOfDay ? 59 : 0;
  const seconds = endOfDay ? 59 : 0;
  const ms = endOfDay ? 999 : 0;

  return new Date(
    Date.UTC(year, month - 1, day, hours - offsetHours, minutes, seconds, ms),
  );
}

function isDateInBerlinDST(year: number, month: number, day: number): boolean {
  const marchLast = new Date(year, 2, 31);
  const marchLastSunday = 31 - marchLast.getDay();

  const octLast = new Date(year, 9, 31);
  const octLastSunday = 31 - octLast.getDay();

  if (month > 3 && month < 10) return true;
  if (month < 3 || month > 10) return false;
  if (month === 3) return day >= marchLastSunday;
  if (month === 10) return day < octLastSunday;

  return false;
}

function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Twelve-month Düngejahr ending in `year`. JANUAR = calendar year `year`;
 * any later start month m = 1.m.(year-1) … last day of (m-1).year.
 */
export function getDuengejahrWindow(
  year: number,
  beginn: DuengejahrbeginnType = 'JANUAR',
): DuengejahrWindow {
  const month = DUENGEJAHRBEGINN_MONTH[beginn];
  if (month === 1) {
    return {
      year,
      beginn,
      start: createBerlinDate(year, 1, 1),
      end: createBerlinDate(year, 12, 31, true),
    };
  }
  const endMonth = month - 1;
  return {
    year,
    beginn,
    start: createBerlinDate(year - 1, month, 1),
    end: createBerlinDate(year, endMonth, lastDayOfMonth(year, endMonth), true),
  };
}

export function isDateInWindow(
  date: Date,
  window: { start: Date; end: Date },
): boolean {
  return date >= window.start && date <= window.end;
}

export function formatExportDate(date: Date): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: EUROPE_BERLIN,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(date);
}

/** dd.mm.yyyy in Europe/Berlin — for preflight messages, not for the files. */
export function formatGermanDate(date: Date): string {
  return new Intl.DateTimeFormat('de-DE', {
    timeZone: EUROPE_BERLIN,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function formatExportDecimal(
  value: number | null | undefined,
  decimals = 6,
): string {
  if (value === null || value === undefined) return (0).toFixed(decimals);
  return value.toFixed(decimals);
}
