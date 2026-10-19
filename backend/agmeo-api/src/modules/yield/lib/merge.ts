import { createHash } from "node:crypto";

import type { GridDefinition } from "./grid.js";
import { pixelAreaM2 } from "./grid.js";

import type { YieldPoint } from "./types.js";

/**
 * Merging the harvest maps of one cultivation.
 *
 * Two rules decide the whole design:
 *
 * 1. The merge unit is a harvest EVENT, not a cultivation. Of all cultivations
 *    with two or more John Deere harvest operations, only ~790 (2024-26) are
 *    same-day multi-machine work while ~4150 span more than 21 days — 2395 of
 *    those grassland, i.e. separate CUTS, each its own map and its own yield.
 *    Mis-assigned operations exist too (a 24.55 t/ha row on a winter-wheat
 *    cultivation). Averaging across those is not a merge, it is nonsense.
 * 2. Sources merge as grid ACCUMULATIONS, never as point clouds. Each source is
 *    capped at 2 M points; N sources as points is N × 2 M objects in one heap. A
 *    30 ha field at 10 m is ~3000 pixels, so an accumulation is a few tens of kB
 *    per source — which is also what makes a source cacheable and re-mergeable
 *    without re-parsing when the user toggles one off.
 * 3. The accumulation is EXTENSIVE: harvested mass [kg] and the ground it came
 *    from [m²], not a mean of rates. A rate is intensive, so averaging rates
 *    gives every sample the same vote regardless of how much ground it stands
 *    for — a record logged while crawling covers 5 cm, one at full speed 50 cm,
 *    and John Deere's header elements are anywhere from 0.15 m to 3.8 m wide.
 *    Mass over area weights each sample by the ground it actually harvested,
 *    makes the field total the sum of the pixels (so a weighbridge figure can be
 *    compared to it exactly), turns partial coverage at field edges into a
 *    number instead of a mystery low value, and makes double-covered ground
 *    visible as coverage > 1 rather than something to be inferred.
 */

/** Sources whose harvest dates lie within this window belong to one event. */
export const EVENT_CLUSTER_DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

export type EventSource = {
  id: string;
  productArticleId: string | null;
  harvestedFrom: string | Date | null;
};

export type HarvestEvent<T extends EventSource> = {
  /** Stable per (product, first date) — used as the artifact key. */
  key: string;
  productArticleId: string | null;
  from: Date | null;
  to: Date | null;
  sources: T[];
};

const dateOf = (source: EventSource): Date | null => (source.harvestedFrom ? new Date(source.harvestedFrom) : null);

/**
 * Group sources into harvest events: same product article, harvest dates within
 * EVENT_CLUSTER_DAYS of the previous source in the cluster. Sources without a
 * date land in their own event — with nothing to correlate them by, guessing
 * that they belong to a neighbouring cut is exactly the mistake to avoid.
 */
export function groupSourcesIntoEvents<T extends EventSource>(sources: T[]): HarvestEvent<T>[] {
  const byProduct = new Map<string, T[]>();
  for (const source of sources) {
    const product = source.productArticleId ?? "unknown";
    const list = byProduct.get(product) ?? [];
    list.push(source);
    byProduct.set(product, list);
  }

  const events: HarvestEvent<T>[] = [];
  for (const [product, group] of byProduct) {
    const dated = group.filter((s) => dateOf(s) !== null).toSorted((a, b) => +dateOf(a)! - +dateOf(b)!);
    const undated = group.filter((s) => dateOf(s) === null);

    let current: T[] = [];
    const flush = () => {
      if (current.length === 0) return;
      const from = dateOf(current[0])!;
      const to = dateOf(current[current.length - 1])!;
      events.push({
        key: eventKey(product, from),
        productArticleId: current[0].productArticleId,
        from,
        to,
        sources: current,
      });
      current = [];
    };

    for (const source of dated) {
      const previous = current[current.length - 1];
      if (previous && +dateOf(source)! - +dateOf(previous)! > EVENT_CLUSTER_DAYS * DAY_MS) flush();
      current.push(source);
    }
    flush();

    for (const source of undated) {
      events.push({
        key: eventKey(product, null, source.id),
        productArticleId: source.productArticleId,
        from: null,
        to: null,
        sources: [source],
      });
    }
  }
  return events.toSorted((a, b) => (a.from && b.from ? +a.from - +b.from : 0));
}

