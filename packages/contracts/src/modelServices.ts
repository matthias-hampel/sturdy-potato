import type { MultiPolygon } from 'geojson'
import { z } from 'zod'
import { id, isoDate } from './common.js'

// ---------------------------------------------------------------------------
// AGVOLUTION model services: ESM (zone yields, nitrogen terms, crop timeseries), grassland-api
// (grassland growth) and the ISIP disease models.
//
// Convention while a service is not configured (no URL or credentials): reads answer 200 with
// `configured: false` and no data from the service; a request that would call it answers 503
// with the code `service_not_configured` (details.service names it). A configured service that
// fails answers 502 `service_unavailable`.
// ---------------------------------------------------------------------------

export const MODEL_SERVICES = ['esm', 'grassland', 'isip'] as const
export type ModelService = (typeof MODEL_SERVICES)[number]

// --- ESM ---------------------------------------------------------------------------------------

export const ESM_RUN_STATUSES = ['queued', 'running', 'succeeded', 'failed'] as const
export type EsmRunStatus = (typeof ESM_RUN_STATUSES)[number]

export interface EsmRun {
  id: string
  cropCycleId: string
  zoneCount: number
  status: EsmRunStatus
  executionId: string | null
  error: string | null
  requestedAt: string
  finishedAt: string | null
}

export const StartEsmRunInput = z.object({
  /** Zones the ESM divides the crop into; default: 3, one for legumes and fields under 2 ha. */
  zoneCount: z.number().int().min(1).max(7).optional(),
})
export type StartEsmRunInput = z.infer<typeof StartEsmRunInput>

/** A zone as the ESM models it. Nitrogen values in kg N/ha. */
export interface EsmModelZone {
  zoneNo: number
  areaHa: number
  areaFraction: number
  yieldTHa: number
  /** N uptake of the crop (CNUP); null when the ESM did not send it. */
  nCropKgHa: number | null
  /** Mineral N at the start of the season. */
  nMinKgHa: number
  /** N mineralised during the season. */
  nMinSpringKgHa: number
  nLossKgHa: number
  soilTypeLufa: string | null
  soilOrganicCarbonPct: number | null
  geometry: MultiPolygon
}

/**
 * The N model on a productivity zone: the ESM zones it overlaps, area-weighted, and the N demand
 * of the reference's nitrogen calculator (crop N at the modelled yield − Nmin − mineralisation
 * + loss + residual N), before fertilisation. kg N/ha.
 */
export interface ZoneNitrogenModel {
  zoneNo: number
  /** Share of the productivity zone the ESM zones cover, 0..1. */
  coverage: number
  yieldTHa: number
  nCropKgHa: number | null
  nMinKgHa: number
  nMinSpringKgHa: number
  nLossKgHa: number
  nResidualKgHa: number
  nDemandKgHa: number | null
  soilTypeLufa: string | null
}

export interface NitrogenModel {
  configured: boolean
  cropCycleId: string
  /** The ESM crop the crop is modelled as; null when the ESM has no equivalent. */
  esmCrop: string | null
  /** Whether a crop N curve exists for the crop; without one the N demand is null. */
  hasNitrogenModel: boolean
  /** The most recent run, whatever its status. */
  latestRun: EsmRun | null
  /** The most recent successful run, whose zones follow. */
  run: EsmRun | null
  modelZones: EsmModelZone[]
  /** The productivity zoning `zones` refer to; null without one. */
  zoningId: string | null
  zones: ZoneNitrogenModel[]
}

/** ESM crop timeseries (timeseries.json), one value per key (day). */
export interface CropTimeseries {
  keys: string[]
  FRESH_MATTER: number[]
  DRY_MATTER: number[]
  DMC: number[]
  BBCH: number[]
  GDD: number[]
  CBD: number[]
  DTU: number[]
  LAI: number[]
  NFK: number[]
  CNMIN: number[]
  CNUP: number[]
}

