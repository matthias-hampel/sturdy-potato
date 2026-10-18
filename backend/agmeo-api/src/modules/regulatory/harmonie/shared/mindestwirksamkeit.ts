/**
 * DüV Anlage 3 — Mindestwerte für die Ausnutzung des Stickstoffs aus
 * organischen Düngemitteln im Jahr des Aufbringens (in % des Gesamt-N),
 * as amended 01.02.2025. Feeds the Dube2.5 `verfuegbar-N` of the fertilizer
 * catalogue and the Anlage 5 Jahressumme.
 */

import type { OrganicGroup } from './fertilizerGroup.js';

export type Nutzungsart = 'ACKER' | 'GRUENLAND';

/** [Ackerland, Grünland] — identical for every group in the current Anlage 3, kept separate for future amendments. */
const MINDESTWIRKSAMKEIT: Partial<Record<OrganicGroup, [number, number]>> = {
  Rindergülle: [60, 60],
  Schweinegülle: [70, 70],
  Rinderjauche: [90, 90],
  Schweinejauche: [90, 90],
  Rindermist: [25, 25],
  Schweinemist: [30, 30],
  Pferdemist: [25, 25],
  Schafmist: [25, 25],
  Hähnchenmist: [30, 30],
  Putenmist: [30, 30],
  'Legehennen - HTK': [60, 60],
  Gärrest: [60, 60],
  Kompost: [5, 5],
  Klärschlamm: [25, 25],
};

export function mindestwirksamkeitPercent(
  group: OrganicGroup,
  nutzungsart: Nutzungsart,
): number | undefined {
  const entry = MINDESTWIRKSAMKEIT[group];
  return entry ? entry[nutzungsart === 'ACKER' ? 0 : 1] : undefined;
}
