/**
 * All constants of the BEK calculator, ported from AGVOLUTION/agmeo
 * (src/lib/co2calculator/data/parameters.ts). Values come from ./parameters-sources.ts with
 * their citations; the few literals below are the reference's own.
 */
import { parametersWithDetails as paramsCited } from './parameters-sources.js';
import type {
  CropWithoutModelData,
  DeepPartial,
  IncorporationTime,
  OrganicFertilizerCategory,
  SupportedCrops,
} from './types.js';

/** Intercrops with their own humus parameters (agmeo src/lib/templates/intercrop.ts). */
export type Intercrop = 'mustardIntercrop';

/**
 * Thousand-grain weight and kg per sales unit of the crops without model data (agmeo
 * src/seedData/cropsWithoutModelData.ts): needed to convert seed quantities, not a carbon value.
 */
const cropsWithoutModelDataSeed: {
  name: CropWithoutModelData;
  thousandGrainWeight: number;
  piecesToKg: number;
}[] = [
  { name: 'winterOats', thousandGrainWeight: 40, piecesToKg: 1 },
  { name: 'springRye', thousandGrainWeight: 35, piecesToKg: 1 },
  { name: 'springTriticale', thousandGrainWeight: 40, piecesToKg: 1 },
  { name: 'springCanola', thousandGrainWeight: 4.5, piecesToKg: 1 },
  { name: 'springDurum', thousandGrainWeight: 45, piecesToKg: 1 },
  { name: 'winterBroadBeans', thousandGrainWeight: 450, piecesToKg: 1 },
  { name: 'winterPeas', thousandGrainWeight: 200, piecesToKg: 1 },
  { name: 'potatoStarch', thousandGrainWeight: 1, piecesToKg: 1 },
  { name: 'seedPotato', thousandGrainWeight: 1, piecesToKg: 1 },
  { name: 'potatoTableEarly', thousandGrainWeight: 1, piecesToKg: 1 },
  { name: 'cornCobMix', thousandGrainWeight: 300, piecesToKg: 15 },
  { name: 'maizeBiogas', thousandGrainWeight: 300, piecesToKg: 15 },
  { name: 'sorghum', thousandGrainWeight: 30, piecesToKg: 1 },
  { name: 'buckwheat', thousandGrainWeight: 25, piecesToKg: 1 },
  { name: 'millet', thousandGrainWeight: 5, piecesToKg: 1 },
  { name: 'lentils', thousandGrainWeight: 40, piecesToKg: 1 },
  { name: 'chickpeas', thousandGrainWeight: 350, piecesToKg: 1 },
  { name: 'linseed', thousandGrainWeight: 6, piecesToKg: 1 },
  { name: 'hemp', thousandGrainWeight: 18, piecesToKg: 1 },
  { name: 'poppy', thousandGrainWeight: 0.5, piecesToKg: 1 },
  { name: 'fodderBeet', thousandGrainWeight: 20, piecesToKg: 1 },
  { name: 'vetch', thousandGrainWeight: 55, piecesToKg: 1 },
  { name: 'quinoa', thousandGrainWeight: 3, piecesToKg: 1 },
  { name: 'emmer', thousandGrainWeight: 40, piecesToKg: 1 },
  { name: 'einkorn', thousandGrainWeight: 30, piecesToKg: 1 },
  { name: 'clover', thousandGrainWeight: 2, piecesToKg: 1 },
  { name: 'cloverGrass', thousandGrainWeight: 2.5, piecesToKg: 1 },
  { name: 'alfalfaGrass', thousandGrainWeight: 2.5, piecesToKg: 1 },
  { name: 'intercropMixture', thousandGrainWeight: 10, piecesToKg: 1 },
  { name: 'blackOatIntercrop', thousandGrainWeight: 20, piecesToKg: 1 },
  { name: 'vetchIntercrop', thousandGrainWeight: 55, piecesToKg: 1 },
  { name: 'crimsonCloverIntercrop', thousandGrainWeight: 3, piecesToKg: 1 },
  { name: 'alexandrineCloverIntercrop', thousandGrainWeight: 3, piecesToKg: 1 },
  { name: 'buckwheatIntercrop', thousandGrainWeight: 25, piecesToKg: 1 },
  { name: 'sunflowerIntercrop', thousandGrainWeight: 60, piecesToKg: 1 },
  { name: 'nigerIntercrop', thousandGrainWeight: 4, piecesToKg: 1 },
  { name: 'sorghumIntercrop', thousandGrainWeight: 15, piecesToKg: 1 },
  { name: 'linseedIntercrop', thousandGrainWeight: 6, piecesToKg: 1 },
  { name: 'camelinaIntercrop', thousandGrainWeight: 1, piecesToKg: 1 },
  { name: 'serradellaIntercrop', thousandGrainWeight: 3, piecesToKg: 1 },
  { name: 'ryegrassUndersow', thousandGrainWeight: 2, piecesToKg: 1 },
  { name: 'cloverGrassUndersow', thousandGrainWeight: 2.5, piecesToKg: 1 },
  { name: 'onion', thousandGrainWeight: 3.5, piecesToKg: 1 },
  { name: 'garlic', thousandGrainWeight: 4000, piecesToKg: 1 },
  { name: 'leek', thousandGrainWeight: 3, piecesToKg: 1 },
  { name: 'carrot', thousandGrainWeight: 1.2, piecesToKg: 1 },
  { name: 'whiteCabbage', thousandGrainWeight: 4, piecesToKg: 1 },
  { name: 'redCabbage', thousandGrainWeight: 4, piecesToKg: 1 },
  { name: 'savoyCabbage', thousandGrainWeight: 4, piecesToKg: 1 },
  { name: 'cauliflower', thousandGrainWeight: 3.5, piecesToKg: 1 },
  { name: 'broccoli', thousandGrainWeight: 3.5, piecesToKg: 1 },
  { name: 'kale', thousandGrainWeight: 4, piecesToKg: 1 },
  { name: 'kohlrabi', thousandGrainWeight: 3, piecesToKg: 1 },
  { name: 'brusselsSprouts', thousandGrainWeight: 4, piecesToKg: 1 },
  { name: 'chineseCabbage', thousandGrainWeight: 3, piecesToKg: 1 },
  { name: 'lettuce', thousandGrainWeight: 1.1, piecesToKg: 1 },
  { name: 'lambsLettuce', thousandGrainWeight: 1.5, piecesToKg: 1 },
  { name: 'spinach', thousandGrainWeight: 10, piecesToKg: 1 },
  { name: 'beetroot', thousandGrainWeight: 15, piecesToKg: 1 },
  { name: 'celeriac', thousandGrainWeight: 0.4, piecesToKg: 1 },
  { name: 'fennel', thousandGrainWeight: 6, piecesToKg: 1 },
  { name: 'endive', thousandGrainWeight: 1.5, piecesToKg: 1 },
  { name: 'bushBeans', thousandGrainWeight: 300, piecesToKg: 1 },
  { name: 'sweetCorn', thousandGrainWeight: 250, piecesToKg: 1 },
  { name: 'pumpkin', thousandGrainWeight: 200, piecesToKg: 1 },
  { name: 'cucumber', thousandGrainWeight: 30, piecesToKg: 1 },
  { name: 'tomato', thousandGrainWeight: 3, piecesToKg: 1 },
  { name: 'bellPepper', thousandGrainWeight: 6, piecesToKg: 1 },
  { name: 'asparagus', thousandGrainWeight: 1, piecesToKg: 1 },
  { name: 'strawberry', thousandGrainWeight: 1, piecesToKg: 1 },
  { name: 'hops', thousandGrainWeight: 1, piecesToKg: 1 },
  { name: 'grapevine', thousandGrainWeight: 1, piecesToKg: 1 },
  { name: 'rhubarb', thousandGrainWeight: 1, piecesToKg: 1 },
  { name: 'pomeFruit', thousandGrainWeight: 1, piecesToKg: 1 },
  { name: 'stoneFruit', thousandGrainWeight: 1, piecesToKg: 1 },
  { name: 'rice', thousandGrainWeight: 25, piecesToKg: 1 },
  { name: 'cowpeas', thousandGrainWeight: 150, piecesToKg: 1 },
  { name: 'dryBeans', thousandGrainWeight: 350, piecesToKg: 1 },
  { name: 'grainSorghum', thousandGrainWeight: 28, piecesToKg: 1 },
];

