/**
 * Ported from AGVOLUTION/agmeo src/lib/irrigation/pedotransfer.test.ts — logic, numbers and
 * thresholds unchanged; only imports adapted to the rewrite.
 */

import { wostenTopsoilHydraulics } from './pedotransfer.js';

// Reference values cross-checked against Wösten 1999 Table 4 (HYPRES topsoil PTF).
// Tolerance is loose because cited table-4 values themselves are mean predictions
// over a range of bulk density / OM combinations.

describe('wostenTopsoilHydraulics', () => {
  it('sand (low clay, low silt) — coarse-textured, low FC, low PWP', () => {
    const { thetaFc, thetaPwp } = wostenTopsoilHydraulics({
      clayPct: 5,
      siltPct: 10,
      socPct: 1.0,
      bulkDensity: 1.5,
    });
    expect(thetaFc).toBeGreaterThan(0.1);
    expect(thetaFc).toBeLessThan(0.25);
    expect(thetaPwp).toBeGreaterThan(0.02);
    expect(thetaPwp).toBeLessThan(0.1);
    expect(thetaFc).toBeGreaterThan(thetaPwp);
  });

  it('loam (balanced) — medium FC, medium PWP', () => {
    const { thetaFc, thetaPwp } = wostenTopsoilHydraulics({
      clayPct: 20,
      siltPct: 40,
      socPct: 1.5,
      bulkDensity: 1.4,
    });
    expect(thetaFc).toBeGreaterThan(0.25);
    expect(thetaFc).toBeLessThan(0.4);
    expect(thetaPwp).toBeGreaterThan(0.1);
    expect(thetaPwp).toBeLessThan(0.25);
    expect(thetaFc - thetaPwp).toBeGreaterThan(0.1);
  });

  it('clay (high clay) — high FC, high PWP, narrow AWC', () => {
    const { thetaFc, thetaPwp } = wostenTopsoilHydraulics({
      clayPct: 45,
      siltPct: 30,
      socPct: 1.5,
      bulkDensity: 1.35,
    });
    expect(thetaFc).toBeGreaterThan(0.3);
    expect(thetaPwp).toBeGreaterThan(0.18);
    expect(thetaFc - thetaPwp).toBeLessThan(0.25);
  });

  it('missing SOC and BD — uses defaults, still finite', () => {
    const { thetaFc, thetaPwp, vg } = wostenTopsoilHydraulics({
      clayPct: 20,
      siltPct: 40,
      socPct: null,
      bulkDensity: null,
    });
    expect(Number.isFinite(thetaFc)).toBe(true);
    expect(Number.isFinite(thetaPwp)).toBe(true);
    expect(Number.isFinite(vg.thetaS)).toBe(true);
    expect(Number.isFinite(vg.alpha)).toBe(true);
    expect(Number.isFinite(vg.n)).toBe(true);
    expect(vg.n).toBeGreaterThan(1);
  });

  it('zero silt clamps without NaN', () => {
    const { thetaFc, thetaPwp } = wostenTopsoilHydraulics({
      clayPct: 30,
      siltPct: 0,
      socPct: 1.5,
      bulkDensity: 1.4,
    });
    expect(Number.isFinite(thetaFc)).toBe(true);
    expect(Number.isFinite(thetaPwp)).toBe(true);
  });

  it('monotone — more clay shifts both FC and PWP up', () => {
    const sand = wostenTopsoilHydraulics({
      clayPct: 5,
      siltPct: 10,
      socPct: 1.5,
      bulkDensity: 1.5,
    });
    const clay = wostenTopsoilHydraulics({
      clayPct: 40,
      siltPct: 30,
      socPct: 1.5,
      bulkDensity: 1.4,
    });
    expect(clay.thetaFc).toBeGreaterThan(sand.thetaFc);
    expect(clay.thetaPwp).toBeGreaterThan(sand.thetaPwp);
  });
});
