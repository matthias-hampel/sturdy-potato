import { z } from 'zod';
import { amount, id, isoDate, longText, shortText } from './common.js';
import type { CropRole } from './crops.js';
import type { FertilizerType } from './inventory.js';
import type { NutrientRates } from './nutrients.js';

// ---------------------------------------------------------------------------
// Soil
// ---------------------------------------------------------------------------

/** Soil texture classes (Bodenarten) of the LUFA / VDLUFA tables, light to heavy. */
export const SOIL_TEXTURES = ['S', 'lS', 'sU', 'ssL', 'lU', 'sL', 'uL', 'L', 'utL', 'tL', 'T'] as const;
export type SoilTexture = (typeof SOIL_TEXTURES)[number];

export const SOIL_TEXTURE_LABELS: Record<SoilTexture, string> = {
  S: 'Sand',
  lS: 'Loamy sand',
  sU: 'Sandy silt',
  ssL: 'Very sandy loam',
  lU: 'Loamy silt',
  sL: 'Sandy loam',
  uL: 'Silty loam',
  L: 'Loam',
  utL: 'Silty clay loam',
  tL: 'Clay loam',
  T: 'Clay',
};

/** Soil class of the fertilization tables: LUFA soil groups 1–2 light, 3–4 medium, 5 heavy. */
export type SoilClass = 'light' | 'medium' | 'heavy';
export const soilClassOf = (texture: SoilTexture | null | undefined): SoilClass =>
  texture == null ? 'medium' : ['S', 'lS', 'sU'].includes(texture) ? 'light' : ['utL', 'tL', 'T'].includes(texture) ? 'heavy' : 'medium';

export const PH_METHODS = ['cacl2', 'h2o', 'kcl'] as const;
export type PhMethod = (typeof PH_METHODS)[number];

/** VDLUFA content classes (Gehaltsklassen): A very low … E very high. C is the target. */
export type ContentClass = 'A' | 'B' | 'C' | 'D' | 'E';

const nonNeg = (max: number) => z.number().finite().min(0).max(max).nullish();

export const SoilSampleInput = z
  .object({
    fieldId: id,
    fieldPartId: id.nullish(),
    kind: z.enum(['basic', 'nmin']),
    sampledOn: isoDate,
    lab: shortText,
    sampleNumber: shortText,
    depthCm: z.int().min(1).max(200).nullish(),
    ph: z.number().min(2).max(11).nullish(),
    phMethod: z.enum(PH_METHODS).nullish(),
    p2o5Mg100g: nonNeg(1000),
    pMethod: z.enum(['cal', 'dl']).nullish(),
    k2oMg100g: nonNeg(1000),
    mgoMg100g: nonNeg(1000),
    humusPct: nonNeg(100),
    soilTexture: z.enum(SOIL_TEXTURES).nullish(),
    nmin0to30: nonNeg(1000),
    nmin30to60: nonNeg(1000),
    nmin60to90: nonNeg(1000),
    notes: longText,
  })
  .refine((s) => s.kind !== 'nmin' || s.nmin0to30 != null || s.nmin30to60 != null || s.nmin60to90 != null, {
    message: 'Enter at least one Nmin layer',
    path: ['nmin0to30'],
  });
export type SoilSampleInput = z.input<typeof SoilSampleInput>;

export interface SoilSample {
  id: string;
  fieldId: string;
  fieldName: string;
  fieldPartId: string | null;
  fieldPartName: string | null;
  kind: 'basic' | 'nmin';
  sampledOn: string;
  lab: string | null;
  sampleNumber: string | null;
  depthCm: number | null;
  ph: number | null;
  phMethod: PhMethod | null;
  p2o5Mg100g: number | null;
  pMethod: 'cal' | 'dl' | null;
  k2oMg100g: number | null;
  mgoMg100g: number | null;
  humusPct: number | null;
  soilTexture: SoilTexture | null;
  nmin0to30: number | null;
  nmin30to60: number | null;
  nmin60to90: number | null;
  /** Sum of the Nmin layers, kg N/ha. */
  nminTotal: number | null;
  /** Content classes of the basic analysis, for the field's soil class. */
  classes: { ph: ContentClass | null; p: ContentClass | null; k: ContentClass | null; mg: ContentClass | null };
  notes: string | null;
  /** Written by a lab import (mean of the field's sampling zones). */
  labImportId: string | null;
}

export interface FieldSoilSummary {
  fieldId: string;
  fieldName: string;
  areaHa: number;
  soilTexture: SoilTexture | null;
  nitrateSensitiveZone: boolean;
  phosphateSensitiveZone: boolean;
  latestBasic: SoilSample | null;
  latestNmin: SoilSample | null;
  /** The latest basic analysis is older than six years (DüV §3 Abs. 4) or missing. */
  basicOutdated: boolean;
}

