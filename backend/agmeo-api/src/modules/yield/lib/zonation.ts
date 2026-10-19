import type { Geometry, MultiPolygon, Polygon, Position } from 'geojson';
import { type GridDefinition, GridError, pixelAreaHa, rasterizeGeometryMask, round, unprojector } from './grid.js';

/**
 * Yield zones: a yield raster (measured, merged monitor map or the satellite estimate)
 * classified into k zones by quantiles, smoothed, small fragments merged, and vectorised.
 *
 * Quantiles rather than k-means, deliberately: a monitor map is noisy, and k-means on a single
 * variable happily produces a class covering 2 % of the field — below section-control
 * resolution and impossible to explain to the person who has to drive it. Equal-count bins
 * guarantee usable areas.
 */

export type YieldZoneDraft = {
  classIndex: number;
  color: string;
  /** lon/lat, not yet clipped to the boundary (the caller clips in PostGIS). */
  geometry: Polygon | MultiPolygon;
  areaHa: number;
  /** Mean yield of the zone's measured pixels [t/ha] */
  meanValue: number;
};

/** YlGn ramp the yield drapes use; the near-white low end is skipped so zones stay visible. */
const YLGN = ['#ffffe5', '#f7fcb9', '#d9f0a3', '#addd8e', '#78c679', '#41ab5d', '#238443', '#005a32'];

export function yieldZoneColors(k: number): string[] {
  const lo = 2;
  const hi = YLGN.length - 1;
  if (k <= 1) return [YLGN[Math.round((lo + hi) / 2)]];
  return Array.from({ length: k }, (_, i) => YLGN[lo + Math.round((i * (hi - lo)) / (k - 1))]);
}

/** Smallest zone fragment kept [ha] — the reference's soil zonation default. */
export const MIN_ZONE_HA_DEFAULT = 0.25;
const BLUR_PASSES = 3;
/** Refuse to fill when the raster covers less than this share of the boundary. */
const MIN_BOUNDARY_OVERLAP = 0.1;

/**
 * Mask-aware 3×3 mean blur, `passes` times. NaN cells stay NaN and don't bleed into their
 * neighbours. Three passes on the 10 m grid melt the single-pixel islands quantile binning
 * of raw data produces.
 */
export function blurEstimate(estimate: Float64Array, width: number, height: number, passes: number): Float64Array {
  let src = estimate;
  for (let pass = 0; pass < passes; pass++) {
    const out = new Float64Array(src.length).fill(NaN);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        if (!Number.isFinite(src[idx])) continue;
        let sum = 0;
        let count = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const ny = y + dy;
          if (ny < 0 || ny >= height) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            if (nx < 0 || nx >= width) continue;
            const v = src[ny * width + nx];
            if (!Number.isFinite(v)) continue;
            sum += v;
            count++;
          }
        }
        out[idx] = sum / count;
      }
    }
    src = out;
  }
  return src;
}

function neighbors4(idx: number, width: number, height: number): number[] {
  const row = Math.floor(idx / width);
  const col = idx % width;
  const out: number[] = [];
  if (row > 0) out.push(idx - width);
  if (row < height - 1) out.push(idx + width);
  if (col > 0) out.push(idx - 1);
  if (col < width - 1) out.push(idx + 1);
  return out;
}

function labelComponents(classGrid: Int8Array, width: number, height: number): { cls: number; pixels: number[] }[] {
  const visited = new Uint8Array(width * height);
  const comps: { cls: number; pixels: number[] }[] = [];
  for (let i = 0; i < classGrid.length; i++) {
    if (classGrid[i] < 0 || visited[i]) continue;
    const cls = classGrid[i];
    const pixels: number[] = [];
    const stack = [i];
    visited[i] = 1;
    while (stack.length > 0) {
      const idx = stack.pop()!;
      pixels.push(idx);
      for (const n of neighbors4(idx, width, height)) {
        if (!visited[n] && classGrid[n] === cls) {
          visited[n] = 1;
          stack.push(n);
        }
      }
    }
    comps.push({ cls, pixels });
  }
  return comps;
}

