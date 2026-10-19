import { describe, expect, it } from 'vitest';
import { aggregateDaily, dueCells, isInCrawlSlot, localParts, refreshedToday, wantedStart } from './weather-store.js';

const berlin = 'Europe/Berlin';

describe('crawl slot', () => {
  it('is 04:30–05:30 on the local clock, also across daylight saving time', () => {
    // 02:45 UTC = 04:45 CEST (summer), 03:45 CET (winter).
    expect(isInCrawlSlot(new Date('2026-07-01T02:45:00Z'), berlin)).toBe(true);
    expect(isInCrawlSlot(new Date('2026-01-15T02:45:00Z'), berlin)).toBe(false);
    expect(isInCrawlSlot(new Date('2026-01-15T03:45:00Z'), berlin)).toBe(true);
    expect(isInCrawlSlot(new Date('2026-01-15T04:30:00Z'), berlin)).toBe(false);
    expect(localParts(new Date('2026-01-15T23:30:00Z'), berlin)).toEqual({ date: '2026-01-16', minutes: 30 });
  });

  it('counts a refresh after local 04:00 of the same day as fresh', () => {
    const now = new Date('2026-01-15T04:00:00Z'); // 05:00 local
    expect(refreshedToday(new Date('2026-01-15T03:10:00Z'), now, berlin)).toBe(true); // 04:10 local
    expect(refreshedToday(new Date('2026-01-15T02:50:00Z'), now, berlin)).toBe(false); // 03:50 local
  });
});

describe('due cells', () => {
  const cell = { lat: 52.3, lng: 9.9, timezones: [berlin], seasonStart: '2025-08-01' };
  const inSlot = new Date('2026-01-15T03:45:00Z');
  const outside = new Date('2026-01-15T12:00:00Z');

  it('fetches new cells at once with their backfill', () => {
    expect(dueCells([cell], [], outside)).toEqual([{ cell, backfill: true }]);
  });

  it('refreshes known cells in the morning slot only, once', () => {
    const state = { lat: 52.3, lng: 9.9, backfilledFrom: wantedStart(cell, '2026-01-15'), refreshedAt: new Date('2026-01-14T03:40:00Z') };
    expect(dueCells([cell], [state], outside)).toEqual([]);
    expect(dueCells([cell], [state], inSlot)).toEqual([{ cell, backfill: false }]);
    expect(dueCells([cell], [{ ...state, refreshedAt: new Date('2026-01-15T03:35:00Z') }], inSlot)).toEqual([]);
  });

  it('asks for no more than the forecast API reaches without an archive', () => {
    expect(wantedStart(cell, '2026-01-15', false)).toBe('2025-10-15');
    expect(wantedStart(cell, '2026-01-15', true)).toBe('2025-08-01');
    expect(wantedStart({ ...cell, seasonStart: '2025-12-01' }, '2026-01-15', false)).toBe('2025-12-01');
  });
});

describe('daily aggregation', () => {
  const soil = { temp0: 'st0', temp7: 'st7', moist0: 'sm0', moist7: 'sm7' };
  const time = Array.from({ length: 30 }, (_, i) => `2026-05-0${1 + Math.floor(i / 24)}T${String(i % 24).padStart(2, '0')}:00`);
  const hourly = {
    time,
    temperature_2m: time.map((_, i) => (i % 24) / 2),
    relative_humidity_2m: time.map(() => 80),
    dew_point_2m: time.map(() => 5),
    precipitation: time.map((_, i) => (i === 3 ? 2.4 : 0.1)),
    wind_speed_10m: time.map((_, i) => i % 10),
    wind_gusts_10m: time.map((_, i) => (i % 10) * 2),
    et0_fao_evapotranspiration: time.map(() => 0.1),
    shortwave_radiation: time.map(() => 100),
    st0: time.map(() => 10),
    st7: time.map(() => 9),
    sm0: time.map(() => 0.3),
    sm7: time.map(() => 0.31),
  };

  it('sums and averages per local day and drops partial days', () => {
    const days = aggregateDaily(hourly as unknown as Parameters<typeof aggregateDaily>[0], soil);
    expect(days).toHaveLength(1);
    expect(days[0]).toMatchObject({
      date: '2026-05-01',
      temp_min: 0,
      temp_max: 11.5,
      temp_mean: 5.8,
      precipitation: 4.7,
      humidity_mean: 80,
      wind_speed_max: 9,
      wind_gusts_max: 18,
      et0: 2.4,
      radiation_sum: 8.6,
      soil_temp_0_7: 10,
      soil_moisture_7_28: 0.31,
    });
  });
});
