import { z } from 'zod';
import type { BaseUnit, FertilizerType } from './inventory.js';
import { isOrganicFertilizer } from './inventory.js';

/** Nutrient contents of a product in % of fresh mass (ADR-010). */
export interface NutrientContents {
  nPct?: number | null;
  nh4NPct?: number | null;
  p2o5Pct?: number | null;
  k2oPct?: number | null;
  mgoPct?: number | null;
  sPct?: number | null;
  caoPct?: number | null;
  densityTM3?: number | null;
  fertilizerType?: FertilizerType | null;
}

/** kg of each nutrient per hectare; null where the product has no value for it. */
export interface NutrientRates {
  n: number | null;
  nh4N: number | null;
  p2o5: number | null;
  k2o: number | null;
  mgo: number | null;
  s: number | null;
  cao: number | null;
}

export const NUTRIENT_KEYS = ['n', 'nh4N', 'p2o5', 'k2o', 'mgo', 's', 'cao'] as const;

/**
 * Density used for organic fertilizers measured by volume when none is recorded. Slurries and
 * liquid digestates are close to 1 t/m³; the assumption is reported so it can be corrected.
 */
export const ASSUMED_ORGANIC_DENSITY = 1;

/** Fresh mass in kg of a quantity in the product's base unit, or null when it cannot be converted. */
export function massKg(quantity: number, unit: BaseUnit, product: Pick<NutrientContents, 'densityTM3' | 'fertilizerType'>): { kg: number | null; densityAssumed: boolean } {
  if (unit === 'kg') return { kg: quantity, densityAssumed: false };
  if (unit === 't') return { kg: quantity * 1000, densityAssumed: false };
  if (unit === 'l' || unit === 'm3') {
    let density = product.densityTM3 ?? null;
    let densityAssumed = false;
    if (density == null && isOrganicFertilizer(product.fertilizerType)) {
      density = ASSUMED_ORGANIC_DENSITY;
      densityAssumed = true;
    }
    if (density == null) return { kg: null, densityAssumed: false };
    // t/m³ is kg/l.
    return { kg: unit === 'l' ? quantity * density : quantity * density * 1000, densityAssumed };
  }
  return { kg: null, densityAssumed: false };
}

/** kg nutrients per hectare applied with `ratePerHa` of a product (in its base unit). */
export function nutrientKgPerHa(product: NutrientContents, ratePerHa: number, unit: BaseUnit): NutrientRates & { densityAssumed: boolean } {
  const { kg, densityAssumed } = massKg(ratePerHa, unit, product);
  const part = (pct: number | null | undefined) => (kg == null || pct == null ? null : Math.round(kg * pct) / 100);
  return {
    n: part(product.nPct),
    nh4N: part(product.nh4NPct),
    p2o5: part(product.p2o5Pct),
    k2o: part(product.k2oPct),
    mgo: part(product.mgoPct),
    s: part(product.sPct),
    cao: part(product.caoPct),
    densityAssumed,
  };
}

/** Sums nutrient rates; a nutrient is null only when no line has a value for it. */
export function sumNutrients(lines: NutrientRates[]): NutrientRates {
  const out: NutrientRates = { n: null, nh4N: null, p2o5: null, k2o: null, mgo: null, s: null, cao: null };
  for (const l of lines) {
    for (const k of NUTRIENT_KEYS) {
      if (l[k] != null) out[k] = Math.round(((out[k] ?? 0) + l[k]!) * 100) / 100;
    }
  }
  return out;
}

/** Contents entered as kg per tonne or kg per m³ of fresh mass, as % of fresh mass. */
export function contentToPct(value: number, unit: 'pct' | 'kg_t' | 'kg_m3', densityTM3?: number | null): number | null {
  if (unit === 'pct') return value;
  if (unit === 'kg_t') return value / 10;
  return densityTM3 ? value / densityTM3 / 10 : null;
}

// ---------------------------------------------------------------------------
// Seed rates
// ---------------------------------------------------------------------------

/** Default germination rate (%) when the seed lot has none. */
export const DEFAULT_GERMINATION_PCT = 94;

/** Grains per m² needed for a target plant count, given the germination rate. */
export const grainsForPlants = (plantsPerM2: number, germinationPct = DEFAULT_GERMINATION_PCT) => (plantsPerM2 * 100) / germinationPct;

/** kg/ha of seed for grains per m² and a thousand-grain weight in grams. */
export const seedKgPerHa = (grainsPerM2: number, thousandGrainWeightG: number) => (grainsPerM2 * thousandGrainWeightG) / 100;

/** Grains per m² from kg/ha of seed and a thousand-grain weight in grams. */
export const grainsPerM2 = (kgPerHa: number, thousandGrainWeightG: number) => (kgPerHa * 100) / thousandGrainWeightG;

// ---------------------------------------------------------------------------
// agmeo N model and fertilization strategies (reference nitrogen page)
// ---------------------------------------------------------------------------

/** A value of the agmeo N balance: the farmer's, the ESM model's, or the soil-class estimate. */
export interface NBalanceValue {
  value: number;
  source: 'user' | 'model' | 'estimate';
  /** The soil-class estimate, shown as placeholder. */
  estimate: number;
}

