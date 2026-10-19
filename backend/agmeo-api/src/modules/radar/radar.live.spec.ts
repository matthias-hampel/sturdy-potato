/**
 * Live check against DWD opendata. Not part of the normal test run; run it by hand:
 *
 *   RADAR_LIVE=1 pnpm vitest run src/modules/radar/radar.live.spec.ts
 */
import { describe, expect, it } from 'vitest';
import { dwdSource } from './dwd.js';
import { parseRadolan } from './radolan.js';
import { NOWCAST_STEPS } from './radar-store.js';
import { RADAR_RASTER } from './warp.js';

const PNG_SIGNATURE = '89504e470d0a1a0a';

describe.skipIf(!process.env.RADAR_LIVE)('DWD opendata (live)', () => {
  it('parses and renders the newest RY analysis', async () => {
    const [ts] = await dwdSource.listAnalyses(1);
    expect(ts).toMatch(/^\d{10}$/);
    const res = await fetch(`https://opendata.dwd.de/weather/radar/radolan/ry/raa01-ry_10000-${ts}-dwd---bin.bz2`);
    const radolan = parseRadolan(new Uint8Array(await res.arrayBuffer()));
    expect([radolan.rows, radolan.cols]).toEqual([900, 900]);
    const finite = radolan.values.filter(Number.isFinite);
    const wet = finite.filter((v) => v > 0);
    const max = finite.reduce((a, b) => Math.max(a, b), 0);
    const started = Date.now();
    const png = await dwdSource.renderAnalysis(ts);
    console.log(
      `RY ${ts}: ${finite.length} cells with data (${((finite.length / radolan.values.length) * 100).toFixed(1)} %), ${wet.length} wet, max ${(max * 12).toFixed(1)} mm/h; ` +
        `PNG ${RADAR_RASTER.width}×${RADAR_RASTER.height}, ${png.length} bytes, fetched and rendered in ${Date.now() - started} ms`,
    );
    expect(finite.length).toBeGreaterThan(radolan.values.length / 2);
    expect(png.subarray(0, 8).toString('hex')).toBe(PNG_SIGNATURE);
  }, 120_000);

  it('renders the full nowcast of the newest RV run', async () => {
    const run = await dwdSource.latestNowcastRun();
    expect(run).toMatch(/^\d{10}$/);
    const started = Date.now();
    const frames = await dwdSource.renderNowcast(run!, NOWCAST_STEPS);
    console.log(`RV ${run}: ${frames.length} steps rendered in ${Date.now() - started} ms, PNG sizes ${Math.min(...frames.map((f) => f.png.length))}–${Math.max(...frames.map((f) => f.png.length))} bytes`);
    expect(frames.map((f) => f.step)).toEqual(NOWCAST_STEPS);
    for (const f of frames) expect(f.png.subarray(0, 8).toString('hex')).toBe(PNG_SIGNATURE);
  }, 300_000);
});
