// Ported from agmeo src/lib/co2calculator/tests/cropsCo2e/canola.test.ts (expected values from the BEK example sheets).
import { calculator } from '../calculator.js';
import type { Co2eInput } from '../types.js';
import { emptyCo2eInput } from '../empty.js';
import { humusBalanceMainOrCoverCrop } from '../humus.js';

import { excelParams } from './excel-params.js';

const canolaParameters = {
  All_K20_FM: 0.1,
  All_P205_FM: 2.48,
  Alles_N_FM: 4.54,
  Alles_P_FM: 1.07,
  Cover: 'Empty',
  DM_mainproduct: 91,
  DM_minorproduct: 86,
  Humus_effect_HP: -400,
  Humus_effect_NP: 7,
  Ntobetakenintoaccount: -10,
  Prim_K20_FM: 0.1,
  Prim_N_FM: 3.35,
  Prim_P205_FM: 1.8,
  Prim_P_FM: 0.78,
  ProductionSystem: 'conventional',
  Proteinlevel: 23,
  Season: 'Main crop',
  Sek_K20_FM: 0.1,
  Sek_N_FM: 0.7,
  Sek_P205_FM: 0.4,
  Sek_P_FM: 0.17,
  Type: 'canola', // Winter rapeseed
  Usage: 'Oil crops',
  VHN: 1.7,
  nr: 93,
  root_DM_n: 0.008,
  root_prop: 0.22,
};

const byProductWet = 4.5625 * (canolaParameters?.VHN || 0) + 0.041;

const ex1: Co2eInput = {
  fieldData: {
    crop: 'canola',
    dryMassYield: 4.5631,
    byProductWet,
    byproductRemoved: 0,
    nLastYear: 280,
    humusBalance: humusBalanceMainOrCoverCrop('canola', 1, 0).value, // For some reason, in the excel is no yield calculated for humus
    supplySeed: 2.3,
    pesticidesQuantity: 14.27,
    diesel: 124.46,
    biodiesel: 0,
    nForNextCrop: byProductWet * 10 * (canolaParameters?.Sek_N_FM || 0), // formula is in dt
    p2o5ForNextCrop: byProductWet * 10 * (canolaParameters?.Sek_P205_FM || 0),
    k2oForNextCrop: byProductWet * 1000 * 0.0235, // Our value is 0.1 / dt, the one from excel is 0.0235 / kg
  },
  fieldOrganicFertilizerData: [
    {
      '1': {
        organicFertilizerType: 'unknown',
        organicTechnology: 'broadcast',
        incorporationTime: '4h',
        quantityFarmManure: 11.1,
        nFromOrganic: 5.2,
        p2o5Organic: 3.6,
        k2oOrganic: 3.9,
        nh3NProportion: 46,
        nEffectiveness: 47,
      },
    },
  ],
  fieldMineralFertilizerData: [
    {
      '1': {
        // Mineral fertilizer parameters
        fertilizerMineralType: 'NP',
        appliedUreaNHectare: 80.6,
        appliedUanNHectare: 0,
        appliedOthersMineralNHectare: 42, // referring to mineral non-urea non-uan
        limeYearlyAverage: 0, // kg CaO/ha
        p2o5Mineral: 0.8, // kg/ha
        k2oMineral: 1.2,
      },
    },
  ],
};

describe('Canola', () => {
  test('Dummy report', () => {
    const canolaDummyTemplate = structuredClone(emptyCo2eInput);
    canolaDummyTemplate.fieldData.crop = 'canola';
    const dummyReport = calculator(canolaDummyTemplate, excelParams);
    expect(dummyReport.total).toBe(0);
  });
  test('T1', () => {
    const report = calculator(ex1, excelParams);
    // pf2/pf4 and dependent sums (sumPf, total) updated in commit 79ca1752e (PR #1436, TMC-99):
    // pf2 (NH3-N2O) and pf4 (direct N2O) now sum applied UREA + UAN + others mineral N,
    // not just "others". IPCC EF1 applies to ALL synthetic N regardless of form.
    // Prior values: pf2≈6.99, pf4=214.06, sumPf=2677.33, total=740.15.
    expect(report.byId.pf1).toBeCloseTo(28.72);
    expect(report.byId.pf2).toBeCloseTo(20.4);
    expect(report.byId.pf3).toBeCloseTo(138.26);
    expect(report.byId.pf4).toBeCloseTo(624.84);
    expect(report.byId.pf5a).toBeCloseTo(88.5479, 0);
    expect(report.byId.pf5b).toBeCloseTo(278.1769);
    expect(report.byId.pf6).toBeCloseTo(142.7052);
    expect(report.byId.pf7).toBe(0);
    expect(report.byId.pf8a).toBe(0);
    expect(report.byId.pf8b).toBeCloseTo(126.54);
    expect(report.byId.pf9).toBeCloseTo(1468);
    expect(report.byId.pf10).toBeCloseTo(185.33);
    expect(report.byId.pf11a).toBe(0);
    expect(report.byId.pf12).toBe(0);
    expect(report.byId.pf13).toBe(0);

    expect(report.byId.pb1a).toBeCloseTo(429.94, 0);
    expect(report.byId.pb1b).toBeCloseTo(0.43);
    expect(report.byId.pb1c).toBeCloseTo(0.504);
    expect(report.byId.pb1d).toBe(0);
    expect(report.byId.pb2a).toBeCloseTo(187.44, 0);
    expect(report.byId.pb2b).toBeCloseTo(21.58);
    expect(report.byId.pb2c).toBeCloseTo(18.18);

    expect(report.byId.pb3aa).toBe(0);
    expect(report.byId.pb3ab).toBe(0);
    expect(report.byId.pb3ac).toBe(0);
    expect(report.byId.pb3ba).toBe(0);
    expect(report.byId.pb3bb).toBe(0);
    expect(report.byId.pb3bc).toBe(0);

    expect(report.byId.pb4).toBeCloseTo(4.92);
    expect(report.byId.pb5).toBeCloseTo(55.39);
    expect(report.byId.pb6a).toBeCloseTo(374.625);
    expect(report.byId.pb6b).toBe(0);
    expect(report.byId.pb7).toBeCloseTo(110.77);

    expect(report.byId.pn1a).toBeCloseTo(-2861.59);
    expect(report.byId.pn1b).toBe(0);
    expect(report.byId.pn2a).toBeCloseTo(-185.57);
    expect(report.byId.pn2b).toBeCloseTo(-16.842);
    expect(report.byId.pn2c).toBeCloseTo(-76.98, 1);

    const sumPf = Object.keys(report.byId)
      .filter((key) => key.startsWith('pf'))
      .reduce(
        (acc, key) => acc + report.byId[key as keyof typeof report.byId],
        0,
      );
    expect(sumPf).toBeCloseTo(3101.43, 0);

    const sumPb = Object.keys(report.byId)
      .filter((key) => key.startsWith('pb'))
      .reduce(
        (acc, key) => acc + report.byId[key as keyof typeof report.byId],
        0,
      );
    expect(sumPb).toBeCloseTo(1203.78, 0);

    const sumPn = Object.keys(report.byId)
      .filter((key) => key.startsWith('pn'))
      .reduce(
        (acc, key) => acc + report.byId[key as keyof typeof report.byId],
        0,
      );
    expect(sumPn).toBeCloseTo(-3140.97);

    expect(report.total).toBeCloseTo(1164.41, 0);
  });
});
