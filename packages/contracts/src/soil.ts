import type { MultiPolygon } from 'geojson';
import { z } from 'zod';
import type { ContentClass } from './agronomy.js';
import { id, isoDate } from './common.js';
import { FieldGeometry } from './farms.js';

// ---------------------------------------------------------------------------
// Soil sampling planner (ported from AGVOLUTION/agmeo, lib/soil)
// ---------------------------------------------------------------------------

/** Satellite zone delineation methods, computed by agmeo-geo. */
export const ZONATION_METHODS = ['fcm', 'kmeans', 'segment', 'probe', 'probe-v2'] as const;
export type ZonationMethod = (typeof ZONATION_METHODS)[number];
/** Raster layers zones can be cut from. */
export const ZONATION_SOURCES = ['ndvi', 'ndre', 'ndmi', 'productivity'] as const;
export type ZonationSource = (typeof ZONATION_SOURCES)[number];
export const ZONATION_CLEANUPS = ['merge', 'fix-kws'] as const;
/** Every way a zonation can come about. */
export type SoilZonationMethod = ZonationMethod | 'grid' | 'voronoi' | 'zoning' | 'manual' | 'upload';
export type SoilZonationStatus = 'queued' | 'running' | 'ready' | 'failed';

export const ZONATION_METHOD_DEFAULT: ZonationMethod = 'fcm';
export const ZONATION_SOURCE_DEFAULT: ZonationSource = 'ndvi';
export const MIN_ZONE_HA_OPTIONS = [0.05, 0.25, 0.5, 1, 2, 3, 5] as const;
export const MIN_ZONE_HA_DEFAULT = 0.25;
export const COARSENESS_DEFAULT = 0.35;
export const ZONE_COUNT_MANUAL_OPTIONS = [2, 3, 4, 5] as const;

/** Batch wizard rule: fields below the threshold get one zone, else one per started `haPerZone`. */
export const ZONE_RULE_SMALL_FIELD_MAX_HA_DEFAULT = 3.5;
export const ZONE_RULE_HA_PER_ZONE_DEFAULT = 3;
export function zonesForAreaByRule(areaHa: number, smallFieldMaxHa: number, haPerZone: number): number {
  if (!Number.isFinite(areaHa) || areaHa <= 0) return 1;
  if (areaHa < smallFieldMaxHa) return 1;
  return Math.max(1, Math.ceil(areaHa / Math.max(haPerZone, 0.01)));
}

/** Grid sampling: cell size presets in ha. */
export const GRID_CELL_HA_PRESETS = [1, 1.5, 3, 5, 10] as const;
export const GRID_DEFAULT_CELL_HA = 3;
export const SAMPLING_PLAN_MODES = ['grid', 'voronoi', 'zones'] as const;
export type SamplingPlanMode = (typeof SAMPLING_PLAN_MODES)[number];

export const ZONE_COLORS = [
  '#22c55e', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16', '#6366f1', '#f97316',
  '#14b8a6', '#a855f7', '#eab308', '#0ea5e9', '#f43f5e', '#166534', '#1e40af', '#b45309', '#991b1b', '#5b21b6',
  '#155e75', '#9d174d', '#3f6212', '#3730a3', '#9a3412', '#115e59', '#6b21a8', '#854d0e', '#075985', '#9f1239',
] as const;
export const soilZoneColor = (index: number) => ZONE_COLORS[((index % ZONE_COLORS.length) + ZONE_COLORS.length) % ZONE_COLORS.length];

// ---------------------------------------------------------------------------
// Soil parameters (stored per zone in canonical units)
// ---------------------------------------------------------------------------

export const SOIL_PARAMETERS = [
  'soc', 'humus', 'clay', 'silt', 'sand', 'ph', 'p2o5', 'k2o', 'mgo', 'bd', 'nmin', 'no3', 'nh4', 'cec', 'nt', 's', 'b', 'cu',
  'zn', 'mn', 'fe', 'cd', 'na', 'ca', 'mo', 'smin', 'nsol', 'caco3', 'ct', 'siltf', 'siltm', 'siltc', 'sandf', 'sandmc', 'pb',
  'cr', 'ni', 'hg', 'as', 'cut', 'znt',
] as const;
export type SoilParameter = (typeof SOIL_PARAMETERS)[number];
export const isSoilParameter = (p: string): p is SoilParameter => (SOIL_PARAMETERS as readonly string[]).includes(p);

