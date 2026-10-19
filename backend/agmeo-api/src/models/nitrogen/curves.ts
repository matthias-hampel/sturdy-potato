/**
 * Ported from AGVOLUTION/agmeo src/lib/farmalyzer/nCropYieldCurveParams.ts: the crop N demand
 * over yield curves (x = yield in t/ha, y = crop N demand in kg N/ha):
 * linear: y = slope * x + intercept
 * logarithmic: y = slope * log(x) + intercept
 * polynomial: y = poly_coef * x^2 + slope * x + intercept
 *
 * A crop without an entry has no nitrogen model yet: the app must say so instead of guessing,
 * so never fall back to a related crop's curve here.
 */

import type { SupportedCrops } from '../crops.js';

type CurveRelation = 'linear' | 'logarithmic' | 'polynomial';

export type CurveParams = {
  relation: CurveRelation;
  slope: number;
  intercept: number;
  poly_coef?: number;
};

export const nCropYieldCurveParams: Partial<Record<SupportedCrops, CurveParams>> = {
  alfalfa: {
    relation: 'linear',
    slope: 0,
    intercept: 0,
  },
  broadBeans: {
    relation: 'linear',
    slope: 0,
    intercept: 0,
  },
  canola: {
    relation: 'linear',
    slope: 39.011,
    intercept: 6.4052,
  },
  fieldGrassWiltedSilage: {
    relation: 'logarithmic',
    slope: 30.362,
    intercept: 70.26,
  },
  grainMaize: {
    relation: 'linear',
    slope: 19.111,
    intercept: 16.848,
  },
  grassSeed: {
    relation: 'linear',
    slope: 30.362,
    intercept: 70.26,
  },
  peasDry: {
    relation: 'linear',
    slope: 0,
    intercept: 0,
  },
  peasDryFodder: {
    relation: 'linear',
    slope: 0,
    intercept: 0,
  },
  permanentGrasslandWiltedSilage: {
    relation: 'logarithmic',
    slope: 30.362,
    intercept: 70.26,
  },
  potatoTableLate: {
    relation: 'linear',
    slope: 4.1508,
    intercept: 35.718,
  },
  silageMaize: {
    relation: 'logarithmic',
    slope: 30.362,
    intercept: 70.26,
  },
  springBarleyMalting: {
    relation: 'linear',
    slope: 15.032,
    intercept: 14.033,
  },
  springOatsFodder: {
    relation: 'linear',
    slope: 18.243,
    intercept: 10.8,
  },
  springWheatFodder: {
    relation: 'linear',
    slope: 18.243,
    intercept: 10.8,
  },
  sugarBeet: {
    relation: 'linear',
    slope: 1.89,
    intercept: 5.4,
  },
  sunflower: {
    relation: 'linear',
    slope: 33.362,
    intercept: 0.9729,
  },
  triticaleFodder: {
    relation: 'linear',
    slope: 15.034,
    intercept: 2.554,
  },
  winterBarleyFodder: {
    relation: 'linear',
    slope: 15.032,
    intercept: 14.033,
  },
  winterRyeBaking: {
    relation: 'linear',
    slope: 15.076,
    intercept: 0.9,
  },
  winterWheat: {
    relation: 'linear',
    slope: 23.0,
    intercept: 0.2193,
  },
  hardWheat: {
    relation: 'linear',
    slope: 23.0,
    intercept: 0.2193,
  },
  soybeanBeans: {
    relation: 'linear',
    slope: 0,
    intercept: 0,
  },
  cerealRyeIntercrop: {
    relation: 'linear',
    slope: 0,
    intercept: 0,
  },
  mustardIntercrop: {
    relation: 'linear',
    slope: 0,
    intercept: 0,
  },
  persianCloverIntercrop: {
    relation: 'linear',
    slope: 0,
    intercept: 0,
  },
  phaceliaIntercrop: {
    relation: 'linear',
    slope: 0,
    intercept: 0,
  },
  oilRadishIntercrop: {
    relation: 'linear',
    slope: 0,
    intercept: 0,
  },
  ryeWholePlantSilage: {
    relation: 'linear',
    slope: 0,
    intercept: 0,
  },
  lupine: {
    relation: 'linear',
    slope: 0,
    intercept: 0,
  },
  spelt: {
    relation: 'linear',
    slope: 18.243,
    intercept: 10.8,
  },
  landscapeFeature: {
    relation: 'linear',
    slope: 0,
    intercept: 0,
  },
  nonProductiveArea: {
    relation: 'linear',
    slope: 0,
    intercept: 0,
  },
};

export const hasNitrogenModel = (crop: SupportedCrops) => nCropYieldCurveParams[crop] !== undefined;