function eventKey(product: string, from: Date | null, fallback = ""): string {
  const day = from ? from.toISOString().slice(0, 10) : `undated-${fallback}`;
  return createHash("sha256").update(`${product}|${day}`).digest("hex").slice(0, 16);
}

/** Identity of the grid an accumulation was built on — the cache key. */
export function gridSignature(grid: GridDefinition): string {
  return createHash("sha256")
    .update(`${grid.resolution}|${grid.originX}|${grid.originY}|${grid.width}|${grid.height}`)
    .digest("hex")
    .slice(0, 16);
}

export type SourceAccumulation = {
  sourceId: string;
  /** Harvested mass attributed to each pixel [kg] */
  mass: Float64Array;
  /** Ground that mass came from [m²] — the weight, and the coverage signal */
  area: Float64Array;
  /** Samples per pixel; kept for diagnostics and the duplicate heuristics */
  counts: Int32Array;
  /** Provider, for the duplicate tie-break */
  provider?: string;
  pointCount?: number;
  /** Share of points whose ground area was known rather than assumed */
  areaKnownShare?: number;
};

/** 1 t/ha = 1000 kg / 10 000 m² = 0.1 kg/m². */
const T_HA_TO_KG_M2 = 0.1;

/** Rate of a pixel from its accumulated mass and area [t/ha], NaN when uncovered. */
export const rateOf = (mass: number, area: number): number => (area > 0 ? mass / area / T_HA_TO_KG_M2 : NaN);

/**
 * Ground one record stands for. John Deere logs both factors (`SWATHWIDTH` and
 * `DISTANCE`, the distance travelled since the previous record of that element);
 * ISOXML has the working width via DDI 67. When an export carries neither, every
 * point gets the same nominal area — which makes the result identical to the old
 * mean-of-rates, so nothing regresses on formats we cannot measure.
 */
const NOMINAL_AREA_M2 = 1;

function pointAreaM2(point: YieldPoint): { areaM2: number; known: boolean } {
  const width = point.width;
  const step = point.step;
  if (width && width > 0 && step && step > 0) return { areaM2: width * step, known: true };
  return { areaM2: NOMINAL_AREA_M2, known: false };
}

/** Accumulate points onto the grid — the shared first half of gridding. */
/**
 * Bin each record's harvested MASS and the ground it came from onto the grid.
 *
 * The footprint is attributed to the pixel holding its centre rather than split
 * across pixel boundaries: a record covers ~0.15 x 0.4 m and a pixel is 10 x 10 m,
 * so the error is bounded by a footprint and cancels over a pass, while exact
 * clipping would cost a polygon intersection per record on millions of records.
 */
export function accumulateYieldPoints(
  points: YieldPoint[],
  grid: GridDefinition,
  project: (lon: number, lat: number) => [number, number],
): { mass: Float64Array; area: Float64Array; counts: Int32Array; pointsUsed: number; areaKnownShare: number } {
  const mass = new Float64Array(grid.width * grid.height);
  const area = new Float64Array(grid.width * grid.height);
  const counts = new Int32Array(grid.width * grid.height);
  let pointsUsed = 0;
  let areaKnown = 0;

  for (const point of points) {
    const [x, y] = project(point.lon, point.lat);
    const col = Math.floor((x - grid.originX) / grid.resolution);
    const row = Math.floor((grid.originY - y) / grid.resolution);
    if (col < 0 || row < 0 || col >= grid.width || row >= grid.height) continue;

    const { areaM2, known } = pointAreaM2(point);
    const index = row * grid.width + col;
    mass[index] += point.value * areaM2 * T_HA_TO_KG_M2;
    area[index] += areaM2;
    counts[index]++;
    pointsUsed++;
    if (known) areaKnown++;
  }
  return { mass, area, counts, pointsUsed, areaKnownShare: pointsUsed === 0 ? 0 : areaKnown / pointsUsed };
}

