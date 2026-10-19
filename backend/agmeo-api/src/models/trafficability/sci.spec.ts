/**
 * Ported from AGVOLUTION/agmeo src/lib/trafficability/sci.test.ts — logic, numbers and
 * thresholds unchanged; only imports adapted to the rewrite.
 */

import {
  froehlichNu,
  sci,
  stressAtDepth,
  TRAFFICABILITY_THRESHOLDS,
  trafficabilityBand,
} from './sci.js';

describe('froehlichNu', () => {
  it('ν decreases monotonically with pF', () => {
    expect(froehlichNu(1.5)).toBeCloseTo(6, 1);
    expect(froehlichNu(2.5)).toBeGreaterThan(froehlichNu(3.5));
    expect(froehlichNu(4.2)).toBeCloseTo(4, 1);
  });

  it('clamps outside the calibrated range', () => {
    expect(froehlichNu(0)).toBe(6);
    expect(froehlichNu(7)).toBe(4);
  });
});

describe('stressAtDepth', () => {
  it('returns the surface value at depth 0', () => {
    const s = stressAtDepth({
      surfaceStressKpa: 200,
      footprintRadiusM: 0.25,
      depthM: 0,
      pf: 2.5,
    });
    expect(s).toBeCloseTo(200, 5);
  });

  it('decays with depth', () => {
    const shallow = stressAtDepth({
      surfaceStressKpa: 200,
      footprintRadiusM: 0.25,
      depthM: 0.2,
      pf: 2.5,
    });
    const deep = stressAtDepth({
      surfaceStressKpa: 200,
      footprintRadiusM: 0.25,
      depthM: 0.5,
      pf: 2.5,
    });
    expect(deep).toBeLessThan(shallow);
    expect(shallow).toBeLessThan(200);
  });

  it('wetter soil (lower pF) propagates more stress to depth', () => {
    const dry = stressAtDepth({
      surfaceStressKpa: 200,
      footprintRadiusM: 0.25,
      depthM: 0.3,
      pf: 4,
    });
    const wet = stressAtDepth({
      surfaceStressKpa: 200,
      footprintRadiusM: 0.25,
      depthM: 0.3,
      pf: 1.8,
    });
    expect(wet).toBeGreaterThan(dry);
  });
});

describe('sci', () => {
  it('computes σ/Pc', () => {
    expect(sci({ stressAtDepthKpa: 100, precompressionKpa: 200 })).toBeCloseTo(
      0.5,
    );
    expect(sci({ stressAtDepthKpa: 250, precompressionKpa: 200 })).toBeCloseTo(
      1.25,
    );
  });

  it('Pc=0 returns +∞ (unsafe)', () => {
    expect(sci({ stressAtDepthKpa: 50, precompressionKpa: 0 })).toBe(
      Number.POSITIVE_INFINITY,
    );
  });
});

describe('trafficabilityBand', () => {
  it('maps SCI to the 4-step traffic light', () => {
    expect(trafficabilityBand(0.5)).toBe('good');
    expect(trafficabilityBand(0.9)).toBe('caution');
    expect(trafficabilityBand(1.2)).toBe('risk');
    expect(trafficabilityBand(2.0)).toBe('unsafe');
  });

  it('boundaries are inclusive of the LOWER bound', () => {
    expect(trafficabilityBand(0.8)).toBe('caution');
    expect(trafficabilityBand(1.0)).toBe('risk');
    expect(trafficabilityBand(1.5)).toBe('unsafe');
  });

  it('TRAFFICABILITY_THRESHOLDS matches the band breaks', () => {
    expect(trafficabilityBand(TRAFFICABILITY_THRESHOLDS.good - 0.001)).toBe(
      'good',
    );
    expect(trafficabilityBand(TRAFFICABILITY_THRESHOLDS.good)).toBe('caution');
    expect(trafficabilityBand(TRAFFICABILITY_THRESHOLDS.caution)).toBe('risk');
    expect(trafficabilityBand(TRAFFICABILITY_THRESHOLDS.risk)).toBe('unsafe');
  });
});
