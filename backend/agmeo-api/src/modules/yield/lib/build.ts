import { createHash } from 'node:crypto';
import type { Geometry } from 'geojson';
import type { CleaningStats } from './cleaning.js';
import {
  computeGridStats,
  coverageFraction,
  fillSmallGaps,
  type GridDefinition,
  type GridStats,
  pixelAreaHa,
  projector,
  rasterizeGeometryMask,
  round,
} from './grid.js';
import {
  accumulateYieldPoints,
  calibrateToTotal,
  crossSourceCalibration,
  detectDuplicateSources,
  type MergedYield,
  mergeSourceGrids,
  rateOf,
  type SourceAccumulation,
} from './merge.js';
import { standardizeMoisture } from './parse.js';
import { cleanTrack, removeOverlap, type TrackPoint, YIELD_CLEANING_DEFAULTS } from './track.js';
import type { ParsedYieldPoints } from './types.js';

/**
 * Bump when the parser, the cleaning defaults or the merge change in a way that would produce
 * a different raster from the same inputs — it is part of recipeHash, so stored rasters are
 * invalidated by construction.
 */
export const YIELD_RECIPE_VERSION = 1;

/**
 * Share of a source's records that must carry a real ground area before its mass is treated
 * as measured. Not 1: the first sample of a lane has no predecessor.
 */
const AREA_KNOWN_MIN_SHARE = 0.9;

/** Reference moisture per crop group [%] — a shared scale lies without one. */
const TARGET_MOISTURE: [keywords: string[], target: number][] = [
  [['silage', 'silo', 'grass', 'gras', 'clover', 'klee', 'alfalfa', 'luzern', 'beet', 'rübe', 'potato', 'kartoffel'], 0],
  [['canola', 'rape', 'raps'], 9],
  [['wheat', 'weizen', 'barley', 'gerste', 'rye', 'roggen', 'oat', 'hafer', 'triticale', 'corn', 'mais', 'dinkel', 'spelt'], 14],
];

export function resolveTargetMoisture(crop?: string | null): number | null {
  if (!crop) return null;
  const needle = crop.toLowerCase();
  for (const [keywords, target] of TARGET_MOISTURE) {
    if (keywords.some((keyword) => needle.includes(keyword))) return target > 0 ? target : null;
  }
  return null;
}

/**
 * Monitor-computed (.aft) and API-served (pointdata) values are already positioned by their
 * source, as is John Deere's processed shapefile — shifting them by an estimated flow delay
 * would smear, not sharpen. The raw flow/TLG formats are corrected.
 */
export function lagCorrectionApplies(provider: string, format: ParsedYieldPoints['format'] | null): boolean {
  if (provider === 'johndeere' && format === 'mass_per_area') return false;
  if (format === 'aft' || format === 'pointdata') return false;
  return true;
}

export function computeRecipeHash(input: { sourceFingerprints: string[]; crop: string | null; resolution: number; targetMoisture: number | null; boundaryHash: string }): string {
  const payload = [
    YIELD_RECIPE_VERSION,
    JSON.stringify(YIELD_CLEANING_DEFAULTS),
    input.sourceFingerprints.toSorted().join(','),
    input.crop ?? '',
    input.resolution,
    input.targetMoisture ?? '',
    input.boundaryHash,
  ].join('|');
  return createHash('sha256').update(payload).digest('hex').slice(0, 32);
}

export const boundaryHashOf = (geometry: Geometry): string => createHash('sha256').update(JSON.stringify(geometry)).digest('hex').slice(0, 16);

export type EventSourceInput = { sourceId: string; provider: string; parsed: ParsedYieldPoints };

export type SourceResult = {
  sourceId: string;
  parsed: ParsedYieldPoints;
  pixelMeanTHa: number | null;
  coveredHa: number | null;
  duplicate: boolean;
};

export type EventRaster = {
  grid: GridDefinition;
  /** Gap-filled rates [t/ha]. */
  raster: Float64Array;
  merged: MergedYield;
  stats: GridStats | null;
  filledPixels: number;
  /** Area of the covered pixels [ha]. */
  coveredHa: number;
  /** Only when every source said how much ground each record covered. */
  harvestedHa: number | null;
  totalT: number | null;
  fieldCoverage: number;
  targetMoisture: number | null;
  totalCalibration: { factor: number; applied: boolean };
  basis: 'wet' | 'dry';
  cleaning: (CleaningStats & { sourceId: string })[];
  quality: Record<string, unknown>;
  sources: SourceResult[];
};

/**
 * Merge the parsed sources of ONE harvest event on the field grid.
 *
 * Order mirrors the physics: moisture standardisation and within-source track cleaning (flow
 * delay, pass trim, velocity) → chronological overlap removal ACROSS the event's sources →
 * per-source accumulation of mass and ground → duplicate detection → cross-source calibration
 * → mass-conserving merge → gap fill → statistics.
 */
