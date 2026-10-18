import type { MultiPolygon, Position } from 'geojson';

/** ESRI WKT of WGS 84, as terminals expect it in the .prj file. */
export const WGS84_PRJ =
  'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]';

export interface DbfField {
  /** At most 10 characters. */
  name: string;
  length: number;
  decimals: number;
  /** N numeric (default), C text (written as ISO-8859-1, cut to the length). */
  type?: 'N' | 'C';
}

export interface ShapeRecord {
  geometry: MultiPolygon;
  /** Attribute values by field name. */
  values: Record<string, number | string | null>;
}

const SHAPE_POLYGON = 5;

/** Twice the signed area: positive for counter-clockwise rings (x east, y north). */
function signedArea(ring: Position[]): number {
  let s = 0;
  for (let i = 0; i < ring.length - 1; i++) s += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  return s;
}

function closed(ring: Position[]): Position[] {
  const [a, b] = [ring[0], ring[ring.length - 1]];
  return a[0] === b[0] && a[1] === b[1] ? ring : [...ring, a];
}

/** Shapefile rings: outer rings clockwise, holes counter-clockwise (the reverse of GeoJSON). */
function parts(geometry: MultiPolygon): Position[][] {
  const out: Position[][] = [];
  for (const polygon of geometry.coordinates) {
    polygon.forEach((raw, i) => {
      const ring = closed(raw);
      const ccw = signedArea(ring) > 0;
      out.push((i === 0) === ccw ? [...ring].reverse() : ring);
    });
  }
  return out;
}

function header(fileWords: number, box: number[]): Buffer {
  const b = Buffer.alloc(100);
  b.writeInt32BE(9994, 0);
  b.writeInt32BE(fileWords, 24);
  b.writeInt32LE(1000, 28);
  b.writeInt32LE(SHAPE_POLYGON, 32);
  box.forEach((v, i) => b.writeDoubleLE(v, 36 + i * 8));
  return b;
}

function bbox(rings: Position[][]): number[] {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const ring of rings)
    for (const [x, y] of ring) {
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  return [x0, y0, x1, y1];
}

function dbf(fields: DbfField[], records: ShapeRecord[], date: Date): Buffer {
  const recordLength = 1 + fields.reduce((s, f) => s + f.length, 0);
  const headerLength = 32 + 32 * fields.length + 1;
  const b = Buffer.alloc(headerLength + recordLength * records.length + 1, 0x20);
  b.fill(0, 0, headerLength);
  b.writeUInt8(0x03, 0);
  b.writeUInt8(date.getFullYear() - 1900, 1);
  b.writeUInt8(date.getMonth() + 1, 2);
  b.writeUInt8(date.getDate(), 3);
  b.writeUInt32LE(records.length, 4);
  b.writeUInt16LE(headerLength, 8);
  b.writeUInt16LE(recordLength, 10);
  fields.forEach((f, i) => {
    const at = 32 + i * 32;
    b.write(f.name.slice(0, 10), at, 'ascii');
    b.write(f.type ?? 'N', at + 11, 'ascii');
    b.writeUInt8(f.length, at + 16);
    b.writeUInt8(f.decimals, at + 17);
  });
  b.writeUInt8(0x0d, headerLength - 1);
  records.forEach((r, i) => {
    let at = headerLength + i * recordLength + 1; // deletion flag stays ' '
    for (const f of fields) {
      const v = r.values[f.name];
      if (f.type === 'C') {
        const text = Buffer.from(String(v ?? ''), 'latin1').subarray(0, f.length);
        text.copy(b, at);
      } else {
        const text = typeof v !== 'number' || !Number.isFinite(v) ? '' : v.toFixed(f.decimals);
        if (text.length > f.length) throw new Error(`Value ${text} does not fit DBF field ${f.name}`);
        b.write(text.padStart(f.length, ' '), at, 'ascii');
      }
      at += f.length;
    }
  });
  b.writeUInt8(0x1a, b.length - 1);
  return b;
}

/**
 * Polygon Shapefile (.shp, .shx, .dbf, .prj, .cpg). Coordinates are written as given; `prj` names
 * their reference system (WGS 84 by default).
 */
export function polygonShapefile(fields: DbfField[], records: ShapeRecord[], date = new Date(), prj = WGS84_PRJ) {
  const shapes = records.map((r) => {
    const rings = parts(r.geometry);
    const points = rings.reduce((s, ring) => s + ring.length, 0);
    const content = Buffer.alloc(44 + 4 * rings.length + 16 * points);
    const box = bbox(rings);
    content.writeInt32LE(SHAPE_POLYGON, 0);
    box.forEach((v, i) => content.writeDoubleLE(v, 4 + i * 8));
    content.writeInt32LE(rings.length, 36);
    content.writeInt32LE(points, 40);
    let index = 0;
    rings.forEach((ring, i) => {
      content.writeInt32LE(index, 44 + 4 * i);
      index += ring.length;
    });
    let at = 44 + 4 * rings.length;
    for (const ring of rings)
      for (const [x, y] of ring) {
        content.writeDoubleLE(x, at);
        content.writeDoubleLE(y, at + 8);
        at += 16;
      }
    return { content, box };
  });
  const all = shapes.map((s) => s.box);
  const box = all.length
    ? [Math.min(...all.map((b) => b[0])), Math.min(...all.map((b) => b[1])), Math.max(...all.map((b) => b[2])), Math.max(...all.map((b) => b[3]))]
    : [0, 0, 0, 0];
  const fullBox = [...box, 0, 0, 0, 0];

  const shpLength = 100 + shapes.reduce((s, x) => s + 8 + x.content.length, 0);
  const shp = [header(shpLength / 2, fullBox)];
  const shx = [header((100 + 8 * shapes.length) / 2, fullBox)];
  let offset = 100;
  shapes.forEach((s, i) => {
    const rec = Buffer.alloc(8);
    rec.writeInt32BE(i + 1, 0);
    rec.writeInt32BE(s.content.length / 2, 4);
    shp.push(rec, s.content);
    const idx = Buffer.alloc(8);
    idx.writeInt32BE(offset / 2, 0);
    idx.writeInt32BE(s.content.length / 2, 4);
    shx.push(idx);
    offset += 8 + s.content.length;
  });
  return {
    shp: Buffer.concat(shp),
    shx: Buffer.concat(shx),
    dbf: dbf(fields, records, date),
    prj: Buffer.from(prj, 'ascii'),
    cpg: Buffer.from('ISO-8859-1', 'ascii'),
  };
}
