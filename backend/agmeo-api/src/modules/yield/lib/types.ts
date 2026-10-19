import type { CleaningStats } from './cleaning.js';

/**
 * One harvest-monitor sample. `t` (epoch ms) and `width` (effective working width in metres)
 * are what make the track-level filters possible — pass segmentation, velocity, flow delay and
 * swath overlap all need points in drive order with a footprint. They are optional because not
 * every export carries a time column; the filters skip themselves rather than guess.
 */
export type YieldPoint = {
  lon: number;
  lat: number;
  /** t/ha */
  value: number;
  moisture?: number;
  section?: number;
  /** epoch ms */
  t?: number;
  /** effective working width [m] — for JD the width of ONE header element */
  width?: number;
  /** machine heading [deg], when the export logs it */
  heading?: number;
  /** speed [km/h], when the export logs it */
  speed?: number;
  /** distance travelled since the previous record of the same element [m] */
  step?: number;
};

export type YieldMapQuality = {
  /** Mean rate of the cleaned points [t/ha] */
  meanRate: number;
  /** false when the mean rate is outside the plausible crop window — wrong column, unit or calibration */
  plausible: boolean;
  /** The plausibility window that was applied — crop-specific when the caller named the crop */
  window: [number, number];
  /** Points dropped by the per-point cap (2× the crop window's maximum) */
  cappedPoints: number;
  note?: string;
};

export type YieldFormat = 'mass_per_area' | 'flow_channels' | 'isoxml' | 'pointdata' | 'aft';

export type ParsedYieldPoints = {
  points: YieldPoint[];
  format: YieldFormat;
  /** The detected yield source: a column name, or the flow formula */
  attribute: string;
  totalFeatures: number;
  droppedFeatures: number;
  /** Present when a moisture/dry-matter channel was found */
  moisture?: { attribute: string; mean: number; pointsWithMoisture: number };
  /** Wet mass (as harvested) or dry mass — dry when every source is a dry channel. */
  basis: 'wet' | 'dry';
  /** Data sources in the zip (a farm export can bundle one shapefile set per field) */
  sources: { parsed: number; skipped: number };
  /** Resolved source CRS per set, e.g. "EPSG:25832 (prj)" */
  crs?: string;
  /** Track-level cleaning applied per export set */
  cleaning?: CleaningStats;
  quality: YieldMapQuality;
  /** First and last logged time (epoch ms), when the export carries times. */
  timeRange?: [number, number];
};
