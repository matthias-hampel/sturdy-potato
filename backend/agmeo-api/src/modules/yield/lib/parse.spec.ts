import { type GridDefinition, unprojector } from "./grid.js";

import type { YieldPoint } from "./parse.js";
import { gridYieldPoints, resolveCropWindow, standardizeMoisture } from "./parse.js";

const GRID: GridDefinition = { epsg: 32632, originX: 1_000_000, originY: 6_000_100, resolution: 10, width: 10, height: 10 };

const fromUtm = unprojector(32632);

/** A point at grid coordinates (UTM 32N). */
function pointAt3857(x: number, y: number, value: number): YieldPoint {
  const [lon, lat] = fromUtm(x, y);
  return { lon, lat, value };
}

describe("gridYieldPoints", () => {
  it("averages multiple points falling into the same pixel", () => {
    const points = [
      pointAt3857(1_000_001, 6_000_099, 10), // pixel (0,0)
      pointAt3857(1_000_009, 6_000_091, 20), // pixel (0,0)
      pointAt3857(1_000_015, 6_000_095, 40), // pixel (1,0)
    ];

    const { raster, coveredPixels, pointsUsed } = gridYieldPoints(points, GRID);
    expect(pointsUsed).toBe(3);
    expect(coveredPixels).toBe(2);
    expect(raster[0]).toBe(15);
    expect(raster[1]).toBe(40);
    expect(Number.isNaN(raster[2])).toBe(true);
  });

  it("ignores points outside the grid", () => {
    const outside = pointAt3857(999_000, 6_000_050, 99);
    const { coveredPixels, pointsUsed } = gridYieldPoints([outside], GRID);
    expect(pointsUsed).toBe(0);
    expect(coveredPixels).toBe(0);
  });
});

describe("standardizeMoisture", () => {
  it("rescales wet mass to the target moisture and skips points without moisture", () => {
    const points: YieldPoint[] = [
      { lon: 0, lat: 0, value: 10, moisture: 30 },
      { lon: 0, lat: 0, value: 10 },
    ];
    const standardized = standardizeMoisture(points, 14, "wet");
    expect(standardized).toBe(1);
    expect(points[0].value).toBeCloseTo((10 * 70) / 86);
    expect(points[1].value).toBe(10);
  });

  it("resolves crop windows from JD cropNames, German names and co2nserve ids", () => {
    expect(resolveCropWindow("BARLEY")).toEqual([3, 12]);
    expect(resolveCropWindow("Wintergerste")).toEqual([3, 12]);
    expect(resolveCropWindow("WHEAT_EURO_WTR")).toEqual([4, 12]);
    expect(resolveCropWindow("winterWheat")).toEqual([4, 12]);
    expect(resolveCropWindow("CORN_SILAGE")).toEqual([20, 70]); // silage beats the CORN prefix
    expect(resolveCropWindow("CORN_WET")).toEqual([6, 15]);
    expect(resolveCropWindow("GRASS_SEEDS")).toEqual([0.5, 2.5]); // seeds beat the grassland match
    expect(resolveCropWindow("Grünland")).toEqual([1.5, 15]);
    expect(resolveCropWindow("RAPE_SEED")).toEqual([2, 5.5]);
    expect(resolveCropWindow("SOYBEANS")).toEqual([1.5, 120]); // unknown → generic fallback
    expect(resolveCropWindow(undefined)).toEqual([1.5, 120]);
  });

  it("scales dry mass up to the target instead of drying it again", () => {
    const points: YieldPoint[] = [
      { lon: 0, lat: 0, value: 8.6, moisture: 30 },
      { lon: 0, lat: 0, value: 8.6 },
    ];
    const standardized = standardizeMoisture(points, 14, "dry");
    expect(standardized).toBe(2);
    // dry → 14%: value × 100/86; the moisture channel must NOT shrink the value
    expect(points[0].value).toBeCloseTo((8.6 * 100) / 86);
    expect(points[1].value).toBeCloseTo((8.6 * 100) / 86);
  });
});
