/**
 * Shapefiles for German soil labs (LUFA / FSO, TGIS layout), ported from AGVOLUTION/agmeo
 * lib/soil/tgisShapefile.ts, sampleCard.ts and contourExport.ts. The PROBEKARTE has one row per
 * sampling zone with the analysis columns left for the lab; the CONTOUR has one row per field
 * (Schlag) whose Schlagnummer is the lab's join key.
 */
import type { MultiPolygon, Polygon, Position } from 'geojson';

export interface TgisField {
  name: string;
  type: 'C' | 'N';
  length: number;
  decimals: number;
}

export interface TgisRow {
  record: Record<string, string | null>;
  geometry: Polygon | MultiPolygon;
}

export const MACHINE_TEXT_LIMIT = 15;

export const TGIS_PRJ =
  'GEOGCS["MYCUSTOM_TGIS_CSGeographicCoordinateSystem_GeoSYS_7006950_8901",DATUM["MYCUSTOM_TGIS_CSDatum_WGS84",SPHEROID["WGS_1984",6378137,298.257223563],TOWGS84[0,0,0,0,0,0,0]],PRIMEM["Greenwich",0],UNIT["Degree",0.0174532925199433]]\r\n';

const C = (name: string, length: number): TgisField => ({ name, type: 'C', length, decimals: 0 });
const N = (name: string, length: number, decimals: number): TgisField => ({ name, type: 'N', length, decimals });

export const SAMPLE_CARD_FIELDS: TgisField[] = [
  C('ID', 5), C('SCHLAGNUMM', 30), C('SCHLAGNAME', 30), C('KUNDE', 10), C('NUTZART', 10), C('PROBEDATUM', 20), C('PROBENUMME', 30),
  N('FEIN', 10, 8), N('HUMUS', 10, 8), C('BODENART', 10), C('LABORPRNR', 30), N('HUMUS_NGES', 10, 8), N('HUMUS_CN', 10, 8), N('FLAECHE_HA', 10, 8),
  C('ANALYSEINF', 100),
  ...['P', 'K', 'MG', 'PH', 'B', 'CU', 'MN', 'MO', 'ZN', 'S', 'NA'].flatMap((el) => [
    N(`${el}_WERT`, 10, 8),
    C(`${el}_VS`, 10),
    N(`${el}_EMPFEHL${el.length === 1 ? 'U' : ''}`.slice(0, 10), 10, 8),
  ]),
];

export const CONTOUR_FIELDS: TgisField[] = [
  C('ID', 5), N('NUMMER', 10, 0), N('TEILNUM', 10, 0), C('NAME', 20), N('FLAECHE', 10, 8), N('ERNTEJAHR', 10, 0), C('MANDANTNAM', 50), C('MANDANTENK', 15),
  C('BETRIEBSNU', 20), C('FRUCHTART', 4), C('NUTZART', 2), N('BWZ', 10, 8), N('PACHT', 10, 2), C('ERZEUGERRE', 50), C('FELDBLOCK', 20), C('FBBEZEICHN', 20),
  N('FBFLAECHE', 10, 8), N('INTERNE_NU', 10, 0), N('SCHLAGNR_A', 10, 0), C('V1_FRUCHT', 4), C('V2_FRUCHT', 4), C('V3_FRUCHT', 4),
];

export function formatNumeric(value: number, length: number, decimals: number): string {
  let text = value.toFixed(decimals);
  if (text.length > length) text = value.toFixed(Math.max(0, length - text.indexOf('.') - 1));
  return text.slice(0, length);
}

export function formatNullableNumeric(value: number | null, length: number, decimals: number): string {
  if (value == null || !Number.isFinite(value)) return '*'.repeat(length);
  const text = decimals > 0 ? formatNumeric(value, length, decimals) : String(Math.trunc(value)).slice(0, length);
  return text.padStart(length);
}

export function parseParcelNumber(value: string | null | undefined): { nummer: number; teilnum: number | null } | null {
  if (!value) return null;
  const match = /^\s*(\d+)(?:\s*[-/.]\s*(\d+))?\s*$/.exec(value);
  if (!match) return null;
  return { nummer: Number(match[1]), teilnum: match[2] != null ? Number(match[2]) : null };
}

