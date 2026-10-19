import { buildYieldPointsGeojsonZip } from "./pointdata.js";
import { parseYieldPoints } from "./parse.js";

const T0 = Date.parse("2026-07-20T11:00:00Z");
const POINTS = [
  { lon: 9.1, lat: 51.2, value: 8.4, moisture: 14.2, t: T0, width: 9.0, speed: 6.2 },
  { lon: 9.1001, lat: 51.2001, value: 7.9, moisture: 13.8, t: T0 + 1000, width: 9.0, speed: 6.1 },
  { lon: 9.1002, lat: 51.2002, value: 8.8 },
];

describe("point-data yield artefact", () => {
  it("round-trips points through the zip artefact and the shared parser", async () => {
    const zip = await buildYieldPointsGeojsonZip(POINTS, {
      attribute: "CLAAS Point Data (Lexion)",
      basis: "wet",
      provenance: { claasActivityId: "a-1", equipmentId: "e-1", equipmentName: "Lexion" },
    });

    const parsed = await parseYieldPoints(zip);

    expect(parsed.format).toBe("pointdata");
    expect(parsed.attribute).toBe("CLAAS Point Data (Lexion)");
    expect(parsed.basis).toBe("wet");
    expect(parsed.totalFeatures).toBe(3);
    expect(parsed.points).toHaveLength(3);
    expect(parsed.points[0].value).toBeCloseTo(8.4);
    expect(parsed.points[0].moisture).toBeCloseTo(14.2);
    expect(parsed.points[2].moisture).toBeUndefined();
    expect(parsed.moisture?.pointsWithMoisture).toBe(2);
  });

  it("carries the harvest timeline and footprint through the artefact", async () => {
    // Without `t` the track filters (lag, pass trim, overlap) skip themselves —
    // the artefact must not silently lose the sequence the API delivered.
    const zip = await buildYieldPointsGeojsonZip(POINTS, { attribute: "x", basis: "wet", provenance: {} });
    const parsed = await parseYieldPoints(zip);
    expect(parsed.points[0].t).toBe(T0);
    expect(parsed.points[1].t).toBe(T0 + 1000);
    expect(parsed.points[0].width).toBeCloseTo(9.0);
    expect(parsed.points[0].speed).toBeCloseTo(6.2);
    expect(parsed.points[2].t).toBeUndefined();
  });

  it("keeps the dry basis of the source through the artefact", async () => {
    const zip = await buildYieldPointsGeojsonZip(POINTS, {
      attribute: "CLAAS Point Data (Jaguar)",
      basis: "dry",
      provenance: {},
    });

    const parsed = await parseYieldPoints(zip);
    expect(parsed.basis).toBe("dry");
  });

  it("rejects an artefact without positive yield values", async () => {
    const zip = await buildYieldPointsGeojsonZip([{ lon: 9.1, lat: 51.2, value: 0 }], {
      attribute: "x",
      basis: "wet",
      provenance: {},
    });

    await expect(parseYieldPoints(zip)).rejects.toThrow(/no positive yield points/);
  });
});
