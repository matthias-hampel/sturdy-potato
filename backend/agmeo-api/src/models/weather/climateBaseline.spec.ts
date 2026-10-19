/**
 * Ported from AGVOLUTION/agmeo src/lib/weather/climateBaseline.test.ts — logic, numbers and
 * thresholds unchanged; only imports adapted to the rewrite.
 */

import {
  addDays,
  bboxCentroid,
  type ClimateDaily,
  type ClimateMetric,
  computeBaselines,
  computeSeasonMetrics,
  daysBetween,
  minDate,
  shiftYears,
} from './climateBaseline.js';

/** Build a flat daily series of `n` days from `start`, applying an overrides fn. */
function series(
  start: string,
  n: number,
  fn: (i: number, date: string) => Partial<ClimateDaily>,
): ClimateDaily[] {
  const out: ClimateDaily[] = [];
  for (let i = 0; i < n; i++) {
    const date = addDays(start, i);
    out.push({ date, tempMin: 10, tempMax: 20, precipMm: 0, ...fn(i, date) });
  }
  return out;
}

describe('date helpers', () => {
  it('shiftYears keeps month-day and clamps Feb-29', () => {
    expect(shiftYears('2024-05-01', -10)).toBe('2014-05-01');
    expect(shiftYears('2024-02-29', -1)).toBe('2023-02-28'); // 2023 not a leap year
    expect(shiftYears('2020-02-29', -4)).toBe('2016-02-29'); // 2016 is a leap year
  });
  it('addDays crosses month/year boundaries via UTC', () => {
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDays('2024-12-31', 1)).toBe('2025-01-01');
  });
  it('daysBetween + minDate', () => {
    expect(daysBetween('2024-01-01', '2024-01-11')).toBe(10);
    expect(daysBetween('2024-03-01', '2024-02-28')).toBe(-2);
    expect(minDate('2024-05-01', '2024-04-30')).toBe('2024-04-30');
  });
});

describe('bboxCentroid', () => {
  it('returns the bounding-box centre of a polygon', () => {
    const poly = {
      type: 'Polygon',
      coordinates: [
        [
          [10, 50],
          [12, 50],
          [12, 52],
          [10, 52],
          [10, 50],
        ],
      ],
    };
    expect(bboxCentroid(poly)).toEqual([11, 51]);
  });
  it('returns null for empty/invalid geometry', () => {
    expect(bboxCentroid(null)).toBeNull();
    expect(bboxCentroid({})).toBeNull();
  });
});

describe('computeSeasonMetrics', () => {
  it('sums precipitation and counts hot days', () => {
    const daily = series('2024-06-01', 10, (i) => ({
      precipMm: i, // 0..9 → sum 45
      tempMax: i < 3 ? 31 : 20, // 3 hot days (≥30)
    }));
    const m = computeSeasonMetrics(daily);
    expect(m.seasonPrecip).toBe(45);
    expect(m.hotDays).toBe(3);
  });

  it('finds the longest dry spell (< 1 mm)', () => {
    const daily = series('2024-06-01', 8, (i) => ({
      precipMm: [0, 0, 0, 5, 0, 0, 10, 0][i],
    }));
    expect(computeSeasonMetrics(daily).maxDrySpell).toBe(3);
  });

  it('leaves winter metrics null when the window has no winter days', () => {
    const daily = series('2024-06-01', 30, () => ({}));
    const m = computeSeasonMetrics(daily);
    expect(m.winterMinTemp).toBeNull();
    expect(m.hardFrostDays).toBeNull();
  });

  it('computes winter min temp + hard-frost days inside winter', () => {
    const daily = series('2024-01-01', 20, (i) => ({
      tempMin: i < 4 ? -15 : -5, // 4 days ≤ -12
    }));
    const m = computeSeasonMetrics(daily);
    expect(m.winterMinTemp).toBe(-15);
    expect(m.hardFrostDays).toBe(4);
  });

  it('marks diseaseFavorableDays null without humidity data', () => {
    const daily = series('2024-06-01', 5, () => ({}));
    expect(computeSeasonMetrics(daily).diseaseFavorableDays).toBeNull();
  });
});

describe('computeBaselines', () => {
  it('reduces per-year metric values to mean/sd/percentiles', () => {
    const perYear: Array<Record<ClimateMetric, number | null>> = [
      10, 20, 30, 40, 50,
    ].map(
      (v) =>
        ({
          seasonPrecip: v,
          springPrecip: null,
          maxDrySpell: 0,
          winterMinTemp: null,
          hardFrostDays: null,
          springOnsetDoy: null,
          gddSum: 0,
          hotDays: 0,
          radiationSum: null,
          windPeak: null,
          stormDays: null,
          diseaseFavorableDays: null,
        }) as Record<ClimateMetric, number | null>,
    );
    const base = computeBaselines(perYear);
    expect(base.seasonPrecip.mean).toBe(30);
    expect(base.seasonPrecip.p50).toBe(30);
    expect(base.seasonPrecip.years).toBe(5);
    expect(base.seasonPrecip.sd).toBeGreaterThan(0);
    // metrics that were null every year are omitted entirely
    expect(base.winterMinTemp).toBeUndefined();
  });

  it('drops per-year nulls so partial coverage still yields a baseline', () => {
    const perYear = [
      { seasonPrecip: 100 },
      { seasonPrecip: null },
      { seasonPrecip: 200 },
    ] as Array<Record<ClimateMetric, number | null>>;
    const base = computeBaselines(perYear);
    expect(base.seasonPrecip.mean).toBe(150);
    expect(base.seasonPrecip.years).toBe(2);
  });
});
