/**
 * Uploaded zone files for application-map bases (ported from the reference's
 * UploadBaseZonationButton): a GeoJSON FeatureCollection with a nutrient target per zone
 * (target_n, target_p2o5, target_k2o, target_mgo) or a rate column, a Shapefile ZIP with a rate
 * column, or an ISO-XML TASKDATA ZIP with a rate grid. Rated features are grouped by distinct
 * rate, one zone per rate; geometries are unioned and clipped to the field by the caller.
 */
import type { Feature, MultiPolygon, Polygon, Position } from 'geojson';
import { readShapefile } from '../../soil/lab/shapefile-read.js';
import { resolveCrs, toLonLat, UnsupportedCrsError } from '../../yield/lib/crs.js';
import { xmlElements } from '../../yield/lib/isoxml.js';
import { openZip } from '../../yield/lib/zip.js';

export const TARGET_KEYS = ['target_n', 'target_p2o5', 'target_k2o', 'target_mgo'] as const;
export type TargetKey = (typeof TARGET_KEYS)[number];
export type RateUnit = 'kg/ha' | 'l/ha';

/** More distinct rates than this is a raw grid or point map, not a zoned map. */
export const MAX_DISTINCT_RATES = 50;

export interface ParsedZone {
  /** One or more polygons; unioned by the caller. */
  geometries: (Polygon | MultiPolygon)[];
  target: number;
}

export type ParseResult =
  | { ok: true; zones: ParsedZone[]; targetKey: TargetKey | 'rate'; unit: RateUnit | null; dropped: number; format: 'geojson' | 'shapefile' | 'isoxml' }
  | { ok: false; code: ZoneFileError; message?: string };

/** Error codes, after the reference's upload errors. */
export type ZoneFileError = 'not_json' | 'not_geojson' | 'empty' | 'no_target' | 'no_polygons' | 'no_grid' | 'too_many_rates' | 'unsupported_crs' | 'not_zip';

const RATE_COLUMNS: Record<string, RateUnit | null> = { kg_p_ha: 'kg/ha', l_p_ha: 'l/ha', rate: null };

/** Unit strings of ISO-XML value presentations, stripped to [a-z0-9] (reference ISOXML_UNITS). */
const ISOXML_UNITS: Record<string, { unit: RateUnit; factor: number }> = {
  kgha: { unit: 'kg/ha', factor: 1 },
  kghectare: { unit: 'kg/ha', factor: 1 },
  mgm: { unit: 'kg/ha', factor: 0.01 },
  mgm2: { unit: 'kg/ha', factor: 0.01 },
  lha: { unit: 'l/ha', factor: 1 },
  lhectare: { unit: 'l/ha', factor: 1 },
  mmm: { unit: 'l/ha', factor: 0.01 },
  mm3m2: { unit: 'l/ha', factor: 0.01 },
};
export const normaliseIsoxmlUnit = (unit: string) => ISOXML_UNITS[unit.toLowerCase().replace(/[^a-z0-9]/g, '')];
/** Base units of the setpoint/actual rate DDIs when a grid has no value presentation. */
const DDI_UNITS: Record<string, { unit: RateUnit; factor: number }> = {
  '0001': { unit: 'l/ha', factor: 0.01 },
  '0002': { unit: 'l/ha', factor: 0.01 },
  '0006': { unit: 'kg/ha', factor: 0.01 },
  '0007': { unit: 'kg/ha', factor: 0.01 },
};

const isPolygonal = (g: unknown): g is Polygon | MultiPolygon =>
  !!g && typeof g === 'object' && ((g as { type?: string }).type === 'Polygon' || (g as { type?: string }).type === 'MultiPolygon');

/** One zone per distinct rate (reference zonesFromRatedFeatures), lowest rate first. */
export function zonesFromRated(rated: { rate: number; geometry: Polygon | MultiPolygon }[]): ParsedZone[] | ZoneFileError {
  const byRate = new Map<number, (Polygon | MultiPolygon)[]>();
  for (const { rate, geometry } of rated) {
    if (!Number.isFinite(rate) || rate < 0) continue;
    const group = byRate.get(rate);
    if (group) group.push(geometry);
    else byRate.set(rate, [geometry]);
  }
  if (byRate.size === 0) return 'no_polygons';
  if (byRate.size > MAX_DISTINCT_RATES) return 'too_many_rates';
  return [...byRate.entries()].sort((a, b) => a[0] - b[0]).map(([target, geometries]) => ({ target, geometries }));
}

