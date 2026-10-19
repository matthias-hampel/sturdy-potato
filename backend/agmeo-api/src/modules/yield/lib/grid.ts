import type { Geometry, MultiPolygon, Polygon, Position } from 'geojson';
import { crsByEpsg, fromLonLat, toLonLat, utmEpsg } from './crs.js';

/**
 * The analysis grid of a field: its own WGS 84 / UTM zone, square pixels aligned to multiples
 * of the resolution, the boundary plus a margin. Same convention as the satellite pipeline
 * (agmeo-geo `field_grid`), so a yield raster lines up pixel for pixel with the field's NDVI
 * rasters and productivity map — and a 10 m pixel is 10 m of ground, unlike the reference
 * app's Web Mercator grid.
 */
export interface GridDefinition {
  epsg: number;
  /** Top-left corner. */
  originX: number;
  originY: number;
  /** Pixel size in metres. */
  resolution: number;
  width: number;
  height: number;
}

/** A failure with an HTTP-like status: 400/413/422 are verdicts about the data, not incidents. */
export class GridError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'GridError';
  }
}

export const DEFAULT_RESOLUTION = 10;
export const GRID_MARGIN_M = 20;
/** A field larger than ~2 000 ha at 10 m is not a field. */
export const MAX_GRID_PIXELS = 20_000_000 / 100;

const snapDown = (v: number, step: number) => Math.floor(v / step) * step;
const snapUp = (v: number, step: number) => Math.ceil(v / step) * step;

export function ringsOf(geometry: Geometry): Position[][][] {
  if (geometry.type === 'Polygon') return [geometry.coordinates];
  if (geometry.type === 'MultiPolygon') return geometry.coordinates;
  if (geometry.type === 'GeometryCollection') return geometry.geometries.flatMap(ringsOf);
  return [];
}

/** Rough centroid (mean of the outer-ring vertices) — enough to pick a UTM zone. */
export function lonLatCentre(geometry: Geometry): [number, number] {
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (const polygon of ringsOf(geometry)) {
    for (const [x, y] of polygon[0] ?? []) {
      sx += x;
      sy += y;
      n++;
    }
  }
  return n ? [sx / n, sy / n] : [0, 0];
}

export function projector(epsg: number): (lon: number, lat: number) => [number, number] {
  const def = crsByEpsg(epsg);
  if (!def) throw new GridError(`Unsupported grid CRS EPSG:${epsg}`, 500);
  return fromLonLat(def);
}

export function unprojector(epsg: number): (x: number, y: number) => [number, number] {
  const def = crsByEpsg(epsg);
  if (!def) throw new GridError(`Unsupported grid CRS EPSG:${epsg}`, 500);
  return toLonLat(def) ?? ((x, y) => [x, y]);
}

/** Polygons of a lon/lat geometry in the grid CRS. */
export function projectGeometry(geometry: Geometry, epsg: number): Position[][][] {
  const project = projector(epsg);
  return ringsOf(geometry).map((polygon) => polygon.map((ring) => ring.map(([x, y]) => project(x, y))));
}

/** The field grid around one or more lon/lat geometries, in the UTM zone of the first one. */
export function fieldGrid(geometries: Geometry[], resolution = DEFAULT_RESOLUTION, margin = GRID_MARGIN_M, epsg?: number): GridDefinition {
  if (!geometries.length) throw new GridError('No geometry to build a grid for', 400);
  const [lon, lat] = lonLatCentre(geometries[0]);
  const code = epsg ?? utmEpsg(lon, lat);
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const g of geometries) {
    for (const polygon of projectGeometry(g, code)) {
      for (const ring of polygon) {
        for (const [x, y] of ring) {
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
      }
    }
  }
  if (!Number.isFinite(minX)) throw new GridError('The geometry has no area', 400);
  const x0 = snapDown(minX - margin, resolution);
  const y0 = snapDown(minY - margin, resolution);
  const x1 = snapUp(maxX + margin, resolution);
  const y1 = snapUp(maxY + margin, resolution);
  const width = Math.round((x1 - x0) / resolution);
  const height = Math.round((y1 - y0) / resolution);
  if (width * height > MAX_GRID_PIXELS) throw new GridError(`Grid of ${width}×${height} pixels is too large`, 413);
  return { epsg: code, originX: x0, originY: y1, resolution, width, height };
}

