/**
 * Ported from AGVOLUTION/agmeo src/lib/weather/climateBaseline.ts — logic, numbers and
 * thresholds unchanged; only imports adapted to the rewrite.
 */

/**
 * Climate-context baseline computation for the mobile assistant.
 *
 * The assistant's `climateContext` skill (in @agvolution/agmeo-assistant)
 * computes THIS season's metrics from a daily series and compares them to a
 * per-metric climatology BASELINE the host supplies. This module produces that
 * baseline: it re-derives the same season metrics over each of the last N
 * years and reduces them to mean / sd / p10 / p50 / p90.
 *
 * The metric formulas + thresholds below are a faithful 1:1 PORT of the core's
 * `computeSeasonMetrics` / `longestDrySpell` / `springOnset` (agmeo-assistant
 * src/skills/climateContext.ts). SOURCE OF TRUTH is that file — keep the two in
 * sync (constants: GDD_BASE_C, DRY_DAY_MM, HOT_DAY_C, HARD_FROST_C,
 * STORM_GUST_MS, SPRING_ONSET_*). The core recomputes this-season values from
 * the `daily` we return, so only the baseline needs to match.
 */

/** One day of the season series. `humidityPct` is currently unavailable from
 *  the archive daily API (hourly-only) so disease-favorable days degrade. */
export interface ClimateDaily {
  date: string; // YYYY-MM-DD
  tempMin: number;
  tempMax: number;
  precipMm: number;
  radiationMj?: number | null;
  windMaxMs?: number | null;
  humidityPct?: number | null;
}

export interface ClimateBaselineStat {
  mean: number;
  sd?: number | null;
  p10?: number | null;
  p50?: number | null;
  p90?: number | null;
  years: number;
}

export interface ClimateContextData {
  daily: ClimateDaily[];
  baselines: Record<string, ClimateBaselineStat>;
  sowingDate?: string | null;
  /** The point the weather was fetched for — the field centroid. A caller that
   *  computes a water balance needs the latitude for radiation, and without it
   *  in the response it has to guess or fetch the geometry a second time. */
  lat?: number;
  lon?: number;
}

export type ClimateMetric =
  | 'seasonPrecip'
  | 'springPrecip'
  | 'maxDrySpell'
  | 'winterMinTemp'
  | 'hardFrostDays'
  | 'springOnsetDoy'
  | 'gddSum'
  | 'hotDays'
  | 'radiationSum'
  | 'windPeak'
  | 'stormDays'
  | 'diseaseFavorableDays';

// ── config — MUST match the core (climateContext.ts) ───────────────────────
const GDD_BASE_C = 5;
export const DRY_DAY_MM = 1;
const HOT_DAY_C = 30;
const HARD_FROST_C = -12;
const STORM_GUST_MS = 17.2;
const SPRING_ONSET_RUN = 5;
const SPRING_ONSET_MEAN_C = 5;

function month(dateIso: string): number {
  return Number(dateIso.slice(5, 7));
}
function dayOfYear(dateIso: string): number {
  const y = Number(dateIso.slice(0, 4));
  const m = Number(dateIso.slice(5, 7));
  const d = Number(dateIso.slice(8, 10));
  const cum = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  return cum[m - 1] + d + (leap && m > 2 ? 1 : 0);
}
const isSpring = (iso: string) => month(iso) >= 3 && month(iso) <= 5;
const isWinter = (iso: string) => {
  const m = month(iso);
  return m === 12 || m === 1 || m === 2;
};
const sum = (xs: number[]) =>
  xs.reduce((s, x) => s + (Number.isFinite(x) ? x : 0), 0);

/** Longest run of consecutive dry days (precip < DRY_DAY_MM). */
function longestDrySpell(daily: ClimateDaily[]): number {
  let run = 0;
  let max = 0;
  for (const d of daily) {
    if ((d.precipMm ?? 0) < DRY_DAY_MM) {
      run += 1;
      if (run > max) max = run;
    } else run = 0;
  }
  return max;
}

/** Day-of-year spring "started": first SPRING_ONSET_RUN-day run with daily
 *  mean ≥ SPRING_ONSET_MEAN_C from Feb onward. null if never / no data. */
function springOnset(daily: ClimateDaily[]): number | null {
  let run = 0;
  for (const d of daily) {
    if (month(d.date) < 2) continue;
    const mean = (d.tempMin + d.tempMax) / 2;
    if (mean >= SPRING_ONSET_MEAN_C) {
      run += 1;
      if (run >= SPRING_ONSET_RUN)
        return dayOfYear(d.date) - (SPRING_ONSET_RUN - 1);
    } else run = 0;
  }
  return null;
}

