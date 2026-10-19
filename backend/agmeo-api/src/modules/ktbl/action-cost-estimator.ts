/**
 * KTBL action costs, V1: the CROSS formula `a + b·dist + c/fs + d·dist/fs` per cost column, with
 * parameters fitted from the KTBL grid data (data/ktbl/cross_params.json, loaded on first use).
 *
 * Ported from agmeo `src/lib/ktbl/actionCostEstimator.ts`. Changes: the parameters are read lazily
 * from the data directory instead of a static JSON import, and crops are the reference's crop keys
 * (`ReferenceCrop`), which the rewrite's crop codes are mapped onto in `crops.ts`.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

type CostName = 'hours' | 'diesel' | 'depreciation' | 'interest' | 'miscellaneous' | 'repairs' | 'materials' | 'services';

export type ActionCosts = Record<CostName, number>;

export type SoilType = 'LS' | 'MS' | 'HS';

export const CROP_TO_KTBL = {
  winterWheat: 'WINTER_WHEAT_BAKING_QUALITY',
  hardWheat: 'WINTER_WHEAT_BAKING_QUALITY',
  silageMaize: 'MAIZE_SILO_MAIZE',
  grainMaize: 'MAIZE_GRAIN',
  canola: 'CANOLA_FOR_OIL',
  sugarBeet: 'SUGAR_BEET',
  winterBarleyFodder: 'WINTER_BARLEY_FODDER',
  springBarleyMalting: 'SUMMER_BARLEY_MALTING',
  springOatsFodder: 'SUMMER_OATS_FODDER',
  winterRyeBaking: 'WINTER_RYE_BAKING_QUALITY',
  ryeWholePlantSilage: 'WINTER_RYE_WHOLE_PLANT_SILAGE_FOR_BIOGAS',
  potatoTableLate: 'POTATO_TABLE_LATE',
  peasDry: 'PEAS_DRY',
  peasDryFodder: 'SUMMER_PEAS_GRAIN',
  triticaleFodder: 'WINTER_TRITICALE_FODDER',
  sunflower: 'SUNFLOWER',
  grassSeed: 'GRASS_SEED',
  soybeanBeans: 'SOYBEANS_GRAIN',
  fieldGrassWiltedSilage: 'FIELD_GRASS_WILTED_SILAGE',
  permanentGrasslandWiltedSilage: 'PERMANENT_GRASSLAND_GRASS_WILTED_SILAGE',
  cerealRyeIntercrop: 'MUSTARD_INTERCROP', // no own KTBL data; proxied via mustard intercrop like its templates
  mustardIntercrop: 'MUSTARD_INTERCROP',
  oilRadishIntercrop: 'OIL_RADISH_INTERCROP',
  persianCloverIntercrop: 'PERSIAN_CLOVER_INTERCROP',
  phaceliaIntercrop: 'PHACELIA_INTERCROP',
  broadBeans: 'BROAD_BEANS',
  lupine: 'LUPINE',
  spelt: 'SPELT',
  alfalfa: 'ALFALFA',
} as const;

/** Crop keys of the reference (its `SupportedCrops`) that have a KTBL crop. */
export type ReferenceCrop = keyof typeof CROP_TO_KTBL;

export type Options = {
  fieldSizeHa?: number;
  distanceKm?: number;
  mechKw?: number;
  productAmountKgHa?: number;
  crop?: ReferenceCrop;
  soilType?: SoilType;
};

export const MECH_LEVELS = [45, 67, 83, 102, 120, 200, 230];
const DEFAULT_FS_HA = 10;
const DEFAULT_DIST_KM = 5;
const DEFAULT_MECH_KW = 120;

