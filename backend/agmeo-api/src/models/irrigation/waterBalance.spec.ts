/**
 * Ported from AGVOLUTION/agmeo src/lib/irrigation/waterBalance.test.ts — logic, numbers and
 * thresholds unchanged; only imports adapted to the rewrite.
 */

import {
  adjustKcForClimate,
  BUCKET_DEPTH_M,
  computeAWC,
  computeKr,
  computeKs,
  computeTEW,
  computeWaterBalance,
  DEFAULT_KC,
  estimateRHmin,
  fillRatioPct,
  getCropHeight,
  getDeficitLevel,
  getDepletionFraction,
  getREW,
  getRootDepth,
  hargreavesET0,
  isWinterCrop,
  kcbFromKc,
  kcClimateAdjustment,
  kcFromBbch,
  kcFromNDVI,
  LUFA_HYDRAULIC_PARAMS,
  saturationVaporPressure,
  thetaToMm,
  type WaterBalanceInput,
} from './waterBalance.js';

// ── Pure helpers ────────────────────────────────────────────────────

describe('isWinterCrop', () => {
  it.each([
    'winterWheat',
    'winterBarleyFodder',
    'winterRyeBaking',
    'canola',
    'triticaleFodder',
  ])('is true for %s', (crop) => {
    expect(isWinterCrop(crop as never)).toBe(true);
  });

  it.each([
    'springBarleyMalting',
    'silageMaize',
    'sugarBeet',
    'potatoTableLate',
  ])('is false for %s', (crop) => {
    expect(isWinterCrop(crop as never)).toBe(false);
  });

  it('is false for null', () => {
    expect(isWinterCrop(null)).toBe(false);
  });
});

describe('getRootDepth (FAO-56 Table 22 contract)', () => {
  // This replaces a tripwire that asserted BUCKET_DEPTH_M === 0.30 and told the
  // next reader to re-evaluate every caller if crop-specific depths were ever
  // introduced. They now are: the bucket is the crop's effective rooting depth
  // from Table 22, upper end of each range, and BUCKET_DEPTH_M is only the
  // fallback. The contract below is the new tripwire — every number here is a
  // published Table 22 value or a documented decision in ROOT_DEPTH_BY_CROP.
  it('uses the upper end of each Table 22 range', () => {
    expect(getRootDepth('winterWheat')).toBeCloseTo(1.8); // Winter Wheat 1.5-1.8
    expect(getRootDepth('winterBarleyFodder')).toBeCloseTo(1.5); // Barley 1.0-1.5
    expect(getRootDepth('grainMaize')).toBeCloseTo(1.7); // Maize, Field 1.0-1.7
    expect(getRootDepth('canola')).toBeCloseTo(1.5); // Rapeseed 1.0-1.5
    expect(getRootDepth('soybeanBeans')).toBeCloseTo(1.3); // Soybeans 0.6-1.3
    expect(getRootDepth('alfalfa')).toBeCloseTo(2); // Alfalfa (hay) 1.0-2.0
    expect(getRootDepth('broadBeans')).toBeCloseTo(0.7); // Fababean 0.5-0.7
  });

  it('keeps the two agronomic decisions that are not plain table reads', () => {
    // Inside the published 0.7-1.2 span but deliberately below its top.
    expect(getRootDepth('sugarBeet')).toBeCloseTo(1.1);
    // OUTSIDE Table 22, which gives potato 0.4-0.6 m. Deliberate — see the
    // comment on ROOT_DEPTH_BY_CROP for why, and for what it costs.
    expect(getRootDepth('potatoTableLate')).toBeCloseTo(1);
  });

  it('falls back for entries Table 22 has no row for', () => {
    expect(BUCKET_DEPTH_M).toBeCloseTo(1.2);
    expect(getRootDepth('nonProductiveArea')).toBeCloseTo(BUCKET_DEPTH_M);
    expect(getRootDepth('oilRadishIntercrop')).toBeCloseTo(BUCKET_DEPTH_M);
    expect(getRootDepth('grassSeed')).toBeCloseTo(BUCKET_DEPTH_M);
    expect(getRootDepth(null)).toBeCloseTo(BUCKET_DEPTH_M);
  });
});

describe('fillRatioPct', () => {
  it('returns the fill percentage of nFK from awc + deficit', () => {
    expect(fillRatioPct(100, 0)).toBeCloseTo(100);
    expect(fillRatioPct(100, 50)).toBeCloseTo(50);
    expect(fillRatioPct(100, 100)).toBeCloseTo(0);
  });
  it('clamps to [0, 100]', () => {
    expect(fillRatioPct(100, 120)).toBe(0);
    expect(fillRatioPct(100, -20)).toBe(100);
  });
  it('returns null for missing or degenerate inputs', () => {
    expect(fillRatioPct(null, 50)).toBeNull();
    expect(fillRatioPct(100, null)).toBeNull();
    expect(fillRatioPct(0, 50)).toBeNull();
    expect(fillRatioPct(-10, 5)).toBeNull();
  });
});

describe('thetaToMm', () => {
  it('converts vol-% × depth to mm', () => {
    expect(thetaToMm(30, 0.6)).toBeCloseTo(180);
    expect(thetaToMm(15, 1.0)).toBeCloseTo(150);
  });
});

