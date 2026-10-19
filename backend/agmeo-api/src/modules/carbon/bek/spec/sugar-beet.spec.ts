// Ported from agmeo src/lib/co2calculator/tests/cropsCo2e/sugarBeet.test.ts (expected values from the BEK example sheets).
import { calculator } from '../calculator.js';
import type { Co2eInput } from '../types.js';
import { emptyCo2eInput } from '../empty.js';
import { humusBalanceMainOrCoverCrop } from '../humus.js';

import { excelParams } from './excel-params.js';

const sugarBeetParameters = {
  All_K20_FM: 0.1,
  All_P205_FM: 0.18,
  Alles_N_FM: 0.46,
  Alles_P_FM: 0.08,
  Cover: 'Empty',
  DM_mainproduct: 23,
  DM_minorproduct: 18,
  Humus_effect_HP: -1300,
  Humus_effect_NP: 1.3,
  Ntobetakenintoaccount: -10,
  Prim_K20_FM: 0.1,
  Prim_N_FM: 0.18,
  Prim_P205_FM: 0.1,
  Prim_P_FM: 0.04,
  ProductionSystem: 'conventional',
  Proteinlevel: -999,
  Season: 'Main crop',
  Sek_K20_FM: 0.1,
  Sek_N_FM: 0.4,
  Sek_P205_FM: 0.11,
  Sek_P_FM: 0.05,
  Type: 'sugarBeet',
  Usage: 'Row crops',
  VHN: 0.7,
  nr: 61,
  root_DM_n: 0.014,
  root_prop: 0.2,
};

// According to them the sek_K20_FM is 0.71, but in our parameters is 0.1
sugarBeetParameters!.Sek_K20_FM = 0.71;

const byProductWet = 71.7 * (sugarBeetParameters?.VHN || 0) + 0.041;

const ex1: Co2eInput = {
  fieldData: {
    crop: 'sugarBeet',
    dryMassYield: 71.7 * 0.23,
    byProductWet,
    byproductRemoved: 0,
    nLastYear: 50,
    humusBalance: humusBalanceMainOrCoverCrop('sugarBeet', 1, 0).value, // For some reason, in the excel is no yield calculated for humus
    supplySeed: 2,
    pesticidesQuantity: 18.875,
    diesel: 124.46,
    biodiesel: 0,
    nForNextCrop: byProductWet * 10 * (sugarBeetParameters?.Sek_N_FM || 0), // formula is in dt
    p2o5ForNextCrop:
      byProductWet * 10 * (sugarBeetParameters?.Sek_P205_FM || 0),
    k2oForNextCrop: byProductWet * 10 * (sugarBeetParameters?.Sek_K20_FM || 0), // Our value is 0.1 / dt, the one from excel is 0.71 / kg
  },
  fieldOrganicFertilizerData: [
    {
      '1': {
        organicFertilizerType: 'unknown',
        organicTechnology: 'broadcast',
        incorporationTime: '4h',
        quantityFarmManure: 26.26,
        nFromOrganic: 3.1,
        p2o5Organic: 1.9,
        k2oOrganic: 2.7,
        nh3NProportion: 46,
        nEffectiveness: 71,
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
        appliedOthersMineralNHectare: 2.8, // referring to mineral non-urea non-uan
        limeYearlyAverage: 0, // kg CaO/ha
        p2o5Mineral: 60, // kg/ha
        k2oMineral: 136,
      },
    },
  ],
};

