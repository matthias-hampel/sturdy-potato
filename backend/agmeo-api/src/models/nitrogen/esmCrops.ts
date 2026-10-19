/**
 * Ported from AGVOLUTION/agmeo src/lib/farmalyzer/esmCrops.ts: the crops the ESM models and the
 * ESM crop for every other crop.
 */

import type { SupportedCrops } from '../crops.js';

/**
 * Crop FQNs we may send to the ESM. Subset of the enum its `/esm/run` schema
 * documents (lvl0-models `fullstack/config.py: cropNameFromFqn`): `mustard`,
 * `oilRadish`, `persianClover` and `phacelia` are accepted by the schema but
 * have no rows in `global_yield_index`, and the pipeline queries that index by
 * crop before it models anything — so they fail just as hard as an unknown FQN.
 */
export const ESM_CROPS = [
  'alfalfaFodder',
  'broadBeans',
  'canola',
  'fieldGrassWiltedSilage',
  'floweringStrip',
  'grainMaize',
  'grassSeed',
  'hardWheat',
  'peasDry',
  'peasDryFodder',
  'permanentGrasslandWiltedSilage',
  'potatoTableLate',
  'silageMaize',
  'sorghumBiogas',
  'soybeanBeans',
  'springBarleyMalting',
  'springCanola',
  'springOatsFodder',
  'springWheatFodder',
  'sugarBeet',
  'sunflower',
  'triticaleFodder',
  'winterBarleyFodder',
  'winterBroadBeans',
  'winterRyeBaking',
  'winterWheat',
] as const;

export type EsmCrop = (typeof ESM_CROPS)[number];

/**
 * The crop the ESM simulates for a crop it does not know. Unmapped, the worker
 * throws on its crop lookup and every ESM feature — yield potential, base
 * zonation, water balance — produces nothing for the cultivation.
 *
 * Follows cropProxy wherever its target is an ESM crop, and the nearest ESM
 * crop by growth habit otherwise: spelt is not one, so the wheats proxying to it
 * land on winterWheat, and the catch crops land on the spring brassica or the
 * forage legume. Zone shape comes from terrain and satellite data and the crop
 * only scales it, the same reasoning that makes cropProxy acceptable for carbon.
 */
const ESM_CROP_PROXY = {
  cerealRyeIntercrop: 'winterRyeBaking',
  mustardIntercrop: 'springCanola',
  oilRadishIntercrop: 'springCanola',
  persianCloverIntercrop: 'alfalfaFodder',
  phaceliaIntercrop: 'springCanola',
  ryeWholePlantSilage: 'winterRyeBaking',
  lupine: 'broadBeans',
  spelt: 'winterWheat',
  landscapeFeature: 'floweringStrip',
  // No satellite model applies to a field whose crop we do not know.
  unknownCrop: 'floweringStrip',
  nonProductiveArea: 'floweringStrip',
  alfalfa: 'alfalfaFodder',
  winterOats: 'springOatsFodder',
  springRye: 'winterRyeBaking',
  springTriticale: 'triticaleFodder',
  springDurum: 'springWheatFodder',
  winterPeas: 'peasDry',
  potatoStarch: 'potatoTableLate',
  seedPotato: 'potatoTableLate',
  potatoTableEarly: 'potatoTableLate',
  cornCobMix: 'grainMaize',
  maizeBiogas: 'silageMaize',
  sorghum: 'sorghumBiogas',
  buckwheat: 'springOatsFodder',
  millet: 'grainMaize',
  lentils: 'peasDry',
  chickpeas: 'peasDry',
  linseed: 'springCanola',
  hemp: 'silageMaize',
  poppy: 'springCanola',
  fodderBeet: 'sugarBeet',
  vetch: 'peasDry',
  quinoa: 'springOatsFodder',
  emmer: 'winterWheat',
  einkorn: 'winterWheat',
  clover: 'alfalfaFodder',
  cloverGrass: 'fieldGrassWiltedSilage',
  alfalfaGrass: 'alfalfaFodder',
  intercropMixture: 'springCanola',
  blackOatIntercrop: 'springOatsFodder',
  vetchIntercrop: 'alfalfaFodder',
  crimsonCloverIntercrop: 'alfalfaFodder',
  alexandrineCloverIntercrop: 'alfalfaFodder',
  buckwheatIntercrop: 'springCanola',
  sunflowerIntercrop: 'sunflower',
  nigerIntercrop: 'springCanola',
  sorghumIntercrop: 'sorghumBiogas',
  linseedIntercrop: 'springCanola',
  camelinaIntercrop: 'springCanola',
  serradellaIntercrop: 'alfalfaFodder',
  ryegrassUndersow: 'fieldGrassWiltedSilage',
  cloverGrassUndersow: 'fieldGrassWiltedSilage',
  onion: 'sugarBeet',
  garlic: 'sugarBeet',
  leek: 'sugarBeet',
  carrot: 'sugarBeet',
  whiteCabbage: 'sugarBeet',
  redCabbage: 'sugarBeet',
  savoyCabbage: 'sugarBeet',
  cauliflower: 'sugarBeet',
  broccoli: 'sugarBeet',
  kale: 'sugarBeet',
  kohlrabi: 'sugarBeet',
  brusselsSprouts: 'sugarBeet',
  chineseCabbage: 'sugarBeet',
  lettuce: 'sugarBeet',
  lambsLettuce: 'sugarBeet',
  spinach: 'sugarBeet',
  beetroot: 'sugarBeet',
  celeriac: 'sugarBeet',
  fennel: 'sugarBeet',
  endive: 'sugarBeet',
  bushBeans: 'broadBeans',
  sweetCorn: 'grainMaize',
  pumpkin: 'sugarBeet',
  cucumber: 'sugarBeet',
  tomato: 'sugarBeet',
  bellPepper: 'sugarBeet',
  asparagus: 'alfalfaFodder',
  strawberry: 'alfalfaFodder',
  hops: 'alfalfaFodder',
  grapevine: 'alfalfaFodder',
  rhubarb: 'alfalfaFodder',
  pomeFruit: 'alfalfaFodder',
  stoneFruit: 'alfalfaFodder',
  rice: 'grainMaize',
  cowpeas: 'soybeanBeans',
  dryBeans: 'soybeanBeans',
  grainSorghum: 'grainMaize',
} as const satisfies Record<Exclude<SupportedCrops, EsmCrop>, EsmCrop>;

/**
 * The ESM crop for a reference crop key. The reference throws for a crop nobody mapped (it would
 * cost the field its zonation silently); here the caller gets null and answers "not modelled".
 */
export function esmCropFor(crop: string | null | undefined): EsmCrop | null {
  if (!crop) return null;
  const mapped = Object.hasOwn(ESM_CROP_PROXY, crop) ? ESM_CROP_PROXY[crop as keyof typeof ESM_CROP_PROXY] : crop;
  return (ESM_CROPS as readonly string[]).includes(mapped) ? (mapped as EsmCrop) : null;
}
