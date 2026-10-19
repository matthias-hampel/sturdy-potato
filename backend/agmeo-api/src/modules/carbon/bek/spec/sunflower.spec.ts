// Ported from agmeo src/lib/co2calculator/tests/cropsCo2e/sunflower.test.ts (expected values from the BEK example sheets).
import { calculator } from '../calculator.js';
import type { Co2eInput } from '../types.js';

import PARAMS from '../parameters.js';
import {
  calculateK2OforNextCrop,
  calculateNforNextCrop,
  calculateP2O5forNextCrop,
} from '../residues.js';
import { excelParams } from './excel-params.js';

const WET_MASS_YIELD = 2.72;
const DRY_MASS_YIELD = 2.489;

const BY_PRODUCT_WET = 5.44;
const BY_PRODUCT_DRY =
  BY_PRODUCT_WET * PARAMS.crop.sunflower.dryMatterContentByproduct;

const ex1: Co2eInput = {
  fieldData: {
    crop: 'sunflower',
    dryMassYield: DRY_MASS_YIELD,
    diesel: 0,
    pesticidesQuantity: 6.1,
    biodiesel: 0,
    nLastYear: 0,
    supplySeed: 102,
    humusBalance: -400,
    byProductWet: PARAMS.crop.sunflower.MPBR * WET_MASS_YIELD,
    byproductRemoved: 0,
    nForNextCrop:
      (calculateNforNextCrop(BY_PRODUCT_WET, 'sunflower', 0) *
        // we have it as double in our parameters
        (excelParams.crop?.sunflower?.nByproductFm ??
          PARAMS.crop.sunflower.nByproductFm)) /
      PARAMS.crop.sunflower.nByproductFm,
    p2o5ForNextCrop:
      (calculateP2O5forNextCrop(BY_PRODUCT_WET, 'sunflower', 0) *
        (excelParams.crop?.sunflower?.p2o5ByproductFm ??
          PARAMS.crop.sunflower.p2o5ByproductFm)) /
      PARAMS.crop.sunflower.p2o5ByproductFm,

    k2oForNextCrop:
      (calculateK2OforNextCrop(BY_PRODUCT_WET, 'sunflower', 0) *
        (excelParams.crop?.sunflower?.k2oByproductFm ??
          PARAMS.crop.sunflower.k2oByproductFm)) /
      PARAMS.crop.sunflower.k2oByproductFm,
  },
  fieldOrganicFertilizerData: [
    {
      '1': {
        organicFertilizerType: 'unknown', // Go to E57, see the value, then go to constants and choose the fertilizer type, the technology and the incorporation time from E26-E27
        organicTechnology: 'trailing hose',
        incorporationTime: '4h', // E26 - E27
        quantityFarmManure: 1,
        nFromOrganic: 2,
        p2o5Organic: 4.38,
        k2oOrganic: 6,
        nh3NProportion: 46, // E112 Total Ammoniacal Nitrogen Proportion [TAN] -
        nEffectiveness: 30, // D61  Mineraldüngerwirksamkeit des ausgebrachten Wirtschaftdünger-N
      },
    },
  ],
  fieldMineralFertilizerData: [
    {
      '1': {
        // Mineral fertilizer parameters
        fertilizerMineralType: 'NP', // Look at D59, where urea: 0.128, ureaWithInhibitor: 0.038, canAndOthersN: 0.01, NP: 0.04, ahl: 0.081, others: 0.01,
        appliedUreaNHectare: 0,
        appliedUanNHectare: 0,
        appliedOthersMineralNHectare: 0.1, // referring to mineral non-urea non-uan
        limeYearlyAverage: 0, // kg CaO/ha
        p2o5Mineral: 0, // kg/ha
        k2oMineral: 0,
      },
    },
  ],
};
// Run the calculator and destructure report results
const report = calculator(ex1, excelParams);
const {
  pf1,
  pf2,
  pf3,
  pf4,
  pf5a,
  pf5b,
  pf6,
  pf7,
  pf8a,
  pf8b,
  pf9,
  pf10,
  pf11a,
  pf12,
  pf13,
  pb1a,
  pb1b,
  pb1c,
  pb1d,
  pb2a,
  pb2b,
  pb2c,
  pb3aa,
  pb3ab,
  pb3ac,
  pb3ba,
  pb3bb,
  pb3bc,
  pb4,
  pb5,
  pb6a,
  pb6b,
  pb7,
  pn1a,
  pn1b,
  pn2a,
  pn2b,
  pn2c,
} = report.byId;

