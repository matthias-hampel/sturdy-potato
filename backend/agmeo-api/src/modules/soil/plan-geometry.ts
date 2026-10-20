/**
 * Geometry of sampling plans, ported from AGVOLUTION/agmeo (lib/soil/zoneGrid.ts,
 * zoneVoronoi.ts): a grid rotated to the field's longest edge (or a drawn axis), and an even
 * hexagonal point layout for Voronoi cells. The boolean operations (clip, union, Voronoi) run
 * in PostGIS; this module lays out cells and points in a local metric frame.
 */
import type { MultiPolygon, Polygon, Position } from 'geojson';

export type LngLat = [number, number];
export type GridAxis = [LngLat, LngLat];

const M_PER_DEG_LAT = 111_320;
export const MAX_CELLS = 4_000;
export const MIN_CELL_M2 = 25;
export const SLIVER_FRACTION = 0.05;

export const ringsOf = (field: Polygon | MultiPolygon): Position[][] => (field.type === 'Polygon' ? field.coordinates : field.coordinates.flat());

const unit = (v: [number, number]): [number, number] => {
  const length = Math.hypot(v[0], v[1]);
  return length === 0 ? [1, 0] : [v[0] / length, v[1] / length];
};

export interface GridFrame {
  gridToLngLat: (p: [number, number]) => LngLat;
  toGrid: (p: Position) => [number, number];
  uMin: number;
  uMax: number;
  vMin: number;
  vMax: number;
}

function longestEdgeDirection(rings: Position[][], toLocal: (p: Position) => [number, number]): [number, number] {
  let best: [number, number] = [1, 0];
  let bestLength = 0;
  for (const ring of rings) {
    for (let i = 1; i < ring.length; i++) {
      const a = toLocal(ring[i - 1]);
      const b = toLocal(ring[i]);
      const edge: [number, number] = [b[0] - a[0], b[1] - a[1]];
      const length = Math.hypot(edge[0], edge[1]);
      if (length > bestLength) {
        bestLength = length;
        best = edge;
      }
    }
  }
  return unit(best);
}

/** A local metric frame whose u axis runs along the axis (default: the longest boundary edge). */
export function gridFrame(field: Polygon | MultiPolygon, axis: GridAxis | null): GridFrame | null {
  const rings = ringsOf(field);
  const origin = axis ? axis[0] : (rings[0]?.[0] as LngLat | undefined);
  if (!origin) return null;
  const mPerDegLon = M_PER_DEG_LAT * Math.cos((origin[1] * Math.PI) / 180);
  const toLocal = (p: Position): [number, number] => [(p[0] - origin[0]) * mPerDegLon, (p[1] - origin[1]) * M_PER_DEG_LAT];
  const toLngLat = ([x, y]: [number, number]): LngLat => [origin[0] + x / mPerDegLon, origin[1] + y / M_PER_DEG_LAT];
  const direction = axis ? unit(toLocal(axis[1])) : longestEdgeDirection(rings, toLocal);
  const toGrid = (p: Position): [number, number] => {
    const [x, y] = toLocal(p);
    return [x * direction[0] + y * direction[1], -x * direction[1] + y * direction[0]];
  };
  const gridToLngLat = ([u, v]: [number, number]) => toLngLat([u * direction[0] - v * direction[1], u * direction[1] + v * direction[0]]);
  let [uMin, uMax, vMin, vMax] = [Infinity, -Infinity, Infinity, -Infinity];
  for (const ring of rings) {
    for (const position of ring) {
      const [u, v] = toGrid(position);
      uMin = Math.min(uMin, u);
      uMax = Math.max(uMax, u);
      vMin = Math.min(vMin, v);
      vMax = Math.max(vMax, v);
    }
  }
  if (!Number.isFinite(uMin) || !Number.isFinite(vMin)) return null;
  return { gridToLngLat, toGrid, uMin, uMax, vMin, vMax };
}

export interface GridCell {
  column: number;
  row: number;
  polygon: Polygon;
}

/** Square cells of `cellHa` covering the field's extent in the frame, plus grid lines for display. */
export function gridCells(field: Polygon | MultiPolygon, cellHa: number, axis: GridAxis | null): { cells: GridCell[]; lines: LngLat[][]; tooMany: boolean } {
  const frame = gridFrame(field, axis);
  if (!frame || !(cellHa > 0)) return { cells: [], lines: [], tooMany: false };
  const side = Math.sqrt(cellHa * 10_000);
  const uStart = Math.floor(frame.uMin / side) * side;
  const vStart = Math.floor(frame.vMin / side) * side;
  const columns = Math.max(1, Math.ceil((frame.uMax - uStart) / side));
  const rows = Math.max(1, Math.ceil((frame.vMax - vStart) / side));
  if (columns * rows > MAX_CELLS) return { cells: [], lines: [], tooMany: true };

  const lines: LngLat[][] = [];
  const uEnd = uStart + columns * side;
  const vEnd = vStart + rows * side;
  for (let i = 0; i <= columns; i++) {
    const u = uStart + i * side;
    lines.push([frame.gridToLngLat([u, vStart]), frame.gridToLngLat([u, vEnd])]);
  }
  for (let j = 0; j <= rows; j++) {
    const v = vStart + j * side;
    lines.push([frame.gridToLngLat([uStart, v]), frame.gridToLngLat([uEnd, v])]);
  }
  const cells: GridCell[] = [];
  for (let i = 0; i < columns; i++) {
    for (let j = 0; j < rows; j++) {
      const u = uStart + i * side;
      const v = vStart + j * side;
      const corners = (
        [
          [u, v],
          [u + side, v],
          [u + side, v + side],
          [u, v + side],
        ] as [number, number][]
      ).map(frame.gridToLngLat);
      cells.push({ column: i, row: j, polygon: { type: 'Polygon', coordinates: [[...corners, corners[0]]] } });
    }
  }
  return { cells, lines, tooMany: false };
}

