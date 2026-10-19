/**
 * The rewrite's crops seen through the reference's KTBL lens: the reference crop key (its
 * `SupportedCrops`), the KTBL crop group the grid values are averaged over, and the sowing and
 * harvest categories the reference matches against an action's `appliesTo`
 * (`getAvailableActionCategoriesForCrop` in agmeo `src/lib/articles/utils.ts`).
 */
import type { CropCategory, KtblCropGroup } from '@agmeo/contracts';
import type { ReferenceCrop } from './action-cost-estimator.js';
import { CROP_GROUP } from './estimate.js';

type Sowing = 'SMALL_GRAINS' | 'ROW_CROPS';
type Harvest = 'HARVEST_GRAIN' | 'HARVEST_WHOLE' | 'ROOT_ARABLES';

/**
 * Crop codes of the rewrite's catalogue → reference crop, with the reference crop's sowing and
 * harvest category where it differs from the category default below (agmeo `src/lib/farmalyzer/crop.ts`).
 */
const BY_CODE: Record<string, { ref?: ReferenceCrop; sowing?: Sowing; harvest?: Harvest }> = {
  winter_wheat: { ref: 'winterWheat' },
  spring_wheat: {},
  winter_barley: { ref: 'winterBarleyFodder' },
  spring_barley: { ref: 'springBarleyMalting' },
  winter_rye: { ref: 'winterRyeBaking' },
  triticale: { ref: 'triticaleFodder' },
  oats: { ref: 'springOatsFodder' },
  winter_spelt: { ref: 'spelt' },
  winter_rapeseed: { ref: 'canola' },
  sunflower: { ref: 'sunflower', sowing: 'ROW_CROPS' },
  grain_maize: { ref: 'grainMaize' },
  silage_maize: { ref: 'silageMaize', harvest: 'HARVEST_WHOLE' },
  sugar_beet: { ref: 'sugarBeet' },
  potatoes: { ref: 'potatoTableLate' },
  field_beans: { ref: 'broadBeans' },
  peas: { ref: 'peasDry' },
  soybeans: { ref: 'soybeanBeans' },
  lupins: { ref: 'lupine' },
  alfalfa: { ref: 'alfalfa', sowing: 'SMALL_GRAINS', harvest: 'HARVEST_WHOLE' },
  grassland: { ref: 'permanentGrasslandWiltedSilage' },
  field_grass: { ref: 'fieldGrassWiltedSilage' },
  clover_grass: { ref: 'fieldGrassWiltedSilage' },
  cc_mustard: { ref: 'mustardIntercrop' },
  cc_oil_radish: { ref: 'oilRadishIntercrop' },
  cc_phacelia: { ref: 'phaceliaIntercrop' },
  cc_winter_rye: { ref: 'cerealRyeIntercrop' },
  cc_legume_mix: { ref: 'persianCloverIntercrop' },
};

/** Defaults per crop category (also for an organization's own crops). */
const BY_CATEGORY: Record<CropCategory, { group: KtblCropGroup | null; sowing: Sowing | null; harvest: Harvest | null }> = {
  cereal: { group: 'cereals', sowing: 'SMALL_GRAINS', harvest: 'HARVEST_GRAIN' },
  oilseed: { group: 'oilseeds', sowing: 'SMALL_GRAINS', harvest: 'HARVEST_GRAIN' },
  legume: { group: 'legumes', sowing: 'ROW_CROPS', harvest: 'HARVEST_GRAIN' },
  maize: { group: 'maize', sowing: 'ROW_CROPS', harvest: 'HARVEST_GRAIN' },
  root: { group: 'roots', sowing: 'ROW_CROPS', harvest: 'ROOT_ARABLES' },
  grassland: { group: 'grasses', sowing: 'SMALL_GRAINS', harvest: 'HARVEST_WHOLE' },
  cover: { group: 'intercrops', sowing: 'SMALL_GRAINS', harvest: 'HARVEST_WHOLE' },
  vegetable: { group: null, sowing: 'ROW_CROPS', harvest: 'HARVEST_WHOLE' },
  other: { group: null, sowing: null, harvest: null },
};

export interface KtblCropProfile {
  ref: ReferenceCrop | null;
  /**
   * The reference crop's group; else the crop category's. The reference leaves crops outside its
   * group table (spelt, lupine, alfalfa, own crops) without a group and so without grid values;
   * here they take their category's group.
   */
  group: KtblCropGroup | null;
  /** `appliesTo` values of the actions offered for the crop. */
  appliesTo: Set<string>;
}

export function cropProfile(code: string, category: CropCategory): KtblCropProfile {
  const byCode = BY_CODE[code] ?? {};
  const byCategory = BY_CATEGORY[category] ?? BY_CATEGORY.other;
  const appliesTo = new Set(['ALL', 'ARABLES']);
  for (const v of [byCode.sowing ?? byCategory.sowing, byCode.harvest ?? byCategory.harvest]) if (v) appliesTo.add(v);
  // The reference has no crop with grassland or vegetable categories; here grassland crops get the grassland actions.
  if (category === 'grassland') appliesTo.add('GRASSLAND');
  if (category === 'vegetable') appliesTo.add('VEGETABLES');
  return {
    ref: byCode.ref ?? null,
    group: (byCode.ref && CROP_GROUP[byCode.ref]) || byCategory.group,
    appliesTo,
  };
}
