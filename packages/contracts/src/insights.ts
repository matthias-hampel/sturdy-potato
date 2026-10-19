import type { MultiPolygon } from 'geojson';
import { z } from 'zod';
import type { LatLng } from './common.js';
import type { OperationStatus, OperationType } from './operations.js';
import type { Task } from './tasks.js';

// ---------------------------------------------------------------------------
// Weather
// ---------------------------------------------------------------------------

export interface WeatherDay {
  date: string;
  tempMinC: number | null;
  tempMaxC: number | null;
  precipitationMm: number | null;
  precipitationProbabilityPct: number | null;
  windMaxKmh: number | null;
  gustMaxKmh: number | null;
  et0Mm: number | null;
  weatherCode: number | null;
  /** Growing degree days, base 5 °C. */
  gdd: number | null;
}

export interface WeatherHour {
  time: string;
  tempC: number | null;
  precipitationMm: number | null;
  precipitationProbabilityPct: number | null;
  windKmh: number | null;
  gustKmh: number | null;
  humidityPct: number | null;
}

export interface WeatherNotice {
  kind: 'frost' | 'heavy_rain' | 'strong_wind' | 'heat' | 'dry_spell';
  severity: 'info' | 'warning';
  date: string;
  message: string;
}

/** A period where forecast values are within typical spraying thresholds. */
export interface SprayWindow {
  start: string;
  end: string;
  hours: number;
}

export interface WeatherForecast {
  farmId: string;
  farmName: string;
  location: LatLng;
  provider: string;
  providerUrl: string;
  fetchedAt: string;
  timezone: string;
  current: {
    time: string;
    tempC: number | null;
    humidityPct: number | null;
    windKmh: number | null;
    precipitationMm: number | null;
    weatherCode: number | null;
  } | null;
  /** Observed (reanalysis/model) precipitation over the past seven days. */
  precipitationLast7dMm: number | null;
  past: WeatherDay[];
  daily: WeatherDay[];
  hourly: WeatherHour[];
  notices: WeatherNotice[];
  sprayWindows: SprayWindow[];
}

// ---------------------------------------------------------------------------
// Satellite monitoring
// ---------------------------------------------------------------------------

/** Indices computed per field and acquisition (backend/agmeo-geo, agmeo_geo/sources.py INDICES). */
export const VEGETATION_INDICES = ['ndvi', 'ndre', 'ndmi', 'evi', 'bsi', 'ndti'] as const;
export type VegetationIndex = (typeof VEGETATION_INDICES)[number];

/**
 * Display scales for index rasters and map shading: values at or below `min` get the first
 * colour stop, at or above `max` the last. Single-hue sequential ramps. Mirrored by the
 * tile server in backend/agmeo-geo (agmeo_geo/colormaps.py); keep both in sync.
 */
export const INDEX_SCALES: Record<VegetationIndex, { label: string; description: string; min: number; max: number; stops: string[] }> = {
  ndvi: {
    label: 'NDVI',
    description: 'Greenness / vigour',
    min: 0.2,
    max: 0.9,
    stops: ['#eef4e0', '#c3dfa5', '#86bd67', '#458f3c', '#1a5a1f'],
  },
  ndre: {
    label: 'NDRE',
    description: 'Chlorophyll, dense canopies',
    min: 0.1,
    max: 0.6,
    stops: ['#eef4e0', '#c3dfa5', '#86bd67', '#458f3c', '#1a5a1f'],
  },
  ndmi: {
    label: 'NDMI',
    description: 'Canopy moisture',
    min: -0.2,
    max: 0.5,
    stops: ['#e7f0f8', '#b5d0e8', '#76a9d3', '#3a78b2', '#164a7e'],
  },
  evi: {
    label: 'EVI',
    description: 'Vigour, saturates less in dense canopies',
    min: 0.1,
    max: 0.8,
    stops: ['#eef4e0', '#c3dfa5', '#86bd67', '#458f3c', '#1a5a1f'],
  },
  bsi: {
    label: 'BSI',
    description: 'Bare soil',
    min: -0.3,
    max: 0.3,
    stops: ['#f5efe6', '#e2c9a6', '#c49a64', '#94683a', '#5c3d1e'],
  },
  ndti: {
    label: 'NDTI',
    description: 'Crop residue on bare soil',
    min: 0,
    max: 0.3,
    stops: ['#f6f3e1', '#e6dba3', '#c8b25f', '#958033', '#5e5119'],
  },
}

/**
 * Within-field contrast (and relative productivity): below the field's typical value, around
 * it, above it. Diverging, with a neutral midpoint. Mirrored by agmeo_geo/colormaps.py.
 */
export const RELATIVE_SCALE = {
  stops: ['#8a5a1e', '#c49a5c', '#e6e4de', '#86b866', '#2e6f2b'],
  lowLabel: 'Below field median',
  highLabel: 'Above field median',
} as const