/** Crop N uptake and N supply by BBCH from the timeseries, offset to start at zero (unscaled). */
export interface NitrogenCurvePoint {
  bbch: number
  uptake: number
  supply: number
}

export const PredictionTimeseriesQuery = z
  .object({
    cropCycleId: id.optional(),
    fieldId: id.optional(),
    year: z.coerce.number().int().min(2000).max(2100).optional(),
  })
  .refine((q) => !!q.cropCycleId || (!!q.fieldId && q.year != null), { message: 'Give cropCycleId, or fieldId and year' })
export type PredictionTimeseriesQuery = z.infer<typeof PredictionTimeseriesQuery>

export interface PredictionTimeseries {
  configured: boolean
  cropCycleId: string
  harvestYear: number
  /** False while the ESM has no timeseries for the crop (not modelled yet). */
  available: boolean
  timeseries: CropTimeseries | null
  nitrogenCurve: NitrogenCurvePoint[]
}

// --- Grassland ---------------------------------------------------------------------------------

export const GrasslandPredictionInput = z.object({
  fieldIds: z.array(id).min(1).max(200),
  /** Harvest year; default: the current year. */
  year: z.number().int().min(2000).max(2100).optional(),
  /** Known cuts; the regrowth starts at the latest. */
  lastHarvest: z.array(isoDate).max(30).nullable().optional(),
  /** Target dry-matter content at harvest, used for the fresh-matter yield. */
  targetDMC: z.number().min(0.001).max(1),
})
export type GrasslandPredictionInput = z.infer<typeof GrasslandPredictionInput>

export interface GrasslandTimeseries {
  keys: string[]
  DMC: number[]
  /** Fresh matter at the target dry-matter content. */
  yieldFM_targetDMC: number[]
  yieldFM: number[]
  yieldDM: number[]
  BBCH: number[]
  GDD: number[]
  CumulatedBiologicalDays: number[]
  DailyTemperatureUnit: number[]
  LeafAreaIndex: number[]
  nFK: number[]
}

/** Values on `date` (the farm's today): per hectare (t/ha) and for the area (t). */
export interface GrasslandToday {
  date: string
  lastHarvest: string[] | null
  targetDMC: number
  yieldFM_targetDMC: { total: number; perArea: number }
  yieldFM: { total: number; perArea: number }
  yieldDM: { total: number; perArea: number }
}

export interface GrasslandFieldPrediction {
  id: string
  year: number
  areaInHa: number
  today: GrasslandToday
  timeseries: GrasslandTimeseries
}

export interface GrasslandPredictions {
  configured: boolean
  /** Image tag of the grassland-api that answered. */
  serviceVersion: string | null
  total: {
    year: number
    areaInHa: number
    today: GrasslandToday
    timeseries: Pick<GrasslandTimeseries, 'keys' | 'yieldFM_targetDMC' | 'yieldFM' | 'yieldDM' | 'DMC'>
  } | null
  fields: GrasslandFieldPrediction[]
}

/** The grassland prediction of one crop, for its page. */
export interface CropGrasslandPrediction {
  configured: boolean
  /** Whether the crop is grassland (permanent grassland, field or clover grass). */
  applicable: boolean
  prediction: GrasslandFieldPrediction | null
}

// --- Disease risk (ISIP) -------------------------------------------------------------------------

export const DISEASE_KEYS = ['brownRust', 'dtr', 'fusarium', 'yellowRust', 'powderyMildew', 'netBlotch', 'ramularia', 'leafBlotch', 'septoriaTritici', 'leafRust'] as const
export type DiseaseKey = (typeof DISEASE_KEYS)[number]

export interface FieldDiseaseRisk {
  configured: boolean
  /** Whether ISIP models the crop (winter wheat, winter/spring barley, winter rye, triticale). */
  supported: boolean
  refreshedAt: string | null
  /** The crop's diseases with their level (0 none … 3 high) on the last 14 days with data. */
  diseases: { key: DiseaseKey; days: { date: string; value: 0 | 1 | 2 | 3 }[] }[]
}
