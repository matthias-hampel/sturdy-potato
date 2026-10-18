import type { MultiPolygon } from 'geojson'
import { z } from 'zod'

// ---------------------------------------------------------------------------
// Variable-rate (VRA) maps
// ---------------------------------------------------------------------------

export const VRA_MAP_TYPES = ['sowing', 'fertilizing', 'spraying', 'several'] as const
export type VraMapType = (typeof VRA_MAP_TYPES)[number]
export const VRA_INPUT_TYPES = ['sowing', 'fertilizing', 'spraying'] as const
export type VraInputType = (typeof VRA_INPUT_TYPES)[number]

/** Rates are stored per hectare; the unit system only changes display and export. */
export const VRA_RATE_UNITS = ['seeds/ha', 'kg/ha', 'l/ha'] as const
export type VraRateUnit = (typeof VRA_RATE_UNITS)[number]
export const VRA_UNITS_BY_TYPE: Record<VraInputType, readonly VraRateUnit[]> = {
  sowing: ['seeds/ha', 'kg/ha'],
  fertilizing: ['kg/ha', 'l/ha'],
  spraying: ['l/ha', 'kg/ha'],
}
export const VRA_UNIT_SYSTEMS = ['metric', 'imperial'] as const
export type VraUnitSystem = (typeof VRA_UNIT_SYSTEMS)[number]
export const VRA_MAP_STATUSES = ['draft', 'final'] as const
export type VraMapStatus = (typeof VRA_MAP_STATUSES)[number]

/** Per-acre unit of each per-hectare unit and the factor from the per-hectare value. */
export const VRA_IMPERIAL: Record<VraRateUnit, { unit: string; factor: number }> = {
  // 1 ac = 0.40468564 ha; 1 lb = 0.45359237 kg; 1 US gal = 3.78541178 l.
  'seeds/ha': { unit: 'seeds/ac', factor: 0.40468564 },
  'kg/ha': { unit: 'lb/ac', factor: 0.40468564 / 0.45359237 },
  'l/ha': { unit: 'gal/ac', factor: 0.40468564 / 3.78541178 },
}

/** Rate presets relative to the standard rate, %. */
export const VRA_PRESETS = [30, 20, 15, 10, 5, 0, -5, -10, -15, -20, -30] as const

/** Seeds and large values are whole numbers; everything else has two decimals. */
export function roundRate(value: number, unit: VraRateUnit): number {
  const digits = unit === 'seeds/ha' || Math.abs(value) >= 1000 ? 0 : 2
  const f = 10 ** digits
  return Math.round(value * f) / f
}

/** Default zone rate: the standard rate scaled by the zone's productivity (% of the field mean). */
export function defaultZoneRate(standardRate: number, relativeProductivity: number | null, unit: VraRateUnit): number {
  return roundRate((standardRate * (relativeProductivity ?? 100)) / 100, unit)
}

/** The standard rate changed by a preset, e.g. +10 %. */
export function presetRate(standardRate: number, presetPct: number, unit: VraRateUnit): number {
  return roundRate(standardRate * (1 + presetPct / 100), unit)
}

export interface VraZoneLike {
  zoneNo: number
  areaHa: number
  relativeProductivity: number | null
}

/** Default rates of all zones, keyed by zone number. */
export function defaultRates(standardRate: number, zones: VraZoneLike[], unit: VraRateUnit): Record<string, number> {
  return Object.fromEntries(zones.map((z) => [String(z.zoneNo), defaultZoneRate(standardRate, z.relativeProductivity, unit)]))
}

export interface VraInputTotals {
  /** Σ rate × zone area, in the unit's numerator (seeds, kg, l). */
  total: number
  /** Field area × standard rate. */
  flatTotal: number | null
  /** flatTotal − total: positive when the map uses less than a flat rate. */
  savings: number | null
  /** Savings are only worth showing when they are not rounding noise. */
  showSavings: boolean
}

