/** Ported from agmeo `src/lib/ktbl/tests/actionCostEstimator.test.ts`. */
import { estimateActionCosts, getFqnTier } from './action-cost-estimator.js';

// FQNs confirmed present in cross_params.json
const TILLAGE_FQN = 'PLOWING__RP7_1000'; // Tier 1, mech=120 only
const SPRAYING_FQN = 'SPRAYING__PST24_1000'; // Tier 2, mech=120
const SPREADING_FQN = 'SPREADING__FST_1000'; // Tier 3, mech=120
// LOADING_FERTILIZER entries are all crop-specific; must pass crop param
const LOADING_FERT_FQN = 'LOADING_FERTILIZER__WLS_1000';
const LOADING_FERT_CROP = { crop: 'canola' as const };
const STORAGE_FQN = 'ROLLING__R60_1000'; // Tier 3, constant reference
// SM45_1000 has mech=83 AND mech=102 → used for rounding tests
const SOWING_MULTI_MECH_FQN = 'SOWING__SM45_1000';

describe('estimateActionCosts', () => {
  describe('unknown FQN', () => {
    it('returns null for non-existent FQN', () => {
      expect(estimateActionCosts('NONEXISTENT__FQN_1000')).toBeNull();
    });

    it('returns null for empty string', () => {
      expect(estimateActionCosts('')).toBeNull();
    });
  });

  describe('formula output — pinned to cross_params.json values', () => {
    it('PLOWING__RP7_1000 hours at fs=10 dist=5 matches formula exactly', () => {
      // params.hours = [a=0.8183513535581053, b=0.009183133879848055, c=0.6708075863789018, d=-0.02825983359230018]
      // formula: a + max(0,b)*dist + c/fs + max(0,d)*(dist/fs)  (d clamped to 0)
      // = 0.8183513535581053 + 0.009183133879848055*5 + 0.6708075863789018/10 + 0
      // = 0.9313477815952358
      const result = estimateActionCosts(TILLAGE_FQN, {
        fieldSizeHa: 10,
        distanceKm: 5,
        mechKw: 120,
      });
      expect(result!.hours).toBeCloseTo(0.9313477815952358, 4);
    });
  });

  describe('Tier 1 — dynamic formula, sensitive to all params', () => {
    it('returns positive hours and diesel for tillage', () => {
      const result = estimateActionCosts(TILLAGE_FQN);
      expect(result).not.toBeNull();
      expect(result!.hours).toBeGreaterThan(0);
      expect(result!.diesel).toBeGreaterThan(0);
    });

    it('hours decrease with larger field size (less turning overhead)', () => {
      const small = estimateActionCosts(TILLAGE_FQN, { fieldSizeHa: 1 });
      const large = estimateActionCosts(TILLAGE_FQN, { fieldSizeHa: 50 });
      expect(small!.hours).toBeGreaterThan(large!.hours);
    });

    it('hours increase with distance (transport to field)', () => {
      const near = estimateActionCosts(TILLAGE_FQN, { distanceKm: 1 });
      const far = estimateActionCosts(TILLAGE_FQN, { distanceKm: 20 });
      expect(far!.hours).toBeGreaterThan(near!.hours);
    });

    it('machine operations have zero services cost (not contracted out)', () => {
      expect(estimateActionCosts(TILLAGE_FQN)!.services).toBe(0);
    });

    it('miscellaneous is positive for tillage (verifies KTBL typo mapping)', () => {
      expect(estimateActionCosts(TILLAGE_FQN)!.miscellaneous).toBeGreaterThan(
        0,
      );
    });
  });

  describe('Tier 2 — dynamic formula, spraying sensitive to params', () => {
    it('returns positive hours for spraying', () => {
      const result = estimateActionCosts(SPRAYING_FQN);
      expect(result).not.toBeNull();
      expect(result!.hours).toBeGreaterThan(0);
    });

    it('FQN with only one mech level available falls back gracefully', () => {
      // C20_2000 only exists at mech=45; requesting mech=120 should still return a result
      const result = estimateActionCosts('DEEP_STUBBLE_MANAGEMENT__C20_2000', {
        mechKw: 120,
      });
      expect(result).not.toBeNull();
      expect(result!.hours).toBeGreaterThan(0);
    });
  });

  describe('Tier 3 — reference value at default conditions, ignores fs/dist/productAmount', () => {
    it('removing from storage gives same result regardless of field size or distance', () => {
      const ref = estimateActionCosts(STORAGE_FQN);
      const changed = estimateActionCosts(STORAGE_FQN, {
        fieldSizeHa: 80,
        distanceKm: 30,
      });
      expect(ref).not.toBeNull();
      expect(changed).not.toBeNull();
      expect(changed!.hours).toBeCloseTo(ref!.hours, 6);
      expect(changed!.diesel).toBeCloseTo(ref!.diesel, 6);
    });

    it('SPREADING returns same value regardless of fieldSizeHa', () => {
      const small = estimateActionCosts(SPREADING_FQN, { fieldSizeHa: 1 });
      const large = estimateActionCosts(SPREADING_FQN, { fieldSizeHa: 80 });
      expect(small!.hours).toBeCloseTo(large!.hours, 6);
    });

    it('SPREADING returns same value regardless of distanceKm', () => {
      const near = estimateActionCosts(SPREADING_FQN, { distanceKm: 1 });
      const far = estimateActionCosts(SPREADING_FQN, { distanceKm: 30 });
      expect(near!.hours).toBeCloseTo(far!.hours, 6);
    });

    it('SPREADING returns same value regardless of productAmountKgHa', () => {
      const low = estimateActionCosts(SPREADING_FQN, { productAmountKgHa: 50 });
      const high = estimateActionCosts(SPREADING_FQN, {
        productAmountKgHa: 5000,
      });
      expect(low!.hours).toBeCloseTo(high!.hours, 6);
    });
  });

  describe('productAmountKgHa — only affects LOADING_FERTILIZER (Tier 2)', () => {
    it('doubling product amount roughly doubles LOADING_FERTILIZER costs', () => {
      const low = estimateActionCosts(LOADING_FERT_FQN, {
        ...LOADING_FERT_CROP,
        productAmountKgHa: 150,
      });
      const high = estimateActionCosts(LOADING_FERT_FQN, {
        ...LOADING_FERT_CROP,
        productAmountKgHa: 300,
      });
      expect(low).not.toBeNull();
      expect(high).not.toBeNull();
      expect(high!.hours).toBeCloseTo(low!.hours * 2, 1);
      expect(high!.diesel).toBeCloseTo(low!.diesel * 2, 1);
    });

    it('productAmountKgHa is ignored for tillage', () => {
      const without = estimateActionCosts(TILLAGE_FQN);
      const with500 = estimateActionCosts(TILLAGE_FQN, {
        productAmountKgHa: 500,
      });
      expect(with500!.hours).toBeCloseTo(without!.hours, 6);
    });

    it('productAmountKgHa is ignored for spraying', () => {
      const without = estimateActionCosts(SPRAYING_FQN);
      const with300 = estimateActionCosts(SPRAYING_FQN, {
        productAmountKgHa: 300,
      });
      expect(with300!.hours).toBeCloseTo(without!.hours, 6);
    });

    it('productAmountKgHa = 0 is clamped to minimum scale for LOADING_FERTILIZER', () => {
      // Scale = clamp(0/300, 0.1, 20) = 0.1; same as 30 kg (30/300 = 0.1 = clamp min)
      const atZero = estimateActionCosts(LOADING_FERT_FQN, {
        ...LOADING_FERT_CROP,
        productAmountKgHa: 0,
      });
      const atClampMin = estimateActionCosts(LOADING_FERT_FQN, {
        ...LOADING_FERT_CROP,
        productAmountKgHa: 30,
      });
      expect(atZero!.hours).toBeCloseTo(atClampMin!.hours, 6);
    });

    it('negative productAmountKgHa is treated same as zero', () => {
      const atNeg = estimateActionCosts(LOADING_FERT_FQN, {
        ...LOADING_FERT_CROP,
        productAmountKgHa: -500,
      });
      const atZero = estimateActionCosts(LOADING_FERT_FQN, {
        ...LOADING_FERT_CROP,
        productAmountKgHa: 0,
      });
      expect(atNeg!.hours).toBeCloseTo(atZero!.hours, 6);
    });

    it('very large productAmountKgHa is capped at 20× reference', () => {
      // scale = clamp(6000/300, 0.1, 20) = 20; anything above gives the same
      const atCap = estimateActionCosts(LOADING_FERT_FQN, {
        ...LOADING_FERT_CROP,
        productAmountKgHa: 6000,
      });
      const atHuge = estimateActionCosts(LOADING_FERT_FQN, {
        ...LOADING_FERT_CROP,
        productAmountKgHa: 999_999,
      });
      expect(atHuge!.hours).toBeCloseTo(atCap!.hours, 6);
    });
  });

  describe('mechKw — rounded to nearest KTBL level', () => {
    it('default 120 kW gives same result as explicit mechKw 120', () => {
      expect(estimateActionCosts(TILLAGE_FQN)).toEqual(
        estimateActionCosts(TILLAGE_FQN, { mechKw: 120 }),
      );
    });

    it('mechKw is rounded to nearest KTBL level (90 → 83, not 102)', () => {
      // KTBL levels: [45, 67, 83, 102, 120, 200, 230]; |90-83|=7 < |90-102|=12
      const at83 = estimateActionCosts(SOWING_MULTI_MECH_FQN, { mechKw: 83 });
      const at90 = estimateActionCosts(SOWING_MULTI_MECH_FQN, { mechKw: 90 });
      expect(at90).toEqual(at83);
    });

    it('very high mechKw clamps to nearest available (230)', () => {
      // HARVESTING__CH60_1500 has entries at 102, 200, 230 — so 999 should resolve to 230
      const at230 = estimateActionCosts('HARVESTING__CH60_1500', {
        mechKw: 230,
      });
      const at999 = estimateActionCosts('HARVESTING__CH60_1500', {
        mechKw: 999,
      });
      expect(at230).toEqual(at999);
    });

    it('mechKw = 0 is treated as 45 kW (minimum KTBL level)', () => {
      const atZero = estimateActionCosts(SOWING_MULTI_MECH_FQN, { mechKw: 0 });
      const at45 = estimateActionCosts(SOWING_MULTI_MECH_FQN, { mechKw: 45 });
      // Both should fall back to nearest available (83 is nearest to both 0 and 45 for this FQN)
      expect(atZero).toEqual(at45);
    });
  });

  describe('robustness — bad inputs clamped for Tier 1/2, never throw for any tier', () => {
    it('negative field size is clamped to 0.5 ha', () => {
      const neg = estimateActionCosts(TILLAGE_FQN, { fieldSizeHa: -5 });
      const min = estimateActionCosts(TILLAGE_FQN, { fieldSizeHa: 0.5 });
      expect(neg!.hours).toBeCloseTo(min!.hours, 6);
    });

    it('field size above 80 ha is clamped to 80 ha', () => {
      const at80 = estimateActionCosts(TILLAGE_FQN, { fieldSizeHa: 80 });
      const at200 = estimateActionCosts(TILLAGE_FQN, { fieldSizeHa: 200 });
      expect(at200!.hours).toBeCloseTo(at80!.hours, 6);
    });

    it('zero distance is clamped to 1 km', () => {
      const zero = estimateActionCosts(TILLAGE_FQN, { distanceKm: 0 });
      const one = estimateActionCosts(TILLAGE_FQN, { distanceKm: 1 });
      expect(zero!.hours).toBeCloseTo(one!.hours, 6);
    });

    it('negative distance is clamped to 1 km', () => {
      const neg = estimateActionCosts(TILLAGE_FQN, { distanceKm: -10 });
      const one = estimateActionCosts(TILLAGE_FQN, { distanceKm: 1 });
      expect(neg!.hours).toBeCloseTo(one!.hours, 6);
    });

    it('distance above 30 km is clamped to 30 km', () => {
      const at30 = estimateActionCosts(TILLAGE_FQN, { distanceKm: 30 });
      const at100 = estimateActionCosts(TILLAGE_FQN, { distanceKm: 100 });
      expect(at100!.hours).toBeCloseTo(at30!.hours, 6);
    });

    it('all costs are non-negative at extreme inputs', () => {
      const result = estimateActionCosts(TILLAGE_FQN, {
        fieldSizeHa: 0.5,
        distanceKm: 1,
      });
      expect(result).not.toBeNull();
      for (const value of Object.values(result!)) {
        expect(value).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('tier classification', () => {
    it('PLOWING__RP7_1000 is Tier 1', () => {
      expect(getFqnTier(TILLAGE_FQN)).toBe(1);
    });

    it('SPRAYING__PST24_1000 is Tier 2', () => {
      expect(getFqnTier(SPRAYING_FQN)).toBe(2);
    });

    it('SPREADING__FST_1000 is Tier 3', () => {
      expect(getFqnTier(SPREADING_FQN)).toBe(3);
    });

    it('ROLLING__R60_1000 is Tier 3', () => {
      expect(getFqnTier(STORAGE_FQN)).toBe(3);
    });

    it('unknown FQN defaults to Tier 3', () => {
      expect(getFqnTier('NONEXISTENT__FQN_1000')).toBe(3);
    });
  });

  describe('output shape', () => {
    it('returns all 8 cost components', () => {
      const result = estimateActionCosts(TILLAGE_FQN);
      expect(result).not.toBeNull();
      expect(Object.keys(result!).sort()).toEqual(
        [
          'depreciation',
          'diesel',
          'hours',
          'interest',
          'materials',
          'miscellaneous',
          'repairs',
          'services',
        ].sort(),
      );
    });

    it('all cost components are finite numbers', () => {
      const result = estimateActionCosts(SPRAYING_FQN, {
        fieldSizeHa: 5,
        distanceKm: 10,
      });
      expect(result).not.toBeNull();
      for (const value of Object.values(result!)) {
        expect(Number.isFinite(value)).toBe(true);
      }
    });
  });
});