describe('computeAWC', () => {
  it('returns FC, PWP and AWC in mm for the rooting depth', () => {
    const r = computeAWC(30, 12, 0.6);
    expect(r.fc).toBeCloseTo(180);
    expect(r.pwp).toBeCloseTo(72);
    expect(r.awc).toBeCloseTo(108);
  });
});

describe('LUFA_HYDRAULIC_PARAMS', () => {
  it('covers the 11 KA5 standard texture classes', () => {
    expect(Object.keys(LUFA_HYDRAULIC_PARAMS)).toHaveLength(11);
  });
  it('PWP < FC for every soil type', () => {
    for (const [k, { thetaFc, thetaPwp }] of Object.entries(
      LUFA_HYDRAULIC_PARAMS,
    )) {
      expect(thetaPwp).toBeLessThan(thetaFc);
      expect(k).toMatch(/^[A-Za-z]+$/);
    }
  });
});

// ── Kc lookups ──────────────────────────────────────────────────────

describe('kcFromNDVI', () => {
  it('clamps to [0.15, 1.2]', () => {
    expect(kcFromNDVI(-0.5)).toBe(0.15);
    expect(kcFromNDVI(0)).toBe(0.2); // 1.25*0+0.2=0.2 above 0.15 floor
    expect(kcFromNDVI(0.8)).toBeCloseTo(1.2);
    expect(kcFromNDVI(2)).toBe(1.2);
  });
  it('scales linearly between bounds', () => {
    expect(kcFromNDVI(0.4)).toBeCloseTo(0.7);
    expect(kcFromNDVI(0.6)).toBeCloseTo(0.95);
  });
});

describe('kcFromBbch', () => {
  it('uses Kc_ini before BBCH 10', () => {
    expect(kcFromBbch(0, 'winterWheat')).toBe(0.3);
    expect(kcFromBbch(5, 'silageMaize')).toBe(0.3);
  });
  it('ramps from Kc_ini to Kc_mid across BBCH 10-30', () => {
    // Wheat: ini 0.3 → mid 1.15. At BBCH 20 → midway 0.725.
    expect(kcFromBbch(20, 'winterWheat')).toBeCloseTo(0.725);
  });
  it('plateaus at Kc_mid across BBCH 30-69', () => {
    expect(kcFromBbch(30, 'winterWheat')).toBeCloseTo(1.15);
    expect(kcFromBbch(50, 'winterWheat')).toBeCloseTo(1.15);
    expect(kcFromBbch(69, 'winterWheat')).toBeCloseTo(1.15);
  });
  it('ramps from Kc_mid to Kc_end across BBCH 70-79', () => {
    // Wheat: mid 1.15 → end 0.25. At BBCH 75 → midway 0.7.
    expect(kcFromBbch(75, 'winterWheat')).toBeCloseTo(0.7);
  });
  it('uses Kc_end at BBCH ≥ 80', () => {
    expect(kcFromBbch(85, 'winterWheat')).toBeCloseTo(0.25);
    expect(kcFromBbch(95, 'sugarBeet')).toBeCloseTo(0.7);
  });
  it('falls back to default Kc curve when crop has no entry', () => {
    expect(kcFromBbch(50, null)).toBe(1.1); // default mid
    expect(kcFromBbch(0, null)).toBe(0.3); // default ini
  });
});

// ── ET0 (Hargreaves) ────────────────────────────────────────────────

describe('hargreavesET0', () => {
  it('returns 0 when Tmax = Tmin (no diurnal swing)', () => {
    expect(hargreavesET0(15, 15, 15, 50, 180)).toBeCloseTo(0);
  });
  it('scales with temperature range and mean', () => {
    const cool = hargreavesET0(8, 18, 13, 50, 180);
    const warm = hargreavesET0(15, 28, 22, 50, 180);
    expect(warm).toBeGreaterThan(cool);
  });
  it('typical mid-summer day at 50°N gives single-digit ET0', () => {
    const et0 = hargreavesET0(12, 25, 18.5, 50, 180);
    expect(et0).toBeGreaterThan(2);
    expect(et0).toBeLessThan(8);
  });
  it('never returns negative', () => {
    expect(hargreavesET0(20, 18, 19, 50, 1)).toBeGreaterThanOrEqual(0);
  });
});

// ── Deficit classification ──────────────────────────────────────────

describe('getCropHeight', () => {
  it('returns FAO-56 Table 12 typical max heights', () => {
    expect(getCropHeight('silageMaize')).toBeCloseTo(2.0);
    expect(getCropHeight('winterWheat')).toBeCloseTo(1.0);
    expect(getCropHeight('sugarBeet')).toBeCloseTo(0.5);
    expect(getCropHeight('alfalfa')).toBeCloseTo(0.7);
  });
  it('falls back to 0.6 m for unknown / null crop', () => {
    expect(getCropHeight(null)).toBeCloseTo(0.6);
  });
});

describe('saturationVaporPressure (FAO-56 Eq. 11)', () => {
  it('matches reference table values within 0.01 kPa', () => {
    // FAO-56 Annex 6 Table A.2 reference values
    expect(saturationVaporPressure(0)).toBeCloseTo(0.611, 2);
    expect(saturationVaporPressure(10)).toBeCloseTo(1.228, 2);
    expect(saturationVaporPressure(20)).toBeCloseTo(2.339, 2);
    expect(saturationVaporPressure(30)).toBeCloseTo(4.243, 2);
  });
});