/** The rate column of a set of feature properties: a known name, else the only numeric column. */
export function rateColumn(rows: Record<string, unknown>[]): { key: string; unit: RateUnit | null } | null {
  const keys = Object.keys(rows[0] ?? {});
  const known = keys.find((k) => Object.hasOwn(RATE_COLUMNS, k.toLowerCase()));
  if (known) {
    const unitKey = keys.find((k) => k.toLowerCase() === 'unit');
    const stated = unitKey ? String(rows[0][unitKey] ?? '').toLowerCase().replace(/\s/g, '') : '';
    const unit = RATE_COLUMNS[known.toLowerCase()] ?? (stated === 'kg/ha' || stated === 'l/ha' ? stated : null);
    return { key: known, unit };
  }
  const numeric = keys.filter((k) => rows.every((r) => typeof r[k] === 'number'));
  return numeric.length === 1 ? { key: numeric[0], unit: null } : null;
}

export function parseGeojson(raw: string): ParseResult {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, code: 'not_json' };
  }
  if (!json || typeof json !== 'object' || (json as { type?: string }).type !== 'FeatureCollection') return { ok: false, code: 'not_geojson' };
  const features = ((json as { features?: unknown }).features ?? []) as Feature[];
  if (!Array.isArray(features) || features.length === 0) return { ok: false, code: 'empty' };
  const polygons = features.filter((f) => isPolygonal(f?.geometry)) as Feature<Polygon | MultiPolygon>[];

  const targetKey = TARGET_KEYS.find((k) => polygons.some((f) => typeof f.properties?.[k] === 'number'));
  if (targetKey) {
    const rated: { rate: number; geometry: Polygon | MultiPolygon }[] = [];
    let dropped = 0;
    for (const f of polygons) {
      const value = f.properties?.[targetKey];
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        if (TARGET_KEYS.some((k) => typeof f.properties?.[k] === 'number' && Number.isFinite(f.properties[k]))) dropped++;
        continue;
      }
      rated.push({ rate: value, geometry: f.geometry });
    }
    if (!rated.length) return { ok: false, code: 'no_polygons' };
    // One zone per feature as in the reference; equal targets share a zone once there are too many.
    const zones = rated.length <= MAX_DISTINCT_RATES ? rated.map((r) => ({ target: r.rate, geometries: [r.geometry] })) : zonesFromRated(rated);
    if (typeof zones === 'string') return { ok: false, code: zones };
    return { ok: true, zones, targetKey, unit: 'kg/ha', dropped, format: 'geojson' };
  }
  if (!polygons.length) return { ok: false, code: 'no_polygons' };
  const column = rateColumn(polygons.map((f) => f.properties ?? {}));
  if (!column) return { ok: false, code: 'no_target' };
  const zones = zonesFromRated(polygons.filter((f) => typeof f.properties?.[column.key] === 'number').map((f) => ({ rate: f.properties![column.key] as number, geometry: f.geometry })));
  if (typeof zones === 'string') return { ok: false, code: zones };
  return { ok: true, zones, targetKey: 'rate', unit: column.unit, dropped: 0, format: 'geojson' };
}

function mapCoords(g: MultiPolygon, f: (x: number, y: number) => [number, number]): MultiPolygon {
  return { type: 'MultiPolygon', coordinates: g.coordinates.map((p) => p.map((r) => r.map(([x, y]) => f(x, y) as Position))) };
}

