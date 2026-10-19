/** Ported from agmeo `src/lib/federalExport/harmonie-export/besyd/builders/impnmin.ts`. */

import type { BesydColumn } from '../formatters.js';
import { formatBesydDateShort, serializeBesydRow } from '../formatters.js';
import type { ImpNminRow } from '../types.js';
import type { CropCodeInfo, FieldIdentifiers, NminData } from './types.js';

export type ImpNminBuildContext = {
  betriebsnummer: string;
  year: number;
  fieldIdentifiers: Map<string, FieldIdentifiers>;
  cultivationCropCodes: Map<string, CropCodeInfo>;
  nminData: NminData[];
};

export const IMPNMIN_COLUMNS: readonly BesydColumn[] = [
  { name: 'BNR', format: 'text' },
  { name: 'FSTNR', format: 'text' },
  { name: 'SNR', format: 'text' },
  { name: 'EJAHR', format: 'number' },
  { name: 'DATUMF', format: 'date' },
  { name: 'FRUCHT', format: 'code' },
  { name: 'AADATUM', format: 'date' },
  { name: 'PROBE', format: 'text' },
  { name: 'LABOR15', format: 'text' },
  { name: 'NH415', format: 'number', decimals: 0 },
  { name: 'NO315', format: 'number', decimals: 0 },
  { name: 'LABOR16', format: 'text' },
  { name: 'NH416', format: 'number', decimals: 0 },
  { name: 'NO316', format: 'number', decimals: 0 },
  { name: 'LABOR30', format: 'text' },
  { name: 'NH430', format: 'number', decimals: 0 },
  { name: 'NO330', format: 'number', decimals: 0 },
  { name: 'LABOR60', format: 'text' },
  { name: 'NH460', format: 'number', decimals: 0 },
  { name: 'NO360', format: 'number', decimals: 0 },
  { name: 'LABOR90', format: 'text' },
  { name: 'NH490', format: 'number', decimals: 0 },
  { name: 'NO390', format: 'number', decimals: 0 },
  { name: 'NMIN_RW', format: 'flag' },
  { name: 'NMIN15', format: 'number', decimals: 0 },
  { name: 'NMIN16', format: 'number', decimals: 0 },
  { name: 'NMIN30', format: 'number', decimals: 0 },
  { name: 'NMIN60', format: 'number', decimals: 0 },
  { name: 'NMIN90', format: 'number', decimals: 0 },
  { name: 'NMIN_AS', format: 'flag' },
  { name: 'NMIN_AS_L', format: 'flag' },
];

/**
 * Either the Richtwert flag or measured layer values — never both: a planning
 * Nmin has no layers to file, a measurement is not a Richtwert.
 */
export function buildImpNmin(context: ImpNminBuildContext): ImpNminRow[] {
  const rows: ImpNminRow[] = [];

  for (const nmin of context.nminData) {
    const fieldIds = context.fieldIdentifiers.get(nmin.fieldId);
    const cropInfo = context.cultivationCropCodes.get(nmin.cultivationId);
    if (!fieldIds || !cropInfo) continue;

    const base = {
      BNR: context.betriebsnummer,
      FSTNR: fieldIds.fstnr,
      SNR: fieldIds.snr,
      EJAHR: context.year,
      DATUMF: cropInfo.datumf,
      FRUCHT: cropInfo.frucht,
    };
    if (nmin.useReferenceValue) {
      rows.push({ ...base, NMIN_RW: 'j' });
      continue;
    }
    const hasValues = [
      nmin.nmin030,
      nmin.nmin3060,
      nmin.nmin6090,
      nmin.nmin015,
      nmin.nmin1530,
    ].some((v) => v !== undefined);
    if (!hasValues) continue;
    rows.push({
      ...base,
      AADATUM: nmin.sampleDate
        ? formatBesydDateShort(nmin.sampleDate)
        : undefined,
      PROBE: nmin.probeNr,
      NMIN15: nmin.nmin015,
      NMIN16: nmin.nmin1530,
      NMIN30: nmin.nmin030,
      NMIN60: nmin.nmin3060,
      NMIN90: nmin.nmin6090,
    });
  }

  return rows;
}

export function serializeImpNminRow(row: ImpNminRow): string {
  return serializeBesydRow(IMPNMIN_COLUMNS, [
    row.BNR,
    row.FSTNR,
    row.SNR,
    row.EJAHR,
    row.DATUMF,
    row.FRUCHT,
    row.AADATUM,
    row.PROBE,
    row.LABOR15,
    row.NH415,
    row.NO315,
    row.LABOR16,
    row.NH416,
    row.NO316,
    row.LABOR30,
    row.NH430,
    row.NO330,
    row.LABOR60,
    row.NH460,
    row.NO360,
    row.LABOR90,
    row.NH490,
    row.NO390,
    row.NMIN_RW,
    row.NMIN15,
    row.NMIN16,
    row.NMIN30,
    row.NMIN60,
    row.NMIN90,
    row.NMIN_AS,
    row.NMIN_AS_L,
  ]);
}
