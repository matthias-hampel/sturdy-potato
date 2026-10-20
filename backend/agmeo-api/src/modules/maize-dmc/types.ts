/**
 * Request and response of AGVOLUTION's maize-dmc-api (`POST /dmc/predict`), mirrored from the
 * reference's lib/maizeDmc/types.ts (whose source of truth is app/models.py of the service,
 * image agvolution/maize-dmc-api 0.3.x). All DM values are fractions in [0, 1].
 */
import type { MultiPolygon, Polygon } from 'geojson';
import type { DmcResolution } from '@agmeo/contracts';

export type Resolution = DmcResolution;

/** Field mode anchors the curve on a measurement; offset mode shifts it. */
export type CalibrationSpec =
  { measured_dm: number; measured_at: string } | { offset: number };

export interface WeatherDayInput {
  date: string;
  tmean_c: number;
  precip_mm: number;
}

/** Daily weather we already hold, so the service fetches only the gaps (service >= 0.3.4). */
export interface WeatherBlockInput {
  daily: WeatherDayInput[];
}

export interface PredictBody {
  geometry: Polygon | MultiPolygon;
  sowing_date: string;
  /** 150–800. */
  fao_maturity: number;
  resolution: Resolution;
  calibration?: CalibrationSpec;
  weather?: WeatherBlockInput;
}

export interface SceneInfo {
  date: string;
  age_days: number;
  source: string;
}

export interface CalibrationInfo {
  mode: 'field' | 'offset';
  measured_dm: number | null;
  measured_at: string | null;
  offset: number;
}

export interface FieldInfo {
  area_ha: number;
  /** [lon, lat]. */
  centroid: [number, number];
  valid_pixels: number;
  pixel_resolution_m: number;
  bounding_box_epsg_3857: [number, number, number, number];
}

export interface DayPrediction {
  date: string;
  dm_mean: number;
  dm_p10: number;
  dm_p90: number;
  dm_mean_uncalibrated: number | null;
  accumulated_gdd: number;
  temperature_mean_c: number;
  valid_pixels: number;
  url_png: string;
  url_tiff: string;
}

/** Provenance of the daily weather behind a forecast (service >= 0.3.3). */
export interface WeatherInfo {
  days_total: number;
  days_supplied: number;
  days_fetched: number;
  /** Days bridged by the service's bounded fallback (see fallback_kind). */
  days_fallback: number;
  fallback_kind?: 'none' | 'today_row' | 'recent_mean';
  fallback_dates?: string[];
  optional_padded?: number;
  sources: string[];
}

export interface PredictResponse {
  execution_id: string;
  created_at: string;
  model_version: string;
  scene: SceneInfo;
  calibration: CalibrationInfo | null;
  field: FieldInfo;
  daily_predictions: DayPrediction[];
  weather?: WeatherInfo | null;
}

export type ResultBand = 'mean' | 'p10' | 'p90';
export type ResultOutput = 'png' | 'tiff';
