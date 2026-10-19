import type { Geometry } from 'geojson';
import { fieldGrid, type GridDefinition, GridError, pixelAreaHa, rasterizeGeometryMask } from './grid.js';
import { gridYieldPoints } from './parse.js';
import type { YieldPoint } from './types.js';

/**
 * Zonal statistics over a grid raster — the only way a "value per polygon" figure is produced,
 * so zones, field parts and fields all report the same number for the same raster. Area-weighted
 * by construction: a monitor logs far more points where the machine drove slowly, averaging
 * pixels weights ground, which is what a figure "per hectare" means.
 */
export type ZonalInput = { id: string; geometry: Geometry };

export type ZoneStats = {
  /** NaN when the zone has no valid pixels, or fewer than `minPixels` of them. */
  mean: number;
  median: number;
  min: number;
  max: number;
  sum: number;
  stddev: number;
  validPixels: number;
  zonePixels: number;
  areaHa: number;
  coverage: number;
};

export type ZonalStatsResult = Map<string, ZoneStats> & {
  /** Mean over every valued pixel inside ANY zone — the reference for a relative figure. */
  overallMean: number;
  coveredPixels: number;
  /** Valued pixels of the raster that fell outside every zone. */
  outsidePixels: number;
};

const EMPTY: ZoneStats = { mean: NaN, median: NaN, min: NaN, max: NaN, sum: 0, stddev: NaN, validPixels: 0, zonePixels: 0, areaHa: 0, coverage: 0 };

function summarize(values: number[], zonePixels: number, haPerPixel: number, minPixels: number): ZoneStats {
  if (values.length === 0) return { ...EMPTY, zonePixels, areaHa: zonePixels * haPerPixel };
  const sum = values.reduce((total, value) => total + value, 0);
  const base = { sum, validPixels: values.length, zonePixels, areaHa: zonePixels * haPerPixel, coverage: zonePixels === 0 ? 0 : values.length / zonePixels };
  if (values.length < minPixels) return { ...base, mean: NaN, median: NaN, min: NaN, max: NaN, stddev: NaN };
  const sorted = values.toSorted((a, b) => a - b);
  const mean = sum / values.length;
  const variance = values.reduce((total, value) => total + (value - mean) ** 2, 0) / values.length;
  return { ...base, mean, median: sorted[Math.floor(sorted.length / 2)], min: sorted[0], max: sorted[sorted.length - 1], stddev: Math.sqrt(variance) };
}

export function zonalStats(data: Float64Array, grid: GridDefinition, zones: ZonalInput[], opts: { minPixels?: number } = {}): ZonalStatsResult {
  const minPixels = opts.minPixels ?? 0;
  const result = new Map<string, ZoneStats>();
  const covered = new Uint8Array(data.length);
  // One label grid, one pass: a sliver of overlap goes to the first zone, never counted twice.
  const labels = new Int16Array(data.length).fill(-1);
  zones.forEach((zone, index) => {
    const mask = rasterizeGeometryMask(zone.geometry, grid);
    for (let i = 0; i < labels.length; i++) if (mask[i] && labels[i] === -1) labels[i] = index;
  });
  const buckets: number[][] = zones.map(() => []);
  const zonePixels = new Int32Array(zones.length);
  for (let i = 0; i < labels.length; i++) {
    const label = labels[i];
    if (label < 0) continue;
    zonePixels[label]++;
    if (Number.isFinite(data[i])) {
      buckets[label].push(data[i]);
      covered[i] = 1;
    }
  }
  zones.forEach((zone, index) => result.set(zone.id, summarize(buckets[index], zonePixels[index], pixelAreaHa(grid), minPixels)));

  let coveredSum = 0;
  let coveredPixels = 0;
  let outsidePixels = 0;
  for (let i = 0; i < data.length; i++) {
    if (!Number.isFinite(data[i])) continue;
    if (covered[i]) {
      coveredSum += data[i];
      coveredPixels++;
    } else outsidePixels++;
  }
  return Object.assign(result, { overallMean: coveredPixels > 0 ? coveredSum / coveredPixels : 0, coveredPixels, outsidePixels });
}

/** A zone to attribute yield to — geometry plus whatever id the caller tracks it by. */
export type ZoneShape = { id: string; geometry: Geometry };

export type ZoneYield = {
  zoneId: string;
  /** Mean measured rate inside the zone [t/ha] — null when too little of it was measured. */
  yieldInTpHa: number | null;
  /** Zone mean / field mean — the transferable part of the signal. */
  relativeYield: number | null;
  /** Grid pixels inside the zone that carry a measurement. */
  pixels: number;
};

export type ZoneYieldResult = {
  zones: ZoneYield[];
  /** Mean over every measured pixel inside ANY zone — the reference for relativeYield. */
  fieldMeanTpHa: number;
  /** Measured pixels outside every zone (zonation older than the boundary, GPS drift). */
  unassignedPixels: number;
};

