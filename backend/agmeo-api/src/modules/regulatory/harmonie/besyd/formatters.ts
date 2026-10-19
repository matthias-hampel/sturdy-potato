/**
 * BESyD CSV formatting — webBESyD Exportstruktur 2026, "Aufbau der Dateien":
 * no header row, `;` field separator, `„` (U+201E) text qualifier, `.` decimal
 * separator, "alle Verschlüsselungen als Text".
 *
 * Dates: the global statement names `tt.mm.jjjj hh:mm:ss`, but every date
 * column of the IMP* tables is specified as `tt.mm.jjjj` — the per-column
 * format wins here. Text AND code columns are wrapped in the qualifier;
 * numbers, dates and j/n flags are written bare.
 *
 * Ported from agmeo `src/lib/federalExport/harmonie-export/besyd/formatters.ts`.
 */

import { BESYD_FIELD_SEPARATOR, BESYD_TEXT_DELIMITER } from './types.js';

export type BesydColumnFormat = 'text' | 'code' | 'number' | 'date' | 'flag';

export type BesydColumn = {
  name: string;
  format: BesydColumnFormat;
  /** Fixed decimals for number columns; omitted → the value is written as is. */
  decimals?: number;
};

export type BesydCell = string | number | boolean | Date | null | undefined;

export function formatBesydText(value: string | undefined | null): string {
  if (!value) return '';
  const escaped = value.replace(/„/g, '„„').replace(/"/g, '""');
  return `${BESYD_TEXT_DELIMITER}${escaped}${BESYD_TEXT_DELIMITER}`;
}

export function formatBesydNumber(
  value: number | undefined | null,
  decimals?: number,
): string {
  if (value === undefined || value === null || isNaN(value)) return '';
  return decimals === undefined ? value.toString() : value.toFixed(decimals);
}

/** `DD.MM.YYYY` read in UTC — local getters printed the previous day west of Greenwich. */
export function formatBesydDateShort(
  date: Date | string | undefined | null,
): string {
  if (!date) return '';
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) return '';
  const day = d.getUTCDate().toString().padStart(2, '0');
  const month = (d.getUTCMonth() + 1).toString().padStart(2, '0');
  return `${day}.${month}.${d.getUTCFullYear()}`;
}

export function formatBesydBoolean(value: boolean | undefined | null): string {
  if (value === undefined || value === null) return '';
  return value ? 'j' : 'n';
}

export function formatBesydCell(column: BesydColumn, value: BesydCell): string {
  if (value === undefined || value === null) return '';
  switch (column.format) {
    case 'text':
    case 'code':
      return formatBesydText(
        typeof value === 'number' ? value.toString() : String(value),
      );
    case 'number':
      return formatBesydNumber(
        typeof value === 'number' ? value : Number(value),
        column.decimals,
      );
    case 'date':
      // Rows carry dates pre-formatted as dd.mm.yyyy strings; only Date instances still need formatting.
      if (value instanceof Date) return formatBesydDateShort(value);
      return typeof value === 'string' ? value : '';
    case 'flag':
      return typeof value === 'boolean'
        ? formatBesydBoolean(value)
        : String(value);
  }
}

/** One record: `cells` must line up with `columns` (the spec order the tests pin). */
export function serializeBesydRow(
  columns: readonly BesydColumn[],
  cells: readonly BesydCell[],
): string {
  if (cells.length !== columns.length) {
    throw new Error(
      `BESyD row has ${cells.length} cells for ${columns.length} columns`,
    );
  }
  return cells
    .map((cell, i) => formatBesydCell(columns[i], cell))
    .join(BESYD_FIELD_SEPARATOR);
}

export function serializeBesydTable<T>(
  rows: T[],
  serializer: (row: T) => string,
): string {
  return rows.map(serializer).join('\n');
}
