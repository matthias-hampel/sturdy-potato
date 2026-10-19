import type { MultiPolygon, Polygon } from "geojson";

import { type GridDefinition, GridError, projectGeometry, rasterizeGeometryMask, unprojector } from "./grid.js";
import { classifyYieldRaster, computeYieldZonesFromRaster, vectorizeClasses } from "./zonation.js";

/** 60 × 60 pixels at 10 m = 36 ha, big enough that zones clear the fragment floor. */
const GRID: GridDefinition = { epsg: 32632, originX: 540_000, originY: 5_890_000, resolution: 10, width: 60, height: 60 };

/** West-to-east yield gradient, i.e. what a real field's raster looks like. */
function gradient(): Float64Array {
  const data = new Float64Array(GRID.width * GRID.height);
  for (let row = 0; row < GRID.height; row++) {
    for (let col = 0; col < GRID.width; col++) {
      data[row * GRID.width + col] = 5 + (col / GRID.width) * 6;
    }
  }
  return data;
}

describe("computeYieldZonesFromRaster", () => {
  it("produces k zones ordered by yield, with means that increase", () => {
    const zones = computeYieldZonesFromRaster(GRID, gradient(), 4);

    expect(zones).toHaveLength(4);
    expect(zones.map((zone) => zone.classIndex)).toEqual([0, 1, 2, 3]);
    for (let i = 1; i < zones.length; i++) {
      expect(zones[i].meanValue).toBeGreaterThan(zones[i - 1].meanValue);
    }
  });

  it("splits the field into comparable areas — the reason quantiles beat k-means here", () => {
    // k-means on one variable happily produces a class covering 2 % of a field:
    // below section-control resolution and useless for zonal statistics.
    const zones = computeYieldZonesFromRaster(GRID, gradient(), 4);
    const areas = zones.map((zone) => zone.areaHa);
    const total = areas.reduce((sum, area) => sum + area, 0);

    for (const area of areas) {
      expect(area).toBeGreaterThan(total * 0.1);
    }
  });

  it("ignores nodata pixels rather than classifying them", () => {
    const data = gradient();
    for (let i = 0; i < data.length; i += 2) data[i] = NaN;

    const zones = computeYieldZonesFromRaster(GRID, data, 3);
    expect(zones.length).toBeGreaterThan(0);
    for (const zone of zones) expect(Number.isFinite(zone.meanValue)).toBe(true);
  });

  it("clamps the zone count to something a machine can execute", () => {
    expect(computeYieldZonesFromRaster(GRID, gradient(), 99).length).toBeLessThanOrEqual(10);
    expect(computeYieldZonesFromRaster(GRID, gradient(), 0)).toHaveLength(1);
  });

  it("returns nothing for an empty raster instead of inventing zones", () => {
    expect(computeYieldZonesFromRaster(GRID, new Float64Array(GRID.width * GRID.height).fill(NaN), 3)).toEqual([]);
  });
});

const fromUtm = unprojector(32632);

/** Rectangle polygon in 4326 covering the given grid (UTM 32N) bbox. */
function rect4326(minX: number, minY: number, maxX: number, maxY: number): Polygon {
  const corners: [number, number][] = [
    [minX, minY],
    [maxX, minY],
    [maxX, maxY],
    [minX, maxY],
    [minX, minY],
  ];
  return { type: "Polygon", coordinates: [corners.map(([x, y]) => fromUtm(x, y))] };
}

/** Planar area in the grid CRS [ha]; turf's spherical area in the reference. */
const sphericalAreaHa = (geometry: Polygon | MultiPolygon) =>
  projectGeometry(geometry, GRID.epsg).reduce(
    (sum, polygon) =>
      sum +
      polygon.reduce((ringSum, ring, i) => {
        let a = 0;
        for (let k = 0; k + 1 < ring.length; k++) a += ring[k][0] * ring[k + 1][1] - ring[k + 1][0] * ring[k][1];
        return ringSum + (i === 0 ? Math.abs(a) / 2 : -Math.abs(a) / 2);
      }, 0),
    0,
  ) / 10_000;

