import { crc32, deflateSync } from 'node:zlib';
import { type GridDefinition, projector } from './grid.js';

/** RGBA PNG, 8 bit, no filtering. */
export function encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  }
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const hex = (c: string): [number, number, number] => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];

/** Colour of a value on a ramp stretched over [min, max]. */
export function rampColor(ramp: readonly string[], min: number, max: number, value: number): [number, number, number] {
  const t = max > min ? Math.min(1, Math.max(0, (value - min) / (max - min))) : 0.5;
  const pos = t * (ramp.length - 1);
  const i = Math.min(ramp.length - 2, Math.floor(pos));
  const f = pos - i;
  const a = hex(ramp[i]);
  const b = hex(ramp[i + 1]);
  return [Math.round(a[0] + (b[0] - a[0]) * f), Math.round(a[1] + (b[1] - a[1]) * f), Math.round(a[2] + (b[2] - a[2]) * f)];
}

const TILE = 256;

/**
 * One XYZ (Web Mercator) tile of a raster on its UTM grid, nearest neighbour, coloured on the
 * ramp; null when the tile does not touch the raster.
 */
export function renderTile(grid: GridDefinition, data: Float64Array, z: number, x: number, y: number, ramp: readonly string[], range: [number, number]): Buffer | null {
  const n = 2 ** z;
  const project = projector(grid.epsg);
  const rgba = new Uint8Array(TILE * TILE * 4);
  let any = false;
  for (let py = 0; py < TILE; py++) {
    const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + (py + 0.5) / TILE)) / n))) * 180) / Math.PI;
    for (let px = 0; px < TILE; px++) {
      const lon = ((x + (px + 0.5) / TILE) / n) * 360 - 180;
      const [gx, gy] = project(lon, lat);
      const col = Math.floor((gx - grid.originX) / grid.resolution);
      const row = Math.floor((grid.originY - gy) / grid.resolution);
      if (col < 0 || row < 0 || col >= grid.width || row >= grid.height) continue;
      const value = data[row * grid.width + col];
      if (!Number.isFinite(value)) continue;
      const [r, g, b] = rampColor(ramp, range[0], range[1], value);
      const o = (py * TILE + px) * 4;
      rgba[o] = r;
      rgba[o + 1] = g;
      rgba[o + 2] = b;
      rgba[o + 3] = 255;
      any = true;
    }
  }
  return any ? encodePng(TILE, TILE, rgba) : null;
}

let empty: Buffer | null = null;
export const emptyTile = () => (empty ??= encodePng(TILE, TILE, new Uint8Array(TILE * TILE * 4)));
