/**
 * DWD opendata access and rendering (reference src/lib/dwd/pipeline.ts):
 *
 * - RY: RADOLAN analyses every 5 minutes, one bzip2 file each, on the national 900 × 900 grid.
 * - RV: composite analysis plus a 2-hour nowcast (+5 … +120 min), one bzip2 tar per run, members
 *   in RADOLAN format on the DE1200 grid. DE1200_RV_LATEST.tar.bz2 is ignored: frame keys must
 *   carry the run's timestamp from the file name.
 */
import { colorize } from './colorize.js';
import { encodePngRgba } from './png.js';
import { parseRadolan, parseRadolanRaw } from './radolan.js';
import { listTarEntries } from './tar.js';
import { warpDe1200, warpRy } from './warp.js';
import { bunzip2 } from '../../vendor/seek-bzip/bunzip2.js';

const RY_URL = 'https://opendata.dwd.de/weather/radar/radolan/ry/';
const RY_FILE = /raa01-ry_10000-(\d{10})-dwd---bin\.bz2/g;
const RV_URL = 'https://opendata.dwd.de/weather/radar/composite/rv/';
const RV_FILE = /DE1200_RV(\d{10})\.tar\.bz2/g;
const USER_AGENT = 'agmeo-radar/1.0';

/** Where the radar job gets its frames; swapped for a fake in tests. */
export interface RadarSource {
  /** The newest `count` RY timestamps (YYMMDDHHMM, UTC), oldest first. */
  listAnalyses(count: number): Promise<string[]>;
  /** One RY analysis as PNG. */
  renderAnalysis(ts: string): Promise<Buffer>;
  /** The newest RV run (YYMMDDHHMM, UTC), or null when the listing has none. */
  latestNowcastRun(): Promise<string | null>;
  /** The given lead times (minutes) of one RV run as PNGs. */
  renderNowcast(run: string, steps: number[]): Promise<{ step: number; png: Buffer }[]>;
}

async function get(url: string, timeoutMs = 60_000): Promise<Response> {
  const res = await fetch(url, { headers: { 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`DWD opendata ${url} failed: ${res.status}`);
  return res;
}

const timestampsIn = (html: string, pattern: RegExp) => [...new Set([...html.matchAll(pattern)].map((m) => m[1]))].sort();

export function renderRy(compressed: Uint8Array): Buffer {
  const radolan = parseRadolan(compressed);
  const warped = warpRy(radolan.values, radolan.rows, radolan.cols);
  return encodePngRgba(colorize(warped.values), warped.width, warped.height);
}

/** Renders the wanted lead times of an RV tar (bzip2-compressed). */
export function renderRv(run: string, compressed: Uint8Array, steps: number[]): { step: number; png: Buffer }[] {
  const entries = listTarEntries(bunzip2(compressed));
  // Members end in the three-digit lead time (…_000, …_005, …).
  const bySuffix = new Map(entries.map((e) => [e.name.slice(-3), e]));
  return [...new Set(steps)]
    .sort((a, b) => a - b)
    .map((step) => {
      const entry = bySuffix.get(String(step).padStart(3, '0'));
      if (!entry) throw new Error(`RV ${run}: no tar member for +${step} min`);
      const radolan = parseRadolanRaw(entry.data);
      if (radolan.forecastMinutes !== step) throw new Error(`RV ${run}: member ${entry.name} has VV ${radolan.forecastMinutes}, expected ${step}`);
      const warped = warpDe1200(radolan.values, radolan.rows, radolan.cols);
      return { step, png: encodePngRgba(colorize(warped.values), warped.width, warped.height) };
    });
}

export const dwdSource: RadarSource = {
  async listAnalyses(count) {
    return timestampsIn(await (await get(RY_URL)).text(), RY_FILE).slice(-count);
  },
  async renderAnalysis(ts) {
    const res = await get(`${RY_URL}raa01-ry_10000-${ts}-dwd---bin.bz2`);
    return renderRy(new Uint8Array(await res.arrayBuffer()));
  },
  async latestNowcastRun() {
    return timestampsIn(await (await get(RV_URL)).text(), RV_FILE).at(-1) ?? null;
  },
  async renderNowcast(run, steps) {
    const res = await get(`${RV_URL}DE1200_RV${run}.tar.bz2`, 120_000);
    return renderRv(run, new Uint8Array(await res.arrayBuffer()), steps);
  },
};
