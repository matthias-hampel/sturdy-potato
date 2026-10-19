import {
  buildWeatherBlock,
  DMC_FORECAST_HORIZON_DAYS,
  type StoredWeatherDay,
} from './weather-block.js';

function series(
  from: string,
  to: string,
  tmean = 16,
  precip = 1,
): Record<string, StoredWeatherDay> {
  const out: Record<string, StoredWeatherDay> = {};
  const d = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (d.getTime() <= end.getTime()) {
    out[d.toISOString().slice(0, 10)] = {
      tempMean: tmean,
      precipitation: precip,
    };
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

const today = '2026-09-08';
const now = new Date('2026-09-08T10:00:00Z');
const fresh = new Date('2026-09-08T04:04:00Z');

describe('buildWeatherBlock', () => {
  it('maps sowing..today+7 to tmean_c/precip_mm only, sorted', () => {
    const block = buildWeatherBlock({
      series: series('2026-03-01', '2026-09-22'),
      lastUpdated: fresh,
      sowingDate: '2026-04-29',
      today,
      now,
    });
    expect(block).not.toBeNull();
    const daily = block!.daily;
    expect(daily[0].date).toBe('2026-04-29');
    expect(daily[daily.length - 1].date).toBe(
      `2026-09-${8 + DMC_FORECAST_HORIZON_DAYS}`,
    );
    expect(daily).toHaveLength(140);
    expect(Object.keys(daily[0]).sort()).toEqual([
      'date',
      'precip_mm',
      'tmean_c',
    ]);
  });

  it('drops days without a usable mean temperature and clamps negative precipitation', () => {
    const s = series('2026-08-01', '2026-09-15');
    s['2026-08-10'] = { tempMean: null, precipitation: 2 };
    s['2026-08-11'] = { tempMean: 99, precipitation: 2 };
    s['2026-08-12'] = { tempMean: 15, precipitation: -0.4 };
    s['2026-08-13'] = { tempMean: 15, precipitation: null };
    const block = buildWeatherBlock({
      series: s,
      lastUpdated: fresh,
      sowingDate: '2026-08-01',
      today,
      now,
    });
    const dates = block!.daily.map((d) => d.date);
    expect(dates).not.toContain('2026-08-10');
    expect(dates).not.toContain('2026-08-11');
    expect(block!.daily.find((d) => d.date === '2026-08-12')?.precip_mm).toBe(
      0,
    );
    expect(block!.daily.find((d) => d.date === '2026-08-13')?.precip_mm).toBe(
      0,
    );
  });

  it('returns null for stale weather (> 48 h) or a missing series', () => {
    expect(
      buildWeatherBlock({
        series: series('2026-04-01', '2026-09-22'),
        lastUpdated: new Date('2026-09-05T04:00:00Z'),
        sowingDate: '2026-04-29',
        today,
        now,
      }),
    ).toBeNull();
    expect(
      buildWeatherBlock({
        series: null,
        lastUpdated: fresh,
        sowingDate: '2026-04-29',
        today,
        now,
      }),
    ).toBeNull();
    expect(
      buildWeatherBlock({
        series: {},
        lastUpdated: null,
        sowingDate: '2026-04-29',
        today,
        now,
      }),
    ).toBeNull();
  });

  it('returns null when fewer than 80 % of the days are covered', () => {
    // 46 of 140 days
    expect(
      buildWeatherBlock({
        series: series('2026-08-01', '2026-09-15'),
        lastUpdated: fresh,
        sowingDate: '2026-04-29',
        today,
        now,
      }),
    ).toBeNull();
  });

  it('keeps a block with a small hole (the service fetches just that span)', () => {
    const s = series('2026-04-29', '2026-09-15');
    delete s['2026-07-10'];
    delete s['2026-07-11'];
    const block = buildWeatherBlock({
      series: s,
      lastUpdated: fresh,
      sowingDate: '2026-04-29',
      today,
      now,
    });
    expect(block!.daily).toHaveLength(138);
  });
});
