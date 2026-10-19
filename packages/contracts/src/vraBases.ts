import type { MultiPolygon, Polygon, Position } from 'geojson'
import { z } from 'zod'
import { VRA_EXPORT_FORMATS, VRA_INPUT_TYPES, VRA_MAP_STATUSES, VRA_RATE_UNITS, VRA_UNIT_SYSTEMS, type VraMapListItem } from './vra.js'

// ---------------------------------------------------------------------------
// Base zonations of application maps (reference: CultivationBaseZones, BaseZonationPicker,
// CreateBaseZonationModal, UploadBaseZonationButton, bulk setup)
// ---------------------------------------------------------------------------

/** Where a zoning comes from. The last five are made for application maps. */
export const BASE_SOURCES = ['productivity', 'yield_map', 'yield_estimate', 'soil', 'upload', 'satellite', 'manual', 'uniform'] as const
export type BaseSource = (typeof BASE_SOURCES)[number]
/** Zonings the user creates, renames and deletes. */
export const OWN_BASE_SOURCES = ['soil', 'upload', 'satellite', 'manual', 'uniform'] as const satisfies readonly BaseSource[]
export const isOwnBase = (source: string) => (OWN_BASE_SOURCES as readonly string[]).includes(source)

/** Most zones a zoning (and so a map) may have: uploaded maps with many distinct rates. */
export const MAX_ZONES = 50

/** Vegetation indices a satellite zoning can be classified from. */
export const SATELLITE_BASE_INDICES = ['ndvi', 'ndre', 'ndmi', 'evi', 'bsi', 'ndti'] as const
export type SatelliteBaseIndex = (typeof SATELLITE_BASE_INDICES)[number]
/** At most this many scenes are combined into a pixel-wise median (reference MAX_SATELLITE_SCENES). */
export const MAX_SATELLITE_SCENES = 5
export const SATELLITE_ZONE_COUNTS = [2, 3, 4, 5, 6, 7, 8, 9, 10] as const
export const SATELLITE_METHODS = ['fcm', 'kmeans', 'segment'] as const

export interface BaseZone {
  zoneNo: number
  areaHa: number
  /** Share of the zoning's area, %. */
  sharePct: number
  /** Relative productivity (yield), % of the field mean. */
  relativeProductivity: number | null
  meanYieldTHa: number | null
  geometry: MultiPolygon
}

export interface BaseZoning {
  id: string
  fieldId: string
  source: BaseSource
  name: string | null
  zoneCount: number
  isDefault: boolean
  /** Offered as a base for new maps (zones edited for one map only are not). */
  listed: boolean
  /** Made on the field's current boundary. */
  current: boolean
  cropCycleId: string | null
  params: Record<string, unknown> | null
  createdAt: string
  /** Application maps made on this zoning; such a zoning cannot be deleted. */
  mapCount: number
  zones: BaseZone[]
}

export const ZONING_JOB_STATUSES = ['queued', 'running', 'ready', 'failed'] as const
export type ZoningJobStatus = (typeof ZONING_JOB_STATUSES)[number]

export interface ZoningJob {
  id: string
  fieldId: string
  indexType: SatelliteBaseIndex
  sceneDates: string[]
  zoneCount: number
  name: string | null
  status: ZoningJobStatus
  statusCode: string | null
  zoningId: string | null
  createdAt: string
  finishedAt: string | null
}

/** Everything a field offers as the base of an application map. */
export interface VraBases {
  fieldId: string
  fieldName: string
  fieldAreaHa: number
  boundary: MultiPolygon
  zonings: BaseZoning[]
  /** The field's active soil zonation, when there is one (offered to copy). */
  soilZonation: { id: string; zoneCount: number; method: string; createdAt: string; copiedZoningId: string | null } | null
  /** Satellite zonings queued or computed for the field, newest first. */
  jobs: ZoningJob[]
}

const Name = z.string().trim().min(1).max(120)

export const SoilBaseInput = z.object({ name: Name.nullish() })
export const UniformBaseInput = z.object({ name: Name.nullish() })

export const SatelliteBaseInput = z.object({
  indexType: z.enum(SATELLITE_BASE_INDICES).default('ndvi'),
  sceneDates: z
    .array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/))
    .min(1)
    .max(MAX_SATELLITE_SCENES)
    .refine((d) => new Set(d).size === d.length, 'Pick each scene once'),
  zoneCount: z.number().int().min(2).max(10),
  method: z.enum(SATELLITE_METHODS).default('fcm'),
  name: Name.nullish(),
})
export type SatelliteBaseInput = z.input<typeof SatelliteBaseInput>