/** The agmeo N balance of one main crop (reference nitrogen table, N supply and N loss panels). */
export interface CycleNitrogen {
  cropCycleId: string;
  fieldId: string;
  /** Expected yield the demand is computed from (t/ha). */
  yieldTHa: number | null;
  soilTexture: string | null;
  humusPct: number | null;
  /** N uptake of the crop at the yield (agmeo yield-N curve), kg N/ha; null without curve or yield. */
  nDemand: number | null;
  nMin: NBalanceValue;
  nMinSpring: NBalanceValue;
  nLeaching: NBalanceValue;
  nResidual: NBalanceValue;
  /** DüV §4 deductions for previous management, kg N/ha. */
  deductions: { previousCrop: number; organicPreviousYear: number; humus: number; catchCrop: number; total: number };
  previousCropName: string | null;
  catchCropName: string | null;
  organicNPreviousYear: number;
  /** Nmin + spring mineralisation + deductions. */
  nSupply: number;
  /** Leaching and gaseous losses + target Nmin after harvest. */
  nLoss: number;
  /** agmeo N need: demand − supply + losses; null without demand. */
  nDifference: number | null;
  /** DüV N need after the red-area reduction; null when the crop has no DüV values. */
  duevNeed: number | null;
  /** kg N/ha of all fertilization operations that are not canceled (planned and done). */
  totalN: number;
  strategyId: string | null;
}

const nValue = z.number().min(0).max(1000).nullable().optional();
/** The farmer's values of the agmeo N balance; null resets to model or estimate. */
export const NPlanningInput = z.object({ nMin: nValue, nMinSpring: nValue, nLeaching: nValue, nResidual: nValue });
export type NPlanningInput = z.input<typeof NPlanningInput>;

export interface FertilizationStrategy {
  id: string;
  name: string;
  /** Public strategies are offered to every organization and carry no products. */
  public: boolean;
  splitPercentages: number[];
  products: ({ id: string; name: string } | null)[];
}

export const FertilizationStrategyInput = z
  .object({
    name: z.string().trim().min(1).max(120),
    splitPercentages: z.array(z.int().min(1).max(100)).min(1).max(3),
    productIds: z.array(z.uuid()).min(1).max(3),
  })
  .refine((s) => s.splitPercentages.reduce((a, b) => a + b, 0) === 100, { message: 'The split must add up to 100 %', path: ['splitPercentages'] })
  .refine((s) => s.productIds.length === s.splitPercentages.length, { message: 'Every dose needs a fertilizer', path: ['productIds'] });
export type FertilizationStrategyInput = z.input<typeof FertilizationStrategyInput>;

export const ApplyStrategyInput = z.object({
  cropCycleIds: z.array(z.uuid()).min(1).max(500),
  /** Fertilizer per dose; required for public strategies, overrides an own strategy's. */
  productIds: z.array(z.uuid()).min(1).max(3).optional(),
});
export type ApplyStrategyInput = z.input<typeof ApplyStrategyInput>;

export interface ApplyStrategyResult {
  created: number;
  updated: number;
  canceled: number;
  skipped: { cropCycleId: string; reason: 'no_need' | 'no_farm' }[];
}

// ---------------------------------------------------------------------------
// Base fertilization per crop (reference base-fertilization page)
// ---------------------------------------------------------------------------

export interface BaseNutrientRow {
  nutrient: 'p2o5' | 'k2o' | 'mgo';
  /** Soil content in mg/100 g of the latest basic analysis. */
  soilMg100g: number | null;
  contentClass: 'A' | 'B' | 'C' | 'D' | 'E' | null;
  factor: number | null;
  removal: number;
  /** kg/ha; null without a soil value. */
  need: number | null;
  /** kg/ha of fertilizations done or running. */
  delivered: number;
  /** kg/ha of planned fertilizations. */
  planned: number;
  /** need − delivered (positive: still to apply). */
  balance: number | null;
}

/** DüV §6 P2O5 balance of a field over six harvest years (supply of documented fertilization against removal). */
export interface P2o5Balance {
  fromYear: number;
  toYear: number;
  years: { year: number; supply: number; removal: number | null }[];
  supply: number;
  removal: number;
  /** supply ÷ removal in %; null without removal. */
  ratioPct: number | null;
  /** At most 120 % of the removal. */
  compliant: boolean;
  yearsWithYield: number;
}

export interface CycleBaseFertilization {
  cropCycleId: string;
  fieldId: string;
  soil: { sampledOn: string | null; ph: number | null; phMethod: 'cacl2' | 'h2o' | 'kcl' | null; humusPct: number | null; texture: string | null };
  /** Documented yield, else the expected one (t/ha). */
  yieldTHa: number | null;
  yieldSource: 'harvest' | 'expected' | null;
  strawRemoved: boolean;
  hasStraw: boolean;
  /** dt CaO/ha over three years, from pH, soil class and humus. */
  limeComputedDtCaO: number | null;
  limeOverrideDtCaO: number | null;
  nutrients: BaseNutrientRow[];
  /** kg CaO/ha of fertilizations done or running, and planned. */
  caoDelivered: number;
  caoPlanned: number;
  p2o5Balance: P2o5Balance;
}

export const BaseFertilizationSettingsInput = z.object({
  strawRemoved: z.boolean().optional(),
  limeRequirementDtCaO: z.number().min(0).max(500).nullable().optional(),
});
export type BaseFertilizationSettingsInput = z.input<typeof BaseFertilizationSettingsInput>;