/**
 * Below this a zone mean is noise rather than a measurement: such zones report null instead
 * of a fabricated number. On the UTM grid a pixel is 100 m², so 30 pixels are 0.3 ha anywhere.
 */
export const MIN_PIXELS_PER_ZONE = 30;

/** Same clamp as the reference: a zone at >2× the field mean is a monitor artefact. */
export const RELATIVE_YIELD_BOUNDS: [number, number] = [0, 2];

/**
 * Per-zone measured yield from a raster. The zones are masked onto the raster's own grid, so
 * a zonation redrawn after the raster was written still works; how much of each zone the raster
 * covers shows up as `pixels`.
 */
export function computeZoneYieldsFromRaster(raster: Float64Array, grid: GridDefinition, zones: ZoneShape[]): ZoneYieldResult {
  const stats = zonalStats(raster, grid, zones, { minPixels: MIN_PIXELS_PER_ZONE });
  return {
    zones: zones.map((zone) => {
      const zoneStats = stats.get(zone.id);
      const mean = zoneStats && Number.isFinite(zoneStats.mean) ? zoneStats.mean : null;
      return {
        zoneId: zone.id,
        yieldInTpHa: stats.overallMean > 0 ? mean : null,
        relativeYield: mean !== null && stats.overallMean > 0 ? mean / stats.overallMean : null,
        pixels: zoneStats?.validPixels ?? 0,
      };
    }),
    fieldMeanTpHa: stats.overallMean,
    unassignedPixels: stats.outsidePixels,
  };
}

/**
 * Grid padding around the zonation [m]: measured ground just outside the zones (a zonation
 * older than the boundary, GPS drift along a headland) counts as unassigned; points beyond it
 * fall off the grid — a monitor logging on the road to the next field.
 */
const GRID_PAD_M = 50;

/** Per-zone measured yield from harvest points, rasterised onto the zones' own grid first. */
export function computeZoneYields(points: YieldPoint[], zones: ZoneShape[]): ZoneYieldResult {
  let grid: GridDefinition | null = null;
  try {
    grid = zones.length ? fieldGrid(zones.map((zone) => zone.geometry), 10, GRID_PAD_M) : null;
  } catch (error) {
    if (!(error instanceof GridError)) throw error;
  }
  if (!grid) return { zones: zones.map((zone) => ({ zoneId: zone.id, yieldInTpHa: null, relativeYield: null, pixels: 0 })), fieldMeanTpHa: 0, unassignedPixels: 0 };
  const { raster } = gridYieldPoints(points, grid);
  return computeZoneYieldsFromRaster(raster, grid, zones);
}

/**
 * The context a measured yield is bound to: 9.5 t/ha is a good barley year and an impossible
 * rape one. Planning and benchmarking join yields over exactly these dimensions.
 */
export type YieldContext = { crop: string; varietyId?: string | null; year: number; soilTypeLUFA?: string | null; management?: string | null };

/**
 * How far a measured yield may travel from the context it was measured in: the same crop
 * transfers the t/ha number; a different crop on comparable ground only the spatial pattern;
 * a different crop on different soil nothing.
 */
export type YieldTransfer = 'absolute' | 'relative-only' | 'none';

export function zoneYieldTransfer(source: YieldContext, target: YieldContext): YieldTransfer {
  if (source.crop === target.crop) return 'absolute';
  const soilKnown = source.soilTypeLUFA != null && target.soilTypeLUFA != null;
  if (soilKnown && source.soilTypeLUFA !== target.soilTypeLUFA) return 'none';
  return 'relative-only';
}

const SIMILARITY_WEIGHTS = { soil: 0.4, management: 0.25, variety: 0.15, recency: 0.2 };
const RECENCY_HORIZON_YEARS = 6;

export type AnalogTarget = { year: number; soilTypeLUFA?: string | null; management?: string | null; varietyId?: string | null };

/** 0..1 match of one candidate zone against a planning target; unknown dimensions score 1. */
export function analogSimilarity(
  target: AnalogTarget,
  row: { year: number; soilTypeLUFA: string | null; management: string | null; varietyId: string | null },
): number {
  const soil = target.soilTypeLUFA == null || row.soilTypeLUFA === target.soilTypeLUFA ? 1 : 0;
  const management = target.management == null || row.management === target.management ? 1 : 0;
  const variety = target.varietyId == null || row.varietyId === target.varietyId ? 1 : 0;
  const recency = Math.max(0, 1 - Math.abs(target.year - row.year) / RECENCY_HORIZON_YEARS);
  return soil * SIMILARITY_WEIGHTS.soil + management * SIMILARITY_WEIGHTS.management + variety * SIMILARITY_WEIGHTS.variety + recency * SIMILARITY_WEIGHTS.recency;
}