describe('estimateRHmin', () => {
  it('uses dew-point/Tmax ratio when both available', () => {
    // T_max=25°C, T_dew=10°C → e°(10)/e°(25) ≈ 1.228/3.169 ≈ 0.388 → ~38.8%
    const rh = estimateRHmin(25, 10, undefined);
    expect(rh).toBeGreaterThan(35);
    expect(rh).toBeLessThan(42);
  });
  it('falls back to humidityMean - 15 when no dew-point', () => {
    expect(estimateRHmin(null, null, 70)).toBeCloseTo(55);
  });
  it('returns 45 (FAO baseline) when no humidity data', () => {
    expect(estimateRHmin(null, null, null)).toBe(45);
  });
  it('clamps result to [5, 95]', () => {
    expect(estimateRHmin(40, 40, null)).toBeLessThanOrEqual(95);
    expect(estimateRHmin(40, -10, null)).toBeGreaterThanOrEqual(5);
  });
});

describe('kcClimateAdjustment (FAO-56 Eq. 70)', () => {
  it('returns 0 at baseline climate (u2=2, RHmin=45)', () => {
    expect(kcClimateAdjustment(1.0, 2, 45)).toBeCloseTo(0, 5);
  });
  it('is negative under humid / calm conditions', () => {
    // u2=1 m/s, RHmin=80 (humid maritime) → ΔKc < 0
    expect(kcClimateAdjustment(1.0, 1, 80)).toBeLessThan(-0.05);
  });
  it('is positive under windy / arid conditions', () => {
    // u2=4 m/s, RHmin=20 (windy arid) → ΔKc > 0
    expect(kcClimateAdjustment(1.0, 4, 20)).toBeGreaterThan(0.05);
  });
  it('scales with crop height (h/3)^0.3', () => {
    const tall = kcClimateAdjustment(3.0, 4, 20);
    const short = kcClimateAdjustment(0.5, 4, 20);
    expect(Math.abs(tall)).toBeGreaterThan(Math.abs(short));
  });
});

describe('adjustKcForClimate', () => {
  it('does NOT adjust Kc < 0.45 (FAO-56 §6.4.4)', () => {
    expect(adjustKcForClimate(0.3, 1.0, 4, 20)).toBe(0.3);
  });
  it('adjusts Kc ≥ 0.45 by ΔKc', () => {
    const out = adjustKcForClimate(1.15, 1.0, 4, 20);
    expect(out).toBeGreaterThan(1.15);
  });
  it('clamps result at 0', () => {
    // Heavy negative adjustment shouldn't drive Kc negative
    expect(adjustKcForClimate(0.5, 0.3, 0, 95)).toBeGreaterThanOrEqual(0);
  });
});

describe('computeTEW (FAO-56 Eq. 73)', () => {
  it('matches the closed-form formula for typical loam', () => {
    // Loam: θ_FC=32%, θ_PWP=14%, Z_e=0.15 m
    // TEW = 10 · (32 − 7) · 0.15 = 37.5 mm
    expect(computeTEW(32, 14, 0.15)).toBeCloseTo(37.5, 1);
  });
  it('scales linearly with Z_e', () => {
    expect(computeTEW(30, 10, 0.1)).toBeCloseTo(25, 1);
    expect(computeTEW(30, 10, 0.2)).toBeCloseTo(50, 1);
  });
  it('clamps to 0 for nonsensical inputs', () => {
    expect(computeTEW(5, 30, 0.15)).toBe(0);
  });
});

describe('getREW (FAO-56 Table 19)', () => {
  it('returns texture-specific REW values', () => {
    expect(getREW('S')).toBe(5);
    expect(getREW('L')).toBe(9);
    expect(getREW('T')).toBe(12);
  });
  it('falls back to 9 mm for unknown / null soil', () => {
    expect(getREW(null)).toBe(9);
    expect(getREW('XXX')).toBe(9);
  });
});

describe('kcbFromKc', () => {
  it('returns Kc - 0.05 with a 0.15 floor', () => {
    expect(kcbFromKc(1.15)).toBeCloseTo(1.1);
    expect(kcbFromKc(0.6)).toBeCloseTo(0.55);
    expect(kcbFromKc(0.15)).toBeCloseTo(0.15);
    expect(kcbFromKc(0.05)).toBeCloseTo(0.15); // floor
  });
});