describe('SugarBeet', () => {
  test('Dummy report', () => {
    const sugarBeetDummyTemplate = structuredClone(emptyCo2eInput);
    sugarBeetDummyTemplate.fieldData.crop = 'sugarBeet';
    const dummyReport = calculator(sugarBeetDummyTemplate);
    expect(dummyReport.total).toBe(0);
  });
  test('input', () => {
    expect(ex1.fieldData.byProductWet).toBeCloseTo(50.231);
    expect(sugarBeetParameters?.Sek_N_FM).toBeCloseTo(0.4);
    expect(ex1.fieldData.nForNextCrop).toBeCloseTo(200.92);
    expect(sugarBeetParameters?.Sek_P205_FM).toBeCloseTo(0.11);
    expect(ex1.fieldData.p2o5ForNextCrop).toBeCloseTo(55.254);
    expect(sugarBeetParameters?.Sek_K20_FM).toBeCloseTo(0.71);
    expect(ex1.fieldData.k2oForNextCrop).toBeCloseTo(356.64);
  });

  test('T1', () => {
    const report = calculator(ex1, excelParams);
    expect(report.byId.pf1).toBeCloseTo(40.51);
    expect(report.byId.pf2).toBeCloseTo(0.47);
    expect(report.byId.pf3).toBeCloseTo(294.58);
    expect(report.byId.pf4).toBeCloseTo(14.27);
    expect(report.byId.pf5a).toBeCloseTo(129.03);
    //  console.log(
    //     JSON.stringify(
    //         report.details.filter(
    //             (detail) => detail.inputName === "byproductQuantity",
    //         ),
    //         null,
    //         2,
    //     ),
    // );
    expect(report.byId.pf5b).toBeCloseTo(1_024.03);
    expect(report.byId.pf6).toBeCloseTo(25.48);
    expect(report.byId.pf7).toBe(0);
    expect(report.byId.pf8a).toBe(0);
    expect(report.byId.pf8b).toBe(0);
    expect(report.byId.pf9).toBeCloseTo(4771);
    expect(report.byId.pf10).toBeCloseTo(602.33);
    expect(report.byId.pf11a).toBe(0);
    expect(report.byId.pf12).toBe(0);
    expect(report.byId.pf13).toBe(0);

    expect(report.byId.pb1a).toBeCloseTo(9.86);
    expect(report.byId.pb1b).toBeCloseTo(32.4);
    expect(report.byId.pb1c).toBeCloseTo(57.12);
    expect(report.byId.pb2a).toBeCloseTo(213.51);
    expect(report.byId.pb2b).toBeCloseTo(26.94);
    expect(report.byId.pb2c).toBeCloseTo(29.78);
    expect(report.byId.pb3aa).toBe(0.0);
    expect(report.byId.pb3ab).toBe(0.0);
    expect(report.byId.pb3ac).toBe(0.0);
    expect(report.byId.pb3ba).toBe(0.0);
    expect(report.byId.pb3bb).toBe(0.0);
    expect(report.byId.pb3bc).toBe(0.0);
    expect(report.byId.pb4).toBeCloseTo(4.28);
    expect(report.byId.pb5).toBeCloseTo(73.26);
    expect(report.byId.pb6a).toBeCloseTo(374.62);
    expect(report.byId.pb6b).toBe(0);
    expect(report.byId.pb7).toBeCloseTo(110.77);

    expect(report.byId.pn1a).toBeCloseTo(-2950.0, 0);
    expect(report.byId.pn1b).toBe(0);
    expect(report.byId.pn2a).toBeCloseTo(-683.14, 0);
    expect(report.byId.pn2b).toBeCloseTo(-30.837, -1);

    expect(report.byId.pn2c).toBeCloseTo(-149.789);

    // The sum from pf1 to pf13 should be 2677.33
    const sumPf = Object.keys(report.byId)
      .filter((key) => key.startsWith('pf'))
      .reduce(
        (acc, key) => acc + report.byId[key as keyof typeof report.byId],
        0,
      );
    expect(sumPf).toBeCloseTo(6_901.69); // still got a problem with FM and DM yield

    const sumPb = Object.keys(report.byId)
      .filter((key) => key.startsWith('pb'))
      .reduce(
        (acc, key) => acc + report.byId[key as keyof typeof report.byId],
        0,
      );
    expect(sumPb).toBeCloseTo(932.55);

    const sumPn = Object.keys(report.byId)
      .filter((key) => key.startsWith('pn'))
      .reduce(
        (acc, key) => acc + report.byId[key as keyof typeof report.byId],
        0,
      );
    expect(sumPn).toBeCloseTo(-3812.33);

    expect(report.total).toBeCloseTo(4021.91); // still got a problem with FM and DM yield
  });
});