const coverageMask = (counts: Int32Array): Uint8Array => {
  const mask = new Uint8Array(counts.length);
  for (let i = 0; i < counts.length; i++) if (counts[i] > 0) mask[i] = 1;
  return mask;
};

/**
 * Ground covered per pixel divided by the pixel's own area.
 *
 * ~1 is a fully harvested pixel, well below 1 a partially covered one (field
 * edge, headland, a pixel the machine only clipped) and **above 1 means the same
 * ground was covered more than once** — a double pass the overlap filter did not
 * catch, most likely because the source carries no time base. It is the cheapest
 * honest QA signal the merge produces.
 */
export function coverageRatio(area: Float64Array, grid: GridDefinition): Float64Array {
  const pixelArea = pixelAreaM2(grid);
  const ratio = new Float64Array(area.length);
  for (let i = 0; i < area.length; i++) ratio[i] = area[i] / pixelArea;
  return ratio;
}

/** Share of covered pixels the two sources have in common. */
export function pixelJaccard(a: Int32Array, b: Int32Array): number {
  let intersection = 0;
  let union = 0;
  for (let i = 0; i < a.length; i++) {
    const inA = a[i] > 0;
    const inB = b[i] > 0;
    if (inA || inB) union++;
    if (inA && inB) intersection++;
  }
  return union === 0 ? 0 : intersection / union;
}

/** Area-weighted mean rate of a source [t/ha] — its total mass over its ground. */
const meanOf = (accumulation: SourceAccumulation): number => {
  let mass = 0;
  let area = 0;
  for (let i = 0; i < accumulation.area.length; i++) {
    mass += accumulation.mass[i];
    area += accumulation.area[i];
  }
  return rateOf(mass, area) || 0;
};

/** The minimum a source has to expose to take part in the fingerprint tier. */
export type FingerprintedSource = {
  id: string;
  /** null until the source has been parsed once — those never take part. */
  fingerprint: string | null;
  /** ISO-8601, so a plain string compare is chronological. */
  createdAt: string;
};

/**
 * Oldest copy wins, then the id — a total order, so which copy survives does not
 * depend on the order the rows came back in. Points and provider cannot decide:
 * the point count is part of the fingerprint, and identical data has no better
 * provider.
 */
const preferAsSurvivor = (a: FingerprintedSource, b: FingerprintedSource): number =>
  a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);

/**
 * Second tier of duplicate detection: the same export delivered twice, caught on
 * the stored fingerprint BEFORE the copies are downloaded and parsed —
 * which is the whole value of the tier, since the third one can only judge two
 * sources it has already paid to rasterise.
 *
 * Same-format only (see the fingerprint's own docstring), so it never replaces
 * the pixel-overlap tier; it just stops that tier from being the first thing to
 * notice a byte-for-byte redelivery.
 *
 * Returns the dropped source id mapped to the id of the copy kept in its place.
 */
export function dedupeByFingerprint(sources: FingerprintedSource[]): Map<string, string> {
  const groups = new Map<string, FingerprintedSource[]>();
  for (const source of sources) {
    if (!source.fingerprint) continue;
    const group = groups.get(source.fingerprint);
    if (group) group.push(source);
    else groups.set(source.fingerprint, [source]);
  }

  const dropped = new Map<string, string>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const [kept, ...rest] = group.toSorted(preferAsSurvivor);
    for (const source of rest) dropped.set(source.id, kept.id);
  }
  return dropped;
}

const DUPLICATE_JACCARD = 0.85;
const DUPLICATE_MEAN_TOLERANCE = 0.05;
const DUPLICATE_PIXEL_RATIO: [number, number] = [0.8, 1.25];
/**
 * Which provider survives when two sources are the same data. Machine-exported
 * data before a manual upload; a provider missing here must not win by accident
 * (see providerRank).
 */
