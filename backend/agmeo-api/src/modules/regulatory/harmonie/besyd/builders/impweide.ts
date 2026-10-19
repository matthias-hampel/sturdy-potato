/** Ported from agmeo `src/lib/federalExport/harmonie-export/besyd/builders/impweide.ts`. */

import type { BesydColumn } from '../formatters.js';
import { formatBesydDateShort, serializeBesydRow } from '../formatters.js';
import type { ImpWeideBetriebRow, ImpWeideRow } from '../types.js';
import type { CropCodeInfo, FieldIdentifiers, GrazingData } from './types.js';

export type ImpWeideBuildContext = {
  betriebsnummer: string;
  year: number;
  fieldIdentifiers: Map<string, FieldIdentifiers>;
  cultivationCropCodes: Map<string, CropCodeInfo>;
  grazingData: GrazingData[];
};

const WEIDE_COLUMNS: readonly BesydColumn[] = [
  { name: 'AADATUM', format: 'date' },
  { name: 'MIGRUPPE', format: 'code' },
  { name: 'MICODE', format: 'code' },
  { name: 'MIBEZ', format: 'text' },
  { name: 'TIERZAHL', format: 'number', decimals: 1 },
  { name: 'WEIDET', format: 'number', decimals: 1 },
  { name: 'MI_N', format: 'number', decimals: 3 },
  { name: 'MI_P', format: 'number', decimals: 3 },
  { name: 'MI_P2O5', format: 'number', decimals: 3 },
  { name: 'NANRECHNUNG', format: 'number' },
  { name: 'PARKOR', format: 'text' },
];

export const IMPWEIDE_COLUMNS: readonly BesydColumn[] = [
  { name: 'BNR', format: 'text' },
  { name: 'FSTNR', format: 'text' },
  { name: 'SNR', format: 'text' },
  { name: 'EJAHR', format: 'number' },
  { name: 'DATUMF', format: 'date' },
  { name: 'FRUCHT', format: 'code' },
  ...WEIDE_COLUMNS,
];

export const IMPWEIDEBETRIEB_COLUMNS: readonly BesydColumn[] = [
  { name: 'BNR', format: 'text' },
  { name: 'EJAHR', format: 'number' },
  ...WEIDE_COLUMNS,
];

const P2O5_TO_P = 0.4364;

/** Nutrient input from grazing per Schlag (Tabelle 22/23 animal codes). Empty until grazing is recorded. */
export function buildImpWeide(context: ImpWeideBuildContext): ImpWeideRow[] {
  const rows: ImpWeideRow[] = [];
  for (const grazing of context.grazingData) {
    const fieldIds = context.fieldIdentifiers.get(grazing.fieldId);
    const cropInfo = context.cultivationCropCodes.get(grazing.cultivationId);
    if (!fieldIds || !cropInfo) continue;
    rows.push({
      BNR: context.betriebsnummer,
      FSTNR: fieldIds.fstnr,
      SNR: fieldIds.snr,
      EJAHR: context.year,
      DATUMF: cropInfo.datumf,
      FRUCHT: cropInfo.frucht,
      AADATUM: grazing.endDate
        ? formatBesydDateShort(grazing.endDate)
        : undefined,
      MIGRUPPE: grazing.animalGroup,
      MICODE: grazing.animalCode,
      MIBEZ: grazing.animalName.substring(0, 120),
      TIERZAHL: grazing.animals,
      WEIDET: grazing.days,
      MI_N: grazing.nKgPerAnimalDay,
      MI_P:
        grazing.p2o5KgPerAnimalDay === undefined
          ? undefined
          : grazing.p2o5KgPerAnimalDay * P2O5_TO_P,
      MI_P2O5: grazing.p2o5KgPerAnimalDay,
    });
  }
  return rows;
}

/** Farm total per animal type: animal-days summed, contents from the first row. */
export function buildImpWeideBetrieb(
  betriebsnummer: string,
  year: number,
  weideRows: ImpWeideRow[],
): ImpWeideBetriebRow[] {
  const grouped = new Map<string, ImpWeideBetriebRow>();
  for (const row of weideRows) {
    const key = `${row.MIGRUPPE}:${row.MICODE}:${row.MIBEZ}`;
    const existing = grouped.get(key);
    if (!existing) {
      const { FSTNR: _f, SNR: _s, DATUMF: _d, FRUCHT: _c, ...rest } = row;
      grouped.set(key, { ...rest, BNR: betriebsnummer, EJAHR: year });
      continue;
    }
    existing.TIERZAHL = (existing.TIERZAHL ?? 0) + (row.TIERZAHL ?? 0);
    existing.WEIDET = Math.max(existing.WEIDET ?? 0, row.WEIDET ?? 0);
    if (row.AADATUM && (!existing.AADATUM || row.AADATUM > existing.AADATUM))
      existing.AADATUM = row.AADATUM;
  }
  return [...grouped.values()];
}

const weideCells = (row: ImpWeideBetriebRow) => [
  row.AADATUM,
  row.MIGRUPPE,
  row.MICODE,
  row.MIBEZ,
  row.TIERZAHL,
  row.WEIDET,
  row.MI_N,
  row.MI_P,
  row.MI_P2O5,
  row.NANRECHNUNG,
  row.PARKOR,
];

export function serializeImpWeideRow(row: ImpWeideRow): string {
  return serializeBesydRow(IMPWEIDE_COLUMNS, [
    row.BNR,
    row.FSTNR,
    row.SNR,
    row.EJAHR,
    row.DATUMF,
    row.FRUCHT,
    ...weideCells(row),
  ]);
}

export function serializeImpWeideBetriebRow(row: ImpWeideBetriebRow): string {
  return serializeBesydRow(IMPWEIDEBETRIEB_COLUMNS, [
    row.BNR,
    row.EJAHR,
    ...weideCells(row),
  ]);
}
