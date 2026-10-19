/** Ported from AGVOLUTION/agmeo lib/soil/zoneGrid.test.ts and zoneVoronoi.test.ts (layout part; clipping runs in PostGIS). */
import type { Polygon } from 'geojson';
import { gridCells, hexSamplePoints, planPoints, pointInGeometry, serpentine, sliverMerges, type GridAxis } from './plan-geometry.js';

const LAT = 52;
const M_PER_DEG_LAT = 111_320;
const M_PER_DEG_LON = M_PER_DEG_LAT * Math.cos((LAT * Math.PI) / 180);

const squareField = (sideM: number): Polygon => {
  const dLon = sideM / M_PER_DEG_LON;
  const dLat = sideM / M_PER_DEG_LAT;
  return { type: 'Polygon', coordinates: [[[10, LAT], [10 + dLon, LAT], [10 + dLon, LAT + dLat], [10, LAT + dLat], [10, LAT]]] };
};

describe('grid cells', () => {
  it('lays 1 ha cells over an axis-aligned 4 ha field (empty edge cells are dropped by the clip)', () => {
    const { cells, tooMany, lines } = gridCells(squareField(200), 1, null);
    expect(tooMany).toBe(false);
    expect(cells.length).toBeGreaterThanOrEqual(4);
    expect(cells.length).toBeLessThanOrEqual(9);
    expect(cells.some((c) => c.column === 0 && c.row === 0)).toBe(true);
    expect(lines.length).toBeGreaterThanOrEqual(6);
  });

  it('rotates the grid along a drawn axis', () => {
    const axis: GridAxis = [
      [10, LAT],
      [10 + 100 / M_PER_DEG_LON, LAT + 100 / M_PER_DEG_LAT],
    ];
    expect(gridCells(squareField(200), 1, axis).cells.length).toBeGreaterThan(4);
  });

  it('reports too many cells instead of freezing on a tiny cell size', () => {
    const { cells, tooMany } = gridCells(squareField(2000), 0.01, null);
    expect(tooMany).toBe(true);
    expect(cells).toHaveLength(0);
  });

  it('merges slivers into the largest neighbour that is no sliver itself', () => {
    const areas = new Map([
      ['0:0', 10_000],
      ['1:0', 300],
      ['2:0', 9_000],
      ['5:5', 100],
    ]);
    const into = sliverMerges(areas, 500);
    expect(into.get('1:0')).toBe('0:0');
    // An isolated sliver without neighbours stays.
    expect(into.has('5:5')).toBe(false);
  });

  it('orders cells as a serpentine route', () => {
    const order = serpentine([
      { row: 0, along: 0 },
      { row: 0, along: 1 },
      { row: 1, along: 0 },
      { row: 1, along: 1 },
    ]);
    expect(order).toEqual([
      { row: 1, along: 0 },
      { row: 1, along: 1 },
      { row: 0, along: 1 },
      { row: 0, along: 0 },
    ]);
  });
});

describe('sample points', () => {
  it('finds points inside polygons, holes excluded', () => {
    const outer = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];
    const hole = [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]];
    const field: Polygon = { type: 'Polygon', coordinates: [outer, hole] };
    expect(pointInGeometry([1, 1], field)).toBe(true);
    expect(pointInGeometry([5, 5], field)).toBe(false);
    expect(pointInGeometry([11, 5], field)).toBe(false);
  });

  it('lays out a hexagonal pattern inside the field', () => {
    const field = squareField(300);
    const points = hexSamplePoints(field, 1, null);
    expect(points.length).toBeGreaterThanOrEqual(7);
    expect(points.every((p) => pointInGeometry(p, field))).toBe(true);
  });

  it('aims at area / cell size points', () => {
    const field = squareField(400);
    const points = planPoints(field, 16, 2, null);
    expect(Math.abs(points.length - 8)).toBeLessThanOrEqual(2);
  });
});
