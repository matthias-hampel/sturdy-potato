/** Ported from agmeo `src/lib/federalExport/harmonie-export/besyd/builders/impmind.ts`. */

import {
  MINERAL_GROUP_TO_BESYD,
  mineralGroup,
} from '../../shared/fertilizerGroup.js';
import type { BesydColumn } from '../formatters.js';
import { formatBesydDateShort, serializeBesydRow } from '../formatters.js';
import { mineralReferenceIdForName } from '../referenzCodes.js';
import type { ImpMindRow } from '../types.js';
import type {
  CropCodeInfo,
  FieldIdentifiers,
  MineralFertilizationData,
} from './types.js';

export type ImpMindBuildContext = {
  betriebsnummer: string;
  year: number;
  fieldIdentifiers: Map<string, FieldIdentifiers>;
  cultivationCropCodes: Map<string, CropCodeInfo>;
  mineralFertilizations: MineralFertilizationData[];
};

export const IMPMIND_COLUMNS: readonly BesydColumn[] = [
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
  { name: 'MI_N', format: 'number', decimals: 1 },
  { name: 'MI_P', format: 'number', decimals: 1 },
  { name: 'MI_K', format: 'number', decimals: 1 },
  { name: 'MI_MG', format: 'number', decimals: 1 },
  { name: 'MI_CAO', format: 'number', decimals: 1 },
  { name: 'MI_S', format: 'number', decimals: 1 },
  { name: 'MI_P2O5', format: 'number', decimals: 1 },
  { name: 'PARKOR', format: 'text' },
  { name: 'MENGEGESAMT', format: 'number', decimals: 1 },
  // "ID (Ganzzahl)" per the spec — the one Tabelle reference written as a number.
  { name: 'REFERENCE_ID', format: 'number', decimals: 0 },
];

function inferFertilizerGroupCode(fert: MineralFertilizationData): string {
  if ((fert.caoPercent ?? 0) > 30) return '190';
  return MINERAL_GROUP_TO_BESYD[
    mineralGroup({
      n: fert.nPercent ?? null,
      p2o5: fert.p2o5Percent ?? fert.pPercent ?? null,
      k2o: fert.kPercent ?? null,
      mgo: fert.mgPercent ?? null,
      articleFqn: fert.fertilizerName ?? '',
    })
  ];
}

export function buildImpMind(context: ImpMindBuildContext): ImpMindRow[] {
  const rows: ImpMindRow[] = [];

  for (const fert of context.mineralFertilizations) {
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
      MICODE: fert.fertilizerGroupCode || inferFertilizerGroupCode(fert),
      MIBEZ: fert.fertilizerName?.substring(0, 40),
      MENGE: fert.amountPerHa,
      MI_N: fert.nPercent,
      MI_P: fert.pPercent,
      MI_K: fert.kPercent,
      MI_MG: fert.mgPercent,
      MI_CAO: fert.caoPercent,
      MI_S: fert.sPercent,
      MI_P2O5: fert.p2o5Percent,
      MENGEGESAMT: fert.totalAmount,
      REFERENCE_ID:
        fert.referenceId ?? mineralReferenceIdForName(fert.fertilizerName),
    });
  }

  return rows;
}

export function serializeImpMindRow(row: ImpMindRow): string {
  return serializeBesydRow(IMPMIND_COLUMNS, [
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
    row.MI_N,
    row.MI_P,
    row.MI_K,
    row.MI_MG,
    row.MI_CAO,
    row.MI_S,
    row.MI_P2O5,
    row.PARKOR,
    row.MENGEGESAMT,
    row.REFERENCE_ID,
  ]);
}
