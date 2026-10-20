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

// ---------------------------------------------------------------------------
// Exports: sample cards and zone maps
// ---------------------------------------------------------------------------

export const SOIL_EXPORT_FORMATS = ['sampleCard', 'zonationPdf', 'resultsPdf', 'geojson', 'shapefile'] as const;
export type SoilExportFormat = (typeof SOIL_EXPORT_FORMATS)[number];

export const SoilExportInput = z.object({
  fieldIds: z.array(id).min(1).max(1000),
  format: z.enum(SOIL_EXPORT_FORMATS),
  /** KUNDE column of the sample card: the farm's customer number at the lab. */
  customerNumber: z.string().trim().max(10).nullish(),
  /** Renumber the sample card from here; default keep numbers and continue after the highest. */
  startProbeNr: z.int().min(1).max(99_999_999).nullish(),
  /** Result columns of the results PDF; default pH, P, K, Mg, humus, Nmin. */
  params: z.array(z.enum(SOIL_PARAMETERS)).max(20).nullish(),
});
export type SoilExportInput = z.input<typeof SoilExportInput>;

export interface SoilExportResult {
  /** The archived file (system folder "Soil exports"). */
  file: import('./files.js').FileItem;
  /** Fields without an active zonation, left out (or listed separately in the zonation PDF). */
  skippedFieldIds: string[];
  /** Probe numbers stamped on the zones for the sample card. */
  probeNumbers: number;
}

// ---------------------------------------------------------------------------
// Lab results
// ---------------------------------------------------------------------------

export type LabFileRejection = 'unsupported-format' | 'unit-mismatch' | 'no-shapefile-found';

/** One analysed sample of a lab file, values in canonical units. */
export interface LabResultRow {
  probeNr: number | null;
  fieldNameHint: string | null;
  date: string;
  values: Partial<Record<SoilParameter, number>>;
  methods: Partial<Record<SoilParameter, string>>;
  stages: Partial<Record<SoilParameter, string>>;
  kalkbedarf: { dtHa: number | null; kg: number | null } | null;
  labNr: string | null;
  point: [number, number] | null;
}

export interface LabPreviewField {
  fieldId: string;
  fieldName: string;
  fieldAreaHa: number;
  zonationId: string;
  probes: { zoneId: string; zoneLabel: string; probeNr: number | null; match: 'probe' | 'location'; row: LabResultRow }[];
  params: SoilParameter[];
  /** Every value of the file is already stored on the zones. */
  alreadyImported: boolean;
  /** Latest sampling date already stored for these parameters. */
  storedSampleDate: string | null;
}

export interface LabPreview {
  fileNames: string[];
  failedFileNames: string[];
  rejectedFiles: { fileName: string; reason: LabFileRejection }[];
  rowCount: number;
  duplicateRows: number;
  fields: LabPreviewField[];
  unmatched: LabResultRow[];
}

export interface LabApplyResult {
  importId: string | null;
  /** Archived originals in the "Soil imports" folder. */
  fileIds: string[];
  results: { fieldId: string; fieldName: string; status: 'success' | 'failed'; probeCount?: number; sampleIds?: string[]; reason?: string }[];
}

export interface SoilLabImport {
  id: string;
  fileNames: string[];
  files: { id: string; name: string }[];
  createdAt: string;
  createdByName: string | null;
  zoneCount: number;
  fields: { id: string; name: string }[];
  sampledOn: string | null;
}

// ---------------------------------------------------------------------------
// History, compare and analysis
// ---------------------------------------------------------------------------

/** A zonation of a field with its zones and the area-weighted means of their measured values. */
export interface SoilCampaign {
  zonationId: string;
  method: SoilZonationMethod;
  source: string;
  createdAt: string;
  active: boolean;
  /** Latest sampling date of its zones; null for a zonation without lab values. */
  sampledOn: string | null;
  means: Partial<Record<SoilParameter, number>>;
  zones: SoilZone[];
}

