/**
 * Ported from AGVOLUTION/agmeo src/lib/farmalyzer/nitrogen.ts (the N model of the zone
 * optimisation: crop N demand over yield, residual N per crop, the zone N balance of
 * `nitrogenCalculator`) and src/app/app/[orgId]/fields/[year]/[fieldId]/[cultivationId]/utils.tsx
 * (`generateChartData`: N uptake and N supply by BBCH from the ESM timeseries).
 *
 * The reference's calculator reads the zone yield and the applied N from its transactions; here
 * the caller passes them, so the functions stay pure.
 */

import type { SupportedCrops } from '../crops.js';
import { nCropYieldCurveParams, type CurveParams } from './curves.js';

/** Defaults of the N terms the ESM does not model (reference `defaults`). */
export const N_DEFAULTS = {
  nMinInKgNpHa_model: 30,
  nMinSpringInKgNpHa_model: 45,
  nLossInKgNpHa_model: 25,
  nResidualInKgNpHa_model: 20,
};

const nResidualByCrop: Partial<Record<SupportedCrops, number>> = {
  winterWheat: 25,
  hardWheat: 25,
  canola: 30,
  winterBarleyFodder: 20,
  winterRyeBaking: 20,
  triticaleFodder: 22,
  springBarleyMalting: 18,
  springOatsFodder: 18,
  silageMaize: 10,
  grainMaize: 30,
  sugarBeet: 15,
  potatoTableLate: 10,
  sunflower: 20,
  spelt: 25,
  fieldGrassWiltedSilage: 20,
  permanentGrasslandWiltedSilage: 20,
  ryeWholePlantSilage: 10,
  grassSeed: 20,
  alfalfa: 0,
  broadBeans: 0,
  peasDry: 0,
  peasDryFodder: 0,
  soybeanBeans: 0,
  lupine: 0,
};

/** Mineral N left after harvest, kg N/ha. */
export const getDefaultNResidual = (crop: SupportedCrops): number => nResidualByCrop[crop] ?? N_DEFAULTS.nResidualInKgNpHa_model;

const relations: Record<CurveParams['relation'], (x: number, p: CurveParams) => number> = {
  linear: (x, p) => p.slope * x + p.intercept,
  logarithmic: (x, p) => p.slope * Math.log(x) + p.intercept,
  polynomial: (x, p) => (p.poly_coef ?? 0) * x * x + p.slope * x + p.intercept,
};

const relationsInverse: Record<CurveParams['relation'], (y: number, p: CurveParams) => number> = {
  linear: (y, p) => (y - p.intercept) / p.slope,
  logarithmic: (y, p) => Math.exp((y - p.intercept) / p.slope),
  polynomial: (y, p) => {
    const a = p.poly_coef ?? 0;
    const b = p.slope;
    const c = p.intercept;
    return (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a);
  },
};

/** Crop N demand (kg N/ha) at a yield (t/ha); null for crops without a curve. */
export function nCropInKgNpHa(yieldInTpHa: number, crop: SupportedCrops): number | null {
  const p = nCropYieldCurveParams[crop];
  return p ? relations[p.relation](yieldInTpHa, p) : null;
}

/** Yield (t/ha) whose crop N demand is `nCrop`; null for crops without a curve. */
export function nCropInKgNpHaInverse(nCrop: number, crop: SupportedCrops): number | null {
  const p = nCropYieldCurveParams[crop];
  return p ? relationsInverse[p.relation](nCrop, p) : null;
}

export interface ZoneNitrogenInput {
  crop: SupportedCrops;
  yieldTHa: number;
  nMin: number;
  nMinSpring: number;
  nLoss: number;
  nResidual: number;
  /** N applied in the season, kg N/ha. */
  nFert?: number;
}

export interface ZoneNitrogen {
  /** Crop N demand at the yield. */
  nCrop: number;
  /** N to fertilise: crop N − Nmin − mineralisation + loss + residual. */
  nDemand: number;
  nFert: number;
  /** nDemand − nFert: positive = still to apply. */
  nBalance: number;
}

/** The reference's `nitrogenCalculator` on plain values; null for crops without a curve. */
export function zoneNitrogen(input: ZoneNitrogenInput): ZoneNitrogen | null {
  const nCrop = nCropInKgNpHa(input.yieldTHa, input.crop);
  if (nCrop === null) return null;
  const nDemand = nCrop - input.nMin - input.nMinSpring + input.nLoss + input.nResidual;
  const nFert = input.nFert ?? 0;
  return { nCrop, nDemand, nFert, nBalance: nDemand - nFert };
}

/**
 * N uptake (CNUP) and N supply (CNMIN, only counted between BBCH 20 and 83, held otherwise) by
 * BBCH, the supply offset so that it starts at zero — the reference's `generateChartData`.
 */
export function nitrogenCurve(ts: { keys: string[]; BBCH: number[]; CNUP: number[]; CNMIN: number[] }): { bbch: number; uptake: number; supply: number }[] {
  if (!ts.keys?.length) return [];
  const points: { bbch: number; uptake: number; supply: number }[] = [];
  ts.keys.forEach((_, i) => {
    const bbch = ts.BBCH[i] || 0;
    const cnmin = ts.CNMIN[i] || 0;
    const supply = bbch >= 20 && bbch <= 83 ? cnmin : points[i - 1]?.supply || 0;
    points.push({ bbch, uptake: ts.CNUP[i] || 0, supply });
  });
  const positive = points.map((p) => p.supply).filter((v) => v > 0);
  const offset = positive.length ? Math.min(...positive) : 0;
  return points.map((p) => ({ ...p, supply: Math.max(p.supply - offset, 0) }));
}