/** A Shapefile set; projected coordinates are transformed to WGS 84 (`.prj`, or detected near `near`). */
export function parseShapefile(shp: Buffer, dbf: Buffer, prj: string | null, near: [number, number] | null): ParseResult {
  const features = readShapefile(shp, dbf).filter((f): f is { geometry: MultiPolygon; properties: Record<string, string | number | null> } => !!f.geometry?.coordinates.length);
  if (!features.length) return { ok: false, code: 'no_polygons' };
  let transform: ((x: number, y: number) => [number, number]) | null;
  try {
    const sample = features.slice(0, 20).flatMap((f) => f.geometry.coordinates[0][0].slice(0, 3)) as [number, number][];
    transform = toLonLat(resolveCrs(prj, sample, near).def);
  } catch (e) {
    if (e instanceof UnsupportedCrsError) return { ok: false, code: 'unsupported_crs', message: e.message };
    throw e;
  }
  const column = rateColumn(features.map((f) => f.properties));
  if (!column) return { ok: false, code: 'no_target' };
  const rated = features
    .filter((f) => typeof f.properties[column.key] === 'number')
    .map((f) => ({ rate: f.properties[column.key] as number, geometry: transform ? mapCoords(f.geometry, transform) : f.geometry }));
  if (!rated.length) return { ok: false, code: 'no_target' };
  const zones = zonesFromRated(rated);
  if (typeof zones === 'string') return { ok: false, code: zones };
  return { ok: true, zones, targetKey: 'rate', unit: column.unit, dropped: 0, format: 'shapefile' };
}

/**
 * Merges a row's consecutive cells of one value into strips (reference mergeRowRuns), so the
 * union afterwards works on strips rather than on every cell.
 */
function rowStrips(cells: { row: number; col: number }[], grid: { lat0: number; lon0: number; dLat: number; dLon: number }): Polygon[] {
  const strips: Polygon[] = [];
  const sorted = [...cells].sort((a, b) => a.row - b.row || a.col - b.col);
  let run: { row: number; from: number; to: number } | null = null;
  const flush = () => {
    if (!run) return;
    const y0 = grid.lat0 + run.row * grid.dLat;
    const x0 = grid.lon0 + run.from * grid.dLon;
    const x1 = grid.lon0 + (run.to + 1) * grid.dLon;
    const y1 = y0 + grid.dLat;
    strips.push({ type: 'Polygon', coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]] });
  };
  for (const c of sorted) {
    if (run && run.row === c.row && run.to === c.col - 1) run.to = c.col;
    else {
      flush();
      run = { row: c.row, from: c.col, to: c.col };
    }
  }
  flush();
  return strips;
}

/**
 * The rate grid of the first task that has one (ISO 11783-10 GRD). Type 1 grids hold a treatment
 * zone code per cell (rate from that zone's PDV), type 2 grids the raw process data value(s) per
 * cell (the first is read). Rows run south to north, columns west to east.
 */
