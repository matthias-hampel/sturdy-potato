import type { Polygon } from "geojson";
import { boundaryHashOf, computeRecipeHash, lagCorrectionApplies, mergeEvent, resolveTargetMoisture } from "./build.js";
import { decodeRaster, encodeRaster, fieldGrid, unprojector } from "./grid.js";
import { encodePng, rampColor, renderTile } from "./render.js";
import type { ParsedYieldPoints, YieldPoint } from "./types.js";

/** A 200 m × 200 m field near Göttingen. */
const FIELD: Polygon = {
  type: "Polygon",
  coordinates: [[[9.9, 51.5], [9.90288, 51.5], [9.90288, 51.5018], [9.9, 51.5018], [9.9, 51.5]]],
};

/** Serpentine passes 6 m apart, 1 Hz at ~1.5 m/s, yield rising west to east. */
function harvest(level: number, startMs: number, lonFrom = 9.9001, lonTo = 9.9028): YieldPoint[] {
  const points: YieldPoint[] = [];
  const passes = Math.round(((lonTo - lonFrom) * 69_400) / 6);
  let t = startMs;
  for (let p = 0; p < passes; p++) {
    const lon = lonFrom + (p * 6) / 69_400;
    for (let s = 0; s < 130; s++) {
      const lat = 51.5001 + ((p % 2 === 0 ? s : 129 - s) * 1.5) / 111_200;
      points.push({ lon, lat, value: level + (lon - 9.9) * 1000, t, width: 6, step: 1.5 });
      t += 1000;
    }
    t += 20_000;
  }
  return points;
}

const parsed = (points: YieldPoint[], format: ParsedYieldPoints["format"] = "isoxml"): ParsedYieldPoints => ({
  points,
  format,
  attribute: "test",
  totalFeatures: points.length,
  droppedFeatures: 0,
  basis: "wet",
  sources: { parsed: 1, skipped: 0 },
  quality: { meanRate: 8, plausible: true, window: [1.5, 120], cappedPoints: 0 },
});

describe("mergeEvent", () => {
  const grid = fieldGrid([FIELD]);

  it("builds one raster from two combines that split the field", () => {
    const west = harvest(7, Date.parse("2026-08-02T10:00:00Z"), 9.9001, 9.9014);
    const east = harvest(7, Date.parse("2026-08-02T10:00:00Z"), 9.9015, 9.9028);
    const result = mergeEvent({
      grid,
      boundary: FIELD,
      sources: [
        { sourceId: "a", provider: "upload", parsed: parsed(west) },
        { sourceId: "b", provider: "upload", parsed: parsed(east) },
      ],
      crop: "Winterweizen",
    })!;
    expect(result).not.toBeNull();
    expect(result.targetMoisture).toBe(14);
    expect(result.stats!.statistics.mean).toBeGreaterThan(7);
    expect(result.stats!.statistics.mean).toBeLessThan(10);
    expect(result.fieldCoverage).toBeGreaterThan(0.6);
    // Widths and steps are known, so the totals are measurements.
    expect(result.totalT).toBeGreaterThan(0);
    expect(result.harvestedHa).toBeGreaterThan(2);
    expect(result.sources.map((s) => s.duplicate)).toEqual([false, false]);
    expect(result.sources.every((s) => (s.coveredHa ?? 0) > 1)).toBe(true);
  });

  it("drops the same harvest delivered twice", () => {
    // Untimed copies: with a time base the overlap filter already empties the second one.
    const points = harvest(8, Date.parse("2026-08-02T10:00:00Z")).map(({ t: _t, ...p }) => p);
    const result = mergeEvent({
      grid,
      boundary: FIELD,
      sources: [
        { sourceId: "a", provider: "upload", parsed: parsed(points) },
        { sourceId: "b", provider: "upload", parsed: parsed(points.map((p) => ({ ...p }))) },
      ],
    })!;
    expect(result.sources.filter((s) => s.duplicate)).toHaveLength(1);
  });

  it("returns null when no point lands on the grid", () => {
    const far = harvest(8, Date.now()).map((p) => ({ ...p, lon: p.lon + 1 }));
    expect(mergeEvent({ grid, boundary: FIELD, sources: [{ sourceId: "a", provider: "upload", parsed: parsed(far) }] })).toBeNull();
  });
});

describe("recipe", () => {
  it("knows the reference moisture of a crop group", () => {
    expect(resolveTargetMoisture("Winterraps")).toBe(9);
    expect(resolveTargetMoisture("Silomais")).toBeNull();
    expect(resolveTargetMoisture("Wintergerste")).toBe(14);
  });

  it("does not shift sources their provider already positioned", () => {
    expect(lagCorrectionApplies("johndeere", "mass_per_area")).toBe(false);
    expect(lagCorrectionApplies("upload", "aft")).toBe(false);
    expect(lagCorrectionApplies("upload", "isoxml")).toBe(true);
  });

  it("hashes the recipe independent of source order", () => {
    const base = { crop: "x", resolution: 10, targetMoisture: 14, boundaryHash: boundaryHashOf(FIELD) };
    expect(computeRecipeHash({ ...base, sourceFingerprints: ["a:1", "b:2"] })).toBe(computeRecipeHash({ ...base, sourceFingerprints: ["b:2", "a:1"] }));
    expect(computeRecipeHash({ ...base, sourceFingerprints: ["a:1"] })).not.toBe(computeRecipeHash({ ...base, sourceFingerprints: ["a:2"] }));
  });
});

describe("raster storage and rendering", () => {
  it("round-trips rates through float32 bytes", () => {
    const data = Float64Array.from([1.25, NaN, 9.5]);
    const back = decodeRaster(encodeRaster(data));
    expect(back[0]).toBeCloseTo(1.25);
    expect(Number.isNaN(back[1])).toBe(true);
    expect(back[2]).toBeCloseTo(9.5);
  });

  it("encodes a PNG", () => {
    const png = encodePng(2, 1, new Uint8Array([255, 0, 0, 255, 0, 0, 0, 0]));
    expect(png.subarray(1, 4).toString("ascii")).toBe("PNG");
  });

  it("colours along the ramp", () => {
    expect(rampColor(["#000000", "#ffffff"], 0, 10, 5)).toEqual([128, 128, 128]);
    expect(rampColor(["#000000", "#ffffff"], 0, 10, 99)).toEqual([255, 255, 255]);
  });

  it("renders the tile under the raster and nothing elsewhere", () => {
    const grid = fieldGrid([FIELD]);
    const data = new Float64Array(grid.width * grid.height).fill(8);
    const [lon, lat] = unprojector(grid.epsg)(grid.originX + 50, grid.originY - 50);
    const z = 16;
    const x = Math.floor(((lon + 180) / 360) * 2 ** z);
    const y = Math.floor(((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * 2 ** z);
    expect(renderTile(grid, data, z, x, y, ["#ff0000", "#00ff00"], [0, 10])).not.toBeNull();
    expect(renderTile(grid, data, z, x + 20, y, ["#ff0000", "#00ff00"], [0, 10])).toBeNull();
  });
});
