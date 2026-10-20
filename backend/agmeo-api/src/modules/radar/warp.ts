/**
 * Resampling of the radar grids onto one Web Mercator raster (reference src/lib/dwd/warp.ts),
 * nearest neighbour through a lookup table built once per grid.
 */
import { DE1200, type Projection, RADOLAN, WEB_MERCATOR } from './projection.js';

/** Target resolution in Web Mercator metres (about 1.5 km on the map, ~1 km on the ground in Germany). */
const DST_RES = 1500;

export interface GridDef {
  proj: Projection;
  /** Projected metres of the grid's upper-left (north-west) corner. */
  originX: number;
  originY: number;
  /** Cell size in metres. */
  cell: number;
  rows: number;
  cols: number;
}

/** RADOLAN national grid (RY): 900 × 900 km, lower-left corner at (−523.4622, −4658.645) km. */
export const RY_GRID: GridDef = { proj: RADOLAN, originX: -523_462, originY: -3_758_645, cell: 1000, rows: 900, cols: 900 };

// DE1200 (RV, 1200 × 1100 km): the DWD spec documents the south-west corner in degrees; the
// upper-left origin is derived by projecting it.
const DE1200_SW = DE1200.forward(3.566994635, 45.69642538);
const DE1200_ROWS = 1200;
export const DE1200_GRID: GridDef = {
  proj: DE1200,
  originX: DE1200_SW[0],
  originY: DE1200_SW[1] + DE1200_ROWS * 1000,
  cell: 1000,
  rows: DE1200_ROWS,
  cols: 1100,
};

export interface WarpedFrame {
  /** Same unit as the input (mm in 5 minutes); row-major, north up. NaN = no data or outside coverage. */
  values: Float32Array;
  width: number;
  height: number;
  /** WGS84 bounds [west, south, east, north]. */
  bounds: [number, number, number, number];
}

export interface DstSpec {
  mercMinX: number;
  mercMaxY: number;
  width: number;
  height: number;
  res: number;
  /** WGS84 bounds of the raster's corners [west, south, east, north]. */
  bounds: [number, number, number, number];
}

// Edge-sample the source rectangle so the target box catches the curve of the stereographic
// projection; the corners alone underestimate the north edge.
const EDGE_SAMPLES = 21;
function edgeSamples(grid: GridDef): [number, number][] {
  const xMin = grid.originX;
  const xMax = grid.originX + grid.cols * grid.cell;
  const yMin = grid.originY - grid.rows * grid.cell;
  const yMax = grid.originY;
  const out: [number, number][] = [];
  for (let i = 0; i < EDGE_SAMPLES; i++) {
    const f = i / (EDGE_SAMPLES - 1);
    out.push([xMin + f * (xMax - xMin), yMin], [xMin + f * (xMax - xMin), yMax], [xMin, yMin + f * (yMax - yMin)], [xMax, yMin + f * (yMax - yMin)]);
  }
  return out;
}

export function dstSpecFor(grid: GridDef, res = DST_RES): DstSpec {
  const merc = edgeSamples(grid).map(([x, y]) => WEB_MERCATOR.forward(...grid.proj.inverse(x, y)));
  const minX = Math.min(...merc.map((p) => p[0]));
  const maxX = Math.max(...merc.map((p) => p[0]));
  const minY = Math.min(...merc.map((p) => p[1]));
  const maxY = Math.max(...merc.map((p) => p[1]));
  const width = Math.round((maxX - minX) / res);
  const height = Math.round((maxY - minY) / res);
  // The image is placed on the map by its corners, so the bounds are those of the pixel raster
  // (the reference used the source grid's extent, which is off by the rounding of width/height).
  const [west, north] = WEB_MERCATOR.inverse(minX, maxY);
  const [east, south] = WEB_MERCATOR.inverse(minX + width * res, maxY - height * res);
  return { mercMinX: minX, mercMaxY: maxY, width, height, res, bounds: [west, south, east, north] };
}

/**
 * Every frame, analyses (RY) and nowcast (DE1200) alike, is warped into the same raster (RY's
 * box), so all frames share bounds and size. The DE1200 fringe outside it is cropped.
 */
export const RADAR_RASTER: DstSpec = dstSpecFor(RY_GRID);

export type Warper = (src: Float32Array, srcRows: number, srcCols: number) => WarpedFrame;

/** Target pixel → source index (−1 outside the source grid). */
export function buildLookup(grid: GridDef, dst: DstSpec): Int32Array {
  const out = new Int32Array(dst.width * dst.height);
  for (let y = 0; y < dst.height; y++) {
    const my = dst.mercMaxY - (y + 0.5) * dst.res;
    for (let x = 0; x < dst.width; x++) {
      const mx = dst.mercMinX + (x + 0.5) * dst.res;
      const [sx, sy] = grid.proj.forward(...WEB_MERCATOR.inverse(mx, my));
      const col = Math.floor((sx - grid.originX) / grid.cell);
      const row = Math.floor((grid.originY - sy) / grid.cell);
      out[y * dst.width + x] = row >= 0 && row < grid.rows && col >= 0 && col < grid.cols ? row * grid.cols + col : -1;
    }
  }
  return out;
}

export function createWarper(grid: GridDef, dst: DstSpec): Warper {
  // Built on the first frame, reused for every later one.
  let lut: Int32Array | null = null;
  return (src, srcRows, srcCols) => {
    if (srcRows !== grid.rows || srcCols !== grid.cols) throw new Error(`warp: expected ${grid.rows}x${grid.cols}, got ${srcRows}x${srcCols}`);
    lut ??= buildLookup(grid, dst);
    const out = new Float32Array(dst.width * dst.height);
    for (let i = 0; i < out.length; i++) {
      const idx = lut[i];
      out[i] = idx >= 0 ? src[idx] : NaN;
    }
    return { values: out, width: dst.width, height: dst.height, bounds: dst.bounds };
  };
}

/** RY analyses → the shared raster. */
export const warpRy: Warper = createWarper(RY_GRID, RADAR_RASTER);
/** DE1200 nowcast members → the same raster. */
export const warpDe1200: Warper = createWarper(DE1200_GRID, RADAR_RASTER);
