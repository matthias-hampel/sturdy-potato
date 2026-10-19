// Ported from agmeo src/lib/co2calculator/tests/cropsCo2e/springBarleyMalting.test.ts (expected values from the BEK example sheets).
import { calculator } from '../calculator.js';
import type { Co2eInput } from '../types.js';

import PARAMS from '../parameters.js';
import {
  calculateK2OforNextCrop,
  calculateNforNextCrop,
  calculateP2O5forNextCrop,
} from '../residues.js';
import { excelParams } from './excel-params.js';

// Inputs from the Excel file
const WET_MASS_YIELD = 4.817;
const DRY_MASS_YIELD = 4.14362;
const BY_PRODUCT_WET = 3.3719;
const BY_PRODUCT_DRY =
  BY_PRODUCT_WET * PARAMS.crop.springBarleyMalting.dryMatterContentByproduct;

// Define Co2eInput object
const ex1: Co2eInput = {
  fieldData: {
    crop: 'springBarleyMalting',
    dryMassYield: DRY_MASS_YIELD,
    diesel: 124.46,
    pesticidesQuantity: 2.825,
    biodiesel: 0,
    nLastYear: 180,
    supplySeed: 102,
    humusBalance: -400,
    byProductWet: PARAMS.crop.springBarleyMalting.MPBR * WET_MASS_YIELD,
    byproductRemoved: 0,
    nForNextCrop: calculateNforNextCrop(
      BY_PRODUCT_WET,
      'springBarleyMalting',
      0,
    ),
    p2o5ForNextCrop: calculateP2O5forNextCrop(
      BY_PRODUCT_WET,
      'springBarleyMalting',
      0,
    ),
    k2oForNextCrop: calculateK2OforNextCrop(
      BY_PRODUCT_WET,
      'springBarleyMalting',
      0,
    ),
  },
  fieldMineralFertilizerData: [
    {
      '1': {
        fertilizerMineralType: 'NP',
        appliedUreaNHectare: 0,
        appliedUanNHectare: 0,
        appliedOthersMineralNHectare: 45.9,
        limeYearlyAverage: 200,
        p2o5Mineral: 3.9,
        k2oMineral: 0,
      },
    },
  ],
  fieldOrganicFertilizerData: [
    {
      '1': {
        organicFertilizerType: 'unknown',
        organicTechnology: 'trailing hose',
        incorporationTime: '4h',
        quantityFarmManure: 0,
        nFromOrganic: 0,
        p2o5Organic: 0,
        k2oOrganic: 0,
        nh3NProportion: 0,
        nEffectiveness: 0,
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
describe('springBarleyMalting', () => {
  describe('test 1', () => {
    test('Parameters and inputs', () => {
      expect(DRY_MASS_YIELD).toBeCloseTo(
        PARAMS.crop.springBarleyMalting.dryMatterContent * WET_MASS_YIELD,
        0,
      );
      expect(BY_PRODUCT_WET).toBeCloseTo(
        PARAMS.crop.springBarleyMalting.MPBR * WET_MASS_YIELD,
        0,
      );
      expect(DRY_MASS_YIELD + BY_PRODUCT_DRY).toBeCloseTo(7.04245);
    });
    test('parameters in comparison with winterBarleyFodder', () => {
      // The parameters for summerBarley are expected to be the same as for winterBarleyFodder
      const wBarley = PARAMS.crop.winterBarleyFodder;
      const sBarley = PARAMS.crop.springBarleyMalting;
      for (const key in wBarley) {
        if (key in sBarley) {
          expect(sBarley[key as keyof typeof sBarley]).toBeCloseTo(
            wBarley[key as keyof typeof wBarley] as number,
          );
        }
      }
    });

    test('PF1 to PF13', () => {
      expect(pf1).toBe(0);
      expect(pf2).toBeCloseTo(7.64);
      expect(pf3).toBe(0);
      expect(pf4).toBeCloseTo(233.93);
      expect(pf5a).toBeCloseTo(110.5494, 1);
      expect(pf5b).toBeCloseTo(85.93);
      expect(pf6).toBeCloseTo(91.74);
      expect(pf7).toBe(0);
      expect(pf8a).toBeCloseTo(158);
      expect(pf8b).toBe(0);
      expect(pf9).toBeCloseTo(1468);
      expect(pf10).toBeCloseTo(185.33);
      expect(pf11a).toBe(0);
      expect(pf12).toBe(0);
      expect(pf13).toBe(0);
    });

    test('PF total', () => {
      expect(sumPf).toBeCloseTo(2341.12, 1);
    });

    test('PB1 to PB7', () => {
      expect(pb1a).toBeCloseTo(161.57);
      expect(pb1b).toBeCloseTo(2.11);
      expect(pb1c).toBe(0);
      expect(excelParams.ef?.supplyCao).toBe(0.02);
      expect(pb1d).toBe(4);
      expect(pb2a).toBeCloseTo(61.2);
      expect(pb2b).toBe(0);
      expect(pb2c).toBe(0);
      [pb3aa, pb3ab, pb3ac, pb3ba, pb3bb, pb3bc].forEach((pb3) => {
        expect(pb3).toBe(0);
      });
      expect(pb4).toBeCloseTo(218.28);
      expect(pb5).toBeCloseTo(10.97);
      expect(pb6a).toBeCloseTo(374.62);
      expect(pb6b).toBe(0);
      expect(pb7).toBeCloseTo(110.77);
    });

    test('PB total', () => {
      expect(sumPb).toBeCloseTo(943.51, 0);
    });

    test('PN1 to PN2', () => {
      expect(pn1a).toBeCloseTo(-1237.487);
      expect(pn1b).toBe(0);
      expect(pn2a).toBeCloseTo(-57.32);
      expect(pn2b).toBeCloseTo(-5.462);
      expect(ex1.fieldData.k2oForNextCrop).toBeCloseTo(57.322);
      expect(pn2c).toBeCloseTo(-24.075);
    });

    test('PN total', () => {
      expect(sumPn).toBeCloseTo(-1324.347);
    });

    test('Total', () => {
      expect(sumPf + sumPb + sumPn).toBeCloseTo(1960.29, 0);
    });
  });
});
