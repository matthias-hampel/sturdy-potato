import { availableN, soilClassOf } from '@agmeo/contracts';
import { baseFertilizationNeed, kClass, limeRequirement, mgClass, P2O5_TO_P, pClass, phClass } from './base-fertilization.js';
import { closedPeriod, inClosedPeriod, restrictedByClosedPeriod } from './closed-periods.js';
import { catchCropDeduction, nitrogenNeed, type NNeedInput } from './duev.js';

const wheat: NNeedInput = {
  cropCode: 'winter_wheat',
  expectedYieldTHa: 8,
  nmin: 0,
  humusPct: 2,
  previousCropCode: null,
  catchCrop: null,
  organicPreviousYearDeduction: 0,
  filmOrFleece: false,
  proteinPct: null,
  nitrateSensitiveZone: false,
};

describe('DüV N need (Anlage 4)', () => {
  it('starts from the Sollwert at the reference yield', () => {
    expect(nitrogenNeed(wheat)).toMatchObject({ duevCrop: 'Winterweizen A/B', nRequirement: 230, expectedYield: 80, yieldCorrection: 0, need: 230 });
  });

  it('applies yield corrections in steps, with surcharges capped at 40', () => {
    expect(nitrogenNeed({ ...wheat, expectedYieldTHa: 9.5 })!.yieldCorrection).toBe(10);
    expect(nitrogenNeed({ ...wheat, expectedYieldTHa: 13 })!.yieldCorrection).toBe(40);
    // Only full steps count: 72 dt is no full step below the reference, 70 dt is one (−15).
    expect(nitrogenNeed({ ...wheat, expectedYieldTHa: 7.2 })!.yieldCorrection).toBe(0);
    expect(nitrogenNeed({ ...wheat, expectedYieldTHa: 7 })!.yieldCorrection).toBe(-15);
    expect(nitrogenNeed({ ...wheat, cropCode: 'winter_rapeseed', expectedYieldTHa: 4.6 })!.yieldCorrection).toBe(10);
  });

  it('deducts Nmin, humus, previous and catch crop, organic N of last year', () => {
    const r = nitrogenNeed({ ...wheat, nmin: 40, humusPct: 4.5, previousCropCode: 'winter_rapeseed', catchCrop: { legume: true, winterHardy: true }, organicPreviousYearDeduction: 12 })!;
    expect([r.nmin, r.humusDeduction, r.previousCropDeduction, r.catchCropDeduction, r.organicPreviousYearDeduction]).toEqual([40, 20, 10, 40, 12]);
    expect(r.need).toBe(230 - 40 - 20 - 10 - 40 - 12);
  });

  it('cuts 20 % in nitrate-polluted areas and never goes below zero', () => {
    const r = nitrogenNeed({ ...wheat, nmin: 30, nitrateSensitiveZone: true })!;
    expect([r.needBeforeZone, r.zoneReduction, r.need]).toEqual([200, 40, 160]);
    expect(nitrogenNeed({ ...wheat, cropCode: 'peas', expectedYieldTHa: 4, nmin: 30 })!.need).toBe(0);
    expect(nitrogenNeed({ ...wheat, cropCode: 'cc_mustard' })).toBeNull();
  });

  it('assesses grassland in dry matter with a protein correction', () => {
    // 50 t/ha FM → 90 dt DM = reference; +1 % crude protein → +14.
    expect(nitrogenNeed({ ...wheat, cropCode: 'grassland', expectedYieldTHa: 50, proteinPct: 18 })).toMatchObject({ expectedYield: 90, yieldCorrection: 14, need: 259 });
  });

  it('credits catch crops by type and winter hardiness', () => {
    expect([catchCropDeduction({ legume: false, winterHardy: false }), catchCropDeduction({ legume: false, winterHardy: true }), catchCropDeduction({ legume: true, winterHardy: false })]).toEqual([0, 20, 10]);
  });
});