/**
 * Boundary area no zone covers [ha]: boundary pixels left unclassified. The reference unions
 * the zone polygons with turf; the zones are traced from the class grid, so its coverage is the
 * same thing at pixel resolution.
 */
function uncoveredHa(boundary: Polygon, raster: Float64Array, k: number, options: Parameters<typeof classifyYieldRaster>[3] = {}) {
  const { classGrid } = classifyYieldRaster(GRID, raster, k, { ...options, boundary });
  const mask = rasterizeGeometryMask(boundary, GRID);
  let uncovered = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i] && classGrid[i] < 0) uncovered++;
  return (uncovered * GRID.resolution ** 2) / 10_000;
}

describe("vectorizeClasses", () => {
  it("traces outer rings counter-clockwise, holes clockwise, and keeps diagonal neighbours apart", () => {
    // 4×4: class 0 is a ring around a class-1 centre; two class-2 pixels touch diagonally.
    const g = new Int8Array([0, 0, 0, 2, 0, 1, 0, -1, 0, 0, 0, 2, 2, -1, 2, -1]);
    const polygons = vectorizeClasses(g, 4, 4, 3);
    expect(polygons.get(0)).toHaveLength(1);
    expect(polygons.get(0)![0]).toHaveLength(2); // outer ring + hole
    expect(polygons.get(1)).toHaveLength(1);
    expect(polygons.get(2)).toHaveLength(4);
  });
});

describe("computeYieldZonesFromRaster with a boundary", () => {
  // Pixels [5..55) in both axes of GRID: 500 m × 500 m, entirely inside the raster.
  const BOUNDARY = rect4326(540_050, 5_889_450, 540_550, 5_889_950);
  const boundaryAreaHa = sphericalAreaHa(BOUNDARY);

  /** Gradient with a fat interior hole and an unmeasured strip at the east edge. */
  function holeyGradient(): Float64Array {
    const data = gradient();
    for (let row = 20; row < 36; row++) {
      for (let col = 20; col < 36; col++) data[row * GRID.width + col] = NaN;
    }
    for (let row = 0; row < GRID.height; row++) {
      for (let col = 45; col < GRID.width; col++) data[row * GRID.width + col] = NaN;
    }
    return data;
  }

  /** Boundary area left uncovered by the zones' union, in ha. */

  it("tiles the boundary despite holes and unmeasured edges", () => {
    const zones = computeYieldZonesFromRaster(GRID, holeyGradient(), 3, { boundary: BOUNDARY });
    expect(zones).toHaveLength(3);
    expect(uncoveredHa(BOUNDARY, holeyGradient(), 3)).toBe(0);
    // The dilated mask makes the zones overshoot the outline by up to a pixel
    // (the PostGIS partition clips that), so the union must COVER the boundary
    // up to sub-pixel slivers, and the overshoot stays bounded.
    const total = zones.reduce((sum, zone) => sum + sphericalAreaHa(zone.geometry), 0);
    expect(total).toBeLessThan(boundaryAreaHa * 1.2);
  });

  it("keeps thresholds and means anchored to measured pixels only", () => {
    // Identical measured population (pre-clipped to the boundary extent) with
    // and without the fill: the grown copies shape the geometry but must not
    // move the zone statistics.
    const clipped = holeyGradient();
    for (let row = 0; row < GRID.height; row++) {
      for (let col = 0; col < GRID.width; col++) {
        if (row < 5 || row >= 55 || col < 5 || col >= 55) clipped[row * GRID.width + col] = NaN;
      }
    }
    const withFill = computeYieldZonesFromRaster(GRID, clipped, 3, { boundary: BOUNDARY });
    const measuredOnly = computeYieldZonesFromRaster(GRID, clipped, 3);
    for (const [i, zone] of withFill.entries()) {
      expect(Math.abs(zone.meanValue - measuredOnly[i].meanValue)).toBeLessThan(0.3);
    }
  });

  it("pads the grid when the boundary extends past the raster", () => {
    const wider = rect4326(540_010, 5_889_410, 540_590, 5_889_990);
    // The field grid always covers its boundary (with a margin), so here "wider" stays inside
    // GRID; the reference padded a grid fitted to the raster instead.
    expect(computeYieldZonesFromRaster(GRID, gradient(), 3, { boundary: wider })).toHaveLength(3);
    expect(uncoveredHa(wider, gradient(), 3)).toBeLessThan(sphericalAreaHa(wider) * 0.005);
  });

  it("refuses a boundary the raster barely overlaps", () => {
    const offField = rect4326(542_000, 5_887_000, 542_500, 5_887_500);
    expect(() => computeYieldZonesFromRaster(GRID, gradient(), 3, { boundary: offField })).toThrow(GridError);
  });

  it("changes nothing when no boundary is given", () => {
    const plain = computeYieldZonesFromRaster(GRID, gradient(), 4);
    const before = computeYieldZonesFromRaster(GRID, gradient(), 4, {});
    expect(plain).toEqual(before);
  });
});

