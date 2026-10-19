// Ported from agmeo src/lib/co2calculator/tests/cropsCo2e/winterBarleyFodder.test.ts (expected values from the BEK example sheets).
import { calculator } from '../calculator.js';
import type { Co2eInput } from '../types.js';

import PARAMS from '../parameters.js';
import {
  calculateK2OforNextCrop,
  calculateNforNextCrop,
  calculateP2O5forNextCrop,
} from '../residues.js';
import { excelParams } from './excel-params.js';

const wetMassYield = 10.5;
const dryMassYield = 9.13;

const byProductWet = 0.735 + 6.615;
const byProductDry =
  byProductWet * PARAMS.crop.winterBarleyFodder.dryMatterContentByproduct;

test('winterBarley parameters', () => {
  expect(dryMassYield).toBeCloseTo(
    // 9.13 in excel vs 9.03 our calculations
    PARAMS.crop.winterBarleyFodder.dryMatterContent * wetMassYield,
    0,
  );
  expect(byProductWet).toBeCloseTo(
    PARAMS.crop.winterBarleyFodder.MPBR * wetMassYield,
    0,
  );
  expect(dryMassYield + byProductDry).toBeCloseTo(15.522, 0);
});

const ex1: Co2eInput = {
  fieldData: {
    crop: 'winterBarleyFodder',
    dryMassYield: 9.13,
    diesel: 124.46,
    pesticidesQuantity: 8.85,
    biodiesel: 0,
    nLastYear: 190,
    supplySeed: 67,
    humusBalance: -400,
    byProductWet: PARAMS.crop.winterBarleyFodder.MPBR * wetMassYield,
    byproductRemoved: 0.9,
    nForNextCrop: calculateNforNextCrop(
      byProductWet,
      'winterBarleyFodder',
      0.9,
    ),
    p2o5ForNextCrop: calculateP2O5forNextCrop(
      byProductWet,
      'winterBarleyFodder',
      0.9,
    ),
    k2oForNextCrop: calculateK2OforNextCrop(
      byProductWet,
      'winterBarleyFodder',
      0.9,
    ),
  },
  fieldOrganicFertilizerData: [
    {
      '1': {
        organicFertilizerType: 'unknown', // Go to E57, see the value, then go to constants and choose the fertilizer type, the technology and the incorporation time from E26-E27
        organicTechnology: 'trailing hose',
        incorporationTime: '4h', // E26 - E27
        quantityFarmManure: 7.4,
        nFromOrganic: 5.5,
        p2o5Organic: 3.56,
        k2oOrganic: 4,
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
        appliedOthersMineralNHectare: 124.2, // referring to mineral non-urea non-uan
        limeYearlyAverage: 0, // kg CaO/ha
        p2o5Mineral: 0, // kg/ha
        k2oMineral: 0,
      },
    },
  ],
};

describe('WinterBarley', () =>
  test('T1', () => {
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
    //console.log(report.details);
    expect(pf1).toBeCloseTo(20.25);
    expect(pf2).toBeCloseTo(20.67);
    expect(pf3).toBeCloseTo(97.49);
    expect(pf4).toBeCloseTo(633);

    //There is some variation, this test accounts for it
    expect(PARAMS.crop['winterBarleyFodder'].rootProportion).toBe(0.22);
    expect(PARAMS.crop.winterBarleyFodder.nContentRoot).toBe(0.014);
    expect(pf5a).toBeGreaterThan(242);
    expect(pf5a).toBeLessThan(244);

    //There is some variation, this test accounts for it
    expect(PARAMS.crop['winterBarleyFodder'].nByproductFm).toBeCloseTo(0.005);
    expect(pf5b).toBeGreaterThan(18);
    expect(pf5b).toBeLessThan(20);
    expect(pf6).toBeCloseTo(96.84);
    expect(pf7).toBe(0);
    expect(pf8a).toBe(0);
    expect(pf8b).toBe(0);
    expect(pf9).toBeCloseTo(1468);
    expect(pf10).toBeCloseTo(185.33);
    expect(pf11a).toBe(0);
    expect(pf12).toBe(0);
    expect(pf13).toBe(0);

    // expect the sum to be around 1256
    const sumPf = Object.keys(report.byId)
      .filter((key) => key.startsWith('pf'))
      .reduce(
        (acc, key) => acc + report.byId[key as keyof typeof report.byId],
        0,
      );
    expect(sumPf).toBeCloseTo(2785.01, -0.75);

    expect(pb1a).toBeCloseTo(437.18);
    expect(pb1b).toBe(0);
    expect(pb1c).toBe(0);
    expect(pb1d).toBe(0);
    expect(pb2a).toBeCloseTo(129.64);
    expect(pb2b).toBeCloseTo(14.23);
    expect(pb2c).toBeCloseTo(12.43);

    for (const pb3 of [pb3aa, pb3ab, pb3ac, pb3ba, pb3bb, pb3bc]) {
      expect(pb3).toBe(0);
    }
    expect(excelParams.crop?.winterBarleyFodder?.supplySeed).toBe(2.14); // modified, it is 0.685 from BEK
    expect(pb4).toBeCloseTo(143.38);
    expect(pb5).toBeCloseTo(34.35);
    expect(pb6a).toBeCloseTo(374.62);
    expect(pb6b).toBe(0);
    expect(pb7).toBeCloseTo(110.77);

    // expect the sum to be around 1256.61
    const sumPb = Object.keys(report.byId)
      .filter((key) => key.startsWith('pb'))
      .reduce(
        (acc, key) => acc + report.byId[key as keyof typeof report.byId],
        0,
      );
    expect(sumPb).toBeCloseTo(1256.61, 0);

    expect(pn1a).toBeCloseTo(-284.792, -1.5);
    // expect(pn1b).toBeCloseTo(-2442.75, -2); // this is hardcoded with 0 for now

    //nForNextCrop
    expect(PARAMS.crop.winterBarleyFodder.nByproductFm).toBeCloseTo(0.005);
    expect(ex1.fieldData.nForNextCrop).toBeCloseTo(3.88, 0);
    expect(excelParams.ef?.nPrevious).toBe(3.4);
    expect(3.88 * 3.4).toBeCloseTo(13.192);
    expect(pn2a).toBeCloseTo(-13.192, -0.5);

    //p2o5ForNextCrop
    expect(PARAMS.crop.winterBarleyFodder.p2o5ByproductFm).toBeCloseTo(0.003);
    expect(ex1.fieldData.p2o5ForNextCrop).toBeCloseTo(2.328, 0);
    expect(pn2b).toBeCloseTo(-1.2571, 0);

    //k2oForNextCrop
    expect(PARAMS.crop.winterBarleyFodder.k2oByproductFm).toBeCloseTo(0.014);
    expect(ex1.fieldData.k2oForNextCrop).toBeCloseTo(13.192, -0.5);
    expect(pn2c).toBeCloseTo(-5.5406, 0);

    // Sum pn should be around -1261.55
    const sumPn = Object.keys(report.byId)
      .filter((key) => key.startsWith('pn'))
      .reduce(
        (acc, key) => acc + report.byId[key as keyof typeof report.byId],
        0,
      );

    // -305 vs -288
    expect(sumPn - pn1b).toBeCloseTo(-305, -1.6);

    // The total should be around 3736
    expect(sumPf + sumPb + sumPn - pn1b).toBeCloseTo(3736, -1.6);

    // Use the following code to debug if needed
    // console.log(
    //     JSON.stringify(
    //         report.details.filter(
    //             (detail) => detail.inputName === "nForNextCrop",
    //         ),
    //         null,
    //         2,
    //     ),
    // );
  }));