const PROVIDER_PRIORITY = ["johndeere", "claas", "agco", "upload"];

/**
 * Rank of a provider, with unknown spellings LAST.
 *
 * `indexOf` returns -1 for anything not listed, and the comparison keeps the
 * lower rank — so an unlisted provider silently outranked every listed one.
 * That is how "agco" beat "johndeere" between the AGCO yield-source work and
 * this line being updated. Unknown now sorts last, so forgetting to add a
 * provider costs it the tie rather than winning it.
 */
const providerRank = (provider: string | undefined): number => {
  const rank = PROVIDER_PRIORITY.indexOf(provider ?? "upload");
  return rank === -1 ? PROVIDER_PRIORITY.length : rank;
};

/**
 * Third and last tier of duplicate detection (the cheap tiers are the provider
 * operation id at ingest and {@link dedupeByFingerprint} after parsing): two
 * sources that cover the same pixels with the same level ARE the same harvest,
 * delivered twice. Two combines that split a field share few pixels and are never
 * caught by this.
 *
 * This is the ONLY tier that catches the cross-provider case — a CLAAS activity
 * for a field we also pulled from JD. The other two key on a provider id and on a
 * hash that includes the format, so neither can see across two providers, and
 * neither is a substitute for this one.
 */
export function detectDuplicateSources(accumulations: SourceAccumulation[]): Map<string, string> {
  const dropped = new Map<string, string>();
  const means = new Map(accumulations.map((a) => [a.sourceId, meanOf(a)]));
  const pixels = new Map(accumulations.map((a) => [a.sourceId, coverageMask(a.counts).reduce((n, v) => n + v, 0)]));

  for (let i = 0; i < accumulations.length; i++) {
    for (let j = i + 1; j < accumulations.length; j++) {
      const a = accumulations[i];
      const b = accumulations[j];
      if (dropped.has(a.sourceId) || dropped.has(b.sourceId)) continue;

      const jaccard = pixelJaccard(a.counts, b.counts);
      if (jaccard < DUPLICATE_JACCARD) continue;
      const meanA = means.get(a.sourceId) ?? 0;
      const meanB = means.get(b.sourceId) ?? 0;
      if (meanA <= 0 || meanB <= 0) continue;
      if (Math.abs(1 - meanA / meanB) > DUPLICATE_MEAN_TOLERANCE) continue;
      const pixelRatio = (pixels.get(a.sourceId) ?? 0) / Math.max(1, pixels.get(b.sourceId) ?? 0);
      if (pixelRatio < DUPLICATE_PIXEL_RATIO[0] || pixelRatio > DUPLICATE_PIXEL_RATIO[1]) continue;

      const loser = pickDuplicateLoser(a, b);
      dropped.set(loser.sourceId, "duplicate");
    }
  }
  return dropped;
}

function pickDuplicateLoser(a: SourceAccumulation, b: SourceAccumulation): SourceAccumulation {
  const pointsA = a.pointCount ?? 0;
  const pointsB = b.pointCount ?? 0;
  if (pointsA !== pointsB) return pointsA > pointsB ? b : a;
  return providerRank(a.provider) <= providerRank(b.provider) ? b : a;
}

const MIN_SHARED_PIXELS = 100;
const CALIBRATION_MIN_DEVIATION = 0.05;
const CALIBRATION_CLAMP: [number, number] = [0.8, 1.25];

export type CalibrationResult = {
  factors: Map<string, number>;
  /** true when the sources disagreed so much that nothing was rescaled */
  skipped: boolean;
  sharedPixels: number;
};

/**
 * Cross-source calibration: the between-machine counterpart to the existing
 * within-machine section calibration (which must run first, on each source's own
 * points). Reference is the mean over pixels covered by at least two sources, so
 * only ground that several machines actually drove decides the factor — and
 * genuine spatial differences between the parts of the field each machine took
 * are left alone.
 *
 * Guards mirror correctSectionCalibration deliberately: ignore deviations below
 * 5 %, clamp to [0.8, 1.25], and if more than half the sources exceed the clamp
 * apply nothing at all — that pattern means different crops or a wrong unit, not
 * calibration drift.
 */
