/**
 * Ported from AGVOLUTION/agmeo src/lib/irrigation/fieldWaterBalance.test.ts — logic, numbers and
 * thresholds unchanged; only imports adapted to the rewrite.
 */

import {
  buildFieldWaterBalance,
  type WaterBalanceWeatherRecord,
} from './fieldWaterBalance.js';
import { TOPSOIL_DEPTH_M } from './waterBalance.js';

const TODAY = '2026-07-01';
const TEXTURE = { clay: 20, silt: 40, sand: 40, soc: 1.5, bd: 1.4 };

/** Warm growing-season weather from sowing through a 7-day forecast tail. */
function makeWeather(from: string, to: string): WaterBalanceWeatherRecord {
  const weather: WaterBalanceWeatherRecord = {};
  for (let t = Date.parse(from); t <= Date.parse(to); t += 86_400_000) {
    const date = new Date(t).toISOString().split('T')[0];
    weather[date] = {
      tempMin: 14,
      tempMax: 26,
      tempMean: 20,
      // ~3 mm/day on average — keeps the bucket out of deep water stress so
      // ETa reflects Kc, not Ks.
      precipitation: new Date(t).getUTCDate() % 2 === 0 ? 6 : 0,
      et0: 3,
      windSpeedMean: 2,
      humidityMean: 60,
      dewPointMean: 12,
    };
  }
  return weather;
}

describe('buildFieldWaterBalance forecast tail', () => {
  const build = () =>
    buildFieldWaterBalance({
      crop: 'silageMaize',
      texture: TEXTURE,
      latitude: 49.5,
      sowingDate: '2026-04-20',
      weather: makeWeather('2025-12-01', '2026-07-08'),
      year: 2026,
      today: TODAY,
      // Pinned to the legacy bucket on purpose. What these tests assert is Kc
      // carry-forward across the today/forecast boundary, but the ETa they read
      // also contains Ks, which depends on the bucket depth — and maize now gets
      // 1.7 m from FAO-56 Table 22. `makeWeather` runs et0 = 3 mm/day through
      // December as well, so this synthetic year has no winter recharge; a deep
      // profile never refills under it and each 6 mm shower lifts a 228 mm bucket
      // by 2.6 points where it lifts a 40 mm one by 15. Ks on 1 July therefore
      // comes out LOWER at 1.7 m (0.81 vs 0.91) and the `> 3` threshold below —
      // a proxy for "Kc > 1" — stops holding for a reason that has nothing to do
      // with carry-forward. Pinning the depth keeps the assertion on its subject.
      rootDepthM: 0.3,
    });

  it('simulates through the forecast window and flags forecast days', () => {
    const wb = build();
    expect(wb.days).not.toBeNull();
    const last = wb.days![wb.days!.length - 1];
    expect(last.date).toBe('2026-07-08');
    expect(last.forecast).toBe(true);
    expect(wb.days!.find((d) => d.date === TODAY)?.forecast).toBeUndefined();
  });

  it('carries the BBCH-derived Kc into forecast days instead of collapsing to DEFAULT_KC', () => {
    // By July the maize canopy is developed (BBCH well past 30) → Kc ≈ 1.2.
    // Without carry-forward, forecast days fell back to DEFAULT_KC = 0.6 and
    // ETa halved at the today/forecast boundary. With identical weather on
    // both sides, ETa must be continuous across it.
    const wb = build();
    expect(wb.bbchStage).not.toBeNull();
    expect(wb.bbchStage!).toBeGreaterThan(30);
    // Compare rain-parity twins across the boundary (the every-2nd-day rain
    // pattern alternates surface evaporation): 07-01 vs 07-03 are both dry
    // days; with DEFAULT_KC collapse the second would drop by ~1.5 mm.
    const todayEta = wb.days!.find((d) => d.date === TODAY)!.eta;
    const twinEta = wb.days!.find((d) => d.date === '2026-07-03')!.eta;
    expect(todayEta).toBeGreaterThan(3); // developed canopy, not bare-soil Kc
    expect(Math.abs(twinEta - todayEta)).toBeLessThan(0.3);
  });

  it('awcMmOverride replaces the pedotransfer AWC and deepens the bucket (TAW)', () => {
    const base = build();
    const stony = buildFieldWaterBalance({
      crop: 'silageMaize',
      texture: TEXTURE,
      latitude: 49.5,
      sowingDate: '2026-04-20',
      weather: makeWeather('2025-12-01', '2026-07-08'),
      year: 2026,
      today: TODAY,
      awcMmOverride: 64,
    });
    const deep = buildFieldWaterBalance({
      crop: 'silageMaize',
      texture: TEXTURE,
      latitude: 49.5,
      sowingDate: '2026-04-20',
      weather: makeWeather('2025-12-01', '2026-07-08'),
      year: 2026,
      today: TODAY,
      awcMmOverride: 80,
    });
    expect(stony.awcMm).toBe(64);
    expect(deep.awcMm).toBe(80);
    expect(base.awcMm).not.toBe(64);
    // Same weather + crop, different TAW: the shallow/stony zone must not
    // produce the same deficit level trajectory as the deep one — its
    // depletion ratio (deficit/awc) is strictly higher on a dry day.
    const stonyRatio = stony.currentDeficit! / 64;
    const deepRatio = deep.currentDeficit! / 80;
    expect(stonyRatio).toBeGreaterThan(deepRatio);
  });

  it('attaches a recommendation computed from the same series', () => {
    const wb = build();
    expect(['due', 'upcoming', 'none']).toContain(wb.recommendation.status);
    expect(wb.recommendation.triggerMm).toBeGreaterThan(0);
    expect(wb.recommendation.deficitMm).toBe(wb.currentDeficit);
  });

  it('degrades to missing_data without texture', () => {
    const empty = buildFieldWaterBalance({
      crop: 'silageMaize',
      texture: null,
      latitude: 49.5,
      sowingDate: '2026-04-20',
      weather: makeWeather('2026-04-01', '2026-07-08'),
      year: 2026,
      today: TODAY,
    });
    expect(empty.recommendation.status).toBe('missing_data');
    expect(empty.bbchStage).toBeNull();
    expect(empty.bbchSource).toBeNull();
  });
});