/**
 * Class-preserving small-component merge: each class keeps its largest component even when
 * that is below minPixels, so the requested zone count is kept.
 */
export function mergeSmallComponents(classGrid: Int8Array, width: number, height: number, numZones: number, minPixels: number): void {
  let changed = true;
  while (changed) {
    changed = false;
    const comps = labelComponents(classGrid, width, height);
    const largestOfClass = new Int32Array(numZones).fill(-1);
    for (let ci = 0; ci < comps.length; ci++) {
      const cur = largestOfClass[comps[ci].cls];
      if (cur === -1 || comps[ci].pixels.length > comps[cur].pixels.length) largestOfClass[comps[ci].cls] = ci;
    }
    for (let ci = 0; ci < comps.length; ci++) {
      const { cls, pixels } = comps[ci];
      if (pixels.length >= minPixels || largestOfClass[cls] === ci) continue;
      const neighborCounts = new Int32Array(numZones);
      for (const idx of pixels) {
        for (const n of neighbors4(idx, width, height)) {
          const nc = classGrid[n];
          if (nc >= 0 && nc !== cls) neighborCounts[nc]++;
        }
      }
      let bestClass = -1;
      let bestCount = 0;
      for (let c = 0; c < numZones; c++) {
        if (neighborCounts[c] > bestCount) {
          bestCount = neighborCounts[c];
          bestClass = c;
        }
      }
      if (bestClass >= 0) {
        for (const idx of pixels) classGrid[idx] = bestClass;
        changed = true;
      }
    }
  }
}

export function majorityFilter3x3(classGrid: Int8Array, width: number, height: number, numZones: number): Int8Array {
  const out = new Int8Array(width * height);
  const counts = new Int32Array(numZones);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const centre = classGrid[idx];
      if (centre < 0) {
        out[idx] = -1;
        continue;
      }
      counts.fill(0);
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= width) continue;
          const c = classGrid[yy * width + xx];
          if (c >= 0 && c < numZones) counts[c]++;
        }
      }
      let bestC = centre;
      let bestN = counts[centre]; // tie-break favours the original class
      for (let c = 0; c < numZones; c++) {
        if (counts[c] > bestN) {
          bestN = counts[c];
          bestC = c;
        }
      }
      out[idx] = bestC;
    }
  }
  return out;
}

/** 1-pixel dilation (8-neighbourhood). */
export function dilateMask(mask: Uint8Array, width: number, height: number): Uint8Array {
  const out = Uint8Array.from(mask);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!mask[y * width + x]) continue;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const ny = y + dy;
          const nx = x + dx;
          if (ny >= 0 && ny < height && nx >= 0 && nx < width) out[ny * width + nx] = 1;
        }
      }
    }
  }
  return out;
}

/** Restricted to the mask: every NaN pixel inside takes the nearest measured value (BFS), everything outside is NaN. */
export function fillToMask(data: Float64Array, width: number, height: number, mask: Uint8Array): Float64Array {
  const out = Float64Array.from(data);
  const queue: number[] = [];
  const seen = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) {
    if (Number.isFinite(data[i])) {
      queue.push(i);
      seen[i] = 1;
    }
  }
  for (let head = 0; head < queue.length; head++) {
    const idx = queue[head];
    for (const n of neighbors4(idx, width, height)) {
      if (seen[n] || !mask[n]) continue;
      seen[n] = 1;
      out[n] = out[idx];
      queue.push(n);
    }
  }
  for (let i = 0; i < out.length; i++) if (!mask[i]) out[i] = NaN;
  return out;
}

function blankExcluded(raster: Float64Array, excludeMask: Uint8Array): Float64Array {
  const out = Float64Array.from(raster);
  const n = Math.min(out.length, excludeMask.length);
  for (let i = 0; i < n; i++) if (excludeMask[i]) out[i] = NaN;
  return out;
}

// ---------------------------------------------------------------------------
// Vectorisation
// ---------------------------------------------------------------------------