describe('computeWaterBalance — dual-Kc surface-layer balance', () => {
  // Loam: TEW≈37.5 mm at Z_e=0.15, REW=9 mm
  const SURFACE = { tew: 37.5, rew: 9, de0: 0 };

  it('hits the Kc_max upper bound on a freshly-wetted bare-soil day (FAO-56 §7.3)', () => {
    // Kc=0.3 (germination), De=0 (fresh wetting), ET0=5. Kcb=0.25, Kc_max=1.2.
    // Ke = 1·(1.2 − 0.25) = 0.95. ETa = (0.25 + 0.95)·5 = 6.0 = Kc_max·ET0.
    const r = computeWaterBalance({ ...PARAMS, surface: SURFACE }, [
      baseDay('2026-05-01', { kc: 0.3, et0: 5 }),
    ]);
    expect(r.days[0].eta).toBeCloseTo(6, 1);
  });

  it('peaks higher than single-Kc when wet, then converges toward Ks·Kcb·ET0', () => {
    const inputs = Array.from({ length: 20 }, (_, i) =>
      baseDay(`2026-05-${String(i + 1).padStart(2, '0')}`, { kc: 0.3, et0: 5 }),
    );
    const dualR = computeWaterBalance({ ...PARAMS, surface: SURFACE }, inputs);
    const singleR = computeWaterBalance(PARAMS, inputs);
    // Wet surface → dual ETa exceeds single Kc·ET0
    expect(dualR.days[0].eta).toBeGreaterThan(singleR.days[0].eta);
    // After ~20 dry days, surface evap collapses toward zero;
    // dual ETa approaches Kcb·Ks·ET0 ≈ 0.25·Ks·5 < single 1.5 mm/day
    expect(dualR.days[19].eta).toBeLessThan(singleR.days[0].eta);
  });

  it('reduces surface evaporation as the top layer dries between rains', () => {
    // 10 dry days. Day 1 starts at De=0 → Ke high. By day 10, De≈TEW → Ke≈0.
    const inputs = Array.from({ length: 10 }, (_, i) =>
      baseDay(`2026-06-${String(i + 1).padStart(2, '0')}`, { kc: 0.3, et0: 5 }),
    );
    const r = computeWaterBalance({ ...PARAMS, surface: SURFACE }, inputs);
    expect(r.days[0].eta).toBeGreaterThan(r.days[9].eta);
  });

  it('rebounds surface evaporation after a wetting event', () => {
    const inputs = [
      ...Array.from({ length: 8 }, (_, i) =>
        baseDay(`2026-06-${String(i + 1).padStart(2, '0')}`, {
          kc: 0.3,
          et0: 5,
        }),
      ),
      baseDay('2026-06-09', { kc: 0.3, et0: 5, precipitation: 25 }),
      baseDay('2026-06-10', { kc: 0.3, et0: 5 }),
    ];
    const r = computeWaterBalance({ ...PARAMS, surface: SURFACE }, inputs);
    // Day 8 (dry): low ETa. Day 10 (after wetting): higher ETa again.
    expect(r.days[9].eta).toBeGreaterThan(r.days[7].eta);
  });

  it('closes the bucket equation in dual mode', () => {
    const inputs = Array.from({ length: 30 }, (_, i) => {
      const day = String(i + 1).padStart(2, '0');
      return baseDay(`2026-05-${day}`, {
        kc: 1.0,
        et0: 5,
        precipitation: i % 5 === 0 ? 8 : 0,
      });
    });
    const r = computeWaterBalance({ ...PARAMS, surface: SURFACE }, inputs);
    const endSwc = r.days[r.days.length - 1].swc;
    const totalDrainage = r.days.reduce((s, d) => s + d.drainage, 0);
    const closure =
      r.totalPrecipitation +
      r.totalIrrigated -
      r.totalEta -
      totalDrainage -
      (endSwc - FC * 0.9);
    expect(Math.abs(closure)).toBeLessThan(1);
  });
});

describe('computeKr (FAO-56 soil-evaporation reduction, Eq. 74)', () => {
  // TEW=40 mm, REW=10 mm
  it('returns 1 (energy-limited stage 1) while De ≤ REW', () => {
    expect(computeKr(0, 40, 10)).toBeCloseTo(1);
    expect(computeKr(10, 40, 10)).toBeCloseTo(1);
  });
  it('ramps linearly from 1 at REW down to 0 at TEW (falling-rate stage 2)', () => {
    expect(computeKr(25, 40, 10)).toBeCloseTo(0.5); // halfway
    expect(computeKr(35, 40, 10)).toBeCloseTo(1 / 6, 2);
  });
  it('returns 0 when De ≥ TEW', () => {
    expect(computeKr(40, 40, 10)).toBe(0);
    expect(computeKr(60, 40, 10)).toBe(0);
  });
  it('returns 0 for degenerate TEW=0', () => {
    expect(computeKr(0, 0, 0)).toBe(0);
  });
});

describe('computeKs (FAO-56 water-stress coefficient)', () => {
  // FC=200, PWP=80, TAW=120, p=0.5 → RAW=60 → stress threshold at SWC=140.
  it('returns 1 (no stress) when depletion is at or below RAW', () => {
    expect(computeKs(200, 200, 80, 0.5)).toBeCloseTo(1);
    expect(computeKs(140, 200, 80, 0.5)).toBeCloseTo(1);
    expect(computeKs(150, 200, 80, 0.5)).toBeCloseTo(1);
  });
  it('ramps linearly from 1 at RAW down to 0 at PWP', () => {
    // Halfway between RAW (Dr=60) and TAW (Dr=120) → Dr=90, SWC=110.
    // Ks = (TAW − Dr) / ((1 − p) · TAW) = (120 − 90) / (0.5 · 120) = 0.5
    expect(computeKs(110, 200, 80, 0.5)).toBeCloseTo(0.5);
    // 75% of the way: Dr=105, SWC=95 → Ks=0.25
    expect(computeKs(95, 200, 80, 0.5)).toBeCloseTo(0.25);
  });
  it('returns 0 at and below PWP', () => {
    expect(computeKs(80, 200, 80, 0.5)).toBeCloseTo(0);
    expect(computeKs(50, 200, 80, 0.5)).toBeCloseTo(0);
  });
  it('respects the depletion fraction p', () => {
    // p=0.35 (potato): RAW=42 → stress threshold at SWC=158.
    expect(computeKs(160, 200, 80, 0.35)).toBeCloseTo(1);
    expect(computeKs(155, 200, 80, 0.35)).toBeLessThan(1);
  });
  it('returns 0 for degenerate soil (TAW=0)', () => {
    expect(computeKs(50, 50, 50, 0.5)).toBe(0);
  });
});

