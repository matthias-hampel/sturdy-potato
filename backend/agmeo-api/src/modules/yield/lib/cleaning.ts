import { round } from "./grid.js";
import type { TrackCleaningStats } from "./track.js";
import type { YieldPoint } from "./types.js";

/**
 * Track-level cleaning for harvest-monitor points, ported from the Python
 * research pipeline (cleanRfield methodology). Two corrections, both applied
 * PER export set (per field/pass), never across a merged farm zip:
 *
 * - section calibration: different header sections (SECTIONID) of the same
 *   harvester often disagree systematically; minority sections are rescaled
 *   to the reference section's mean
 * - edge effects: points within a buffer of the harvested area's hull are
 *   dropped (turning maneuvers, compaction, boundary calibration errors)
 */

/** Sections whose mean deviates less than this from the reference stay untouched. */
const SECTION_CORRECTION_MIN_DEVIATION = 0.05;
const SECTION_MIN_POINTS = 50;

/**
 * When more sections than this would need rescaling, the machine is
 * fragmenting SECTIONID (observed: 178 "sections" on one grassland cut) and
 * per-section factors would smooth genuine spatial variation, not fix
 * calibration. The correction is skipped and reported instead.
 */
const MAX_CORRECTED_SECTIONS = 20;

const EDGE_BUFFER_M = 15;

export type CleaningStats = {
  /** Points dropped by the edge buffer */
  edgeRemoved: number;
  /**
   * Report of the track-level filters (flow delay, pass trim, velocity, overlap)
   * — see yieldMapTrack. Absent for sources with no usable time base.
   */
  track?: TrackCleaningStats;
  /** Sections rescaled to the reference section, with their factors */
  sectionsCorrected: Array<{ section: number; factor: number }>;
  /** Export sets whose section correction was skipped as fragmented-SECTIONID noise */
  sectionCorrectionSkipped?: number;
};

export type SectionCalibrationResult = {
  corrections: CleaningStats["sectionsCorrected"];
  /** true when too many sections diverged and nothing was rescaled (QC hint, not a correction) */
  skipped: boolean;
};

/**
 * Rescale header sections whose mean deviates from the GLOBAL mean — the
 * global mean is the reference, so a miscalibrated majority section cannot
 * pull all others its way (wide headers log 30+ section ids). Mutates point
 * values in place; returns the applied corrections. When more than
 * MAX_CORRECTED_SECTIONS diverge, nothing is rescaled — that pattern is
 * SECTIONID fragmentation, not calibration drift.
 */
export function correctSectionCalibration(points: YieldPoint[]): SectionCalibrationResult {
  const yieldsBySection = new Map<number, { sum: number; count: number }>();
  let globalSum = 0;
  let globalCount = 0;
  for (const point of points) {
    if (point.section === undefined) continue;
    const entry = yieldsBySection.get(point.section) ?? { sum: 0, count: 0 };
    entry.sum += point.value;
    entry.count++;
    yieldsBySection.set(point.section, entry);
    globalSum += point.value;
    globalCount++;
  }
  if (yieldsBySection.size < 2 || globalCount === 0) return { corrections: [], skipped: false };
  const globalMean = globalSum / globalCount;
  if (globalMean <= 0) return { corrections: [], skipped: false };

  const factorBySection = new Map<number, number>();
  const corrections: CleaningStats["sectionsCorrected"] = [];
  for (const [section, entry] of yieldsBySection) {
    if (entry.count < SECTION_MIN_POINTS) continue;
    const mean = entry.sum / entry.count;
    if (mean <= 0) continue;
    const factor = globalMean / mean;
    if (Math.abs(factor - 1) < SECTION_CORRECTION_MIN_DEVIATION) continue;
    factorBySection.set(section, factor);
    corrections.push({ section, factor: round(factor, 3) });
  }
  if (factorBySection.size === 0) return { corrections: [], skipped: false };
  if (factorBySection.size > MAX_CORRECTED_SECTIONS) return { corrections: [], skipped: true };

  for (const point of points) {
    if (point.section === undefined) continue;
    const factor = factorBySection.get(point.section);
    if (factor !== undefined) point.value *= factor;
  }
  return { corrections: corrections.toSorted((a, b) => a.section - b.section), skipped: false };
}

/**
 * Convex hull of the raw coordinates as a closed, counter-clockwise ring.
 *
 * `turf.convex` wants a FeatureCollection, i.e. one GeoJSON Feature object per
 * input point — at the 2 M points a farm export carries, that allocation alone
 * runs into gigabytes and is why the whole yield-map path has to be walked one
 * map at a time. Andrew's monotone chain over flat typed arrays returns the
 * same polygon (a convex hull is unique) for a few tens of MB: coordinates in
 * one Float64Array, the sort order in one Uint32Array, and only the hull's own
 * vertices as objects.
 */