/**
 * Polygons of each class, traced along pixel edges. Each class pixel contributes the edges it
 * does not share with a pixel of the same class, directed so the class lies on their left
 * (y up); edges chain into rings — counter-clockwise outer rings and clockwise holes. At a
 * vertex where two rings touch diagonally the sharpest left turn is taken, which keeps every
 * ring simple. Neighbouring zones share exactly the same pixel corners.
 */
export function vectorizeClasses(classGrid: Int8Array, width: number, height: number, k: number): Map<number, Position[][][]> {
  const result = new Map<number, Position[][][]>();
  const W1 = width + 1;
  const vid = (x: number, y: number) => y * W1 + x; // x: column corner, y: row corner (0 = top)
  for (let cls = 0; cls < k; cls++) {
    // Outgoing edges per start vertex; coordinates in (col, row) corners, rows grow downwards.
    const outgoing = new Map<number, number[]>();
    let edges = 0;
    const add = (x0: number, y0: number, x1: number, y1: number) => {
      const from = vid(x0, y0);
      const list = outgoing.get(from);
      if (list) list.push(vid(x1, y1));
      else outgoing.set(from, [vid(x1, y1)]);
      edges++;
    };
    const is = (r: number, c: number) => r >= 0 && r < height && c >= 0 && c < width && classGrid[r * width + c] === cls;
    for (let r = 0; r < height; r++) {
      for (let c = 0; c < width; c++) {
        if (classGrid[r * width + c] !== cls) continue;
        // Counter-clockwise with y up (interior on the left): bottom edge west→east, right edge
        // south→north, top edge east→west, left edge north→south.
        if (!is(r + 1, c)) add(c, r + 1, c + 1, r + 1);
        if (!is(r, c + 1)) add(c + 1, r + 1, c + 1, r);
        if (!is(r - 1, c)) add(c + 1, r, c, r);
        if (!is(r, c - 1)) add(c, r, c, r + 1);
      }
    }
    if (!edges) continue;

    const rings: [number, number][][] = [];
    const take = (from: number, prevDir: [number, number] | null): number | null => {
      const list = outgoing.get(from);
      if (!list?.length) return null;
      let pick = 0;
      if (list.length > 1 && prevDir) {
        // Prefer the sharpest left turn (y up): cross(prev, next) largest.
        let best = -Infinity;
        for (let i = 0; i < list.length; i++) {
          const dx = (list[i] % W1) - (from % W1);
          const dy = -(Math.floor(list[i] / W1) - Math.floor(from / W1));
          const cross = prevDir[0] * dy - prevDir[1] * dx;
          const dot = prevDir[0] * dx + prevDir[1] * dy;
          const score = cross * 2 + dot; // left > straight > right
          if (score > best) {
            best = score;
            pick = i;
          }
        }
      }
      const [to] = list.splice(pick, 1);
      if (!list.length) outgoing.delete(from);
      return to;
    };
    while (outgoing.size) {
      const start = outgoing.keys().next().value as number;
      const ring: [number, number][] = [[start % W1, Math.floor(start / W1)]];
      let current = start;
      let prevDir: [number, number] | null = null;
      for (let guard = 0; guard <= edges; guard++) {
        const next = take(current, prevDir);
        if (next === null) break;
        prevDir = [(next % W1) - (current % W1), -(Math.floor(next / W1) - Math.floor(current / W1))];
        current = next;
        ring.push([next % W1, Math.floor(next / W1)]);
        if (next === start) break;
      }
      if (ring.length >= 4 && current === start) rings.push(simplifyRing(ring));
    }

    // Signed area with y up: counter-clockwise (outer) is positive.
    const signed = (ring: [number, number][]) => {
      let a = 0;
      for (let i = 0; i + 1 < ring.length; i++) a += ring[i][0] * -ring[i + 1][1] - ring[i + 1][0] * -ring[i][1];
      return a / 2;
    };
    const outers = rings.filter((r) => signed(r) > 0).map((r) => ({ ring: r, area: signed(r), holes: [] as [number, number][][] }));
    for (const hole of rings.filter((r) => signed(r) < 0)) {
      // A point just left of the hole's first edge lies in the class region, i.e. inside the owner.
      const [[x0, y0], [x1, y1]] = hole;
      const probe: [number, number] = [(x0 + x1) / 2 + 0.25 * (y1 - y0), (y0 + y1) / 2 - 0.25 * (x1 - x0)];
      const owner = outers.filter((o) => pointInRing(probe, o.ring)).sort((a, b) => a.area - b.area)[0];
      owner?.holes.push(hole);
    }
    result.set(
      cls,
      outers.map((o) => [o.ring, ...o.holes]),
    );
  }
  return result;
}

