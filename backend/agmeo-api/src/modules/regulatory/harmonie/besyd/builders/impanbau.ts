/** Ported from agmeo `src/lib/federalExport/harmonie-export/besyd/builders/impanbau.ts`. */

import type { BesydColumn } from '../formatters.js';
import { formatBesydDateShort, serializeBesydRow } from '../formatters.js';
import { getBesydFruchtart } from '../fruchtartCodes.js';
import type { ImpAnbauRow } from '../types.js';
import type { CultivationData, FieldData, FieldIdentifiers } from './types.js';

export type ImpAnbauBuildContext = {
  betriebsnummer: string;
  year: number;
  fields: FieldData[];
  fieldIdentifiers: Map<string, FieldIdentifiers>;
  cultivations: CultivationData[];
  cropCodeOverrides?: Record<string, string>;
};

/** The spec names the Nebenprodukt column twice (Vorfrucht, Frucht); the row keeps them as NP / NP2. */
export const IMPANBAU_COLUMNS: readonly BesydColumn[] = [
  { name: 'BNR', format: 'text' },
  { name: 'FSTNR', format: 'text' },
  { name: 'SNR', format: 'text' },
  { name: 'EJAHR', format: 'number' },
  { name: 'SNAME', format: 'text' },
  { name: 'FLHA', format: 'number', decimals: 2 },
  { name: 'FELDBLOCK', format: 'text' },
  { name: 'AZ', format: 'number', decimals: 0 },
  { name: 'BCODE', format: 'code' },
  { name: 'ECODE', format: 'code' },
  { name: 'BOTI', format: 'number', decimals: 0 },
  { name: 'HNN', format: 'number', decimals: 0 },
  { name: 'STK', format: 'number', decimals: 0 },
  { name: 'WSGCODE', format: 'code' },
  { name: 'BKR_NR', format: 'code' },
  { name: 'HUMUS_EINST', format: 'code' },
  { name: 'DATUMVF', format: 'date' },
  { name: 'VFRUCHT', format: 'code' },
  { name: 'VKZBRACHE', format: 'flag' },
  { name: 'ERTRAGHP', format: 'number', decimals: 1 },
  { name: 'NP', format: 'code' },
  { name: 'DATUMF', format: 'date' },
  { name: 'FRUCHT', format: 'code' },
  { name: 'KZBRACHE', format: 'flag' },
  { name: 'ERTZIEL', format: 'number', decimals: 1 },
  { name: 'ERTZIEL_TM', format: 'number', decimals: 1 },
  { name: 'ROHPROT_TM', format: 'number', decimals: 1 },
  { name: 'SCHNITTE', format: 'number', decimals: 0 },
  { name: 'WEIDEANT', format: 'number', decimals: 0 },
  { name: 'LEGUMANT', format: 'number', decimals: 0 },
  { name: 'FOLIE', format: 'flag' },
  { name: 'VWCODE', format: 'code' },
  { name: 'BERECODE', format: 'code' },
  { name: 'STABINDG', format: 'flag' },
  { name: 'AACODE', format: 'code' },
  { name: 'EC', format: 'number', decimals: 0 },
  { name: 'PDICHTE', format: 'code' },
  { name: 'VEGBEGIN', format: 'date' },
  { name: 'BLATTVERL', format: 'flag' },
  { name: 'SPROSS_FM', format: 'number', decimals: 2 },
  { name: 'NITRATGEB1', format: 'flag' },
  { name: 'ZWEITFRUCHT', format: 'flag' },
  { name: 'STABINDG100', format: 'flag' },
  { name: 'NP', format: 'code' },
  { name: 'ZW_ABGEFR', format: 'text' },
];

export function buildImpAnbau(context: ImpAnbauBuildContext): ImpAnbauRow[] {
  const rows: ImpAnbauRow[] = [];

  for (const cultivation of context.cultivations) {
    const field = context.fields.find((f) => f.id === cultivation.fieldId);
    const ids = context.fieldIdentifiers.get(cultivation.fieldId);
    if (!field || !ids) continue;

    const cropInfo = getBesydFruchtart(
      cultivation.crop,
      context.cropCodeOverrides,
    );
    if (!cropInfo) continue;

    const previousCropInfo = cultivation.previousCrop
      ? getBesydFruchtart(cultivation.previousCrop, context.cropCodeOverrides)
      : undefined;

    rows.push({
      BNR: context.betriebsnummer,
      FSTNR: ids.fstnr,
      SNR: ids.snr,
      EJAHR: context.year,
      SNAME: field.name.substring(0, 30),
      FLHA: cultivation.areaInHa,
      FELDBLOCK: field.flik,
      // Pflichtfelder — never substituted by the current crop; the preflight blocks a missing Vorfrucht.
      DATUMVF: formatBesydDateShort(cultivation.previousCropSowingDate),
      VFRUCHT: previousCropInfo?.code ?? '',
      ERTRAGHP: cultivation.previousCropYield,
      DATUMF: formatBesydDateShort(cultivation.sowingDate),
      FRUCHT: cropInfo.code,
      ERTZIEL: cultivation.expectedYield,
      BCODE: field.bodenart,
      ROHPROT_TM: cultivation.rawProteinPercent,
      SCHNITTE: cultivation.cuts,
      WEIDEANT: cultivation.grazingSharePercent,
      FOLIE: cultivation.filmOrFleece ? 'j' : undefined,
      NITRATGEB1:
        field.nitrateSensitiveZone === undefined
          ? undefined
          : field.nitrateSensitiveZone
            ? 'j'
            : 'n',
      ZWEITFRUCHT:
        cultivation.isSecondCrop === undefined
          ? undefined
          : cultivation.isSecondCrop
            ? 'j'
            : 'n',
    });
  }

  return rows;
}

export function serializeImpAnbauRow(row: ImpAnbauRow): string {
  return serializeBesydRow(IMPANBAU_COLUMNS, [
    row.BNR,
    row.FSTNR,
    row.SNR,
    row.EJAHR,
    row.SNAME,
    row.FLHA,
    row.FELDBLOCK,
    row.AZ,
    row.BCODE,
    row.ECODE,
    row.BOTI,
    row.HNN,
    row.STK,
    row.WSGCODE,
    row.BKR_NR,
    row.HUMUS_EINST,
    row.DATUMVF,
    row.VFRUCHT,
    row.VKZBRACHE,
    row.ERTRAGHP,
    row.NP,
    row.DATUMF,
    row.FRUCHT,
    row.KZBRACHE,
    row.ERTZIEL,
    row.ERTZIEL_TM,
    row.ROHPROT_TM,
    row.SCHNITTE,
    row.WEIDEANT,
    row.LEGUMANT,
    row.FOLIE,
    row.VWCODE,
    row.BERECODE,
    row.STABINDG,
    row.AACODE,
    row.EC,
    row.PDICHTE,
    row.VEGBEGIN,
    row.BLATTVERL,
    row.SPROSS_FM,
    row.NITRATGEB1,
    row.ZWEITFRUCHT,
    row.STABINDG100,
    row.NP2,
    row.ZW_ABGEFR,
  ]);
}
