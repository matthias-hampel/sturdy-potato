/**
 * agmeo crop codes → the crop keys of the BEK calculator and of the Thünen RothC service
 * (AGVOLUTION/agmeo SupportedCrops). The only place where the two crop catalogues meet.
 */
import PARAMS from './bek/parameters.js';
import { cropsWithoutModelData, type SupportedCrops } from './bek/types.js';

const CARBON_CROP: Record<string, SupportedCrops> = {
  winter_wheat: 'winterWheat',
  spring_wheat: 'springWheatFodder',
  winter_barley: 'winterBarleyFodder',
  spring_barley: 'springBarleyMalting',
  winter_rye: 'winterRyeBaking',
  triticale: 'triticaleFodder',
  oats: 'springOatsFodder',
  winter_oats: 'winterOats',
  winter_spelt: 'spelt',
  winter_rapeseed: 'canola',
  spring_rapeseed: 'springCanola',
  sunflower: 'sunflower',
  grain_maize: 'grainMaize',
  silage_maize: 'silageMaize',
  sugar_beet: 'sugarBeet',
  potatoes: 'potatoTableLate',
  field_beans: 'broadBeans',
  peas: 'peasDry',
  soybeans: 'soybeanBeans',
  lupins: 'lupine',
  grassland: 'permanentGrasslandWiltedSilage',
  field_grass: 'fieldGrassWiltedSilage',
  clover_grass: 'cloverGrass',
  alfalfa: 'alfalfa',
  fallow: 'nonProductiveArea',
  cover_crop: 'intercropMixture',
  cc_mustard: 'mustardIntercrop',
  cc_phacelia: 'phaceliaIntercrop',
  cc_oil_radish: 'oilRadishIntercrop',
  // The reference has no legume mixture with model data; Persian clover is its legume catch crop.
  cc_legume_mix: 'persianCloverIntercrop',
  cc_winter_rye: 'cerealRyeIntercrop',
};

/** The calculator's crop for an agmeo crop code, or null when there is none (organization crops). */
export function carbonCrop(
  code: string | null | undefined,
): SupportedCrops | null {
  return (code && CARBON_CROP[code]) || null;
}

/** Whether the calculator has parameters for the crop; without them crop terms (seed, residues, humus) are left out. */
export function hasModelData(
  crop: SupportedCrops | null,
): crop is SupportedCrops {
  return crop != null && !cropsWithoutModelData.includes(crop);
}

/** Dry-matter content of the harvested product (0–1), or null without model data. */
export function dryMatterContent(crop: SupportedCrops | null): number | null {
  return hasModelData(crop) ? PARAMS.crop[crop].dryMatterContent : null;
}

/** The agmeo crop codes that have a carbon crop; used by the tests to keep the table complete. */
export const MAPPED_CROP_CODES = Object.keys(CARBON_CROP);
