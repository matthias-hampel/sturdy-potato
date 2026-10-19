import { z } from 'zod';
import { id, isoDate, longText } from './common.js';

/**
 * Maize dry-matter (DMC) monitoring: whole-plant dry matter of silage and grain maize,
 * forecast by AGVOLUTION's maize-dmc-api for today and the next seven days, calibrated with
 * the farm's own measurements. All dry-matter values are fractions in [0, 1] (0.33 = 33 % DM).
 *
 * Without a configured maize-dmc-api the overview answers `configured: false` and every route
 * that needs the service fails with 503 `dmc_not_configured`.
 */

export const DMC_RESOLUTIONS = ['10m', '3m'] as const;
export type DmcResolution = (typeof DMC_RESOLUTIONS)[number];

export type DmcRunMode = 'standard' | 'calibrated';
/** Silage maize is forecast with the Siloreifezahl, grain maize with the Körnerreifezahl. */
export type DmcMaizeKind = 'silage' | 'grain';
export type DmcHarvestStatus = 'not_harvested' | 'possibly_harvested' | 'harvested';
export type DmcDetectionStatus = 'unconfirmed' | 'confirmed' | 'rejected';
export type DmcDetectionTrust = 'high' | 'medium';
/** What keeps a cycle from being forecast. */
export type DmcMissingInput = 'sowing_date' | 'sowing_in_future' | 'fao_maturity';

/** Satellite harvest detection of a cycle (sudden NDVI drop between two clear scenes). */
export interface DmcHarvestDetected {
  status: DmcDetectionStatus;
  trust: DmcDetectionTrust;
  /** Last scene that still showed a standing crop. */
  windowStart: string;
  /** First scene showing the drop: the harvest happened in (windowStart, windowEnd]. */
  windowEnd: string;
  confirmedAt: string | null;
}

/** Harvest probability for silage maize: P(DM ≥ 33 %) with the forecast and threshold uncertainty. */
export interface DmcHarvestEvaluation {
  probability: number;
  status: DmcHarvestStatus;
  /** |2P − 1|: 0 when maximally uncertain, 1 when decided. */
  confidence: number;
  /** The day all values describe (today, UTC). */
  evaluatedFor: string;
}

/** When the silage harvest window (30–35 % DM) opens and closes. */
export interface DmcHarvestWindow {
  start: string | null;
  end: string | null;
  /** Dates beyond the forecast horizon are extrapolated from the last days' dry-down rate. */
  estimated: boolean;
}

export interface DmcDayPrediction {
  date: string;
  /** Field-mean DM. */
  median: number;
  /** Spatial 10th and 90th percentile. */
  q5: number;
  q95: number;
  /** Uncalibrated model value of a calibrated run. */
  medianUncalibrated: number | null;
  accumulatedGdd: number;
  temperatureMeanC: number;
  /** API paths (below /v1) of the raster for this day. */
  pngPath: string;
  tiffPath: string;
}

export interface DmcCalibrationApplied {
  /** A measurement on this cycle (field mode) or the variety offset. */
  kind: 'measurement' | 'variety_offset';
  measuredDm: number | null;
  measuredAt: string | null;
  offset: number;
}

export interface DmcForecast {
  cropCycleId: string;
  fieldId: string;
  executionId: string;
  createdAt: string;
  runDate: string;
  /** True when today's run was reused instead of calling the service again. */
  cached: boolean;
  mode: DmcRunMode;
  resolution: DmcResolution;
  modelVersion: string | null;
  kind: DmcMaizeKind;
  sowingDate: string;
  faoMaturity: number;
  /** WGS84 extent of the rasters: [west, south, east, north]. */
  bounds: [number, number, number, number] | null;
  calibration: DmcCalibrationApplied | null;
  dailyPredictions: DmcDayPrediction[];
  /** Where the daily weather came from: our stored weather (supplied) or the service's own fetch. */
  weather: { daysTotal: number; daysSupplied: number; daysFetched: number; daysFallback: number } | null;
  harvest: DmcHarvestEvaluation | null;
  harvestDetected: DmcHarvestDetected | null;
  harvestWindow: DmcHarvestWindow | null;
}

export interface DmcMeasurementSummary {
  id: string;
  date: string;
  measuredDm: number;
  /** Measured − standard model at the measurement date. */
  offset: number | null;
}