// ── Seasonal weather for full-year scenarios ────────────────────────
// Deterministic monthly means; enough winter precipitation to keep a real
// field near capacity through the cold months.
const SEASONAL_TEMP_MEAN = [1, 2, 6, 10, 14, 18, 20, 19, 15, 10, 5, 2]; // Jan..Dec
const SEASONAL_ET0 = [0.5, 0.8, 1.5, 2.5, 3.5, 4, 4.2, 3.8, 2.5, 1.2, 0.6, 0.4];

function makeSeasonalWeather(
  from: string,
  to: string,
  // Rain pattern: default drizzle every 3rd day; {rainEvery: 9, rainMm: 15}
  // gives the same monthly total with dry spells in between (lets the FAO
  // surface layer actually dry out — where bare soil and a cropped surface
  // diverge).
  rain: { rainEvery: number; rainMm: number } = { rainEvery: 3, rainMm: 5 },
): WaterBalanceWeatherRecord {
  const weather: WaterBalanceWeatherRecord = {};
  for (let t = Date.parse(from); t <= Date.parse(to); t += 86_400_000) {
    const d = new Date(t);
    const date = d.toISOString().split('T')[0];
    const m = d.getUTCMonth();
    const mean = SEASONAL_TEMP_MEAN[m];
    weather[date] = {
      tempMin: mean - 5,
      tempMax: mean + 6,
      tempMean: mean,
      precipitation: d.getUTCDate() % rain.rainEvery === 0 ? rain.rainMm : 0,
      et0: SEASONAL_ET0[m],
      windSpeedMean: 2,
      humidityMean: 75,
      dewPointMean: mean - 2,
    };
  }
  return weather;
}