function convexHullRing(points: YieldPoint[]): number[][] | null {
  const count = points.length;
  const xy = new Float64Array(count * 2);
  for (let i = 0; i < count; i++) {
    xy[i * 2] = points[i].lon;
    xy[i * 2 + 1] = points[i].lat;
  }
  const order = new Uint32Array(count);
  for (let i = 0; i < count; i++) order[i] = i;
  order.sort((a, b) => xy[a * 2] - xy[b * 2] || xy[a * 2 + 1] - xy[b * 2 + 1]);

  // > 0 keeps left turns, so both halves come out counter-clockwise and
  // collinear points drop away — the ring stays minimal.
  const isLeftTurn = (o: number, a: number, b: number): boolean =>
    (xy[a * 2] - xy[o * 2]) * (xy[b * 2 + 1] - xy[o * 2 + 1]) -
      (xy[a * 2 + 1] - xy[o * 2 + 1]) * (xy[b * 2] - xy[o * 2]) >
    0;

  const chain = (indices: Uint32Array, reverse: boolean): number[] => {
    const stack: number[] = [];
    for (let n = 0; n < count; n++) {
      const i = indices[reverse ? count - 1 - n : n];
      while (stack.length >= 2 && !isLeftTurn(stack[stack.length - 2], stack[stack.length - 1], i)) stack.pop();
      stack.push(i);
    }
    stack.pop(); // shared with the other half's first vertex
    return stack;
  };

  const hull = [...chain(order, false), ...chain(order, true)];
  if (hull.length < 3) return null;
  const ring = hull.map((i) => [xy[i * 2], xy[i * 2 + 1]]);
  ring.push(ring[0]);
  return ring;
}

const EARTH_R = 6_371_008.8;
const DEG = Math.PI / 180;

/**
 * Drop points within `bufferM` of the harvested area's convex hull —
 * turning maneuvers and boundary passes carry systematic errors. Small sets
 * or degenerate hulls are returned unchanged.
 *
 * The reference buffers the hull inwards with turf; for a convex ring that is
 * exactly "inside the hull and at least `bufferM` from every edge", which is
 * computed here in local metres without a geometry library.
 */
export function removeEdgePoints(
  points: YieldPoint[],
  bufferM: number = EDGE_BUFFER_M,
): { points: YieldPoint[]; removed: number } {
  if (points.length < 200) return { points, removed: 0 };

  const ring = convexHullRing(points);
  if (!ring) return { points, removed: 0 };

  // Local equirectangular metres around the hull: plenty at field scale.
  const lat0 = ring.reduce((sum, [, lat]) => sum + lat, 0) / ring.length;
  const kx = DEG * EARTH_R * Math.cos(lat0 * DEG);
  const ky = DEG * EARTH_R;
  const lon0 = ring[0][0];
  const hull = ring.map(([lon, lat]) => [(lon - lon0) * kx, (lat - lat0) * ky]);

  // Counter-clockwise ring: a point is inside when it is left of every edge, and its distance
  // to an edge's line is the signed cross product over the edge length.
  const edges: { x: number; y: number; nx: number; ny: number }[] = [];
  for (let i = 0; i + 1 < hull.length; i++) {
    const [x0, y0] = hull[i];
    const [x1, y1] = hull[i + 1];
    const length = Math.hypot(x1 - x0, y1 - y0);
    if (length === 0) continue;
    edges.push({ x: x0, y: y0, nx: -(y1 - y0) / length, ny: (x1 - x0) / length });
  }
  const kept = points.filter((p) => {
    const x = (p.lon - lon0) * kx;
    const y = (p.lat - lat0) * ky;
    return edges.every((e) => (x - e.x) * e.nx + (y - e.y) * e.ny >= bufferM);
  });
  // A hull that collapses (thin fields) would wipe the set — keep the original then.
  if (kept.length < points.length * 0.3) return { points, removed: 0 };
  return { points: kept, removed: points.length - kept.length };
}

export type SetCalibrationResult = {
  /** Sets rescaled to the pooled mean, by their index in the input array */
  corrections: Array<{ set: number; factor: number }>;
};

/**
 * Rescale whole export SETS whose mean deviates from the pooled mean — the
 * between-pass analogue of correctSectionCalibration. John Deere exports each
 * combine pass as its own operation, so a field harvested in three passes
 * arrives as three files whose machines may be calibrated differently; the
 * per-set section correction cannot see across files. Only valid when every
 * set is the SAME field and crop (one cultivation's maps) — across different
 * fields it would erase genuine level differences, which is why finalize()
 * never applies it inside a mixed farm zip. Mutates point values in place.
 */
export function correctSetCalibration(sets: YieldPoint[][]): SetCalibrationResult {
  const eligible = sets.map((points) => points.length >= SECTION_MIN_POINTS);
  let pooledSum = 0;
  let pooledCount = 0;
  for (const [i, points] of sets.entries()) {
    if (!eligible[i]) continue;
    for (const point of points) pooledSum += point.value;
    pooledCount += points.length;
  }
  if (pooledCount === 0 || sets.filter((_, i) => eligible[i]).length < 2) return { corrections: [] };
  const pooledMean = pooledSum / pooledCount;
  if (pooledMean <= 0) return { corrections: [] };

  const corrections: SetCalibrationResult["corrections"] = [];
  for (const [i, points] of sets.entries()) {
    if (!eligible[i]) continue;
    const mean = points.reduce((sum, p) => sum + p.value, 0) / points.length;
    if (mean <= 0) continue;
    const factor = pooledMean / mean;
    if (Math.abs(factor - 1) < SECTION_CORRECTION_MIN_DEVIATION) continue;
    for (const point of points) point.value *= factor;
    corrections.push({ set: i, factor: round(factor, 3) });
  }
  return { corrections };
}