const TIER1_PREFIXES = new Set([
  'PLOWING',
  'HARROWING',
  'SOWING',
  'PLANTING',
  'LOADING_LIME',
  'LOADING_SEEDS',
  'TRANSPORTING_SEEDS',
  'DEEP_STUBBLE_MANAGEMENT',
  'SHALLOW_STUBBLE_MANAGEMENT',
  'STORAGE_PREPARATION',
  'DIRECT_SOWING',
  'TEDDING',
  'RESEEDING_GRASSLAND',
  'CUTTING_BIOMASS',
  'FOLIAGE_KILLING',
  'STORING_POTATOES',
]);
const TIER2_PREFIXES = new Set([
  'DEEP_CULTIVATION',
  'SHALLOW_CULTIVATION',
  'SEEDBED_PREPARATION',
  'SPRAYING',
  'LOADING_FERTILIZER',
  'HEALTH_MONITORING',
  'LIME_SPREADING',
  'SOIL_SAMPLING',
  'NITROGEN_SOIL_SAMPLING_30CM',
  'BALING_AND_WRAPPING',
  'RAKING',
  'CUTTING_WITH_CONDITIONING',
  'OVERSEEDING',
  'SOWING_COVER_CROP',
  'HARROWING_GRASSLAND',
  'MANUELL_WEED_MANAGEMENT',
  'TRANSPORT_OF_PLANTING_MATERIAL',
  'PLANTING_IN_SEPERATED_BED',
  'HILLING_PREEMERGE',
]);

// FQNs whose prefix-based tier is wrong (formula too poor → tier 3, or formula good → non-tier-3)
const FORCE_TIER3 = new Set(['SHALLOW_CULTIVATION__STH80_1000', 'SPRAYING__PST27_1000', 'SOWING__SRH45_1000']);
const FORCE_NON_TIER3 = new Set([
  'HARVESTING__CH75_1000',
  'HARVESTING__SBL6_1000',
  'HARVESTING__HR24_3000',
  'HARVESTING__HP',
  'HARVESTING__CHCH8_1000',
  'DELIVERYc_CLEANING_AND_STORING__RS_2000',
  'DRYING__FE_1000',
  'DRYING__CA_2000',
  'STORAGE__RS_2000',
  'STORAGE__WHV_3000',
  'REMOVING_FROM_STORAGE__RS_2000',
  'REMOVING_FROM_STORAGE__FLWS_3000',
  'SLURRY_SPREADING_FROM_STORAGE__STPDB12N12_2000',
  'SLURRY_SPREADING_FROM_STORAGE__STPDB7_1000',
  'FORAGE_HARVEST__SFH6_2000',
  'FORAGE_HARVEST__SFH52_2000',
  'FORAGE_TRANSPORT__TTWT14_1000',
  'ROLLING__R80_2000',
]);

export function getFqnTier(fqn: string): 1 | 2 | 3 {
  if (FORCE_TIER3.has(fqn)) return 3;
  if (FORCE_NON_TIER3.has(fqn)) return 2;
  const prefix = fqn.split('__')[0];
  if (TIER1_PREFIXES.has(prefix)) return 1;
  if (TIER2_PREFIXES.has(prefix)) return 2;
  return 3;
}

const LOADING_FERTILIZER_REF_KG_HA = 300;

// "miscellanous" is a typo in the KTBL source data
const COST_NAME_MAP: Record<string, CostName> = {
  hours: 'hours',
  diesel: 'diesel',
  depreciation: 'depreciation',
  interest: 'interest',
  miscellanous: 'miscellaneous',
  repairs: 'repairs',
  materials: 'materials',
  services: 'services',
};