export function parseIsoxmlGrid(xml: string, readBin: (name: string) => Buffer | null): ParseResult {
  const elements = xmlElements(xml);
  const vpns = new Map(elements.filter((e) => e.name === 'VPN').map((e) => [e.attrs.A, e.attrs]));
  type Pdv = { ddi: string; value: number; vpn?: string };
  type GridTask = { zones: Map<number, Pdv[]>; grid: Record<string, string> | null };
  let task = null as GridTask | null;
  let zone = null as Pdv[] | null;
  let found = null as GridTask | null;
  for (const e of elements) {
    if (e.name === 'TSK') {
      if (task?.grid && !found) found = task;
      task = { zones: new Map(), grid: null };
      zone = null;
    } else if (task && e.name === 'TZN') {
      zone = [];
      task.zones.set(Number(e.attrs.A), zone);
    } else if (task && zone && e.name === 'PDV') {
      zone.push({ ddi: (e.attrs.A ?? '').toUpperCase(), value: Number(e.attrs.B), vpn: e.attrs.E });
    } else if (task && e.name === 'GRD') {
      task.grid = e.attrs;
      zone = null;
    }
  }
  if (task?.grid && !found) found = task;
  if (!found?.grid) return { ok: false, code: 'no_grid' };
  const g = found.grid;
  const grid = { lat0: Number(g.A), lon0: Number(g.B), dLat: Number(g.C), dLon: Number(g.D) };
  const cols = Number(g.E);
  const rows = Number(g.F);
  const type = Number(g.I ?? 2);
  const bin = readBin(g.G ?? '');
  if (!bin || !(cols > 0 && rows > 0) || ![grid.lat0, grid.lon0, grid.dLat, grid.dLon].every(Number.isFinite)) return { ok: false, code: 'no_grid' };

  const convert = (pdv: { ddi: string; vpn?: string } | undefined) => {
    const vpn = pdv?.vpn ? vpns.get(pdv.vpn) : undefined;
    if (vpn) {
      const norm = normaliseIsoxmlUnit(vpn.E ?? '');
      const offset = Number(vpn.B ?? 0);
      const scale = Number(vpn.C ?? 1);
      return { f: (raw: number) => (raw + offset) * scale * (norm?.factor ?? 1), unit: norm?.unit ?? null };
    }
    const base = pdv ? DDI_UNITS[pdv.ddi] : undefined;
    return { f: (raw: number) => raw * (base?.factor ?? 1), unit: base?.unit ?? null };
  };

  const cells = new Map<number, { row: number; col: number }[]>();
  let unit: RateUnit | null = null;
  if (type === 1) {
    if (bin.length < rows * cols) return { ok: false, code: 'no_grid' };
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const code = bin[r * cols + c];
        const pdv = found.zones.get(code)?.[0];
        if (!pdv) continue;
        const conv = convert(pdv);
        unit ??= conv.unit;
        const rate = conv.f(pdv.value);
        const list = cells.get(rate) ?? [];
        list.push({ row: r, col: c });
        cells.set(rate, list);
      }
  } else {
    const layout = found.zones.get(Number(g.J ?? NaN)) ?? [...found.zones.values()].find((z) => z.length) ?? [];
    const width = Math.max(1, layout.length);
    if (bin.length < rows * cols * 4 * width) return { ok: false, code: 'no_grid' };
    const conv = convert(layout[0]);
    unit = conv.unit;
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const raw = bin.readInt32LE((r * cols + c) * 4 * width);
        const rate = conv.f(raw);
        const list = cells.get(rate) ?? [];
        list.push({ row: r, col: c });
        cells.set(rate, list);
      }
  }
  if (!cells.size) return { ok: false, code: 'empty' };
  const zones = zonesFromRated([...cells.entries()].flatMap(([rate, list]) => rowStrips(list, grid).map((geometry) => ({ rate, geometry }))));
  if (typeof zones === 'string') return { ok: false, code: zones };
  return { ok: true, zones, targetKey: 'rate', unit, dropped: 0, format: 'isoxml' };
}

/** Parses an uploaded file by its name and content. */
export async function parseZoneFile(name: string, data: Buffer, near: [number, number] | null): Promise<ParseResult> {
  const isZip = /\.zip$/i.test(name) || data.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  if (!isZip) return parseGeojson(data.toString('utf8'));
  let zip;
  try {
    zip = await openZip(data);
  } catch {
    return { ok: false, code: 'not_zip' };
  }
  try {
    const names = zip.names.filter((n) => !n.includes('__MACOSX'));
    const taskdata = names.find((n) => /(^|\/)taskdata\.xml$/i.test(n));
    if (taskdata) {
      const xml = (await zip.read(taskdata)).toString('utf8');
      const dir = taskdata.slice(0, taskdata.length - 'taskdata.xml'.length);
      const bins = new Map<string, Buffer>();
      for (const n of names.filter((x) => /\.bin$/i.test(x) && x.toLowerCase().startsWith(dir.toLowerCase()))) bins.set(n.slice(dir.length).replace(/\.bin$/i, '').toUpperCase(), await zip.read(n));
      return parseIsoxmlGrid(xml, (file) => bins.get(file.toUpperCase()) ?? null);
    }
    const shp = names.find((n) => /\.shp$/i.test(n));
    const base = shp?.slice(0, -4).toLowerCase();
    const dbf = names.find((n) => n.toLowerCase() === `${base}.dbf`);
    if (!shp || !dbf) {
      const geojson = names.find((n) => /\.(geo)?json$/i.test(n));
      if (geojson) return parseGeojson((await zip.read(geojson)).toString('utf8'));
      return { ok: false, code: 'no_grid' };
    }
    const prj = names.find((n) => n.toLowerCase() === `${base}.prj`);
    return parseShapefile(await zip.read(shp), await zip.read(dbf), prj ? (await zip.read(prj)).toString('utf8') : null, near);
  } finally {
    zip.close();
  }
}
