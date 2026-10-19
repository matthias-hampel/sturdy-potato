// Ported from agmeo src/lib/co2calculator/tests/cropsCo2e/winterRyeBaking.test.ts (expected values from the BEK example sheets).
import { calculator } from '../calculator.js';
import type { Co2eInput } from '../types.js';

import PARAMS from '../parameters.js';
import {
  calculateK2OforNextCrop,
  calculateNforNextCrop,
  calculateP2O5forNextCrop,
} from '../residues.js';
import { excelParams } from './excel-params.js';

const WET_MASS_YIELD = 7.05;
const DRY_MASS_YIELD = 6.063;

const BY_PRODUCT_WET = 6.345;
const BY_PRODUCT_DRY =
  BY_PRODUCT_WET * PARAMS.crop.winterRyeBaking.dryMatterContentByproduct;

const BYPRODUCT_TOTAL = 11.5197; // C152

const ex1: Co2eInput = {
  fieldData: {
    crop: 'winterRyeBaking',
    dryMassYield: DRY_MASS_YIELD,
    diesel: 124.46,
    pesticidesQuantity: 7.85,
    biodiesel: 0,
    nLastYear: 100,
    supplySeed: 65,
    humusBalance: PARAMS.crop.winterRyeBaking.humusMain,
    byProductWet: PARAMS.crop.winterRyeBaking.MPBR * WET_MASS_YIELD,
    byproductRemoved: 0,
    nForNextCrop: calculateNforNextCrop(BY_PRODUCT_WET, 'winterRyeBaking', 0),
    p2o5ForNextCrop: calculateP2O5forNextCrop(
      BY_PRODUCT_WET,
      'winterRyeBaking',
      0,
    ),
    k2oForNextCrop: calculateK2OforNextCrop(
      BY_PRODUCT_WET,
      'winterRyeBaking',
      0,
    ),
  },
  fieldOrganicFertilizerData: [
    {
      '1': {
        organicFertilizerType: 'unknown', // Go to E57, see the value, then go to constants and choose the fertilizer type, the technology and the incorporation time from E26-E27
        organicTechnology: 'trailing hose',
        incorporationTime: '1h', // E26 - E27
        quantityFarmManure: 0,
        nFromOrganic: 0,
        p2o5Organic: 0,
        k2oOrganic: 0,
        nh3NProportion: 46, // E112 Total Ammoniacal Nitrogen Proportion [TAN] -
        nEffectiveness: 47, // D61  Mineraldüngerwirksamkeit des ausgebrachten Wirtschaftdünger-N
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
        appliedOthersMineralNHectare: 135, // referring to mineral non-urea non-uan
        limeYearlyAverage: 0, // kg CaO/ha
        p2o5Mineral: 0, // kg/ha
        k2oMineral: 148,
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
describe('winterRyeBaking', () => {
  describe('test 1', () => {
    test('winterRyeBaking parameters', () => {
      expect(DRY_MASS_YIELD).toBeCloseTo(
        PARAMS.crop.winterRyeBaking.dryMatterContent * WET_MASS_YIELD,
      );
      expect(BY_PRODUCT_WET).toBeCloseTo(
        PARAMS.crop.winterRyeBaking.MPBR * WET_MASS_YIELD,
        0,
      );
      expect(DRY_MASS_YIELD + BY_PRODUCT_DRY).toBeCloseTo(BYPRODUCT_TOTAL); //C152
    });
  });

  test('PF1 to PF13', () => {
    expect(pf1).toBe(0);
    expect(pf2).toBeCloseTo(22.4667);
    expect(pf3).toBe(0);
    expect(pf4).toBeCloseTo(688.04269);
    expect(pf5a).toBeCloseTo(116.24867);
    expect(pf5b).toBeCloseTo(161.69);
    expect(pf6).toBeCloseTo(50.96613);
    expect(pf7).toBe(0);
    expect(pf8a).toBe(0);
    expect(pf8b).toBe(0);
    expect(pf9).toBe(1468);
    expect(pf10).toBeCloseTo(185.33);
    expect(pf11a).toBe(0);
    expect(pf12).toBe(0);
    expect(pf13).toBe(0);
  });

  test('PF total', () => {
    expect(sumPf).toBeCloseTo(2_692.74557);
  });

  test('PB1 to PB7', () => {
    expect(pb1a).toBeCloseTo(475.2);
    expect(pb1b).toBe(0);
    expect(pb1c).toBe(62.16);
    expect(pb1d).toBe(0);
    expect(pb2a).toBeCloseTo(34);
    expect(pb2b).toBe(0);
    expect(pb2c).toBe(0);
    [pb3aa, pb3ab, pb3ac, pb3ba, pb3bb, pb3bc].forEach((pb3) => {
      expect(pb3).toBe(0);
    });
    expect(pb4).toBeCloseTo(139.1);
    expect(pb5).toBeCloseTo(30.47);
    expect(pb6a).toBeCloseTo(374.62);
    expect(pb6b).toBe(0);
    expect(pb7).toBeCloseTo(110.77);
  });

  test('PB total', () => {
    expect(sumPb).toBeCloseTo(1_226.323775);
  });

  test('PN1 to PN2', () => {
    expect(pn1a).toBeCloseTo(-2_328.615);
    expect(pn1b).toBe(0);
    expect(pn2a).toBeCloseTo(-107.865);
    expect(pn2b).toBeCloseTo(-10.2789);
    expect(ex1.fieldData.k2oForNextCrop).toBeCloseTo(126.9);
    expect(pn2c).toBeCloseTo(-53.298);
  });

  test('PN total', () => {
    expect(sumPn).toBeCloseTo(-2_500.0569);
  });

  test('Total', () => {
    expect(sumPf + sumPb + sumPn).toBeCloseTo(1_419.01244779);
  });

  // dryMassYield.and.byproductQuantity
  // console.log(
  //     JSON.stringify(
  //         report.details.filter(
  //             (detail) =>
  //                 detail.inputName === "dryMassYield.and.byproductQuantity",
  //         ),
  //         null,
  //         2,
  //     ),
  // );
});