const ZoneGeometry = z.custom<Polygon | MultiPolygon>(
  (g) => !!g && typeof g === 'object' && ((g as { type?: string }).type === 'Polygon' || (g as { type?: string }).type === 'MultiPolygon') && Array.isArray((g as { coordinates?: unknown }).coordinates),
  'Expected a Polygon or MultiPolygon',
)

/** Zones from the brush editor, in zone order (zone 1 first). */
export const ManualBaseInput = z.object({
  name: Name.nullish(),
  /** Listed as a base for new maps (reference "Auch als Basis-Karte speichern"). */
  listed: z.boolean().default(true),
  /** The zoning the zones were edited from. */
  baseZoningId: z.uuid().nullish(),
  /** An own zoning to replace (reference "Diese Basis-Karte aktualisieren"); maps on it keep working. */
  replaceId: z.uuid().nullish(),
  zones: z
    .array(z.object({ geometry: ZoneGeometry, relativeProductivity: z.number().min(1).max(1000).nullish() }))
    .min(1)
    .max(MAX_ZONES),
})
export type ManualBaseInput = z.input<typeof ManualBaseInput>

export const BasePatch = z.object({
  name: Name.nullable().optional(),
  isDefault: z.boolean().optional(),
  listed: z.boolean().optional(),
})

/** What an uploaded zone file held (reference UploadResult). */
export interface UploadBaseResult {
  zoning: BaseZoning
  /** The value the zones were cut by: a rate column, or a nutrient target (kg/ha). */
  targetKey: 'rate' | 'target_n' | 'target_p2o5' | 'target_k2o' | 'target_mgo'
  unit: 'kg/ha' | 'l/ha' | null
  /** Area-weighted mean of the value, or 0 when every value was zero. */
  meanTarget: number
  /** Features skipped for lacking the value. */
  dropped: number
}

// ---------------------------------------------------------------------------
// Bulk maps and batch export
// ---------------------------------------------------------------------------

/** Which zoning a bulk map is made on; fields without one use the fallback. */
export const BULK_BASES = ['default', 'productivity', 'yield', 'soil', 'uniform'] as const
export type BulkBase = (typeof BULK_BASES)[number]
export const BULK_FALLBACKS = ['productivity', 'uniform', 'skip'] as const

export const BulkVraInput = z.object({
  type: z.enum(VRA_INPUT_TYPES),
  /** Title of each map; `{field}` is replaced by the field name. */
  title: z.string().trim().min(1).max(120),
  unitSystem: z.enum(VRA_UNIT_SYSTEMS).default('metric'),
  status: z.enum(VRA_MAP_STATUSES).default('draft'),
  base: z.enum(BULK_BASES).default('default'),
  fallback: z.enum(BULK_FALLBACKS).default('productivity'),
  /** Zone count for productivity zonings (the nearest one is used). */
  zoneCount: z.number().int().min(2).max(7).default(5),
  strategy: z.enum(['proportional', 'inverse']).default('proportional'),
  /** Spreader resolution: rates rounded to this step. */
  rateStep: z.number().positive().max(1000).nullish(),
  input: z.object({
    productId: z.uuid().nullish(),
    cropId: z.uuid().nullish(),
    name: z.string().trim().max(120).default(''),
    unit: z.enum(VRA_RATE_UNITS),
    standardRate: z.number().gt(0).max(1e10),
    germinationPct: z.number().gt(0).max(100).nullish(),
  }),
  fields: z
    .array(z.object({ fieldId: z.uuid(), standardRate: z.number().gt(0).max(1e10).nullish(), zoneCount: z.number().int().min(2).max(7).nullish() }))
    .min(1)
    .max(500),
})
export type BulkVraInput = z.input<typeof BulkVraInput>

export interface BulkVraResult {
  batchId: string
  created: VraMapListItem[]
  /** Fields left without a map, with the reason: no_zoning, no_crop, not_found, invalid. */
  failed: { fieldId: string; fieldName: string | null; code: string }[]
}

export const VraBatchExportInput = z.object({
  mapIds: z.array(z.uuid()).min(1).max(500),
  format: z.enum(VRA_EXPORT_FORMATS).default('isoxml'),
})

export const VraListQuery = z.object({
  fieldId: z.uuid().optional(),
  batchId: z.uuid().optional(),
})

// ---------------------------------------------------------------------------
// Zone geometry helpers of the reference (utils/area.ts) and its relative-yield spread
// ---------------------------------------------------------------------------

const RADIUS = 6378137