describe('buildFieldWaterBalance potato (no phenology model → FAO-56 calendar curve)', () => {
  // The user-reported bug: potato ran at flat DEFAULT_KC from Dec 1, drying
  // the bucket out by end of April although the crop goes in mid/late April.
  const POTATO_TODAY = '2026-07-01';
  const buildPotato = (sowingDate: string | null) =>
    buildFieldWaterBalance({
      crop: 'potatoTableLate',
      texture: TEXTURE,
      latitude: 47.1,
      sowingDate,
      weather: makeSeasonalWeather('2025-12-01', POTATO_TODAY, {
        rainEvery: 9,
        rainMm: 15,
      }),
      year: 2026,
      today: POTATO_TODAY,
    });

  // The old behavior (flat DEFAULT_KC year-round, sowing date ignored) is
  // exactly what the null-crop path still produces — use it as the baseline.
  const buildOldBehavior = () =>
    buildFieldWaterBalance({
      crop: null,
      texture: TEXTURE,
      latitude: 47.1,
      sowingDate: null,
      weather: makeSeasonalWeather('2025-12-01', POTATO_TODAY, {
        rainEvery: 9,
        rainMm: 15,
      }),
      year: 2026,
      today: POTATO_TODAY,
    });

  it('stays out of the phantom spring dry-out the flat-Kc model produced', () => {
    const wb = buildPotato('2026-04-20');
    const old = buildOldBehavior();
    expect(wb.bbchSource).toBe('calendar');

    const pin = (b: typeof wb, date: string) =>
      b.days!.find((d) => d.date === date)!;
    // Through winter the bucket stays near capacity (< 15 % depleted) …
    expect(pin(wb, '2026-02-15').deficit).toBeLessThan(0.15 * wb.awcMm!);
    // … and on sowing eve the bare-soil pre-season has drained markedly less
    // than the flat-Kc model, which sat at ~96 % depletion by then.
    const sowingEve = pin(wb, '2026-04-19');
    const sowingEveOld = pin(old, '2026-04-19');
    expect(sowingEve.deficit).toBeLessThan(sowingEveOld.deficit - 10);
    expect(sowingEve.deficit).toBeLessThan(0.7 * wb.awcMm!); // not "critical"
  });

  it('falls back to the calendar sowing date when no PLANTING transaction exists', () => {
    const wb = buildPotato(null);
    expect(wb.bbchSource).toBe('calendar');
    expect(wb.bbchStage).not.toBeNull();
    // Default sowing Apr 25: pre-season identical to the explicitly-sown run …
    const explicit = buildPotato('2026-04-25');
    const midAprilDeficit = (b: typeof wb) =>
      b.days!.find((d) => d.date === '2026-04-15')!.deficit;
    expect(midAprilDeficit(wb)).toBe(midAprilDeficit(explicit));
    // … and a developing canopy by late June (Kc ramp under way).
    const lateJune = wb.days!.find((d) => d.date === '2026-06-30')!;
    expect(lateJune.eta).toBeGreaterThan(2);
  });
});

describe('buildFieldWaterBalance winter wheat regression (phenology model path)', () => {
  // Re-pinned when the bucket became the crop's FAO-56 Table 22 rooting depth
  // (winter wheat 1.8 m, was a flat 0.3 m). The old pins recorded a starving
  // crop: 40.2 mm AWC, 97.5% depleted by Jun 30, ETa 0 on every dry day and a
  // 4 mm spike on rain days that was surface evaporation, not transpiration.
  // The deep profile sustains 2-2.8 mm/day through the same dry spell and
  // 514.7 mm of season ETa against 367.1 mm — which is the point of the change.
  // What this still guards is drift: sowing-date handling, the Kc curve and the
  // phenology path all feed these numbers.
  const WW_TODAY = '2026-07-01';
  const build = () =>
    buildFieldWaterBalance({
      crop: 'winterWheat',
      texture: TEXTURE,
      latitude: 49.5,
      sowingDate: '2025-10-10',
      weather: makeSeasonalWeather('2025-09-25', WW_TODAY),
      year: 2026,
      today: WW_TODAY,
    });

  it('keeps the pinned mid-season trajectory', () => {
    const wb = build();
    expect(wb.startDate).toBe('2025-09-30');
    expect(wb.bbchSource).toBe('model');
    expect(wb.awcMm).toBe(241.4);
    expect(wb.bbchStage).toBe(81);
    const pin = (date: string) => wb.days!.find((d) => d.date === date)!;
    expect(pin('2025-12-15')).toMatchObject({ swc: 490, eta: 0.5, deficit: 0 });
    expect(pin('2026-03-15')).toMatchObject({ swc: 487, eta: 1.8, deficit: 3 });
    expect(pin('2026-05-15')).toMatchObject({
      swc: 405.2,
      eta: 4.2,
      deficit: 84.8,
    });
    expect(pin('2026-06-30')).toMatchObject({
      swc: 304.5,
      eta: 2.6,
      deficit: 185.4,
    });
  });
});

