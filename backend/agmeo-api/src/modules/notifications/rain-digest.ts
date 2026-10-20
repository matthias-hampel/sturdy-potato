/**
 * Daily rainfall report (reference: lib/rain-digest/schedule.ts and digest.ts; thresholds and
 * timing unchanged). The worker evaluates every quarter hour per organization, in the local time
 * of its first farm:
 *
 *   before 06:30       → not yet
 *   06:30 … 09:30      → send once ≥ 90 % of the fields carry this morning's weather refresh
 *   09:30 … 12:00      → send anyway, with the time of the oldest weather data
 *   after 12:00        → skip the day
 */
import type { MeasurementSystem } from '@agmeo/contracts';

export const SEND_FROM_MINUTES = 6 * 60 + 30;
const DEADLINE_MINUTES = 9 * 60 + 30;
const LATE_CUTOFF_MINUTES = 12 * 60;
const FRESH_FRACTION = 0.9;
const LIST_SIZE = 5;
const MM_PER_INCH = 25.4;

/** "At least this much rain": 1 mm for metric readers, a tenth of an inch for imperial ones. */
export const RAIN_THRESHOLD_MM: Record<MeasurementSystem, number> = { metric: 1, imperial: MM_PER_INCH / 10 };

export type DigestDecision = 'not-yet' | 'wait-for-weather' | 'send' | 'send-late' | 'skip-day';

export function decideDigest(input: { localMinutes: number; total: number; fresh: number }): DigestDecision {
  const { localMinutes, total, fresh } = input;
  if (localMinutes < SEND_FROM_MINUTES) return 'not-yet';
  if (total === 0 || localMinutes >= LATE_CUTOFF_MINUTES) return 'skip-day';
  if (fresh / total >= FRESH_FRACTION) return 'send';
  if (localMinutes >= DEADLINE_MINUTES) return 'send-late';
  return 'wait-for-weather';
}

export interface DigestInputRow {
  fieldId: string;
  farmId: string;
  name: string;
  areaHa: number;
  crop: string | null;
  /** Rain in the window; null when the weather does not cover it (left out, not shown as 0 mm). */
  precipMm: number | null;
  refreshedAt: Date | null;
}

export interface DigestField {
  fieldId: string;
  name: string;
  areaHa: number;
  crop: string | null;
  precipMm: number;
}

export interface RainDigest {
  thresholdMm: number;
  totalFields: number;
  rainedFields: number;
  /** Up to five fields, driest first. */
  least: DigestField[];
  /** Up to five fields, wettest first. */
  most: DigestField[];
  /** Oldest weather refresh of the listed fields. */
  dataAsOf: Date | null;
  /** The weather missed this morning's refresh. */
  stale: boolean;
}

const byRainThenName = (a: DigestField, b: DigestField) => a.precipMm - b.precipMm || a.name.localeCompare(b.name);

/**
 * Rows → the digest of one reader, or null when no row has a usable rain sum. `farmIds` limits the
 * rows to the farms a member may see (null = all).
 */
export function buildRainDigest(rows: DigestInputRow[], opts: { system: MeasurementSystem; freshCutoff: Date; farmIds: string[] | null }): RainDigest | null {
  const fields: DigestField[] = [];
  let dataAsOf: Date | null = null;
  for (const row of rows) {
    if (row.precipMm == null) continue;
    if (opts.farmIds && !opts.farmIds.includes(row.farmId)) continue;
    fields.push({ fieldId: row.fieldId, name: row.name, areaHa: row.areaHa, crop: row.crop, precipMm: Math.round(row.precipMm * 10) / 10 });
    if (row.refreshedAt && (!dataAsOf || row.refreshedAt < dataAsOf)) dataAsOf = row.refreshedAt;
  }
  if (!fields.length) return null;
  const thresholdMm = RAIN_THRESHOLD_MM[opts.system];
  const sorted = [...fields].sort(byRainThenName);
  return {
    thresholdMm,
    totalFields: fields.length,
    rainedFields: fields.filter((f) => f.precipMm >= thresholdMm).length,
    least: sorted.slice(0, LIST_SIZE),
    most: [...sorted].reverse().slice(0, LIST_SIZE),
    dataAsOf,
    stale: dataAsOf === null || dataAsOf < opts.freshCutoff,
  };
}