export function mergeEvent(input: {
  grid: GridDefinition;
  boundary: Geometry;
  sources: EventSourceInput[];
  crop?: string | null;
  documentedTotalT?: number | null;
}): EventRaster | null {
  const { grid, boundary } = input;
  const targetMoisture = resolveTargetMoisture(input.crop);

  const cleaned: { sourceId: string; provider: string; parsed: ParsedYieldPoints; track: TrackPoint[] | null }[] = [];
  for (const source of input.sources) {
    const parsed = { ...source.parsed, points: source.parsed.points.map((p) => ({ ...p })) };
    if (targetMoisture !== null) standardizeMoisture(parsed.points, targetMoisture, parsed.basis);
    const track = cleanTrack(parsed.points, { lagCorrectionApplies: lagCorrectionApplies(source.provider, parsed.format) });
    cleaned.push({
      sourceId: source.sourceId,
      provider: source.provider,
      track: track.track,
      parsed: {
        ...parsed,
        points: track.points,
        cleaning: {
          edgeRemoved: parsed.cleaning?.edgeRemoved ?? 0,
          sectionsCorrected: parsed.cleaning?.sectionsCorrected ?? [],
          sectionCorrectionSkipped: parsed.cleaning?.sectionCorrectionSkipped,
          track: track.stats,
        },
      },
    });
  }
  if (cleaned.length === 0) return null;

  // Overlap removal across the event's sources, in travel-time order. A source without a time
  // base takes no part; its points go into the accumulation unchanged.
  const overlap = removeOverlap(cleaned.flatMap((entry) => (entry.track ? [{ sourceId: entry.sourceId, points: entry.track }] : [])));

  const project = projector(grid.epsg);
  const accumulations: SourceAccumulation[] = [];
  for (const entry of cleaned) {
    const kept = overlap.kept.get(entry.sourceId);
    const points = kept && kept.length > 0 ? kept : entry.parsed.points;
    const { mass, area, counts, pointsUsed, areaKnownShare } = accumulateYieldPoints(points, grid, project);
    accumulations.push({ sourceId: entry.sourceId, mass, area, counts, provider: entry.provider, pointCount: pointsUsed, areaKnownShare });
  }

  const duplicates = detectDuplicateSources(accumulations);
  const usable = accumulations.filter((a) => !duplicates.has(a.sourceId));
  const calibration = crossSourceCalibration(usable);
  const merged = mergeSourceGrids(accumulations, duplicates, calibration, grid);
  if (merged.coveredPixels === 0) return null;

  const filled = fillSmallGaps(merged.raster, grid.width, grid.height);
  const haPerPixel = pixelAreaHa(grid);
  const coveredHa = round(merged.coveredPixels * haPerPixel, 3);
  // Mass is only a measurement when the ground behind it was measured too.
  const massIsMeasured = accumulations.every((a) => (a.areaKnownShare ?? 0) >= AREA_KNOWN_MIN_SHARE);
  const totalCalibration =
    input.documentedTotalT && massIsMeasured ? calibrateToTotal({ ...merged, raster: filled.data }, input.documentedTotalT) : { factor: 1, applied: false };

  const mask = rasterizeGeometryMask(boundary, grid);
  const stats = computeGridStats(filled.data, grid);

  const sources: SourceResult[] = cleaned.map((entry) => {
    const contribution = merged.contributions.find((c) => c.sourceId === entry.sourceId);
    const accumulation = accumulations.find((a) => a.sourceId === entry.sourceId);
    let mass = 0;
    let area = 0;
    for (let i = 0; accumulation && i < accumulation.area.length; i++) {
      mass += accumulation.mass[i];
      area += accumulation.area[i];
    }
    const rate = rateOf(mass, area);
    return {
      sourceId: entry.sourceId,
      parsed: entry.parsed,
      pixelMeanTHa: Number.isFinite(rate) ? round(rate, 3) : null,
      coveredHa: contribution ? round(contribution.pixels * haPerPixel, 3) : null,
      duplicate: duplicates.has(entry.sourceId),
    };
  });

  return {
    grid,
    raster: filled.data,
    merged,
    stats,
    filledPixels: filled.filledPixels,
    coveredHa,
    // Only real when the export said how much ground each record covered; nominal areas keep
    // the MEAN right but make totals meaningless.
    harvestedHa: massIsMeasured ? round(merged.harvestedHa, 3) : null,
    totalT: massIsMeasured ? round(merged.totalT, 3) : null,
    fieldCoverage: round(coverageFraction(filled.data, mask), 4),
    targetMoisture,
    totalCalibration,
    basis: cleaned.every((entry) => entry.parsed.basis === 'dry') ? 'dry' : 'wet',
    cleaning: cleaned.map((entry) => ({ sourceId: entry.sourceId, ...entry.parsed.cleaning! })),
    quality: {
      overCoveredPixels: merged.overCoveredPixels,
      areaKnownShare: accumulations.map((a) => ({ sourceId: a.sourceId, share: a.areaKnownShare ?? 0 })),
      calibrationSkipped: merged.calibrationSkipped,
      calibrationSharedPixels: calibration.sharedPixels,
      overlapRemoved: overlap.removed,
      overlapCellM: overlap.cellM,
      duplicates: [...duplicates.keys()],
      totalCalibration,
    },
    sources,
  };
}

/**
 * Identity of the DATA, not of the file: the same export delivered twice produces the same
 * fingerprint, so the merge drops the copy before paying for it. Same-format only — two
 * formats of one pass differ in point count and mean; those are caught on pixel overlap.
 */
export function computeSourceFingerprint(input: { pointCount: number; bbox4326: [number, number, number, number] | null; meanTHa: number | null; basis: string; format: string }): string {
  const bbox = input.bbox4326?.map((v) => v.toFixed(4)).join(',') ?? '';
  const payload = [input.format, input.basis, input.pointCount, bbox, (input.meanTHa ?? 0).toFixed(2)].join('|');
  return createHash('sha256').update(payload).digest('hex').slice(0, 32);
}
