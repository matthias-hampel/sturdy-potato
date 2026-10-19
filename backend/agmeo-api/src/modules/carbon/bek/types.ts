/**
 * Input, report and crop types of the BEK greenhouse-gas calculator, ported from AGVOLUTION/agmeo
 * (src/lib/co2calculator/src/types.ts). Crop keys are the reference's SupportedCrops; agmeo crop
 * codes map onto them in ../crops.ts.
 */
import type { ParameterKeys } from './parameters-sources.js';

export type DataItem = {
  fqn: string;
  order: number;
  displayName: string;
  co2e: number;
};

// 1 l diesel * 2.7 kg CO2/l-diesel = 2.7 kg CO2
export type Co2eCalculationExplanation = {
  inputValue: number;
  inputUnit: string;
  inputName: string;
  parameters: {
    relationInputParameter: 'x' | '+' | 'is.in.category';
    parameterValue: number;
    // TODO: Determine if we can include them in the ParameterKeys type
    parameterName:
      | ParameterKeys
      | 'nh3NProportion'
      | 'fEf'
      | 'n2oNefAmmoniaDeposit'
      | 'conv.t.to.dt'
      | 'conv.t.to.kg'
      | 'conv.dt.to.kg'
      | 'storingHumus'
      | 'nOrganic'
      | 'nEffectiveness'
      | '10% of nLastYear'
      | 'fertilizer.convTToCbm'
      | 'fertilizer.humus'
      | 'incroporationStraw'
      | `crop.${SupportedCrops}.restsHumusBuildingPotential`
      | `crop.${SupportedCrops}.humusByproduct` // This one is kept if we ever consider the byproduct for humus balance
      | `crop.${SupportedCrops}.piecesToKg`
      | any; // Please remove once you find the sources for winterBarley

    parameterUnit:
      | 'kg CO2e/l'
      | 'kg CO2e/kg'
      | 'kg CO₂e/kg Wirkstoff'
      | 'kg CO₂e/kg seed'
      | 'kg CaO/ 100kg'
      | '% P2O5'
      | '% K2O'
      | '% active ingredient'
      | '%'
      | 'kg CO2e/kg N organic last year'
      | string;
  }[];
  //offset: number;
  //offsetRelation: "x" | "+";
  resultValue: number;
  resultUnit: string;
  emissionSource?: string;
  note: string;
};

// 1.Direct and indirect greenhouse gas emissions from the field
// 2.Upstream greenhouse gas emissions from the use of operating resources
// 3. Greenhouse gas credits for by-crop products