describe('P, K, Mg and lime', () => {
  it('classifies soil contents (VDLUFA)', () => {
    // 15 mg P2O5 = 6.5 mg P → D; 10 mg P2O5 = 4.4 mg P → C.
    expect([pClass(15), pClass(10), pClass(2)]).toEqual(['D', 'C', 'A']);
    expect([kClass(15, 'medium'), kClass(15, 'light'), kClass(45, 'heavy')]).toEqual(['C', 'C', 'D']);
    // Mg classes are in mg Mg/100 g: 6 mg MgO = 3.6 mg Mg → B on medium soils; 10 mg MgO = 6 mg Mg → C.
    expect(mgClass(6, 'medium')).toBe('B');
    expect(mgClass(10, 'medium')).toBe('C');
    expect(soilClassOf('sU')).toBe('light');
    expect(soilClassOf('L')).toBe('medium');
    expect(soilClassOf('tL')).toBe('heavy');
  });

  it('scales removal by the class factor, with straw only when it leaves the field', () => {
    const kept = baseFertilizationNeed('winter_wheat', 8, false, 'medium', null);
    // Without soil values: removal, but no need.
    expect(kept.map((r) => [r.nutrient, r.removal, r.need])).toEqual([['p2o5', 64, null], ['k2o', 44, null], ['mgo', 16, null]]);
    const removed = baseFertilizationNeed('winter_wheat', 8, true, 'medium', { p2o5Mg100g: 5, k2oMg100g: 45, mgoMg100g: null });
    // Straw 64 dt: +19.2 P2O5, +108.8 K2O; P class B (2.2 mg P) ×1.5, K class E ×0.
    expect(removed[0]).toMatchObject({ removal: 83.2, contentClass: 'B', need: 124.8 });
    expect(removed[1]).toMatchObject({ removal: 152.8, contentClass: 'E', need: 0 });
    expect(removed[2]).toMatchObject({ contentClass: null, factor: null, need: null });
  });

  // Reference lib/farmalyzer/__tests__/duev-stress.test.ts, "P/K/Mg Grunddüngung" (soil values in mg P/100 g there).
  it('matches the reference P cases', () => {
    const p = (mgP: number | null, strawRemoved = false) => baseFertilizationNeed('winter_wheat', 8, strawRemoved, 'medium', { p2o5Mg100g: mgP == null ? null : mgP / P2O5_TO_P, k2oMg100g: null, mgoMg100g: null })[0];
    expect(p(4)).toMatchObject({ removal: 64, contentClass: 'C', need: 64 });
    expect(p(4, true)).toMatchObject({ removal: 83.2, need: 83.2 });
    expect(p(15)).toMatchObject({ contentClass: 'E', need: 0 });
    expect(p(10)).toMatchObject({ contentClass: 'D', factor: 0.5, need: 32 });
  });

  it('computes the lime requirement towards the target pH', () => {
    expect(limeRequirement(5.8, 'cacl2', 'medium', 2)).toBe(15);
    expect(limeRequirement(6.8, 'h2o', 'medium', 2)).toBe(0);
    expect(limeRequirement(null, null, 'medium', 2)).toBeNull();
    expect(phClass(5.8, 'cacl2', 'medium', 2)).toBe('B');
  });
});

describe('closed periods and available N', () => {
  it('uses the right window per land use, fertilizer and area', () => {
    expect(inClosedPeriod('2026-10-15', closedPeriod('arable', 'cattle_slurry', false))).toBe(true);
    expect(inClosedPeriod('2026-11-15', closedPeriod('arable', 'cattle_solid_manure', false))).toBe(false);
    expect(inClosedPeriod('2026-11-15', closedPeriod('arable', 'cattle_solid_manure', true))).toBe(true);
    expect(inClosedPeriod('2027-01-20', closedPeriod('arable', 'compost', false))).toBe(false);
    expect(inClosedPeriod('2026-10-15', closedPeriod('grassland', 'can', false))).toBe(false);
    expect(inClosedPeriod('2026-10-15', closedPeriod('grassland', 'can', true))).toBe(true);
    expect(restrictedByClosedPeriod('pk', 0)).toBe(false);
  });

  it('counts organic N with its minimum efficiency or NH4-N', () => {
    expect(availableN('cattle_slurry', 100, 50, true)).toBe(60);
    expect(availableN('pig_slurry', 100, 75, true)).toBe(75);
    expect(availableN('can', 54, 27, false)).toBe(54);
  });
});
