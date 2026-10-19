/**
 * Ported from AGVOLUTION/agmeo src/lib/trafficability/soilClasses.test.ts — logic, numbers and
 * thresholds unchanged; only imports adapted to the rewrite.
 */

import {
  coarseKa5,
  DEFAULT_SOIL_PARAMS,
  getKa5SoilParams,
  KA5_SOIL_PARAMS,
} from './soilClasses.js';

describe('coarseKa5', () => {
  it('strips fine-code suffixes to the coarse group', () => {
    expect(coarseKa5('Sl3')).toBe('Sl');
    expect(coarseKa5('Ut4')).toBe('Ut');
    expect(coarseKa5('Lts')).toBe('Lt');
    expect(coarseKa5('Su2')).toBe('Su');
    expect(coarseKa5('St3')).toBe('St');
  });

  it('leaves already-coarse codes intact', () => {
    expect(coarseKa5('Ss')).toBe('Ss');
    expect(coarseKa5('Lu')).toBe('Lu');
    expect(coarseKa5('Tt')).toBe('Tt');
    expect(coarseKa5('Uu')).toBe('Uu');
  });

  it("returns '' for nullish or unparsable", () => {
    expect(coarseKa5(null)).toBe('');
    expect(coarseKa5(undefined)).toBe('');
    expect(coarseKa5('')).toBe('');
    expect(coarseKa5('123')).toBe('');
  });
});

describe('getKa5SoilParams', () => {
  it('resolves fine and coarse codes to the same row', () => {
    expect(getKa5SoilParams('Sl3')).toBe(KA5_SOIL_PARAMS.Sl);
    expect(getKa5SoilParams('Sl')).toBe(KA5_SOIL_PARAMS.Sl);
    expect(getKa5SoilParams('Ut4')).toBe(KA5_SOIL_PARAMS.Ut);
  });

  it('falls back to DEFAULT_SOIL_PARAMS for unknown or missing keys', () => {
    expect(getKa5SoilParams(null)).toBe(DEFAULT_SOIL_PARAMS);
    expect(getKa5SoilParams(undefined)).toBe(DEFAULT_SOIL_PARAMS);
    expect(getKa5SoilParams('XYZ')).toBe(DEFAULT_SOIL_PARAMS);
  });

  it('returns plausible clay-% per soil group', () => {
    // Sand groups have low clay, clay groups high
    expect(getKa5SoilParams('Ss').clayPct).toBeLessThan(10);
    expect(getKa5SoilParams('Tt').clayPct).toBeGreaterThan(50);
    // Mid-range loams between
    expect(getKa5SoilParams('Ls').clayPct).toBeGreaterThan(15);
    expect(getKa5SoilParams('Ls').clayPct).toBeLessThan(30);
  });

  it('ships valid VG params for every entry (n > 1, θ_s > θ_r)', () => {
    for (const [code, row] of Object.entries(KA5_SOIL_PARAMS)) {
      // Label each assertion with the code so jest output names the bad row.
      expect({ code, n: row.mvg.n }).toMatchObject({
        code,
        n: expect.any(Number),
      });
      expect(row.mvg.n).toBeGreaterThan(1);
      expect(row.mvg.thetaS).toBeGreaterThan(row.mvg.thetaR);
      expect(row.mvg.alpha).toBeGreaterThan(0);
    }
  });
});