/** "Schlagnummer" as the lab expects it: "<number>-<part>", from the field's parcel number or identifier. */
export function parcelNumber(parcel: string | null | undefined): string {
  const parsed = parseParcelNumber(parcel);
  if (parsed) return `${parsed.nummer}-${parsed.teilnum ?? 0}`;
  return parcel ?? '';
}

const latin1 = (text: string) => Buffer.from(text.replace(/[^\u0000-ÿ]/g, '?'), 'latin1');

function writeDbf(rows: TgisRow[], fields: TgisField[]): Buffer {
  const headerSize = 32 + fields.length * 32 + 1;
  const recordSize = 1 + fields.reduce((sum, f) => sum + f.length, 0);
  const buffer = Buffer.alloc(headerSize + rows.length * recordSize);
  buffer[0] = 0x03;
  buffer[1] = 95;
  buffer[2] = 7;
  buffer[3] = 26;
  buffer.writeUInt32LE(rows.length, 4);
  buffer.writeUInt16LE(headerSize, 8);
  buffer.writeUInt16LE(recordSize, 10);
  fields.forEach((field, i) => {
    const off = 32 + i * 32;
    latin1(field.name).copy(buffer, off);
    buffer[off + 11] = field.type.charCodeAt(0);
    buffer[off + 16] = field.length;
    buffer[off + 17] = field.decimals;
  });
  buffer[32 + fields.length * 32] = 0x0d;
  rows.forEach((row, r) => {
    let off = headerSize + r * recordSize;
    buffer[off] = 0x20;
    off += 1;
    for (const field of fields) {
      const value = row.record[field.name];
      if (value != null) {
        const encoded = latin1(value.slice(0, field.length));
        encoded.copy(buffer, off);
        buffer.fill(0x20, off + encoded.length, off + field.length);
      }
      off += field.length;
    }
  });
  return buffer;
}

function signedArea(ring: Position[]): number {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) sum += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  return sum / 2;
}

/** Outer rings clockwise, holes counter-clockwise. */
function shapefileRings(geometry: Polygon | MultiPolygon): Position[][] {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  const rings: Position[][] = [];
  for (const polygon of polygons) {
    polygon.forEach((ring, i) => {
      const clockwise = signedArea(ring) < 0;
      rings.push((i === 0) === clockwise ? ring : [...ring].reverse());
    });
  }
  return rings;
}

function writeShpAndShx(geometries: (Polygon | MultiPolygon)[]): { shp: Buffer; shx: Buffer } {
  const bodies = geometries.map((geometry) => {
    const rings = shapefileRings(geometry);
    const pointCount = rings.reduce((sum, ring) => sum + ring.length, 0);
    const body = Buffer.alloc(44 + rings.length * 4 + pointCount * 16);
    body.writeInt32LE(5, 0);
    let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const ring of rings)
      for (const [x, y] of ring) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    [minX, minY, maxX, maxY].forEach((v, i) => body.writeDoubleLE(v, 4 + i * 8));
    body.writeInt32LE(rings.length, 36);
    body.writeInt32LE(pointCount, 40);
    let partStart = 0;
    rings.forEach((ring, i) => {
      body.writeInt32LE(partStart, 44 + i * 4);
      partStart += ring.length;
    });
    let at = 44 + rings.length * 4;
    for (const ring of rings)
      for (const [x, y] of ring) {
        body.writeDoubleLE(x, at);
        body.writeDoubleLE(y, at + 8);
        at += 16;
      }
    return { body, bbox: [minX, minY, maxX, maxY] };
  });
  const shpSize = 100 + bodies.reduce((sum, r) => sum + 8 + r.body.length, 0);
  const shp = Buffer.alloc(shpSize);
  const shx = Buffer.alloc(100 + bodies.length * 8);
  const bbox = bodies.length
    ? bodies.reduce((acc, r) => [Math.min(acc[0], r.bbox[0]), Math.min(acc[1], r.bbox[1]), Math.max(acc[2], r.bbox[2]), Math.max(acc[3], r.bbox[3])], [Infinity, Infinity, -Infinity, -Infinity])
    : [0, 0, 0, 0];
  for (const [buf, size] of [
    [shp, shpSize],
    [shx, shx.length],
  ] as const) {
    buf.writeInt32BE(9994, 0);
    buf.writeInt32BE(size / 2, 24);
    buf.writeInt32LE(1000, 28);
    buf.writeInt32LE(5, 32);
    bbox.forEach((v, i) => buf.writeDoubleLE(v, 36 + i * 8));
  }
  let off = 100;
  bodies.forEach((record, i) => {
    shx.writeInt32BE(off / 2, 100 + i * 8);
    shx.writeInt32BE(record.body.length / 2, 104 + i * 8);
    shp.writeInt32BE(i + 1, off);
    shp.writeInt32BE(record.body.length / 2, off + 4);
    record.body.copy(shp, off + 8);
    off += 8 + record.body.length;
  });
  return { shp, shx };
}

