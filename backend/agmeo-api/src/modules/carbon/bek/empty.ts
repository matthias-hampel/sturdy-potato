/** Empty calculator input and report (agmeo src/lib/co2calculator/src/utils/co2Empty{Input,Report}.ts). */
import type { Co2eInput, Co2eReport } from './types.js';

export const emptyCo2eInput: Co2eInput = {
  fieldData: {
    crop: 'winterWheat',
    dryMassYield: 0, // E13 in ton/ha
    byProductWet: 0,
    byproductRemoved: 0,
    nLastYear: 0,
    humusBalance: 0, //D67
    supplySeed: 0,
    pesticidesQuantity: 0,
    diesel: 0,
    biodiesel: 0,
    nForNextCrop: 0,
    p2o5ForNextCrop: 0,
    k2oForNextCrop: 0,
  },
  fieldOrganicFertilizerData: [
    {
      '1': {
        organicFertilizerType: 'unknown', // Go to E57, see the value, then go to constants and choose the fertilizer type, the technology and the incorporation time from E26-E27
        organicTechnology: 'broadcast',
        incorporationTime: 'noIncorporation', // E26 - E27
        quantityFarmManure: 0,
        nFromOrganic: 0,
        p2o5Organic: 0,
        k2oOrganic: 0,
        nh3NProportion: 0, // E112 Total Ammoniacal Nitrogen Proportion [TAN] -
        nEffectiveness: 0, // D61  Mineraldüngerwirksamkeit des ausgebrachten Wirtschaftdünger-N
      },
    },
  ],
  fieldMineralFertilizerData: [
    {
      '1': {
        // Mineral fertilizer parameters
        fertilizerMineralType: '', // Look at D59, where urea: 0.128, ureaWithInhibitor: 0.038, canAndOthersN: 0.01, NP: 0.04, ahl: 0.081, others: 0.01,
        appliedUreaNHectare: 0,
        appliedUanNHectare: 0,
        appliedOthersMineralNHectare: 0, // referring to mineral non-urea non-uan
        limeYearlyAverage: 0, // kg CaO/ha
        p2o5Mineral: 0, // kg/ha
        k2oMineral: 0,
      },
    },
  ],
};

export const emptyCo2eReport: Co2eReport = {
  byId: {
    pf1: 0,
    pf2: 0,
    pf3: 0,
    pf4: 0,
    pf5a: 0,
    pf5b: 0,
    pf6: 0,
    pf7: 0,
    pf8a: 0,
    pf8b: 0,
    pf9: 0,
    pf10: 0,
    pf11a: 0,
    pf12: 0,
    pf13: 0,
    pb1a: 0,
    pb1b: 0,
    pb1c: 0,
    pb1d: 0,
    pb2a: 0,
    pb2b: 0,
    pb2c: 0,
    pb3aa: 0,
    pb3ab: 0,
    pb3ac: 0,
    pb3ba: 0,
    pb3bb: 0,
    pb3bc: 0,
    pb4: 0,
    pb5: 0,
    pb6a: 0,
    pb6b: 0,
    pb7: 0,
    pn1a: 0,
    pn1b: 0,
    pn2a: 0,
    pn2b: 0,
    pn2c: 0,
  },
  byEmissionSource: {
    DIRECT_AND_INDIRECT_EMISSIONS_FROM_THE_FIELD: {
      fqn: 'DIRECT_AND_INDIRECT_EMISSIONS_FROM_THE_FIELD',
      order: 1,
      displayName:
        'Direct and indirect greenhouse gas emissions from the field',
      co2e: 0,
      details: [],
    },
    UPSTREAM_EMISSIONS_FROM_OPERATING_RESOURCES: {
      fqn: 'UPSTREAM_EMISSIONS_FROM_OPERATING_RESOURCES',
      order: 2,
      displayName:
        'Upstream greenhouse gas emissions from the use of operating resources',
      co2e: 0,
      details: [],
    },
    GREENHOUSE_GAS_CREDITS_FOR_BY_CROP_PRODUCTS: {
      fqn: 'GREENHOUSE_GAS_CREDITS_FOR_BY_CROP_PRODUCTS',
      order: 3,
      displayName: 'Greenhouse gas credits for by-crop products',
      co2e: 0,
      details: [],
    },
  },
  byManagement: {
    byProduct: {
      mineral: {},
      organic: {},
      pesticides: {},
    },
    byOperationCategory: {
      tillage: 0,
      sowing: 0,
      harvesting: 0,
      transport: 0,
      irrigation: 0,
    },
  },
  details: [],
  total: 0,
};