export interface FieldSoilHistory {
  field: { id: string; name: string; areaHa: number; geometry: MultiPolygon };
  /** Newest first. */
  campaigns: SoilCampaign[];
  /** Soil samples of the field (manual and from lab imports), newest first. */
  samples: import('./agronomy.js').SoilSample[];
}

/** A past state of the zone maps of several fields: a batch run or the end of a day. */
export interface SoilHistoryState {
  key: string;
  kind: 'batch' | 'day';
  at: string;
  /** The zonation each field had in this state. */
  fields: { fieldId: string; zonationId: string }[];
  willChange: number;
  unchanged: number;
  noZonation: number;
}

export const RestoreZonationsInput = z.object({ zonationIds: z.array(id).min(1).max(1000) });
export type RestoreZonationsInput = z.input<typeof RestoreZonationsInput>;

export const ANALYSIS_PARAMS = ['ph', 'p2o5', 'k2o', 'mgo', 'humus'] as const;
export type AnalysisParam = (typeof ANALYSIS_PARAMS)[number];
export type StageCount = Record<ContentClass, number>;
type ClassKey = 'ph' | 'p' | 'k' | 'mg';
export const CLASS_KEYS: Record<'ph' | 'p2o5' | 'k2o' | 'mgo', ClassKey> = { ph: 'ph', p2o5: 'p', k2o: 'k', mgo: 'mg' };

/** One zone of an active zonation, as the analysis dashboard aggregates it. */
export interface SoilAnalysisZone {
  fieldId: string;
  year: number | null;
  areaHa: number;
  values: Partial<Record<AnalysisParam, number>>;
  classes: Record<ClassKey, ContentClass | null>;
  /** Lime need of the zone in dt CaO (rate × area), over three years. */
  limeDt: number | null;
}

export interface SoilAnalysisField {
  id: string;
  name: string;
  sampleCount: number;
  soilTexture: string | null;
  bbox: [number, number, number, number] | null;
  /** Content classes of the field's area-weighted means. */
  classes: Record<ClassKey, ContentClass | null>;
}

export interface SoilAnalysisPayload {
  zones: SoilAnalysisZone[];
  /** Fields with at least one sampled zone. */
  fields: SoilAnalysisField[];
  totalFieldCount: number;
}

export type HumusClass = 'veryLow' | 'low' | 'mid' | 'high' | 'veryHigh';

export interface SoilAnalysisRecommendation {
  key: 'lowP' | 'lowK' | 'lowMg' | 'lowPh' | 'highP' | 'highK' | 'highMg' | 'positivePh' | 'positiveHumus' | 'positiveBase';
  priority: 'high' | 'mid' | 'positive';
  fields: string[];
}

export interface SoilAnalysisSummary {
  sampleCount: number;
  fieldCount: number;
  totalFieldCount: number;
  avg: Record<AnalysisParam, number | null>;
  dominantSoilTexture: string | null;
  stages: Record<'ph' | 'p2o5' | 'k2o' | 'mgo', StageCount>;
  humusClass: HumusClass | null;
  perField: { fieldId: string; fieldName: string; sampleCount: number; avg: Record<AnalysisParam, number | null>; limeDt: number | null }[];
  earliestYear: number | null;
  latestYear: number | null;
  bbox: [number, number, number, number] | null;
  totalLimeT: number | null;
  recommendations: SoilAnalysisRecommendation[];
}

const HUMUS_BOUNDS = [1.5, 2, 3, 4] as const;
const humusClassOf = (v: number | null): HumusClass | null =>
  v == null ? null : v <= HUMUS_BOUNDS[0] ? 'veryLow' : v <= HUMUS_BOUNDS[1] ? 'low' : v <= HUMUS_BOUNDS[2] ? 'mid' : v <= HUMUS_BOUNDS[3] ? 'high' : 'veryHigh';
const emptyStages = (): StageCount => ({ A: 0, B: 0, C: 0, D: 0, E: 0 });
const roundTo = (v: number | null, d: number) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10 ** d) / 10 ** d);

/**
 * The analysis dashboard's numbers for a selection of fields (ported from the reference's
 * soilAnalyseShared.ts): per-zone means, VDLUFA class distribution, per-field averages, lime need
 * and the recommendations derived from the fields' mean classes.
 */