describe("computeYieldZonesFromRaster with an exclude mask", () => {
  const BOUNDARY = rect4326(540_050, 5_889_450, 540_550, 5_889_950);

  /**
   * A gradient plus a depressed strip that is NOT a site effect: every fourth
   * column loses 3 t/ha, the way sprayer tramlines show up in a yield map.
   */
  function gradientWithTramlines(): Float64Array {
    const data = gradient();
    for (let row = 0; row < GRID.height; row++) {
      for (let col = 0; col < GRID.width; col += 4) data[row * GRID.width + col] -= 3;
    }
    return data;
  }

  function tramlineMask(): Uint8Array {
    const mask = new Uint8Array(GRID.width * GRID.height);
    for (let row = 0; row < GRID.height; row++) {
      for (let col = 0; col < GRID.width; col += 4) mask[row * GRID.width + col] = 1;
    }
    return mask;
  }

  it("keeps the machinery pixels out of the zone means", () => {
    const withMachinery = computeYieldZonesFromRaster(GRID, gradientWithTramlines(), 3, { boundary: BOUNDARY });
    const cleaned = computeYieldZonesFromRaster(GRID, gradientWithTramlines(), 3, {
      boundary: BOUNDARY,
      excludeMask: tramlineMask(),
    });

    // The depressed columns drag every zone mean down while they are counted.
    expect(withMachinery).toHaveLength(3);
    expect(cleaned).toHaveLength(3);
    for (let i = 0; i < 3; i++) {
      expect(cleaned[i].meanValue).toBeGreaterThan(withMachinery[i].meanValue);
    }
  });

  it("still tiles the field — excluded pixels are filled, not dropped", () => {
    const cleaned = computeYieldZonesFromRaster(GRID, gradientWithTramlines(), 3, {
      boundary: BOUNDARY,
      excludeMask: tramlineMask(),
    });
    // Same coverage requirement the boundary-fill tests use: no hole survives.
    expect(cleaned).toHaveLength(3);
    expect(uncoveredHa(BOUNDARY, gradientWithTramlines(), 3, { excludeMask: tramlineMask() })).toBeLessThan(0.05 * sphericalAreaHa(BOUNDARY));
  });

  it("recovers the underlying gradient: zone means rise monotonically", () => {
    const cleaned = computeYieldZonesFromRaster(GRID, gradientWithTramlines(), 4, {
      boundary: BOUNDARY,
      excludeMask: tramlineMask(),
    });
    for (let i = 1; i < cleaned.length; i++) {
      expect(cleaned[i].meanValue).toBeGreaterThan(cleaned[i - 1].meanValue);
    }
  });

  it("does not mutate the caller's raster", () => {
    const raster = gradientWithTramlines();
    const before = Float64Array.from(raster);
    computeYieldZonesFromRaster(GRID, raster, 3, { boundary: BOUNDARY, excludeMask: tramlineMask() });
    expect(Array.from(raster)).toEqual(Array.from(before));
  });

  it("changes nothing when the mask is empty", () => {
    const raster = gradientWithTramlines();
    const withEmpty = computeYieldZonesFromRaster(GRID, raster, 3, {
      boundary: BOUNDARY,
      excludeMask: new Uint8Array(GRID.width * GRID.height),
    });
    const without = computeYieldZonesFromRaster(GRID, raster, 3, { boundary: BOUNDARY });
    expect(withEmpty.map((z) => z.meanValue)).toEqual(without.map((z) => z.meanValue));
  });
});
