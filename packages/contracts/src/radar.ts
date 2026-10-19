/**
 * DWD precipitation radar: RADOLAN RY analyses (the last six hours, every five minutes) and
 * the RV nowcast (+5 … +120 minutes from the newest run), all warped onto one Web Mercator
 * image covering Germany.
 */

export type RadarFrameKind = 'analysis' | 'nowcast';

export interface RadarFrame {
  /** Frame key for `GET /v1/radar/frames/:key.png`: `YYMMDDHHMM` (UTC) or, for the nowcast, `YYMMDDHHMM-SSS` (run and lead minutes). */
  key: string;
  /** ISO instant the precipitation is valid for. */
  time: string;
  kind: RadarFrameKind;
  /** Lead time from the nowcast run in minutes; 0 for analyses. */
  leadMinutes: number;
}

export interface RadarManifest {
  /** WGS84 extent of every frame image: [west, south, east, north]. */
  bounds: [number, number, number, number];
  width: number;
  height: number;
  /** Analyses oldest first, then the nowcast of the newest run in lead order. */
  frames: RadarFrame[];
  /** Index of the newest analysis ("now"); -1 when there is none yet. */
  nowIndex: number;
  /** When the worker last refreshed the frames; null before the first refresh. */
  refreshedAt: string | null;
}

/**
 * Colour classes of the radar images (DWD-style). A pixel takes the class of the highest
 * threshold its rain rate reaches; below the first threshold it stays transparent.
 * Thresholds in mm/h; colours as [r, g, b, a] with a in 0–255.
 */
export const RADAR_PRECIPITATION_CLASSES: readonly { mmPerHour: number; rgba: readonly [number, number, number, number] }[] = [
  { mmPerHour: 0.1, rgba: [170, 220, 255, 200] },
  { mmPerHour: 0.5, rgba: [100, 180, 255, 220] },
  { mmPerHour: 1, rgba: [50, 120, 230, 230] },
  { mmPerHour: 2.5, rgba: [30, 70, 200, 240] },
  { mmPerHour: 5, rgba: [60, 180, 70, 240] },
  { mmPerHour: 10, rgba: [255, 220, 0, 240] },
  { mmPerHour: 20, rgba: [255, 120, 0, 240] },
  { mmPerHour: 40, rgba: [220, 30, 30, 240] },
  { mmPerHour: 80, rgba: [160, 0, 160, 240] },
];
