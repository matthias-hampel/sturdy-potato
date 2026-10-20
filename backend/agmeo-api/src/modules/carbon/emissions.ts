/**
 * agmeo operations and crop cycles → inputs of the BEK calculator.
 *
 * The reference (AGVOLUTION/agmeo src/lib/co2calculator/src/extractor.ts) runs the calculator once
 * per transaction: the operation's action (diesel) and every product. Here an operation line is
 * one treated field with its crop; its products are applied at the operation's rate per hectare.
 * What the reference books on the cultivation — the crop's humus effect, harvest residues with the
 * nutrients they leave for the next crop, and 10 % of last year's organic N — is computed per crop
 * cycle in `cycleEmissionsPerHa`.
 */
import {
  type BaseUnit,
  type BekEmissions,
  type BekSource,
  type FertilizerType,
  isOrganicFertilizer,
  MIN_N_EFFICIENCY_PCT,
  massKg,
  nutrientKgPerHa,
  type OperationType,
} from '@agmeo/contracts';
import { calculator } from './bek/calculator.js';
import { emptyCo2eInput } from './bek/empty.js';
import {
  humusBalanceMainOrCoverCrop,
  humusBalanceOrganicFertilizer,
} from './bek/humus.js';
import PARAMS from './bek/parameters.js';
import {
  calculateK2OforNextCrop,
  calculateNforNextCrop,
  calculateP2O5forNextCrop,
} from './bek/residues.js';
import type {
  Co2eCalculationExplanation,
  Co2eInput,
  Co2eReport,
  IncorporationTime,
  OrganicFertilizerCategory,
  SupportedCrops,
} from './bek/types.js';
import { hasModelData } from './crops.js';

export interface CarbonProduct {
  name: string;
  category: string;
  baseUnit: BaseUnit;
  fertilizerType: FertilizerType | null;
  nPct?: number | null;
  nh4NPct?: number | null;
  p2o5Pct?: number | null;
  k2oPct?: number | null;
  caoPct?: number | null;
  densityTM3?: number | null;
  humusCKgPerT?: number | null;
  nEffectivenessPct?: number | null;
  dryMatterPct?: number | null;
  /** Mineral fertilizer category of the calculator in place of the one of the fertilizer type (what-if measures). */
  bekCategory?: string;
}

export interface CarbonInputLine {
  product: CarbonProduct;
  /** In the product's base unit per hectare. */
  ratePerHa: number;
}

export interface OperationCarbonInput {
  type: OperationType | string;
  /** Diesel not recorded as a fuel product: the operation's l/ha or machine hours × consumption. */
  dieselLPerHa: number;
  incorporationHours?: number | null;
  inputs: CarbonInputLine[];
}

export interface CarbonResult {
  /** kg CO2e per hectare by source. */
  byId: BekEmissions;
  details: Co2eCalculationExplanation[];
}

/** Crop the calculator runs with when the line's crop has no model data: all crop parameters are 0. */
const NEUTRAL_CROP: SupportedCrops = 'nonProductiveArea';

/** agmeo fertilizer types → the reference's mineral fertilizer categories (NH3 losses, supply factors). */
const MINERAL_CATEGORY: Record<string, string> = {
  can: 'CAN_AND_OTHERS_N',
  urea: 'UREA',
  urea_inhibitor: 'UREA_W_INHIBITOR',
  uan: 'AHL',
  np: 'NP',
  npk: 'NPK',
  pk: 'no_n',
  other_mineral: 'others',
};

/** agmeo organic fertilizer types → the reference's categories (NH3 emission factors by incorporation). */
export const ORGANIC_CATEGORY: Record<string, OrganicFertilizerCategory> = {
  cattle_slurry: 'cattleSlurry',
  pig_slurry: 'pigSlurry',
  cattle_liquid_manure: 'cattleLiquidManure',
  pig_liquid_manure: 'pigLiquidManure',
  cattle_solid_manure: 'cattleSolidManure',
  pig_solid_manure: 'pigSolidManure',
  horse_sheep_manure: 'horseManure',
  poultry_manure: 'turkeySolidManure',
  laying_hen_dry_manure: 'chickenSolidManure',
  digestate_liquid: 'digestateLiquid',
  digestate_solid: 'unknown',
  compost: 'unknown',
  sewage_sludge: 'unknown',
  other_organic: 'unknown',
};

/** Hours until incorporation → the reference's classes (Thünen RMD tables 5.6–5.8). */
export function incorporationTime(
  hours: number | null | undefined,
): IncorporationTime {
  if (hours == null) return 'noIncorporation';
  if (hours <= 1) return '1h';
  if (hours <= 4) return '4h';
  if (hours <= 12) return '8h';
  return 'noIncorporation';
}

/** Fuel products are diesel unless their name says HVO or biodiesel. */
export function fuelKind(name: string): 'diesel' | 'biodiesel' | 'hvo100' {
  const n = name.toLowerCase();
  if (n.includes('hvo')) return 'hvo100';
  if (/bio-?diesel|\brme\b|\bb100\b/.test(n)) return 'biodiesel';
  return 'diesel';
}

