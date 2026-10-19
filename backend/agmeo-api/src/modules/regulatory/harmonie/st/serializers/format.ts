/**
 * LLG format rules: tab-separated, every number with 2 decimals except
 * KreisNr (integer), dates TT.MM.JJJJ, ja/nein flags, no header row.
 *
 * Ported from agmeo `src/lib/federalExport/harmonie-export/st/serializers/format.ts`.
 */

export type StColumnFormat =
  'text' | 'integer' | 'decimal' | 'date' | 'janein' | 'year';

export type StColumn = { name: string; format: StColumnFormat };

export type StCell = string | number | boolean | Date | null | undefined;

const ST_FIELD_SEPARATOR = '\t';

function formatStDecimal(value: number | null | undefined): string {
  return value === null || value === undefined || isNaN(value)
    ? '0.00'
    : value.toFixed(2);
}

function formatStDate(date: Date | null | undefined): string {
  if (!date || isNaN(date.getTime())) return '';
  const day = date.getUTCDate().toString().padStart(2, '0');
  const month = (date.getUTCMonth() + 1).toString().padStart(2, '0');
  return `${day}.${month}.${date.getUTCFullYear()}`;
}

function formatStCell(column: StColumn, value: StCell): string {
  switch (column.format) {
    case 'text':
      return value === null || value === undefined
        ? ''
        : String(value).replace(/[\t\r\n]+/g, ' ');
    case 'integer':
      return typeof value === 'number' && !isNaN(value)
        ? Math.round(value).toString()
        : '';
    case 'year':
      return typeof value === 'number' ? value.toString() : '';
    case 'decimal':
      return formatStDecimal(typeof value === 'number' ? value : null);
    case 'date':
      return value instanceof Date ? formatStDate(value) : '';
    case 'janein':
      return typeof value === 'boolean' ? (value ? 'ja' : 'nein') : '';
  }
}

export function serializeStRow(
  columns: readonly StColumn[],
  cells: readonly StCell[],
): string {
  if (cells.length !== columns.length) {
    throw new Error(
      `ST row has ${cells.length} cells for ${columns.length} columns`,
    );
  }
  return cells
    .map((cell, i) => formatStCell(columns[i], cell))
    .join(ST_FIELD_SEPARATOR);
}

export function serializeStTable<T>(
  rows: T[],
  serializer: (row: T) => string,
): string {
  return rows.map(serializer).join('\r\n');
}

/** Columns every file starts with. */
export const ST_BETRIEB_COLUMNS: readonly StColumn[] = [
  { name: 'Betriebsname', format: 'text' },
  { name: 'EU_Nummer', format: 'text' },
  { name: 'SitzPLZ', format: 'text' },
  { name: 'SitzOrt', format: 'text' },
  { name: 'SitzOrtsTeil', format: 'text' },
  { name: 'KreisNr', format: 'integer' },
  { name: 'Kreis', format: 'text' },
  { name: 'Exportquelle', format: 'text' },
  { name: 'Duengejahr', format: 'year' },
];

export const betriebCells = (row: {
  betriebsname: string;
  euNummer: string;
  sitzPlz: string;
  sitzOrt: string;
  sitzOrtsteil: string;
  kreisNr: number;
  kreis: string;
  exportquelle: string;
  duengejahr: number;
}): StCell[] => [
  row.betriebsname,
  row.euNummer,
  row.sitzPlz,
  row.sitzOrt,
  row.sitzOrtsteil,
  row.kreisNr,
  row.kreis,
  row.exportquelle,
  row.duengejahr,
];

/** Schlag columns shared by DBE and Duengungen (after Duengejahr). */
export const ST_SCHLAG_COLUMNS: readonly StColumn[] = [
  { name: 'Datum', format: 'date' },
  { name: 'Feldblock_ID', format: 'text' },
  { name: 'Parzelle', format: 'text' },
  { name: 'NG', format: 'janein' },
  { name: 'Phosphorgebiet', format: 'janein' },
  { name: 'Groesse', format: 'decimal' },
  { name: 'Nutzung', format: 'text' },
  { name: 'Bewirtschaftung', format: 'text' },
];

export const schlagCells = (row: {
  datum: Date | null;
  feldblockId: string;
  parzelle: string;
  ng: boolean;
  phosphorgebiet: boolean;
  groesseHa: number;
  nutzung: string;
  bewirtschaftung: string;
}): StCell[] => [
  row.datum,
  row.feldblockId,
  row.parzelle,
  row.ng,
  row.phosphorgebiet,
  row.groesseHa,
  row.nutzung,
  row.bewirtschaftung,
];
