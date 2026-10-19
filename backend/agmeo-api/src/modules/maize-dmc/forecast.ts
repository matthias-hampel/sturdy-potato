/**
 * Mapping of a maize-dmc-api response to our forecast, and the derived values the page shows,
 * after the reference's lib/maizeDmc/forecast.ts. No I/O.
 */
import type { DmcCalibrationApplied, DmcDayPrediction, DmcHarvestWindow, DmcResolution } from '@agmeo/contracts';
import { addDaysUTC } from './weather-block.js';
import type { ResolvedCalibration } from './calibration.js';
import type { PredictResponse } from './types.js';

/** Silage maize is cut between 30 and 35 % whole-plant DM (32–35 % ideal). */
export const SILAGE_WINDOW_START_DM = 0.3;
export const SILAGE_WINDOW_END_DM = 0.35;
/** Extrapolate the dry-down at most this far past the forecast horizon. */
const MAX_EXTRAPOLATION_DAYS = 60;
/** Below this daily DM gain the dry-down is too flat to extrapolate. */
const MIN_DAILY_GAIN = 0.0005;

export const todayUTC = () => new Date().toISOString().slice(0, 10);

/** EPSG:3857 metres → WGS84 [west, south, east, north]. */
export function bbox3857ToBounds(b: readonly [number, number, number, number] | null | undefined): [number, number, number, number] | null {
  if (!b || b.length !== 4 || !b.every(Number.isFinite)) return null;
  const R = 6378137;
  const lon = (x: number) => (x / R) * (180 / Math.PI);
  const lat = (y: number) => (Math.atan(Math.sinh(y / R)) * 180) / Math.PI;
  return [lon(b[0]), lat(b[1]), lon(b[2]), lat(b[3])];
}

/** Daily predictions with raster paths below /v1 (proxied through our API, org-checked). */
export function mapDailyPredictions(api: PredictResponse, orgId: string, resolution: DmcResolution): DmcDayPrediction[] {
  const base = `/orgs/${orgId}/maize-dmc/runs/${api.execution_id}/results`;
  return api.daily_predictions.map((d) => ({
    date: d.date,
    median: d.dm_mean,
    q5: d.dm_p10,
    q95: d.dm_p90,
    medianUncalibrated: d.dm_mean_uncalibrated ?? null,
    accumulatedGdd: d.accumulated_gdd,
    temperatureMeanC: d.temperature_mean_c,
    pngPath: `${base}/${d.date}?output=png&resolution=${resolution}`,
    tiffPath: `${base}/${d.date}?output=tiff&resolution=${resolution}`,
  }));
}

export function calibrationApplied(api: PredictResponse, resolved: ResolvedCalibration | null): DmcCalibrationApplied | null {
  if (!resolved || !api.calibration) return null;
  return {
    kind: resolved.kind,
    measuredDm: api.calibration.measured_dm ?? null,
    measuredAt: api.calibration.measured_at ?? null,
    offset: api.calibration.offset,
  };
}

/** The prediction arrays stored on a run (columns of maize_dmc_runs; index 0 = pred_from_date). */
export function denormOf(api: PredictResponse) {
  const preds = api.daily_predictions;
  return {
    pred_from_date: preds[0]?.date ?? null,
    pred_medians: preds.map((d) => d.dm_mean),
    pred_p10: preds.map((d) => d.dm_p10),
    pred_p90: preds.map((d) => d.dm_p90),
    accumulated_gdd: preds[0]?.accumulated_gdd ?? null,
  };
}

export interface StoredPredictions {
  pred_from_date: string | null;
  pred_medians: number[] | null;
  pred_p10: number[] | null;
  pred_p90: number[] | null;
}

/** The stored arrays as dated days. */
export function storedDays(r: StoredPredictions): { date: string; median: number; q5: number; q95: number }[] {
  if (!r.pred_from_date || !r.pred_medians) return [];
  return r.pred_medians.map((median, i) => ({
    date: addDaysUTC(r.pred_from_date as string, i),
    median,
    q5: r.pred_p10?.[i] ?? median,
    q95: r.pred_p90?.[i] ?? median,
  }));
}

/** Value of a stored run on a given day, or null when the day is outside its window. */
export function storedValueOn(r: StoredPredictions, day: string): { median: number; q5: number; q95: number } | null {
  const d = storedDays(r).find((x) => x.date === day);
  return d ? { median: d.median, q5: d.q5, q95: d.q95 } : null;
}

/**
 * When the silage window opens (median ≥ 30 % DM) and closes (≥ 35 %): read off the forecast
 * when it gets there, else extrapolated with the mean daily gain over the forecast window.
 * DM rises monotonically while the crop matures, so a window that is already open starts at
 * (or before) the first forecast day. Null without predictions or when the dry-down is too
 * flat to extrapolate the opening.
 */
export function harvestWindowOf(daily: readonly { date: string; median: number }[]): DmcHarvestWindow | null {
  const days = [...daily].sort((a, b) => a.date.localeCompare(b.date));
  if (days.length === 0) return null;
  const first = days[0];
  const last = days[days.length - 1];
  const gain = days.length > 1 ? (last.median - first.median) / (days.length - 1) : 0;
  let estimated = false;
  const reach = (threshold: number): string | null => {
    const hit = days.find((d) => d.median >= threshold);
    if (hit) return hit.date;
    if (gain < MIN_DAILY_GAIN) return null;
    const ahead = Math.ceil((threshold - last.median) / gain);
    if (ahead > MAX_EXTRAPOLATION_DAYS) return null;
    estimated = true;
    return addDaysUTC(last.date, ahead);
  };
  const start = reach(SILAGE_WINDOW_START_DM);
  const end = reach(SILAGE_WINDOW_END_DM);
  if (!start && !end) return null;
  return { start, end, estimated };
}
