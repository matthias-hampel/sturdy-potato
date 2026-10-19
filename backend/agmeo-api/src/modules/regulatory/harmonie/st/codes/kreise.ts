/**
 * Anlage 3 — Landkreise / kreisfreie Städte of Sachsen-Anhalt (KreisNr also names the export files).
 *
 * Ported from agmeo `src/lib/federalExport/harmonie-export/st/codes/kreise.ts`.
 */
export const ST_KREISE: { nr: number; name: string }[] = [
  { nr: 1, name: 'Dessau-Roßlau' },
  { nr: 2, name: 'Halle' },
  { nr: 3, name: 'Magdeburg' },
  { nr: 81, name: 'Altmarkkreis Salzwedel' },
  { nr: 82, name: 'Anhalt-Bitterfeld' },
  { nr: 83, name: 'Börde' },
  { nr: 84, name: 'Burgenlandkreis' },
  { nr: 85, name: 'Harz' },
  { nr: 86, name: 'Jerichower Land' },
  { nr: 87, name: 'Mansfeld-Südharz' },
  { nr: 88, name: 'Saalekreis' },
  { nr: 89, name: 'Salzlandkreis' },
  { nr: 90, name: 'Stendal' },
  { nr: 91, name: 'Wittenberg' },
];

export function stKreisName(nr: number | undefined): string | undefined {
  return ST_KREISE.find((k) => k.nr === nr)?.name;
}