function nearestMech(kw: number): number {
  return MECH_LEVELS.reduce((best, m) => (Math.abs(m - kw) < Math.abs(best - kw) ? m : best));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

type Entries = Record<string, { params: Record<string, number[]> }>;

let entriesCache: Entries | null = null;
function crossEntries(): Entries {
  entriesCache ??= (
    JSON.parse(readFileSync(fileURLToPath(new URL('../../../data/ktbl/cross_params.json', import.meta.url)), 'utf-8')) as { entries: Entries }
  ).entries;
  return entriesCache;
}

function resolveKey(fqn: string, ktblCrop: string | undefined, soil: SoilType | undefined, sortedMechs: number[], entries: Entries): string | null {
  // Lookup priority: fqn@CROP@SOIL@mech > fqn@CROP@mech > fqn@~SOIL@mech > fqn@mech
  return (
    sortedMechs
      .flatMap((m) => {
        const keys: string[] = [];
        if (ktblCrop && soil) keys.push(`${fqn}@${ktblCrop}@${soil}@${m}`);
        if (ktblCrop) keys.push(`${fqn}@${ktblCrop}@${m}`);
        if (soil) keys.push(`${fqn}@~${soil}@${m}`);
        keys.push(`${fqn}@${m}`);
        return keys;
      })
      .find((k) => entries[k]) ?? null
  );
}

function computeFromKey(key: string, entries: Entries, dist: number, fs: number, scale: number): ActionCosts {
  const result = {} as ActionCosts;
  for (const [rawName, params] of Object.entries(entries[key].params)) {
    const costName = COST_NAME_MAP[rawName];
    if (!costName) continue;
    const [a, b, c, d] = params;
    // b, c, d clamped to ≥ 0: distance can only increase cost; larger fields can only be cheaper
    result[costName] = Math.max(0, (a + Math.max(0, b) * dist + Math.max(0, c) / fs + Math.max(0, d) * (dist / fs)) * scale);
  }
  return result;
}

/**
 * Estimate KTBL operation costs using the CROSS formula approximation.
 * Formula per cost column: a + b·dist + c/fs + d·dist/fs
 * Params fitted from exact KTBL grid data (R² ≈ 0.999 for variable ops, 1.0 for constants).
 *
 * When soilType is provided, computes all three soil variants and enforces
 * monotonicity (LS <= MS <= HS) — heavier soil never cheaper than lighter.
 *
 * @returns Cost components per occurrence, or null if FQN not found.
 */
export function estimateActionCosts(fqn: string, options: Options = {}): ActionCosts | null {
  const tier = getFqnTier(fqn);
  const isTier3 = tier === 3;

  const fs = isTier3 ? DEFAULT_FS_HA : clamp(options.fieldSizeHa ?? DEFAULT_FS_HA, 0.5, 80);
  const dist = isTier3 ? DEFAULT_DIST_KM : clamp(options.distanceKm ?? DEFAULT_DIST_KM, 1, 30);
  const mech = nearestMech(options.mechKw ?? DEFAULT_MECH_KW);

  const entries = crossEntries();
  const ktblCrop = options.crop ? CROP_TO_KTBL[options.crop] : undefined;
  const soil = options.soilType;
  const sortedMechs = MECH_LEVELS.slice().sort((a, b) => Math.abs(a - mech) - Math.abs(b - mech));

  const scale =
    fqn.startsWith('LOADING_FERTILIZER') && !isTier3 && options.productAmountKgHa != null
      ? clamp(options.productAmountKgHa / LOADING_FERTILIZER_REF_KG_HA, 0.1, 20)
      : 1.0;

  if (soil) {
    // Compute all three soils and enforce monotonicity: LS <= MS <= HS
    const soilTypes = ['LS', 'MS', 'HS'] as const;
    const raws = soilTypes.map((s) => {
      const key = resolveKey(fqn, ktblCrop, s, sortedMechs, entries);
      return key ? computeFromKey(key, entries, dist, fs, scale) : null;
    });

    if (raws.some((r) => r === null)) {
      const key = resolveKey(fqn, ktblCrop, soil, sortedMechs, entries);
      return key ? computeFromKey(key, entries, dist, fs, scale) : null;
    }

    const [ls, ms, hs] = raws as [ActionCosts, ActionCosts, ActionCosts];
    const enforced: Record<SoilType, ActionCosts> = { LS: { ...ls }, MS: { ...ms }, HS: { ...hs } };

    for (const k of Object.keys(ls) as CostName[]) {
      const vals = [ls[k], ms[k], hs[k]].sort((a, b) => a - b);
      enforced.LS[k] = vals[0];
      enforced.MS[k] = vals[1];
      enforced.HS[k] = vals[2];
    }

    return enforced[soil];
  }

  const candidateKey = resolveKey(fqn, ktblCrop, undefined, sortedMechs, entries);
  if (!candidateKey) return null;
  return computeFromKey(candidateKey, entries, dist, fs, scale);
}
