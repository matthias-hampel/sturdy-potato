/**
 * Dube2.5 `n-170-begrenzung` from the exported fields plus the farm data the
 * user entered for the Düngejahr (livestock, manure transfers, biogas plant).
 * Stable balances (`stallbilanzen`) need excretion tables and are left to the
 * authority's program.
 */

import type { ExportData } from '../types.js';
import { formatExportDecimal } from '../utils.js';
import { isGrasslandCrop } from './fruchtklasse.js';
import type {
  N170Betriebsdaten,
  N170Tierhaltung,
  N170Transfer,
} from './n170Types.js';

export type N170Model = {
  flaechen: {
    'flaeche-ackerbau': string;
    'flaeche-gruenland': string;
    'flaeche-gartenbau': string;
    'flaechensumme-n-170': string;
  };
  tierhaltungen: N170Tierhaltung[];
  organischeDuengerAufnahmen: N170Transfer[];
  organischeDuengerAbgaben: N170Transfer[];
  hofeigeneBiogasanlage: boolean | undefined;
};

/** `gartenbauFieldIds` — fields the dialect's crop catalogue classifies as horticulture. */
export function buildN170(
  data: ExportData,
  betriebsdaten?: N170Betriebsdaten,
  gartenbauFieldIds: ReadonlySet<string> = new Set(),
): N170Model {
  let acker = 0;
  let gruenland = 0;
  let gartenbau = 0;
  for (const field of data.fields) {
    if (field.cultivations.length === 0) continue;
    if (field.cultivations.some((c) => isGrasslandCrop(c.crop)))
      gruenland += field.areaInHa;
    else if (gartenbauFieldIds.has(field.id)) gartenbau += field.areaInHa;
    else acker += field.areaInHa;
  }

  return {
    flaechen: {
      'flaeche-ackerbau': formatExportDecimal(acker, 4),
      'flaeche-gruenland': formatExportDecimal(gruenland, 4),
      'flaeche-gartenbau': formatExportDecimal(gartenbau, 4),
      'flaechensumme-n-170': formatExportDecimal(
        acker + gruenland + gartenbau,
        4,
      ),
    },
    tierhaltungen: betriebsdaten?.tierhaltungen ?? [],
    organischeDuengerAufnahmen: betriebsdaten?.organischeDuengerAufnahmen ?? [],
    organischeDuengerAbgaben: betriebsdaten?.organischeDuengerAbgaben ?? [],
    hofeigeneBiogasanlage: betriebsdaten?.hofeigeneBiogasanlage,
  };
}

export function getN170Betriebsdaten(
  data: ExportData,
): N170Betriebsdaten | undefined {
  return data.integrations.n170?.[String(data.year)];
}
