/** Ported from agmeo `src/lib/federalExport/harmonie-export/besyd/builders/impmakro.ts`. */

import type { BesydColumn } from '../formatters.js';
import { formatBesydDateShort, serializeBesydRow } from '../formatters.js';
import type { ImpMakroRow } from '../types.js';
import type { FieldIdentifiers, MacroNutrientData } from './types.js';

export type ImpMakroBuildContext = {
  betriebsnummer: string;
  year: number;
  fieldIdentifiers: Map<string, FieldIdentifiers>;
  macroNutrientData: MacroNutrientData[];
};

// Unlike all other IMP* tables, IMPMAKRO repurposes two standard fields:
// - DATUMF = "Datum Makronährstoff-Untersuchung" (soil sample date, NOT crop planting date)
// - FRUCHT = "Proben-Nr." (soil sample number, NOT Fruchtart code from Tabelle 9a/9b)
// See webbesyd-import-exportstruktur-besyd2026-2026-01-16, IMPMAKRO.TXT
export const IMPMAKRO_COLUMNS: readonly BesydColumn[] = [
  { name: 'BNR', format: 'text' },
  { name: 'FSTNR', format: 'text' },
  { name: 'SNR', format: 'text' },
  { name: 'EJAHR', format: 'number' },
  { name: 'DATUMF', format: 'date' },
  { name: 'FRUCHT', format: 'text' },
  { name: 'LABOR20', format: 'text' },
  { name: 'HUMUS', format: 'number', decimals: 1 },
  { name: 'PH', format: 'number', decimals: 1 },
  { name: 'P', format: 'number', decimals: 1 },
  { name: 'K', format: 'number', decimals: 1 },
  { name: 'MG', format: 'number', decimals: 1 },
  { name: 'METHODPK', format: 'code' },
  { name: 'FAT', format: 'number', decimals: 0 },
  { name: 'CORG', format: 'number', decimals: 2 },
  { name: 'NT', format: 'number', decimals: 2 },
  { name: 'VSZIEL', format: 'code' },
];

export function buildImpMakro(context: ImpMakroBuildContext): ImpMakroRow[] {
  const rows: ImpMakroRow[] = [];

  for (const macro of context.macroNutrientData) {
    const fieldIds = context.fieldIdentifiers.get(macro.fieldId);
    if (!fieldIds) continue;

    const hasValues = [
      macro.ph,
      macro.pMgPer100g,
      macro.kMgPer100g,
      macro.mgMgPer100g,
      macro.humusPercent,
    ].some((v) => v !== undefined);
    if (!hasValues) continue;

    rows.push({
      BNR: context.betriebsnummer,
      FSTNR: fieldIds.fstnr,
      SNR: fieldIds.snr,
      EJAHR: context.year,
      DATUMF: formatBesydDateShort(macro.sampleDate),
      FRUCHT: macro.probeNr || '',
      LABOR20: macro.laborNr,
      HUMUS: macro.humusPercent,
      PH: macro.ph,
      P: macro.pMgPer100g,
      K: macro.kMgPer100g,
      MG: macro.mgMgPer100g,
      METHODPK: macro.methodPK,
      FAT: macro.fineContentPercent,
      CORG: macro.corgPercent,
      NT: macro.ntPercent,
    });
  }

  return rows;
}

export function serializeImpMakroRow(row: ImpMakroRow): string {
  return serializeBesydRow(IMPMAKRO_COLUMNS, [
    row.BNR,
    row.FSTNR,
    row.SNR,
    row.EJAHR,
    row.DATUMF,
    row.FRUCHT,
    row.LABOR20,
    row.HUMUS,
    row.PH,
    row.P,
    row.K,
    row.MG,
    row.METHODPK,
    row.FAT,
    row.CORG,
    row.NT,
    row.VSZIEL,
  ]);
}
