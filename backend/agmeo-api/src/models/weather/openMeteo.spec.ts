import { buildArchiveDailyUrl, parseArchiveDaily } from './openMeteoArchive.js';
import {
  buildPointForecastUrl,
  parsePointForecast,
  pointForecastCacheKey,
} from './openMeteoForecast.js';

describe('Open-Meteo archive mapping', () => {
  it('requests the daily variables in m/s with the key', () => {
    const url = new URL(
      buildArchiveDailyUrl(52.123456, 9.87654, '2025-01-01', '2025-12-31', 'k'),
    );
    expect(url.origin + url.pathname).toBe(
      'https://customer-archive-api.open-meteo.com/v1/archive',
    );
    expect(url.searchParams.get('latitude')).toBe('52.1235');
    expect(url.searchParams.get('windspeed_unit')).toBe('ms');
    expect(url.searchParams.get('daily')).toBe(
      'temperature_2m_min,temperature_2m_max,precipitation_sum,shortwave_radiation_sum,windspeed_10m_max',
    );
    expect(url.searchParams.get('apikey')).toBe('k');
  });

  it('drops days without min/max temperature and defaults precipitation to 0', () => {
    expect(
      parseArchiveDaily({
        daily: {
          time: ['2025-01-01', '2025-01-02'],
          temperature_2m_min: [-1, null],
          temperature_2m_max: [4, 5],
          precipitation_sum: [null, 2],
          shortwave_radiation_sum: [3.2, 1],
          windspeed_10m_max: [null, 8],
        },
      }),
    ).toEqual([
      {
        date: '2025-01-01',
        tempMin: -1,
        tempMax: 4,
        precipMm: 0,
        radiationMj: 3.2,
        windMaxMs: null,
        humidityPct: null,
      },
    ]);
    expect(parseArchiveDaily({})).toEqual([]);
  });
});

describe('Open-Meteo point forecast mapping', () => {
  it('asks for 7 past and 8 forecast days', () => {
    const url = new URL(buildPointForecastUrl(52, 9, 'k'));
    expect(url.searchParams.get('past_days')).toBe('7');
    expect(url.searchParams.get('forecast_days')).toBe('8');
  });

  it('keys the cache on a ~1 km grid', () => {
    expect(pointForecastCacheKey(52.1234, 9.8765)).toBe(
      'weather:point-forecast:52.12:9.88',
    );
  });

  it('parses into date-keyed days', () => {
    expect(
      parsePointForecast({
        daily: {
          time: ['2026-10-19', '2026-10-20'],
          temperature_2m_max: [12, null],
          temperature_2m_min: [3, 2],
          precipitation_sum: [1.5, 0],
        },
      }),
    ).toEqual({
      '2026-10-19': { tempMax: 12, tempMin: 3, precipitation: 1.5 },
    });
  });
});