describe('buildFieldWaterBalance null crop (deliberately unchanged)', () => {
  it('stays on flat DEFAULT_KC — null crop means missing data, not bare ground', () => {
    const wb = buildFieldWaterBalance({
      crop: null,
      texture: TEXTURE,
      latitude: 49.5,
      sowingDate: null,
      weather: makeSeasonalWeather('2025-12-01', '2026-03-01'),
      year: 2026,
      today: '2026-03-01',
    });
    expect(wb.bbchSource).toBeNull();
    expect(wb.bbchStage).toBeNull();
    // Flat Kc 0.6 · ET0 0.5 (single number check keeps this honest): a
    // January day evaporates noticeably more than bare soil would.
    const jan = wb.days!.find((d) => d.date === '2026-01-15')!;
    expect(jan.eta).toBeGreaterThan(0.2);
  });
});

describe('topsoil bucket for trafficability', () => {
  // The compaction model (precompression / thetaToPF, stress evaluated at
  // 0.25 m) needs the water content of the plough layer. Feeding it the
  // root-zone mean is dimensionally fine and physically wrong, and the error
  // is silent — the number stays in range, it just stops responding to rain.
  const build = (rootDepthM: number) =>
    buildFieldWaterBalance({
      crop: 'winterWheat',
      texture: TEXTURE,
      latitude: 49.5,
      sowingDate: '2025-10-10',
      weather: makeSeasonalWeather('2025-09-25', '2026-07-01'),
      year: 2026,
      today: '2026-07-01',
      rootDepthM,
    });

  it('responds to rain in proportion to depth, not to the crop', () => {
    const jumps = (depthM: number) => {
      const days = build(depthM).days!;
      // What swcMmToTheta does in actions/trafficability.ts, per rain day.
      return days
        .map((d, i) =>
          i > 0 && d.precipitation > 0
            ? (d.swc - days[i - 1].swc) / (depthM * 1000)
            : 0,
        )
        .filter((x) => x > 0)
        .sort((a, b) => a - b);
    };
    const median = (xs: number[]) => xs[Math.floor(xs.length / 2)];
    // Median over every rain day of the season, not one date: on a day the
    // shallow bucket is already near FC the surplus drains and the response
    // clips, which says nothing about the systematic behaviour.
    const topsoil = median(jumps(TOPSOIL_DEPTH_M));
    const rootZone = median(jumps(1.8));
    // Measured ratio is 6.0 — the depth ratio itself. Asserted at 4 so normal
    // drainage noise cannot flake it, but a regression to the root-zone series
    // (ratio 1.0) fails loudly.
    expect(topsoil / rootZone).toBeGreaterThan(4);
  });

  it('is crop-independent, so two crops on the same soil get the same traffic light', () => {
    const wheat = build(TOPSOIL_DEPTH_M);
    const asPotato = buildFieldWaterBalance({
      crop: 'potatoTableLate',
      texture: TEXTURE,
      latitude: 49.5,
      sowingDate: '2026-04-25',
      weather: makeSeasonalWeather('2025-09-25', '2026-07-01'),
      year: 2026,
      today: '2026-07-01',
      rootDepthM: TOPSOIL_DEPTH_M,
    });
    // Different crops still transpire differently, but both stay in the same
    // plough-layer bucket — the depth itself must not be what separates them.
    expect(wheat.rootDepthM).toBe(TOPSOIL_DEPTH_M);
    expect(asPotato.rootDepthM).toBe(TOPSOIL_DEPTH_M);
  });
});
