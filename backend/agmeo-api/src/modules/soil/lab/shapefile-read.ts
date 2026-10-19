/**
 * Reads polygon shapefiles (.shp + .dbf) as lab deliveries carry them: the Probenkarte a lab
 * returns with its values filled in. Rings are grouped into polygons by orientation (outer rings
 * clockwise, holes counter-clockwise); coordinates are taken as WGS 84 (the TGIS layout).
 */
import type { MultiPolygon, Position } from 'geojson';

export interface ShapeFeature {
  geometry: MultiPolygon | null;
  properties: Record<string, string | number | null>;
}

function signedArea(ring: Position[]): number {
  let s = 0;
  for (let i = 0; i < ring.length - 1; i++) s += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  return s / 2;
}

function inside(p: Position, ring: Position[]): boolean {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

function readShp(buf: Buffer): (MultiPolygon | null)[] {
  const out: (MultiPolygon | null)[] = [];
  let at = 100;
  while (at + 8 <= buf.length) {
    const length = buf.readInt32BE(at + 4) * 2;
    const body = buf.subarray(at + 8, at + 8 + length);
    at += 8 + length;
    const type = body.length >= 4 ? body.readInt32LE(0) : 0;
    if (type !== 5 && type !== 15 && type !== 25) {
      out.push(null);
      continue;
    }
    const numParts = body.readInt32LE(36);
    const numPoints = body.readInt32LE(40);
    const starts = Array.from({ length: numParts }, (_, i) => body.readInt32LE(44 + i * 4));
    const pointsAt = 44 + numParts * 4;
    const rings: Position[][] = starts.map((start, i) => {
      const end = i + 1 < numParts ? starts[i + 1] : numPoints;
      return Array.from({ length: end - start }, (_, k) => [body.readDoubleLE(pointsAt + (start + k) * 16), body.readDoubleLE(pointsAt + (start + k) * 16 + 8)]);
    });
    const outers = rings.filter((r) => signedArea(r) <= 0).map((r) => [r]);
    for (const hole of rings.filter((r) => signedArea(r) > 0)) {
      const owner = outers.find((poly) => inside(hole[0], poly[0]));
      if (owner) owner.push(hole);
      else outers.push([[...hole].reverse()]);
    }
    // GeoJSON order: outer rings counter-clockwise, holes clockwise.
    out.push({ type: 'MultiPolygon', coordinates: outers.map(([outer, ...holes]) => [[...outer].reverse(), ...holes.map((h) => [...h].reverse())]) });
  }
  return out;
}

function decode(bytes: Buffer): string {
  const utf8 = bytes.toString('utf8');
  return utf8.includes('�') ? bytes.toString('latin1') : utf8;
}

function readDbf(buf: Buffer): Record<string, string | number | null>[] {
  const count = buf.readUInt32LE(4);
  const headerSize = buf.readUInt16LE(8);
  const recordSize = buf.readUInt16LE(10);
  const fields: { name: string; type: string; length: number }[] = [];
  for (let off = 32; off < headerSize - 1 && buf[off] !== 0x0d; off += 32) {
    fields.push({ name: buf.subarray(off, off + 11).toString('latin1').replace(/\0.*$/, '').trim(), type: String.fromCharCode(buf[off + 11]), length: buf[off + 16] });
  }
  const rows: Record<string, string | number | null>[] = [];
  for (let r = 0; r < count; r++) {
    let off = headerSize + r * recordSize + 1;
    const row: Record<string, string | number | null> = {};
    for (const f of fields) {
      const raw = decode(buf.subarray(off, off + f.length)).replaceAll('\u0000', '').trim();
      off += f.length;
      if (f.type === 'N' || f.type === 'F') row[f.name] = raw === '' || /^\*+$/.test(raw) ? null : Number(raw);
      else row[f.name] = raw === '' ? null : raw;
    }
    rows.push(row);
  }
  return rows;
}

export function readShapefile(shp: Buffer, dbf: Buffer): ShapeFeature[] {
  const geometries = readShp(shp);
  const records = readDbf(dbf);
  return geometries.map((geometry, i) => ({ geometry, properties: records[i] ?? {} }));
}
