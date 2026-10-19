/**
 * Ported from AGVOLUTION/agmeo src/lib/trafficability/index.test.ts — logic, numbers and
 * thresholds unchanged; only imports adapted to the rewrite.
 */

import { evaluateTrafficability } from './index.js';

const baseMachine = {
  operatingMassKg: 8000,
  frontAxleFraction: 0.4,
  frontInflationKpa: 120,
  frontRecommendedKpa: 120,
  rearInflationKpa: 120,
  rearRecommendedKpa: 120,
};

describe('evaluateTrafficability (full pipeline)', () => {
  it('wet soil → higher SCI band than dry, same machine', () => {
    const wet = evaluateTrafficability({
      thetaCurrent: 0.32,
      ka5: 'Ls',
      machine: baseMachine,
      frontFootprintRadiusM: 0.25,
      rearFootprintRadiusM: 0.3,
    });
    const dry = evaluateTrafficability({
      thetaCurrent: 0.15,
      ka5: 'Ls',
      machine: baseMachine,
      frontFootprintRadiusM: 0.25,
      rearFootprintRadiusM: 0.3,
    });
    expect(wet.sci).toBeGreaterThan(dry.sci);
  });

  it('lower tyre pressure on wet soil reduces SCI vs higher pressure', () => {
    const highP = evaluateTrafficability({
      thetaCurrent: 0.28,
      ka5: 'Ls',
      machine: {
        ...baseMachine,
        rearInflationKpa: 200,
        rearRecommendedKpa: 150,
      },
      frontFootprintRadiusM: 0.25,
      rearFootprintRadiusM: 0.3,
    });
    const lowP = evaluateTrafficability({
      thetaCurrent: 0.28,
      ka5: 'Ls',
      machine: {
        ...baseMachine,
        rearInflationKpa: 80,
        rearRecommendedKpa: 150,
      },
      frontFootprintRadiusM: 0.25,
      rearFootprintRadiusM: 0.3,
    });
    // Lower P_i ⇒ lower σ via Keller (1.13·P_i dominates) ⇒ lower SCI.
    expect(lowP.sci).toBeLessThan(highP.sci);
  });

  it('returns a defined band even with unknown KA5', () => {
    const r = evaluateTrafficability({
      thetaCurrent: 0.25,
      ka5: null,
      machine: baseMachine,
      frontFootprintRadiusM: 0.25,
      rearFootprintRadiusM: 0.3,
    });
    expect(['good', 'caution', 'risk', 'unsafe']).toContain(r.band);
    expect(Number.isFinite(r.sci)).toBe(true);
  });

  it('heavier machine increases SCI vs lighter at same soil/pressure', () => {
    const light = evaluateTrafficability({
      thetaCurrent: 0.25,
      ka5: 'Lu',
      machine: { ...baseMachine, operatingMassKg: 5000 },
      frontFootprintRadiusM: 0.25,
      rearFootprintRadiusM: 0.3,
    });
    const heavy = evaluateTrafficability({
      thetaCurrent: 0.25,
      ka5: 'Lu',
      machine: { ...baseMachine, operatingMassKg: 12000 },
      frontFootprintRadiusM: 0.25,
      rearFootprintRadiusM: 0.3,
    });
    expect(heavy.sci).toBeGreaterThan(light.sci);
  });
});
