/**
 * Anlage 2 — ZUORDNUNG (DüV Anlage 5 class) and KATEGORIE of an applied
 * fertilizer, derived from the shared fertilizer groups.
 *
 * Ported from agmeo `src/lib/federalExport/harmonie-export/st/codes/anlage2.ts`.
 */

import type {
  MineralGroup,
  OrganicGroup,
} from '../../shared/fertilizerGroup.js';
import { mineralGroup, organicGroup } from '../../shared/fertilizerGroup.js';
import type { ExportFertilization } from '../../types.js';

export type StZuordnung = {
  zuordnung: string;
  kategorie: string;
};

const WIRTSCHAFTSDUENGER = 'Wirtschaftsdünger tierischer Herkunft';
const SONSTIGE_ORGANISCHE = 'Sonstige organische Düngemittel';
const MINERALISCHE = 'Mineralische Düngemittel';

const ORGANIC_KATEGORIE: Record<OrganicGroup, StZuordnung> = {
  Rindergülle: { zuordnung: WIRTSCHAFTSDUENGER, kategorie: 'Gülle Rind' },
  Schweinegülle: { zuordnung: WIRTSCHAFTSDUENGER, kategorie: 'Gülle Schwein' },
  Rindermist: { zuordnung: WIRTSCHAFTSDUENGER, kategorie: 'Festmist Rind' },
  Schweinemist: {
    zuordnung: WIRTSCHAFTSDUENGER,
    kategorie: 'Festmist Schwein',
  },
  Hähnchenmist: {
    zuordnung: WIRTSCHAFTSDUENGER,
    kategorie: 'Festmist Geflügel',
  },
  Putenmist: { zuordnung: WIRTSCHAFTSDUENGER, kategorie: 'Festmist Geflügel' },
  Pferdemist: {
    zuordnung: WIRTSCHAFTSDUENGER,
    kategorie: 'Festmist Andere (z. B. Pferde, Schafe, Ziegen)',
  },
  Schafmist: {
    zuordnung: WIRTSCHAFTSDUENGER,
    kategorie: 'Festmist Andere (z. B. Pferde, Schafe, Ziegen)',
  },
  Rinderjauche: { zuordnung: WIRTSCHAFTSDUENGER, kategorie: 'Jauche Rind' },
  Schweinejauche: {
    zuordnung: WIRTSCHAFTSDUENGER,
    kategorie: 'Jauche Schwein',
  },
  'Legehennen - HTK': {
    zuordnung: WIRTSCHAFTSDUENGER,
    kategorie: 'Geflügelkot (trocken)',
  },
  Gärrest: {
    zuordnung: SONSTIGE_ORGANISCHE,
    kategorie: 'Gärrückstände (flüssig) sonstige',
  },
  Kompost: { zuordnung: SONSTIGE_ORGANISCHE, kategorie: 'sonstige Komposte' },
  Klärschlamm: {
    zuordnung: SONSTIGE_ORGANISCHE,
    kategorie: 'Klärschlamm flüssig',
  },
  'Sonstiger organischer Dünger': {
    zuordnung: SONSTIGE_ORGANISCHE,
    kategorie: 'alle anderen organischen Düngemittel',
  },
};

const MINERAL_KATEGORIE: Record<MineralGroup, string> = {
  N: 'N-Dünger',
  S: 'N-Dünger',
  P: 'P-Dünger',
  NP: 'Mehrnährstoffdünger',
  NK: 'Mehrnährstoffdünger',
  NPK: 'Mehrnährstoffdünger',
  PK: 'Mehrnährstoffdünger',
  K: 'Mehrnährstoffdünger',
  Mg: 'Mehrnährstoffdünger',
  Kalk: 'Mehrnährstoffdünger',
  NMg: 'Mehrnährstoffdünger',
};

export function stZuordnung(fert: ExportFertilization): StZuordnung {
  if (fert.naehrstofftraegerart === 'MINERALDUENGER') {
    return {
      zuordnung: MINERALISCHE,
      kategorie: MINERAL_KATEGORIE[mineralGroup(fert)],
    };
  }
  if (fert.naehrstofftraegerart === 'SONSTIGE') {
    return {
      zuordnung: SONSTIGE_ORGANISCHE,
      kategorie: 'alle anderen organischen Düngemittel',
    };
  }
  return ORGANIC_KATEGORIE[organicGroup(fert.articleFqn)];
}