export function crossSourceCalibration(accumulations: SourceAccumulation[]): CalibrationResult {
  const factors = new Map<string, number>();
  if (accumulations.length < 2) return { factors, skipped: false, sharedPixels: 0 };

  const length = accumulations[0].counts.length;
  const shared: number[] = [];
  for (let i = 0; i < length; i++) {
    const covering = accumulations.filter((a) => a.counts[i] > 0);
    if (covering.length >= 2) shared.push(i);
  }
  if (shared.length < MIN_SHARED_PIXELS) return { factors, skipped: false, sharedPixels: shared.length };

  const sharedMeanAll =
    shared.reduce((sum, index) => {
      const values = accumulations.filter((a) => a.counts[index] > 0).map((a) => rateOf(a.mass[index], a.area[index]));
      return sum + values.reduce((s, v) => s + v, 0) / values.length;
    }, 0) / shared.length;

  let clamped = 0;
  for (const accumulation of accumulations) {
    const own = shared.filter((index) => accumulation.counts[index] > 0);
    if (own.length < MIN_SHARED_PIXELS) continue;
    const mean =
      own.reduce((sum, index) => sum + rateOf(accumulation.mass[index], accumulation.area[index]), 0) / own.length;
    if (mean <= 0 || sharedMeanAll <= 0) continue;
    const raw = sharedMeanAll / mean;
    if (Math.abs(raw - 1) < CALIBRATION_MIN_DEVIATION) continue;
    if (raw < CALIBRATION_CLAMP[0] || raw > CALIBRATION_CLAMP[1]) clamped++;
    factors.set(accumulation.sourceId, Math.min(CALIBRATION_CLAMP[1], Math.max(CALIBRATION_CLAMP[0], raw)));
  }

  if (clamped > accumulations.length / 2) {
    return { factors: new Map(), skipped: true, sharedPixels: shared.length };
  }
  return { factors, skipped: false, sharedPixels: shared.length };
}

export type MergedYield = {
  /** Rate per pixel [t/ha], NaN where nothing covered it */
  raster: Float64Array;
  /** Harvested mass per pixel [kg] — the raster's extensive counterpart */
  mass: Float64Array;
  /** Ground harvested per pixel [m²] */
  area: Float64Array;
  coveredPixels: number;
  /** Area-weighted mean rate [t/ha] — total mass over total ground */
  pixelMean: number;
  /** Total harvested mass [t] — comparable to a weighbridge ticket */
  totalT: number;
  /** Ground the merge accounts for [ha] */
  harvestedHa: number;
  /**
   * Pixels whose accumulated ground exceeds the pixel itself: the same land
   * counted more than once, i.e. a double pass the overlap filter did not catch.
   */
  overCoveredPixels: number;
  contributions: {
    sourceId: string;
    pixels: number;
    overlapPixels: number;
    calibrationFactor: number;
    /** This source's share of the merged mass [t] */
    massT: number;
    excluded?: string;
  }[];
  calibrationSkipped: boolean;
};

/**
 * Merge sources by SUMMING harvested mass and the ground it came from, then
 * dividing: rate = Σkg / Σm².
 *
 * This is the whole reason the accumulation is extensive. Averaging per-source
 * rates would weight a machine by how often it logged rather than by how much it
 * harvested, so a fast-logging or slow-driving machine would dominate ground it
 * barely touched — the previous version needed an arbitrary sample-count cap to
 * limit exactly that, and the cap is now gone because area is the honest weight.
 *
 * Calibration factors scale a source's mass, since they correct its yield level.
 */
