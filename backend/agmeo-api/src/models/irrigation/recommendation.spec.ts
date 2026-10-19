/**
 * Ported from AGVOLUTION/agmeo src/lib/irrigation/recommendation.test.ts — logic, numbers and
 * thresholds unchanged; only imports adapted to the rewrite.
 */

import {
  BASE_TRIGGER_DEPLETION,
  computeIrrigationRecommendation,
  HEAT_STRESS_TMAX,
  MAX_DOSE_MM,
  MIN_DOSE_MM,
  type RecommendationInput,
  SENSITIVE_TRIGGER_DEPLETION,
} from './recommendation.js';
import { getDeficitLevel, type WaterBalanceDay } from './waterBalance.js';

const TODAY = '2026-06-10';
const FC = 90; // mm
const PWP = 30; // mm
const AWC = FC - PWP; // 60 mm → base trigger 30 mm, sensitive trigger 24 mm

function day(
  date: string,
  deficit: number,
  overrides: Partial<WaterBalanceDay> = {},
): WaterBalanceDay {
  return {
    date,
    swc: FC - deficit,
    eta: 3,
    precipitation: 0,
    irrigation: 0,
    drainage: 0,
    deficit,
    ...(date > TODAY ? { forecast: true } : {}),
    ...overrides,
  };
}

function dateOffset(days: number): string {
  return new Date(Date.parse(TODAY) + days * 86_400_000)
    .toISOString()
    .split('T')[0];
}

/** Series: past days before TODAY, then TODAY, then 7 forecast days with given deficits. */
function series(
  todayDeficit: number,
  forecastDeficits: number[],
  overridesByDate: Record<string, Partial<WaterBalanceDay>> = {},
): WaterBalanceDay[] {
  const days: WaterBalanceDay[] = [
    day(dateOffset(-2), Math.max(0, todayDeficit - 4)),
    day(dateOffset(-1), Math.max(0, todayDeficit - 2)),
    day(TODAY, todayDeficit),
  ];
  forecastDeficits.forEach((deficit, i) => {
    days.push(day(dateOffset(i + 1), deficit));
  });
  return days.map((d) => ({ ...d, ...(overridesByDate[d.date] ?? {}) }));
}

function input(
  overrides: Partial<RecommendationInput> = {},
): RecommendationInput {
  return {
    crop: 'winterWheat',
    fcMm: FC,
    awcMm: AWC,
    days: series(10, [12, 14, 16, 18, 20, 22, 24]),
    today: TODAY,
    ...overrides,
  };
}

