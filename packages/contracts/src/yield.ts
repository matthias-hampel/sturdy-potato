import { z } from 'zod';
import { id, isoDate, positive, shortText } from './common.js';

/**
 * Yield maps: harvest-monitor exports per crop cycle, merged into one raster per harvest
 * event, with zone yields, analytics and the satellite yield estimate.
 */

/** Colour ramp of yield rasters, low (red) to high (green). */
export const YIELD_RAMP = ['#a50026', '#d73027', '#f46d43', '#fdae61', '#fee08b', '#d9ef8b', '#a6d96a', '#66bd63', '#1a9850', '#006837'] as const;

export const YIELD_MAP_PROVIDERS = ['upload', 'johndeere', 'claas', 'agco', 'nextfarming'] as const;
export type YieldMapProvider = (typeof YIELD_MAP_PROVIDERS)[number];
export type YieldMapSourceStatus = 'pending_download' | 'pending_parse' | 'ok' | 'failed' | 'skipped';
export type YieldMapExclusion = 'duplicate' | 'user' | 'implausible' | 'no_overlap';
export type YieldMapFormat = 'mass_per_area' | 'flow_channels' | 'isoxml' | 'pointdata' | 'aft';

/** Accepted upload extensions: a zipped export or a bare AGRO-MAP file. */
export const YIELD_MAP_EXTENSIONS = ['.zip', '.aft'] as const;

export interface YieldTrackCleaning {
  lagShiftS: number;
  lagSource: 'declared' | 'estimated' | 'skipped';
  passes: number;
  passTrimRemoved: number;
  velocityRemoved: number;
  smoothVelocityRemoved: number;
  overlapRemoved: number;
  untimed: boolean;
}

export interface YieldCleaning {
  sourceId?: string;
  edgeRemoved: number;
  sectionsCorrected: { section: number; factor: number }[];
  sectionCorrectionSkipped?: number;
  track?: YieldTrackCleaning;
}

export interface YieldSourceQuality {
  meanRate: number;
  plausible: boolean;
  window: [number, number];
  cappedPoints: number;
  note?: string;
}

export interface YieldMapSource {
  id: string;
  cropCycleId: string;
  fieldId: string;
  fieldName: string;
  cropName: string;
  fileId: string | null;
  fileName: string | null;
  provider: YieldMapProvider;
  machineLabel: string | null;
  harvestedFrom: string | null;
  harvestedTo: string | null;
  format: YieldMapFormat | null;
  attribute: string | null;
  basis: 'wet' | 'dry' | null;
  crs: string | null;
  pointCount: number | null;
  totalFeatures: number | null;
  meanRateTHa: number | null;
  /** Area-weighted mean of the source on the field grid [t/ha]. */
  pixelMeanTHa: number | null;
  coveredHa: number | null;
  includedInMerge: boolean;
  excludedReason: YieldMapExclusion | null;
  status: YieldMapSourceStatus;
  error: string | null;
  quality: YieldSourceQuality | null;
  cleaning: YieldCleaning | null;
  moisture: { attribute: string; mean: number; pointsWithMoisture: number } | null;
  createdAt: string;
}

/** A crop cycle an uploaded export overlaps. */
export interface YieldMapMatch {
  cropCycleId: string;
  fieldId: string;
  fieldName: string;
  cropName: string;
  areaHa: number;
  /** Share of the export's points inside the field (0..1). */
  share: number;
  points: number;
}

/** What the API read from an uploaded export, and the crop cycles it overlaps. */
export interface YieldMapInspection {
  fileId: string;
  fileName: string;
  sizeBytes: number;
  /** null when the file could not be read; `error` says why. */
  format: YieldMapFormat | null;
  attribute: string | null;
  crs: string | null;
  pointCount: number;
  meanRateTHa: number | null;
  plausible: boolean | null;
  note: string | null;
  harvestedFrom: string | null;
  harvestedTo: string | null;
  bbox: [number, number, number, number] | null;
  matches: YieldMapMatch[];
  error: string | null;
}

export const InspectYieldMapInput = z.object({
  fileId: id,
  /** Season whose crop cycles are matched; defaults to the season of the harvest date. */
  seasonId: id.nullish(),
});
export type InspectYieldMapInput = z.input<typeof InspectYieldMapInput>;

export const RegisterYieldMapInput = z.object({
  fileId: id,
  cropCycleIds: z.array(id).min(1).max(100),
  /** Harvest date when the export carries no times. */
  harvestedOn: isoDate.nullish(),
  machineLabel: shortText,
});
export type RegisterYieldMapInput = z.input<typeof RegisterYieldMapInput>;

export const UpdateYieldMapSourceInput = z.object({
  includedInMerge: z.boolean().optional(),
  harvestedOn: isoDate.nullish(),
  machineLabel: shortText,
});
export type UpdateYieldMapSourceInput = z.input<typeof UpdateYieldMapSourceInput>;

export interface YieldGrid {
  epsg: number;
  originX: number;
  originY: number;
  resolution: number;
  width: number;
  height: number;
}

export interface YieldStats {
  mean: number | null;
  median: number | null;
  stddev: number | null;
  min: number | null;
  max: number | null;
  q20: number | null;
  q80: number | null;
  p05: number | null;
  p95: number | null;
}

export interface YieldContribution {
  sourceId: string;
  pixels: number;
  overlapPixels: number;
  calibrationFactor: number;
  massT: number;
  excluded?: string;
}

export type YieldWriteback = { status: 'filled' | 'skipped' | null; reason: string | null; harvestId: string | null };

