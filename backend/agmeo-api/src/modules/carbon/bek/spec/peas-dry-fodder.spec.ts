// Ported from agmeo src/lib/co2calculator/tests/cropsCo2e/peasDryFodder.test.ts (expected values from the BEK example sheets).
import { calculator } from '../calculator.js';
import type { Co2eInput } from '../types.js';

import PARAMS from '../parameters.js';
import {
  calculateK2OforNextCrop,
  calculateNforNextCrop,
  calculateP2O5forNextCrop,
} from '../residues.js';
import { excelParams } from './excel-params.js';

const WET_MASS_YIELD = 3.85;
const DRY_MASS_YIELD = 3.301;

const BY_PRODUCT_WET = 3.85;
const BY_PRODUCT_DRY =
  BY_PRODUCT_WET * PARAMS.crop.peasDryFodder.dryMatterContentByproduct;

const ex1: Co2eInput = {
  fieldData: {
    crop: 'peasDryFodder',
    dryMassYield: DRY_MASS_YIELD,
    diesel: 0,
    pesticidesQuantity: 2.4,
    biodiesel: 0,
    nLastYear: 0, // It is 10% in the excel
    supplySeed: 224,
    humusBalance: PARAMS.crop.peasDryFodder.humusMain,
    byProductWet: PARAMS.crop.peasDryFodder.MPBR * WET_MASS_YIELD,
    byproductRemoved: 0,
    nForNextCrop:
      (calculateNforNextCrop(BY_PRODUCT_WET, 'peasDryFodder', 0) *
        // we have it as double in our parameters
        (excelParams.crop?.peasDryFodder?.nByproductFm ??
          PARAMS.crop.peasDryFodder.nByproductFm)) /
      PARAMS.crop.peasDryFodder.nByproductFm,
    p2o5ForNextCrop:
      (calculateP2O5forNextCrop(BY_PRODUCT_WET, 'peasDryFodder', 0) *
        (excelParams.crop?.peasDryFodder?.p2o5ByproductFm ??
          PARAMS.crop.peasDryFodder.p2o5ByproductFm)) /
      PARAMS.crop.peasDryFodder.p2o5ByproductFm,

    k2oForNextCrop:
      (calculateK2OforNextCrop(BY_PRODUCT_WET, 'peasDryFodder', 0) *
        (excelParams.crop?.peasDryFodder?.k2oByproductFm ??
          PARAMS.crop.peasDryFodder.k2oByproductFm)) /
      PARAMS.crop.peasDryFodder.k2oByproductFm,
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
        appliedOthersMineralNHectare: 0.5, // referring to mineral non-urea non-uan
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

// Jest test cases
describe('peasDryFodder', () => {
  describe('test 1', () => {
    test('peasDryFodder parameters', () => {
      expect(DRY_MASS_YIELD).toBeCloseTo(
        (excelParams.crop?.peasDryFodder?.dryMatterContent ??
          PARAMS.crop.peasDryFodder.dryMatterContent) * WET_MASS_YIELD,
        0,
      );
      expect(BY_PRODUCT_WET).toBeCloseTo(
        PARAMS.crop.peasDryFodder.MPBR * WET_MASS_YIELD,
        0,
      );
      expect(DRY_MASS_YIELD + BY_PRODUCT_DRY).toBeCloseTo(6.612, 0); //C152
    });
  });

  test('PF1 to PF13', () => {
    // Keep this as model debug
    console.log(
      JSON.stringify(report.details.filter((d) => d.emissionSource === 'pf1')),
      2,
    );

    expect(pf1).toBeCloseTo(0);
    expect(pf2).toBeCloseTo(0.08);
    expect(pf3).toBeCloseTo(0);
    expect(pf4).toBeCloseTo(2.55);
    expect(pf5a).toBeCloseTo(51.22);
    expect(pf5b).toBeCloseTo(0);
    expect(pf6).toBeCloseTo(0);
    expect(pf7).toBe(0);
    expect(pf8a).toBe(0);
    expect(pf8b).toBe(0);
    expect(pf9).toBe(-587.2);
    expect(pf10).toBeCloseTo(0);
    expect(pf11a).toBe(0);
    expect(pf12).toBe(0);
    expect(pf13).toBe(0);
  });

  test('PF total', () => {
    expect(sumPf).toBeCloseTo(-533.34, 0);
  });

  test('PB1 to PB7', () => {
    expect(pb1a).toBeCloseTo(1.76);
    expect(pb1b).toBe(0);
    expect(pb1c).toBe(0);
    expect(pb1d).toBe(0);
    expect(pb2a).toBeCloseTo(0);
    expect(pb2b).toBe(0);
    expect(pb2c).toBe(0);
    [pb3aa, pb3ab, pb3ac, pb3ba, pb3bb, pb3bc].forEach((pb3) => {
      expect(pb3).toBe(0);
    });
    expect(pb4).toBeCloseTo(69.57);
    expect(pb5).toBeCloseTo(9.32);
    expect(pb6a).toBeCloseTo(0);
    expect(pb6b).toBe(0);
    expect(pb7).toBeCloseTo(0);
  });

  test('PB total', () => {
    expect(sumPb).toBeCloseTo(80.65, 0);
  });

  describe('PN1 to PN2', () => {
    test('PN1 to PN2', () => {
      expect(pn1a).toBeCloseTo(-226, 0);
      expect(pn1b).toBeCloseTo(0); // We use always 0 in the calculator for this one

      const ex2 = {
        ...ex1,
        fieldData: {
          ...ex1.fieldData,

          nForNextCrop: calculateNforNextCrop(
            BY_PRODUCT_WET,
            'peasDryFodder',
            0,
          ),
        },
      };
      const { pn2a: pn2aOriginal } = calculator(ex2).byId;
      expect(pn2aOriginal).not.toBeCloseTo(pn2a, 0);
      expect(pn2b).toBeCloseTo(-6.26, 0);
      expect(pn2c).toBeCloseTo(0, 0);
    });
  });
  test('PN total', () => {
    // Can not because we do not use nebenProdukt in the calculator
  });
});
