import { inflateSync } from 'node:zlib';
import { RADAR_PRECIPITATION_CLASSES } from '@agmeo/contracts';
import { describe, expect, it } from 'vitest';
import { colorize } from './colorize.js';
import { renderRv, renderRy } from './dwd.js';
import { crc32, encodePngRgba } from './png.js';
import { DE1200, RADOLAN, WEB_MERCATOR } from './projection.js';
import { inDemand, nowcastKey, storageKeyFor } from './radar-store.js';
import { dateToTimestamp, parseRadolan, parseRadolanRaw, timestampToDate } from './radolan.js';
import { listTarEntries } from './tar.js';
import { bunzip2 } from '../../vendor/seek-bzip/bunzip2.js';
import { DE1200_GRID, RADAR_RASTER, RY_GRID } from './warp.js';

// Generated with Python's bz2 and tarfile (USTAR). RY: 900 × 900, 1.0 mm/5 min in the
// north-west 50 × 50 km, no-data in the south-east 50 × 50 km. RV: a tar with members _000,
// _005 and _010 of 0.25 mm/5 min everywhere; _010 claims VV 015.
const RY_FIXTURE =
  'QlpoOTFBWSZTWZzVlcoAQD7fkMgIQAZ3ZRPjXaA2AIhAAIAACDAA2WwaKYg0AAAepoGhExBHqAABoDQApVTFAGgANMQPU8prVSMMoX4ixECmGUUULYiKOdkiKMaRQu/HCiCIB4IAuIUxYhuYp/LXYXqy6RgX4kBaGC3MqFA2rE3sexZ6i4hIAah1iykgicitFggL9MICsVQgQI9vxlnhg3Z7tNdnFEUdMLPTT+ePHX06KRQv8XckU4UJCc1ZXKA=';
const RV_FIXTURE =
  'QlpoOTFBWSZTWXYEuHkG3a7/gMiAACBABn/lF+NdoPYAnkAIADAAutBoRE9NT0TQGIaYnqNNHqPKDUZEaTACYBGCaGAG1SBqaaYmmTTI0MhiaGmNGIeQgQhAIEOHzc/Exr7RinYnnUIEIgRECIFi1MrkyN8ymd+FKrH4TBfrBGnzMiuMqjACfCQhZjFYNIU+ARLFBWLV6CSUPBkwwRcvaKQL0usFZmy0GsNYiagsOQLcBVj0cU8KMT8ZpPQhcc0FcrWb5tE7BQw02imP6JwhEWPiJMk538xQVkmU1lqsDP1A27jYABAAAAgIAAwgE1GioQiYVCETmKCskymssohs7INRpf/AZkAAECADP/KL8a7QewBPIAQEGABc2DUypp6n6ifqhoyNA0HqNMDUeUGkxUGCGCYIwmmTEyZMNqU9RMmj0QAaNDTTQAD9ROpYwTCEIQgECHdeaZaGnkmSZZ2iZhCEIQCBEfGD1WxWtdI83KmDa7rHV7tZO6SqaDERsImC1ArArnxTJV4jufjgqCsGiCpD5oDPZ3BSDi0oJyJKgUgmQz0MKQyUwoGtruisa+VxfLjbMbOFxiePFKM+B9hmHfDaNUP0Ce+Aq9QEUiqj+YoKyTKazHkcr6gbdxsAAgAAAQEAAYQCajCoQiaKhCJzFBWSZTWWqwM/UDbuNgAEAAACAgADCATUaKhCJhUIROYoKyTKazdwyD0AzR9P8BmQAAQIAM/8ovxrtB7AE8gBAQYAFzMRRoGhoAAAAGjR6QaaFTxJtQA0BoNA0AA2pNQmmj1ANANDTTQAD9dJnBMIQhCAQIodecFyLUSzpMqWgzCEIQgECJOMX12Qsa2V5+WeLara3U3aum9IkoNFkRSiEcWDkPSnUszwFTbIPvBVxuJZYsFX7O1wlhpkMJMs4Li7JViHiZsLkwL9muSQ9UWHpasKFSq0gQppLIwcl4LBgeIHh+FVCBCjQQSVJjB+YoKyTKazHkcr6gbdxsAAgAAAQEAAYQCajCoQiaKhCJzFBWSZTWWqwM/UDbuNgAEAAACAgADCATUaKhCJhUIROYoKyTKaz/47Gngr/6cABgACAQAAQQACgzTQTVJ6mTeR1RACXRQAS3J8XckU4UJCd/ShLA==';

const b64 = (s: string) => new Uint8Array(Buffer.from(s, 'base64'));