describe('getDepletionFraction (FAO-56 Table 22)', () => {
  it('returns FAO crop-group p values', () => {
    expect(getDepletionFraction('winterWheat')).toBeCloseTo(0.55);
    expect(getDepletionFraction('silageMaize')).toBeCloseTo(0.55);
    expect(getDepletionFraction('sugarBeet')).toBeCloseTo(0.55);
    expect(getDepletionFraction('potatoTableLate')).toBeCloseTo(0.35);
    expect(getDepletionFraction('canola')).toBeCloseTo(0.6);
  });
  it('falls back to default 0.5 for unknown / null crops', () => {
    expect(getDepletionFraction(null)).toBeCloseTo(0.5);
  });
});

describe('getDeficitLevel (farmer-convention 50 % / 30 % nFK)', () => {
  it('ok at fill ≥ 50 % (deficit ≤ 50 % AWC)', () => {
    expect(getDeficitLevel(0, 100)).toBe('ok');
    expect(getDeficitLevel(40, 100)).toBe('ok');
    expect(getDeficitLevel(50, 100)).toBe('ok');
  });
  it('warning at 30–50 % fill (deficit 50–70 % AWC)', () => {
    expect(getDeficitLevel(55, 100)).toBe('warning');
    expect(getDeficitLevel(70, 100)).toBe('warning');
  });
  it('critical below 30 % fill (deficit > 70 % AWC)', () => {
    expect(getDeficitLevel(71, 100)).toBe('critical');
    expect(getDeficitLevel(120, 100)).toBe('critical');
  });
  it('critical when AWC is zero (degenerate soil)', () => {
    expect(getDeficitLevel(0, 0)).toBe('critical');
  });
});

// ── Water balance loop — Geisenheim rules ───────────────────────────

const baseDay = (
  date: string,
  overrides: Partial<WaterBalanceInput> = {},
): WaterBalanceInput => ({
  date,
  precipitation: 0,
  et0: 4,
  kc: DEFAULT_KC,
  irrigation: 0,
  ...overrides,
});

const FC = 200; // mm
const PWP = 80; // mm
const PARAMS = { fc: FC, pwp: PWP };
const AWC = FC - PWP;

describe('computeWaterBalance — basic equation', () => {
  it('returns empty result for empty input', () => {
    const r = computeWaterBalance(PARAMS, []);
    expect(r.days).toEqual([]);
    expect(r.currentDeficit).toBe(0);
  });

  it('starts at 90% of FC (Geisenheim refill target)', () => {
    const r = computeWaterBalance(PARAMS, [
      baseDay('2026-05-01', { et0: 0, kc: 0 }),
    ]);
    // SWC starts at FC*0.9 = 180; ET0 0 + bare-soil floor 0 = 0; SWC stays 180.
    // Bare-soil floor is 15% of et0 — but et0=0 so 0.
    expect(r.days[0].swc).toBeCloseTo(180);
    expect(r.days[0].deficit).toBeCloseTo(20);
  });

  it('ETa = max(Kc·ET0, soil-evap floor)', () => {
    // Kc=0.6, ET0=4 → cropEta=2.4. Soil evap floor = 0.15·4 = 0.6.
    // ETa = max(2.4, 0.6) = 2.4.
    const r = computeWaterBalance(PARAMS, [
      baseDay('2026-05-01', { kc: 0.6, et0: 4 }),
    ]);
    expect(r.days[0].eta).toBeCloseTo(2.4, 1);
  });

  it('bare-soil evaporation floor kicks in when Kc is very low', () => {
    // Kc=0 (pre-emergence), ET0=4 → cropEta=0. Soil evap floor = 0.6.
    // ETa = max(0, 0.6) = 0.6.
    const r = computeWaterBalance(PARAMS, [
      baseDay('2026-05-01', { kc: 0, et0: 4 }),
    ]);
    expect(r.days[0].eta).toBeCloseTo(0.6, 1);
  });
});

describe('computeWaterBalance — interception (Geisenheim)', () => {
  it('ignores precipitation < 0.3 mm/day', () => {
    const baseline = computeWaterBalance(PARAMS, [baseDay('2026-05-01')]);
    const drizzle = computeWaterBalance(PARAMS, [
      baseDay('2026-05-01', { precipitation: 0.2 }),
    ]);
    expect(drizzle.days[0].swc).toBeCloseTo(baseline.days[0].swc, 1);
  });

  it('counts precipitation ≥ 0.3 mm/day', () => {
    const baseline = computeWaterBalance(PARAMS, [
      baseDay('2026-05-01', { et0: 0, kc: 0 }),
    ]);
    const rain = computeWaterBalance(PARAMS, [
      baseDay('2026-05-01', { precipitation: 5, et0: 0, kc: 0 }),
    ]);
    expect(rain.days[0].swc - baseline.days[0].swc).toBeCloseTo(5, 1);
  });
});

