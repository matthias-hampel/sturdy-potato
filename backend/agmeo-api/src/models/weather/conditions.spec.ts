/**
 * Ported from AGVOLUTION/agmeo src/lib/weather/conditions.test.ts — logic, numbers and
 * thresholds unchanged; only imports adapted to the rewrite
 * (the label lookup is a plain function instead of an i18next TFunction).
 */

import type { WeatherHourlyTimeseries } from '../types.js';
import { makeUnitFormatter } from './units.js';

import {
  computeHourlySpray,
  formatReasonValue,
  type ReasonEntry,
} from './conditions.js';
import {
  buildFieldWeatherResponse,
  sprayReasonFormatter,
} from './fieldWeather.js';

const LABELS: Record<string, string> = {
  'unit.degC': '°C',
  'unit.degF': '°F',
  'unit.inch': 'in',
  'unit.kmh': 'km/h',
  'unit.mm': 'mm',
  'unit.mph': 'mph',
};
const t = (key: string) => LABELS[key] ?? key;
const metric = makeUnitFormatter('metric', t, 'en-US');
const imperial = makeUnitFormatter('imperial', t, 'en-US');

describe('formatReasonValue', () => {
  const reasons: [ReasonEntry, string, string][] = [
    [
      { key: 'reason.temp', value: 31.24, dimension: 'temperature' },
      '31.2 °C',
      '88 °F',
    ],
    [
      { key: 'reason.deltaT', value: 9.4, dimension: 'temperatureDelta' },
      '9.4 °C',
      '17 °F',
    ],
    [
      { key: 'reason.wind', value: 18.4, dimension: 'speed' },
      '18 km/h',
      '11 mph',
    ],
    [
      { key: 'reason.rain', value: 6.2, dimension: 'precipDepth' },
      '6.2 mm',
      '0.24 in',
    ],
    [{ key: 'reason.rainFree', value: 6, dimension: 'hours' }, '6h', '6h'],
  ];
  it.each(reasons)('%j → %s / %s', (reason, metricText, imperialText) => {
    expect(formatReasonValue(reason, metric)).toBe(metricText);
    expect(formatReasonValue(reason, imperial)).toBe(imperialText);
  });

  it("uses the formatter's locale for decimals", () => {
    const german = makeUnitFormatter('metric', t, 'de-DE');
    expect(
      formatReasonValue(
        { key: 'reason.rain', value: 6.2, dimension: 'precipDepth' },
        german,
      ),
    ).toBe('6,2 mm');
  });
});

describe('spray reasons', () => {
  // One windy, hot, dry hour: wind 25 km/h, 33 °C at 40 % RH.
  const hourly = {
    time: ['2030-07-01T12:00'],
    utcOffsetSeconds: 0,
    temp: [33],
    humidity: [40],
    windSpeed: [25],
    windGusts: [30],
    precipitation: [0],
  } as unknown as WeatherHourlyTimeseries;

  it('returns canonical values with their dimension, not display strings', () => {
    const { reasons } = computeHourlySpray(hourly, 0);
    expect(reasons).toContainEqual({
      key: 'reason.wind',
      value: 25,
      dimension: 'speed',
    });
    expect(reasons).toContainEqual({
      key: 'reason.temp',
      value: 33,
      dimension: 'temperature',
    });
  });

  it("the mobile payload keeps its string shape and follows the org's system", () => {
    const now = new Date('2030-07-01T12:00:00Z');
    const metricPayload = buildFieldWeatherResponse(
      {},
      hourly,
      null,
      sprayReasonFormatter('metric'),
      now,
    );
    const imperialPayload = buildFieldWeatherResponse(
      {},
      hourly,
      null,
      sprayReasonFormatter('imperial'),
      now,
    );
    expect(metricPayload.hourly[0].spray.reasons).toContain(
      'reason.wind: 25 km/h',
    );
    expect(imperialPayload.hourly[0].spray.reasons).toContain(
      'reason.wind: 16 mph',
    );
    expect(imperialPayload.hourly[0].windMs).toBe(
      metricPayload.hourly[0].windMs,
    );
  });
});