/** Raster layers of an acquisition: an index, or true colour. */
export const IMAGERY_LAYERS = [...VEGETATION_INDICES, 'rgb'] as const
export type ImageryLayer = (typeof IMAGERY_LAYERS)[number]
export type ImageryStretch = 'absolute' | 'relative'

/** An acquisition date with imagery for at least one of the requested fields, newest first. */
export interface ImageryDate {
  date: string
  /** Fields with imagery on this date. */
  fieldCount: number
  /** Ids of those fields (fields of other acquisition passes have no imagery on this date). */
  fieldIds: string[]
  /** Mean clear (cloud-free) share of those fields, %. */
  clearPct: number
  /** Whether at least one of them meets the clear-sky threshold for statistics. */
  valid: boolean
  hasRgb: boolean
  /** For a single requested field: its NDVI field mean, when valid. */
  ndvi: number | null
}

/** Backfill of a field's imagery history (or the aggregate over the organization's fields). */
export interface ImageryStatus {
  state: 'none' | 'queued' | 'running' | 'finished' | 'failed'
  fields: number
  scenesTotal: number
  scenesDone: number
  /** Acquisitions up to this date are processed (the earliest over all fields). */
  coveredUntil: string | null
  historyFrom: string | null
  error: string | null
}

// ---------------------------------------------------------------------------
// Productivity zones
// ---------------------------------------------------------------------------

export const ZONE_COUNTS = [3, 5, 7] as const
export type ZoneCount = (typeof ZONE_COUNTS)[number]

/**
 * Zone colours, least to most productive: one sequential purple ramp of seven steps; fewer
 * zones use evenly spread steps so the extremes stay the same.
 */
export const ZONE_RAMP = ['#f3dcf5', '#e2b9e6', '#cf96d3', '#b974bd', '#9e52a1', '#7f3482', '#5e1a61'] as const
const ZONE_STEPS: Record<number, number[]> = { 2: [1, 5], 3: [0, 3, 6], 4: [0, 2, 4, 6], 5: [0, 2, 3, 4, 6], 6: [0, 1, 2, 4, 5, 6], 7: [0, 1, 2, 3, 4, 5, 6] }
export function zoneColor(zoneNo: number, zoneCount: number): string {
  return ZONE_RAMP[ZONE_STEPS[zoneCount]?.[zoneNo - 1] ?? 3]
}

export interface ProductivityZone {
  zoneNo: number
  areaHa: number
  /** Share of the field area, %. */
  sharePct: number
  /** Mean relative productivity in the zone, % of the field mean. */
  relativeProductivity: number | null
  geometry: MultiPolygon
}

export interface Zoning {
  id: string
  zoneCount: number
  isCustom: boolean
  zones: ProductivityZone[]
}

export interface ProductivityScene {
  sceneId: string
  date: string
  season: number
  ndviMean: number
  used: boolean
  excluded: boolean
}

export type ProductivityStatusCode = 'ok' | 'not_enough_scenes' | 'not_enough_seasons' | 'no_imagery' | 'error'

export interface ProductivityAnalysis {
  id: string
  fieldId: string
  status: 'queued' | 'running' | 'finished' | 'failed'
  statusCode: ProductivityStatusCode | null
  /** 0..1: how consistently the same areas perform across seasons. */
  suitability: number | null
  suitabilityStatus: 'suitable' | 'partially_suitable' | 'not_suitable' | null
  seasonCount: number | null
  sceneCount: number | null
  scenes: ProductivityScene[]
  /** Whether the analysis used the field's current boundary. */
  current: boolean
  createdAt: string
  finishedAt: string | null
  error: string | null
  zonings: Zoning[]
}

/** The latest completed analysis of a field, and a newer one still being computed. */
export interface ProductivityState {
  analysis: ProductivityAnalysis | null
  pending: { id: string; status: 'queued' | 'running'; createdAt: string } | null
}

export const RecalculateProductivityInput = z.object({
  excludedSceneIds: z.array(z.uuid()).max(2000).default([]),
})
export type RecalculateProductivityInput = z.input<typeof RecalculateProductivityInput>

export interface FieldObservation {
  id: string;
  fieldId: string;
  observedOn: string;
  indexType: VegetationIndex;
  mean: number | null;
  median: number | null;
  p10: number | null;
  p90: number | null;
  stddev: number | null;
  validPixelPct: number;
  status: 'valid' | 'insufficient_coverage';
  source: string;
  processingVersion: string;
}

export interface FieldMonitoringSummary {
  fieldId: string;
  fieldName: string;
  areaHa: number;
  cropName: string | null;
  cropColor: string | null;
  latest: { observedOn: string; mean: number | null; change: number | null } | null;
  validObservations: number;
}

// ---------------------------------------------------------------------------
// Compliance
// ---------------------------------------------------------------------------

export interface ComplianceIssue {
  operationId: string;
  operationTitle: string;
  operationType: OperationType;
  performedAt: string | null;
  severity: 'error' | 'warning';
  code: string;
  message: string;
  fieldNames: string[];
}

