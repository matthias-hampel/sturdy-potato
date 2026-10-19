/** Ported from agmeo `src/lib/federalExport/harmonie-export/besyd/preflight.ts`. */

import { detectBundeslandFromBnr } from './defaults.js';
import { BESYD_FRUCHTART_CATALOGUE } from './fruchtartCodes.js';
import {
  BODEN_KLIMA_RAUM_CODES,
  getBodenKlimaRaumByBundesland,
} from './referenzCodes.js';

export { runBesydPreflightRules as runBesydPreflight } from '../shared/preflight/index.js';

export function getBkrOptionsForBnr(
  bnr: string | undefined,
): { value: string; label: string }[] {
  const bundesland = bnr ? detectBundeslandFromBnr(bnr) : null;
  const bkrList = bundesland
    ? getBodenKlimaRaumByBundesland(bundesland)
    : BODEN_KLIMA_RAUM_CODES;
  return bkrList.map((bkr) => ({
    value: bkr.code,
    label: `${bkr.code} - ${bkr.name}`,
  }));
}

export function getCropCodeOptions(): {
  value: string;
  label: string;
  category: string;
}[] {
  return BESYD_FRUCHTART_CATALOGUE.map((f) => ({
    value: f.code,
    label: `${f.code} - ${f.bezeichnung}`,
    category: f.category,
  }));
}
