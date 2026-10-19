/** Ported from agmeo `src/lib/ktbl/tests/actionCostSoilType.test.ts`. */
import { estimateActionCosts } from './action-cost-estimator.js';

const SOWING_FQN = 'SOWING__SM45_1000';

// ── Monotonicity invariant: HS >= MS >= LS ────────────────────────────
// Heavier soil means more fuel and more time. The model enforces this
// by sorting the three soil variants so LS <= MS <= HS per cost component.

describe('soilType: monotonicity — HS >= MS >= LS for diesel and hours', () => {
  const TEST_FQNS = [
    'SOWING__SM45_1000',
    'PLOWING__RP7_1000',
    'SPRAYING__PST24_1000',
    'DEEP_CULTIVATION__DC45_3000',
    'SPREADING__FST_1000',
    'ROLLING__R60_1000',
  ];

  for (const fqn of TEST_FQNS) {
    it(`${fqn}: HS.diesel >= MS.diesel >= LS.diesel`, () => {
      const ls = estimateActionCosts(fqn, { soilType: 'LS' });
      const ms = estimateActionCosts(fqn, { soilType: 'MS' });
      const hs = estimateActionCosts(fqn, { soilType: 'HS' });
      if (!ls || !ms || !hs) return;
      expect(hs.diesel).toBeGreaterThanOrEqual(ms.diesel);
      expect(ms.diesel).toBeGreaterThanOrEqual(ls.diesel);
    });

    it(`${fqn}: HS.hours >= MS.hours >= LS.hours`, () => {
      const ls = estimateActionCosts(fqn, { soilType: 'LS' });
      const ms = estimateActionCosts(fqn, { soilType: 'MS' });
      const hs = estimateActionCosts(fqn, { soilType: 'HS' });
      if (!ls || !ms || !hs) return;
      expect(hs.hours).toBeGreaterThanOrEqual(ms.hours);
      expect(ms.hours).toBeGreaterThanOrEqual(ls.hours);
    });
  }
});

describe('soilType: monotonicity with crop', () => {
  it('sowing + winterWheat: HS.diesel >= MS.diesel >= LS.diesel', () => {
    const ls = estimateActionCosts(SOWING_FQN, {
      soilType: 'LS',
      crop: 'winterWheat',
    });
    const ms = estimateActionCosts(SOWING_FQN, {
      soilType: 'MS',
      crop: 'winterWheat',
    });
    const hs = estimateActionCosts(SOWING_FQN, {
      soilType: 'HS',
      crop: 'winterWheat',
    });
    expect(hs!.diesel).toBeGreaterThanOrEqual(ms!.diesel);
    expect(ms!.diesel).toBeGreaterThanOrEqual(ls!.diesel);
  });

  it('plowing + canola: HS.diesel >= MS.diesel >= LS.diesel', () => {
    const ls = estimateActionCosts('PLOWING__RP7_1000', {
      soilType: 'LS',
      crop: 'canola',
    });
    const ms = estimateActionCosts('PLOWING__RP7_1000', {
      soilType: 'MS',
      crop: 'canola',
    });
    const hs = estimateActionCosts('PLOWING__RP7_1000', {
      soilType: 'HS',
      crop: 'canola',
    });
    expect(hs!.diesel).toBeGreaterThanOrEqual(ms!.diesel);
    expect(ms!.diesel).toBeGreaterThanOrEqual(ls!.diesel);
  });
});