/** Drop collinear vertices of a closed pixel ring. */
function simplifyRing(ring: [number, number][]): [number, number][] {
  const open = ring.slice(0, -1);
  const out: [number, number][] = [];
  for (let i = 0; i < open.length; i++) {
    const prev = open[(i - 1 + open.length) % open.length];
    const cur = open[i];
    const next = open[(i + 1) % open.length];
    const cross = (cur[0] - prev[0]) * (next[1] - cur[1]) - (cur[1] - prev[1]) * (next[0] - cur[0]);
    if (cross !== 0) out.push(cur);
  }
  out.push(out[0]);
  return out;
}

function pointInRing([x, y]: [number, number], ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < xi + ((y - yi) / (yj - yi)) * (xj - xi)) inside = !inside;
  }
  return inside;
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

export type YieldZonationOptions = {
  blurPasses?: number;
  minZoneHa?: number;
  /**
   * Pixels whose yield is machinery-made rather than site-made (headland, tramlines): treated
   * like a hole — no part in thresholds and means, but they still receive a class from the
   * fill so the zones keep tiling the field. Off by default.
   */
  excludeMask?: Uint8Array;
  /**
   * The boundary the zones must tile. NaN holes inside it are grown from the nearest measured
   * pixel before classification; thresholds and zone means still come from measured pixels.
   * Throws GridError when the boundary barely overlaps the raster. The grid must cover the
   * boundary (the field grid does, with a margin).
   */
  boundary?: Geometry;
};

export type YieldZonation = { zones: YieldZoneDraft[]; classGrid: Int8Array };

/**
 * The same classification for ANY yield raster on the grid — the satellite estimate or a
 * measured, merged monitor map.
 */