describe('computeWaterBalance — runoff on saturated soil', () => {
  it('loses 15% of rain above 10 mm/day when soil is >80% FC', () => {
    // Start near saturation (180 mm = 90% FC), 50 mm rain.
    // Expected runoff: (50-10)*0.15 = 6 mm; 44 mm enters soil; SWC capped at FC=200.
    const r = computeWaterBalance(PARAMS, [
      baseDay('2026-05-01', { precipitation: 50, et0: 0, kc: 0 }),
    ]);
    // Final SWC clipped to FC; drainage carries the surplus.
    expect(r.days[0].swc).toBeCloseTo(200, 1);
    expect(r.days[0].drainage).toBeGreaterThan(0);
  });

  it('no runoff when soil is dry (≤80% FC)', () => {
    // Drain a few days first, then heavy non-trigger rain.
    const inputs = [
      baseDay('2026-05-01', { kc: 1, et0: 8 }), // big ET, drains soil
      baseDay('2026-05-02', { kc: 1, et0: 8 }),
      baseDay('2026-05-03', { kc: 1, et0: 8 }),
      baseDay('2026-05-04', { precipitation: 25, kc: 0, et0: 0 }),
    ];
    const r = computeWaterBalance(PARAMS, inputs);
    // Day 4: dry soil, no runoff, all 25 mm enters.
    expect(r.days[3].drainage).toBeCloseTo(0);
    expect(r.totalPrecipitation).toBeCloseTo(25);
  });
});

describe('computeWaterBalance — FAO-56 water stress (Ks)', () => {
  it('reduces daily ETa once depletion exceeds RAW', () => {
    // p=0.5, TAW=120 → RAW=60. Drive 30 days of ET from start at 0.9·FC=180.
    // Compare ETa from a heavily depleted day (after many drying days) vs a
    // wet day: stressed ETa must be strictly less than demanded.
    const inputs = Array.from({ length: 30 }, (_, i) =>
      baseDay(`2026-05-${String(i + 1).padStart(2, '0')}`, { et0: 6, kc: 1.0 }),
    );
    const r = computeWaterBalance(PARAMS, inputs);
    const day0Eta = r.days[0].eta; // SWC ≈ 180 → Ks=1, ETa=demand
    const dayLateEta = r.days[20].eta; // SWC well into stress regime
    expect(day0Eta).toBeCloseTo(6, 1);
    expect(dayLateEta).toBeLessThan(day0Eta);
    expect(dayLateEta).toBeGreaterThan(0);
  });

  it('never drives SWC below PWP under sustained drought', () => {
    const inputs = Array.from({ length: 60 }, (_, i) =>
      baseDay(
        `2026-06-${String((i % 30) + 1).padStart(2, '0')}`.replace(
          '06-31',
          '06-30',
        ),
        {
          et0: 8,
          kc: 1.2,
        },
      ),
    );
    const r = computeWaterBalance(PARAMS, inputs);
    for (const d of r.days) expect(d.swc).toBeGreaterThanOrEqual(PWP);
    // With Ks acting, ETa asymptotes toward 0 — SWC settles near PWP.
    expect(r.days[r.days.length - 1].swc).toBeCloseTo(PWP, 0);
  });

  it('respects per-crop p — shallow-rooted crops stress earlier', () => {
    // Same inputs, two p values. Lower p (potato 0.35) → smaller RAW →
    // ETa starts being throttled sooner → less cumulative ETa.
    const inputs = Array.from({ length: 20 }, (_, i) =>
      baseDay(`2026-05-${String(i + 1).padStart(2, '0')}`, { et0: 6, kc: 1.0 }),
    );
    const cereal = computeWaterBalance({ ...PARAMS, p: 0.55 }, inputs);
    const potato = computeWaterBalance({ ...PARAMS, p: 0.35 }, inputs);
    expect(potato.totalEta).toBeLessThan(cereal.totalEta);
  });
});

describe('computeWaterBalance — heavy-rain drainage pause (Geisenheim)', () => {
  it('triggers a 2-day pause after rain >30 mm/day, holding SWC at FC', () => {
    const inputs = [
      baseDay('2026-05-01', { precipitation: 50, et0: 4, kc: 1.0 }),
      baseDay('2026-05-02', { precipitation: 0, et0: 4, kc: 1.0 }),
      baseDay('2026-05-03', { precipitation: 0, et0: 4, kc: 1.0 }),
      baseDay('2026-05-04', { precipitation: 0, et0: 4, kc: 1.0 }),
    ];
    const r = computeWaterBalance(PARAMS, inputs);
    // Day 1 saturates → triggers pause. Days 2 and 3 are paused at FC.
    // Day 4 the pause has expired and ETa starts depleting again.
    expect(r.days[1].swc).toBeCloseTo(FC, 1);
    expect(r.days[1].eta).toBe(0);
    expect(r.days[2].swc).toBeCloseTo(FC, 1);
    expect(r.days[3].swc).toBeLessThan(FC);
  });

  it('routes precipitation falling on pause days into drainage (conservative bucket)', () => {
    // Day 1 triggers pause; days 2 + 3 are paused. Heavy rain on day 2
    // must show up as drainage instead of vanishing from the books.
    const inputs = [
      baseDay('2026-05-01', { precipitation: 50, et0: 4, kc: 1.0 }),
      baseDay('2026-05-02', { precipitation: 20, et0: 4, kc: 1.0 }),
      baseDay('2026-05-03', { precipitation: 5, et0: 4, kc: 1.0 }),
    ];
    const r = computeWaterBalance(PARAMS, inputs);
    expect(r.days[1].drainage).toBeCloseTo(20, 1);
    expect(r.days[2].drainage).toBeCloseTo(5, 1);
  });
});

