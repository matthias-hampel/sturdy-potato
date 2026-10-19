// Ported from agmeo src/lib/co2calculator/tests/cropsCo2e/triticaleFodder.test.ts (expected values from the BEK example sheets).
import { calculator } from '../calculator.js';
import type { Co2eInput } from '../types.js';

import PARAMS from '../parameters.js';
import {
  calculateK2OforNextCrop,
  calculateNforNextCrop,
  calculateP2O5forNextCrop,
} from '../residues.js';
import { excelParams } from './excel-params.js';

const WET_MASS_YIELD = 4.5;
const DRY_MASS_YIELD = 3.881;

const BY_PRODUCT_WET = 2.673 + 1.377;
const BY_PRODUCT_DRY =
  BY_PRODUCT_WET * PARAMS.crop.triticaleFodder.dryMatterContentByproduct;

// It was always 3.01, now it's 3.41 in the excel
// I can't modify it there because I mess up the other tests
if (excelParams.ef) {
  excelParams.ef.diesel = 3.41;
}

const ex1: Co2eInput = {
  fieldData: {
    crop: 'triticaleFodder',
    dryMassYield: DRY_MASS_YIELD,
    diesel: 103,
    pesticidesQuantity: 1.8,
    biodiesel: 0,
    nLastYear: 13 * 10, // It is 10% in the excel
    supplySeed: 142,
    humusBalance: PARAMS.crop.triticaleFodder.humusMain,
    byProductWet: PARAMS.crop.triticaleFodder.MPBR * WET_MASS_YIELD,
    byproductRemoved: 2.673 / (2.673 + 1.377),
    nForNextCrop:
      (calculateNforNextCrop(
        BY_PRODUCT_WET,
        'triticaleFodder',
        2.673 / (2.673 + 1.377),
      ) *
        // we have it as double in our parameters
        (excelParams.crop?.triticaleFodder?.nByproductFm ??
          PARAMS.crop.triticaleFodder.nByproductFm)) /
      PARAMS.crop.triticaleFodder.nByproductFm,
    p2o5ForNextCrop:
      (calculateP2O5forNextCrop(
        BY_PRODUCT_WET,
        'triticaleFodder',
        2.673 / (2.673 + 1.377),
      ) *
        (excelParams.crop?.triticaleFodder?.p2o5ByproductFm ??
          PARAMS.crop.triticaleFodder.p2o5ByproductFm)) /
      PARAMS.crop.triticaleFodder.p2o5ByproductFm,

    k2oForNextCrop:
      (calculateK2OforNextCrop(
        BY_PRODUCT_WET,
        'triticaleFodder',
        2.673 / (2.673 + 1.377),
      ) *
        (excelParams.crop?.triticaleFodder?.k2oByproductFm ??
          PARAMS.crop.triticaleFodder.k2oByproductFm)) /
      PARAMS.crop.triticaleFodder.k2oByproductFm,
  },
  fieldOrganicFertilizerData: [
    {
      '1': {
        organicFertilizerType: 'unknown', // Go to E57, see the value, then go to constants and choose the fertilizer type, the technology and the incorporation time from E26-E27
        organicTechnology: 'trailing hose',
        incorporationTime: '4h', // E26 - E27
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
        fertilizerMineralType: 'NP', // Look at D59, where urea: 0.128, ureaWithInhibitor: 0.038, canAndOthersN: 0.01, NP: 0.04, ahl: 0.081, others: 0.01,
        appliedUreaNHectare: 0,
        appliedUanNHectare: 0,
        appliedOthersMineralNHectare: 130, // referring to mineral non-urea non-uan
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

console.log(report.byId);

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

// Jest test cases
describe('triticaleFodder', () => {
  describe('test 1', () => {
    test('triticaleFodder parameters', () => {
      expect(DRY_MASS_YIELD).toBeCloseTo(
        (excelParams.crop?.triticaleFodder?.dryMatterContent ??
          PARAMS.crop.triticaleFodder.dryMatterContent) * WET_MASS_YIELD,
        0,
      );
      expect(BY_PRODUCT_WET).toBeCloseTo(
        PARAMS.crop.triticaleFodder.MPBR * WET_MASS_YIELD,
        0,
      );
      expect(DRY_MASS_YIELD + BY_PRODUCT_DRY).toBeCloseTo(7.364, 0); //C152
    });
  });

  test('PF1 to PF13', () => {
    // Keep this as model debug
    console.log(
      JSON.stringify(report.details.filter((d) => d.emissionSource === 'pf1')),
      2,
    );

    expect(pf1).toBeCloseTo(0);
    expect(pf2).toBeCloseTo(21.63);
    expect(pf3).toBeCloseTo(0);
    expect(pf4).toBeCloseTo(662.56);
    expect(pf5a).toBeCloseTo(74.31);
    expect(pf5b).toBeCloseTo(35.09);
    expect(pf6).toBeCloseTo(66.26);
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
    expect(sumPf).toBeCloseTo(2513.19, 0);
  });

  test('PB1 to PB7', () => {
    expect(pb1a).toBeCloseTo(457.6);
    expect(pb1b).toBe(0);
    expect(pb1c).toBe(0);
    expect(pb1d).toBe(0);
    expect(pb2a).toBeCloseTo(44.2);
    expect(pb2b).toBe(0);
    expect(pb2c).toBe(0);
    [pb3aa, pb3ab, pb3ac, pb3ba, pb3bb, pb3bc].forEach((pb3) => {
      expect(pb3).toBe(0);
    });
    expect(pb4).toBeCloseTo(44.32);
    expect(pb5).toBeCloseTo(6.99);
    expect(pb6a).toBeCloseTo(351.23);
    expect(pb6b).toBe(0);
    expect(pb7).toBeCloseTo(91.67);
  });

  test('PB total', () => {
    expect(sumPb).toBeCloseTo(996, 0);
  });

  describe('PN1 to PN2', () => {
    test('PN1 to PN2', () => {
      expect(pn1a).toBeCloseTo(-505, 0);
      expect(pn1b).toBeCloseTo(0); // We use always 0 in the calculator for this one
      expect(pn2a).toBeCloseTo(-23, 0);
      console.log(
        report.details.filter((d) => d.emissionSource === 'pn2b'),
        2,
      );
      expect(pn2b).toBeCloseTo(-2, 0);
      expect(pn2c).toBeCloseTo(-10, 0);
    });
  });

  test('PN total', () => {
    // Can not because we do not use nebenProdukt in the calculator
  });

  test('Total', () => {
    // expect(sumPf + sumPb + sumPn).toBeCloseTo(1952.43, 0);
  });
});