/** The merged raster of one harvest event. */
export interface YieldRaster {
  id: string;
  cropCycleId: string;
  fieldId: string;
  harvestEventKey: string;
  eventFrom: string | null;
  eventTo: string | null;
  grid: YieldGrid;
  /** [west, south, east, north] */
  bounds: [number, number, number, number];
  unit: string;
  attribute: string | null;
  format: YieldMapFormat | null;
  basis: 'wet' | 'dry' | null;
  /** Moisture the rates were standardised to [%], null when not standardised. */
  targetMoisture: number | null;
  stats: YieldStats;
  validPixels: number | null;
  coveredPixels: number | null;
  filledPixels: number | null;
  /** Area of the pixels with data [ha]. */
  areaHa: number | null;
  /** Ground the machines covered [ha]; null when the exports carry no swath widths. */
  harvestedHa: number | null;
  totalT: number | null;
  /** Share of the boundary with data (0..1). */
  fieldCoverage: number | null;
  totalCalibrationFactor: number | null;
  histogram: { binStart: number; binEnd: number; count: number }[];
  contributions: YieldContribution[];
  cleaning: YieldCleaning[];
  quality: Record<string, unknown> | null;
  /** Colour stretch of the map [t/ha]. */
  displayRange: [number, number];
  builtAt: string;
  writeback: YieldWriteback;
}

export interface ZoneYield {
  zoneNo: number;
  areaHa: number;
  /** null when too little of the zone was measured. */
  meanTHa: number | null;
  /** Zone mean / field mean. */
  relativeYield: number | null;
  pixels: number;
  /** Relative productivity of the zone (% of the field mean), for productivity zones. */
  relativeProductivity: number | null;
}

export interface ZoneYieldSet {
  zoningId: string;
  source: 'productivity' | 'yield_map' | 'yield_estimate';
  zoneCount: number;
  fieldMeanTHa: number | null;
  zones: ZoneYield[];
}

/** Everything the crop cycle's yield view shows. */
export interface CropCycleYield {
  cropCycleId: string;
  fieldId: string;
  fieldName: string;
  cropName: string;
  areaHa: number;
  harvestYear: number;
  sources: YieldMapSource[];
  rasters: YieldRaster[];
  zoneYields: ZoneYieldSet[];
  documented: { quantityT: number; areaHa: number | null; yieldTHa: number | null; fromMap: boolean };
  /** Yield zonings saved for this crop cycle (from the map or the estimate). */
  zonings: YieldZoning[];
  /** Mean of the same crop's maps in the season [t/ha], for comparison. */
  cropSeasonMeanTHa: number | null;
}

export interface YieldZoning {
  id: string;
  source: 'yield_map' | 'yield_estimate';
  zoneCount: number;
  params: Record<string, unknown> | null;
  createdAt: string;
  zones: { zoneNo: number; areaHa: number; meanYieldTHa: number | null; relativeProductivity: number | null; color: string; geometry: string }[];
}

/** One crop cycle of the season with what is known about its yield. */
export interface YieldOverviewRow {
  cropCycleId: string;
  fieldId: string;
  fieldName: string;
  cropName: string;
  cropColor: string | null;
  areaHa: number;
  sources: { total: number; ok: number; pending: number; failed: number };
  raster: { id: string; meanTHa: number | null; totalT: number | null; fieldCoverage: number | null; displayRange: [number, number] } | null;
  documentedYieldTHa: number | null;
  documentedFromMap: boolean;
  hasEstimate: boolean;
  bucket: 'map' | 'estimate' | 'documented' | 'nothing';
}

export interface YieldOverview {
  rows: YieldOverviewRow[];
  coverage: {
    totalFields: number;
    withMap: number;
    withEstimate: number;
    withDocumentedOnly: number;
    withNothing: number;
    haMap: number;
    haEstimate: number;
    haDocumentedOnly: number;
    haNothing: number;
    /** Area-weighted mean documented yield [t/ha]. */
    avgYieldTHa: number | null;
  };
  /** Shared colour range per crop — one ramp across wheat and silage maize would be meaningless. */
  scales: { cropName: string; range: [number, number]; cropCycleIds: string[] }[];
}

export interface YieldHistoryEntry {
  harvestYear: number;
  cropCycleId: string;
  cropName: string;
  mapMeanTHa: number | null;
  documentedYieldTHa: number | null;
}

export const YieldEstimateInput = z.object({
  meanYieldTHa: positive.max(200),
  /** Distribution strength: 1 = proportional to relative NDVI, 0 = flat. */
  spread: z.number().min(0).max(1.5).default(1),
  /** Field raster (satellite acquisition) to distribute with; default: the best before harvest. */
  sceneId: id.nullish(),
  zoneCount: z.number().int().min(2).max(7).default(5),
});
export type YieldEstimateInput = z.input<typeof YieldEstimateInput>;

export interface YieldEstimateScene {
  id: string;
  date: string;
  validPixelPct: number;
}

export type YieldEstimatePreview =
  | {
      ok: true;
      sceneId: string;
      sceneDate: string;
      meanYieldTHa: number;
      spread: number;
      zones: { zoneNo: number; color: string; meanTHa: number; areaHa: number; geometry: string }[];
      scenes: YieldEstimateScene[];
    }
  | { ok: false; reason: 'no_yield' | 'no_scene' | 'not_covered'; scenes: YieldEstimateScene[] };

/** Save yield zones: from the merged map, or from the satellite estimate. */
export const SaveYieldZoningInput = z.discriminatedUnion('source', [
  z.object({ source: z.literal('yield_map'), rasterId: id, zoneCount: z.number().int().min(2).max(7).nullish() }),
  z.object({ source: z.literal('yield_estimate'), estimate: YieldEstimateInput }),
]);
export type SaveYieldZoningInput = z.input<typeof SaveYieldZoningInput>;