describe('computeIrrigationRecommendation', () => {
  it('returns missing_data without days or usable AWC', () => {
    expect(computeIrrigationRecommendation(input({ days: null })).status).toBe(
      'missing_data',
    );
    expect(computeIrrigationRecommendation(input({ days: [] })).status).toBe(
      'missing_data',
    );
    expect(computeIrrigationRecommendation(input({ awcMm: 0 })).status).toBe(
      'missing_data',
    );
    expect(computeIrrigationRecommendation(input({ fcMm: null })).status).toBe(
      'missing_data',
    );
  });

  it('is none when the deficit never crosses the trigger within the horizon', () => {
    const rec = computeIrrigationRecommendation(input());
    expect(rec.status).toBe('none');
    expect(rec.triggerDate).toBeUndefined();
    expect(rec.doseMm).toBeUndefined();
    expect(rec.deficitMm).toBe(10);
    expect(rec.nfkPct).toBe(83); // (60-10)/60
    expect(rec.triggerMm).toBe(BASE_TRIGGER_DEPLETION * AWC);
  });

  it('is due today when the deficit is at/above 50% AWC, with the deficit reason', () => {
    const rec = computeIrrigationRecommendation(
      input({ days: series(32, [34, 36, 38, 40, 42, 44, 46]) }),
    );
    expect(rec.status).toBe('due');
    expect(rec.daysUntil).toBe(0);
    expect(rec.triggerDate).toBe(TODAY);
    expect(rec.reasons).toContain('deficit_below_trigger');
    // Dose: refill 0.9·90 − (90−32) = 81 − 58 = 23 → round5 = 25
    expect(rec.doseMm).toBe(25);
  });

  it('is upcoming with correct daysUntil on a drying ramp', () => {
    // Crosses 30 mm on day +3
    const rec = computeIrrigationRecommendation(
      input({ days: series(24, [26, 28, 31, 33, 35, 37, 39]) }),
    );
    expect(rec.status).toBe('upcoming');
    expect(rec.daysUntil).toBe(3);
    expect(rec.triggerDate).toBe(dateOffset(3));
    expect(rec.doseMm).toBeGreaterThanOrEqual(MIN_DOSE_MM);
  });

  it('stays none when forecast rain keeps the series under the trigger (rain is already simulated)', () => {
    // Deficit climbs then rain resets it — series reflects the rain.
    const rec = computeIrrigationRecommendation(
      input({ days: series(26, [28, 29, 8, 10, 12, 14, 16]) }),
    );
    expect(rec.status).toBe('none');
  });

  it('downgrades a due to upcoming when near rain recovers the deficit (rain_expected)', () => {
    // Due today (32 ≥ 30) but heavy rain tomorrow pulls the simulated deficit
    // back under the trigger; re-crosses at +5.
    const days = series(32, [10, 12, 20, 26, 31, 33, 35], {
      [dateOffset(1)]: { precipitation: 18 },
    });
    const rec = computeIrrigationRecommendation(input({ days }));
    expect(rec.status).toBe('upcoming');
    expect(rec.reasons).toContain('rain_expected');
    expect(rec.triggerDate).toBe(dateOffset(5));
  });

  it('keeps a due when rain is too small to matter', () => {
    const days = series(32, [33, 34, 36, 38, 40, 42, 44], {
      [dateOffset(1)]: { precipitation: 2 },
    });
    const rec = computeIrrigationRecommendation(input({ days }));
    expect(rec.status).toBe('due');
  });

  it('advances an upcoming trigger to the day before a heat-stress day (heat_stress_ahead)', () => {
    // Crossing at +4, heat day at +3 (Tmax 31 ≥ winterWheat threshold 30)
    // → recommend +2 (day before heat day).
    const rec = computeIrrigationRecommendation(
      input({
        days: series(24, [26, 28, 29, 31, 33, 35, 37]),
        tempMaxByDate: { [dateOffset(3)]: 31 },
      }),
    );
    expect(rec.status).toBe('upcoming');
    expect(rec.reasons).toContain('heat_stress_ahead');
    expect(rec.triggerDate).toBe(dateOffset(2));
    expect(rec.daysUntil).toBe(2);
    expect(rec.heatStressDays).toEqual([dateOffset(3)]);
  });

  it('flags heat stress on a due when a heat day is imminent', () => {
    const rec = computeIrrigationRecommendation(
      input({
        days: series(32, [34, 36, 38, 40, 42, 44, 46]),
        tempMaxByDate: { [dateOffset(2)]: 32 },
      }),
    );
    expect(rec.status).toBe('due');
    expect(rec.reasons).toContain('heat_stress_ahead');
  });

  it('respects per-crop heat thresholds', () => {
    // 31 °C is a stress day for winterWheat (30) but not for grainMaize (34).
    const tempMaxByDate = { [dateOffset(2)]: 31 };
    const wheat = computeIrrigationRecommendation(input({ tempMaxByDate }));
    const maize = computeIrrigationRecommendation(
      input({ crop: 'grainMaize', tempMaxByDate }),
    );
    expect(wheat.heatStressDays).toEqual([dateOffset(2)]);
    expect(maize.heatStressDays).toBeUndefined();
    expect(HEAT_STRESS_TMAX.grainMaize).toBe(34);
  });

  it('tightens the trigger inside a sensitive BBCH window (sensitive_stage)', () => {
    // Deficit 26 mm: under the base trigger (30) but over the sensitive one (24).
    const days = series(26, [27, 28, 29, 29, 29, 29, 29]);
    const vegetative = computeIrrigationRecommendation(
      input({ days, bbchStage: 25 }),
    );
    expect(vegetative.status).toBe('none');

    const flowering = computeIrrigationRecommendation(
      input({ days, bbchStage: 65 }),
    );
    expect(flowering.status).toBe('due');
    expect(flowering.reasons).toContain('sensitive_stage');
    expect(flowering.triggerMm).toBe(SENSITIVE_TRIGGER_DEPLETION * AWC);
    expect(flowering.bbchStage).toBe(65);
  });

  it('clamps the dose to [MIN_DOSE_MM, MAX_DOSE_MM] and subtracts expected rain', () => {
    // Huge deficit → unclamped dose would be ~0.9·90−(90−55)=46 → capped at 35.
    const deep = computeIrrigationRecommendation(
      input({ days: series(55, [56, 57, 58, 58, 58, 58, 58]) }),
    );
    expect(deep.doseMm).toBe(MAX_DOSE_MM);

    // Just-crossed deficit with lots of later rain → floor at MIN_DOSE_MM.
    const rainy = series(31, [32, 33, 34, 34, 34, 34, 34], {
      [dateOffset(3)]: { precipitation: 15 },
      [dateOffset(4)]: { precipitation: 15 },
    });
    // nearRain (first 2 days) is 0 → stays due; dose = 81−59−30 → round5(-8) → clamped to 10.
    const rec = computeIrrigationRecommendation(input({ days: rainy }));
    expect(rec.status).toBe('due');
    expect(rec.doseMm).toBe(MIN_DOSE_MM);
  });

  it('never disagrees with getDeficitLevel: warning/critical today ⟹ due (absent rain recovery)', () => {
    // Sweep deficits; no rain in the forecast, monotone drying.
    for (let deficit = 0; deficit <= AWC; deficit += 3) {
      const rec = computeIrrigationRecommendation(
        input({
          days: series(deficit, [
            deficit + 1,
            deficit + 2,
            deficit + 3,
            deficit + 4,
            deficit + 5,
            deficit + 6,
            deficit + 7,
          ]),
          bbchStage: null,
        }),
      );
      const level = getDeficitLevel(deficit, AWC);
      if (level === 'warning' || level === 'critical') {
        expect(rec.status).toBe('due');
      }
      if (rec.status === 'due') {
        expect(deficit).toBeGreaterThanOrEqual(BASE_TRIGGER_DEPLETION * AWC);
      }
    }
  });

  it('anchors to the last non-forecast day when today is missing from the series', () => {
    const days = [
      day(dateOffset(-3), 31),
      day(dateOffset(-2), 32),
      day(dateOffset(1), 33),
    ];
    const rec = computeIrrigationRecommendation(input({ days }));
    expect(rec.status).toBe('due');
    expect(rec.deficitMm).toBe(32);
  });
});
