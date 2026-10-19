/** Ported from agmeo `src/lib/federalExport/harmonie-export/st/serializers/ertraege.ts`. */

import type { StErtragRow } from '../types.js';
import type { StColumn } from './format.js';
import { betriebCells, serializeStRow, ST_BETRIEB_COLUMNS } from './format.js';

export const ERTRAEGE_COLUMNS: readonly StColumn[] = [
  ...ST_BETRIEB_COLUMNS,
  { name: 'Bewirtschaftung', format: 'text' },
  { name: 'HF', format: 'text' },
  { name: 'HF_Nr', format: 'text' },
  { name: 'ErtragFM_Betrieb', format: 'decimal' },
  { name: 'ErtragTM_Betrieb_GL', format: 'decimal' },
  { name: 'ErtragFM_Betrieb_NG', format: 'decimal' },
  { name: 'ErtragTM_GL_NG', format: 'decimal' },
  { name: 'AndererErtrag', format: 'janein' },
  { name: 'Tats_Ertrag', format: 'decimal' },
];

export function serializeErtragRow(row: StErtragRow): string {
  return serializeStRow(ERTRAEGE_COLUMNS, [
    ...betriebCells(row),
    row.bewirtschaftung,
    row.hf,
    row.hfNr,
    row.ertragFmBetrieb,
    row.ertragTmBetriebGl,
    row.ertragFmBetriebNg,
    row.ertragTmGlNg,
    row.andererErtrag,
    row.tatsErtrag,
  ]);
}