/**
 * Sliver cells (below `minM2`) join a 4-neighbour, preferably one that is no sliver itself;
 * returns sliver key → target key. Keys are "column:row".
 */
export function sliverMerges(areas: Map<string, number>, minM2: number): Map<string, string> {
  const kept = new Map(areas);
  const into = new Map<string, string>();
  const slivers = [...kept.entries()].filter(([, a]) => a < minM2).sort((a, b) => a[1] - b[1]);
  for (const [key, area] of slivers) {
    if (!kept.has(key)) continue;
    const [column, row] = key.split(':').map(Number);
    const neighbours = [`${column - 1}:${row}`, `${column + 1}:${row}`, `${column}:${row - 1}`, `${column}:${row + 1}`]
      .map((k) => [k, kept.get(k)] as const)
      .filter((entry): entry is [string, number] => entry[1] != null)
      .sort((a, b) => b[1] - a[1]);
    const target = neighbours.find(([, a]) => a >= minM2) ?? neighbours[0];
    if (!target) continue;
    kept.set(target[0], target[1] + area);
    kept.delete(key);
    into.set(key, target[0]);
    for (const [from, to] of into) if (to === key) into.set(from, target[0]);
  }
  return into;
}

/** Walking order: rows from the top, alternating direction (boustrophedon). */
export function serpentine<T extends { row: number; along: number }>(items: T[]): T[] {
  if (items.length === 0) return items;
  const topRow = Math.max(...items.map((item) => item.row));
  return [...items].sort((a, b) => {
    if (a.row !== b.row) return b.row - a.row;
    return (topRow - a.row) % 2 === 0 ? a.along - b.along : b.along - a.along;
  });
}

/** Ray casting on all rings (holes count by parity). */
export function pointInGeometry(p: LngLat, field: Polygon | MultiPolygon): boolean {
  const polygons = field.type === 'Polygon' ? [field.coordinates] : field.coordinates;
  return polygons.some((rings) => {
    let inside = false;
    for (const ring of rings) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i];
        const [xj, yj] = ring[j];
        if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
      }
    }
    return inside;
  });
}

/** Points on a hexagonal lattice whose cells have `cellHa`, inside the field, in walking order. */
export function hexSamplePoints(field: Polygon | MultiPolygon, cellHa: number, axis: GridAxis | null): LngLat[] {
  const frame = gridFrame(field, axis);
  if (!frame || !(cellHa > 0)) return [];
  const spacingU = Math.sqrt((2 * cellHa * 10_000) / Math.sqrt(3));
  const spacingV = (spacingU * Math.sqrt(3)) / 2;
  const columns = Math.ceil((frame.uMax - frame.uMin) / spacingU) + 2;
  const rows = Math.ceil((frame.vMax - frame.vMin) / spacingV) + 2;
  if (columns * rows > MAX_CELLS) return [];
  const uStart = Math.floor(frame.uMin / spacingU) * spacingU;
  const vStart = Math.floor(frame.vMin / spacingV) * spacingV;
  const found: { along: number; row: number; lngLat: LngLat }[] = [];
  for (let j = 0; j <= rows; j++) {
    const v = vStart + j * spacingV + spacingV / 2;
    const stagger = j % 2 === 0 ? 0 : spacingU / 2;
    for (let i = 0; i <= columns; i++) {
      const u = uStart + i * spacingU + stagger + spacingU / 2;
      const lngLat = frame.gridToLngLat([u, v]);
      if (!pointInGeometry(lngLat, field)) continue;
      found.push({ along: u, row: j, lngLat });
    }
  }
  return serpentine(found).map(({ lngLat }) => lngLat);
}

/** Hexagonal layout whose point count comes as close as possible to area / cellHa (five attempts). */
export function planPoints(field: Polygon | MultiPolygon, areaHa: number, cellHa: number, axis: GridAxis | null): LngLat[] {
  if (!(cellHa > 0)) return [];
  const target = Math.max(1, Math.round(areaHa / cellHa));
  let spacingHa = cellHa;
  let best = hexSamplePoints(field, spacingHa, axis);
  for (let attempt = 0; attempt < 5 && best.length !== target; attempt++) {
    const current = hexSamplePoints(field, spacingHa, axis);
    if (current.length === 0) break;
    if (Math.abs(current.length - target) < Math.abs(best.length - target)) best = current;
    spacingHa = (spacingHa * current.length) / target;
  }
  return best;
}

/** Drops points closer than ~1 mm to an earlier one. */
export function uniquePoints(points: LngLat[]): LngLat[] {
  return points.filter((p, index) => !points.some((o, k) => k < index && Math.abs(o[0] - p[0]) < 1e-9 && Math.abs(o[1] - p[1]) < 1e-9));
}