export function classifyYieldRaster(grid: GridDefinition, rawEstimate: Float64Array, numberOfZones: number, options: YieldZonationOptions = {}): YieldZonation {
  const k = Math.max(1, Math.min(10, Math.round(numberOfZones)));
  const measured = options.excludeMask ? blankExcluded(rawEstimate, options.excludeMask) : rawEstimate;
  let work = measured;
  if (options.boundary) {
    const mask = dilateMask(rasterizeGeometryMask(options.boundary, grid), grid.width, grid.height);
    let maskPixels = 0;
    let measuredInMask = 0;
    for (let i = 0; i < measured.length; i++) {
      if (!mask[i]) continue;
      maskPixels++;
      if (Number.isFinite(measured[i])) measuredInMask++;
    }
    if (maskPixels === 0 || measuredInMask < MIN_BOUNDARY_OVERLAP * maskPixels) {
      throw new GridError(
        `Raster data covers ${maskPixels === 0 ? 0 : Math.round((100 * measuredInMask) / maskPixels)}% of the boundary — boundary and raster are not the same place`,
        422,
      );
    }
    work = fillToMask(measured, grid.width, grid.height, mask);
  }
  const estimate = blurEstimate(work, grid.width, grid.height, options.blurPasses ?? BLUR_PASSES);

  // Thresholds from measured pixels only.
  const values: number[] = [];
  for (let i = 0; i < estimate.length; i++) if (Number.isFinite(estimate[i]) && Number.isFinite(measured[i])) values.push(estimate[i]);
  if (values.length === 0) return { zones: [], classGrid: new Int8Array(estimate.length).fill(-1) };
  values.sort((a, b) => a - b);
  const thresholds = Array.from({ length: k - 1 }, (_, i) => values[Math.floor(((i + 1) * values.length) / k)]);

  const classGridRaw = new Int8Array(estimate.length).fill(-1);
  for (let i = 0; i < estimate.length; i++) {
    const v = estimate[i];
    if (!Number.isFinite(v)) continue;
    let cls = 0;
    while (cls < thresholds.length && v >= thresholds[cls]) cls++;
    classGridRaw[i] = cls;
  }
  const classGrid = majorityFilter3x3(classGridRaw, grid.width, grid.height, k);
  const minPixels = Math.max(5, Math.ceil((options.minZoneHa ?? MIN_ZONE_HA_DEFAULT) / pixelAreaHa(grid)));
  mergeSmallComponents(classGrid, grid.width, grid.height, k, minPixels);

  const back = unprojector(grid.epsg);
  const toGeo = ([c, r]: Position): Position => {
    const [lon, lat] = back(grid.originX + c * grid.resolution, grid.originY - r * grid.resolution);
    return [round(lon, 8), round(lat, 8)];
  };
  const polygons = vectorizeClasses(classGrid, grid.width, grid.height, k);
  const colors = yieldZoneColors(k);
  const zones: YieldZoneDraft[] = [];
  for (let cls = 0; cls < k; cls++) {
    let sum = 0;
    let count = 0;
    let filledSum = 0;
    let filledCount = 0;
    let pixels = 0;
    for (let i = 0; i < classGrid.length; i++) {
      if (classGrid[i] !== cls) continue;
      pixels++;
      if (!Number.isFinite(estimate[i])) continue;
      if (Number.isFinite(measured[i])) {
        sum += estimate[i];
        count++;
      } else {
        filledSum += estimate[i];
        filledCount++;
      }
    }
    if (count === 0) {
      sum = filledSum;
      count = filledCount;
    }
    const parts = polygons.get(cls);
    if (count === 0 || !parts?.length) continue;
    const coordinates = parts.map((polygon) => polygon.map((ring) => ring.map(toGeo)));
    zones.push({
      classIndex: cls,
      color: colors[cls],
      geometry: coordinates.length === 1 ? { type: 'Polygon', coordinates: coordinates[0] } : { type: 'MultiPolygon', coordinates },
      areaHa: round(pixels * pixelAreaHa(grid), 2),
      meanValue: round(sum / count, 2),
    });
  }
  return { zones, classGrid };
}

export function computeYieldZonesFromRaster(grid: GridDefinition, raster: Float64Array, numberOfZones: number, options: YieldZonationOptions = {}): YieldZoneDraft[] {
  return classifyYieldRaster(grid, raster, numberOfZones, options).zones;
}

// ---------------------------------------------------------------------------
// Zone count
// ---------------------------------------------------------------------------

/**
 * Field-size-aware cap: a machine realistically can't apply more than a handful of distinct
 * rates per field; bigger fields tolerate more zones.
 */
export function kMaxForArea(areaHa: number): number {
  if (areaHa < 4) return 2;
  if (areaHa < 8) return 3;
  if (areaHa < 15) return 4;
  return 5;
}

/** Minimum step between neighbouring zone means, as a share of the field mean. */
const MIN_ZONE_STEP_SHARE = 0.08;

/**
 * How many zones the measured spread actually supports, capped by what a machine can apply.
 * With K quantile zones neighbouring means differ by roughly spread / (K − 1), so requiring
 * MIN_ZONE_STEP_SHARE per step gives the count the data carries.
 */
export function zoneCountForSpread(raster: { meanTHa: number | null; q20THa: number | null; q80THa: number | null }, areaHa: number): number {
  const cap = kMaxForArea(areaHa);
  const { meanTHa, q20THa, q80THa } = raster;
  if (!meanTHa || q20THa == null || q80THa == null || meanTHa <= 0) return cap;
  const relativeSpread = (q80THa - q20THa) / meanTHa;
  const supported = 1 + Math.floor(relativeSpread / MIN_ZONE_STEP_SHARE);
  return Math.max(2, Math.min(cap, supported));
}
