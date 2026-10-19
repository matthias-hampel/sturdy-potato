/** Ported from agmeo `src/lib/federalExport/harmonie-export/besyd/builders/impnlegumbetrieb.ts`. */

import type { BesydColumn } from '../formatters.js';
import { serializeBesydRow } from '../formatters.js';
import type { ImpNlegumBetriebRow, ImpNlegumRow } from '../types.js';

export const IMPNLEGUMBETRIEB_COLUMNS: readonly BesydColumn[] = [
  { name: 'BNR', format: 'text' },
  { name: 'EJAHR', format: 'number' },
  { name: 'AADATUM', format: 'date' },
  { name: 'MICODE', format: 'code' },
  { name: 'MIBEZ', format: 'text' },
  { name: 'MENGE', format: 'number', decimals: 1 },
  { name: 'MI_NBINDUNG', format: 'number', decimals: 2 },
  { name: 'PARKOR', format: 'text' },
];

export function buildImpNlegumBetrieb(
  betriebsnummer: string,
  year: number,
  nlegumRows: ImpNlegumRow[],
): ImpNlegumBetriebRow[] {
  const grouped = new Map<
    string,
    {
      code: string;
      name?: string;
      totalAmount: number;
      nFixation?: number;
      latestDate?: string;
    }
  >();

  for (const row of nlegumRows) {
    if (!row.MICODE) continue;

    const existing = grouped.get(row.MICODE);
    if (existing) {
      existing.totalAmount += row.MENGEGESAMT ?? 0;
      // As in agmeo: AADATUM is DD.MM.YYYY, so this string comparison orders by day first, not by date.
      if (
        row.AADATUM &&
        (!existing.latestDate || row.AADATUM > existing.latestDate)
      ) {
        existing.latestDate = row.AADATUM;
      }
    } else {
      grouped.set(row.MICODE, {
        code: row.MICODE,
        name: row.MIBEZ,
        totalAmount: row.MENGEGESAMT ?? 0,
        nFixation: row.MI_NBINDUNG,
        latestDate: row.AADATUM,
      });
    }
  }

  const rows: ImpNlegumBetriebRow[] = [];
  for (const [, data] of grouped) {
    if (data.totalAmount <= 0) continue;
    rows.push({
      BNR: betriebsnummer,
      EJAHR: year,
      AADATUM: data.latestDate,
      MICODE: data.code,
      MIBEZ: data.name,
      MENGE: data.totalAmount,
      MI_NBINDUNG: data.nFixation,
    });
  }

  return rows;
}

export function serializeImpNlegumBetriebRow(row: ImpNlegumBetriebRow): string {
  return serializeBesydRow(IMPNLEGUMBETRIEB_COLUMNS, [
    row.BNR,
    row.EJAHR,
    row.AADATUM,
    row.MICODE,
    row.MIBEZ,
    row.MENGE,
    row.MI_NBINDUNG,
    row.PARKOR,
  ]);
}