// A) Conversion factor (chemistry)
const cf: { [key in 'n2oN2on' | 'cCo2']: number } = {
  n2oN2on: paramsCited['cf.n2oN2on'].Wert, // conversion factor in kg N2/kg N2O
  cCo2: paramsCited['cf.cCo2'].Wert, // Conversion factor for carbon to carbon dioxide
};

// B) Global warming potential (kg CO2e / kg )
const gwp: { [key in 'n2o']: number } = { n2o: paramsCited['gwp.n2o'].Wert }; // ch4 not used yet

// C) Emission factors
const ef = {
  // Direct emissions from fertilizers
  n2oN: paramsCited['ef.n2oN'].Wert, // N2O-N emission factor for N fertilization (direct and indirect through leaching).
  urea: paramsCited['ef.urea'].Wert, // CO2 emission factor for the use of urea-N
  otherMineralN: paramsCited['ef.otherMineralN'].Wert, // CO2e emission factor for the supply of other mineral fertilizer-N from Europe
  cao: paramsCited['ef.cao'].Wert, // kg CO2/kg CaO
  nPrevious: paramsCited['ef.nPrevious'].Wert, // CO2e emission factor for the supply of farm manure-N, preceding crop-N.
  // Mechanical work emission factors
  diesel: paramsCited['ef.diesel'].Wert, // CO2e from 1l diesel, source: Lauf, T.; Memmler, M.; Schneider, S. (2019): Emissionsbilanz erneuerbarer Energieträger. Bestimmung der vermiedenen Emissionen im Jahr 2018. Climate Change 37/2019, Dessau-Roßlau, Umweltbundesamt; EU RL 2001 (2018): Richtlinie (EU) 2018/ 2001 des Europäischen Parlaments und des Rates vom 11. Dezember 2018 zur Förderung der Nutzung von Energie aus erneuerbaren Quellen, ABl L 328 vom 21.12.2018, S. 82–209
  // petrol: 2.68, // CO2e from 1l petrol, source: Lauf, T.; Memmler, M.; Schneider, S. (2019): Emissionsbilanz erneuerbarer Energieträger. Bestimmung der vermiedenen Emissionen im Jahr 2018. Climate Change 37/2019, Dessau-Roßlau, Umweltbundesamt; EU RL 2001 (2018): Richtlinie (EU) 2018/ 2001 des Europäischen Parlaments und des Rates vom 11. Dezember 2018 zur Förderung der Nutzung von Energie aus erneuerbaren Quellen, ABl L 328 vom 21.12.2018, S. 82–209
  biodiesel: paramsCited['ef.biodiesel'].Wert, // CO2e from 1l biodiesel,  source: Lauf, T.; Memmler, M.; Schneider, S. (2019): Emissionsbilanz erneuerbarer Energieträger. Bestimmung der vermiedenen Emissionen im Jahr 2018. Climate Change 37/2019, Dessau-Roßlau, Umweltbundesamt; EU RL 2001 (2018): Richtlinie (EU) 2018/ 2001 des Europäischen Parlaments und des Rates vom 11. Dezember 2018 zur Förderung der Nutzung von Energie aus erneuerbaren Quellen, ABl L 328 vom 21.12.2018, S. 82–209
  hvo100: paramsCited['ef.hvo100'].Wert, // CO2e from 1l HVO100 (Hydrotreated Vegetable Oil), ~90% lower lifecycle emissions than fossil diesel
  // naturalGas: 0.246, // CO2e from 1l Natural gas, source: Lauf, T.; Memmler, M.; Schneider, S. (2019): Emissionsbilanz erneuerbarer Energieträger. Bestimmung der vermiedenen Emissionen im Jahr 2018. Climate Change 37/2019, Dessau-Roßlau, Umweltbundesamt; EU RL 2001 (2018): Richtlinie (EU) 2018/ 2001 des Europäischen Parlaments und des Rates vom 11. Dezember 2018 zur Förderung der Nutzung von Energie aus erneuerbaren Quellen, ABl L 328 vom 21.12.2018, S. 82–209
  machineManufacture: paramsCited['ef.machineManufacture'].Wert, // CO2e from manufacturing the machine, calculated by how much diesel they used in that year
  electricityGridDe2018: paramsCited['ef.electricityGridDe2018'].Wert, // kg CO2e/kWh, Strommix DE 2018
  electricityRenewablesMixDe2018:
    paramsCited['ef.electricityRenewablesMixDe2018'].Wert, // kg CO2e/kWh, Ökostrom-Mix DE 2018
  // Heating energy carriers, BAFA (2025), EEW Informationsblatt CO2-Faktoren, Tabelle 2
  heizoelDieselBafa2025: paramsCited['ef.heizoelDieselBafa2025'].Wert,
  erdgasBafa2025: paramsCited['ef.erdgasBafa2025'].Wert,
  fluessiggasBafa2025: paramsCited['ef.fluessiggasBafa2025'].Wert,
  biogasBafa2025: paramsCited['ef.biogasBafa2025'].Wert,
  pelletsBafa2025: paramsCited['ef.pelletsBafa2025'].Wert,
  biomasseHolzBafa2025: paramsCited['ef.biomasseHolzBafa2025'].Wert,
  nahFernwaermeBafa2025: paramsCited['ef.nahFernwaermeBafa2025'].Wert,
  // Supply emission factors
  supplyUrea: paramsCited['ef.supplyUrea'].Wert, // CO2e emission factor for the supply of urea-N from Europe
  supplyUan: paramsCited['ef.supplyUan'].Wert, // CO2e emission factor for the supply of UAN-N from Europe
  supplyAhl: paramsCited['ef.supplyAhl'].Wert, // CO2e emission factor for the supply of AHL-N from Europe
  supplyNOrganic: paramsCited['ef.supplyNOrganic'].Wert, // CO2e emission factor for the supply of farm manure-N, preceding crop-N.
  supplyP2O5: paramsCited['ef.supplyP2O5'].Wert, // kg CO2e/kg P2O5 - identical organic, mineral
  supplyK2O: paramsCited['ef.supplyK2O'].Wert, // kg CO2e/kg K2O
  supplyCao: paramsCited['ef.supplyCao'].Wert, // kg CO2e/kg CaO
  supplyPesticides: paramsCited['ef.supplyPesticides'].Wert, // CO2e emission factor for the supply of crop protection active ingredient
  appliedN: {
    urea: paramsCited['ef.appliedN.urea'].Wert,
    ureaWithInhibitor: paramsCited['ef.appliedN.ureaWithInhibitor'].Wert,
    canAndOthersN: paramsCited['ef.appliedN.canAndOthersN'].Wert,
    np: paramsCited['ef.appliedN.np'].Wert,
    ahl: paramsCited['ef.appliedN.ahl'].Wert,
    others: paramsCited['ef.appliedN.others'].Wert,
  },
  supplyGreenFertilizer: paramsCited['ef.supplyGreenFertilizer'].Wert, // CO2e emission factor for the supply of green fertilizer-N
  supplyGreenFertilizerLiquid:
    paramsCited['ef.supplyGreenFertilizerLiquid'].Wert, // CO2e emission factor for the supply of green fertilizer-N
};

