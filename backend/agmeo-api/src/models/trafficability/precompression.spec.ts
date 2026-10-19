/**
 * Ported from AGVOLUTION/agmeo src/lib/trafficability/precompression.test.ts — logic, numbers and
 * thresholds unchanged; only imports adapted to the rewrite.
 */

import { DEFAULT_BULK_DENSITY, precompression } from './precompression.js';

describe('precompression (Severiano 2013)', () => {
  it('dries soil → higher Pc', () => {
    const wet = precompression({ bulkDensityGCm3: 1.5, clayPct: 20, pf: 1.8 });
    const dry = precompression({ bulkDensityGCm3: 1.5, clayPct: 20, pf: 3.5 });
    expect(dry).toBeGreaterThan(wet);
  });

  it('denser soil → higher Pc at same moisture/clay', () => {
    const loose = precompression({
      bulkDensityGCm3: 1.3,
      clayPct: 20,
      pf: 2.5,
    });
    const dense = precompression({
      bulkDensityGCm3: 1.6,
      clayPct: 20,
      pf: 2.5,
    });
    expect(dense).toBeGreaterThan(loose);
  });

  it('Severiano: sand has higher A·|ψ|^B than clay loam (published)', () => {
    // The Severiano regression gives well-sorted sand a higher A and B than
    // clay loam — aggregate-stability effect, kept faithful to the paper.
    const sandyDry = precompression({
      bulkDensityGCm3: 1.5,
      clayPct: 5,
      pf: 3,
    });
    const clayDry = precompression({
      bulkDensityGCm3: 1.5,
      clayPct: 35,
      pf: 3,
    });
    expect(sandyDry).toBeGreaterThan(clayDry);
  });

  it('always returns Pc ≥ 1 kPa (physical floor, no div-by-zero downstream)', () => {
    const pc = precompression({ bulkDensityGCm3: 1.0, clayPct: 5, pf: 1.0 });
    expect(pc).toBeGreaterThanOrEqual(1);
  });

  it('agricultural mid-range yields Pc in the 50–400 kPa band', () => {
    const pc = precompression({ bulkDensityGCm3: 1.5, clayPct: 20, pf: 2.5 });
    expect(pc).toBeGreaterThan(50);
    expect(pc).toBeLessThan(400);
  });

  it('default bulk density is in the typical agricultural range', () => {
    expect(DEFAULT_BULK_DENSITY).toBeGreaterThan(1.2);
    expect(DEFAULT_BULK_DENSITY).toBeLessThan(1.8);
  });
});