export function vraInputTotals(
  input: { standardRate: number | null; rates: Record<string, number> },
  zones: { zoneNo: number; areaHa: number }[],
  fieldAreaHa: number,
): VraInputTotals {
  const total = zones.reduce((s, z) => s + (input.rates[String(z.zoneNo)] ?? 0) * z.areaHa, 0)
  if (!input.standardRate) return { total, flatTotal: null, savings: null, showSavings: false }
  const flatTotal = fieldAreaHa * input.standardRate
  const savings = flatTotal - total
  return { total, flatTotal, savings, showSavings: Math.abs(savings) > 0.1 }
}

/**
 * Zone rates from relative productivity, after AGVOLUTION/agmeo (applicationMapsPage/utils.ts,
 * vrn/vrs recommendation routes): a zone's factor follows its productivity, is clipped to
 * 0.65–1.35 and normalized so the field receives the standard amount.
 */
export const MIN_ZONE_FACTOR = 0.65
export const MAX_ZONE_FACTOR = 1.35

/**
 * Factors per zone (area-weighted mean 1). `direction` +1 gives productive zones more,
 * −1 gives them less; `gain` 1 makes the factor follow productivity one to one.
 */
export function zoneFactors(zones: VraZoneLike[], direction: 1 | -1, gain = 1): Map<number, number> {
  const raw = zones.map((z) => {
    const d = (z.relativeProductivity ?? 100) / 100 - 1
    return { zone: z, f: Math.min(MAX_ZONE_FACTOR, Math.max(MIN_ZONE_FACTOR, 1 + direction * d * gain)) }
  })
  const area = raw.reduce((s, r) => s + r.zone.areaHa, 0)
  const mean = area > 0 ? raw.reduce((s, r) => s + r.f * r.zone.areaHa, 0) / area : 1
  return new Map(raw.map((r) => [r.zone.zoneNo, mean > 0 ? r.f / mean : 1]))
}

export function zoneRates(
  zones: VraZoneLike[],
  standardRate: number,
  opts: { direction: 1 | -1; gain?: number; minRate?: number | null; maxRate?: number | null; round: (v: number) => number },
): { rates: Record<string, number>; meanRate: number } {
  const factors = zoneFactors(zones, opts.direction, opts.gain ?? 1)
  const rates: Record<string, number> = {}
  for (const z of zones) {
    let rate = standardRate * (factors.get(z.zoneNo) ?? 1)
    if (opts.minRate != null) rate = Math.max(rate, opts.minRate)
    if (opts.maxRate != null) rate = Math.min(rate, opts.maxRate)
    rates[String(z.zoneNo)] = opts.round(rate)
  }
  const area = zones.reduce((s, z) => s + z.areaHa, 0)
  const meanRate = area > 0 ? zones.reduce((s, z) => s + rates[String(z.zoneNo)] * z.areaHa, 0) / area : standardRate
  return { rates, meanRate: opts.round(meanRate) }
}

/** Shapefile column from an input name: up to six letters or digits, upper case. */
export function columnNameFrom(name: string): string {
  return name.replace(/[^a-zA-Z0-9]/g, '').slice(0, 6).toUpperCase()
}

const FILE_NAME_MAX = 64

/**
 * Export file name (without extension): ASCII only, since terminals often choke on anything else,
 * at most 64 characters; the field name is shortened first.
 */
export function vraFileName(fieldName: string, type: VraMapType, date: string): string {
  const clean = (s: string) =>
    s
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/ß/g, 'ss')
      .replace(/[^A-Za-z0-9._-]+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '')
  const suffix = `_VRA_${type}_${date}`
  const field = clean(fieldName).slice(0, Math.max(1, FILE_NAME_MAX - suffix.length)) || 'field'
  return `${field}${suffix}`.slice(0, FILE_NAME_MAX)
}

const ColumnName = z
  .string()
  .trim()
  .transform((s) => s.toUpperCase())
  .pipe(z.string().regex(/^[A-Z0-9]{1,6}$/, 'Up to six letters or digits'))