/** Decodes the PNGs encodePngRgba writes (RGBA, 8 bit, filter 0) back to pixels. */
function decodePng(png: Buffer) {
  expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  let offset = 8;
  let width = 0;
  let height = 0;
  const idat: Buffer[] = [];
  while (offset < png.length) {
    const len = png.readUInt32BE(offset);
    const type = png.toString('ascii', offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + len);
    expect(png.readUInt32BE(offset + 8 + len)).toBe(crc32(png.subarray(offset + 4, offset + 8 + len)));
    if (type === 'IHDR') [width, height] = [data.readUInt32BE(0), data.readUInt32BE(4)];
    if (type === 'IDAT') idat.push(data);
    offset += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const pixel = (x: number, y: number) => {
    const o = y * (width * 4 + 1) + 1 + x * 4;
    return [...raw.subarray(o, o + 4)];
  };
  return { width, height, pixel };
}

/** The raster pixel a location falls into. */
function pixelOf(lon: number, lat: number) {
  const [mx, my] = WEB_MERCATOR.forward(lon, lat);
  return [Math.floor((mx - RADAR_RASTER.mercMinX) / RADAR_RASTER.res), Math.floor((RADAR_RASTER.mercMaxY - my) / RADAR_RASTER.res)] as const;
}

const classOf = (mmPerHour: number) => [...RADAR_PRECIPITATION_CLASSES].reverse().find((c) => mmPerHour >= c.mmPerHour)!.rgba;

describe('projections', () => {
  const near = (actual: [number, number], expected: [number, number], tolerance: number) => {
    expect(Math.abs(actual[0] - expected[0])).toBeLessThan(tolerance);
    expect(Math.abs(actual[1] - expected[1])).toBeLessThan(tolerance);
  };

  it('puts the RADOLAN national grid corners where the DWD documents them', () => {
    // RADOLAN Kurzbeschreibung: corner coordinates of the 900 × 900 km grid (km).
    near(RADOLAN.forward(3.5889, 46.9526), [-523_462.2, -4_658_645], 100);
    near(RADOLAN.forward(2.0715, 54.5877), [-523_462.2, -3_758_645], 100);
    near(RADOLAN.forward(15.7208, 54.7405), [376_537.8, -3_758_645], 100);
    near(RADOLAN.forward(14.6209, 47.0705), [376_537.8, -4_658_645], 100);
  });

  it('matches proj4, which the reference uses, for both grids and Web Mercator', () => {
    // Values from proj4 2.22 with the reference's projection strings (src/lib/dwd/warp.ts).
    near(RADOLAN.forward(3.5889, 46.9526), [-523_464.34, -4_658_642.117], 0.01);
    near(RADOLAN.inverse(376_538, -3_758_645), [15.720757961, 54.740545122], 1e-8);
    near(DE1200.forward(3.566994635, 45.69642538), [-543_696.835183, -4_822_088.861617], 0.01);
    const corner = (col: number, row: number) => DE1200.inverse(DE1200_GRID.originX + col * 1000, DE1200_GRID.originY - row * 1000);
    near(corner(0, 0), [1.46330151, 55.862087111], 1e-8);
    near(corner(1100, 0), [18.731616456, 55.845438566], 1e-8);
    near(corner(1100, 1200), [16.580869349, 45.684605784], 1e-8);
    near(WEB_MERCATOR.forward(...DE1200.inverse(0, -4_000_000)), [1_113_194.908, 6_967_796.2], 0.01);
    near(WEB_MERCATOR.forward(...RADOLAN.inverse(0, -4_000_000)), [1_113_194.908, 6_946_569.991], 0.01);
  });

  it('round-trips every projection', () => {
    for (const p of [RADOLAN, DE1200, WEB_MERCATOR]) {
      for (const [lon, lat] of [[10, 51], [3.2, 47.1], [15.9, 55.2], [6.1, 50.8]] as const) near(p.inverse(...p.forward(lon, lat)), [lon, lat], 1e-9);
    }
  });

  it('shares one raster covering Germany for analyses and nowcast', () => {
    const [w, s, e, n] = RADAR_RASTER.bounds;
    expect(w).toBeCloseTo(2.07, 1);
    expect(n).toBeGreaterThan(54.74); // the north edge bulges past the NE corner
    expect(e).toBeGreaterThan(15.7);
    expect(s).toBeLessThan(47);
    expect(RADAR_RASTER.width).toBeGreaterThan(900);
    expect(RADAR_RASTER.height).toBeGreaterThan(900);
    expect(RY_GRID.rows * RY_GRID.cols).toBe(810_000);
  });
});

describe('RADOLAN', () => {
  it('reads the header, flips rows to north up and flags missing data', () => {
    const header = Buffer.from('RY261019052010000 10000 2610 BY 1620 VS 3 SW P30000.HPE PR E-02 INT   5 GP   2x   3 VV 005 MS 0<>\x03', 'latin1');
    const body = Buffer.alloc(12);
    [1, 2, 3, 0x2000 | 7, 250, 0x0fff].forEach((v, i) => body.writeUInt16LE(v, i * 2)); // stored south row first
    const f = parseRadolanRaw(new Uint8Array(Buffer.concat([header, body])));
    expect([f.rows, f.cols, f.forecastMinutes]).toEqual([2, 3, 5]);
    expect([...f.values.subarray(0, 3)].map((v) => (Number.isNaN(v) ? 'nan' : v))).toEqual(['nan', 2.5, expect.closeTo(40.95, 5)]);
    expect([...f.values.subarray(3)]).toEqual([expect.closeTo(0.01, 5), expect.closeTo(0.02, 5), expect.closeTo(0.03, 5)]);
  });

  it('rejects a truncated body and a missing header end', () => {
    expect(() => parseRadolanRaw(new Uint8Array(Buffer.from('RY GP   2x   3 PR E-02\x03\x00\x00', 'latin1')))).toThrow(/shorter/);
    expect(() => parseRadolanRaw(new Uint8Array([0x52, 0x59]))).toThrow(/ETX/);
  });

  it('decompresses bzip2 files', () => {
    const f = parseRadolan(b64(RY_FIXTURE));
    expect([f.rows, f.cols]).toEqual([900, 900]);
    expect(f.values[0]).toBeCloseTo(1); // north-west corner
    expect(f.values[899 * 900 + 899]).toBeNaN(); // south-east corner
    expect(f.values[450 * 900 + 450]).toBe(0);
  });

  it('converts file name timestamps', () => {
    expect(timestampToDate('2610190520').toISOString()).toBe('2026-10-19T05:20:00.000Z');
    expect(dateToTimestamp(new Date('2026-10-19T05:20:00Z'))).toBe('2610190520');
    expect(() => timestampToDate('26101905')).toThrow();
  });
});

describe('rendering', () => {
  it('colours by rain rate (mm/h) and leaves dry and missing cells transparent', () => {
    // mm in 5 minutes: 0.005 → 0.06 mm/h (dry), 0.01 → 0.12 mm/h, 1 → 12 mm/h, 10 → 120 mm/h.
    const rgba = colorize(new Float32Array([NaN, 0, 0.005, 0.01, 1, 10]));
    expect([...rgba.subarray(0, 12)]).toEqual(Array(12).fill(0));
    expect([...rgba.subarray(12, 16)]).toEqual([...classOf(0.12)]);
    expect([...rgba.subarray(16, 20)]).toEqual([255, 220, 0, 240]);
    expect([...rgba.subarray(20, 24)]).toEqual([160, 0, 160, 240]);
  });

  it('encodes PNGs that decode to the same pixels', () => {
    const rgba = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    const png = decodePng(encodePngRgba(rgba, 3, 2));
    expect([png.width, png.height]).toEqual([3, 2]);
    expect(png.pixel(1, 0)).toEqual([0, 255, 0, 128]);
    expect(png.pixel(2, 1)).toEqual([9, 10, 11, 12]);
  });

  it('warps an RY analysis onto the map raster in the right place', () => {
    const png = decodePng(renderRy(b64(RY_FIXTURE)));
    expect([png.width, png.height]).toEqual([RADAR_RASTER.width, RADAR_RASTER.height]);
    // Inside the rainy north-west 50 × 50 km (grid corner at 2.07° E, 54.59° N) …
    expect(png.pixel(...pixelOf(2.4, 54.4))).toEqual([255, 220, 0, 240]);
    // … and outside it, dry; the no-data corner in the south-east stays transparent too.
    expect(png.pixel(...pixelOf(3.6, 53.5))).toEqual([0, 0, 0, 0]);
    expect(png.pixel(...pixelOf(14.3, 47.2))).toEqual([0, 0, 0, 0]);
    expect(png.pixel(...pixelOf(10, 51))).toEqual([0, 0, 0, 0]);
  });

  it('renders nowcast steps from an RV archive and checks their lead time', () => {
    const tar = listTarEntries(bunzip2(b64(RV_FIXTURE)));
    expect(tar.map((e) => [e.name, e.data.length])).toEqual(['000', '005', '010'].map((s) => [`DE1200_RV2610190520_${s}`, expect.any(Number)]));
    expect(tar[1].data.length).toBe(tar[1].data.indexOf(0x03) + 1 + 1200 * 1100 * 2);
    const [frame] = renderRv('2610190520', b64(RV_FIXTURE), [5]);
    expect(frame.step).toBe(5);
    const png = decodePng(frame.png);
    expect(png.pixel(...pixelOf(9.5, 51.3))).toEqual([...classOf(3)]);
    expect(() => renderRv('2610190520', b64(RV_FIXTURE), [10])).toThrow(/VV 15, expected 10/);
    expect(() => renderRv('2610190520', b64(RV_FIXTURE), [20])).toThrow(/no tar member/);
  });
});

describe('radar store', () => {
  it('names frames and their objects by run and lead time', () => {
    expect(nowcastKey('2610190520', 5)).toBe('2610190520-005');
    expect(storageKeyFor('2610190520-005')).toBe('radar/nowcast/2610190520/005.png');
    expect(storageKeyFor('2610190520')).toBe('radar/analysis/2610190520.png');
  });

  it('is in demand for six hours after the last view', () => {
    const now = new Date('2026-10-19T12:00:00Z');
    expect(inDemand(null, now)).toBe(false);
    expect(inDemand(new Date('2026-10-19T06:30:00Z'), now)).toBe(true);
    expect(inDemand(new Date('2026-10-19T05:59:00Z'), now)).toBe(false);
  });
});