/** Geodesic ring area in m² (the spherical-excess formula of @turf/area). */
function ringArea(coords: Position[]): number {
  const n = coords.length
  if (n <= 2) return 0
  let total = 0
  const rad = (d: number) => (d * Math.PI) / 180
  for (let i = 0; i < n; i++) {
    const lower = coords[i]
    const middle = coords[(i + 1) % n]
    const upper = coords[(i + 2) % n]
    total += (rad(upper[0]) - rad(lower[0])) * Math.sin(rad(middle[1]))
  }
  return Math.abs((total * RADIUS * RADIUS) / 2)
}

/** Area of a polygon geometry in hectares (holes subtracted). */
export function geometryAreaHa(geometry: Polygon | MultiPolygon): number {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates
  let m2 = 0
  for (const rings of polygons) rings.forEach((ring, i) => (m2 += (i === 0 ? 1 : -1) * ringArea(ring)))
  return Math.max(0, m2) / 10_000
}

/**
 * Share of the field each zone covers, in zone order (reference zoneAreaFractions). Fractions
 * sum to 1; zero-area zones give zeros rather than NaN.
 */
export function zoneAreaFractions(geometries: readonly (Polygon | MultiPolygon)[]): number[] {
  const areas = geometries.map(geometryAreaHa)
  const total = areas.reduce((s, a) => s + a, 0)
  return areas.map((a) => (total > 0 ? a / total : 0))
}

/**
 * Band of the invented relative yield of zones that carry only a rank or an unscaled metric
 * (reference SYNTHETIC_SPREAD): the weakest zone 0.8, the strongest 1.2.
 */
export const SYNTHETIC_SPREAD: [number, number] = [0.8, 1.2]

/**
 * Relative yields (1 = mean) of zones from a metric (humus, index mean) or, when a zone lacks it
 * or all are equal, from their rank (reference computeRelativeYields). `inverse` turns the
 * spread around (high metric → low yield).
 */
export function syntheticRelative(zones: { key: number; metric: number | null; rank: number }[], inverse = false): Map<number, number> {
  const out = new Map<number, number>()
  if (!zones.length) return out
  if (zones.length === 1) return out.set(zones[0].key, 1)
  const [lo, hi] = SYNTHETIC_SPREAD
  const scale = (n: number) => (inverse ? hi - n * (hi - lo) : lo + n * (hi - lo))
  const metrics = zones.map((z) => z.metric).filter((m): m is number => m != null && Number.isFinite(m))
  const [min, max] = [Math.min(...metrics), Math.max(...metrics)]
  if (metrics.length === zones.length && max - min > 0) {
    for (const z of zones) out.set(z.key, scale((z.metric! - min) / (max - min)))
    return out
  }
  const ranks = zones.map((z) => z.rank)
  const [rMin, rMax] = [Math.min(...ranks), Math.max(...ranks)]
  for (const z of zones) out.set(z.key, scale(rMax > rMin ? (z.rank - rMin) / (rMax - rMin) : 0))
  return out
}

/**
 * Relative yields of zones by a target value (reference normaliseWeightedTargets): the value
 * over its area-weighted mean; all ones when there is no positive mean.
 */
export function weightedTargets(zones: { target: number; areaHa: number }[]): { relative: number[]; mean: number } {
  const area = zones.reduce((s, z) => s + z.areaHa, 0)
  if (area <= 0) return { relative: zones.map(() => 1), mean: 0 }
  const mean = zones.reduce((s, z) => s + z.target * z.areaHa, 0) / area
  if (mean <= 0) return { relative: zones.map(() => 1), mean: 0 }
  return { relative: zones.map((z) => z.target / mean), mean }
}

/** Relative yields by unweighted mean (reference normaliseTargets, for nutrient targets). */
export function plainTargets(zones: { target: number }[]): { relative: number[]; mean: number } {
  if (!zones.length) return { relative: [], mean: 0 }
  const sum = zones.reduce((s, z) => s + z.target, 0)
  if (sum <= 0) return { relative: zones.map(() => 1), mean: 0 }
  const mean = sum / zones.length
  return { relative: zones.map((z) => z.target / mean), mean }
}

/**
 * Colour of a zone by relative yield (% of the mean): red below, yellow at, green above the
 * mean, saturating at the rate bounds 65 % / 135 % (reference newRelativeYieldColors).
 */
export function relativeColor(relativePct: number | null): string {
  if (relativePct == null) return '#9ca3af'
  const t = Math.min(1, Math.max(0, (relativePct - 65) / 70))
  const stops: [number, number, number][] = [
    [215, 48, 39],
    [252, 141, 89],
    [254, 224, 139],
    [145, 207, 96],
    [26, 152, 80],
  ]
  const x = t * (stops.length - 1)
  const i = Math.min(stops.length - 2, Math.floor(x))
  const f = x - i
  const c = stops[i].map((v, k) => Math.round(v + (stops[i + 1][k] - v) * f))
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`
}