/** .shp, .shx, .dbf and .prj of a TGIS shapefile named `name`. */
export function tgisShapefile(rows: TgisRow[], fields: TgisField[], name: string): { name: string; data: Buffer }[] {
  const { shp, shx } = writeShpAndShx(rows.map((r) => r.geometry));
  return [
    { name: `${name}.shp`, data: shp },
    { name: `${name}.shx`, data: shx },
    { name: `${name}.dbf`, data: writeDbf(rows, fields) },
    { name: `${name}.prj`, data: Buffer.from(TGIS_PRJ, 'latin1') },
  ];
}

export interface SampleCardField {
  fieldId: string;
  fieldName: string;
  parcel: string | null;
  areaHa: number;
  bodenart: string | null;
  geometry: MultiPolygon;
  zones: { zoneId: string; areaHa: number; probeNr: number; geometry: MultiPolygon }[];
}

/** PROBEKARTE rows: one per zone, analysis columns empty ("?" supply classes, zero values). */
export function sampleCardRows(fields: SampleCardField[], customerNumber: string, sampleDate: string): (TgisRow & { zoneId: string; probeNr: number })[] {
  const zero = formatNumeric(0, 10, 8);
  const rows: (TgisRow & { zoneId: string; probeNr: number })[] = [];
  for (const field of fields) {
    for (const zone of field.zones) {
      const record: Record<string, string | null> = {};
      for (const column of SAMPLE_CARD_FIELDS) record[column.name] = column.type === 'N' ? zero : column.name.endsWith('_VS') ? '?' : null;
      record.ID = String(rows.length + 1);
      record.SCHLAGNUMM = parcelNumber(field.parcel).slice(0, MACHINE_TEXT_LIMIT);
      record.SCHLAGNAME = field.fieldName.slice(0, MACHINE_TEXT_LIMIT);
      record.KUNDE = customerNumber.slice(0, 10);
      record.NUTZART = '';
      record.PROBEDATUM = sampleDate;
      record.PROBENUMME = String(zone.probeNr);
      record.BODENART = field.bodenart;
      record.FLAECHE_HA = formatNumeric(zone.areaHa, 10, 8);
      rows.push({ record, geometry: zone.geometry, zoneId: zone.zoneId, probeNr: zone.probeNr });
    }
  }
  return rows;
}

/** CONTOUR rows: one per field. */
export function contourRows(fields: SampleCardField[], harvestYear: number): TgisRow[] {
  return fields.map((field, i) => {
    const parsed = parseParcelNumber(field.parcel);
    const record: Record<string, string | null> = Object.fromEntries(CONTOUR_FIELDS.map((f) => [f.name, null]));
    Object.assign(record, {
      ID: String(i + 1),
      NUMMER: formatNullableNumeric(parsed?.nummer ?? i + 1, 10, 0),
      TEILNUM: formatNullableNumeric(parsed?.teilnum ?? 0, 10, 0),
      NAME: field.fieldName.slice(0, MACHINE_TEXT_LIMIT),
      FLAECHE: formatNullableNumeric(field.areaHa, 10, 8),
      ERNTEJAHR: formatNullableNumeric(harvestYear, 10, 0),
      BWZ: formatNullableNumeric(0, 10, 8),
      PACHT: formatNullableNumeric(0, 10, 2),
      FBFLAECHE: formatNullableNumeric(null, 10, 8),
      INTERNE_NU: formatNullableNumeric(null, 10, 0),
      SCHLAGNR_A: formatNullableNumeric(null, 10, 0),
    });
    return { record, geometry: field.geometry };
  });
}
