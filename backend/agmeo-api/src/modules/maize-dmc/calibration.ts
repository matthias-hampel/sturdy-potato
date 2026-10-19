/**
 * Calibration logic without I/O, after the reference's lib/maizeDmc (runs.ts, calibrations.ts,
 * format.ts, offsetBatches.ts, lookup.ts).
 *
 * A forecast is calibrated by, in this order:
 *  1. the newest active measurement of the cycle (field mode: the service anchors the curve on it);
 *  2. the active offset of the cycle's variety for the harvest year (offset mode);
 *  3. nothing (standard run).
 * The resolved calibration is hashed into the run key, so a new measurement or offset yields a
 * fresh run without any explicit cache invalidation.
 */
import { createHash } from 'node:crypto';
import type { DmcOffsetBatch } from '@agmeo/contracts';
import type { CalibrationSpec } from './types.js';

export interface ResolvedCalibration {
  kind: 'measurement' | 'variety_offset';
  spec: CalibrationSpec;
  /** Where the calibration came from; part of the run key. */
  source: string;
  hash: string;
}

/** Hash of a resolved calibration spec plus its source tag. */
export function calibrationHashOfSpec(spec: CalibrationSpec, source: string): string {
  const canonical = 'offset' in spec ? `offset:${spec.offset.toFixed(6)}` : `field:${spec.measured_at}|${spec.measured_dm.toFixed(6)}`;
  return createHash('sha256').update(`${source}|${canonical}`).digest('hex').slice(0, 32);
}

export function resolveCalibration(args: {
  cropCycleId: string;
  harvestYear: number;
  measurement: { id: string; measurementDate: string; measuredDm: number } | null;
  varietyOffset: { id: string; varietyId: string; offset: number } | null;
}): ResolvedCalibration | null {
  if (args.measurement) {
    const spec: CalibrationSpec = { measured_dm: args.measurement.measuredDm, measured_at: args.measurement.measurementDate };
    const source = `measurement:${args.measurement.id}`;
    return { kind: 'measurement', spec, source, hash: calibrationHashOfSpec(spec, source) };
  }
  if (args.varietyOffset) {
    const spec: CalibrationSpec = { offset: args.varietyOffset.offset };
    // The offset row's id keys the source so re-applying or revoking busts the run cache.
    const source = `variety-offset:${args.varietyOffset.varietyId}:${args.harvestYear}:${args.varietyOffset.id}`;
    return { kind: 'variety_offset', spec, source, hash: calibrationHashOfSpec(spec, source) };
  }
  return null;
}

/** Model median of the day nearest the measurement date. */
export function modelMedianNearest(daily: readonly { date: string; median: number }[], measurementDate: string): number | null {
  if (daily.length === 0) return null;
  const target = Date.parse(measurementDate);
  let best = daily[0];
  let bestDiff = Math.abs(Date.parse(best.date) - target);
  for (const d of daily) {
    const diff = Math.abs(Date.parse(d.date) - target);
    if (diff < bestDiff) {
      best = d;
      bestDiff = diff;
    }
  }
  return best.median;
}

/** Mean of pooled measurement offsets (the suggested variety offset); null when the pool is empty. */
export function meanOffset(offsets: readonly number[]): number | null {
  if (offsets.length === 0) return null;
  return offsets.reduce((a, b) => a + b, 0) / offsets.length;
}

/**
 * FAO maturity from a value or a text like "S 250" / "K 220" / "250"; null when it does not
 * parse. The model supports 150–800.
 */
export function parseFaoMaturity(value: number | string | null | undefined): number | null {
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value) : null;
  const m = value.trim().match(/^[SK]?\s*(\d+(?:[.,]\d+)?)$/i);
  return m ? Math.round(Number(m[1].replace(',', '.'))) : null;
}

export const FAO_MIN = 150;
export const FAO_MAX = 800;

export interface OffsetRow {
  id: string;
  varietyId: string;
  variety: string | null;
  offset: number;
  suggestedOffset: number | null;
  basisCount: number;
  basisFrom: string | null;
  basisTo: string | null;
  comment: string | null;
  appliedBy: string | null;
  appliedAt: string;
  supersededAt: string | null;
}

const varietyName = (v: { variety: string | null; varietyId: string }) => v.variety ?? v.varietyId;

/**
 * Group per-variety offset rows into apply batches: rows sharing apply time, user, offset and
 * revocation state are one batch (a partial revoke splits a batch). Varieties sorted by name,
 * batches newest first.
 */
export function groupOffsetBatches(rows: readonly OffsetRow[]): DmcOffsetBatch[] {
  const byKey = new Map<string, DmcOffsetBatch>();
  for (const row of rows) {
    const key = `${row.appliedAt}|${row.appliedBy ?? ''}|${row.offset}|${row.supersededAt ?? 'active'}`;
    const batch = byKey.get(key);
    if (batch) {
      batch.varieties.push({ rowId: row.id, varietyId: row.varietyId, variety: row.variety });
      continue;
    }
    byKey.set(key, {
      key,
      offset: row.offset,
      suggestedOffset: row.suggestedOffset,
      basisCount: row.basisCount,
      basisFrom: row.basisFrom,
      basisTo: row.basisTo,
      comment: row.comment,
      appliedBy: row.appliedBy,
      appliedAt: row.appliedAt,
      supersededAt: row.supersededAt,
      varieties: [{ rowId: row.id, varietyId: row.varietyId, variety: row.variety }],
    });
  }
  const batches = [...byKey.values()];
  for (const batch of batches) batch.varieties.sort((a, b) => varietyName(a).localeCompare(varietyName(b)));
  batches.sort((a, b) => b.appliedAt.localeCompare(a.appliedAt));
  return batches;
}
