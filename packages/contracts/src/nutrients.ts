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
