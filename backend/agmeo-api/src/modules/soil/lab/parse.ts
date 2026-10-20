/**
 * Lab result files, ported from AGVOLUTION/agmeo lib/soil/labResultsUpload.ts and
 * probenkarteImport.ts. Three layouts:
 *
 * - CSV (";"), FarmFacts/LUFA ("Gpsnr", "P2O5", "K2O", "Mg", "Orgs" humus %, …) and the agrolab
 *   ASDE export ("Probe-Nr", "P", "K", "Mg", "G_K P" classes);
 * - XLSX, agrolab "EXPORT_ASDE" (one row per "Probenummer", German column names);
 * - the Probenkarte shapefile (ZIP) a lab returns with its values ("P_WERT", "*_VS" classes,
 *   NEXT Farming; or "P2O5"/"K2O"/"MGO", FarmFacts).
 *
 * Element columns (P, K, Mg) are converted to the stored oxides (VDLUFA 2018 factors); a file
 * whose P values contradict its own supply classes is rejected as being in the wrong unit.
 */
import type { SoilParameter } from '@agmeo/contracts';
import { forEachZipEntry } from '../../files/zip.js';
import { readShapefile } from './shapefile-read.js';
import { type CellValue, excelDate, readFirstSheet } from './xlsx.js';

export interface LabRow {
  probeNr: number | null;
  fieldNameHint: string | null;
  date: string;
  values: Partial<Record<SoilParameter, number>>;
  methods: Partial<Record<SoilParameter, string>>;
  stages: Partial<Record<SoilParameter, string>>;
  kalkbedarf: { dtHa: number | null; kg: number | null } | null;
  labNr: string | null;
  /** [lng, lat] inside the sampled area, for shapefile deliveries. */
  point: [number, number] | null;
}

export class LabFileError extends Error {
  constructor(readonly reason: 'unsupported-format' | 'unit-mismatch' | 'no-shapefile-found') {
    super(reason);
  }
}

type Unit = 'mg-p-per-100g' | 'mg-k-per-100g' | 'mg-mg-per-100g';
type ValueColumn = [column: string, param: SoilParameter, unit?: Unit];

/** Element → oxide factors (P × 2.291 = P2O5, K × 1.205 = K2O, Mg × 1.658 = MgO). */
const TO_OXIDE: Record<Unit, number> = { 'mg-p-per-100g': 2.291, 'mg-k-per-100g': 1.205, 'mg-mg-per-100g': 1.658 };
const P2O5_TO_P = 1 / 2.291;

export const labValueToCanonical = (value: number, unit: Unit | undefined) => (unit ? Math.round(value * TO_OXIDE[unit] * 100) / 100 : value);

const TRACE_PARAMS: SoilParameter[] = ['b', 'cu', 'fe', 'mn', 'mo', 'na', 's', 'zn', 'ca'];

/** pH and Mg from the CaCl2 extract, trace elements from CAT; P and K follow the file's method column (DL/CAL). */
export const methodFor = (param: SoilParameter, fileMethod: string | null): string | null => {
  if (param === 'p2o5' || param === 'k2o') return fileMethod === 'dl' ? 'dl' : 'cal';
  if (param === 'ph' || param === 'mgo') return 'cacl2';
  if (TRACE_PARAMS.includes(param)) return 'cat';
  return null;
};

/** "<0,10" keeps the detection limit; "1.234,5" drops the thousands dot. */
export const parseGermanNumber = (raw: unknown): number | null => {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  let cleaned = String(raw ?? '')
    .trim()
    .replace(/^</, '');
  if (cleaned.includes(',')) cleaned = cleaned.replaceAll('.', '');
  cleaned = cleaned.replace(',', '.');
  if (!cleaned || cleaned === '-') return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
};

const isoDate = (year: number, month: number, day: number): string | null => {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};

export const parseGermanDate = (raw: string | undefined | null): string | null => {
  const match = (raw ?? '').trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/);
  if (!match) return null;
  const year = match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3]);
  return isoDate(year, Number(match[2]), Number(match[1]));
};

export const toStage = (raw: unknown): string | null => {
  const stage = String(raw ?? '')
    .trim()
    .toUpperCase();
  return /^[A-E]$/.test(stage) ? stage : null;
};

// mg P/100 g a lab may grade into each Versorgungsstufe across the German scales.
const P_CLASS_BOUNDS: Record<string, [number, number]> = { A: [0, 4], B: [0, 7], C: [1.5, 9.5], D: [3, Infinity], E: [5, Infinity] };
const MAX_PLAUSIBLE_P = 40;