const DIESEL_T_M3 = 0.835;

function litres(line: CarbonInputLine): number {
  const { baseUnit } = line.product;
  if (baseUnit === 'l') return line.ratePerHa;
  if (baseUnit === 'm3') return line.ratePerHa * 1000;
  const density = line.product.densityTM3 ?? DIESEL_T_M3;
  if (baseUnit === 'kg') return line.ratePerHa / density;
  if (baseUnit === 't') return (line.ratePerHa * 1000) / density;
  return 0;
}

function emptyInput(crop: SupportedCrops): Co2eInput {
  const input = structuredClone(emptyCo2eInput);
  input.fieldData.crop = crop;
  return input;
}

function add(target: BekEmissions, report: Co2eReport) {
  for (const [k, v] of Object.entries(report.byId) as [BekSource, number][]) {
    if (v) target[k] = (target[k] ?? 0) + v;
  }
}

/** Seed in kg/ha: kg and t directly, sales units (e.g. maize units) with the crop's kg per unit. */
function seedKgPerHa(line: CarbonInputLine, crop: SupportedCrops): number {
  const { baseUnit } = line.product;
  if (baseUnit === 'kg') return line.ratePerHa;
  if (baseUnit === 't') return line.ratePerHa * 1000;
  if (baseUnit === 'unit')
    return line.ratePerHa * (PARAMS.crop[crop]?.piecesToKg ?? 0);
  return 0;
}

/**
 * kg CO2e/ha of one operation on a field with the given crop. The crop matters for seed (per-crop
 * supply factor); a crop without model data gets every crop-independent source, but no seed term.
 */
export function operationEmissionsPerHa(
  op: OperationCarbonInput,
  crop: SupportedCrops | null,
  year?: number,
): CarbonResult {
  const modelCrop = hasModelData(crop) ? crop : NEUTRAL_CROP;
  const byId: BekEmissions = {};
  const details: Co2eCalculationExplanation[] = [];
  const run = (input: Co2eInput) => {
    const report = calculator(input, undefined, year);
    add(byId, report);
    details.push(...report.details);
  };

  // The action: diesel burnt and the machinery it stands for.
  const fuel = { diesel: op.dieselLPerHa, biodiesel: 0, hvo100: 0 };
  for (const line of op.inputs) {
    if (line.product.category === 'fuel')
      fuel[fuelKind(line.product.name)] += litres(line);
  }
  if (fuel.diesel || fuel.biodiesel || fuel.hvo100) {
    const input = emptyInput(modelCrop);
    input.fieldData.diesel = fuel.diesel;
    input.fieldData.biodiesel = fuel.biodiesel;
    input.fieldData.HVO100 = fuel.hvo100;
    run(input);
  }

  for (const line of op.inputs) {
    const p = line.product;
    if (!(line.ratePerHa > 0)) continue;
    if (p.category === 'crop_protection') {
      const input = emptyInput(modelCrop);
      // The intensity does not matter: kg or l of product per hectare.
      input.fieldData.pesticidesQuantity =
        p.baseUnit === 't' || p.baseUnit === 'm3'
          ? line.ratePerHa * 1000
          : p.baseUnit === 'unit'
            ? 0
            : line.ratePerHa;
      run(input);
    } else if (p.category === 'seed') {
      if (!hasModelData(crop)) continue;
      const input = emptyInput(crop);
      input.fieldData.supplySeed = seedKgPerHa(line, crop);
      run(input);
    } else if (p.category === 'fertilizer') {
      const nutrients = nutrientKgPerHa(p, line.ratePerHa, p.baseUnit);
      if (isOrganicFertilizer(p.fertilizerType)) {
        const { kg } = massKg(line.ratePerHa, p.baseUnit, p);
        if (!kg) continue;
        const t = kg / 1000;
        const input = emptyInput(modelCrop);
        const n = nutrients.n ?? 0;
        input.fieldOrganicFertilizerData[0]['1'] = {
          organicFertilizerType:
            ORGANIC_CATEGORY[p.fertilizerType!] ?? 'unknown',
          organicTechnology: 'broadcast',
          incorporationTime: incorporationTime(op.incorporationHours),
          // Contents per tonne of fresh mass and tonnes per hectare (the reference uses m³ and kg/m³).
          quantityFarmManure: t,
          nFromOrganic: n / t,
          p2o5Organic: (nutrients.p2o5 ?? 0) / t,
          k2oOrganic: (nutrients.k2o ?? 0) / t,
          nh3NProportion:
            n > 0 && nutrients.nh4N != null ? (nutrients.nh4N / n) * 100 : 0,
          nEffectiveness:
            p.nEffectivenessPct ?? MIN_N_EFFICIENCY_PCT[p.fertilizerType!] ?? 0,
        };
        run(input);
        if (p.humusCKgPerT) {
          const humus = emptyInput(modelCrop);
          humus.fieldData.humusBalance = humusBalanceOrganicFertilizer(
            p.name,
            p.humusCKgPerT,
            t,
          ).value;
          run(humus);
        }
      } else {
        const category =
          p.bekCategory ??
          ((p.fertilizerType && MINERAL_CATEGORY[p.fertilizerType]) ||
            'others');
        const n = nutrients.n ?? 0;
        const input = emptyInput(modelCrop);
        input.fieldMineralFertilizerData[0]['1'] = {
          fertilizerMineralType: category,
          appliedUreaNHectare: category.includes('UREA') ? n : 0,
          appliedUanNHectare: category === 'AHL' ? n : 0,
          appliedOthersMineralNHectare:
            !category.includes('UREA') && category !== 'AHL' ? n : 0,
          // Acidifying fertilizers have a negative lime value; only lime actually applied releases CO2.
          limeYearlyAverage: Math.max(nutrients.cao ?? 0, 0),
          p2o5Mineral: nutrients.p2o5 ?? 0,
          k2oMineral: nutrients.k2o ?? 0,
        };
        run(input);
      }
    }
  }
  return { byId: round(byId), details };
}

