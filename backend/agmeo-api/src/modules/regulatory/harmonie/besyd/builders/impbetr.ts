/** Ported from agmeo `src/lib/federalExport/harmonie-export/besyd/builders/impbetr.ts`. */

import { getEffectiveBesydMetadata } from '../defaults.js';
import type { BesydColumn } from '../formatters.js';
import { serializeBesydRow } from '../formatters.js';
import type { BesydOrgMetadata, ImpBetrRow } from '../types.js';

export const IMPBETR_COLUMNS: readonly BesydColumn[] = [
  { name: 'BNR', format: 'code' },
  { name: 'BNAME', format: 'text' },
  { name: 'PLZ', format: 'text' },
  { name: 'ORT', format: 'text' },
  { name: 'STR', format: 'text' },
  { name: 'AMTCODEN', format: 'code' },
  { name: 'BFCODE', format: 'code' },
  { name: 'BKR_NR', format: 'code' },
  { name: 'EMAIL', format: 'text' },
];

export function buildImpBetr(metadata?: BesydOrgMetadata): ImpBetrRow[] {
  const effective = getEffectiveBesydMetadata(metadata);
  return [
    {
      BNR: effective.betriebsnummer,
      BNAME: effective.firma?.substring(0, 60),
      PLZ: effective.plz,
      ORT: effective.ort?.substring(0, 100),
      STR: effective.strasse?.substring(0, 30),
      AMTCODEN: effective.amt,
      BFCODE: effective.berechnungsgrundlage,
      BKR_NR: effective.bodenklimaraum,
      EMAIL: effective.email?.substring(0, 100),
    },
  ];
}

export function serializeImpBetrRow(row: ImpBetrRow): string {
  return serializeBesydRow(IMPBETR_COLUMNS, [
    row.BNR,
    row.BNAME,
    row.PLZ,
    row.ORT,
    row.STR,
    row.AMTCODEN,
    row.BFCODE,
    row.BKR_NR,
    row.EMAIL,
  ]);
}