// Define the Co2eReport type with an array of Co2eReportItem
export type Co2eReport = {
  byId: {
    pf1: number; // N2O emissions from NH3 losses when fertilizing with farm manure.
    pf2: number; // N2O emissions from NH3 losses when fertilizer is applied with mineral fertilizers.
    pf3: number; // N2O emissions from fertilization with farm manure.
    pf4: number; // N2O emissions from fertilization with mineral fertilizers.
    pf5a: number; // N2O emissions from harvest and root residues.
    pf5b: number; // N2O emissions from by-products left on field.
    pf6: number; // N2O emissions from nitrogen to be credited from organic fertilization of the previous year.
    pf7: number; // N2O emissions from mineral fertilizer effective N excretions from grazing.
    pf8a: number; // CO2 from lime fertilization.
    pf8b: number; // CO2 from urea fertilization.
    pf9: number; // CO2 from humus balance.
    pf10: number; // N2O emission from humus degradation.
    pf11a: number; // CO2e from humus degradation during grassland conversion to cropland.
    pf12: number; // CO2e from humus build-up during conversion of arable land to grassland.
    pf13: number; // CO2e emissions from humus decomposition in organic soil management.
    pb1a: number; // CO2e emissions for supplying N fertilizer mineral.
    pb1b: number; // CO2e emissions for supplying P2O5 fertilizer mineral.
    pb1c: number; // CO2e emissions for supplying K2O fertilizer mineral.
    pb1d: number; // CO2 emission for supplying CaO fertilizer mineral.
    pb2a: number; // CO2e emissions for supplying N fertilizer organic.
    pb2b: number; // CO2e emissions for supplying P2O5 fertilizer organic.
    pb2c: number; // CO2e emissions for supplying K2O fertilizer organic.
    pb3aa: number; // CO2e emission for N from previous crop.
    pb3ab: number; // CO2e emission for P2O5 from previous crop.
    pb3ac: number; // CO2e emission for K2O from previous crop.
    pb3ba: number; // CO2e for N from excretions on grassland.
    pb3bb: number; // CO2e for P2O5 from excretions on grassland.
    pb3bc: number; // CO2e for K2O from excretions on grassland.
    pb4: number; // CO2e emissions from seed supply.
    pb5: number; // CO2e emissions from the supply of crop protection products.
    pb6a: number; // CO2e emissions from diesel.
    pb6b: number; // Co2e emissions from biodiesel.
    pb7: number; // CO2e emissions from machine production.
    pn1a: number; // CO2 sequestration through humus build-up potential of by-crop products (straw).
    pn1b: number; // Co2 sequestration the by-products (straw, leaves, intercrop growth) that have been removed from the field.
    pn2a: number; // CO2e replacement value of the N supply for the following crop (straw, herbage, previous crop value).
    pn2b: number; // CO2e replacement value of the P supply for the following crop (straw, herbage, previous crop value).
    pn2c: number; // CO2e replacement value of the K supply for the following crop (straw, herbage, previous crop value).
  };

  byEmissionSource: {
    DIRECT_AND_INDIRECT_EMISSIONS_FROM_THE_FIELD: {
      fqn: 'DIRECT_AND_INDIRECT_EMISSIONS_FROM_THE_FIELD';
      order: 1;
      displayName: 'Direct and indirect greenhouse gas emissions from the field';
      co2e: number;
      details: DataItem[];
    };
    UPSTREAM_EMISSIONS_FROM_OPERATING_RESOURCES: {
      fqn: 'UPSTREAM_EMISSIONS_FROM_OPERATING_RESOURCES';
      order: 2;
      displayName: 'Upstream greenhouse gas emissions from the use of operating resources';
      co2e: number;
      details: DataItem[];
    };
    GREENHOUSE_GAS_CREDITS_FOR_BY_CROP_PRODUCTS: {
      fqn: 'GREENHOUSE_GAS_CREDITS_FOR_BY_CROP_PRODUCTS';
      order: 3;
      displayName: 'Greenhouse gas credits for by-crop products';
      co2e: number;
      details: DataItem[];
    };
  };
  byManagement?: {
    byProduct: {
      mineral: { [key: string]: number };
      organic: { [key: number]: number };
      pesticides: { [key: number]: number };
    };
    byOperationCategory: {
      tillage: number;
      sowing: number;
      harvesting: number;
      transport: number;
      irrigation: number;
    };
  };
  details: Co2eCalculationExplanation[];
  total: number;
};

export const secondaryCrops: SupportedCrops[] = [
  'cerealRyeIntercrop',
  'mustardIntercrop',
  'oilRadishIntercrop',
  'persianCloverIntercrop',
  'phaceliaIntercrop',
  'intercropMixture',
  'blackOatIntercrop',
  'vetchIntercrop',
  'crimsonCloverIntercrop',
  'alexandrineCloverIntercrop',
  'buckwheatIntercrop',
  'sunflowerIntercrop',
  'nigerIntercrop',
  'sorghumIntercrop',
  'linseedIntercrop',
  'camelinaIntercrop',
  'serradellaIntercrop',
  'ryegrassUndersow',
  'cloverGrassUndersow',
] as const;

/** Sown after harvest for the next main crop, so filed under harvest year + 1. Undersows stay with their main crop. */
export const isCatchCrop = (crop: string): boolean =>
  secondaryCrops.includes(crop as SupportedCrops) && !crop.endsWith('Undersow');