export const VraMapInputItem = z.object({
  inputType: z.enum(VRA_INPUT_TYPES),
  productId: z.uuid().nullish(),
  cropId: z.uuid().nullish(),
  name: z.string().trim().max(120).default(''),
  unit: z.enum(VRA_RATE_UNITS),
  standardRate: z.number().min(0).max(1e8).nullish(),
  columnName: ColumnName.optional(),
  /** Rate per hectare by zone number. */
  rates: z.record(z.string().regex(/^[1-7]$/), z.number().min(0).max(1e8)),
})
export type VraMapInputItem = z.input<typeof VraMapInputItem>

export const VraMapInput = z
  .object({
    zoningId: z.uuid(),
    type: z.enum(VRA_MAP_TYPES),
    title: z.string().trim().min(1).max(120),
    unitSystem: z.enum(VRA_UNIT_SYSTEMS).default('metric'),
    status: z.enum(VRA_MAP_STATUSES).default('draft'),
    inputs: z.array(VraMapInputItem).min(1).max(6),
    /** The operation whose zone rates the map holds (one map per operation). */
    operationId: z.uuid().nullish(),
    /** Required on update: the version the edit is based on. */
    version: z.number().int().positive().optional(),
  })
  .superRefine((map, ctx) => {
    const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: 'custom', path, message })
    if (map.type !== 'several') {
      if (map.inputs.length !== 1) issue(['inputs'], `A ${map.type} map has exactly one input`)
    } else if (map.inputs.length < 2) issue(['inputs'], 'A map with several inputs needs at least two')
    const columns = new Set<string>()
    map.inputs.forEach((input, i) => {
      if (map.type !== 'several' && input.inputType !== map.type) issue(['inputs', i, 'inputType'], `Expected a ${map.type} input`)
      if (!VRA_UNITS_BY_TYPE[input.inputType].includes(input.unit)) issue(['inputs', i, 'unit'], `Unit ${input.unit} does not fit ${input.inputType}`)
      if (input.inputType === 'sowing') {
        if (!input.standardRate) issue(['inputs', i, 'standardRate'], 'Sowing needs a standard rate above 0')
        if (!input.cropId) issue(['inputs', i, 'cropId'], 'Sowing needs a crop')
      } else if (!input.name) issue(['inputs', i, 'name'], 'Enter the product name')
      if (map.type === 'several') {
        if (!input.columnName) issue(['inputs', i, 'columnName'], 'Each input needs a column name')
        else if (columns.has(input.columnName)) issue(['inputs', i, 'columnName'], 'Column names must be unique')
        else columns.add(input.columnName)
      }
    })
  })
export type VraMapInput = z.input<typeof VraMapInput>

export const VRA_EXPORT_FORMATS = ['shp', 'isoxml', 'geojson'] as const
export type VraExportFormat = (typeof VRA_EXPORT_FORMATS)[number]
export const VraExportQuery = z.object({ format: z.enum(VRA_EXPORT_FORMATS).default('shp') })

export interface VraMapInputView {
  id: string
  inputType: VraInputType
  productId: string | null
  productName: string | null
  cropId: string | null
  cropName: string | null
  name: string
  unit: VraRateUnit
  standardRate: number | null
  columnName: string
  rates: Record<string, number>
}

export interface VraMapZone {
  zoneNo: number
  areaHa: number
  sharePct: number
  relativeProductivity: number | null
  geometry: MultiPolygon
}

export interface VraMapSummary {
  id: string
  fieldId: string
  zoningId: string
  zoneCount: number
  /** The operation whose zone rates the map holds. */
  operationId: string | null
  type: VraMapType
  title: string
  unitSystem: VraUnitSystem
  status: VraMapStatus
  version: number
  /** Whether the map was made on the field's current boundary. */
  current: boolean
  createdBy: string | null
  createdAt: string
  updatedAt: string
  inputs: VraMapInputView[]
}

export interface VraMap extends VraMapSummary {
  fieldAreaHa: number
  zones: VraMapZone[]
}
