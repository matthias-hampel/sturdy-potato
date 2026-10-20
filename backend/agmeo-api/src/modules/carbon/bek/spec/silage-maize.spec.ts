// Ported from agmeo src/lib/co2calculator/tests/cropsCo2e/silageMaize.test.ts (expected values from the BEK example sheets).
import { calculator } from '../calculator.js';
import type { Co2eInput } from '../types.js';
import { emptyCo2eInput } from '../empty.js';

import { excelParams } from './excel-params.js';

const silageMaizeT1: Co2eInput = {
  fieldData: {
    crop: 'silageMaize',
    dryMassYield: 9.91, //
    byProductWet: 8.2 / 1000,
    byproductRemoved: 0,
    nLastYear: 0,
    humusBalance: -800,
    supplySeed: 28.5,
    pesticidesQuantity: 3.125,
    diesel: 124.46,
    biodiesel: 0,
    nForNextCrop: 0,
    p2o5ForNextCrop: 0,
    k2oForNextCrop: 0,
  },
  fieldOrganicFertilizerData: [
    {
      '1': {
        organicFertilizerType: 'unknown',
        organicTechnology: 'broadcast',
        incorporationTime: '4h',
        quantityFarmManure: 16.2,
        nFromOrganic: 8.5,
        p2o5Organic: 2.2,
        k2oOrganic: 7.6,
        nh3NProportion: 46,
        nEffectiveness: 60,
      },
    },
  ],
  fieldMineralFertilizerData: [
    {
      '1': {
        // Mineral fertilizer parameters
        fertilizerMineralType: 'NPK',
        appliedUreaNHectare: 0,
        appliedUanNHectare: 0,
        appliedOthersMineralNHectare: 13, // referring to mineral non-urea non-uan
        limeYearlyAverage: 0, // kg CaO/ha
        p2o5Mineral: 11, // kg/ha
        k2oMineral: 16,
      },
    },
  ],
};

describe('Silage Maize', () => {
  test('Dummy report', () => {
    const maizeDummyTemplate = structuredClone(emptyCo2eInput);
    maizeDummyTemplate.fieldData.crop = 'silageMaize';
    const dummyReport = calculator(emptyCo2eInput);
    expect(dummyReport.total).toBe(0);
  });

  test('T1', () => {
    const report = calculator(silageMaizeT1, excelParams);

    expect(report.byId.pf1).toBeCloseTo(68.52);
    expect(report.byId.pf2).toBeCloseTo(2.16);
    expect(report.byId.pf3).toBeCloseTo(421.08);
    expect(report.byId.pf4).toBeCloseTo(66.26);
    expect(report.byId.pf5a).toBeCloseTo(77.85, -1);
    expect(report.byId.pf5b).toBeCloseTo(0);
    expect(report.byId.pf6).toBeCloseTo(0);
    expect(report.byId.pf7).toBeCloseTo(0);
    expect(report.byId.pf8a).toBeCloseTo(0);
    expect(report.byId.pf8b).toBeCloseTo(0);
    expect(report.byId.pf9).toBeCloseTo(2936);
    expect(report.byId.pf10).toBeCloseTo(370.66);
    expect(report.byId.pf11a).toBeCloseTo(0);
    expect(report.byId.pf12).toBeCloseTo(0);
    expect(report.byId.pf13).toBeCloseTo(0);

    expect(report.byId.pb1a).toBeCloseTo(45.76);
    expect(report.byId.pb1b).toBeCloseTo(5.94);
    expect(report.byId.pb1c).toBeCloseTo(6.72);
    expect(report.byId.pb1d).toBeCloseTo(0);
    expect(report.byId.pb2a).toBeCloseTo(280.91);
    expect(report.byId.pb2b).toBeCloseTo(19.25);
    expect(report.byId.pb2c).toBeCloseTo(51.71);
    expect(report.byId.pb3aa).toBeCloseTo(0);
    expect(report.byId.pb3ab).toBeCloseTo(0);
    expect(report.byId.pb3ba).toBeCloseTo(0);
    expect(report.byId.pb4).toBeCloseTo(60.99);
    expect(report.byId.pb5).toBeCloseTo(12.13);
    expect(report.byId.pb6a).toBeCloseTo(374.62);
    expect(report.byId.pb6b).toBeCloseTo(0);
    expect(report.byId.pb7).toBeCloseTo(110.77);
    expect(report.byId.pn1a).toBeCloseTo(0); // In the excel is 41, might be a typo, add -2 to the final result
    expect(report.byId.pn1b).toBeCloseTo(0);
    expect(report.byId.pn2a).toBeCloseTo(0);
    expect(report.byId.pn2b).toBeCloseTo(0);
    expect(report.byId.pn2c).toBeCloseTo(0);

    const sumPf = Object.keys(report.byId)
      .filter((key) => key.startsWith('pf'))
      .reduce(
        (acc, key) => acc + report.byId[key as keyof typeof report.byId],
        0,
      );
    expect(sumPf).toBeCloseTo(3_942.46, 1); // still got a problem with FM and DM yield

    const sumPb = Object.keys(report.byId)
      .filter((key) => key.startsWith('pb'))
      .reduce(
        (acc, key) => acc + report.byId[key as keyof typeof report.byId],
        0,
      );
    expect(sumPb).toBeCloseTo(968.8);

    const sumPn = Object.keys(report.byId)
      .filter((key) => key.startsWith('pn'))
      .reduce(
        (acc, key) => acc + report.byId[key as keyof typeof report.byId],
        0,
      );
    expect(sumPn).toBe(0);

    expect(report.total).toBeCloseTo(4911.26, 0); // Because of decimals, the errors add, 0 means Expected difference: < 0.5
  });
});