/** Raw season metric values from the daily series (ported from the core). */
export function computeSeasonMetrics(
  daily: ClimateDaily[],
): Record<ClimateMetric, number | null> {
  const springDays = daily.filter((d) => isSpring(d.date));
  const winterDays = daily.filter((d) => isWinter(d.date));
  const gdd = sum(
    daily.map((d) => Math.max(0, (d.tempMin + d.tempMax) / 2 - GDD_BASE_C)),
  );
  const rad = daily
    .map((d) => d.radiationMj)
    .filter((x): x is number => x != null);
  const winds = daily
    .map((d) => d.windMaxMs)
    .filter((x): x is number => x != null);
  const disease = daily.filter(
    (d) =>
      d.humidityPct != null &&
      d.humidityPct >= 85 &&
      d.tempMax >= 15 &&
      d.tempMax <= 25,
  ).length;

  return {
    seasonPrecip: sum(daily.map((d) => d.precipMm)),
    springPrecip: springDays.length
      ? sum(springDays.map((d) => d.precipMm))
      : null,
    maxDrySpell: longestDrySpell(daily),
    winterMinTemp: winterDays.length
      ? Math.min(...winterDays.map((d) => d.tempMin))
      : null,
    hardFrostDays: winterDays.length
      ? winterDays.filter((d) => d.tempMin <= HARD_FROST_C).length
      : null,
    springOnsetDoy: springOnset(daily),
    gddSum: gdd,
    hotDays: daily.filter((d) => d.tempMax >= HOT_DAY_C).length,
    radiationSum: rad.length ? sum(rad) : null,
    windPeak: winds.length ? Math.max(...winds) : null,
    stormDays: winds.length
      ? winds.filter((w) => w >= STORM_GUST_MS).length
      : null,
    diseaseFavorableDays: daily.some((d) => d.humidityPct != null)
      ? disease
      : null,
  };
}

// ── baseline statistics ────────────────────────────────────────────────────

function mean(xs: number[]): number {
  return xs.length ? sum(xs) / xs.length : 0;
}
/** Sample standard deviation (n−1); null for < 2 values. */
function stddev(xs: number[]): number | null {
  if (xs.length < 2) return null;
  const m = mean(xs);
  const variance = sum(xs.map((x) => (x - m) ** 2)) / (xs.length - 1);
  return Math.sqrt(variance);
}
/** Linear-interpolated percentile (0..1) over a copy-sorted array. */
function percentile(xs: number[], q: number): number | null {
  if (xs.length === 0) return null;
  if (xs.length === 1) return xs[0];
  const sorted = [...xs].sort((a, b) => a - b);
  const idx = q * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/**
 * Reduce per-year metric values to a per-metric climatology baseline. Each
 * input entry is one year's `computeSeasonMetrics` output; nulls (metric not
 * applicable that year, e.g. no winter in the window) are dropped per metric.
 */
export function computeBaselines(
  perYear: Array<Record<ClimateMetric, number | null>>,
): Record<string, ClimateBaselineStat> {
  const metrics = Object.keys(
    perYear[0] ?? ({} as Record<ClimateMetric, number | null>),
  ) as ClimateMetric[];
  const out: Record<string, ClimateBaselineStat> = {};
  for (const metric of metrics) {
    const values = perYear
      .map((y) => y[metric])
      .filter((v): v is number => v != null && Number.isFinite(v));
    if (values.length === 0) continue;
    out[metric] = {
      mean: mean(values),
      sd: stddev(values),
      p10: percentile(values, 0.1),
      p50: percentile(values, 0.5),
      p90: percentile(values, 0.9),
      years: values.length,
    };
  }
  return out;
}

// ── date + geometry helpers ────────────────────────────────────────────────

/** "YYYY-MM-DD" shifted by `deltaYears` (clamps Feb-29 → Feb-28). */
export function shiftYears(dateIso: string, deltaYears: number): string {
  const y = Number(dateIso.slice(0, 4)) + deltaYears;
  const md = dateIso.slice(5);
  if (md === '02-29') {
    const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
    if (!leap) return `${y}-02-28`;
  }
  return `${y}-${md}`;
}

/** "YYYY-MM-DD" + n days (via UTC to avoid TZ drift). */
export function addDays(dateIso: string, n: number): string {
  const d = new Date(`${dateIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Whole days from a→b (b−a); negative if b precedes a. */
export function daysBetween(a: string, b: string): number {
  const ms =
    new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime();
  return Math.round(ms / 86_400_000);
}

/** min of two "YYYY-MM-DD" strings (ISO order == lexical order). */
export function minDate(a: string, b: string): string {
  return a <= b ? a : b;
}

type Position = number[];
function eachPosition(coords: unknown, fn: (p: Position) => void): void {
  if (!Array.isArray(coords)) return;
  if (typeof coords[0] === 'number' && typeof coords[1] === 'number') {
    fn(coords as Position);
    return;
  }
  for (const c of coords) eachPosition(c, fn);
}

/** Bounding-box centre [lon, lat] of any GeoJSON geometry; null if empty. */
export function bboxCentroid(geometry: unknown): [number, number] | null {
  const geom = geometry as { coordinates?: unknown } | null;
  if (!geom?.coordinates) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  eachPosition(geom.coordinates, ([x, y]) => {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  });
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;
  return [(minX + maxX) / 2, (minY + maxY) / 2];
}
