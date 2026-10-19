import { bbox3857ToBounds, denormOf, harvestWindowOf, mapDailyPredictions, storedDays, storedValueOn } from './forecast.js';
import type { PredictResponse } from './types.js';

const day = (date: string, median: number) => ({ date, median });

describe('harvestWindowOf', () => {
  it('reads the window off the forecast when both thresholds are reached', () => {
    const w = harvestWindowOf([day('2026-09-01', 0.29), day('2026-09-02', 0.3), day('2026-09-03', 0.33), day('2026-09-04', 0.35)]);
    expect(w).toEqual({ start: '2026-09-02', end: '2026-09-04', estimated: false });
  });

  it('extrapolates the dry-down beyond the horizon', () => {
    // +0.5 pp per day, 29.5 % on the last day (08-17): 30 % one day later, 35 % eleven days later
    const daily = Array.from({ length: 8 }, (_, i) => day(`2026-08-${String(10 + i).padStart(2, '0')}`, 0.26 + 0.005 * i));
    const w = harvestWindowOf(daily);
    expect(w?.estimated).toBe(true);
    expect(w?.start).toBe('2026-08-18');
    expect(w?.end).toBe('2026-08-28');
  });

  it('marks an already open window from the first forecast day', () => {
    expect(harvestWindowOf([day('2026-09-10', 0.31), day('2026-09-11', 0.315)])?.start).toBe('2026-09-10');
  });

  it('is null without predictions or with a flat curve below the window', () => {
    expect(harvestWindowOf([])).toBeNull();
    expect(harvestWindowOf([day('2026-07-01', 0.2), day('2026-07-02', 0.2)])).toBeNull();
  });
});

describe('bbox3857ToBounds', () => {
  it('converts Web Mercator metres to degrees', () => {
    const b = bbox3857ToBounds([1113194.9, 6800125.5, 1224514.4, 6982997.9]);
    expect(b![0]).toBeCloseTo(10, 3);
    expect(b![1]).toBeCloseTo(52, 1);
    expect(b![2]).toBeCloseTo(11, 3);
    expect(b![3]).toBeCloseTo(53, 1);
    expect(bbox3857ToBounds(null)).toBeNull();
  });
});

describe('mapping and stored predictions', () => {
  const api: PredictResponse = {
    execution_id: '0b2f1c9e-4d0a-4a53-9d5f-1f2e3d4c5b6a',
    created_at: '2026-09-08T08:00:00Z',
    model_version: 'mech-2',
    scene: { date: '2026-09-06', age_days: 2, source: 'esm-sat-api' },
    calibration: null,
    field: { area_ha: 4.2, centroid: [10, 52], valid_pixels: 400, pixel_resolution_m: 10, bounding_box_epsg_3857: [0, 0, 1, 1] },
    daily_predictions: [
      { date: '2026-09-08', dm_mean: 0.3, dm_p10: 0.28, dm_p90: 0.32, dm_mean_uncalibrated: null, accumulated_gdd: 1300, temperature_mean_c: 15, valid_pixels: 400, url_png: '', url_tiff: '' },
      { date: '2026-09-09', dm_mean: 0.31, dm_p10: 0.29, dm_p90: 0.33, dm_mean_uncalibrated: null, accumulated_gdd: 1310, temperature_mean_c: 16, valid_pixels: 400, url_png: '', url_tiff: '' },
    ],
  };

  it('rewrites raster URLs to our org-scoped proxy', () => {
    const days = mapDailyPredictions(api, 'org-1', '10m');
    expect(days[1]).toMatchObject({ median: 0.31, q5: 0.29, q95: 0.33, accumulatedGdd: 1310 });
    expect(days[0].pngPath).toBe(`/orgs/org-1/maize-dmc/runs/${api.execution_id}/results/2026-09-08?output=png&resolution=10m`);
  });

  it('stores index-aligned arrays and reads a day back by index', () => {
    const d = denormOf(api);
    expect(d).toMatchObject({ pred_from_date: '2026-09-08', pred_medians: [0.3, 0.31], accumulated_gdd: 1300 });
    expect(storedDays(d).map((x) => x.date)).toEqual(['2026-09-08', '2026-09-09']);
    expect(storedValueOn(d, '2026-09-09')).toEqual({ median: 0.31, q5: 0.29, q95: 0.33 });
    expect(storedValueOn(d, '2026-09-20')).toBeNull();
  });
});
