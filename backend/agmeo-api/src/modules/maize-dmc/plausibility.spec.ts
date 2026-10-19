import { assessRunPlausibility } from './plausibility.js';

const healthyWeather = {
  days_total: 140,
  days_supplied: 0,
  days_fetched: 140,
  days_fallback: 0,
  sources: ['historical_forecast', 'forecast'],
};

describe('assessRunPlausibility — GDD jump guard', () => {
  const previous = [
    { runDate: '2026-09-07', sowingDate: '2026-04-29', accumulatedGdd: 1297.8 },
  ];

  it('accepts a normal day-over-day increment', () => {
    const v = assessRunPlausibility({
      runDate: '2026-09-08',
      sowingDate: '2026-04-29',
      accumulatedGdd: 1308.8,
      weather: healthyWeather,
      previous,
    });
    expect(v.ok).toBe(true);
  });

  it('rejects the 2026-09-08 incident shape (+~290 GDD overnight)', () => {
    const v = assessRunPlausibility({
      runDate: '2026-09-08',
      sowingDate: '2026-04-29',
      accumulatedGdd: 1594.8,
      weather: undefined, // pre-0.3.3 service: no provenance
      previous,
    });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toMatch(/excess 277 GDD/);
  });

  it('scales the allowance with the days since the reference run', () => {
    const v = assessRunPlausibility({
      runDate: '2026-09-12',
      sowingDate: '2026-04-29',
      accumulatedGdd: 1297.8 + 5 * 20 + 59,
      weather: healthyWeather,
      previous,
    });
    expect(v.ok).toBe(true);
  });

  it('ignores references older than two weeks', () => {
    const v = assessRunPlausibility({
      runDate: '2026-09-30',
      sowingDate: '2026-04-29',
      accumulatedGdd: 1297.8 + 900,
      weather: healthyWeather,
      previous,
    });
    expect(v.ok).toBe(true);
  });

  it('lets a changed sowing date through (GDD legitimately moves)', () => {
    const v = assessRunPlausibility({
      runDate: '2026-09-08',
      sowingDate: '2026-04-10',
      accumulatedGdd: 1594.8,
      weather: healthyWeather,
      previous,
    });
    expect(v.ok).toBe(true);
  });

  it('accepts a first run (no reference) and a reference without GDD', () => {
    expect(
      assessRunPlausibility({
        runDate: '2026-09-08',
        sowingDate: '2026-04-29',
        accumulatedGdd: 1594.8,
        weather: healthyWeather,
        previous: null,
      }).ok,
    ).toBe(true);
    expect(
      assessRunPlausibility({
        runDate: '2026-09-08',
        sowingDate: '2026-04-29',
        accumulatedGdd: 1594.8,
        weather: healthyWeather,
        previous: [{ ...previous[0], accumulatedGdd: null }],
      }).ok,
    ).toBe(true);
  });

  it('uses the highest GDD of the recent runs as reference — one inconsistent Open-Meteo day cannot fail today', () => {
    // Field 16380dda…, 2026-09-09: refs 1667.4 (09-07), 1611.5 (09-08 standard, inconsistent), 1683.9 (09-08 calibrated)
    const recent = [
      {
        runDate: '2026-09-08',
        sowingDate: '2026-04-28',
        accumulatedGdd: 1611.5,
      },
      {
        runDate: '2026-09-08',
        sowingDate: '2026-04-28',
        accumulatedGdd: 1683.9,
      },
      {
        runDate: '2026-09-07',
        sowingDate: '2026-04-28',
        accumulatedGdd: 1667.4,
      },
    ];
    const v = assessRunPlausibility({
      runDate: '2026-09-09',
      sowingDate: '2026-04-28',
      accumulatedGdd: 1716.3,
      weather: healthyWeather,
      previous: recent,
    });
    expect(v.ok).toBe(true);
    // …but the incident magnitude is still rejected against the highest reference
    const bad = assessRunPlausibility({
      runDate: '2026-09-09',
      sowingDate: '2026-04-28',
      accumulatedGdd: 1683.9 + 20 + 290,
      weather: healthyWeather,
      previous: recent,
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.reason).toMatch(/highest of 3 recent run/);
  });

  it('tolerates the cached-vs-fetched source drift (≤ 125 GDD beyond the per-day allowance)', () => {
    // Field 9e16624d…, 2026-09-09: cache series 5.8 % above the service's fetch → excess 110
    const v = assessRunPlausibility({
      runDate: '2026-09-08',
      sowingDate: '2026-04-29',
      accumulatedGdd: 1297.8 + 20 + 110,
      weather: healthyWeather,
      previous,
    });
    expect(v.ok).toBe(true);
  });

  it('rejects a response that admits padded weather beyond the today row', () => {
    const v = assessRunPlausibility({
      runDate: '2026-09-08',
      sowingDate: '2026-04-29',
      accumulatedGdd: 1308.8,
      weather: { ...healthyWeather, days_fallback: 132 },
      previous: null,
    });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toMatch(/fallback on 132\/140 days/);
  });

  it('tolerates the single today-row fallback', () => {
    const v = assessRunPlausibility({
      runDate: '2026-09-08',
      sowingDate: '2026-04-29',
      accumulatedGdd: 1308.8,
      weather: { ...healthyWeather, days_fallback: 1 },
      previous,
    });
    expect(v.ok).toBe(true);
  });
});

describe('assessRunPlausibility — bounded weather fallback (maize-dmc-api >= 0.3.4)', () => {
  const base = {
    runDate: '2026-09-08',
    sowingDate: '2026-04-29',
    accumulatedGdd: 1308.8,
    previous: null,
  };
  const recentMean = (dates: string[]) => ({
    ...healthyWeather,
    days_fallback: dates.length,
    fallback_kind: 'recent_mean' as const,
    fallback_dates: dates,
  });

  it('accepts a recent-mean bridge of up to three past days plus the forecast horizon', () => {
    const dates = [
      '2026-09-06',
      '2026-09-07',
      '2026-09-08',
      '2026-09-09',
      '2026-09-10',
      '2026-09-11',
    ];
    expect(
      assessRunPlausibility({ ...base, weather: recentMean(dates) }).ok,
    ).toBe(true);
  });

  it('rejects a recent-mean bridge spanning more than three past days', () => {
    const dates = [
      '2026-09-04',
      '2026-09-05',
      '2026-09-06',
      '2026-09-07',
      '2026-09-08',
    ];
    const v = assessRunPlausibility({ ...base, weather: recentMean(dates) });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toMatch(/bridged 4 past days/);
  });

  it('still rejects a legacy multi-day pad without a fallback kind', () => {
    const v = assessRunPlausibility({
      ...base,
      weather: { ...healthyWeather, days_fallback: 5 },
    });
    expect(v.ok).toBe(false);
  });
});