// D) Other parameters
const nPerCHumus: number = paramsCited['nPerCHumus'].Wert; // N/C in humus,

// E) Crop-specific parameters

type SupportedCropsParameters = {
  restsHumusBuildingPotential: number; // kg N2O-N/ha
  rootProportion: number; // Ratio of crop and root residues (EWR) to yield (E).
  nContentRoot: number; // N content in  kg N / kg DM-roots
  supplySeed: number;
  dryMatterContent: number;
  dryMatterContentByproduct: number; // Dry matter content of the byproduct
  MPBR: number; // Main product byproduct ratio Haupternteprodukt-Nebenernteprodukt-Verhältnis.
  //nMainFm?: number; // N content in main product
  nByproductFm: number; // N content in byproduct
  //p2o5MainFm?: number; // P2O5 content in main product
  p2o5ByproductFm: number; // P2O5 content in byproduct
  //k2oMainFm?: number; // K2O content in main product
  k2oByproductFm: number; // K2O content in byproduct
  humusMain: number; // Humus building potential of the main product
  piecesToKg: number; // Conversion factor from pieces to kg
  thousandGrainWeight?: number; // Thousand grain weight
};

/* Exhaustive over the crops WITH model data: adding crop #75 to SupportedCrops
 * without either a row here or a cropProxy entry is a compile error, not a
 * silent undefined at runtime. */
const cropOwnParameters: Record<
  Exclude<SupportedCrops, CropWithoutModelData>,
  SupportedCropsParameters
