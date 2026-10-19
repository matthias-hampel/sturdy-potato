/**
 * Ported from AGVOLUTION/agmeo src/lib/trafficability/mualem.test.ts — logic, numbers and
 * thresholds unchanged; only imports adapted to the rewrite.
 */

import { pfToTheta, thetaToPF, thetaToPsiCm } from './mualem.js';
import { KA5_SOIL_PARAMS } from './soilClasses.js';

describe('mualem-vG', () => {
  it('monotonic: lower θ → higher |ψ|', () => {
    const p = KA5_SOIL_PARAMS.Ls.mvg;
    const psiDry = thetaToPsiCm(0.15, p);
    const psiMid = thetaToPsiCm(0.25, p);
    const psiWet = thetaToPsiCm(0.35, p);
    expect(psiDry).toBeGreaterThan(psiMid);
    expect(psiMid).toBeGreaterThan(psiWet);
  });

  it('at θ ≈ θ_s the |ψ| ≈ 0 (saturated)', () => {
    const p = KA5_SOIL_PARAMS.Ls.mvg;
    const psi = thetaToPsiCm(p.thetaS - 1e-6, p);
    expect(psi).toBeLessThan(1);
  });

  it('at θ near θ_r the |ψ| is very large (dry)', () => {
    const p = KA5_SOIL_PARAMS.Ls.mvg;
    const psi = thetaToPsiCm(p.thetaR + 0.001, p);
    expect(psi).toBeGreaterThan(1e5);
  });

  it('pF stays in the physical agronomic range across θ_r..θ_s', () => {
    const p = KA5_SOIL_PARAMS.Ls.mvg;
    // Wet end: pF near 0
    expect(thetaToPF(p.thetaS - 0.005, p)).toBeLessThan(2);
    // Dry end (close to wilting): pF should be high (≥ 4 is permanent wilting)
    expect(thetaToPF(p.thetaR + 0.005, p)).toBeGreaterThan(4);
    // Mid range stays in plant-available zone (pF 1..4.2)
    const pfMid = thetaToPF((p.thetaS + p.thetaR) / 2, p);
    expect(pfMid).toBeGreaterThan(0);
    expect(pfMid).toBeLessThan(4.2);
  });

  it('pfToTheta inverts thetaToPF within tolerance', () => {
    const p = KA5_SOIL_PARAMS.Lu.mvg;
    for (const theta of [0.15, 0.2, 0.25, 0.3, 0.35]) {
      const pf = thetaToPF(theta, p);
      const back = pfToTheta(pf, p);
      expect(Math.abs(back - theta)).toBeLessThan(0.01);
    }
  });
});
