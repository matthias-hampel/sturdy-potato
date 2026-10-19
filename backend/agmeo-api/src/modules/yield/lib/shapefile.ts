import { GridError } from './grid.js';

/**
 * Point shapefiles (.shp + .dbf), the only shapefile kind a yield monitor writes.
 *
 * The reference app streams records through the `shapefile` package; agmeo reads the two
 * members itself. Point, PointZ and PointM records are read; multipoints contribute their
 * first point; every other shape type is skipped (a yield export has none).
 */

export type ShapeRecord = { x: number; y: number; properties: Record<string, string | number | null> };

type DbfField = { name: string; type: string; length: number; decimals: number };

/** .dbf text encoding from the .cpg sidecar; windows-1252 is what the exporters we see write. */
export function dbfEncoding(cpg: string | null): string {
  if (!cpg) return 'windows-1252';
  const normalized = cpg.trim();
  if (/^\d+$/.test(normalized)) return normalized === '65001' ? 'utf-8' : `windows-${normalized}`;
  return normalized;
}

function decoder(encoding: string): TextDecoder {
  try {
    return new TextDecoder(encoding);
  } catch {
    return new TextDecoder('windows-1252');
  }
}

export function readDbfHeader(dbf: Buffer, encoding = 'windows-1252'): { fields: DbfField[]; records: number; headerBytes: number; recordBytes: number } {
  if (dbf.length < 32) throw new GridError('The .dbf file is truncated', 400);
  const records = dbf.readUInt32LE(4);
  const headerBytes = dbf.readUInt16LE(8);
  const recordBytes = dbf.readUInt16LE(10);
  const text = decoder(encoding);
  const fields: DbfField[] = [];
  for (let offset = 32; offset + 32 <= headerBytes && dbf[offset] !== 0x0d; offset += 32) {
    const rawName = dbf.subarray(offset, offset + 11);
    const end = rawName.indexOf(0);
    fields.push({
      name: text.decode(end >= 0 ? rawName.subarray(0, end) : rawName).trim(),
      type: String.fromCharCode(dbf[offset + 11]),
      length: dbf[offset + 16],
      decimals: dbf[offset + 17],
    });
  }
  return { fields, records, headerBytes, recordBytes };
}

/** Records of a point shapefile with their attributes, in file order. */
export function* readPointShapefile(shp: Buffer, dbf: Buffer, encoding = 'windows-1252'): Generator<ShapeRecord> {
  if (shp.length < 100 || shp.readInt32BE(0) !== 9994) throw new GridError('Not a shapefile (.shp header missing)', 400);
  const { fields, records, headerBytes, recordBytes } = readDbfHeader(dbf, encoding);
  const text = decoder(encoding);
  const fileBytes = Math.min(shp.length, shp.readInt32BE(24) * 2);
  let offset = 100;
  for (let index = 0; index < records && offset + 8 <= fileBytes; index++) {
    const contentBytes = shp.readInt32BE(offset + 4) * 2;
    const content = offset + 8;
    offset = content + contentBytes;
    if (content + 4 > shp.length) break;
    const type = shp.readInt32LE(content);
    let x: number | null = null;
    let y: number | null = null;
    if ((type === 1 || type === 11 || type === 21) && content + 20 <= shp.length) {
      x = shp.readDoubleLE(content + 4);
      y = shp.readDoubleLE(content + 12);
    } else if ((type === 8 || type === 18 || type === 28) && content + 48 <= shp.length && shp.readInt32LE(content + 36) > 0) {
      x = shp.readDoubleLE(content + 40);
      y = shp.readDoubleLE(content + 48);
    }
    const start = headerBytes + index * recordBytes;
    if (x === null || y === null || start + recordBytes > dbf.length || dbf[start] === 0x2a) continue;
    const properties: ShapeRecord['properties'] = {};
    let cursor = start + 1;
    for (const field of fields) {
      const raw = text.decode(dbf.subarray(cursor, cursor + field.length)).trim();
      cursor += field.length;
      if (field.type === 'N' || field.type === 'F') {
        const value = raw === '' || /^\*+$/.test(raw) ? null : Number(raw);
        properties[field.name] = value !== null && Number.isFinite(value) ? value : null;
      } else if (field.type === 'D') {
        properties[field.name] = /^\d{8}$/.test(raw) ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}` : null;
      } else if (field.type === 'L') {
        properties[field.name] = /^[YyTt]$/.test(raw) ? 1 : /^[NnFf]$/.test(raw) ? 0 : null;
      } else {
        properties[field.name] = raw === '' ? null : raw;
      }
    }
    yield { x, y, properties };
  }
}
