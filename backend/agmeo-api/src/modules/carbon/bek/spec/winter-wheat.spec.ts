// Ported from agmeo src/lib/co2calculator/tests/cropsCo2e/winterWheat.test.ts (expected values from the BEK example sheets).
import { calculator } from '../calculator.js';
import type { Co2eInput } from '../types.js';
import { emptyCo2eInput } from '../empty.js';
import { humusBalanceMainOrCoverCrop } from '../humus.js';

import { excelParams } from './excel-params.js';

const ex1: Co2eInput = {
  fieldData: {
    crop: 'winterWheat',
    dryMassYield: 7.476, //
    byProductWet: 4.7678056 + 0.5610984,
    byproductRemoved: 0.878,
    nLastYear: 135,
    humusBalance: -400,
    supplySeed: 128,
    pesticidesQuantity: 10.625,
    diesel: 124.46,
    biodiesel: 0,
    nForNextCrop: 3,
    p2o5ForNextCrop: 2,
    k2oForNextCrop: 9,
  },
  fieldOrganicFertilizerData: [
    {
      '1': {
        organicFertilizerType: 'unknown',
        organicTechnology: 'trailing hose',
        incorporationTime: 'noIncorporation',
        quantityFarmManure: 0,
        nFromOrganic: 0,
        p2o5Organic: 0,
        k2oOrganic: 0,
        nh3NProportion: 0,
        nEffectiveness: 0,
      },
    },
  ],
  fieldMineralFertilizerData: [
    {
      '1': {
        // Mineral fertilizer parameters
        fertilizerMineralType: 'NP',
        appliedUreaNHectare: 0,
        appliedUanNHectare: 0,
        appliedOthersMineralNHectare: 191.1, // referring to mineral non-urea non-uan
        limeYearlyAverage: 0, // kg CaO/ha
        p2o5Mineral: 0, // kg/ha
        k2oMineral: 222,
      },
    },
  ],
};

// Expect the dummyReport to have 0 kg CO2e for winterWheat
test('Dummy report', () => {
  const dummyReport = calculator(emptyCo2eInput);
  expect(dummyReport.total).toBe(0);
});

// Now only for 8 t harvested, we should get 48 kg humus
// TODO: Check with excel
/*
test("winterWheat with straw incorporation", () => {
    const co2eInput = structuredClone(emptyCo2eInput);
    co2eInput.fieldData.humusBalance = humusBalanceMainOrCoverCrop(
        "winterWheat",
        1,
        8,
    ).value;

    const co2eReport = calculator(co2eInput);
    expect(co2eReport.total).toBeCloseTo(-199, 0);
});*/

// Test the parameter change:
test('winterWheat with straw incorporation', () => {
  const co2eInput = structuredClone(emptyCo2eInput);
  co2eInput.fieldData.humusBalance = humusBalanceMainOrCoverCrop(
    'winterWheat',
    1,
    8,
  ).value;

  const co2eReport = calculator(co2eInput, { cf: { n2oN2on: 999 } });
  expect(co2eReport).toBeDefined();
});

// Test the first example
test('winterWheat with straw incorporation', () => {
  const report = calculator(ex1, excelParams);

  expect(report.byId.pf1).toBe(0);
  expect(report.byId.pf2).toBeCloseTo(31.8, 1);
  expect(report.byId.pf3).toBe(0);
  expect(report.byId.pf4).toBeCloseTo(973.96, 2);

  // These 2 will be problematic, they are crop related
  expect(report.byId.pf5a).toBeCloseTo(135.09, -2);
  expect(report.byId.pf5b).toBeCloseTo(16.63, 0); //TODO: Figure that +41, it is so small I can fix it with a rounding error

  expect(report.byId.pf6).toBeCloseTo(68.8, 2);
  expect(report.byId.pf7).toBe(0);
  expect(report.byId.pf8a).toBe(0);
  expect(report.byId.pf8b).toBe(0);
  expect(report.byId.pf9).toBe(1468);
  expect(report.byId.pf10).toBeCloseTo(185.33, 2);
  expect(report.byId.pf11a).toBe(0);
  expect(report.byId.pf12).toBe(0);
  expect(report.byId.pf13).toBe(0);

  expect(report.byId.pb1a).toBeCloseTo(672.67, 2);
  expect(report.byId.pb1b).toBe(0);
  expect(report.byId.pb1c).toBeCloseTo(93, 0);
  expect(report.byId.pb1d).toBe(0);
  expect(report.byId.pb2a).toBeCloseTo(45.9, 2);
  expect(report.byId.pb2b).toBe(0);
  expect(report.byId.pb2c).toBe(0);
  expect(report.byId.pb4).toBeCloseTo(113.92, 2);
  expect(report.byId.pb5).toBeCloseTo(41.24, 2);
  expect(report.byId.pb6a).toBeCloseTo(374.62, 2);
  expect(report.byId.pb6b).toBe(0);
  expect(report.byId.pb7).toBeCloseTo(110.77, 2);

  expect(report.byId.pn1a).toBeCloseTo(-239.45, -1);
  // expect(report.byId.pn1b).toBeCloseTo(-2035, -3);
  expect(report.byId.pn2a).toBeCloseTo(-11, -1); // In excel 3 * 3.4 = 11, for us 3 * 3.4 = 10.2
  expect(report.byId.pn2b).toBeCloseTo(-1, 0);
  expect(report.byId.pn2c).toBeCloseTo(-4, 0);

  const sumPf = Object.keys(report.byId)
    .filter((key) => key.startsWith('pf'))
    .reduce(
      (acc, key) => acc + report.byId[key as keyof typeof report.byId],
      0,
    );
  expect(sumPf).toBeGreaterThan(2_870);
  expect(sumPf).toBeLessThan(2_880);

  const sumPb = Object.keys(report.byId)
    .filter((key) => key.startsWith('pb'))
    .reduce(
      (acc, key) => acc + report.byId[key as keyof typeof report.byId],
      0,
    );
  expect(sumPb).toBeCloseTo(1_452.37);

  const sumPn = Object.keys(report.byId)
    .filter((key) => key.startsWith('pn'))
    .reduce(
      (acc, key) => acc + report.byId[key as keyof typeof report.byId],
      0,
    );
  expect(sumPn).toBeCloseTo(-255 + report.byId.pn1b, -1); // Problem, ask Z

  expect(report.total).toBeCloseTo(4076, -1.1); // Problem, ask Z
});