export const allSupportedCrops = [
  'silageMaize',
  'winterWheat',
  'canola',
  'sugarBeet',
  'winterBarleyFodder',
  'springBarleyMalting',
  'springOatsFodder',
  'springWheatFodder', // TODO: known bug — we do not have DUEV data for it yet
  'winterRyeBaking',
  'fieldGrassWiltedSilage',
  'permanentGrasslandWiltedSilage',
  'potatoTableLate',
  'peasDry',
  'peasDryFodder',
  'triticaleFodder',
  'broadBeans',
  'sunflower',
  'grassSeed',
  'hardWheat',
  'grainMaize',
  'soybeanBeans',
  'cerealRyeIntercrop',
  'mustardIntercrop',
  'oilRadishIntercrop',
  'persianCloverIntercrop',
  'phaceliaIntercrop',
  'ryeWholePlantSilage',
  'lupine',
  'spelt', // De:Dinkel
  'landscapeFeature',
  'nonProductiveArea', // Brache/Stilllegung/ÖVF
  'alfalfa',

  /* Crops below ship without model data — see cropsWithoutModelData */
  'winterOats',
  'springRye',
  'springTriticale',
  'springCanola',
  'springDurum',
  'winterBroadBeans',
  'winterPeas',
  'potatoStarch',
  'seedPotato',
  'potatoTableEarly',
  'cornCobMix',
  'maizeBiogas',
  'sorghum',
  'buckwheat',
  'millet',
  'lentils',
  'chickpeas',
  'linseed',
  'hemp',
  'poppy',
  'fodderBeet',
  'vetch',
  'quinoa',
  'emmer',
  'einkorn',
  'clover',
  'cloverGrass',
  'alfalfaGrass',
  'intercropMixture',
  'blackOatIntercrop',
  'vetchIntercrop',
  'crimsonCloverIntercrop',
  'alexandrineCloverIntercrop',
  'buckwheatIntercrop',
  'sunflowerIntercrop',
  'nigerIntercrop',
  'sorghumIntercrop',
  'linseedIntercrop',
  'camelinaIntercrop',
  'serradellaIntercrop',
  'ryegrassUndersow',
  'cloverGrassUndersow',
  'onion',
  'garlic',
  'leek',
  'carrot',
  'whiteCabbage',
  'redCabbage',
  'savoyCabbage',
  'cauliflower',
  'broccoli',
  'kale',
  'kohlrabi',
  'brusselsSprouts',
  'chineseCabbage',
  'lettuce',
  'lambsLettuce',
  'spinach',
  'beetroot',
  'celeriac',
  'fennel',
  'endive',
  'bushBeans',
  'sweetCorn',
  'pumpkin',
  'cucumber',
  'tomato',
  'bellPepper',
  'asparagus',
  'strawberry',
  'hops',
  'grapevine',
  'rhubarb',
  'pomeFruit',
  'stoneFruit',
  'rice',
  'cowpeas',
  'dryBeans',
  'grainSorghum',
  // Not a plant: the placeholder a cultivation gets when the crop is genuinely
  // unknown — a John Deere field with tillage or applications but no sowing to
  // name the crop. Without it those operations have nothing to attach to and
  // are dropped. It ships no template and no model data, so it documents work
  // and area while every crop-specific calculation stays silent.
  'unknownCrop',
] as const;

export type SupportedCrops = (typeof allSupportedCrops)[number];

/**
 * The closest crop that ships a standard template. One hop, always a legacy
 * crop: it pre-selects the base crop whose dates seed the template builder and
 * supplies the carbon-parameter surrogate (acceptable because these crops are
 * Agmeo-only and never reach the CO2 report). Nitrogen, DüV and phenology are
 * never proxied — there a crop without its own values is unsupported, and the
 * app says so.
 */
const cropProxyEntries = {
  winterOats: 'springOatsFodder',
  springRye: 'winterRyeBaking',
  springTriticale: 'triticaleFodder',
  springCanola: 'canola',
  springDurum: 'winterWheat',
  winterBroadBeans: 'broadBeans',
  winterPeas: 'peasDry',
  potatoStarch: 'potatoTableLate',
  seedPotato: 'potatoTableLate',
  potatoTableEarly: 'potatoTableLate',
  cornCobMix: 'grainMaize',
  maizeBiogas: 'silageMaize',
  sorghum: 'silageMaize',
  buckwheat: 'springOatsFodder',
  millet: 'grainMaize',
  lentils: 'peasDry',
  chickpeas: 'peasDry',
  linseed: 'springOatsFodder',
  hemp: 'silageMaize',
  poppy: 'springOatsFodder',
  fodderBeet: 'sugarBeet',
  vetch: 'peasDry',
  quinoa: 'springOatsFodder',
  emmer: 'spelt',
  einkorn: 'spelt',
  clover: 'alfalfa',
  cloverGrass: 'fieldGrassWiltedSilage',
  alfalfaGrass: 'alfalfa',
  intercropMixture: 'mustardIntercrop',
  blackOatIntercrop: 'mustardIntercrop',
  vetchIntercrop: 'persianCloverIntercrop',
  crimsonCloverIntercrop: 'persianCloverIntercrop',
  alexandrineCloverIntercrop: 'persianCloverIntercrop',
  buckwheatIntercrop: 'mustardIntercrop',
  sunflowerIntercrop: 'mustardIntercrop',
  nigerIntercrop: 'mustardIntercrop',
  sorghumIntercrop: 'mustardIntercrop',
  linseedIntercrop: 'mustardIntercrop',
  camelinaIntercrop: 'mustardIntercrop',
  serradellaIntercrop: 'persianCloverIntercrop',
  ryegrassUndersow: 'cerealRyeIntercrop',
  cloverGrassUndersow: 'persianCloverIntercrop',
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
  asparagus: 'alfalfa',
  strawberry: 'alfalfa',
  hops: 'alfalfa',
  grapevine: 'alfalfa',
  rhubarb: 'alfalfa',
  pomeFruit: 'alfalfa',
  stoneFruit: 'alfalfa',
  rice: 'grainMaize',
  cowpeas: 'soybeanBeans',
  dryBeans: 'soybeanBeans',
  grainSorghum: 'grainMaize',
} as const satisfies Partial<Record<SupportedCrops, SupportedCrops>>;