/** Rejects a file when a fifth of its P values do not fit mg P/100 g or their own supply classes. */
export function assertPlausible(rows: Pick<LabRow, 'values' | 'stages'>[]): void {
  let withP = 0;
  let off = 0;
  for (const row of rows) {
    if (row.values.p2o5 == null) continue;
    withP++;
    const elementP = row.values.p2o5 * P2O5_TO_P;
    const bounds = row.stages.p2o5 ? P_CLASS_BOUNDS[row.stages.p2o5] : null;
    if (elementP > MAX_PLAUSIBLE_P || (bounds && (elementP < bounds[0] || elementP > bounds[1]))) off++;
  }
  if (withP >= 3 && off / withP >= 0.2) throw new LabFileError('unit-mismatch');
}

const today = () => new Date().toISOString().slice(0, 10);

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

const CSV_VALUE_COLUMNS: ValueColumn[] = [
  ['ph', 'ph'],
  ['p', 'p2o5', 'mg-p-per-100g'],
  ['p2o5', 'p2o5'],
  ['k', 'k2o', 'mg-k-per-100g'],
  ['k2o', 'k2o'],
  ['mg', 'mgo', 'mg-mg-per-100g'],
  ['mgo', 'mgo'],
  ['b', 'b'],
  ['bor', 'b'],
  ['cu', 'cu'],
  ['fe', 'fe'],
  ['mn', 'mn'],
  ['mb', 'mo'],
  ['na', 'na'],
  ['s', 's'],
  ['zn', 'zn'],
  ['zink', 'zn'],
  ['orgs', 'humus'],
  ['humusgeh', 'humus'],
  ['nges', 'nt'],
];

const CSV_STAGE_COLUMNS: [string, SoilParameter][] = [
  ['phstufe', 'ph'], ['g_k_kalk/ph', 'ph'], ['g_k_kalk_ph', 'ph'], ['pstufe', 'p2o5'], ['g_k_p', 'p2o5'], ['kstufe', 'k2o'], ['g_k_ka', 'k2o'],
  ['mgstufe', 'mgo'], ['g_k_mg', 'mgo'], ['bstufe', 'b'], ['g_k_bor', 'b'], ['custufe', 'cu'], ['g_k_cu', 'cu'], ['festufe', 'fe'], ['mnstufe', 'mn'],
  ['g_k_mn', 'mn'], ['mbstufe', 'mo'], ['nastufe', 'na'], ['g_k_na', 'na'], ['sstufe', 's'], ['znstufe', 'zn'], ['g_k_zink', 'zn'], ['orgsstufe', 'humus'],
  ['ngesstufe', 'nt'],
];

const CSV_PROBE_NR_COLUMNS = ['gpsnr', 'probenumme', 'probenummer', 'probenr', 'probe-nr'];

/** Windows-1252 unless the bytes are valid UTF-8. */
export function decodeText(bytes: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, '');
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

/** Splits ";"-separated lines, honouring double quotes. */
export function parseDelimited(text: string, delimiter = ';'): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows;
}

const normalizeHeader = (key: string) => key.trim().toLowerCase().replaceAll(/\s+/g, '_');