export function buildSoilAnalysisSummary(payload: SoilAnalysisPayload, selected: ReadonlySet<string>): SoilAnalysisSummary {
  const fields = payload.fields.filter((f) => selected.has(f.id));
  const zones = payload.zones.filter((z) => selected.has(z.fieldId));
  const sums: Record<AnalysisParam, [number, number]> = { ph: [0, 0], p2o5: [0, 0], k2o: [0, 0], mgo: [0, 0], humus: [0, 0] };
  const stages = { ph: emptyStages(), p2o5: emptyStages(), k2o: emptyStages(), mgo: emptyStages() };
  const textures = new Map<string, number>();
  const perField = new Map(fields.map((f) => [f.id, { f, count: 0, sums: { ph: [0, 0], p2o5: [0, 0], k2o: [0, 0], mgo: [0, 0], humus: [0, 0] } as Record<AnalysisParam, [number, number]>, lime: 0, limeZones: 0 }]));
  let earliest: number | null = null;
  let latest: number | null = null;
  let lime = 0;
  let limeZones = 0;
  for (const z of zones) {
    const agg = perField.get(z.fieldId);
    if (!agg) continue;
    agg.count++;
    for (const p of ANALYSIS_PARAMS) {
      const v = z.values[p];
      if (v == null) continue;
      sums[p][0] += v;
      sums[p][1]++;
      agg.sums[p][0] += v;
      agg.sums[p][1]++;
    }
    for (const p of ['ph', 'p2o5', 'k2o', 'mgo'] as const) {
      const cls = z.classes[CLASS_KEYS[p]];
      if (cls) stages[p][cls]++;
    }
    if (z.year != null) {
      earliest = earliest == null ? z.year : Math.min(earliest, z.year);
      latest = latest == null ? z.year : Math.max(latest, z.year);
    }
    if (z.limeDt != null) {
      lime += z.limeDt;
      limeZones++;
      agg.lime += z.limeDt;
      agg.limeZones++;
    }
  }
  for (const f of fields) if (f.soilTexture) textures.set(f.soilTexture, (textures.get(f.soilTexture) ?? 0) + (perField.get(f.id)?.count ?? 0));
  const avgOf = (s: Record<AnalysisParam, [number, number]>) =>
    Object.fromEntries(ANALYSIS_PARAMS.map((p) => [p, s[p][1] ? roundTo(s[p][0] / s[p][1], 2) : null])) as Record<AnalysisParam, number | null>;
  const avg = avgOf(sums);
  const rows = [...perField.values()]
    .filter((a) => a.count > 0)
    .map((a) => ({ fieldId: a.f.id, fieldName: a.f.name, sampleCount: a.count, avg: avgOf(a.sums), limeDt: a.limeZones ? roundTo(a.lime, 1) : null }))
    .sort((a, b) => a.fieldName.localeCompare(b.fieldName));
  const sampled = new Set(rows.map((r) => r.fieldId));

  const recommendations: SoilAnalysisRecommendation[] = [];
  const atClasses = (key: ClassKey, wanted: ContentClass[]) => fields.filter((f) => sampled.has(f.id) && f.classes[key] && wanted.includes(f.classes[key]!)).map((f) => f.name);
  const push = (key: SoilAnalysisRecommendation['key'], cls: ClassKey, wanted: ContentClass[], priority: 'high' | 'mid') => {
    const names = atClasses(cls, wanted);
    if (names.length) recommendations.push({ key, priority, fields: names });
  };
  push('lowP', 'p', ['A', 'B'], 'high');
  push('lowK', 'k', ['A', 'B'], 'high');
  push('lowMg', 'mg', ['A', 'B'], 'high');
  push('lowPh', 'ph', ['A', 'B'], 'high');
  push('highP', 'p', ['D', 'E'], 'mid');
  push('highK', 'k', ['D', 'E'], 'mid');
  push('highMg', 'mg', ['D', 'E'], 'mid');
  const total = (c: StageCount) => c.A + c.B + c.C + c.D + c.E;
  if (total(stages.ph) > 0 && (stages.ph.C + stages.ph.D) / total(stages.ph) >= 2 / 3) recommendations.push({ key: 'positivePh', priority: 'positive', fields: [] });
  const humusClass = humusClassOf(avg.humus);
  if (humusClass === 'mid' || humusClass === 'high') recommendations.push({ key: 'positiveHumus', priority: 'positive', fields: [] });
  if (!recommendations.some((r) => r.priority === 'high') && stages.p2o5.C + stages.k2o.C + stages.mgo.C > 0) recommendations.push({ key: 'positiveBase', priority: 'positive', fields: [] });

  const boxes = fields.map((f) => f.bbox).filter((b): b is [number, number, number, number] => !!b);
  return {
    sampleCount: zones.length,
    fieldCount: rows.length,
    totalFieldCount: payload.totalFieldCount,
    avg,
    dominantSoilTexture: [...textures.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
    stages,
    humusClass,
    perField: rows,
    earliestYear: earliest,
    latestYear: latest,
    bbox: boxes.length ? [Math.min(...boxes.map((b) => b[0])), Math.min(...boxes.map((b) => b[1])), Math.max(...boxes.map((b) => b[2])), Math.max(...boxes.map((b) => b[3]))] : null,
    totalLimeT: limeZones ? roundTo(lime / 10, 1) : null,
    recommendations,
  };
}

// ---------------------------------------------------------------------------
// Share links
// ---------------------------------------------------------------------------

export const MIN_SHARE_PASSWORD = 6;
export const SOIL_SHARE_KINDS = ['results', 'history'] as const;
export type SoilShareKind = (typeof SOIL_SHARE_KINDS)[number];

export const CreateSoilShareInput = z.object({
  kind: z.enum(SOIL_SHARE_KINDS).default('results'),
  title: z.string().trim().min(1).max(200),
  /** Empty = every active field of the organization (history permalink). */
  fieldIds: z.array(id).max(1000).default([]),
  password: z.string().min(MIN_SHARE_PASSWORD).max(200).nullish(),
  expiresAt: z.iso.datetime({ offset: true }).nullish(),
  /** The lab import whose original file the viewer may download. */
  labImportId: id.nullish(),
});
export type CreateSoilShareInput = z.input<typeof CreateSoilShareInput>;

export const UpdateSoilShareInput = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  /** A new password; null removes it. */
  password: z.string().min(MIN_SHARE_PASSWORD).max(200).nullish(),
  expiresAt: z.iso.datetime({ offset: true }).nullish(),
});
export type UpdateSoilShareInput = z.input<typeof UpdateSoilShareInput>;

