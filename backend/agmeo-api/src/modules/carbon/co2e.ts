/**
 * Greenhouse-gas emissions of field operations in kg CO2e, after the BEK-style calculator of
 * AGVOLUTION/agmeo (src/lib/co2calculator, factors with sources in method/parametersSources.ts).
 * Simplified: no crop residues, humus balance or scope 2. NH3 losses of organic fertilizers use
 * default shares of ammonium N by application technique instead of Thünen's full model.
 */
import { type ApplicationTechnique, type BaseUnit, type FertilizerType, isOrganicFertilizer, nutrientKgPerHa, type NutrientContents } from '@agmeo/contracts';

export const CO2E_FACTOR_SET = 'DE-BEK-simplified-2026.1';

const GWP_N2O = 273;
const N2O_N_TO_N2O = 44 / 28;
/** Direct N2O-N per kg N applied (agmeo ef.n2oN). */
const EF_N2O_DIRECT = 0.01225;
/** N2O-N per kg NH3-N volatilized and redeposited. */
const EF_N2O_INDIRECT = 0.01;
const n2o = (kgN2oN: number) => kgN2oN * N2O_N_TO_N2O * GWP_N2O;

/** Combustion per litre of diesel, and machine manufacture and maintenance per litre burnt. */
export const DIESEL_KG_PER_L = 3.013;
export const MACHINERY_KG_PER_L_DIESEL = 0.885;

/** NH3-N lost per kg N of mineral fertilizers. */
const NH3_MINERAL: Partial<Record<FertilizerType, number>> = { urea: 0.128, urea_inhibitor: 0.038, uan: 0.081, np: 0.041 };
const NH3_MINERAL_DEFAULT = 0.01;
/** Share of ammonium N lost as NH3 from liquid organic fertilizers by technique, not incorporated. */
const NH3_LIQUID: Record<ApplicationTechnique, number> = { broadcast: 0.4, trailing_hose: 0.3, trailing_shoe: 0.2, injection: 0.05, other: 0.4 };
const NH3_SOLID = 0.6;
const LIQUID_ORGANIC: FertilizerType[] = ['cattle_slurry', 'pig_slurry', 'cattle_liquid_manure', 'pig_liquid_manure', 'digestate_liquid'];

/** Upstream emissions of fertilizer production per kg nutrient. */
const SUPPLY_N: Partial<Record<FertilizerType, number>> = { urea: 3.502, urea_inhibitor: 3.502, uan: 3.397 };
const SUPPLY_N_DEFAULT = 3.52;
const SUPPLY_P2O5 = 0.542;
const SUPPLY_K2O = 0.416;
const SUPPLY_CAO = 0.021;
/** CO2 from lime (per kg CaO) and from urea hydrolysis (per kg urea N). */
const LIME_CO2_PER_CAO = 0.786;
const UREA_CO2_PER_N = 1.57;
/** Share of urea N in UAN. */
const UAN_UREA_SHARE = 0.5;
/** Plant protection: kg active ingredient per kg (or l) product and kg CO2e per kg active ingredient. */
const PESTICIDE_AI_SHARE = 0.35;
const PESTICIDE_KG_PER_AI = 11.09;
/** Seed production, kg CO2e per kg seed (generic; agmeo has per-crop values). */
const SEED_KG_PER_KG = 0.5;

export const EMISSION_SOURCES = [
  'diesel',
  'machinery',
  'n2o_direct',
  'n2o_indirect',
  'fertilizer_supply',
  'lime_urea_co2',
  'plant_protection',
  'seed',
] as const;
export type EmissionSource = (typeof EMISSION_SOURCES)[number];

export interface EmissionInput {
  category: string;
  baseUnit: BaseUnit;
  /** Across all treated fields, in the base unit. */
  totalQuantity: number;
  product: NutrientContents & { fertilizerType: FertilizerType | null };
}

/** kg CO2e per source of one operation, for the operation as a whole. */
export function operationEmissions(op: { inputs: EmissionInput[]; dieselL: number; technique?: ApplicationTechnique | null; incorporationHours?: number | null }): Partial<Record<EmissionSource, number>> {
  const out: Partial<Record<EmissionSource, number>> = {};
  const add = (k: EmissionSource, v: number) => {
    if (v) out[k] = (out[k] ?? 0) + v;
  };
  add('diesel', op.dieselL * DIESEL_KG_PER_L);
  add('machinery', op.dieselL * MACHINERY_KG_PER_L_DIESEL);
  for (const i of op.inputs) {
    if (i.category === 'fuel' && (i.baseUnit === 'l' || i.baseUnit === 'm3')) continue; // counted as diesel
    if (i.category === 'crop_protection') {
      add('plant_protection', (i.baseUnit === 't' || i.baseUnit === 'm3' ? i.totalQuantity * 1000 : i.totalQuantity) * PESTICIDE_AI_SHARE * PESTICIDE_KG_PER_AI);
      continue;
    }
    if (i.category === 'seed') {
      if (i.baseUnit === 'kg' || i.baseUnit === 't') add('seed', (i.baseUnit === 't' ? i.totalQuantity * 1000 : i.totalQuantity) * SEED_KG_PER_KG);
      continue;
    }
    if (i.category !== 'fertilizer') continue;
    // Nutrients of the whole quantity: the per-hectare function with "1 ha".
    const n = nutrientKgPerHa(i.product, i.totalQuantity, i.baseUnit);
    const type = i.product.fertilizerType;
    const organic = isOrganicFertilizer(type);
    const totalN = n.n ?? 0;
    add('n2o_direct', n2o(totalN * EF_N2O_DIRECT));
    if (organic) {
      const liquid = type != null && LIQUID_ORGANIC.includes(type);
      let share = liquid ? NH3_LIQUID[op.technique ?? 'broadcast'] : NH3_SOLID;
      // Quick incorporation on bare land roughly halves the losses.
      if (op.incorporationHours != null && op.incorporationHours <= 4 && op.technique !== 'injection') share /= 2;
      add('n2o_indirect', n2o((n.nh4N ?? totalN * 0.5) * share * EF_N2O_INDIRECT));
    } else {
      add('n2o_indirect', n2o(totalN * (type ? (NH3_MINERAL[type] ?? NH3_MINERAL_DEFAULT) : NH3_MINERAL_DEFAULT) * EF_N2O_INDIRECT));
      add('fertilizer_supply', totalN * (type ? (SUPPLY_N[type] ?? SUPPLY_N_DEFAULT) : SUPPLY_N_DEFAULT) + (n.p2o5 ?? 0) * SUPPLY_P2O5 + (n.k2o ?? 0) * SUPPLY_K2O + Math.max(n.cao ?? 0, 0) * SUPPLY_CAO);
      const ureaN = type === 'urea' || type === 'urea_inhibitor' ? totalN : type === 'uan' ? totalN * UAN_UREA_SHARE : 0;
      add('lime_urea_co2', Math.max(n.cao ?? 0, 0) * LIME_CO2_PER_CAO + ureaN * UREA_CO2_PER_N);
    }
  }
  for (const k of Object.keys(out) as EmissionSource[]) out[k] = Math.round(out[k]! * 1000) / 1000;
  return out;
}