export function parseLabCsv(text: string): LabRow[] {
  const lines = parseDelimited(text);
  // Spreadsheet-exported ASDE files can start with a numbered dummy row above the header.
  const headerIndex = Math.max(
    lines.findIndex((l) => l.some((c) => /probe/i.test(c))),
    0,
  );
  const header = (lines[headerIndex] ?? []).map(normalizeHeader);
  if (!CSV_PROBE_NR_COLUMNS.some((c) => header.includes(c)) || !CSV_VALUE_COLUMNS.some(([c]) => header.includes(c))) throw new LabFileError('unsupported-format');
  const rows: LabRow[] = [];
  for (const line of lines.slice(headerIndex + 1)) {
    const columns: Record<string, string> = {};
    header.forEach((h, i) => {
      if (!(h in columns)) columns[h] = line[i] ?? '';
    });
    const probeRaw = CSV_PROBE_NR_COLUMNS.map((k) => columns[k]).find((v) => v?.trim());
    const probeNr = Number(probeRaw?.trim());
    if (!Number.isInteger(probeNr) || probeNr <= 0) continue;
    const fileMethod = (columns.methode ?? '').trim().toLowerCase() || null;
    const values: LabRow['values'] = {};
    const methods: LabRow['methods'] = {};
    for (const [column, param, unit] of CSV_VALUE_COLUMNS) {
      const value = parseGermanNumber(columns[column]);
      if (value == null) continue;
      const method = methodFor(param, fileMethod);
      values[param] = labValueToCanonical(value, unit);
      if (method) methods[param] = method;
    }
    if (!Object.keys(values).length) continue;
    const stages: LabRow['stages'] = {};
    for (const [column, param] of CSV_STAGE_COLUMNS) {
      const stage = toStage(columns[column]);
      if (stage && values[param] != null) stages[param] = stage;
    }
    const kalkDt = parseGermanNumber(columns['kalkbed.'] ?? columns.kalkbed_1);
    const kalkKg = parseGermanNumber(columns.kalkbedarf ?? columns.kalkbed_2);
    rows.push({
      probeNr,
      fieldNameHint: (columns.schlag ?? columns.schlagbez ?? '').trim() || null,
      date: parseGermanDate(columns.pndatum ?? columns.befunddat) ?? today(),
      values,
      methods,
      stages,
      kalkbedarf: kalkDt != null || kalkKg != null ? { dtHa: kalkDt, kg: kalkKg } : null,
      labNr: (columns.labornr ?? '').trim() || null,
      point: null,
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// XLSX (agrolab EXPORT_ASDE)
// ---------------------------------------------------------------------------

const XLSX_VALUE_COLUMNS: ValueColumn[] = [
  ['pH-Wert', 'ph'],
  ['Phosphor', 'p2o5', 'mg-p-per-100g'],
  ['P2O5', 'p2o5'],
  ['Kalium', 'k2o', 'mg-k-per-100g'],
  ['K2O', 'k2o'],
  ['Magnesium', 'mgo', 'mg-mg-per-100g'],
  ['MgO', 'mgo'],
  ['Humusgehalt', 'humus'],
  ['Kupfer', 'cu'],
  ['Mangan', 'mn'],
  ['Bor', 'b'],
  ['Zink', 'zn'],
  ['Natrium', 'na'],
  ['Schwefel', 's'],
  ['Calcium', 'ca'],
  ['Nmin: NH4-N', 'nh4'],
  ['Nmin: NO3-N', 'no3'],
  ['Smin: SO4-S', 'smin'],
  ['Stickstoff gesamt', 'nt'],
  ['Stickstoff löslich', 'nsol'],
  ['Kohlenstoff gesamt', 'ct'],
  ['Carbonatgehalt (Scheibler)', 'caco3'],
  ['Tongehalt', 'clay'],
  ['Schluff (Summe)', 'silt'],
  ['Sand (Summe)', 'sand'],
  ['Feinschluff', 'siltf'],
  ['Mittelschluff', 'siltm'],
  ['Grobschluff', 'siltc'],
  ['Feinsand', 'sandf'],
  ['Mittel-/Grobsand', 'sandmc'],
  ['Blei', 'pb'],
  ['Cadmium', 'cd'],
  ['Chrom', 'cr'],
  ['Gesamt-Kupfer', 'cut'],
  ['Nickel', 'ni'],
  ['Quecksilber', 'hg'],
  ['Gesamt-Zink', 'znt'],
  ['Arsen', 'as'],
];

const XLSX_STAGE_COLUMNS: [string, SoilParameter][] = [
  ['Gehaltsklasse Kalk/pH', 'ph'], ['Gehaltsklasse Phosphor', 'p2o5'], ['Gehaltsklasse Kalium', 'k2o'], ['Gehaltsklasse Magnesium', 'mgo'],
  ['Gehaltsklasse Kupfer', 'cu'], ['Gehaltsklasse Mangan', 'mn'], ['Gehaltsklasse Bor', 'b'], ['Gehaltsklasse Zink', 'zn'], ['Gehaltsklasse Natrium', 'na'],
];

/** "0 - 1001 - GL Kummer (2,15 ha)" → "GL Kummer". */
export const fieldNameFromSchlagnummer = (raw: unknown): string | null => {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  const parts = text.split(' - ');
  const name = (parts.length >= 3 ? parts.slice(2).join(' - ') : text).replace(/\s*\([^)]*\)\s*$/, '').trim();
  return name || null;
};

const dateFromCell = (raw: CellValue): string | null => {
  if (typeof raw === 'number') return excelDate(raw);
  const us = String(raw ?? '')
    .trim()
    .match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (us) return isoDate(us[3].length === 2 ? 2000 + Number(us[3]) : Number(us[3]), Number(us[1]), Number(us[2]));
  return parseGermanDate(String(raw ?? ''));
};

export function parseLabSheet(sheet: CellValue[][]): LabRow[] {
  const header = (sheet[0] ?? []).map((c) => String(c ?? '').trim());
  if (!header.includes('Probenummer') || !XLSX_VALUE_COLUMNS.some(([c]) => header.includes(c))) throw new LabFileError('unsupported-format');
  const col = (name: string) => header.indexOf(name);
  const rows: LabRow[] = [];
  for (const cells of sheet.slice(1)) {
    const get = (name: string): CellValue => (col(name) >= 0 ? (cells[col(name)] ?? null) : null);
    const probeNr = Number(String(get('Probenummer') ?? '').trim());
    if (!Number.isInteger(probeNr) || probeNr <= 0) continue;
    const values: LabRow['values'] = {};
    const methods: LabRow['methods'] = {};
    for (const [column, param, unit] of XLSX_VALUE_COLUMNS) {
      const value = parseGermanNumber(get(column));
      if (value == null) continue;
      const method = methodFor(param, 'cal');
      values[param] = labValueToCanonical(value, unit);
      if (method) methods[param] = method;
    }
    if (!Object.keys(values).length) continue;
    const stages: LabRow['stages'] = {};
    for (const [column, param] of XLSX_STAGE_COLUMNS) {
      const stage = toStage(get(column));
      if (stage && values[param] != null) stages[param] = stage;
    }
    const kalkDt = parseGermanNumber(get('Kalkbedarf dt'));
    const kalkKg = parseGermanNumber(get('Kalkbedarf Kg'));
    rows.push({
      probeNr,
      fieldNameHint: fieldNameFromSchlagnummer(get('Schlagnummer')),
      date: dateFromCell(get('Befunddatum')) ?? today(),
      values,
      methods,
      stages,
      kalkbedarf: kalkDt != null || kalkKg != null ? { dtHa: kalkDt, kg: kalkKg } : null,
      labNr: String(get('Labornummer') ?? '').trim() || null,
      point: null,
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Probenkarte shapefile returned by the lab
// ---------------------------------------------------------------------------

const SHP_VALUE_COLUMNS: ValueColumn[] = [
  ['ph_wert', 'ph'], ['ph', 'ph'], ['p_wert', 'p2o5', 'mg-p-per-100g'], ['p2o5', 'p2o5'], ['k_wert', 'k2o', 'mg-k-per-100g'], ['k2o', 'k2o'],
  ['mg_wert', 'mgo', 'mg-mg-per-100g'], ['mgo', 'mgo'], ['b_wert', 'b'], ['b_mgkg', 'b'], ['cu_wert', 'cu'], ['mn_wert', 'mn'], ['mo_wert', 'mo'],
  ['zn_wert', 'zn'], ['s_wert', 's'], ['na_wert', 'na'], ['no3_kgha', 'no3'], ['humus', 'humus'],
];
const SHP_STAGE_COLUMNS: [string, SoilParameter][] = [
  ['ph_vs', 'ph'], ['kl_ph', 'ph'], ['p_vs', 'p2o5'], ['kl_p', 'p2o5'], ['k_vs', 'k2o'], ['kl_k', 'k2o'], ['mg_vs', 'mgo'], ['kl_mg', 'mgo'],
  ['b_vs', 'b'], ['cu_vs', 'cu'], ['mn_vs', 'mn'], ['mo_vs', 'mo'], ['zn_vs', 'zn'], ['s_vs', 's'], ['na_vs', 'na'],
];
const SHP_PROBE_KEYS = ['probenumme', 'probennr', 'probenr', 'probe_nr', 'gpsnr', 'probe'];

/** The DBF writes 0.00000000 into every column the lab did not analyse: zero is missing. */
const positive = (raw: unknown): number | null => {
  const v = parseGermanNumber(raw);
  return v != null && v > 0 ? v : null;
};

function interiorPoint(rings: number[][][]): [number, number] | null {
  const ring = rings[0];
  if (!ring?.length) return null;
  // Centroid of the outer ring; when it falls outside (concave), the midpoint of a horizontal chord.
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const f = ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
    a += f;
    cx += (ring[i][0] + ring[i + 1][0]) * f;
    cy += (ring[i][1] + ring[i + 1][1]) * f;
  }
  if (a === 0) return [ring[0][0], ring[0][1]];
  return [cx / (3 * a), cy / (3 * a)];
}

export async function parseProbenkarteZip(buffer: Buffer): Promise<LabRow[]> {
  const files = new Map<string, Buffer>();
  const nested: Buffer[] = [];
  await forEachZipEntry(buffer, async (e) => {
    const lower = e.path.toLowerCase();
    if (lower.endsWith('.shp') || lower.endsWith('.dbf')) files.set(lower, e.data);
    else if (lower.endsWith('.zip')) nested.push(e.data);
  });
  if (![...files.keys()].some((k) => k.endsWith('.shp')) && nested.length) {
    for (const inner of nested) {
      await forEachZipEntry(inner, async (e) => {
        const lower = e.path.toLowerCase();
        if (lower.endsWith('.shp') || lower.endsWith('.dbf')) files.set(lower, e.data);
      });
    }
  }
  const shpNames = [...files.keys()].filter((k) => k.endsWith('.shp'));
  const chosen = shpNames.find((n) => /probe?nkarte|probekarte/.test(n)) ?? shpNames[0];
  const dbf = chosen ? files.get(chosen.replace(/\.shp$/, '.dbf')) : undefined;
  if (!chosen || !dbf) throw new LabFileError('no-shapefile-found');
  const features = readShapefile(files.get(chosen)!, dbf);
  const columns = new Set(features.flatMap((f) => Object.keys(f.properties).map((k) => k.toLowerCase())));
  if (!SHP_VALUE_COLUMNS.some(([c]) => columns.has(c))) throw new LabFileError('unsupported-format');
  const rows: LabRow[] = [];
  for (const feature of features) {
    const props = Object.fromEntries(Object.entries(feature.properties).map(([k, v]) => [k.toLowerCase(), v]));
    const values: LabRow['values'] = {};
    const methods: LabRow['methods'] = {};
    for (const [column, param, unit] of SHP_VALUE_COLUMNS) {
      if (values[param] != null) continue;
      const value = positive(props[column]);
      if (value == null) continue;
      const method = methodFor(param, null);
      values[param] = labValueToCanonical(value, unit);
      if (method) methods[param] = method;
    }
    if (!Object.keys(values).length) continue;
    const stages: LabRow['stages'] = {};
    for (const [column, param] of SHP_STAGE_COLUMNS) {
      const stage = toStage(props[column]);
      if (stage && values[param] != null) stages[param] = stage;
    }
    const probeRaw = SHP_PROBE_KEYS.map((k) => props[k]).find((v) => v != null && String(v).trim() !== '');
    const probeNr = Number(String(probeRaw ?? '').trim());
    const date = String(props.probedatum ?? props.datum ?? '').trim();
    const iso = /^(\d{4})-?(\d{2})-?(\d{2})$/.exec(date);
    rows.push({
      probeNr: Number.isInteger(probeNr) && probeNr > 0 ? probeNr : null,
      fieldNameHint: (String(props.schlagname ?? '').trim() || null) as string | null,
      date: (iso ? isoDate(Number(iso[1]), Number(iso[2]), Number(iso[3])) : parseGermanDate(date)) ?? today(),
      values,
      methods,
      stages,
      kalkbedarf: null,
      labNr: String(props.laborprnr ?? props.labornr ?? '').trim() || null,
      point: feature.geometry ? interiorPoint(feature.geometry.coordinates[0] as number[][][]) : null,
    });
  }
  return rows;
}

export const isSpreadsheetName = (name: string) => /\.xlsx$/i.test(name);
export const isZipName = (name: string) => /\.zip$/i.test(name);

/** Parses one uploaded lab file by its name and content. */
export async function parseLabFile(name: string, data: Buffer): Promise<LabRow[]> {
  let rows: LabRow[];
  if (isZipName(name)) rows = await parseProbenkarteZip(data);
  else if (isSpreadsheetName(name)) rows = parseLabSheet(await readFirstSheet(data).catch(() => Promise.reject(new LabFileError('unsupported-format'))));
  else rows = parseLabCsv(decodeText(data));
  assertPlausible(rows);
  return rows;
}

/** Drops exact duplicates (the same file uploaded twice, or rows repeated across files). */
export function dedupeRows(rows: LabRow[]): { rows: LabRow[]; duplicates: number } {
  const seen = new Set<string>();
  const out: LabRow[] = [];
  const sorted = (o: object) => Object.entries(o).sort(([a], [b]) => a.localeCompare(b));
  for (const row of rows) {
    const key = JSON.stringify([row.probeNr, row.fieldNameHint, row.date, row.labNr, row.kalkbedarf, row.point, sorted(row.values), sorted(row.methods), sorted(row.stages)]);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return { rows: out, duplicates: rows.length - out.length };
}
