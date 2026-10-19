/**
 * Ported from AGVOLUTION/agmeo src/lib/timeseries/types.ts (weather series
 * shapes) and src/drizzle/schema.ts (LUFA / KA5 soil texture classes) — only
 * the types the models consume.
 */

// ── Weather series ─────────────────────────────────────────────────────────

/** One day of weather, as the reference crawler stores it per cultivation. */
export type WeatherDay = {
  tempMin: number;
  tempMax: number;
  tempMean: number;
  precipitation: number;
  humidityMin: number;
  humidityMax: number;
  humidityMean: number;
  dewPointMin: number;
  dewPointMax: number;
  dewPointMean: number;
  windSpeedMax: number; // max sustained wind (km/h, from Open-Meteo)
  windSpeedMean: number;
  windGustsMax: number; // max gusts (km/h, from Open-Meteo)
  windGustsMean: number;
  et0: number;
  // Soil params (0-7cm and 7-28cm depth daily aggregates)
  soilTemp0to7cm: number;
  soilTemp7to28cm: number;
  soilMoisture0to7cm: number;
  soilMoisture7to28cm: number;
};

/** Hourly series for sowing/spraying windows (rolling ~21 days, today−7 … today+14). */
export type WeatherHourlyTimeseries = {
  /** Wall-clock timestamps without offset ("2026-09-26T06:00") in `timezone`; read them via hourlyInstantsMs. */
  time: string[];
  /** IANA zone Open-Meteo resolved for the coordinate (`timezone=auto`). Absent on legacy payloads (requested as Europe/Berlin). */
  timezone?: string;
  /** Offset applied to EVERY `time` entry — Open-Meteo applies one offset per response. Authoritative for hourlyInstantsMs. */
  utcOffsetSeconds?: number;
  temp: number[];
  humidity: number[];
  precipitation: number[];
  /** km/h */
  windSpeed: number[];
  /** km/h */
  windGusts: number[];
};

/** ISO date → day. */
export type WeatherTimeseries = Record<string, WeatherDay>;

/** Fields kept on historical days by the reference's slim-weather projection. */
export const SLIM_WEATHER_DAY_KEYS = [
  'dewPointMean',
  'et0',
  'humidityMean',
  'precipitation',
  'tempMax',
  'tempMean',
  'tempMin',
  'windSpeedMean',
] as const satisfies readonly (keyof WeatherDay)[];

export type SlimWeatherDay = Pick<
  WeatherDay,
  (typeof SLIM_WEATHER_DAY_KEYS)[number]
>;

/**
 * Weather record where days before the forecast window may carry only
 * SlimWeatherDay fields. Invariant the condition bars rely on: every day
 * >= today-8 is a full WeatherDay.
 */
export type SlimWeatherTimeseries = Record<string, SlimWeatherDay | WeatherDay>;

// ── Soil texture classes ───────────────────────────────────────────────────

/** LUFA texture groups (Germany) — the rewrite's `soil_texture` column values. */
export const SOIL_TYPE_LUFA_ENUM_VALUES = [
  'S',
  'lS',
  'sU',
  'ssL',
  'lU',
  'sL',
  'uL',
  'L',
  'utL',
  'tL',
  'T',
] as const;
export type TSoilTypeLUFA = (typeof SOIL_TYPE_LUFA_ENUM_VALUES)[number];

/** KA5 (Bodenkundliche Kartieranleitung, 5th ed.) fine texture classes. */
export const SOIL_TYPE_KA5_ENUM_VALUES = [
  'Ls2',
  'Ls3',
  'Ls4',
  'Lt2',
  'Lt3',
  'Lts',
  'Lu',
  'Sl2',
  'Sl3',
  'Sl4',
  'Slu',
  'Ss',
  'St2',
  'St3',
  'Su2',
  'Su3',
  'Su4',
  'Tl',
  'Ts2',
  'Ts3',
  'Ts4',
  'Tt',
  'Tu2',
  'Tu3',
  'Tu4',
  'Uls',
  'Us',
  'Ut2',
  'Ut3',
  'Ut4',
  'Uu',
] as const;
export type TSoilTypeKA5 = (typeof SOIL_TYPE_KA5_ENUM_VALUES)[number];

export const KA5_TO_LUFA: Record<TSoilTypeKA5, TSoilTypeLUFA> = {
  Ss: 'S',
  Sl2: 'lS',
  Sl3: 'lS',
  Sl4: 'lS',
  St2: 'lS',
  St3: 'lS',
  Su2: 'sU',
  Su3: 'sU',
  Su4: 'sU',
  Us: 'sU',
  Slu: 'ssL',
  Uls: 'lU',
  Ut2: 'lU',
  Uu: 'lU',
  Ls2: 'sL',
  Ls3: 'sL',
  Ls4: 'sL',
  Lts: 'sL',
  Lu: 'uL',
  Lt2: 'L',
  Ut3: 'utL',
  Ut4: 'utL',
  Lt3: 'tL',
  Tl: 'tL',
  Tu3: 'tL',
  Tu4: 'tL',
  Ts2: 'T',
  Ts3: 'T',
  Ts4: 'T',
  Tt: 'T',
  Tu2: 'T',
};
