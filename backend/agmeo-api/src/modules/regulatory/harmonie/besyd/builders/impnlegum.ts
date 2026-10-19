/** Ported from agmeo `src/lib/federalExport/harmonie-export/besyd/builders/impnlegum.ts`. */

import type { BesydColumn } from '../formatters.js';
import { formatBesydDateShort, serializeBesydRow } from '../formatters.js';
import type { ImpNlegumRow } from '../types.js';
import type { CropCodeInfo, FieldIdentifiers, LegumeData } from './types.js';

export type ImpNlegumBuildContext = {
  betriebsnummer: string;
  year: number;
  fieldIdentifiers: Map<string, FieldIdentifiers>;
  cultivationCropCodes: Map<string, CropCodeInfo>;
  legumeData: LegumeData[];
};

export const IMPNLEGUM_COLUMNS: readonly BesydColumn[] = [
  { name: 'BNR', format: 'text' },
  { name: 'FSTNR', format: 'text' },
  { name: 'SNR', format: 'text' },
  { name: 'EJAHR', format: 'number' },
  { name: 'DATUMF', format: 'date' },
  { name: 'FRUCHT', format: 'code' },
  { name: 'AADATUM', format: 'date' },
  { name: 'MICODE', format: 'code' },
  { name: 'MIBEZ', format: 'text' },
  { name: 'MENGE', format: 'number', decimals: 1 },
  { name: 'MENGEGESAMT', format: 'number', decimals: 1 },
  { name: 'MI_NBINDUNG', format: 'number', decimals: 2 },
  { name: 'PARKOR', format: 'text' },
];

/** BESyD Tabelle 21 legume codes for the agmeo legume crops. */
const LEGUME_MAPPING: Record<string, string> = {
  peasDry: '0301',
  peasDryFodder: '0301',
  winterPeas: '0301',
  broadBeans: '0304',
  winterBroadBeans: '0304',
  soybeanBeans: '0308',
  lupine: '0307',
  lentils: '0311',
  vetch: '0305',
  alfalfa: '1023',
  alfalfaGrass: '1027',
  clover: '1001',
  cloverGrass: '1008',
  cloverGrassUndersow: '1008',
  persianCloverIntercrop: '1006',
  alexandrineCloverIntercrop: '1009',
  crimsonCloverIntercrop: '1003',
  vetchIntercrop: '2002',
  serradellaIntercrop: '2002',
};

export function getLegumeCode(cropName: string): string | undefined {
  return LEGUME_MAPPING[cropName];
}

export function buildImpNlegum(context: ImpNlegumBuildContext): ImpNlegumRow[] {
  const rows: ImpNlegumRow[] = [];

  for (const legume of context.legumeData) {
    const fieldIds = context.fieldIdentifiers.get(legume.fieldId);
    const cropInfo = context.cultivationCropCodes.get(legume.cultivationId);
    if (!fieldIds || !cropInfo || !legume.legumeCode) continue;

    rows.push({
      BNR: context.betriebsnummer,
      FSTNR: fieldIds.fstnr,
      SNR: fieldIds.snr,
      EJAHR: context.year,
      DATUMF: cropInfo.datumf,
      FRUCHT: cropInfo.frucht,
      AADATUM: legume.harvestDate
        ? formatBesydDateShort(legume.harvestDate)
        : undefined,
      MICODE: legume.legumeCode,
      MIBEZ: legume.legumeName?.substring(0, 40),
      MENGE: legume.yieldDtPerHa,
      MENGEGESAMT: legume.totalYieldDt,
      MI_NBINDUNG: legume.nFixationKgPerDt,
    });
  }

  return rows;
}

export function serializeImpNlegumRow(row: ImpNlegumRow): string {
  return serializeBesydRow(IMPNLEGUM_COLUMNS, [
    row.BNR,
    row.FSTNR,
    row.SNR,
    row.EJAHR,
    row.DATUMF,
    row.FRUCHT,
    row.AADATUM,
    row.MICODE,
    row.MIBEZ,
    row.MENGE,
    row.MENGEGESAMT,
    row.MI_NBINDUNG,
    row.PARKOR,
  ]);
}