describe('soilType: monotonicity across field sizes and distances', () => {
  it('monotonicity holds at small field size', () => {
    const ls = estimateActionCosts(SOWING_FQN, {
      soilType: 'LS',
      fieldSizeHa: 1,
    });
    const hs = estimateActionCosts(SOWING_FQN, {
      soilType: 'HS',
      fieldSizeHa: 1,
    });
    expect(hs!.diesel).toBeGreaterThanOrEqual(ls!.diesel);
    expect(hs!.hours).toBeGreaterThanOrEqual(ls!.hours);
  });

  it('monotonicity holds at large field size', () => {
    const ls = estimateActionCosts(SOWING_FQN, {
      soilType: 'LS',
      fieldSizeHa: 50,
    });
    const hs = estimateActionCosts(SOWING_FQN, {
      soilType: 'HS',
      fieldSizeHa: 50,
    });
    expect(hs!.diesel).toBeGreaterThanOrEqual(ls!.diesel);
    expect(hs!.hours).toBeGreaterThanOrEqual(ls!.hours);
  });

  it('monotonicity holds at long distance', () => {
    const ls = estimateActionCosts(SOWING_FQN, {
      soilType: 'LS',
      distanceKm: 25,
    });
    const hs = estimateActionCosts(SOWING_FQN, {
      soilType: 'HS',
      distanceKm: 25,
    });
    expect(hs!.diesel).toBeGreaterThanOrEqual(ls!.diesel);
    expect(hs!.hours).toBeGreaterThanOrEqual(ls!.hours);
  });
});

describe('soilType: soil-aware path fires without crop', () => {
  it('sowing with soil type differs from without', () => {
    const noSoil = estimateActionCosts(SOWING_FQN, { mechKw: 102 });
    const hs = estimateActionCosts(SOWING_FQN, { soilType: 'HS', mechKw: 102 });
    // HS should differ from the soil-averaged default
    expect(hs!.diesel).not.toBeCloseTo(noSoil!.diesel, 4);
  });
});

describe('soilType: backwards compatible — no soil = same as before', () => {
  const TEST_FQNS = [
    'PLOWING__RP7_1000',
    'SPRAYING__PST24_1000',
    'SPREADING__FST_1000',
    'SOWING__SRH40_3000',
    'DEEP_CULTIVATION__DC45_3000',
  ];

  it('omitting soilType gives identical results to before', () => {
    for (const fqn of TEST_FQNS) {
      const without = estimateActionCosts(fqn, {
        fieldSizeHa: 10,
        distanceKm: 5,
      });
      const withUndefined = estimateActionCosts(fqn, {
        fieldSizeHa: 10,
        distanceKm: 5,
        soilType: undefined,
      });
      expect(withUndefined).toEqual(without);
    }
  });
});

describe('accuracy: soil-aware estimates closer to KTBL ground truth', () => {
  const GROUND_TRUTH = {
    sowing: {
      LS: { diesel: 5.19, hours: 0.61 },
      MS: { diesel: 5.54, hours: 0.61 },
      HS: { diesel: 5.91, hours: 0.61 },
    },
  } as const;

  it('sowing diesel with soil type is within 12% of ground truth', () => {
    for (const [soil, expected] of Object.entries(GROUND_TRUTH.sowing)) {
      const result = estimateActionCosts(SOWING_FQN, {
        soilType: soil as 'LS' | 'MS' | 'HS',
        mechKw: 102,
        fieldSizeHa: 10,
        distanceKm: 5,
      });
      const pctError =
        Math.abs(result!.diesel - expected.diesel) / expected.diesel;
      expect(pctError).toBeLessThan(0.12);
    }
  });

  it('sowing diesel WITHOUT soil type has higher max error than WITH', () => {
    const noSoilResult = estimateActionCosts(SOWING_FQN, {
      mechKw: 102,
      fieldSizeHa: 10,
      distanceKm: 5,
    })!;

    let maxErrorWithSoil = 0;
    let maxErrorWithout = 0;

    for (const [soil, expected] of Object.entries(GROUND_TRUTH.sowing)) {
      const withSoil = estimateActionCosts(SOWING_FQN, {
        soilType: soil as 'LS' | 'MS' | 'HS',
        mechKw: 102,
        fieldSizeHa: 10,
        distanceKm: 5,
      })!;

      const errWith =
        Math.abs(withSoil.diesel - expected.diesel) / expected.diesel;
      const errWithout =
        Math.abs(noSoilResult.diesel - expected.diesel) / expected.diesel;

      maxErrorWithSoil = Math.max(maxErrorWithSoil, errWith);
      maxErrorWithout = Math.max(maxErrorWithout, errWithout);
    }

    expect(maxErrorWithSoil).toBeLessThan(maxErrorWithout);
  });
});