> = {
  silageMaize: {
    restsHumusBuildingPotential: 0,
    rootProportion: paramsCited['crop.silageMaize.rootProportion'].Wert,
    nContentRoot: paramsCited['crop.silageMaize.nContentRoot'].Wert,
    supplySeed: paramsCited['crop.silageMaize.supplySeed'].Wert,
    dryMatterContent: paramsCited['crop.silageMaize.dryMatterContent'].Wert,
    dryMatterContentByproduct:
      paramsCited['crop.silageMaize.dryMatterContentByproduct'].Wert,
    MPBR: paramsCited['crop.silageMaize.MPBR'].Wert,
    nByproductFm: 0, //paramsCited["crop.silageMaize.nByproductFm"].Wert, - for now, because our value is not for silage
    p2o5ByproductFm: paramsCited['crop.silageMaize.p2o5ByproductFm'].Wert,
    k2oByproductFm: paramsCited['crop.silageMaize.k2oByproductFm'].Wert,
    humusMain: paramsCited['crop.silageMaize.humusMain'].Wert,
    piecesToKg: paramsCited['crop.silageMaize.piecesToKg'].Wert,
    thousandGrainWeight:
      paramsCited['crop.silageMaize.thousandGrainWeight'].Wert,
  },

  winterWheat: {
    restsHumusBuildingPotential: 0.1,
    rootProportion: paramsCited['crop.winterWheat.rootProportion'].Wert,
    nContentRoot: paramsCited['crop.winterWheat.nContentRoot'].Wert,
    supplySeed: paramsCited['crop.winterWheat.supplySeed'].Wert,
    dryMatterContent: paramsCited['crop.winterWheat.dryMatterContent'].Wert,
    dryMatterContentByproduct:
      paramsCited['crop.winterWheat.dryMatterContentByproduct'].Wert,
    MPBR: paramsCited['crop.winterWheat.MPBR'].Wert,
    nByproductFm: paramsCited['crop.winterWheat.nByproductFm'].Wert,
    p2o5ByproductFm: paramsCited['crop.winterWheat.p2o5ByproductFm'].Wert,
    k2oByproductFm: paramsCited['crop.winterWheat.k2oByproductFm'].Wert,
    humusMain: paramsCited['crop.winterWheat.humusMain'].Wert,
    piecesToKg: paramsCited['crop.winterWheat.piecesToKg'].Wert,
    thousandGrainWeight:
      paramsCited['crop.winterWheat.thousandGrainWeight'].Wert,
  },
  hardWheat: {
    restsHumusBuildingPotential: 0.1,
    rootProportion: paramsCited['crop.winterWheat.rootProportion'].Wert,
    nContentRoot: paramsCited['crop.winterWheat.nContentRoot'].Wert,
    supplySeed: paramsCited['crop.winterWheat.supplySeed'].Wert,
    dryMatterContent: paramsCited['crop.winterWheat.dryMatterContent'].Wert,
    dryMatterContentByproduct:
      paramsCited['crop.winterWheat.dryMatterContentByproduct'].Wert,
    MPBR: paramsCited['crop.winterWheat.MPBR'].Wert,
    nByproductFm: paramsCited['crop.winterWheat.nByproductFm'].Wert,
    p2o5ByproductFm: paramsCited['crop.winterWheat.p2o5ByproductFm'].Wert,
    k2oByproductFm: paramsCited['crop.winterWheat.k2oByproductFm'].Wert,
    humusMain: paramsCited['crop.winterWheat.humusMain'].Wert,
    piecesToKg: paramsCited['crop.winterWheat.piecesToKg'].Wert,
    thousandGrainWeight:
      paramsCited['crop.winterWheat.thousandGrainWeight'].Wert,
  },
  springWheatFodder: {
    restsHumusBuildingPotential: 0.1,
    rootProportion: paramsCited['crop.winterWheat.rootProportion'].Wert,
    nContentRoot: paramsCited['crop.winterWheat.nContentRoot'].Wert,
    supplySeed: paramsCited['crop.winterWheat.supplySeed'].Wert,
    dryMatterContent: paramsCited['crop.winterWheat.dryMatterContent'].Wert,
    dryMatterContentByproduct:
      paramsCited['crop.winterWheat.dryMatterContentByproduct'].Wert,
    MPBR: paramsCited['crop.winterWheat.MPBR'].Wert,
    nByproductFm: paramsCited['crop.winterWheat.nByproductFm'].Wert,
    p2o5ByproductFm: paramsCited['crop.winterWheat.p2o5ByproductFm'].Wert,
    k2oByproductFm: paramsCited['crop.winterWheat.k2oByproductFm'].Wert,
    humusMain: paramsCited['crop.winterWheat.humusMain'].Wert,
    piecesToKg: paramsCited['crop.winterWheat.piecesToKg'].Wert,
    thousandGrainWeight:
      paramsCited['crop.winterWheat.thousandGrainWeight'].Wert,
  },
  canola: {
    restsHumusBuildingPotential: 0.1,
    rootProportion: paramsCited['crop.canola.rootProportion'].Wert,
    nContentRoot: paramsCited['crop.canola.nContentRoot'].Wert,
    supplySeed: paramsCited['crop.canola.supplySeed'].Wert,
    dryMatterContent: paramsCited['crop.canola.dryMatterContent'].Wert,
    dryMatterContentByproduct:
      paramsCited['crop.canola.dryMatterContentByproduct'].Wert,
    MPBR: paramsCited['crop.canola.MPBR'].Wert,
    nByproductFm: 0.007,
    p2o5ByproductFm: paramsCited['crop.canola.p2o5ByproductFm'].Wert,
    k2oByproductFm: paramsCited['crop.canola.k2oByproductFm'].Wert,
    humusMain: paramsCited['crop.canola.humusMain'].Wert,
    piecesToKg: paramsCited['crop.canola.piecesToKg'].Wert,
    thousandGrainWeight: paramsCited['crop.canola.thousandGrainWeight'].Wert,
  },
  sugarBeet: {
    restsHumusBuildingPotential: 0.016,
    rootProportion: paramsCited['crop.sugarBeet.rootProportion'].Wert,
    nContentRoot: paramsCited['crop.sugarBeet.nContentRoot'].Wert,
    supplySeed: paramsCited['crop.sugarBeet.supplySeed'].Wert,
    dryMatterContent: paramsCited['crop.sugarBeet.dryMatterContent'].Wert,
    dryMatterContentByproduct:
      paramsCited['crop.sugarBeet.dryMatterContentByproduct'].Wert,
    MPBR: paramsCited['crop.sugarBeet.MPBR'].Wert,
    nByproductFm: paramsCited['crop.sugarBeet.nByproductFm'].Wert,
    p2o5ByproductFm: paramsCited['crop.sugarBeet.p2o5ByproductFm'].Wert,
    k2oByproductFm: paramsCited['crop.sugarBeet.k2oByproductFm'].Wert,
    humusMain: paramsCited['crop.sugarBeet.humusMain'].Wert,
    piecesToKg: paramsCited['crop.sugarBeet.piecesToKg'].Wert,
    thousandGrainWeight: paramsCited['crop.sugarBeet.thousandGrainWeight'].Wert,
  },
  // For winter barley, we just copy from winter wheat for now
  winterBarleyFodder: {
    restsHumusBuildingPotential: 0.1,
    rootProportion: paramsCited['crop.winterBarleyFodder.rootProportion'].Wert,
    nContentRoot: paramsCited['crop.winterBarleyFodder.nContentRoot'].Wert,
    supplySeed: paramsCited['crop.winterBarleyFodder.supplySeed'].Wert, // 0.684 says BEK, 2.14 says excel, TODO Ask Zaur
    dryMatterContent:
      paramsCited['crop.winterBarleyFodder.dryMatterContent'].Wert,
    dryMatterContentByproduct:
      paramsCited['crop.winterBarleyFodder.dryMatterContentByproduct'].Wert,
    MPBR: paramsCited['crop.winterBarleyFodder.MPBR'].Wert,
    nByproductFm: paramsCited['crop.winterBarleyFodder.nByproductFm'].Wert,
    p2o5ByproductFm:
      paramsCited['crop.winterBarleyFodder.p2o5ByproductFm'].Wert,
    k2oByproductFm: paramsCited['crop.winterBarleyFodder.k2oByproductFm'].Wert,
    humusMain: paramsCited['crop.winterBarleyFodder.humusMain'].Wert,
    piecesToKg: paramsCited['crop.winterBarleyFodder.piecesToKg'].Wert,
    thousandGrainWeight:
      paramsCited['crop.winterBarleyFodder.thousandGrainWeight'].Wert,
  },
  springBarleyMalting: {
    restsHumusBuildingPotential: 0.1,
    rootProportion: paramsCited['crop.springBarleyMalting.rootProportion'].Wert,
    nContentRoot: paramsCited['crop.springBarleyMalting.nContentRoot'].Wert,
    supplySeed: paramsCited['crop.springBarleyMalting.supplySeed'].Wert, // 0.684 says BEK, 2.14 says excel, TODO Ask Zaur
    dryMatterContent:
      paramsCited['crop.springBarleyMalting.dryMatterContent'].Wert,
    dryMatterContentByproduct:
      paramsCited['crop.springBarleyMalting.dryMatterContentByproduct'].Wert,
    MPBR: paramsCited['crop.springBarleyMalting.MPBR'].Wert,
    nByproductFm: paramsCited['crop.springBarleyMalting.nByproductFm'].Wert,
    p2o5ByproductFm:
      paramsCited['crop.springBarleyMalting.p2o5ByproductFm'].Wert,
    k2oByproductFm: paramsCited['crop.springBarleyMalting.k2oByproductFm'].Wert,
    humusMain: paramsCited['crop.springBarleyMalting.humusMain'].Wert,
    piecesToKg: paramsCited['crop.springBarleyMalting.piecesToKg'].Wert,
    thousandGrainWeight:
      paramsCited['crop.springBarleyMalting.thousandGrainWeight'].Wert,
  },
  springOatsFodder: {
    restsHumusBuildingPotential: 0.1,
    rootProportion: paramsCited['crop.springOatsFodder.rootProportion'].Wert,
    nContentRoot: paramsCited['crop.springOatsFodder.nContentRoot'].Wert,
    supplySeed: paramsCited['crop.springOatsFodder.supplySeed'].Wert, // 0.684 says BEK, 2.14 says excel, TODO Ask Zaur
    dryMatterContent:
      paramsCited['crop.springOatsFodder.dryMatterContent'].Wert,
    dryMatterContentByproduct:
      paramsCited['crop.springOatsFodder.dryMatterContentByproduct'].Wert,
    MPBR: paramsCited['crop.springOatsFodder.MPBR'].Wert,
    nByproductFm: paramsCited['crop.springOatsFodder.nByproductFm'].Wert,
    p2o5ByproductFm: paramsCited['crop.springOatsFodder.p2o5ByproductFm'].Wert,
    k2oByproductFm: paramsCited['crop.springOatsFodder.k2oByproductFm'].Wert,
    humusMain: paramsCited['crop.springOatsFodder.humusMain'].Wert,
    piecesToKg: paramsCited['crop.springOatsFodder.piecesToKg'].Wert,
    thousandGrainWeight:
      paramsCited['crop.springOatsFodder.thousandGrainWeight'].Wert,
  },
  winterRyeBaking: {
    restsHumusBuildingPotential: 0.1,
    rootProportion: paramsCited['crop.winterRyeBaking.rootProportion'].Wert,
    nContentRoot: paramsCited['crop.winterRyeBaking.nContentRoot'].Wert,
    supplySeed: paramsCited['crop.winterRyeBaking.supplySeed'].Wert, // 0.684 says BEK, 2.14 says excel, TODO Ask Zaur
    dryMatterContent: paramsCited['crop.winterRyeBaking.dryMatterContent'].Wert,
    dryMatterContentByproduct:
      paramsCited['crop.winterRyeBaking.dryMatterContentByproduct'].Wert,
    MPBR: paramsCited['crop.winterRyeBaking.MPBR'].Wert,
    nByproductFm: paramsCited['crop.winterRyeBaking.nByproductFm'].Wert,
    p2o5ByproductFm: paramsCited['crop.winterRyeBaking.p2o5ByproductFm'].Wert,
    k2oByproductFm: paramsCited['crop.winterRyeBaking.k2oByproductFm'].Wert,
    humusMain: paramsCited['crop.winterRyeBaking.humusMain'].Wert,
    piecesToKg: paramsCited['crop.winterRyeBaking.piecesToKg'].Wert,
    thousandGrainWeight:
      paramsCited['crop.winterRyeBaking.thousandGrainWeight'].Wert,
  },
  // 0 all, we have no values for now
  fieldGrassWiltedSilage: {
    restsHumusBuildingPotential: 0,
    rootProportion: 0,
    nContentRoot: 0,
    supplySeed: 0,
    dryMatterContent: 0,
    dryMatterContentByproduct: 0,
    MPBR: 0,
    nByproductFm: 0,
    p2o5ByproductFm: 0,
    k2oByproductFm: 0,
    humusMain: 0,
    piecesToKg: 1,
  },
  permanentGrasslandWiltedSilage: {
    restsHumusBuildingPotential: 0,
    rootProportion:
      paramsCited['crop.permanentGrasslandWiltedSilage.rootProportion'].Wert,
    nContentRoot:
      paramsCited['crop.permanentGrasslandWiltedSilage.nContentRoot'].Wert,
    supplySeed:
      paramsCited['crop.permanentGrasslandWiltedSilage.supplySeed'].Wert,
    dryMatterContent:
      paramsCited['crop.permanentGrasslandWiltedSilage.dryMatterContent'].Wert,
    dryMatterContentByproduct: 0, // no byproduct for wilted silage
    MPBR: 0, // no byproduct for wilted silage
    nByproductFm: 0, // no byproduct for wilted silage
    p2o5ByproductFm: 0, // no byproduct for wilted silage
    k2oByproductFm: 0, // no byproduct for wilted silage
    humusMain:
      paramsCited['crop.permanentGrasslandWiltedSilage.humusMain'].Wert,
    piecesToKg:
      paramsCited['crop.permanentGrasslandWiltedSilage.piecesToKg'].Wert,
  },
  potatoTableLate: {
    restsHumusBuildingPotential: 0.1,
    rootProportion: paramsCited['crop.potatoTableLate.rootProportion'].Wert,
    nContentRoot: paramsCited['crop.potatoTableLate.nContentRoot'].Wert,
    supplySeed: paramsCited['crop.potatoTableLate.supplySeed'].Wert,
    dryMatterContent: paramsCited['crop.potatoTableLate.dryMatterContent'].Wert,
    dryMatterContentByproduct:
      paramsCited['crop.potatoTableLate.dryMatterContentByproduct'].Wert,
    MPBR: paramsCited['crop.potatoTableLate.MPBR'].Wert,
    nByproductFm: paramsCited['crop.potatoTableLate.nByproductFm'].Wert,
    p2o5ByproductFm: paramsCited['crop.potatoTableLate.p2o5ByproductFm'].Wert,
    k2oByproductFm: paramsCited['crop.potatoTableLate.k2oByproductFm'].Wert,
    humusMain: paramsCited['crop.potatoTableLate.humusMain'].Wert,
    piecesToKg: paramsCited['crop.potatoTableLate.piecesToKg'].Wert,
    thousandGrainWeight: 1,
  },
  peasDry: {
    restsHumusBuildingPotential: 0,
    rootProportion: 0,
    nContentRoot: 0,
    supplySeed: 0,
    dryMatterContent: 0,
    dryMatterContentByproduct: 0,
    MPBR: 0,
    nByproductFm: 0,
    p2o5ByproductFm: 0,
    k2oByproductFm: 0,
    humusMain: 0,
    piecesToKg: 20, //seeding rate between 180 - 280, ktbl gives 10 U/ha, 10 U = 200 kg, U = 20
  },
  peasDryFodder: {
    restsHumusBuildingPotential: 0.016,
    rootProportion: paramsCited['crop.peasDryFodder.rootProportion'].Wert,
    nContentRoot: paramsCited['crop.peasDryFodder.nContentRoot'].Wert,
    supplySeed: paramsCited['crop.peasDryFodder.supplySeed'].Wert,
    dryMatterContent: paramsCited['crop.peasDryFodder.dryMatterContent'].Wert,
    dryMatterContentByproduct:
      paramsCited['crop.peasDryFodder.dryMatterContentByproduct'].Wert,
    MPBR: paramsCited['crop.peasDryFodder.MPBR'].Wert,
    nByproductFm: paramsCited['crop.peasDryFodder.nByproductFm'].Wert,
    p2o5ByproductFm: paramsCited['crop.peasDryFodder.p2o5ByproductFm'].Wert,
    k2oByproductFm: paramsCited['crop.peasDryFodder.k2oByproductFm'].Wert,
    humusMain: paramsCited['crop.peasDryFodder.humusMain'].Wert,
    piecesToKg: paramsCited['crop.peasDryFodder.piecesToKg'].Wert,
    //seeding rate between 180 - 280, ktbl gives 10 U/ha, 10 U = 200 kg, U = 20
  },
  triticaleFodder: {
    restsHumusBuildingPotential: 0.1,
    rootProportion: paramsCited['crop.triticaleFodder.rootProportion'].Wert,
    nContentRoot: paramsCited['crop.triticaleFodder.nContentRoot'].Wert,
    supplySeed: paramsCited['crop.triticaleFodder.supplySeed'].Wert,
    dryMatterContent: paramsCited['crop.triticaleFodder.dryMatterContent'].Wert,
    dryMatterContentByproduct:
      paramsCited['crop.triticaleFodder.dryMatterContentByproduct'].Wert,
    MPBR: paramsCited['crop.triticaleFodder.MPBR'].Wert,
    nByproductFm: paramsCited['crop.triticaleFodder.nByproductFm'].Wert,
    p2o5ByproductFm: paramsCited['crop.triticaleFodder.p2o5ByproductFm'].Wert,
    k2oByproductFm: paramsCited['crop.triticaleFodder.k2oByproductFm'].Wert,
    humusMain: paramsCited['crop.triticaleFodder.humusMain'].Wert,
    piecesToKg: paramsCited['crop.triticaleFodder.piecesToKg'].Wert,
  },
  broadBeans: {
    restsHumusBuildingPotential: 0.1,
    rootProportion: paramsCited['crop.broadBeans.rootProportion'].Wert,
    nContentRoot: paramsCited['crop.broadBeans.nContentRoot'].Wert,
    supplySeed: paramsCited['crop.broadBeans.supplySeed'].Wert,
    dryMatterContent: paramsCited['crop.broadBeans.dryMatterContent'].Wert,
    dryMatterContentByproduct:
      paramsCited['crop.broadBeans.dryMatterContentByproduct'].Wert,
    MPBR: paramsCited['crop.broadBeans.MPBR'].Wert,
    nByproductFm: paramsCited['crop.broadBeans.nByproductFm'].Wert,
    p2o5ByproductFm: paramsCited['crop.broadBeans.p2o5ByproductFm'].Wert,
    k2oByproductFm: paramsCited['crop.broadBeans.k2oByproductFm'].Wert,
    humusMain: paramsCited['crop.broadBeans.humusMain'].Wert,
    piecesToKg: paramsCited['crop.broadBeans.piecesToKg'].Wert,
  },
  sunflower: {
    restsHumusBuildingPotential: 0.1,
    rootProportion: paramsCited['crop.sunflower.rootProportion'].Wert,
    nContentRoot: paramsCited['crop.sunflower.nContentRoot'].Wert,
    supplySeed: paramsCited['crop.sunflower.supplySeed'].Wert,
    dryMatterContent: paramsCited['crop.sunflower.dryMatterContent'].Wert,
    dryMatterContentByproduct:
      paramsCited['crop.sunflower.dryMatterContentByproduct'].Wert,
    MPBR: paramsCited['crop.sunflower.MPBR'].Wert,
    nByproductFm: paramsCited['crop.sunflower.nByproductFm'].Wert,
    p2o5ByproductFm: paramsCited['crop.sunflower.p2o5ByproductFm'].Wert,
    k2oByproductFm: paramsCited['crop.sunflower.k2oByproductFm'].Wert,
    humusMain: paramsCited['crop.sunflower.humusMain'].Wert,
    piecesToKg: paramsCited['crop.sunflower.piecesToKg'].Wert,
    thousandGrainWeight: paramsCited['crop.sunflower.thousandGrainWeight'].Wert,
  },
  grassSeed: {
    restsHumusBuildingPotential: 0.1,
    rootProportion: 0,
    nContentRoot: 0,
    supplySeed: 0,
    dryMatterContent: 0,
    dryMatterContentByproduct: 0,
    MPBR: 0,
    nByproductFm: 0,
    p2o5ByproductFm: 0,
    k2oByproductFm: 0,
    humusMain: 0,
    piecesToKg: 1,
  },
  grainMaize: {
    restsHumusBuildingPotential: 0.1,
    rootProportion: paramsCited['crop.grainMaize.rootProportion'].Wert,
    nContentRoot: paramsCited['crop.grainMaize.nContentRoot'].Wert,
    supplySeed: paramsCited['crop.grainMaize.supplySeed'].Wert,
    dryMatterContent: paramsCited['crop.grainMaize.dryMatterContent'].Wert,
    dryMatterContentByproduct:
      paramsCited['crop.grainMaize.dryMatterContentByproduct'].Wert,
    MPBR: paramsCited['crop.grainMaize.MPBR'].Wert,
    nByproductFm: paramsCited['crop.grainMaize.nByproductFm'].Wert,
    p2o5ByproductFm: paramsCited['crop.grainMaize.p2o5ByproductFm'].Wert,
    k2oByproductFm: paramsCited['crop.grainMaize.k2oByproductFm'].Wert,
    humusMain: paramsCited['crop.grainMaize.humusMain'].Wert,
    piecesToKg: paramsCited['crop.silageMaize.piecesToKg'].Wert,
    thousandGrainWeight:
      paramsCited['crop.silageMaize.thousandGrainWeight'].Wert,
  },
  cerealRyeIntercrop: {
    restsHumusBuildingPotential: 0.012,
    rootProportion: paramsCited['crop.canola.rootProportion'].Wert,
    nContentRoot: paramsCited['crop.canola.nContentRoot'].Wert,
    supplySeed: paramsCited['crop.canola.supplySeed'].Wert,
    dryMatterContent: 0.1,
    dryMatterContentByproduct: 0.1,
    MPBR: 1,
    nByproductFm: 0.0035,
    p2o5ByproductFm: paramsCited['crop.canola.p2o5ByproductFm'].Wert,
    k2oByproductFm: paramsCited['crop.canola.k2oByproductFm'].Wert,
    humusMain: 140,
    piecesToKg: paramsCited['crop.canola.piecesToKg'].Wert,
    thousandGrainWeight: paramsCited['crop.canola.thousandGrainWeight'].Wert,
  },
  mustardIntercrop: {
    restsHumusBuildingPotential: 0.012,
    rootProportion: paramsCited['crop.canola.rootProportion'].Wert,
    nContentRoot: paramsCited['crop.canola.nContentRoot'].Wert,
    supplySeed: paramsCited['crop.canola.supplySeed'].Wert,
    dryMatterContent: 0.1,
    dryMatterContentByproduct: 0.1,
    MPBR: 1,
    nByproductFm: 0.0035,
    p2o5ByproductFm: paramsCited['crop.canola.p2o5ByproductFm'].Wert,
    k2oByproductFm: paramsCited['crop.canola.k2oByproductFm'].Wert,
    humusMain: 140,
    piecesToKg: paramsCited['crop.canola.piecesToKg'].Wert,
    thousandGrainWeight: paramsCited['crop.canola.thousandGrainWeight'].Wert,
  },
  phaceliaIntercrop: {
    restsHumusBuildingPotential: 0.016,
    rootProportion: paramsCited['crop.canola.rootProportion'].Wert,
    nContentRoot: paramsCited['crop.canola.nContentRoot'].Wert,
    supplySeed: paramsCited['crop.canola.supplySeed'].Wert,
    dryMatterContent: 0.1,
    dryMatterContentByproduct: 0.1,
    MPBR: 1,
    nByproductFm: 0.0035,
    p2o5ByproductFm: paramsCited['crop.canola.p2o5ByproductFm'].Wert,
    k2oByproductFm: paramsCited['crop.canola.k2oByproductFm'].Wert,
    humusMain: 250, // Or 170
    piecesToKg: paramsCited['crop.canola.piecesToKg'].Wert,
    thousandGrainWeight: paramsCited['crop.canola.thousandGrainWeight'].Wert,
  },
  persianCloverIntercrop: {
    restsHumusBuildingPotential: 0.016,
    rootProportion: paramsCited['crop.broadBeans.rootProportion'].Wert,
    nContentRoot: paramsCited['crop.broadBeans.nContentRoot'].Wert,
    supplySeed: paramsCited['crop.broadBeans.supplySeed'].Wert,
    dryMatterContent: 0.1,
    dryMatterContentByproduct: 0.1,
    MPBR: 1,
    nByproductFm: 0.0035,
    p2o5ByproductFm: paramsCited['crop.broadBeans.p2o5ByproductFm'].Wert,
    k2oByproductFm: paramsCited['crop.broadBeans.k2oByproductFm'].Wert,
    humusMain: 250, // Or 170
    piecesToKg: paramsCited['crop.broadBeans.piecesToKg'].Wert,
    thousandGrainWeight:
      paramsCited['crop.broadBeans.thousandGrainWeight'].Wert,
  },
  oilRadishIntercrop: {
    restsHumusBuildingPotential: 0.016,
    rootProportion: paramsCited['crop.canola.rootProportion'].Wert,
    nContentRoot: paramsCited['crop.canola.nContentRoot'].Wert,
    supplySeed: paramsCited['crop.canola.supplySeed'].Wert,
    dryMatterContent: 0.1,
    dryMatterContentByproduct: 0.1,
    MPBR: 1,
    nByproductFm: 0.0035,
    p2o5ByproductFm: paramsCited['crop.canola.p2o5ByproductFm'].Wert,
    k2oByproductFm: paramsCited['crop.canola.k2oByproductFm'].Wert,
    humusMain: 250, // Or 170
    piecesToKg: paramsCited['crop.canola.piecesToKg'].Wert,
    thousandGrainWeight: paramsCited['crop.canola.thousandGrainWeight'].Wert,
  },
  soybeanBeans: {
    restsHumusBuildingPotential: 0.1,
    rootProportion: paramsCited['crop.soybeanBeans.rootProportion'].Wert,
    nContentRoot: paramsCited['crop.soybeanBeans.nContentRoot'].Wert,
    supplySeed: paramsCited['crop.soybeanBeans.supplySeed'].Wert,
    dryMatterContent: paramsCited['crop.soybeanBeans.dryMatterContent'].Wert,
    dryMatterContentByproduct:
      paramsCited['crop.soybeanBeans.dryMatterContentByproduct'].Wert,
    MPBR: paramsCited['crop.soybeanBeans.MPBR'].Wert,
    nByproductFm: paramsCited['crop.soybeanBeans.nByproductFm'].Wert,
    p2o5ByproductFm: paramsCited['crop.soybeanBeans.p2o5ByproductFm'].Wert,
    k2oByproductFm: paramsCited['crop.soybeanBeans.k2oByproductFm'].Wert,
    humusMain: paramsCited['crop.soybeanBeans.humusMain'].Wert,
    piecesToKg: paramsCited['crop.soybeanBeans.piecesToKg'].Wert,
    thousandGrainWeight:
      paramsCited['crop.soybeanBeans.thousandGrainWeight'].Wert,
  },
  ryeWholePlantSilage: {
    restsHumusBuildingPotential: 0.1,
    rootProportion: paramsCited['crop.ryeWholePlantSilage.rootProportion'].Wert,
    nContentRoot: paramsCited['crop.ryeWholePlantSilage.nContentRoot'].Wert,
    supplySeed: paramsCited['crop.ryeWholePlantSilage.supplySeed'].Wert,
    dryMatterContent:
      paramsCited['crop.ryeWholePlantSilage.dryMatterContent'].Wert,
    dryMatterContentByproduct:
      paramsCited['crop.ryeWholePlantSilage.dryMatterContentByproduct'].Wert,
    MPBR: paramsCited['crop.ryeWholePlantSilage.MPBR'].Wert,
    nByproductFm: paramsCited['crop.ryeWholePlantSilage.nByproductFm'].Wert,
    p2o5ByproductFm:
      paramsCited['crop.ryeWholePlantSilage.p2o5ByproductFm'].Wert,
    k2oByproductFm: paramsCited['crop.ryeWholePlantSilage.k2oByproductFm'].Wert,
    humusMain: paramsCited['crop.ryeWholePlantSilage.humusMain'].Wert,
    piecesToKg: paramsCited['crop.ryeWholePlantSilage.piecesToKg'].Wert,
    thousandGrainWeight:
      paramsCited['crop.ryeWholePlantSilage.thousandGrainWeight'].Wert,
  },
  lupine: {
    restsHumusBuildingPotential: 0.16,
    rootProportion: paramsCited['crop.lupine.rootProportion'].Wert,
    nContentRoot: paramsCited['crop.lupine.nContentRoot'].Wert,
    supplySeed: paramsCited['crop.lupine.supplySeed'].Wert,
    dryMatterContent: paramsCited['crop.lupine.dryMatterContent'].Wert,
    dryMatterContentByproduct:
      paramsCited['crop.lupine.dryMatterContentByproduct'].Wert,
    MPBR: paramsCited['crop.lupine.MPBR'].Wert,
    nByproductFm: paramsCited['crop.lupine.nByproductFm'].Wert,
    p2o5ByproductFm: paramsCited['crop.lupine.p2o5ByproductFm'].Wert,
    k2oByproductFm: paramsCited['crop.lupine.k2oByproductFm'].Wert,
    humusMain: paramsCited['crop.lupine.humusMain'].Wert,
    piecesToKg: paramsCited['crop.lupine.piecesToKg'].Wert,
  },
  spelt: {
    restsHumusBuildingPotential: 0.1,
    rootProportion: paramsCited['crop.spelt.rootProportion'].Wert,
    nContentRoot: paramsCited['crop.spelt.nContentRoot'].Wert,
    supplySeed: paramsCited['crop.spelt.supplySeed'].Wert,
    dryMatterContent: paramsCited['crop.spelt.dryMatterContent'].Wert,
    dryMatterContentByproduct:
      paramsCited['crop.spelt.dryMatterContentByproduct'].Wert,
    MPBR: paramsCited['crop.spelt.MPBR'].Wert,
    nByproductFm: paramsCited['crop.spelt.nByproductFm'].Wert,
    p2o5ByproductFm: paramsCited['crop.spelt.p2o5ByproductFm'].Wert,
    k2oByproductFm: paramsCited['crop.spelt.k2oByproductFm'].Wert,
    humusMain: paramsCited['crop.spelt.humusMain'].Wert,
    piecesToKg: paramsCited['crop.spelt.piecesToKg'].Wert,
    thousandGrainWeight: paramsCited['crop.spelt.thousandGrainWeight'].Wert,
  },
  landscapeFeature: {
    restsHumusBuildingPotential: 0,
    rootProportion: 0,
    nContentRoot: 0,
    supplySeed: 0,
    dryMatterContent: 0,
    dryMatterContentByproduct: 0,
    MPBR: 0,
    nByproductFm: 0,
    p2o5ByproductFm: 0,
    k2oByproductFm: 0,
    humusMain: 0,
    piecesToKg: 1,
    thousandGrainWeight: 1,
  },
  // No plant, no parameters: an unknown crop carries the work that was
  // documented on the field, never a crop-specific calculation.
  unknownCrop: {
    restsHumusBuildingPotential: 0,
    rootProportion: 0,
    nContentRoot: 0,
    supplySeed: 0,
    dryMatterContent: 0,
    dryMatterContentByproduct: 0,
    MPBR: 0,
    nByproductFm: 0,
    p2o5ByproductFm: 0,
    k2oByproductFm: 0,
    humusMain: 0,
    piecesToKg: 1,
    thousandGrainWeight: 1,
  },
  nonProductiveArea: {
    restsHumusBuildingPotential: 0,
    rootProportion: 0,
    nContentRoot: 0,
    supplySeed: 0,
    dryMatterContent: 0,
    dryMatterContentByproduct: 0,
    MPBR: 0,
    nByproductFm: 0,
    p2o5ByproductFm: 0,
    k2oByproductFm: 0,
    humusMain: 0,
    piecesToKg: 1,
    thousandGrainWeight: 1,
  },
  alfalfa: {
    restsHumusBuildingPotential: 0.016,
    rootProportion: paramsCited['crop.broadBeans.rootProportion'].Wert,
    nContentRoot: paramsCited['crop.broadBeans.nContentRoot'].Wert,
    supplySeed: paramsCited['crop.broadBeans.supplySeed'].Wert,
    dryMatterContent:
      paramsCited['crop.permanentGrasslandWiltedSilage.dryMatterContent'].Wert,
    dryMatterContentByproduct: 0, // no byproduct for alfalfa
    MPBR: 0, // no byproduct for alfalfa
    nByproductFm: 0, // no byproduct for alfalfa
    p2o5ByproductFm: 0, // no byproduct for alfalfa
    k2oByproductFm: 0, // no byproduct for alfalfa
    humusMain: 250, // Or 170
    piecesToKg: paramsCited['crop.broadBeans.piecesToKg'].Wert,
    thousandGrainWeight: 2,
  },
};

