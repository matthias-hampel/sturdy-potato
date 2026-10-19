import { allSupportedCrops, MODEL_CROP_BY_CODE } from '../crops.js';
import { hasNitrogenModel } from './curves.js';
import { ESM_CROPS, esmCropFor } from './esmCrops.js';
import { getDefaultNResidual, nCropInKgNpHa, nCropInKgNpHaInverse, nitrogenCurve, zoneNitrogen } from './nitrogen.js';

describe('crop N demand curves', () => {
  it('evaluates the linear, logarithmic and missing curves as the reference', () => {
    expect(nCropInKgNpHa(8, 'winterWheat')).toBeCloseTo(23 * 8 + 0.2193, 6);
    expect(nCropInKgNpHa(10, 'silageMaize')).toBeCloseTo(30.362 * Math.log(10) + 70.26, 6);
    expect(nCropInKgNpHa(8, 'winterOats')).toBeNull();
    expect(hasNitrogenModel('winterOats')).toBe(false);
    expect(hasNitrogenModel('canola')).toBe(true);
  });

  it('inverts the curves', () => {
    for (const crop of ['winterWheat', 'canola', 'silageMaize'] as const) {
      expect(nCropInKgNpHaInverse(nCropInKgNpHa(7.5, crop)!, crop)).toBeCloseTo(7.5, 6);
    }
  });

  it('knows residual N per crop with the default for the rest', () => {
    expect(getDefaultNResidual('canola')).toBe(30);
    expect(getDefaultNResidual('alfalfa')).toBe(0);
    expect(getDefaultNResidual('winterOats')).toBe(20);
  });
});

describe('zone N balance', () => {
  it('is crop N − Nmin − mineralisation + loss + residual, minus the applied N', () => {
    const z = zoneNitrogen({ crop: 'winterWheat', yieldTHa: 8, nMin: 30, nMinSpring: 45, nLoss: 25, nResidual: 25, nFert: 100 })!;
    expect(z.nCrop).toBeCloseTo(184.2193, 4);
    expect(z.nDemand).toBeCloseTo(184.2193 - 30 - 45 + 25 + 25, 4);
    expect(z.nBalance).toBeCloseTo(z.nDemand - 100, 6);
    expect(zoneNitrogen({ crop: 'winterOats', yieldTHa: 6, nMin: 0, nMinSpring: 0, nLoss: 0, nResidual: 0 })).toBeNull();
  });
});

describe('N curve from the ESM timeseries', () => {
  it('counts mineralisation from BBCH 20 to 83 only and starts the supply at zero', () => {
    const curve = nitrogenCurve({
      keys: ['a', 'b', 'c', 'd', 'e'],
      BBCH: [10, 20, 50, 83, 90],
      CNUP: [1, 2, 3, 4, 5],
      CNMIN: [5, 10, 30, 40, 60],
    });
    expect(curve.map((p) => p.bbch)).toEqual([10, 20, 50, 83, 90]);
    expect(curve.map((p) => p.uptake)).toEqual([1, 2, 3, 4, 5]);
    // BBCH 10 holds 0 (no previous point), BBCH 90 holds the BBCH 83 value; offset by the smallest positive (10).
    expect(curve.map((p) => p.supply)).toEqual([0, 0, 20, 30, 30]);
    expect(nitrogenCurve({ keys: [], BBCH: [], CNUP: [], CNMIN: [] })).toEqual([]);
  });
});

describe('ESM crops', () => {
  it.each(allSupportedCrops)('maps %s to a crop the ESM models', (crop) => {
    expect(ESM_CROPS).toContain(esmCropFor(crop));
  });

  it('maps every crop code of the rewrite', () => {
    for (const crop of Object.values(MODEL_CROP_BY_CODE)) expect(esmCropFor(crop)).not.toBeNull();
  });

  it('answers null for a crop nobody mapped', () => {
    expect(esmCropFor('tobacco')).toBeNull();
    expect(esmCropFor(null)).toBeNull();
  });
});