/** Unit of the canonical value and display decimals. */
export const SOIL_PARAM_META: Record<SoilParameter, { unit: string; decimals: number }> = {
  humus: { unit: '%', decimals: 1 },
  ph: { unit: '', decimals: 1 },
  p2o5: { unit: 'mg/100 g', decimals: 0 },
  k2o: { unit: 'mg/100 g', decimals: 0 },
  mgo: { unit: 'mg/100 g', decimals: 0 },
  soc: { unit: '%', decimals: 1 },
  clay: { unit: '%', decimals: 1 },
  silt: { unit: '%', decimals: 1 },
  sand: { unit: '%', decimals: 1 },
  bd: { unit: 'g/cm³', decimals: 2 },
  nmin: { unit: 'kg N/ha', decimals: 0 },
  no3: { unit: 'kg N/ha', decimals: 0 },
  nh4: { unit: 'kg N/ha', decimals: 0 },
  cec: { unit: 'cmolc/kg', decimals: 1 },
  nt: { unit: '%', decimals: 2 },
  s: { unit: 'mg/kg', decimals: 0 },
  b: { unit: 'mg/kg', decimals: 2 },
  cu: { unit: 'mg/kg', decimals: 1 },
  zn: { unit: 'mg/kg', decimals: 1 },
  mn: { unit: 'mg/kg', decimals: 0 },
  fe: { unit: 'mg/kg', decimals: 0 },
  cd: { unit: 'mg/kg', decimals: 2 },
  na: { unit: 'mg/kg', decimals: 1 },
  ca: { unit: 'mg/kg', decimals: 0 },
  mo: { unit: 'mg/kg', decimals: 2 },
  smin: { unit: 'kg S/ha', decimals: 0 },
  nsol: { unit: 'mg/kg', decimals: 0 },
  caco3: { unit: '%', decimals: 1 },
  ct: { unit: '%', decimals: 1 },
  siltf: { unit: '%', decimals: 1 },
  siltm: { unit: '%', decimals: 1 },
  siltc: { unit: '%', decimals: 1 },
  sandf: { unit: '%', decimals: 1 },
  sandmc: { unit: '%', decimals: 1 },
  pb: { unit: 'mg/kg', decimals: 2 },
  cr: { unit: 'mg/kg', decimals: 1 },
  ni: { unit: 'mg/kg', decimals: 1 },
  hg: { unit: 'mg/kg', decimals: 3 },
  as: { unit: 'mg/kg', decimals: 2 },
  cut: { unit: 'mg/kg', decimals: 1 },
  znt: { unit: 'mg/kg', decimals: 1 },
};

/** Lab result columns in display order. */
export const ALL_RESULT_PARAMS: readonly SoilParameter[] = [
  'ph', 'p2o5', 'k2o', 'mgo', 'humus', 'nmin', 'soc', 'cec', 'nt', 'b', 'cu', 'mn', 'zn', 'fe', 's', 'smin', 'na', 'ca', 'mo',
  'nsol', 'caco3', 'ct', 'clay', 'silt', 'sand', 'siltf', 'siltm', 'siltc', 'sandf', 'sandmc', 'bd', 'pb', 'cr', 'ni', 'hg', 'as',
  'cut', 'znt',
];
export const DEFAULT_RESULT_COLS: readonly SoilParameter[] = ['ph', 'p2o5', 'k2o', 'mgo', 'humus', 'nmin'];
/** The headline macronutrients: default columns and map layers of the dashboards. */
export const HEADLINE_PARAMS: readonly SoilParameter[] = ['ph', 'p2o5', 'k2o', 'mgo'];

/** Extractant / measurement method per parameter; null means the parameter default. */
export const SOIL_METHOD_DEFAULTS: Partial<Record<SoilParameter, string>> = {
  p2o5: 'cal', k2o: 'cal', mgo: 'cacl2', ph: 'cacl2', humus: 'walkley-black', soc: 'walkley-black', nt: 'kjeldahl',
  clay: 'ka5', silt: 'ka5', sand: 'ka5', b: 'cat', cu: 'cat', zn: 'cat', mn: 'cat', fe: 'cat', na: 'cat', ca: 'cat', mo: 'cat', s: 'cat',
};

/** What the lab reports beyond the values: its own supply classes, lime need, recommendations, lab number. */
export interface ZoneLabExtras {
  supplyClass?: Partial<Record<SoilParameter, string>>;
  kalkbedarf?: { dtHa?: number | null; kg?: number | null } | null;
  labNr?: string | null;
}

// ---------------------------------------------------------------------------
// Zonations
// ---------------------------------------------------------------------------

const zoneCount = z.union([z.literal('auto'), z.int().min(1).max(30)]);

export const BatchZonationInput = z.object({
  fieldIds: z.array(id).min(1).max(500),
  method: z.enum(ZONATION_METHODS).default(ZONATION_METHOD_DEFAULT),
  source: z.enum(ZONATION_SOURCES).default(ZONATION_SOURCE_DEFAULT),
  zoneCount: zoneCount.default('auto'),
  /** Zone count per field (e.g. from the area rule), overriding `zoneCount`. */
  zoneCounts: z.record(z.string(), zoneCount).optional(),
  minZoneHa: z.number().min(0.01).max(50).default(MIN_ZONE_HA_DEFAULT),
  coarseness: z.number().min(0).max(1).default(COARSENESS_DEFAULT),
  cleanup: z.enum(ZONATION_CLEANUPS).default('merge'),
  /** A specific acquisition instead of the clearest of the last year. */
  sceneDate: isoDate.nullish(),
});
export type BatchZonationInput = z.input<typeof BatchZonationInput>;