/* Crops without model data have no carbon parameters, and per Serban they must
 * never produce a carbon number — reading any science field throws instead of
 * borrowing a related crop's value. Only thousandGrainWeight and piecesToKg are
 * real (from the Crop seed table): documentation needs them to convert seed
 * quantities, and that is not a carbon computation. */
const crop = { ...cropOwnParameters } as Record<
  SupportedCrops,
  SupportedCropsParameters
>;
for (const c of cropsWithoutModelDataSeed) {
  const documented = {
    thousandGrainWeight: c.thousandGrainWeight,
    piecesToKg: c.piecesToKg,
  };
  crop[c.name] = new Proxy(documented as SupportedCropsParameters, {
    get(target, field) {
      if (field in target) return target[field as keyof typeof target];
      throw new Error(
        `co2nserve parameters are not available for crop ${c.name} (${String(field)})`,
      );
    },
  });
}

// E') Intercrops
const intercrop: Record<
  Intercrop,
  { humusMain: number; MPBR: number; supplySeed: number }
> = {
  mustardIntercrop: {
    humusMain: 100, // for coverage over 90%
    MPBR: 0,
    supplySeed: 1, // mock data
  },
  /*oilRadishIntercrop: {
        humusMain: 100, // for coverage over 90%
        MPBR: 0,
        supplySeed: 1, // mock data
    },
    persianCloverIntercrop: {
        humusMain: 250, // for coverage over 90%
        MPBR: 0,
        supplySeed: 1, // mock data
    },
    phaceliaIntercrop: {
        humusMain: 170, // I only found for undersawn
        MPBR: 0,
        supplySeed: 1, // mock data
    },*/
};

