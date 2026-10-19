/**
 * KTBL action costs per hectare: exact grid values (V2) when a crop or crop group is given, the
 * CROSS formula approximation (V1) otherwise. The grid data (data/ktbl/actionCostsDataGrouped.json,
 * 9.6 MB) is read on first use and cached.
 *
 * Ported from agmeo `src/lib/ktbl/index.ts`. Changes: `estimateKtbl` also takes a crop group
 * directly (the rewrite derives it from a crop's code or category, see `crops.ts`) and reports
 * which estimator produced the values; `estimateActionCosts` keeps the reference signature.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { KtblCropGroup } from '@agmeo/contracts';
import { type ActionCosts, type Options, type ReferenceCrop, estimateActionCosts as estimateV1 } from './action-cost-estimator.js';
import { type CostsData, createV2Estimator } from './action-cost-estimator-v2.js';

export const CROP_GROUP: Partial<Record<ReferenceCrop, KtblCropGroup>> = {
  winterWheat: 'cereals',
  hardWheat: 'cereals',
  winterBarleyFodder: 'cereals',
  springBarleyMalting: 'cereals',
  springOatsFodder: 'cereals',
  winterRyeBaking: 'cereals',
  ryeWholePlantSilage: 'cereals',
  triticaleFodder: 'cereals',
  silageMaize: 'maize',
  grainMaize: 'maize',
  sugarBeet: 'roots',
  potatoTableLate: 'roots',
  canola: 'oilseeds',
  sunflower: 'oilseeds',
  peasDry: 'legumes',
  peasDryFodder: 'legumes',
  soybeanBeans: 'legumes',
  broadBeans: 'legumes',
  fieldGrassWiltedSilage: 'grasses',
  permanentGrasslandWiltedSilage: 'grasses',
  grassSeed: 'grasses',
  cerealRyeIntercrop: 'intercrops',
  mustardIntercrop: 'intercrops',
  oilRadishIntercrop: 'intercrops',
  persianCloverIntercrop: 'intercrops',
  phaceliaIntercrop: 'intercrops',
};

const dataFile = fileURLToPath(new URL('../../../data/ktbl/actionCostsDataGrouped.json', import.meta.url));

// FQNs with no KTBL data → use closest available variant
export const FQN_ALIAS: Record<string, string> = {
  PLANTING__CRPF24_1000: 'PLANTING__CRPF24_1500',
  PLANTING__CRPF36_1000: 'PLANTING__CRPF36_1500',
};

// FQNs where V2→V1 fallback (when V2 hours=0) breaks monotonicity
const SKIP_V1_FALLBACK = new Set(['LOADING_FERTILIZER__WLS_1000', 'INSTALLING__HRI_2000', 'INSTALLING__HRI_3000', 'INSTALLING__HRI_4000']);

let v2: ReturnType<typeof createV2Estimator> | null = null;
let v2Loaded = false;

function getV2() {
  if (v2Loaded) return v2;
  v2Loaded = true;
  try {
    v2 = createV2Estimator(JSON.parse(readFileSync(dataFile, 'utf-8')) as CostsData);
  } catch {
    // V2 data unavailable — V1 fallback
  }
  return v2;
}

/** `grid`: KTBL table values of the crop group (V2); `formula`: CROSS formula approximation (V1). */
export type EstimateMethod = 'grid' | 'formula';

/**
 * Like `estimateActionCosts`, with the crop group given directly (`group`, else the reference
 * crop's group) and the estimator that produced the values.
 */
export function estimateKtbl(fqn: string, options: Options & { group?: KtblCropGroup } = {}): { costs: ActionCosts; method: EstimateMethod } {
  const { group: groupOption, ...v1Options } = options;
  const f = FQN_ALIAS[fqn] ?? fqn;
  const v2Est = getV2();
  const isLoadingFertWithAmount = f.startsWith('LOADING_FERTILIZER') && options.productAmountKgHa != null;
  if (v2Est && (options.crop || groupOption) && !isLoadingFertWithAmount && !options.soilType) {
    const group = groupOption ?? (options.crop ? CROP_GROUP[options.crop] : undefined);
    const result = v2Est(f, { ...v1Options, crop: group });
    if (result?.hours) return { costs: result, method: 'grid' };
    if (result && SKIP_V1_FALLBACK.has(f)) return { costs: result, method: 'grid' };
    if (result) return { costs: estimateV1(f, { ...v1Options, crop: undefined }) ?? { ...ZERO_COSTS }, method: 'formula' };
  }
  return { costs: estimateV1(f, v1Options) ?? { ...ZERO_COSTS }, method: 'formula' };
}

/**
 * Estimate KTBL operation costs. Uses exact grid lookup (V2) when crop is provided,
 * falls back to CROSS formula approximation (V1) otherwise.
 * Data is read once from actionCostsDataGrouped.json and cached for subsequent calls.
 */
export function estimateActionCosts(fqn: string, options: Options = {}): ActionCosts {
  return estimateKtbl(fqn, options).costs;
}

const ZERO_COSTS: ActionCosts = {
  hours: 0,
  diesel: 0,
  depreciation: 0,
  interest: 0,
  miscellaneous: 0,
  repairs: 0,
  materials: 0,
  services: 0,
};