const lngLat = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);

export const SamplingPlanInput = z.object({
  mode: z.enum(SAMPLING_PLAN_MODES),
  /** Target cell size (grid, Voronoi). */
  cellHa: z.number().min(0.1).max(100).default(GRID_DEFAULT_CELL_HA),
  /** Grid direction: from the first to the second point; default the field's longest edge. */
  axis: z.tuple([lngLat, lngLat]).nullish(),
  /** Voronoi generators placed by hand; default an even hexagonal layout, relaxed. */
  points: z.array(lngLat).max(2000).nullish(),
  /** mode 'zones': the productivity zoning whose zones become sampling zones. */
  zoningId: id.nullish(),
});
export type SamplingPlanInput = z.input<typeof SamplingPlanInput>;

export const BatchSamplingPlanInput = SamplingPlanInput.omit({ points: true, axis: true, zoningId: true }).extend({
  fieldIds: z.array(id).min(1).max(500),
});
export type BatchSamplingPlanInput = z.input<typeof BatchSamplingPlanInput>;

/** The zone editor's result: the complete new set of zones (existing ids keep their probe number and values). */
export const SaveZonesInput = z.object({
  zones: z
    .array(
      z.object({
        id: id.nullish(),
        label: z.string().trim().min(1).max(80),
        color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullish(),
        geometry: FieldGeometry,
      }),
    )
    .min(1)
    .max(500),
});
export type SaveZonesInput = z.input<typeof SaveZonesInput>;

export const UpdateZoneInput = z.object({
  label: z.string().trim().min(1).max(80).optional(),
  probeNr: z.int().min(1).max(99_999_999).nullish(),
  /** Measured values in canonical units; null removes a value. */
  values: z.record(z.string(), z.number().finite().nullable()).optional(),
  sampledOn: isoDate.nullish(),
});
export type UpdateZoneInput = z.input<typeof UpdateZoneInput>;

export const AssignProbeNumbersInput = z.object({
  fieldIds: z.array(id).min(1).max(500),
  /** Number the zones from here, ignoring stored numbers; default continue after the highest number in use. */
  start: z.int().min(1).max(99_999_999).nullish(),
});
export type AssignProbeNumbersInput = z.input<typeof AssignProbeNumbersInput>;

export interface SoilZone {
  id: string;
  zoneNo: number;
  label: string;
  color: string;
  areaHa: number;
  probeNr: number | null;
  meanValue: number | null;
  geometry: MultiPolygon;
  /** [lng, lat] where the sampler starts. */
  samplePoint: [number, number] | null;
  values: Partial<Record<SoilParameter, number>>;
  methods: Partial<Record<SoilParameter, string>>;
  /** Sampling date per parameter. */
  dates: Partial<Record<SoilParameter, string>>;
  lab: ZoneLabExtras | null;
  /** VDLUFA content classes for the field's soil class (as in nutrient planning). */
  classes: { ph: ContentClass | null; p: ContentClass | null; k: ContentClass | null; mg: ContentClass | null };
}

export interface SoilZonation {
  id: string;
  fieldId: string;
  method: SoilZonationMethod;
  source: string;
  params: Record<string, unknown>;
  zoneCount: number | null;
  status: SoilZonationStatus;
  statusCode: string | null;
  error: string | null;
  sceneDate: string | null;
  batchId: string | null;
  createdAt: string;
  finishedAt: string | null;
  supersededAt: string | null;
  active: boolean;
  /** Latest sampling date of its zones. */
  sampledOn: string | null;
}

export interface FieldSoilZonation {
  field: { id: string; name: string; areaHa: number; geometry: MultiPolygon };
  zonation: (SoilZonation & { zones: SoilZone[] }) | null;
  /** Runs still queued or computing, and the latest failure since the active zonation. */
  pending: SoilZonation[];
}

export interface SoilFieldRow {
  fieldId: string;
  fieldName: string;
  farmName: string;
  areaHa: number;
  zonation: { id: string; method: SoilZonationMethod; source: string; zoneCount: number; createdAt: string } | null;
  pending: { status: SoilZonationStatus; statusCode: string | null } | null;
  /** Zones with a probe number. */
  probes: number;
  /** Zones with measured values. */
  sampledZones: number;
  sampledOn: string | null;
  /** Area-weighted means of the active zonation's measured values. */
  means: Partial<Record<SoilParameter, number>>;
}

export interface BatchResult {
  batchId: string;
  results: { fieldId: string; status: 'queued' | 'created' | 'skipped' | 'failed'; reason?: string; zonationId?: string; zoneCount?: number }[];
}

export interface SamplingPlanPreview {
  zones: { geometry: MultiPolygon; areaHa: number; samplePoint: [number, number] }[];
  /** Voronoi generators (editable). */
  points: [number, number][];
  /** Grid lines for orientation. */
  lines: [number, number][][];
  tooMany: boolean;
}
