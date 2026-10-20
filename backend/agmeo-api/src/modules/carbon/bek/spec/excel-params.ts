/** Parameter values of the BEK example sheets the crop tests were checked against (agmeo tests/cropsCo2e/utils/excelParams.ts). */
import type PARAMS from '../parameters.js';
import type { DeepPartial } from '../types.js';

export const excelParams: DeepPartial<typeof PARAMS> = {
  gwp: { n2o: 265 },
  ef: {
    diesel: 3.01,
    machineManufacture: 0.89,
    supplyK2O: 0.42,
    supplyP2O5: 0.54,
    nPrevious: 3.4,
    supplyNOrganic: 3.4,
    supplyCao: 0.02, // vs 0.02 in our parameters
    cao: 0.79, // it is 0.786 in our parameters
    appliedN: {
      np: 0.04, // 0.041 in our parameters
    },
  },
  nPerCHumus: 0.090909,
  crop: {
    silageMaize: { supplySeed: 2.14 },
    sugarBeet: { supplySeed: 2.14 },
    winterWheat: { nByproductFm: 0.005 },
    canola: { nContentRoot: 0.007, supplySeed: 2.14 },
    winterBarleyFodder: {
      supplySeed: 2.14, // it is 0.68 in our parameters
    },
    springBarleyMalting: {
      supplySeed: 2.14, // it is 0.68 in our parameters
    },
    springOatsFodder: {
      nContentRoot: 0.009, // it is 0.008 in our parameters
      supplySeed: 2.14, // it is 0.68 in our parameters
    },
    winterRyeBaking: {
      supplySeed: 2.14, // it is 0.68 in our parameters
      // Also ask for nContentRoot
    },
    sunflower: {
      dryMatterContent: 0.915,
      nByproductFm: 0.005,
      p2o5ByproductFm: 0.003,
      k2oByproductFm: 0.017,
      supplySeed: 0.3106,
    },
    triticaleFodder: {
      //nByproductFm: 0, // D65 in the excel from BAT, I modified it
      supplySeed: 0.3121, // Same story
    },
    peasDryFodder: {
      nByproductFm: 0, // Apparently it is 0 in the excel
      supplySeed: 0.3106,
      k2oByproductFm: 0,
    },
  },
};