export interface ComplianceReport {
  seasonId: string | null;
  checkedOperations: number;
  completeOperations: number;
  issues: ComplianceIssue[];
  /** Rule set the checks were evaluated with, kept with every exported record. */
  ruleset: string;
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

export interface DashboardOperation {
  id: string;
  title: string;
  type: OperationType;
  status: OperationStatus;
  plannedOn: string | null;
  fieldNames: string[];
}

export interface Dashboard {
  season: { id: string; name: string } | null;
  farmCount: number;
  fieldCount: number;
  totalAreaHa: number;
  plantedAreaHa: number;
  cropsByArea: { cropId: string; cropName: string; color: string; areaHa: number }[];
  openTaskCount: number;
  overdueTasks: Task[];
  upcomingOperations: DashboardOperation[];
  overdueOperations: DashboardOperation[];
  lowStock: { productId: string; name: string; stock: number; threshold: number; baseUnit: string }[];
  maintenanceDue: { equipmentId: string; name: string; dueOn: string | null; dueHours: number | null }[];
  complianceIssueCount: number;
  setup: { hasFarm: boolean; hasFields: boolean; hasSeason: boolean; hasCropCycles: boolean };
}

// ---------------------------------------------------------------------------
// Stored weather per field (F5)
// ---------------------------------------------------------------------------

/** One day of stored weather of a field's grid cell. Wind in km/h, radiation in MJ/m², soil moisture in m³/m³. */
export interface StoredWeatherDay {
  date: string;
  tempMin: number | null;
  tempMax: number | null;
  tempMean: number | null;
  precipitation: number | null;
  humidityMin: number | null;
  humidityMax: number | null;
  humidityMean: number | null;
  dewPointMean: number | null;
  windSpeedMax: number | null;
  windSpeedMean: number | null;
  windGustsMax: number | null;
  et0: number | null;
  radiationSum: number | null;
  soilTemp0to7cm: number | null;
  soilTemp7to28cm: number | null;
  soilMoisture0to7cm: number | null;
  soilMoisture7to28cm: number | null;
  /** Archive days are final; forecast days are replaced by later refreshes. */
  source: 'archive' | 'forecast';
}

export interface StoredWeatherHour {
  /** ISO instant. */
  time: string;
  tempC: number | null;
  humidityPct: number | null;
  dewPointC: number | null;
  precipitationMm: number | null;
  precipitationProbabilityPct: number | null;
  windKmh: number | null;
  gustKmh: number | null;
}

export interface FieldWeather {
  fieldId: string;
  /** The 0.01° grid cell the field's weather comes from. */
  cell: { lat: number; lng: number; timezone: string | null };
  refreshedAt: string | null;
  /** First stored day; null until the cell's first refresh. */
  storedFrom: string | null;
  daily: StoredWeatherDay[];
  /** From the current hour on, at most 48 hours. */
  hourly: StoredWeatherHour[];
}

// ---------------------------------------------------------------------------
// Field conditions from the models (condition bars, phenology, water balance, trafficability)
// ---------------------------------------------------------------------------

/** 0 = good … 3 = bad, null = no data. */
export type ConditionLevel = 0 | 1 | 2 | 3;

export interface ConditionReason {
  /** Untranslated reason key of the model, e.g. "reason.wind". */
  key: string;
  value: number | string | null;
}

export interface ConditionDay {
  date: string;
  value: ConditionLevel | null;
  reasons: ConditionReason[];
}

export interface FieldConditions {
  fieldId: string;
  refreshedAt: string | null;
  cropCycle: { id: string; cropName: string; sowingDate: string | null; sowingSource: 'booked' | 'planned' | null } | null;
  /** The soil class the water balance uses; its texture fractions are class mid-points. */
  soil: { texture: string | null; textureSource: 'soil_class' | null };
  bars: { spraying: ConditionDay[]; sowing: ConditionDay[]; weatherRisk: ConditionDay[]; trafficability: ConditionDay[] | null };
  /** Spray level per hour for the next 48 hours. */
  sprayHours: { time: string; level: ConditionLevel; reasons: ConditionReason[] }[];
  phenology: { sowingDate: string | null; gdd: number | null; currentBbch: number | null; bbchSource: 'model' | 'calendar' | null; bbchByDate: Record<string, number> | null } | null;
  waterBalance: {
    soilTypeKa5: string | null;
    awcMm: number | null;
    rootDepthM: number;
    currentDeficitMm: number | null;
    deficitLevel: string | null;
    totalPrecipitationMm: number;
    totalEtaMm: number;
    /** Irrigation recommendation of the reference model (status, triggerDate, doseMm, …). */
    recommendation: Record<string, unknown>;
    days: { date: string; swcMm: number; deficitMm: number; etaMm: number; precipitationMm: number | null; forecast: boolean }[];
  } | null;
}

export interface FieldTrafficability {
  fieldId: string;
  equipmentId: string;
  ka5: string | null;
  frontKpa: number;
  rearKpa: number;
  sciReady: boolean;
  days: { date: string; pf: number | null; precompressionKpa: number | null; stressAtDepthKpa: number | null; sci: number | null; band: string | null }[];
}
