/** Ported from agmeo `src/lib/federalExport/harmonie-export/besyd/builders/imporg.ts`. */

import type { BesydColumn } from '../formatters.js';
import { formatBesydDateShort, serializeBesydRow } from '../formatters.js';
import type { ImpOrgRow } from '../types.js';
import type {
  CropCodeInfo,
  FieldIdentifiers,
  OrganicFertilizationData,
} from './types.js';

export type ImpOrgBuildContext = {
  betriebsnummer: string;
  year: number;
  fieldIdentifiers: Map<string, FieldIdentifiers>;
  cultivationCropCodes: Map<string, CropCodeInfo>;
  organicFertilizations: OrganicFertilizationData[];
};

export const IMPORG_COLUMNS: readonly BesydColumn[] = [
  { name: 'BNR', format: 'text' },
  { name: 'FSTNR', format: 'text' },
  { name: 'SNR', format: 'text' },
  { name: 'EJAHR', format: 'number' },
  { name: 'DATUMF', format: 'date' },
  { name: 'FRUCHT', format: 'code' },
  { name: 'AADATUM', format: 'date' },
  { name: 'MICODE', format: 'code' },
  { name: 'MIBEZ', format: 'text' },
  { name: 'FAORGNP', format: 'code' },
  { name: 'MENGE', format: 'number', decimals: 1 },
  { name: 'MITS', format: 'number', decimals: 1 },
  { name: 'MI_N', format: 'number', decimals: 2 },
  { name: 'MI_NH4', format: 'number', decimals: 2 },
  { name: 'MI_P', format: 'number', decimals: 2 },
  { name: 'MI_K', format: 'number', decimals: 2 },
  { name: 'MI_MG', format: 'number', decimals: 2 },
  { name: 'MI_S', format: 'number', decimals: 2 },
  { name: 'ZW_ABGEFR', format: 'flag' },
  { name: 'MI_P2O5', format: 'number', decimals: 2 },
  { name: 'PARKOR', format: 'text' },
  { name: 'MINDESTWIRKSAMKEIT', format: 'number', decimals: 0 },
  { name: 'MENGEGESAMT', format: 'number', decimals: 1 },
  { name: 'ZUFUHR', format: 'text' },
];

export function buildImpOrg(context: ImpOrgBuildContext): ImpOrgRow[] {
  const rows: ImpOrgRow[] = [];

  for (const fert of context.organicFertilizations) {
    const fieldIds = context.fieldIdentifiers.get(fert.fieldId);
    const cropInfo = context.cultivationCropCodes.get(fert.cultivationId);
    if (!fieldIds || !cropInfo) continue;

    rows.push({
      BNR: context.betriebsnummer,
      FSTNR: fieldIds.fstnr,
      SNR: fieldIds.snr,
      EJAHR: context.year,
      DATUMF: cropInfo.datumf,
      FRUCHT: cropInfo.frucht,
      AADATUM: fert.applicationDate
        ? formatBesydDateShort(fert.applicationDate)
        : undefined,
      MICODE: fert.fertilizerCode,
      MIBEZ: fert.fertilizerName?.substring(0, 40),
      MENGE: fert.amountPerHa,
      MITS: fert.dryMatterPercent,
      MI_N: fert.nPercent,
      MI_NH4: fert.nh4Percent,
      MI_P: fert.pPercent,
      MI_K: fert.kPercent,
      MI_MG: fert.mgPercent,
      MI_S: fert.sPercent,
      MI_P2O5: fert.p2o5Percent,
      MINDESTWIRKSAMKEIT: fert.mindestwirksamkeitPercent,
      MENGEGESAMT: fert.totalAmount,
    });
  }

  return rows;
}

export function serializeImpOrgRow(row: ImpOrgRow): string {
  return serializeBesydRow(IMPORG_COLUMNS, [
    row.BNR,
    row.FSTNR,
    row.SNR,
    row.EJAHR,
    row.DATUMF,
    row.FRUCHT,
    row.AADATUM,
    row.MICODE,
    row.MIBEZ,
    row.FAORGNP,
    row.MENGE,
    row.MITS,
    row.MI_N,
    row.MI_NH4,
    row.MI_P,
    row.MI_K,
    row.MI_MG,
    row.MI_S,
    row.ZW_ABGEFR,
    row.MI_P2O5,
    row.PARKOR,
    row.MINDESTWIRKSAMKEIT,
    row.MENGEGESAMT,
    row.ZUFUHR,
  ]);
}