export const FieldSiteInput = z.object({
  soilTexture: z.enum(SOIL_TEXTURES).nullish(),
  nitrateSensitiveZone: z.boolean().optional(),
  phosphateSensitiveZone: z.boolean().optional(),
});
export type FieldSiteInput = z.input<typeof FieldSiteInput>;

// ---------------------------------------------------------------------------
// Fertilizer need (Düngebedarfsermittlung, DüV §4 and Anlage 4)
// ---------------------------------------------------------------------------

/** Where an input value of the calculation came from. */
export type NeedSource = 'sample' | 'reference' | 'entered' | 'derived' | 'default';

/** Values the user may set for one calculation; anything left out is derived from the records. */
export const FertilizerNeedOverrides = z.object({
  expectedYieldTHa: amount.max(500).nullish(),
  nmin: amount.max(500).nullish(),
  /** Nmin taken from a state reference value (its id), when there is no own sample. */
  nminReferenceId: id.nullish(),
  humusPct: amount.max(100).nullish(),
  soilTexture: z.enum(SOIL_TEXTURES).nullish(),
  previousCropId: id.nullish(),
  catchCropId: id.nullish(),
  /** kg N/ha applied with organic fertilizers in the previous year (total N). */
  organicNPreviousYear: amount.max(1000).nullish(),
  filmOrFleece: z.boolean().nullish(),
  proteinPct: z.number().min(0).max(60).nullish(),
  nitrateSensitiveZone: z.boolean().nullish(),
  strawRemoved: z.boolean().nullish(),
  note: longText,
});
export type FertilizerNeedOverrides = z.input<typeof FertilizerNeedOverrides>;

export interface NNeedResult {
  /** DüV Anlage 4 crop the calculation used, e.g. "Winterweizen A/B". */
  duevCrop: string;
  yieldUnit: string;
  referenceYield: number;
  nRequirement: number;
  /** Expected yield in the DüV unit (dt/ha, dt FM/ha or dt DM/ha). */
  expectedYield: number;
  yieldCorrection: number;
  nmin: number;
  humusDeduction: number;
  organicPreviousYearDeduction: number;
  previousCropDeduction: number;
  catchCropDeduction: number;
  filmSurcharge: number;
  needBeforeZone: number;
  zoneReduction: number;
  /** N fertilizer need, kg N/ha. */
  need: number;
}

export interface PkNeedResult {
  nutrient: 'p2o5' | 'k2o' | 'mgo';
  removal: number;
  contentClass: ContentClass | null;
  /** null without a soil value for the nutrient. */
  factor: number | null;
  /** kg/ha; null without a soil value for the nutrient (no recommendation, as in the reference). */
  need: number | null;
}

export interface FertilizerNeedInputs {
  cropName: string;
  role: CropRole;
  areaHa: number;
  expectedYieldTHa: { value: number | null; source: NeedSource };
  soilTexture: { value: SoilTexture | null; source: NeedSource };
  humusPct: { value: number | null; source: NeedSource };
  nmin: { value: number | null; source: NeedSource; sampledOn?: string | null; referenceId?: string | null };
  previousCrop: { id: string | null; name: string | null; source: NeedSource };
  catchCrop: { id: string | null; name: string | null; legume: boolean; winterHardy: boolean; source: NeedSource };
  organicNPreviousYear: { value: number; source: NeedSource };
  filmOrFleece: boolean;
  proteinPct: number | null;
  nitrateSensitiveZone: boolean;
  strawRemoved: boolean;
  soilSample: { id: string; sampledOn: string; p2o5Mg100g: number | null; k2oMg100g: number | null; mgoMg100g: number | null; ph: number | null; phMethod: PhMethod | null } | null;
}

export interface FertilizerNeed {
  cropCycleId: string;
  fieldId: string;
  fieldName: string;
  ruleset: string;
  inputs: FertilizerNeedInputs;
  /** Null when the crop has no DüV Anlage 4 values (it is then planned without a calculated N need). */
  n: NNeedResult | null;
  pk: PkNeedResult[];
  /** Lime requirement in dt CaO/ha over three years; null without a pH value. */
  limeDtCaO: number | null;
  /** Things that make the result less reliable or not usable as DüV documentation. */
  warnings: { code: string; message: string }[];
  /** The last saved record, if any. */
  lastRecord: { id: string; createdAt: string; createdBy: string | null; n: number | null } | null;
}

export interface FertilizerNeedRecord {
  id: string;
  cropCycleId: string;
  kind: 'n' | 'pk';
  ruleset: string;
  inputs: FertilizerNeedInputs;
  result: { n: NNeedResult | null; pk: PkNeedResult[]; limeDtCaO: number | null };
  note: string | null;
  createdAt: string;
  createdBy: string | null;
}

