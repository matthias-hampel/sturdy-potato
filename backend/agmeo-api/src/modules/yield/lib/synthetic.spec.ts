import type { Polygon } from "geojson";
import { fieldGrid } from "./grid.js";
import { syntheticYieldEstimate } from "./synthetic.js";

const FIELD: Polygon = { type: "Polygon", coordinates: [[[9.9, 51.5], [9.903, 51.5], [9.903, 51.502], [9.9, 51.502], [9.9, 51.5]]] };

/** An NDVI raster on the field's own grid, rising from 0.6 in the west to 0.8 in the east. */
function ndviRaster() {
  const grid = fieldGrid([FIELD]);
  const values = new Float64Array(grid.width * grid.height);
  for (let r = 0; r < grid.height; r++) for (let c = 0; c < grid.width; c++) values[r * grid.width + c] = 0.6 + (0.2 * c) / grid.width;
  return { grid, ndvi: { ...grid, values } };
}

describe("syntheticYieldEstimate", () => {
  it("keeps the documented mean exactly and distributes it by relative NDVI", () => {
    const { grid, ndvi } = ndviRaster();
    const estimate = syntheticYieldEstimate(grid, FIELD, ndvi, 8);
    const values = [...estimate].filter(Number.isFinite);
    expect(values.reduce((s, v) => s + v, 0) / values.length).toBeCloseTo(8, 6);
    const row = Math.floor(grid.height / 2) * grid.width;
    const west = [...estimate.subarray(row, row + grid.width)].find(Number.isFinite)!;
    const east = [...estimate.subarray(row, row + grid.width)].reverse().find(Number.isFinite)!;
    expect(east).toBeGreaterThan(west);
  });

  it("flattens the map with a weaker distribution strength", () => {
    const { grid, ndvi } = ndviRaster();
    const full = [...syntheticYieldEstimate(grid, FIELD, ndvi, 8, { spread: 1 })].filter(Number.isFinite);
    const half = [...syntheticYieldEstimate(grid, FIELD, ndvi, 8, { spread: 0.5 })].filter(Number.isFinite);
    const range = (v: number[]) => Math.max(...v) - Math.min(...v);
    expect(range(half)).toBeCloseTo(range(full) / 2, 6);
  });

  it("samples a raster on another grid by coordinates", () => {
    const { grid } = ndviRaster();
    // The same NDVI on a 20 m grid in UTM 33 (a field near the zone border, imaged by another tile).
    const other = fieldGrid([FIELD], 20, 40, 32633);
    const values = new Float64Array(other.width * other.height).fill(0.7);
    const estimate = syntheticYieldEstimate(grid, FIELD, { ...other, values }, 9);
    expect([...estimate].filter(Number.isFinite).every((v) => Math.abs(v - 9) < 1e-9)).toBe(true);
  });

  it("refuses a scene that does not cover the field", () => {
    const { grid } = ndviRaster();
    const empty = { ...grid, values: new Float64Array(grid.width * grid.height).fill(NaN) };
    expect(() => syntheticYieldEstimate(grid, FIELD, empty, 8)).toThrow(/does not cover/);
  });
});