export interface SoilShare {
  id: string;
  token: string;
  kind: SoilShareKind;
  title: string;
  fieldIds: string[];
  fieldNames: string[];
  hasPassword: boolean;
  hasFile: boolean;
  expiresAt: string | null;
  createdAt: string;
  createdByName: string | null;
  revokedAt: string | null;
}

export const SoilShareAccessInput = z.object({ password: z.string().max(200).nullish() });
export type SoilShareAccessInput = z.input<typeof SoilShareAccessInput>;

/** What a viewer sees before entering the password. */
export interface SoilShareInfo {
  title: string;
  kind: SoilShareKind;
  orgName: string;
  status: 'ok' | 'expired' | 'revoked';
  requiresPassword: boolean;
  hasFile: boolean;
  createdAt: string;
}

export interface SoilShareCampaign {
  zonationId: string;
  createdAt: string;
  active: boolean;
  sampledOn: string | null;
  zones: SoilZone[];
}

export interface SoilShareField {
  fieldId: string;
  fieldName: string;
  areaHa: number;
  soilTexture: string | null;
  geometry: MultiPolygon;
  /** Newest first; a results share carries only the active zone map. */
  campaigns: SoilShareCampaign[];
}

export interface SoilShareData extends SoilShareInfo {
  /** Short-lived token for further requests (data, file) without the password. */
  accessToken: string;
  fields: SoilShareField[];
  /** Measured parameters, in display order. */
  params: SoilParameter[];
}
