/**
 * Ported from AGVOLUTION/agmeo src/lib/weather/hourlyWindow.test.ts — logic, numbers and
 * thresholds unchanged; only imports adapted to the rewrite.
 */

import type { WeatherHourlyTimeseries } from '../types.js';

import {
  hourlyInstantsMs,
  rainWindowFor,
  sumHourlyPrecipitation,
} from './hourlyWindow.js';

/** `hours` consecutive wall-clock entries from `startLocal`, 1 mm each. */
function series(
  startLocal: string,
  hours: number,
  extra: Partial<WeatherHourlyTimeseries> = {},
): WeatherHourlyTimeseries {
  const base = Date.parse(`${startLocal}:00Z`);
  const time = Array.from({ length: hours }, (_, i) =>
    new Date(base + i * 3_600_000).toISOString().slice(0, 16),
  );
  return {
    time,
    temp: time.map(() => 15),
    humidity: time.map(() => 70),
    precipitation: time.map(() => 1),
    windSpeed: time.map(() => 10),
    windGusts: time.map(() => 20),
    ...extra,
  };
}

describe('hourlyInstantsMs', () => {
  it('reads a legacy payload as Berlin wall clock', () => {
    const [t] = hourlyInstantsMs({ time: ['2026-09-26T06:00'] });
    expect(new Date(t).toISOString()).toBe('2026-09-26T04:00:00.000Z');
  });

  it("applies the payload's fixed offset, even where a DST-aware zone would differ", () => {
    // Fetched in summer (offset +2 h) for a January hour: Open-Meteo wrote UTC + 2 h, so the
    // offset, not the zone's January offset (+1 h), gets the instant back.
    const [t] = hourlyInstantsMs({
      time: ['2026-01-10T06:00'],
      timezone: 'Europe/Berlin',
      utcOffsetSeconds: 7200,
    });
    expect(new Date(t).toISOString()).toBe('2026-01-10T04:00:00.000Z');
  });

  it("uses the payload's zone when only that is present", () => {
    const [t] = hourlyInstantsMs({
      time: ['2026-09-26T06:00'],
      timezone: 'America/Chicago',
    });
    expect(new Date(t).toISOString()).toBe('2026-09-26T11:00:00.000Z');
  });

  it('keeps explicit offsets as they are', () => {
    const [t] = hourlyInstantsMs({
      time: ['2026-09-26T06:00:00+02:00'],
      timezone: 'America/Chicago',
    });
    expect(new Date(t).toISOString()).toBe('2026-09-26T04:00:00.000Z');
  });
});

describe('sumHourlyPrecipitation', () => {
  const berlinWindow = rainWindowFor('2026-09-27', 'Europe/Berlin');

  it('sums the 24 hours of a 06:00 → 06:00 window, legacy and zoned payloads alike', () => {
    const legacy = series('2026-09-25T00:00', 72);
    const zoned = series('2026-09-25T00:00', 72, {
      timezone: 'Europe/Berlin',
      utcOffsetSeconds: 7200,
    });
    expect(
      sumHourlyPrecipitation(
        legacy,
        berlinWindow.startUtc,
        berlinWindow.endUtc,
      ),
    ).toEqual({ mm: 24, hours: 24 });
    expect(
      sumHourlyPrecipitation(zoned, berlinWindow.startUtc, berlinWindow.endUtc),
    ).toEqual({ mm: 24, hours: 24 });
  });

  it('excludes the end boundary and includes the start', () => {
    const zoned = series('2026-09-26T06:00', 25, { timezone: 'Europe/Berlin' });
    zoned.precipitation[0] = 5; // 06:00 on the 26th — inside
    zoned.precipitation[24] = 100; // 06:00 on the 27th — outside
    expect(
      sumHourlyPrecipitation(zoned, berlinWindow.startUtc, berlinWindow.endUtc),
    ).toEqual({ mm: 28, hours: 24 });
  });

  it('returns null when the window is mostly uncovered', () => {
    const zoned = series('2026-09-26T20:00', 10, { timezone: 'Europe/Berlin' });
    expect(
      sumHourlyPrecipitation(zoned, berlinWindow.startUtc, berlinWindow.endUtc),
    ).toBeNull();
    expect(
      sumHourlyPrecipitation(
        undefined,
        berlinWindow.startUtc,
        berlinWindow.endUtc,
      ),
    ).toBeNull();
  });

  it('counts 25 hours across the autumn DST night with a fixed-offset payload', () => {
    const window = rainWindowFor('2026-10-25', 'Europe/Berlin');
    expect(
      (window.endUtc.getTime() - window.startUtc.getTime()) / 3_600_000,
    ).toBe(25);
    // Fetched before the switch: every entry is UTC + 2 h, one per hour, no repeated 02:00.
    const hourly = series('2026-10-24T00:00', 48, {
      timezone: 'Europe/Berlin',
      utcOffsetSeconds: 7200,
    });
    // Window in payload time: 2026-10-24T06:00 (04:00Z) … 2026-10-25T07:00 (05:00Z) exclusive.
    const result = sumHourlyPrecipitation(
      hourly,
      window.startUtc,
      window.endUtc,
    );
    expect(result).toEqual({ mm: 25, hours: 25 });
  });
});

describe('rainWindowFor', () => {
  it('spans the previous local day 06:00 to the given day 06:00', () => {
    const window = rainWindowFor('2026-09-27', 'Australia/Adelaide');
    expect(window.startUtc.toISOString()).toBe('2026-09-25T20:30:00.000Z');
    expect(window.endUtc.toISOString()).toBe('2026-09-26T20:30:00.000Z');
    expect(window.startLocal).toBe('2026-09-26T06:00');
    expect(window.endLocal).toBe('2026-09-27T06:00');
  });
});
