/** Ported from agmeo `src/lib/federalExport/harmonie-export/st/serializers/duengungen.ts`. */

import type { StDuengungRow } from '../types.js';
import type { StColumn } from './format.js';
import {
  betriebCells,
  schlagCells,
  serializeStRow,
  ST_BETRIEB_COLUMNS,
  ST_SCHLAG_COLUMNS,
} from './format.js';

const decimal = (name: string): StColumn => ({ name, format: 'decimal' });

export const DUENGUNGEN_COLUMNS: readonly StColumn[] = [
  ...ST_BETRIEB_COLUMNS,
  ...ST_SCHLAG_COLUMNS,
  { name: 'HF', format: 'text' },
  { name: 'HF_Nr', format: 'text' },
  { name: 'Zuordnung', format: 'text' },
  { name: 'Kategorie', format: 'text' },
  { name: 'Bezeichnung', format: 'text' },
  decimal('Menge'),
  decimal('Menge_N'),
  decimal('Menge_NVerf'),
  decimal('P2O5_Menge'),
  decimal('Menge_N_ha'),
  decimal('Menge_NVerf_ha'),
  decimal('P2O5_Menge_ha'),
  { name: 'IstHerbstDuengung', format: 'janein' },
  decimal('Weidetiere'),
  decimal('Weidetage'),
];

export function serializeDuengungRow(row: StDuengungRow): string {
  return serializeStRow(DUENGUNGEN_COLUMNS, [
    ...betriebCells(row),
    ...schlagCells(row),
    row.hf,
    row.hfNr,
    row.zuordnung,
    row.kategorie,
    row.bezeichnung,
    row.menge,
    row.mengeN,
    row.mengeNVerf,
    row.p2o5Menge,
    row.mengeNPerHa,
    row.mengeNVerfPerHa,
    row.p2o5MengePerHa,
    row.istHerbstDuengung,
    row.weidetiere,
    row.weidetage,
  ]);
}