export const pixelAreaM2 = (grid: GridDefinition) => grid.resolution * grid.resolution;
export const pixelAreaHa = (grid: GridDefinition) => pixelAreaM2(grid) / 10_000;

/** Pixel index of a point in grid coordinates, or -1 outside. */
export function pixelIndex(grid: GridDefinition, x: number, y: number): number {
  const col = Math.floor((x - grid.originX) / grid.resolution);
  const row = Math.floor((grid.originY - y) / grid.resolution);
  if (col < 0 || row < 0 || col >= grid.width || row >= grid.height) return -1;
  return row * grid.width + col;
}

/** Even-odd scanline fill of polygons (grid CRS) at pixel centres. */
function burnPolygons(polygons: Position[][][], grid: GridDefinition, mask: Uint8Array): void {
  for (const polygon of polygons) {
    const local = new Uint8Array(mask.length);
    for (let row = 0; row < grid.height; row++) {
      const y = grid.originY - (row + 0.5) * grid.resolution;
      const crossings: number[] = [];
      for (const ring of polygon) {
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          const [xi, yi] = ring[i];
          const [xj, yj] = ring[j];
          if (yi > y !== yj > y) crossings.push(xi + ((y - yi) / (yj - yi)) * (xj - xi));
        }
      }
      crossings.sort((a, b) => a - b);
      for (let k = 0; k + 1 < crossings.length; k += 2) {
        const c0 = Math.max(0, Math.ceil((crossings[k] - grid.originX) / grid.resolution - 0.5));
        const c1 = Math.min(grid.width - 1, Math.floor((crossings[k + 1] - grid.originX) / grid.resolution - 0.5));
        for (let col = c0; col <= c1; col++) local[row * grid.width + col] ^= 1;
      }
    }
    for (let i = 0; i < mask.length; i++) if (local[i]) mask[i] = 1;
  }
}

/** 1 for pixels whose centre lies inside the lon/lat geometry. */
export function rasterizeGeometryMask(geometry: Geometry, grid: GridDefinition): Uint8Array {
  const mask = new Uint8Array(grid.width * grid.height);
  burnPolygons(projectGeometry(geometry, grid.epsg), grid, mask);
  return mask;
}

/** Lon/lat corners of the grid: top-left, top-right, bottom-right, bottom-left. */
export function gridCornersLonLat(grid: GridDefinition): [number, number][] {
  const back = unprojector(grid.epsg);
  const x1 = grid.originX + grid.width * grid.resolution;
  const y1 = grid.originY - grid.height * grid.resolution;
  return [back(grid.originX, grid.originY), back(x1, grid.originY), back(x1, y1), back(grid.originX, y1)];
}

// ---------------------------------------------------------------------------
// Raster helpers
// ---------------------------------------------------------------------------

export function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/** Small-gap filling defaults: tramlines and headland stripes span 1-2 pixels at 10 m. */
const DEFAULT_MAX_DISTANCE_PX = 2;
const DEFAULT_MIN_NEIGHBORS = 3;

/**
 * Fill small nodata gaps by inverse-distance weighting over the finite neighbours within
 * `maxDistance` pixels. A pixel is only filled when at least `minNeighbors` neighbours carry
 * data — genuine holes (unharvested areas, GPS outages) stay nodata instead of being invented.
 */