// F) Organic fertilizer parameters

type OrganicFertilizerParameters = Record<
  OrganicFertilizerCategory,
  Partial<Partial<Record<IncorporationTime, number>>>
>;

const findOrganicFertilizerParameter = (
  category: OrganicFertilizerCategory,
  incorporationTime: IncorporationTime,
): number => {
  return orgFertParams[category]?.[incorporationTime] ?? 0.26;
};

// As convention, we will accept from now, because there is no 1-1 translation
// Mist = Manure [solid, Festmist, with bedding material]
// Gülle = Slurry [more liquid, with bedding material, with straws and hay !!! ]
// Jauche = Liquid manure [animal excreta, urine, and water and nothing else]
const orgFertParams: Partial<OrganicFertilizerParameters> = {
  horseManure: {
    noIncorporation:
      paramsCited['orgFertParams.horseManure.noIncorporation'].Wert,
    '1h': paramsCited['orgFertParams.horseManure.1h'].Wert,
    '4h': paramsCited['orgFertParams.horseManure.4h'].Wert,
    '8h': paramsCited['orgFertParams.horseManure.8h'].Wert,
  },

  cattleSolidManure: {
    noIncorporation:
      paramsCited['orgFertParams.cattleSolidManure.noIncorporation'].Wert,
    '1h': paramsCited['orgFertParams.cattleSolidManure.1h'].Wert,
    '4h': paramsCited['orgFertParams.cattleSolidManure.4h'].Wert,
    '8h': paramsCited['orgFertParams.cattleSolidManure.8h'].Wert,
  },

  pigSolidManure: {
    noIncorporation:
      paramsCited['orgFertParams.pigSolidManure.noIncorporation'].Wert,
    '1h': paramsCited['orgFertParams.pigSolidManure.1h'].Wert,
    '4h': paramsCited['orgFertParams.pigSolidManure.4h'].Wert,
    '8h': paramsCited['orgFertParams.pigSolidManure.8h'].Wert,
  },
  chickenSolidManure: {
    noIncorporation:
      paramsCited['orgFertParams.chickenSolidManure.noIncorporation'].Wert,
    '1h': paramsCited['orgFertParams.chickenSolidManure.1h'].Wert,
    '4h': paramsCited['orgFertParams.chickenSolidManure.4h'].Wert,
    '8h': paramsCited['orgFertParams.chickenSolidManure.8h'].Wert,
  },
  turkeySolidManure: {
    noIncorporation:
      paramsCited['orgFertParams.turkeySolidManure.noIncorporation'].Wert,
    '1h': paramsCited['orgFertParams.turkeySolidManure.1h'].Wert,
    '4h': paramsCited['orgFertParams.turkeySolidManure.4h'].Wert,
    '8h': paramsCited['orgFertParams.turkeySolidManure.8h'].Wert,
  },
  pigSlurry: {
    noIncorporation:
      paramsCited['orgFertParams.pigSlurry.noIncorporation'].Wert,
    '1h': paramsCited['orgFertParams.pigSlurry.1h'].Wert,
    '4h': paramsCited['orgFertParams.pigSlurry.4h'].Wert,
    '8h': paramsCited['orgFertParams.pigSlurry.8h'].Wert,
  },
  cattleSlurry: {
    noIncorporation:
      paramsCited['orgFertParams.cattleSlurry.noIncorporation'].Wert,
    '1h': paramsCited['orgFertParams.cattleSlurry.1h'].Wert,
    '4h': paramsCited['orgFertParams.cattleSlurry.4h'].Wert,
    '8h': paramsCited['orgFertParams.cattleSlurry.8h'].Wert,
  },
  pigLiquidManure: {
    noIncorporation:
      paramsCited['orgFertParams.pigLiquidManure.noIncorporation'].Wert,
    '1h': paramsCited['orgFertParams.pigLiquidManure.1h'].Wert,
    '4h': paramsCited['orgFertParams.pigLiquidManure.4h'].Wert,
    '8h': paramsCited['orgFertParams.pigLiquidManure.8h'].Wert,
  },
  cattleLiquidManure: {
    noIncorporation:
      paramsCited['orgFertParams.cattleLiquidManure.noIncorporation'].Wert,
    '1h': paramsCited['orgFertParams.cattleLiquidManure.1h'].Wert,
    '4h': paramsCited['orgFertParams.cattleLiquidManure.4h'].Wert,
    '8h': paramsCited['orgFertParams.cattleLiquidManure.8h'].Wert,
  },
};

// H) Pesticides parameters
const pesticides = {
  contentActiveIngredient: 0.35, // kg active ingredient / kg pesticide
};

const PARAMS_WITHOUT_YEAR = {
  cf,
  gwp,
  ef,
  nPerCHumus,
  crop,
  pesticides,
  orgFertParams,
  intercrop,
  findOrganicFertilizerParameter,
};

const yearParameters: Record<
  number,
  DeepPartial<typeof PARAMS_WITHOUT_YEAR>
> = {
  /* TEST DATA, comment not removed on purpose
  2025: {
    ef: {
      diesel: 1, //paramsCited["2025.ef.diesel"].Wert,
      machineManufacture: 0.2, //paramsCited["2025.ef.machineManufacture"].Wert,
    },
  },
  2024: {
    ef: {
      diesel: 0, //paramsCited["2024.ef.diesel"].Wert,
    },
  },*/
};

const PARAMS = {
  ...PARAMS_WITHOUT_YEAR,
  yearParameters,
};

export default PARAMS;