export interface NminReferenceValue {
  id: string;
  state: string;
  region: string | null;
  crop: string;
  previousCrop: string | null;
  soil: string | null;
  n0to30: number | null;
  n30to60: number | null;
  n60to90: number | null;
  total: number;
  depth: string;
  year: number;
  source: string;
}

// ---------------------------------------------------------------------------
// Nutrient balance of a season
// ---------------------------------------------------------------------------

/**
 * Minimum N efficiency of organic fertilizers in the year of application, in % of total N
 * (DüV Anlage 3). Mineral fertilizers count with 100 %.
 */
export const MIN_N_EFFICIENCY_PCT: Partial<Record<FertilizerType, number>> = {
  cattle_slurry: 60,
  pig_slurry: 70,
  cattle_liquid_manure: 90,
  pig_liquid_manure: 90,
  cattle_solid_manure: 25,
  horse_sheep_manure: 25,
  pig_solid_manure: 30,
  poultry_manure: 30,
  laying_hen_dry_manure: 60,
  digestate_liquid: 60,
  digestate_solid: 30,
  compost: 5,
  sewage_sludge: 25,
};

/**
 * Plant-available N of an application: total N for mineral fertilizers; for organic ones the
 * higher of NH4-N and total N × the minimum efficiency (DüV §3 Abs. 5 and Anlage 3).
 */
export function availableN(type: FertilizerType | null | undefined, n: number | null, nh4N: number | null, organic: boolean): number | null {
  if (n == null) return null;
  if (!organic) return n;
  const pct = (type && MIN_N_EFFICIENCY_PCT[type]) ?? 0;
  return Math.round(Math.max(nh4N ?? 0, (n * pct) / 100) * 10) / 10;
}

export interface CycleNutrientBalance {
  cropCycleId: string;
  fieldId: string;
  fieldName: string;
  fieldPartName: string | null;
  areaHa: number;
  cropName: string;
  cropColor: string;
  nitrateSensitiveZone: boolean;
  /** Calculated N need (saved record, else current calculation); null if the crop has no DüV values. */
  nNeed: number | null;
  nNeedRecorded: boolean;
  p2o5Need: number | null;
  k2oNeed: number | null;
  /** Completed applications, kg/ha. */
  applied: NutrientRates & { availableN: number | null; organicN: number | null };
  /** Planned (not yet completed) applications, kg/ha. */
  planned: NutrientRates & { availableN: number | null };
  /** Need minus available N applied and planned; negative means above the need. */
  nRemaining: number | null;
  /** Applications inside a closed period (Sperrfrist). */
  closedPeriodViolations: number;
}

export interface SeasonNutrientBalance {
  seasonId: string;
  ruleset: string;
  rows: CycleNutrientBalance[];
}

// ---------------------------------------------------------------------------
// Variable-rate suggestions
// ---------------------------------------------------------------------------

export const SuggestRatesInput = z
  .object({
    zoningId: id,
    mode: z.enum(['nitrogen', 'seeding', 'scale']),
    /** Standard rate per ha in the unit of the map input (scale and nitrogen modes). */
    standardRate: amount.max(10_000_000).nullish(),
    /** Nitrogen mode: crop cycle whose N need is distributed, and the fertilizer's N content. */
    cropCycleId: id.nullish(),
    nPct: z.number().positive().max(100).nullish(),
    /** Share of the season's N need given in this pass (0–1). */
    passShare: z.number().positive().max(1).default(1),
    /** More on less productive zones instead of more on productive ones. */
    inverse: z.boolean().default(false),
    /** Seeding mode: target plants per m², germination and thousand-grain weight. */
    plantsPerM2: z.number().positive().max(2000).nullish(),
    germinationPct: z.number().positive().max(100).nullish(),
    thousandGrainWeightG: z.number().positive().max(2000).nullish(),
    strategy: z.enum(['yield_potential', 'risk_mitigation']).default('yield_potential'),
    /** How strongly rates follow the zones, in % of the standard rate per unit of relative productivity. */
    variationPct: z.number().min(0).max(100).default(20),
    minRate: amount.nullish(),
    maxRate: amount.nullish(),
  })
  .refine((s) => s.mode !== 'nitrogen' || (s.cropCycleId && s.nPct), { message: 'Choose the crop and the fertilizer N content', path: ['cropCycleId'] })
  .refine((s) => s.mode !== 'seeding' || s.plantsPerM2, { message: 'Enter the target plants per m²', path: ['plantsPerM2'] })
  .refine((s) => s.mode !== 'scale' || s.standardRate != null, { message: 'Enter a standard rate', path: ['standardRate'] });
export type SuggestRatesInput = z.input<typeof SuggestRatesInput>;

export interface SuggestedRates {
  /** Rate per ha by zone number. */
  rates: Record<string, number>;
  unit: 'kg/ha' | 'seeds/ha';
  /** Area-weighted mean rate. */
  meanRate: number;
  explanation: string;
}