export function mergeSourceGrids(
  accumulations: SourceAccumulation[],
  excluded: Map<string, string> = new Map(),
  calibration?: CalibrationResult,
  grid?: GridDefinition,
): MergedYield {
  const usable = accumulations.filter((a) => !excluded.has(a.sourceId));
  const length = accumulations[0]?.area.length ?? 0;
  const raster = new Float64Array(length).fill(NaN);
  const mass = new Float64Array(length);
  const area = new Float64Array(length);
  const factors = calibration?.factors ?? crossSourceCalibration(usable).factors;

  const pixels = new Map<string, number>();
  const overlaps = new Map<string, number>();
  const massBySource = new Map<string, number>();
  let coveredPixels = 0;
  let totalMass = 0;
  let totalArea = 0;

  for (let i = 0; i < length; i++) {
    let covering = 0;
    for (const accumulation of usable) {
      if (accumulation.area[i] <= 0) continue;
      covering++;
      pixels.set(accumulation.sourceId, (pixels.get(accumulation.sourceId) ?? 0) + 1);
      const factor = factors.get(accumulation.sourceId) ?? 1;
      const contributed = accumulation.mass[i] * factor;
      mass[i] += contributed;
      area[i] += accumulation.area[i];
      massBySource.set(accumulation.sourceId, (massBySource.get(accumulation.sourceId) ?? 0) + contributed);
    }
    if (area[i] <= 0) continue;
    if (covering >= 2) {
      for (const accumulation of usable) {
        if (accumulation.area[i] > 0) {
          overlaps.set(accumulation.sourceId, (overlaps.get(accumulation.sourceId) ?? 0) + 1);
        }
      }
    }
    raster[i] = rateOf(mass[i], area[i]);
    totalMass += mass[i];
    totalArea += area[i];
    coveredPixels++;
  }

  const pixelArea = grid ? pixelAreaM2(grid) : 0;
  let overCoveredPixels = 0;
  if (pixelArea > 0) {
    // A tolerance, not a threshold of principle: footprints are attributed to
    // the pixel holding their centre, so an exactly-covered pixel scatters a few
    // percent either side.
    for (let i = 0; i < length; i++) if (area[i] > pixelArea * 1.15) overCoveredPixels++;
  }

  return {
    raster,
    mass,
    area,
    coveredPixels,
    pixelMean: rateOf(totalMass, totalArea) || 0,
    totalT: totalMass / 1000,
    harvestedHa: totalArea / 10_000,
    overCoveredPixels,
    contributions: accumulations.map((accumulation) => ({
      sourceId: accumulation.sourceId,
      pixels: pixels.get(accumulation.sourceId) ?? 0,
      overlapPixels: overlaps.get(accumulation.sourceId) ?? 0,
      calibrationFactor: factors.get(accumulation.sourceId) ?? 1,
      massT: (massBySource.get(accumulation.sourceId) ?? 0) / 1000,
      excluded: excluded.get(accumulation.sourceId),
    })),
    calibrationSkipped: calibration?.skipped ?? false,
  };
}

/**
 * Scale a merged map so its total mass matches a weighbridge figure.
 *
 * This is the cheapest accuracy win available: a monitor map is a distribution,
 * a weighbridge ticket is a measurement, and the product farmers actually trust
 * is the two combined. Factors far from 1 mean the tonnage belongs to a
 * different area (or several fields), so they are reported and NOT applied.
 */
const CALIBRATION_TO_TOTAL_BOUNDS: [number, number] = [0.7, 1.4];

export function calibrateToTotal(merged: MergedYield, documentedTotalT: number): { factor: number; applied: boolean } {
  if (!(documentedTotalT > 0) || !(merged.totalT > 0)) {
    return { factor: 1, applied: false };
  }
  // Exact, because the merge conserves mass: the mapped total IS the sum of the
  // pixels, not a mean multiplied by an area that may or may not be the one the
  // machines actually covered.
  const factor = documentedTotalT / merged.totalT;
  if (factor < CALIBRATION_TO_TOTAL_BOUNDS[0] || factor > CALIBRATION_TO_TOTAL_BOUNDS[1]) {
    return { factor, applied: false };
  }
  for (let i = 0; i < merged.raster.length; i++) {
    if (Number.isFinite(merged.raster[i])) merged.raster[i] *= factor;
    merged.mass[i] *= factor;
  }
  merged.pixelMean *= factor;
  merged.totalT *= factor;
  return { factor, applied: true };
}
