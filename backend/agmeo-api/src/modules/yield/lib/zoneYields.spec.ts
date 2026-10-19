import type { Polygon as GeoJsonPolygon } from "geojson";

import type { YieldPoint } from "./parse.js";
import { computeZoneYields, zoneYieldTransfer } from "./zoneYields.js";

/** Three 0.01°-wide stripes side by side — west, middle, east. */
const stripe = (id: string, lonFrom: number, lonTo: number): { id: string; geometry: GeoJsonPolygon } => ({
  id,
  geometry: {
    type: "Polygon",
    coordinates: [
      [
        [lonFrom, 51.0],
        [lonTo, 51.0],
        [lonTo, 51.01],
        [lonFrom, 51.01],
        [lonFrom, 51.0],
      ],
    ],
  },
});

const ZONES = [stripe("west", 9.0, 9.01), stripe("mid", 9.01, 9.02), stripe("east", 9.02, 9.03)];

/**
 * 40 points per stripe, constant value, spaced ~28 m apart so each lands in its
 * own 10 m pixel — above the 30-pixel floor. The floor counts pixels, not
 * points, because the means are zonal statistics over the rasterized map
 * (docs/claude/geodata-model.md).
 */
const pointsFor = (lonFrom: number, value: number): YieldPoint[] =>
  Array.from({ length: 40 }, (_, i) => ({
    lon: lonFrom + 0.0001 + (i % 20) * 0.0004,
    lat: 51.002 + Math.floor(i / 20) * 0.002,
    value,
  }));

describe("computeZoneYields", () => {
  it("derives per-zone means and relative yields against the field mean", () => {
    const points = [...pointsFor(9.0, 6), ...pointsFor(9.01, 9), ...pointsFor(9.02, 12)];

    const result = computeZoneYields(points, ZONES);

    expect(result.fieldMeanTpHa).toBeCloseTo(9);
    expect(result.unassignedPixels).toBe(0);
    const byId = Object.fromEntries(result.zones.map((z) => [z.zoneId, z]));
    expect(byId.west.yieldInTpHa).toBeCloseTo(6);
    expect(byId.west.relativeYield).toBeCloseTo(6 / 9);
    expect(byId.mid.relativeYield).toBeCloseTo(1);
    expect(byId.east.yieldInTpHa).toBeCloseTo(12);
    expect(byId.east.pixels).toBe(40);
  });

  it("reports null instead of a fabricated mean when too little of a zone was measured", () => {
    const points = [...pointsFor(9.0, 6), ...pointsFor(9.01, 9), { lon: 9.025, lat: 51.005, value: 12 }];

    const result = computeZoneYields(points, ZONES);

    const east = result.zones.find((z) => z.zoneId === "east")!;
    expect(east.pixels).toBe(1);
    expect(east.yieldInTpHa).toBeNull();
    expect(east.relativeYield).toBeNull();
  });

  it("counts measured ground outside every zone as unassigned", () => {
    // ~35 m north of the stripes: inside the 50 m pad, outside every zone —
    // the headland-drift case the count exists for.
    const points = [...pointsFor(9.0, 6), { lon: 9.005, lat: 51.0102, value: 8 }];

    const result = computeZoneYields(points, ZONES);

    expect(result.unassignedPixels).toBe(1);
    expect(result.fieldMeanTpHa).toBeCloseTo(6);
  });

  it("drops a stray log far outside the zonation rather than calling it unassigned", () => {
    // Half a degree away — the monitor still logging on the road to the next
    // field. It falls off the grid entirely and is evidence about nothing here.
    const points = [...pointsFor(9.0, 6), { lon: 9.5, lat: 51.005, value: 8 }];

    const result = computeZoneYields(points, ZONES);

    expect(result.unassignedPixels).toBe(0);
    expect(result.fieldMeanTpHa).toBeCloseTo(6);
  });
});

describe("zoneYieldTransfer — the yield context invariant", () => {
  const wheat = { crop: "winterWheat", year: 2025, soilTypeLUFA: "L", management: "t1" };

  it("allows the absolute number only within the same crop", () => {
    expect(zoneYieldTransfer(wheat, { ...wheat, year: 2026 })).toBe("absolute");
    expect(zoneYieldTransfer(wheat, { ...wheat, varietyId: "other" })).toBe("absolute");
  });

  it("degrades a different crop on the same soil to the spatial pattern only", () => {
    // A wheat map must never set a rape expectation in t/ha.
    expect(zoneYieldTransfer(wheat, { ...wheat, crop: "winterRape", year: 2026 })).toBe("relative-only");
  });

  it("rejects the transfer entirely across crop AND soil", () => {
    expect(zoneYieldTransfer(wheat, { crop: "winterRape", year: 2026, soilTypeLUFA: "S" })).toBe("none");
  });

  it("keeps the pattern transferable when a soil type is unknown", () => {
    expect(zoneYieldTransfer({ crop: "winterWheat", year: 2025 }, { crop: "winterRape", year: 2026 })).toBe(
      "relative-only",
    );
  });
});
