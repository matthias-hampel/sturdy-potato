/**
 * Reads the first worksheet of an .xlsx file into rows of cell values: just enough for lab
 * result exports (shared and inline strings, numbers, booleans; dates stay Excel serials).
 */
import { forEachZipEntry } from '../../files/zip.js';

export type CellValue = string | number | boolean | null;

const XML_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unescapeXml = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) =>
    e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : (XML_ENTITIES[e] ?? m),
  );

/** Text of every <t> inside an element (rich text runs are concatenated). */
const textOf = (xml: string) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => unescapeXml(m[1])).join('');

/** Column index of a cell reference like "AB12" (0-based). */
export function columnIndex(ref: string): number {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? 'A';
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export function parseSheet(xml: string, shared: string[]): CellValue[][] {
  const rows: CellValue[][] = [];
  for (const row of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    const index = Number(/\br="(\d+)"/.exec(row[1])?.[1] ?? rows.length + 1) - 1;
    const cells: CellValue[] = [];
    for (const cell of row[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cell[1];
      const body = cell[2] ?? '';
      const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1];
      const col = ref ? columnIndex(ref) : cells.length;
      const type = /\bt="(\w+)"/.exec(attrs)?.[1] ?? 'n';
      const raw = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let value: CellValue = null;
      if (type === 's') value = raw != null ? (shared[Number(raw)] ?? null) : null;
      else if (type === 'inlineStr') value = textOf(body);
      else if (type === 'str') value = raw != null ? unescapeXml(raw) : null;
      else if (type === 'b') value = raw === '1';
      else if (raw != null && raw !== '') value = Number(raw);
      cells[col] = value;
    }
    rows[index] = Array.from(cells, (c) => c ?? null);
  }
  return Array.from(rows, (r) => r ?? []);
}

/** The first worksheet as rows; `maxRows` stops early for a format sniff. */
export async function readFirstSheet(buffer: Buffer): Promise<CellValue[][]> {
  const parts = new Map<string, string>();
  await forEachZipEntry(buffer, async (entry) => {
    if (/^xl\/(sharedStrings\.xml|workbook\.xml|_rels\/workbook\.xml\.rels|worksheets\/sheet\d+\.xml)$/.test(entry.path)) parts.set(entry.path, entry.data.toString('utf8'));
  });
  const shared = [...(parts.get('xl/sharedStrings.xml') ?? '').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]));
  // The first sheet in the workbook's order, through its relationship.
  const workbook = parts.get('xl/workbook.xml') ?? '';
  const rid = /<sheet\b[^>]*\br:id="([^"]+)"/.exec(workbook)?.[1];
  const rels = parts.get('xl/_rels/workbook.xml.rels') ?? '';
  const target = rid ? new RegExp(`<Relationship\\b[^>]*Id="${rid}"[^>]*Target="([^"]+)"`).exec(rels)?.[1] : undefined;
  const path = target ? `xl/${target.replace(/^\/?xl\//, '')}` : 'xl/worksheets/sheet1.xml';
  const sheet = parts.get(path) ?? parts.get('xl/worksheets/sheet1.xml');
  if (!sheet) throw new Error('unsupported-format');
  return parseSheet(sheet, shared);
}

/** Excel serial date (1900 system) → YYYY-MM-DD. */
export function excelDate(serial: number): string | null {
  if (!Number.isFinite(serial) || serial <= 0) return null;
  const ms = Math.round((serial - 25569) * 86_400_000);
  return new Date(ms).toISOString().slice(0, 10);
}