// Function to sum values based on prefix
const sumValues = (prefix: string) =>
  Object.keys(report.byId)
    .filter((key) => key.startsWith(prefix))
    .reduce(
      (acc, key) => acc + report.byId[key as keyof typeof report.byId],
      0,
    );

const sumPf = sumValues('pf');
const sumPb = sumValues('pb');
const sumPn = sumValues('pn');

// Jest test cases
describe('sunflower', () => {
  describe('test 1', () => {
    test('sunflower parameters', () => {
      expect(DRY_MASS_YIELD).toBeCloseTo(
        (excelParams.crop?.sunflower?.dryMatterContent ??
          PARAMS.crop.sunflower.dryMatterContent) * WET_MASS_YIELD,
      );
      expect(BY_PRODUCT_WET).toBeCloseTo(
        PARAMS.crop.sunflower.MPBR * WET_MASS_YIELD,
        0,
      );
      expect(DRY_MASS_YIELD + BY_PRODUCT_DRY).toBeCloseTo(7.167, 0); //C152
    });
  });

  test('PF1 to PF13', () => {
    // Keep this as model debug
    console.log(
      JSON.stringify(report.details.filter((d) => d.emissionSource === 'pf1')),
      2,
    );
    expect(pf1).toBeCloseTo(0.9, 0.5);
    expect(pf2).toBeCloseTo(0.02);
    expect(pf3).toBeCloseTo(2.75, 0);
    expect(pf4).toBeCloseTo(0.51);
    expect(pf5a).toBeCloseTo(72.33);
    expect(pf5b).toBeCloseTo(138.63);
    expect(pf6).toBe(0);
    expect(pf7).toBe(0);
    expect(pf8a).toBe(0);
    expect(pf8b).toBe(0);
    expect(pf9).toBe(1468);
    expect(pf10).toBeCloseTo(185.3314);
    expect(pf11a).toBe(0);
    expect(pf12).toBe(0);
    expect(pf13).toBe(0);
  });

  test('PF total', () => {
    expect(sumPf).toBeCloseTo(1868.46, -1);
  });

  test('PB1 to PB7', () => {
    expect(pb1a).toBeCloseTo(0.35);
    expect(pb1b).toBe(0);
    expect(pb1c).toBe(0);
    expect(pb1d).toBe(0);
    expect(pb2a).toBeCloseTo(1.84, 0);
    expect(pb2b).toBeCloseTo(2.38, 1);
    expect(pb2c).toBeCloseTo(2.48, 1);
    [pb3aa, pb3ab, pb3ac, pb3ba, pb3bb, pb3bc].forEach((pb3) => {
      expect(pb3).toBe(0);
    });
    expect(pb4).toBeCloseTo(31.68);
    expect(pb5).toBeCloseTo(23.68);
    expect(pb6a).toBeCloseTo(0);
    expect(pb6b).toBe(0);
    expect(pb7).toBeCloseTo(0);
  });

  test('PB total', () => {
    expect(sumPb).toBeCloseTo(62.41, 0);
  });

  test('PN1 to PN2', () => {
    expect(pn1a).toBeCloseTo(-1996.48);
    expect(pn1b).toBe(0);

    expect(pn2a).toBeCloseTo(-92.48);
    expect(pn2b).toBeCloseTo(-8.877806, -0.5);

    expect(excelParams.crop?.sunflower?.k2oByproductFm).toBeCloseTo(0.017);
    expect(ex1.fieldData.k2oForNextCrop).toBeCloseTo(92.48);
    expect(pn2c).toBeCloseTo(-38.1942, -1);
  });

  test('PN total', () => {
    expect(sumPn).toBeCloseTo(-2136.032, -0.1);
  });

  test('Total', () => {
    expect(sumPf + sumPb + sumPn).toBeCloseTo(-205.17, 0);
  });
});