export interface CycleCarbonInput {
  crop: SupportedCrops | null;
  /** Harvested fresh mass in t/ha (actual, else expected); null when unknown. */
  yieldTHa: number | null;
  /** Straw and other by-products taken off the field. */
  strawRemoved: boolean;
  /** Total organic N applied on the field in the previous season, kg/ha (10 % count this year). */
  nLastYearKgHa: number;
  /** A catch crop sown after the main crop (its humus effect). */
  catchCrop?: SupportedCrops | null;
}

/**
 * kg CO2e/ha booked on the crop cycle itself: the crop's humus effect (pf9/pf10), N2O from crop
 * residues (pf5a/pf5b), the residues' humus and nutrient credits (pn1a, pn2a–c), and the share of
 * last year's organic N (pf6, pb2a). Crops without model data get only the last-year N terms.
 */
export function cycleEmissionsPerHa(
  c: CycleCarbonInput,
  year?: number,
): CarbonResult {
  const byId: BekEmissions = {};
  const details: Co2eCalculationExplanation[] = [];
  const run = (input: Co2eInput) => {
    const report = calculator(input, undefined, year);
    add(byId, report);
    details.push(...report.details);
  };
  const modelCrop = hasModelData(c.crop) ? c.crop : NEUTRAL_CROP;

  if (c.nLastYearKgHa > 0) {
    const input = emptyInput(modelCrop);
    input.fieldData.nLastYear = c.nLastYearKgHa;
    run(input);
  }
  if (!hasModelData(c.crop)) return { byId: round(byId), details };
  const crop = c.crop;
  const params = PARAMS.crop[crop];

  // Humus effect of the crop (the reference books it on the harvest operation).
  const humus = emptyInput(crop);
  humus.fieldData.humusBalance = humusBalanceMainOrCoverCrop(crop, 1, 0).value;
  run(humus);
  if (hasModelData(c.catchCrop ?? null)) {
    const catchHumus = emptyInput(c.catchCrop!);
    catchHumus.fieldData.humusBalance = humusBalanceMainOrCoverCrop(
      c.catchCrop!,
      1,
      0,
    ).value;
    run(catchHumus);
  }

  // Harvest residues, as the reference's HARVESTING product (silage maize leaves nothing behind).
  if (c.yieldTHa && c.yieldTHa > 0 && crop !== 'silageMaize') {
    const input = emptyInput(crop);
    const byproductRemoved = c.strawRemoved ? 1 : 0;
    input.fieldData.byproductRemoved = byproductRemoved;
    input.fieldData.dryMassYield = c.yieldTHa * (params.dryMatterContent || 0);
    input.fieldData.byProductWet = c.yieldTHa * (params.MPBR || 0);
    input.fieldData.nForNextCrop = calculateNforNextCrop(
      input.fieldData.byProductWet,
      crop,
      byproductRemoved,
    );
    input.fieldData.p2o5ForNextCrop = calculateP2O5forNextCrop(
      input.fieldData.byProductWet,
      crop,
      byproductRemoved,
    );
    input.fieldData.k2oForNextCrop = calculateK2OforNextCrop(
      input.fieldData.byProductWet,
      crop,
      byproductRemoved,
    );
    run(input);
  }
  return { byId: round(byId), details };
}

function round(e: BekEmissions): BekEmissions {
  const out: BekEmissions = {};
  for (const [k, v] of Object.entries(e) as [BekSource, number][]) {
    const r = Math.round(v * 1000) / 1000;
    if (r) out[k] = r;
  }
  return out;
}

/** Scales per-hectare emissions to an area. */
export function scale(e: BekEmissions, areaHa: number): BekEmissions {
  const out: BekEmissions = {};
  for (const [k, v] of Object.entries(e) as [BekSource, number][])
    out[k] = v * areaHa;
  return out;
}

export function sumEmissions(e: BekEmissions): number {
  return Object.values(e).reduce((a, b) => a + (b ?? 0), 0);
}