export interface DmcCycleRow {
  cropCycleId: string;
  fieldId: string;
  fieldName: string;
  fieldPartName: string | null;
  cropName: string;
  kind: DmcMaizeKind;
  varietyId: string | null;
  varietyName: string | null;
  areaHa: number | null;
  sowingDate: string | null;
  sowingSource: 'booked' | 'planned' | null;
  faoMaturity: number | null;
  faoSource: 'cycle' | 'variety' | null;
  missing: DmcMissingInput[];
  /** Newest run within the last week (a run covers its day and the seven after). */
  latestRun: { runDate: string; mode: DmcRunMode; resolution: DmcResolution; executionId: string } | null;
  dmToday: number | null;
  dmP10: number | null;
  dmP90: number | null;
  /** Forecast DM in seven days. */
  dm7d: number | null;
  harvest: DmcHarvestEvaluation | null;
  harvestWindow: DmcHarvestWindow | null;
  harvestDetected: DmcHarvestDetected | null;
  /** First recorded harvest of the cycle. */
  reportedHarvestDate: string | null;
  latestMeasurement: DmcMeasurementSummary | null;
  /** Active offset of the cycle's variety this harvest year. */
  varietyOffset: number | null;
}

export interface DmcOverview {
  /** False while no maize-dmc-api is configured: no forecasts, measurements still work. */
  configured: boolean;
  harvestYear: number;
  today: string;
  cycles: DmcCycleRow[];
}

export interface DmcMeasurement {
  id: string;
  cropCycleId: string;
  measurementDate: string;
  measuredDm: number;
  modelDmAtMeasurement: number | null;
  offset: number | null;
  source: DmcMeasurementSource;
  notes: string | null;
  observedBy: string | null;
  supersededAt: string | null;
  createdAt: string;
}

export const DMC_MEASUREMENT_SOURCES = ['manual', 'lab', 'api'] as const;
export type DmcMeasurementSource = (typeof DMC_MEASUREMENT_SOURCES)[number];

const dmFraction = z.number().finite().gt(0.05).lt(0.95);
const offsetFraction = z.number().finite().min(-0.3).max(0.3);

export const UpdateDmcSettingsInput = z.object({
  /** Null clears the cycle's own value (the variety's applies again). */
  faoMaturity: z.number().int().min(150).max(800).nullable(),
  /** Also store it on the cycle's variety, for every cycle sown with it. */
  applyToVariety: z.boolean().default(false),
});
export type UpdateDmcSettingsInput = z.infer<typeof UpdateDmcSettingsInput>;

export const CreateDmcMeasurementInput = z
  .object({
    measurementDate: isoDate,
    /** Measured DM; omit it to record the measurement as an offset from the model instead. */
    measuredDm: dmFraction.optional(),
    offset: offsetFraction.optional(),
    source: z.enum(DMC_MEASUREMENT_SOURCES).default('manual'),
    notes: longText,
    samples: z.array(z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180), dmPct: z.number().min(0).max(100) })).max(200).optional(),
    resolution: z.enum(DMC_RESOLUTIONS).default('10m'),
  })
  .refine((v) => v.measuredDm != null || v.offset != null, { message: 'measuredDm or offset is required', path: ['measuredDm'] });
export type CreateDmcMeasurementInput = z.infer<typeof CreateDmcMeasurementInput>;

export const UpdateDmcMeasurementInput = z.object({
  measurementDate: isoDate.optional(),
  measuredDm: dmFraction.optional(),
});
export type UpdateDmcMeasurementInput = z.infer<typeof UpdateDmcMeasurementInput>;

/** One measurement of the variety-offset basis. */
export interface DmcOffsetBasisPoint {
  calibrationId: string;
  cropCycleId: string;
  fieldName: string;
  varietyId: string;
  variety: string;
  measurementDate: string;
  measuredDm: number;
  modelDmAtMeasurement: number;
  offset: number;
}

export interface DmcOffsetBasis {
  points: DmcOffsetBasisPoint[];
  /** Mean offset of the points; null without points. */
  suggestedOffset: number | null;
}

export interface DmcOffsetVariety {
  varietyId: string;
  variety: string;
  cycleCount: number;
  measurementCount: number;
}

export const ApplyDmcOffsetInput = z.object({
  harvestYear: z.number().int().min(2000).max(2100),
  varietyIds: z.array(id).min(1).max(200),
  offset: offsetFraction,
  suggestedOffset: z.number().finite().nullable().default(null),
  basis: z.object({ from: isoDate, to: isoDate, calibrationIds: z.array(id).max(5000) }),
  comment: longText,
});
export type ApplyDmcOffsetInput = z.infer<typeof ApplyDmcOffsetInput>;

export const RevokeDmcOffsetsInput = z.object({ ids: z.array(id).min(1).max(200) });
export type RevokeDmcOffsetsInput = z.infer<typeof RevokeDmcOffsetsInput>;

/** Offsets applied together (one row per variety) shown as one entry. */
export interface DmcOffsetBatch {
  key: string;
  offset: number;
  suggestedOffset: number | null;
  basisCount: number;
  basisFrom: string | null;
  basisTo: string | null;
  comment: string | null;
  appliedBy: string | null;
  appliedAt: string;
  supersededAt: string | null;
  varieties: { rowId: string; varietyId: string; variety: string | null }[];
}