/** The crops that have a carbon-parameter surrogate — exactly the ones without model data. */
export type CropWithoutModelData = keyof typeof cropProxyEntries;

export const cropProxy: Partial<Record<SupportedCrops, SupportedCrops>> =
  cropProxyEntries;

/**
 * Crops the farmer can document fully, but for which our agronomists have not
 * supplied model data yet: no nitrogen demand curve, no DüV reference values,
 * no phenology. The app states this instead of guessing — see
 * `cropDataNotAvailableYet`.
 */
export const cropsWithoutModelData = Object.keys(
  cropProxyEntries,
) as SupportedCrops[];

export const cropsWithBBCHGraph: SupportedCrops[] = [
  'broadBeans',
  'grainMaize',
  'springBarleyMalting',
  'springOatsFodder',
  'winterBarleyFodder',
  'canola',
  'winterRyeBaking',
  'triticaleFodder',
  'winterWheat',
  'silageMaize',
  'sunflower',
];

export const cropsWithoutSowingHarvesting: SupportedCrops[] = [
  'landscapeFeature',
  'nonProductiveArea',
  // We know work happened, not what was grown — so no sowing or harvest date
  // can be assumed for it either.
  'unknownCrop',
] as const;

export const grassLandCrops: SupportedCrops[] = [
  'permanentGrasslandWiltedSilage',
  'fieldGrassWiltedSilage',
];

/**
 * Crops that stay on the field for multiple years after a single establishment: sown once, then
 * harvested every season. Kept in sync with `Crop.isPerennial` via the seed (`cropSeed`).
 */
const perennialCrops: SupportedCrops[] = [
  'alfalfa',
  'fieldGrassWiltedSilage',
  'permanentGrasslandWiltedSilage',
  'asparagus',
  'strawberry',
  'hops',
  'grapevine',
  'rhubarb',
  'pomeFruit',
  'stoneFruit',
];

export function isPerennialCrop(crop: string | null | undefined): boolean {
  return !!crop && (perennialCrops as string[]).includes(crop);
}

/**
 * Horticultural crops: the vegetables and the fruit / special permanent crops of the Nutzungscode
 * catalogue. They get the `appliesTo = VEGETABLES` action catalogue (transplanting, fleece, drip
 * irrigation, manual harvest, ...) on top of the generic ALL / ARABLES actions. Arable crops never
 * see those actions.
 */
const vegetableCrops: SupportedCrops[] = [
  'onion',
  'garlic',
  'leek',
  'carrot',
  'whiteCabbage',
  'redCabbage',
  'savoyCabbage',
  'cauliflower',
  'broccoli',
  'kale',
  'kohlrabi',
  'brusselsSprouts',
  'chineseCabbage',
  'lettuce',
  'lambsLettuce',
  'spinach',
  'beetroot',
  'celeriac',
  'fennel',
  'endive',
  'bushBeans',
  'sweetCorn',
  'pumpkin',
  'cucumber',
  'tomato',
  'bellPepper',
  'asparagus',
  'strawberry',
  'hops',
  'grapevine',
  'rhubarb',
  'pomeFruit',
  'stoneFruit',
];

export function isVegetableCrop(crop: string | null | undefined): boolean {
  return !!crop && (vegetableCrops as string[]).includes(crop);
}

export const cropsJustForEconomic: SupportedCrops[] = [
  'fieldGrassWiltedSilage',
  'peasDry',
  'grassSeed',
] as const;