describe('computeWaterBalance — bucket closure invariant', () => {
  // The bucket equation must close: P_in - ETa - drainage = ΔSWC.
  // This caught a bug where pause-day precipitation was added to totalPrecip
  // but never routed to drainage or ETa, leaking 100+ mm over a season.
  const closureError = (
    inputs: WaterBalanceInput[],
    startSwc: number,
    r: ReturnType<typeof computeWaterBalance>,
  ): number => {
    const endSwc = r.days.length > 0 ? r.days[r.days.length - 1].swc : startSwc;
    const totalDrainage = r.days.reduce((s, d) => s + d.drainage, 0);
    return (
      r.totalPrecipitation +
      r.totalIrrigated -
      r.totalEta -
      totalDrainage -
      (endSwc - startSwc)
    );
  };

  it('closes under a heavy-rain scenario that triggers the drainage pause', () => {
    const inputs = Array.from({ length: 14 }, (_, i) => {
      const day = String(i + 1).padStart(2, '0');
      // Two heavy-rain events plus moderate ET and small daily rain
      const precipitation = i === 0 ? 60 : i === 6 ? 45 : i % 2 === 0 ? 4 : 0;
      return baseDay(`2026-05-${day}`, { precipitation, et0: 5, kc: 1.0 });
    });
    const r = computeWaterBalance(PARAMS, inputs);
    expect(Math.abs(closureError(inputs, FC * 0.9, r))).toBeLessThan(1);
  });

  it('closes under sustained drought (ETa-driven depletion)', () => {
    const inputs = Array.from({ length: 60 }, (_, i) =>
      baseDay(
        `2026-06-${String((i % 30) + 1).padStart(2, '0')}`.replace(
          '06-31',
          '06-30',
        ),
        {
          precipitation: 0,
          et0: 6,
          kc: 1.1,
        },
      ),
    );
    const r = computeWaterBalance(PARAMS, inputs);
    expect(Math.abs(closureError(inputs, FC * 0.9, r))).toBeLessThan(1);
  });

  it('closes under irrigation refill', () => {
    const inputs = [
      baseDay('2026-07-01', { precipitation: 0, et0: 5, kc: 1.0 }),
      baseDay('2026-07-02', {
        precipitation: 0,
        et0: 5,
        kc: 1.0,
        irrigation: 25,
      }),
      baseDay('2026-07-03', { precipitation: 0, et0: 5, kc: 1.0 }),
    ];
    const r = computeWaterBalance(PARAMS, inputs);
    expect(Math.abs(closureError(inputs, FC * 0.9, r))).toBeLessThan(1);
  });
});

describe('computeWaterBalance — irrigation refill', () => {
  it('adds irrigation amount to SWC, capped at FC', () => {
    // Start at 0.9*FC=180, apply 30 mm irrigation, no ET, no rain.
    // Expected: SWC raw = 210, drainage 10, final SWC = FC = 200.
    const r = computeWaterBalance(PARAMS, [
      baseDay('2026-05-01', { irrigation: 30, et0: 0, kc: 0 }),
    ]);
    expect(r.days[0].swc).toBeCloseTo(FC, 1);
    expect(r.days[0].drainage).toBeCloseTo(10, 1);
    expect(r.totalIrrigated).toBeCloseTo(30);
  });
});

describe('computeWaterBalance — clamping + totals', () => {
  it('clamps SWC between PWP and FC across the run', () => {
    // 30 days of severe ET, no rain, no irrigation.
    const inputs = Array.from({ length: 30 }, (_, i) =>
      baseDay(`2026-05-${String(i + 1).padStart(2, '0')}`, { et0: 8, kc: 1.2 }),
    );
    const r = computeWaterBalance(PARAMS, inputs);
    for (const d of r.days) {
      expect(d.swc).toBeGreaterThanOrEqual(PWP);
      expect(d.swc).toBeLessThanOrEqual(FC);
    }
  });

  it('accumulates totals correctly', () => {
    const inputs = [
      baseDay('2026-05-01', {
        precipitation: 5,
        irrigation: 10,
        et0: 4,
        kc: 0.5,
      }),
      baseDay('2026-05-02', {
        precipitation: 2,
        irrigation: 0,
        et0: 4,
        kc: 0.5,
      }),
    ];
    const r = computeWaterBalance(PARAMS, inputs);
    expect(r.totalPrecipitation).toBeCloseTo(7);
    expect(r.totalIrrigated).toBeCloseTo(10);
    expect(r.totalEta).toBeGreaterThan(0);
  });

  it('currentDeficit reflects the last day', () => {
    const r = computeWaterBalance(PARAMS, [
      baseDay('2026-05-01', { kc: 1.0, et0: 8 }),
      baseDay('2026-05-02', { kc: 1.0, et0: 8 }),
    ]);
    expect(r.currentDeficit).toBeCloseTo(FC - r.days[1].swc, 1);
  });
});

