import { buildZip } from "./zip.js";
import { parseYieldPoints } from "./parse.js";
import { readPointShapefile } from "./shapefile.js";

/** Point shapefile with numeric and text columns. */
export function buildShapefile(points: { x: number; y: number; props: Record<string, number | string> }[]): { shp: Buffer; dbf: Buffer } {
  const RECORD = 28;
  const shp = Buffer.alloc(100 + points.length * RECORD);
  shp.writeInt32BE(9994, 0);
  shp.writeInt32BE((100 + points.length * RECORD) / 2, 24);
  shp.writeInt32LE(1000, 28);
  shp.writeInt32LE(1, 32);
  points.forEach((p, i) => {
    const o = 100 + i * RECORD;
    shp.writeInt32BE(i + 1, o);
    shp.writeInt32BE(10, o + 4);
    shp.writeInt32LE(1, o + 8);
    shp.writeDoubleLE(p.x, o + 12);
    shp.writeDoubleLE(p.y, o + 20);
  });
  const names = Object.keys(points[0].props);
  const fields = names.map((name) => ({ name, numeric: typeof points[0].props[name] === "number", length: typeof points[0].props[name] === "number" ? 20 : 30 }));
  const headerBytes = 32 + 32 * fields.length + 1;
  const recordBytes = 1 + fields.reduce((s, f) => s + f.length, 0);
  const dbf = Buffer.alloc(headerBytes + points.length * recordBytes + 1);
  dbf.writeUInt8(0x03, 0);
  dbf.writeUInt32LE(points.length, 4);
  dbf.writeUInt16LE(headerBytes, 8);
  dbf.writeUInt16LE(recordBytes, 10);
  fields.forEach((f, i) => {
    const o = 32 + i * 32;
    dbf.write(f.name.padEnd(11, "\0"), o, "latin1");
    dbf.write(f.numeric ? "N" : "C", o + 11, "latin1");
    dbf.writeUInt8(f.length, o + 16);
    dbf.writeUInt8(f.numeric ? 3 : 0, o + 17);
  });
  dbf.writeUInt8(0x0d, headerBytes - 1);
  points.forEach((p, r) => {
    let o = headerBytes + r * recordBytes;
    dbf.write(" ", o++, "latin1");
    for (const f of fields) {
      const v = p.props[f.name];
      dbf.write((typeof v === "number" ? v.toFixed(3).padStart(f.length) : String(v).padEnd(f.length)).slice(0, f.length), o, "latin1");
      o += f.length;
    }
  });
  dbf.writeUInt8(0x1a, dbf.length - 1);
  return { shp, dbf };
}

describe("point shapefile reader", () => {
  it("reads coordinates and typed attributes", () => {
    const { shp, dbf } = buildShapefile([
      { x: 9.5, y: 52.5, props: { VRYIELDMAS: 8.5, IsoTime: "2026-08-02T10:00:00Z" } },
      { x: 9.6, y: 52.6, props: { VRYIELDMAS: 9.25, IsoTime: "2026-08-02T10:00:01Z" } },
    ]);
    const records = [...readPointShapefile(shp, dbf)];
    expect(records).toHaveLength(2);
    expect(records[1]).toEqual({ x: 9.6, y: 52.6, properties: { VRYIELDMAS: 9.25, IsoTime: "2026-08-02T10:00:01Z" } });
  });

  it("parses a John-Deere-style mass-per-area export with times and swath widths", async () => {
    const points = Array.from({ length: 400 }, (_, i) => ({
      x: 9.5 + (i % 20) * 0.0002,
      y: 52.5 + Math.floor(i / 20) * 0.0002,
      props: { VRYIELDMAS: 8 + (i % 7) * 0.1, SWATHWIDTH: 9, DISTANCE: 1.5, Moisture: 15, IsoTime: new Date(Date.UTC(2026, 7, 2, 10) + i * 1000).toISOString() },
    }));
    const { shp, dbf } = buildShapefile(points);
    const parsed = await parseYieldPoints(buildZip({ "Ernte/yield.shp": shp, "Ernte/yield.dbf": dbf }), "Winterweizen");
    expect(parsed.format).toBe("mass_per_area");
    expect(parsed.attribute).toBe("VRYIELDMAS");
    expect(parsed.crs).toBe("EPSG:4326 (assumed4326)");
    expect(parsed.points[0].width).toBe(9);
    expect(parsed.points[0].step).toBe(1.5);
    expect(parsed.moisture?.mean).toBe(15);
    expect(parsed.timeRange?.[0]).toBeGreaterThanOrEqual(Date.UTC(2026, 7, 2, 10));
    expect(parsed.quality.plausible).toBe(true);
  });
});
