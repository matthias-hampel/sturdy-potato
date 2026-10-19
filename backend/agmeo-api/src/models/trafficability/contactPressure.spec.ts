/**
 * Ported from AGVOLUTION/agmeo src/lib/trafficability/contactPressure.test.ts — logic, numbers and
 * thresholds unchanged; only imports adapted to the rewrite.
 */

import { axleContactStress, contactStress } from './contactPressure.js';

describe('contactStress (Keller 2005)', () => {
  it('monotonic in load: heavier tyre → higher σ at same pressure', () => {
    const s10 = contactStress({
      loadKn: 10,
      inflationKpa: 150,
      recommendedKpa: 150,
    });
    const s30 = contactStress({
      loadKn: 30,
      inflationKpa: 150,
      recommendedKpa: 150,
    });
    const s50 = contactStress({
      loadKn: 50,
      inflationKpa: 150,
      recommendedKpa: 150,
    });
    expect(s30).toBeGreaterThan(s10);
    expect(s50).toBeGreaterThan(s30);
  });

  it('under-inflation penalty raises σ at fixed load', () => {
    const fixedLoad = 25;
    const correct = contactStress({
      loadKn: fixedLoad,
      inflationKpa: 150,
      recommendedKpa: 150,
    });
    const under = contactStress({
      loadKn: fixedLoad,
      inflationKpa: 100,
      recommendedKpa: 150,
    });
    // Under-inflation: −33.4·ln(100/150) ≈ +13.5 kPa, but loses 1.13·50 ≈ −56.5 from inflation term.
    // Net: σ should DECREASE when running below recommended (less carcass stiffness vs higher carcass support).
    // Keller's 2005 form: dropping P_i lowers σ overall.
    expect(under).toBeLessThan(correct);
  });

  it('at recommended pressure the ln-term vanishes', () => {
    const s = contactStress({
      loadKn: 20,
      inflationKpa: 120,
      recommendedKpa: 120,
    });
    // expected: 34.4 + 1.13·120 + 0.72·20 − 33.4·0 = 34.4 + 135.6 + 14.4 = 184.4
    expect(s).toBeCloseTo(184.4, 1);
  });
});

describe('axleContactStress', () => {
  it('splits mass via frontAxleFraction', () => {
    // 8000 kg ⇒ 78.45 kN total. fraction 0.4 ⇒ front axle 31.38 kN ⇒ 15.69 kN per tyre
    const r = axleContactStress({
      operatingMassKg: 8000,
      frontAxleFraction: 0.4,
      frontInflationKpa: 120,
      frontRecommendedKpa: 120,
      rearInflationKpa: 120,
      rearRecommendedKpa: 120,
    });
    expect(r.frontLoadPerTyreKn).toBeCloseTo(15.69, 1);
    expect(r.rearLoadPerTyreKn).toBeCloseTo(23.54, 1);
  });

  it('rear tyre runs into higher σ when more weight is back-axle', () => {
    const r = axleContactStress({
      operatingMassKg: 10000,
      frontAxleFraction: 0.35,
      frontInflationKpa: 150,
      frontRecommendedKpa: 150,
      rearInflationKpa: 150,
      rearRecommendedKpa: 150,
    });
    expect(r.rearStressKpa).toBeGreaterThan(r.frontStressKpa);
  });
});
