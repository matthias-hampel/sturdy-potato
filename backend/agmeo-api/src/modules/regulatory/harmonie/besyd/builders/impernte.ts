/** Ported from agmeo `src/lib/federalExport/harmonie-export/besyd/builders/impernte.ts`. */

import type { BesydColumn } from '../formatters.js';
import { formatBesydDateShort, serializeBesydRow } from '../formatters.js';
import type { ImpErnteRow } from '../types.js';
import type { CropCodeInfo, FieldIdentifiers, HarvestData } from './types.js';

export type ImpErnteBuildContext = {
  betriebsnummer: string;
  year: number;
  fieldIdentifiers: Map<string, FieldIdentifiers>;
  cultivationCropCodes: Map<string, CropCodeInfo>;
  harvestData: HarvestData[];
};

export const IMPERNTE_COLUMNS: readonly BesydColumn[] = [
  { name: 'BNR', format: 'text' },
  { name: 'FSTNR', format: 'text' },
  { name: 'SNR', format: 'text' },
  { name: 'EJAHR', format: 'number' },
  { name: 'DATUMF', format: 'date' },
  { name: 'FRUCHT', format: 'code' },
  { name: 'ERNTEDAT', format: 'date' },
  { name: 'MIBEZ', format: 'text' },
  { name: 'ERTRAGHP', format: 'number', decimals: 1 },
  { name: 'VERWENHP', format: 'code' },
  { name: 'ERTWEIDE', format: 'number', decimals: 1 },
  { name: 'ERTRAGNP', format: 'number', decimals: 1 },
  { name: 'VERWENNP', format: 'code' },
  { name: 'ANTLEG', format: 'number', decimals: 0 },
  { name: 'FAN', format: 'number', decimals: 2 },
  { name: 'FAN_NP', format: 'number', decimals: 2 },
  { name: 'FAP', format: 'number', decimals: 2 },
  { name: 'FAP_NP', format: 'number', decimals: 2 },
  { name: 'FAK', format: 'number', decimals: 2 },
  { name: 'FAK_NP', format: 'number', decimals: 2 },
  { name: 'FAMG', format: 'number', decimals: 2 },
  { name: 'FAMG_NP', format: 'number', decimals: 2 },
  { name: 'FAS', format: 'number', decimals: 2 },
  { name: 'FAS_NP', format: 'number', decimals: 2 },
  { name: 'GEWI_NP', format: 'number', decimals: 1 },
  { name: 'FAN_HP', format: 'number', decimals: 2 },
  { name: 'FAP_HP', format: 'number', decimals: 2 },
  { name: 'FAK_HP', format: 'number', decimals: 2 },
  { name: 'FAMG_HP', format: 'number', decimals: 2 },
  { name: 'FAS_HP', format: 'number', decimals: 2 },
  { name: 'RP', format: 'number', decimals: 1 },
  { name: 'TSHP', format: 'number', decimals: 1 },
  { name: 'TSNP', format: 'number', decimals: 1 },
  { name: 'PARKOR', format: 'text' },
];

export function buildImpErnte(context: ImpErnteBuildContext): ImpErnteRow[] {
  const rows: ImpErnteRow[] = [];

  for (const harvest of context.harvestData) {
    const fieldIds = context.fieldIdentifiers.get(harvest.fieldId);
    const cropInfo = context.cultivationCropCodes.get(harvest.cultivationId);
    if (!fieldIds || !cropInfo || !harvest.yieldMainProductDtPerHa) continue;

    rows.push({
      BNR: context.betriebsnummer,
      FSTNR: fieldIds.fstnr,
      SNR: fieldIds.snr,
      EJAHR: context.year,
      DATUMF: cropInfo.datumf,
      FRUCHT: cropInfo.frucht,
      ERNTEDAT: formatBesydDateShort(harvest.harvestDate),
      MIBEZ: harvest.cropName?.substring(0, 100),
      ERTRAGHP: harvest.yieldMainProductDtPerHa,
      VERWENHP: harvest.usageMainProduct,
      ERTWEIDE: harvest.yieldGrazingDtPerHa,
      ERTRAGNP: harvest.yieldByProductDtPerHa,
      VERWENNP: harvest.usageByProduct,
      ANTLEG: harvest.legumeSharePercent,
      FAN: harvest.nRemovalTotal,
      FAN_NP: harvest.nRemovalByProduct,
      FAP: harvest.pRemovalTotal,
      FAP_NP: harvest.pRemovalByProduct,
      FAK: harvest.kRemovalTotal,
      FAK_NP: harvest.kRemovalByProduct,
      FAMG: harvest.mgRemovalTotal,
      FAMG_NP: harvest.mgRemovalByProduct,
      FAS: harvest.sRemovalTotal,
      FAS_NP: harvest.sRemovalByProduct,
      GEWI_NP: harvest.mainToByProductRatio,
      FAN_HP: harvest.nRemovalMainProduct,
      FAP_HP: harvest.pRemovalMainProduct,
      FAK_HP: harvest.kRemovalMainProduct,
      FAMG_HP: harvest.mgRemovalMainProduct,
      FAS_HP: harvest.sRemovalMainProduct,
      RP: harvest.rawProteinPercent,
      TSHP: harvest.dryMatterMainPercent,
      TSNP: harvest.dryMatterByProductPercent,
    });
  }

  return rows;
}

export function serializeImpErnteRow(row: ImpErnteRow): string {
  return serializeBesydRow(IMPERNTE_COLUMNS, [
    row.BNR,
    row.FSTNR,
    row.SNR,
    row.EJAHR,
    row.DATUMF,
    row.FRUCHT,
    row.ERNTEDAT,
    row.MIBEZ,
    row.ERTRAGHP,
    row.VERWENHP,
    row.ERTWEIDE,
    row.ERTRAGNP,
    row.VERWENNP,
    row.ANTLEG,
    row.FAN,
    row.FAN_NP,
    row.FAP,
    row.FAP_NP,
    row.FAK,
    row.FAK_NP,
    row.FAMG,
    row.FAMG_NP,
    row.FAS,
    row.FAS_NP,
    row.GEWI_NP,
    row.FAN_HP,
    row.FAP_HP,
    row.FAK_HP,
    row.FAMG_HP,
    row.FAS_HP,
    row.RP,
    row.TSHP,
    row.TSNP,
    row.PARKOR,
  ]);
}
