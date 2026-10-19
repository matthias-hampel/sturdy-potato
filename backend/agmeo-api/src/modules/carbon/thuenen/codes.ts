/**
 * Crop and organic-fertilizer codes of the Thünen service and its default carbon model
 * (agmeo src/lib/co2nserve/thuenen/utils.ts).
 */
import type {
  OrganicFertilizerCategory,
  SupportedCrops,
} from '../bek/types.js';
import type { CropId, OrganicFertilizerName } from './types.js';

/**
 * Please see the full list at https://agrighg-tool.thuenen.de/api/#tag/rothc/posthumusbalancerothc/batch
 */
const cropToThuenenCodeMap: Partial<Record<SupportedCrops, CropId>> = {
  landscapeFeature: '56', // Pufferstreifen ÖVF AL (inkl. Feldrand ÖVF)
  hardWheat: '112', // Winterhartweizen/Durum
  spelt: '114', // Winter-Dinkel
  winterWheat: '115', // Winterweichweizen
  springWheatFodder: '116', // Sommerweichweizen
  winterRyeBaking: '121', // Winterroggen
  ryeWholePlantSilage: '121', // abgebildet über Winterroggen
  winterBarleyFodder: '131', // Wintergerste
  springBarleyMalting: '132', // Sommergerste
  springOatsFodder: '143', // Sommerhafer
  triticaleFodder: '156', // Wintertriticale
  grainMaize: '171', // Körnermais
  peasDry: '210', // Erbsen zur Körnergewinnung
  peasDryFodder: '210', // Futtererbse (abgebildet über Erbsen zur Körnergewinnung)
  broadBeans: '220', // Acker-/Puff-/Pferdebohne
  lupine: '230', // Lupinen
  canola: '311', // Winterraps
  sunflower: '320', // Sonnenblumen
  soybeanBeans: '330', // Sojabohnen
  silageMaize: '411', // Silomais (als Hauptfutter)
  persianCloverIntercrop: '421', // (u.a.) Persischer Klee
  fieldGrassWiltedSilage: '424', // Ackergras
  permanentGrasslandWiltedSilage: '459', // Grünland (Dauergrünland)
  nonProductiveArea: '591', // Ackerland aus der Erzeugung genommen
  potatoTableLate: '602', // Kartoffeln (Speise)
  sugarBeet: '603', // Zuckerrüben
  oilRadishIntercrop: '618', // Ölrettich (Zwischenfrucht)
  cerealRyeIntercrop: '121', // Grünroggen (Zwischenfrucht, abgebildet über Winterroggen)
  mustardIntercrop: '619', // Weißer Senf (Zwischenfrucht)
  phaceliaIntercrop: '777', // Phacelia (nur als Hauptkultur kodiert)
  grassSeed: '912', // Grassamenvermehrung
  alfalfa: '423',
};

export const getThuenenCodeForCrop = (crop: SupportedCrops): CropId => {
  const code = cropToThuenenCodeMap[crop];
  if (code === undefined) {
    throw new Error(
      `No Thünen crop code for ${crop} — crops without model data have no carbon flow`,
    );
  }
  return code;
};

export type OrganicCategory =
  OrganicFertilizerCategory | 'cattle slurry and digested manure';

/*
 * Please see the full list at https://agrighg-tool.thuenen.de/api/#tag/rothc/posthumusbalancerothc/batch
 */
const organicCategoryToThuenenCode: Record<
  OrganicCategory,
  OrganicFertilizerName
> = {
  cattleSlurry: '0', // 0: Rindergülle
  cattleLiquidManure: '8', // 8: Rinderjauche
  pigSlurry: '1', // 1: Schweinegülle
  pigLiquidManure: '9', // 9: Schweinejauche
  chickenSolidManure: '6', // 6: Hühnermist
  pigSolidManure: '5', // 5: Schweinemist
  cattleSolidManure: '4', // 4: Rindermist
  horseManure: '22', // 22: Pferdemist
  turkeySolidManure: '23', // 23: Putenmist
  digestateLiquid: '64', // 64: NawaRo Gärprodukt flüssig
  'cattle slurry and digested manure': '4', // 4: Rindermist
  unknown: '10', // 10: Sonstiger Mist
};

export const DEFAULT_CARBON_MODEL = {
  id: 1272,
  name: 'HumusKlimaNetz - RothC Modelsystem',
  project_path: 'https://git-bw.thuenen.de/bw/humusbalancerothc',
  git_url: 'https://git-bw.thuenen.de/bw/humusbalancerothc.git',
  branch_name: 'generalisations',
  commit: 'HEAD',
  main_script: '/humusbalancerothc/RothC_cpp/HumKN2RothC.R',
  description: 'Model for carbon turnover in mineral soils',
  maintainer_email: 'konstantin.aiteew@thuenen.de',
};

export const getThuenenCodeForOrganicCategory = (
  category: OrganicCategory,
): OrganicFertilizerName => {
  const code = organicCategoryToThuenenCode[category];
  if (!code) {
    throw new Error(`Unsupported organic fertilizer category: ${category}`);
  }
  return code;
};