export const cropsNotAvailable: SupportedCrops[] = ['grassSeed'] as const; // TODO: Remove this once we have the data for grass seed
// Furthermore, uncomment grassSeed codes in src/lib/cropCodes.tsx

/**
 * Crops that skip the personalization survey. Content-equal to
 * {@link cropsJustForEconomic} today, but kept separate on purpose: that list
 * answers which brand offers a crop, this one answers whether the survey entry
 * point exists — and the crops without model data belong only to the former.
 */
export const cropsWithoutSurvey: SupportedCrops[] = [
  'fieldGrassWiltedSilage',
  'peasDry',
  'grassSeed',
] as const;

export const cropsWithoutPlantProtection: Partial<SupportedCrops>[] = [
  'permanentGrasslandWiltedSilage',
  'alfalfa',
];

export const cropsLegumes = [
  'broadBeans',
  'peasDry',
  'peasDryFodder',
  'soybeanBeans',
  'lupine',
  'winterBroadBeans',
  'alfalfa',
  'persianCloverIntercrop',
  'winterPeas',
  'lentils',
  'chickpeas',
  'vetch',
  'clover',
  'cloverGrass',
  'alfalfaGrass',
  'vetchIntercrop',
  'crimsonCloverIntercrop',
  'alexandrineCloverIntercrop',
  'serradellaIntercrop',
  'cloverGrassUndersow',
  'bushBeans',
  'cowpeas',
  'dryBeans',
] as const;

export type OrganicFertilizerCategory =
  | 'cattleSolidManure'
  | 'pigSolidManure'
  | 'horseManure'
  | 'turkeySolidManure'
  | 'chickenSolidManure'
  | 'pigSlurry' // German: Schweinegülle
  | 'cattleSlurry' // German: Rindergülle
  | 'pigLiquidManure' // German: Schweinejauche
  | 'cattleLiquidManure' // German: Rinderjauche
  | 'digestateLiquid' // German: Gärrest
  | 'cattle slurry and digested manure'
  | 'unknown';

export type ApplicationType = 'trailing hose' | 'broadcast' | 'trailing shoe';

export type IncorporationTime =
  'noIncorporation' | '1h' | '4h' | '6h' | '8h' | '12h' | '24h' | '48h';

type fieldData = {
  // Crop and field variables
  crop: SupportedCrops;
  dryMassYield: number; // kg / ha
  byProductWet?: number; // fresh_grain_yield * VHN * DM_minorproduct
  byproductRemoved: number; // 1 - kept
  nLastYear: number; // kg N /ha total, only for organic, the function will calculate with 10% of this
  humusBalance: number; // kg humus-C
  supplySeed: number; // kg/ha
  pesticidesQuantity: number;
  diesel: number; // l/ha
  biodiesel: number; // l/ha
  nForNextCrop?: number; // Creditable N-supply for the following crop
  p2o5ForNextCrop?: number; // Creditable P2O5-supply for the following crop
  k2oForNextCrop?: number; // Creditable K2O supply for the following crop
  HVO100?: number; // l/ha
};

export type fieldMineralFertilizerData = {
  // Mineral fertilizer parameters
  fertilizerMineralType: string;
  appliedUreaNHectare: number;
  appliedUanNHectare: number;
  appliedOthersMineralNHectare: number; // referring to mineral non-urea non-uan
  nEmissionsManufacturing?: number; // kg CO2e/kg N
  limeYearlyAverage: number; // kg CaO/ha
  p2o5Mineral: number; // kg/ha
  k2oMineral: number;
};

export type fieldOrganicFertilizerData = {
  // Organic fertilizer parameters
  organicFertilizerType: OrganicFertilizerCategory;
  organicTechnology: ApplicationType;
  incorporationTime: IncorporationTime;
  quantityFarmManure: number; // m^3
  nFromOrganic: number; // kg N / m^3
  p2o5Organic: number; // kg P2O5 / m^3
  k2oOrganic: number; // kg K2O / m^3
  nh3NProportion: number; // for organic
  nEffectiveness: number; // Not sure of this one
};

export type Co2eInput = {
  fieldData: fieldData;
  fieldMineralFertilizerData: { [key: string]: fieldMineralFertilizerData }[];
  fieldOrganicFertilizerData: { [key: string]: fieldOrganicFertilizerData }[];
  //previousYearOperations?: Operation[],
  //previousCrop?: string
};

/** Recursively optional, for parameter overrides. */
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};