describe('computeWaterBalance — deficit-level integration', () => {
  it('flags critical when fill drops below 30 % nFK', () => {
    // Run severe ET until well below the critical threshold.
    const inputs = Array.from({ length: 30 }, (_, i) =>
      baseDay(`2026-05-${String(i + 1).padStart(2, '0')}`, { et0: 8, kc: 1.2 }),
    );
    const r = computeWaterBalance(PARAMS, inputs);
    expect(r.deficitLevel).toBe('critical');
    expect(r.currentDeficit).toBeGreaterThan(AWC * 0.7);
  });

  it('stays ok when ET is light', () => {
    const inputs = Array.from({ length: 5 }, (_, i) =>
      baseDay(`2026-05-${String(i + 1).padStart(2, '0')}`, { et0: 1, kc: 0.5 }),
    );
    const r = computeWaterBalance(PARAMS, inputs);
    expect(r.deficitLevel).toBe('ok');
  });
});

describe('computeWaterBalance forecast flag', () => {
  const params = { fc: 90, pwp: 30, todayOverride: '2026-06-10' };
  const mkInput = (date: string) => ({
    date,
    precipitation: 0,
    et0: 3,
    kc: 1,
    irrigation: 0,
  });

  it('flags days after todayOverride as forecast and leaves the rest unflagged', () => {
    const result = computeWaterBalance(params, [
      mkInput('2026-06-09'),
      mkInput('2026-06-10'),
      mkInput('2026-06-11'),
      mkInput('2026-06-12'),
    ]);
    expect(result.days.map((d) => d.forecast)).toEqual([
      undefined,
      undefined,
      true,
      true,
    ]);
  });

  it('anchors currentDeficit at todayOverride, not at the forecast tail', () => {
    const result = computeWaterBalance(params, [
      mkInput('2026-06-09'),
      mkInput('2026-06-10'),
      mkInput('2026-06-11'),
      mkInput('2026-06-12'),
    ]);
    const todayDay = result.days.find((d) => d.date === '2026-06-10');
    expect(result.currentDeficit).toBe(todayDay?.deficit);
  });

  it('keeps the forecast flag through the heavy-rain drainage pause', () => {
    const result = computeWaterBalance(params, [
      mkInput('2026-06-10'),
      { date: '2026-06-11', precipitation: 40, et0: 3, kc: 1, irrigation: 0 },
      mkInput('2026-06-12'), // pause day
      mkInput('2026-06-13'), // pause day
    ]);
    expect(result.days[2].forecast).toBe(true);
    expect(result.days[3].forecast).toBe(true);
  });
});

describe('computeWaterBalance dual-Kc with explicit kcb (bare soil)', () => {
  // Wet-ish loam bucket with a fresh surface layer so Ke is active.
  const params = {
    fc: 90,
    pwp: 30,
    todayOverride: '2026-03-31',
    surface: { tew: 20, rew: 9, de0: 0 },
  };
  const bare = (date: string, precipitation = 0): WaterBalanceInput => ({
    date,
    precipitation,
    et0: 2,
    kc: 0.15,
    kcb: 0,
    irrigation: 0,
  });

  it('kcb 0 turns transpiration off: ETa equals the Ke surface term only', () => {
    // de0 = 0 (freshly wetted top layer) → Kr = 1, Ke = kcMax − kcb = 1.2.
    const result = computeWaterBalance(params, [bare('2026-03-01')]);
    expect(result.days[0].eta).toBeCloseTo(1.2 * 2, 1);
  });

  it('ETa decays to 0 once the top layer is evaporated dry (no rain)', () => {
    const inputs: WaterBalanceInput[] = [];
    for (let i = 1; i <= 30; i++) {
      inputs.push(bare(`2026-03-${String(i).padStart(2, '0')}`));
    }
    const result = computeWaterBalance(params, inputs);
    const last = result.days[result.days.length - 1];
    expect(last.eta).toBe(0);
    // The bucket only lost what the surface layer held (TEW = 20 mm), not a
    // full month of Kc-driven transpiration.
    expect(result.totalEta).toBeCloseTo(20, 0);
  });

  it('water balance still closes with kcb 0 (P − ETa − drainage = ΔSWC)', () => {
    const inputs = [
      bare('2026-03-01', 12),
      bare('2026-03-02'),
      bare('2026-03-03', 4),
      bare('2026-03-04'),
    ];
    const result = computeWaterBalance(params, inputs);
    const swcEnd = result.days[result.days.length - 1].swc;
    const drainage = result.days.reduce((s, d) => s + d.drainage, 0);
    // Start SWC = 0.9 · FC = 81 mm.
    expect(swcEnd).toBeCloseTo(
      81 + result.totalPrecipitation - result.totalEta - drainage,
      0,
    );
  });
});