export function fillSmallGaps(
  data: Float64Array,
  width: number,
  height: number,
  maxDistance = DEFAULT_MAX_DISTANCE_PX,
  minNeighbors = DEFAULT_MIN_NEIGHBORS,
): { data: Float64Array; filledPixels: number } {
  const filled = Float64Array.from(data);
  let filledPixels = 0;
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const idx = row * width + col;
      if (Number.isFinite(data[idx])) continue;
      let weightSum = 0;
      let valueSum = 0;
      let neighbors = 0;
      for (let dy = -maxDistance; dy <= maxDistance; dy++) {
        const ny = row + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -maxDistance; dx <= maxDistance; dx++) {
          const nx = col + dx;
          if (nx < 0 || nx >= width || (dx === 0 && dy === 0)) continue;
          const value = data[ny * width + nx];
          if (!Number.isFinite(value)) continue;
          const distanceSq = dx * dx + dy * dy;
          if (distanceSq > maxDistance * maxDistance) continue;
          const weight = 1 / distanceSq;
          weightSum += weight;
          valueSum += value * weight;
          neighbors++;
        }
      }
      if (neighbors >= minNeighbors) {
        filled[idx] = valueSum / weightSum;
        filledPixels++;
      }
    }
  }
  return { data: filled, filledPixels };
}

export interface HistogramBin {
  binStart: number;
  binEnd: number;
  count: number;
}

export interface GridStats {
  statistics: { mean: number; median: number; stddev: number; min: number; max: number; q20: number; q80: number; p05: number; p95: number };
  histogram: HistogramBin[];
  validPixels: number;
  areaHa: number;
}

const HISTOGRAM_BINS = 20;

/** Statistics over all finite pixels of a raster (NaN = nodata), optionally inside a mask. */
export function computeGridStats(data: Float64Array, grid: GridDefinition, mask?: Uint8Array): GridStats | null {
  const values: number[] = [];
  for (let i = 0; i < data.length; i++) if (Number.isFinite(data[i]) && (!mask || mask[i])) values.push(data[i]);
  if (values.length === 0) return null;
  const sorted = values.toSorted((a, b) => a - b);
  const n = sorted.length;
  const mean = values.reduce((sum, v) => sum + v, 0) / n;
  const median = n % 2 === 0 ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2 : sorted[Math.floor(n / 2)];
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / n;
  const min = sorted[0];
  const max = sorted[n - 1];
  const binWidth = (max - min) / HISTOGRAM_BINS || 1;
  const histogram: HistogramBin[] = Array.from({ length: HISTOGRAM_BINS }, (_, i) => ({
    binStart: round(min + i * binWidth, 6),
    binEnd: round(min + (i + 1) * binWidth, 6),
    count: 0,
  }));
  for (const v of values) histogram[Math.min(Math.floor((v - min) / binWidth), HISTOGRAM_BINS - 1)].count++;
  const q = (p: number) => round(sorted[Math.min(n - 1, Math.floor(n * p))], 4);
  return {
    statistics: {
      mean: round(mean, 4),
      median: round(median, 4),
      stddev: round(Math.sqrt(variance), 4),
      min: round(min, 4),
      max: round(max, 4),
      q20: q(0.2),
      q80: q(0.8),
      p05: q(0.05),
      p95: q(0.95),
    },
    histogram,
    validPixels: n,
    areaHa: round(n * pixelAreaHa(grid), 4),
  };
}

/** Fraction of masked pixels that carry a finite value, rounded to 4 decimals. */
export function coverageFraction(data: Float64Array, mask: Uint8Array): number {
  let covered = 0;
  let total = 0;
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    total++;
    if (Number.isFinite(data[i])) covered++;
  }
  return total === 0 ? 0 : round(covered / total, 4);
}

/** Raster ⇄ bytes for storage: row-major float32 little-endian. */
export function encodeRaster(data: Float64Array): Buffer {
  const out = Buffer.alloc(data.length * 4);
  for (let i = 0; i < data.length; i++) out.writeFloatLE(Number.isFinite(data[i]) ? data[i] : NaN, i * 4);
  return out;
}

export function decodeRaster(bytes: Buffer | Uint8Array): Float64Array {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const out = new Float64Array(Math.floor(buf.length / 4));
  for (let i = 0; i < out.length; i++) out[i] = buf.readFloatLE(i * 4);
  return out;
}

export type { Polygon, MultiPolygon };
