/** Ported from agmeo `src/lib/federalExport/harmonie-export/st/serializers/anl5.ts`. */

import type { StAnl5Row } from '../types.js';
import type { StColumn } from './format.js';
import { betriebCells, serializeStRow, ST_BETRIEB_COLUMNS } from './format.js';

const decimal = (name: string): StColumn => ({ name, format: 'decimal' });

export const ANL5_COLUMNS: readonly StColumn[] = [
  ...ST_BETRIEB_COLUMNS,
  decimal('Ackerland'),
  decimal('Gruenland'),
  decimal('Betriebsgroesse'),
  decimal('Flaeche170kg'),
  { name: 'Bewirtschaftung', format: 'text' },
  decimal('NBedarf'),
  decimal('P2O5Bedarf'),
  decimal('NMinDung'),
  decimal('NTierDung'),
  decimal('NVerfTierDung'),
  decimal('NWeide'),
  decimal('NSonstDung'),
  decimal('NVerfSonstDung'),
  decimal('NBodenHilf'),
  decimal('NKulturSubstrat'),
  decimal('NPflanzenHilf'),
  decimal('NAbfall'),
  decimal('NLegum'),
  decimal('NSumme'),
  decimal('NSumme_ha'),
  decimal('NSummeVerf'),
  decimal('P2O5MinDung'),
  decimal('P2O5TierDung'),
  decimal('P2O5Weide'),
  decimal('P2O5SonstDung'),
  decimal('P2O5BodenHilf'),
  decimal('P2O5KulturSubstrat'),
  decimal('P2O5PflanzenHilf'),
  decimal('P2O5Abfall'),
  decimal('P2O5Summe'),
];

export function serializeAnl5Row(row: StAnl5Row): string {
  return serializeStRow(ANL5_COLUMNS, [
    ...betriebCells(row),
    row.ackerlandHa,
    row.gruenlandHa,
    row.betriebsgroesseHa,
    row.flaeche170Ha,
    row.bewirtschaftung,
    row.nBedarf,
    row.p2o5Bedarf,
    row.nMinDung,
    row.nTierDung,
    row.nVerfTierDung,
    row.nWeide,
    row.nSonstDung,
    row.nVerfSonstDung,
    row.nBodenHilf,
    row.nKulturSubstrat,
    row.nPflanzenHilf,
    row.nAbfall,
    row.nLegum,
    row.nSumme,
    row.nSummePerHa,
    row.nSummeVerf,
    row.p2o5MinDung,
    row.p2o5TierDung,
    row.p2o5Weide,
    row.p2o5SonstDung,
    row.p2o5BodenHilf,
    row.p2o5KulturSubstrat,
    row.p2o5PflanzenHilf,
    row.p2o5Abfall,
    row.p2o5Summe,
  ]);
}
