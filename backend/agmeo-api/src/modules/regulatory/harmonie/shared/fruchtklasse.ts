/**
 * Fruchtklasse (crop class within a Schlag) for the Dube2.5 exports.
 *
 * ENNI: HAUPTFRUCHT | ZWEITFRUCHT | HERBSTANSAAT | GRUENLAND
 * ENDO: ERSTEFRUCHT | ZWEITEFRUCHT | HERBSTANSAAT | GRUENLAND
 *
 * Rules (ENNI Eingaberoutine: only one Hauptfrucht per Ackerschlag):
 * - grassland crops → GRUENLAND
 * - intercrops / undersows → HERBSTANSAAT (Zwischenfrucht sown after the main crop)
 * - next year's crop carrying this year's autumn applications → HERBSTANSAAT
 * - two main crops on one field in a year → the later-sown one is the Zweitfrucht
 */

import type { AgmeoCropKey, ExportCultivation } from '../types.js';

/** agmeo co2calculator `grassLandCrops` (src/lib/co2calculator/src/types.ts). */
export const GRASSLAND_CROPS: readonly AgmeoCropKey[] = [
  'permanentGrasslandWiltedSilage',
  'fieldGrassWiltedSilage',
];

/** agmeo co2calculator `cropsLegumes` (src/lib/co2calculator/src/types.ts). */
export const LEGUME_CROPS: readonly AgmeoCropKey[] = [
  'broadBeans',
  'peasDry',
  'peasDryFodder',
  'soybeanBeans',
  'lupine',
  'winterBroadBeans',
  'alfalfa',
  'persianCloverIntercrop',
  'winterPeas',
  'lentils',
  'chickpeas',
  'vetch',
  'clover',
  'cloverGrass',
  'alfalfaGrass',
  'vetchIntercrop',
  'crimsonCloverIntercrop',
  'alexandrineCloverIntercrop',
  'serradellaIntercrop',
  'cloverGrassUndersow',
  'bushBeans',
  'cowpeas',
  'dryBeans',
];

export type FruchtklasseDialect = 'enni' | 'endo';

export type SharedFruchtklasse =
  'HAUPTFRUCHT' | 'ZWEITFRUCHT' | 'HERBSTANSAAT' | 'GRUENLAND';

const DIALECT_NAMES: Record<
  FruchtklasseDialect,
  Record<SharedFruchtklasse, string>
> = {
  enni: {
    HAUPTFRUCHT: 'HAUPTFRUCHT',
    ZWEITFRUCHT: 'ZWEITFRUCHT',
    HERBSTANSAAT: 'HERBSTANSAAT',
    GRUENLAND: 'GRUENLAND',
  },
  endo: {
    HAUPTFRUCHT: 'ERSTEFRUCHT',
    ZWEITFRUCHT: 'ZWEITEFRUCHT',
    HERBSTANSAAT: 'HERBSTANSAAT',
    GRUENLAND: 'GRUENLAND',
  },
};

export function isGrasslandCrop(crop: string): boolean {
  return GRASSLAND_CROPS.includes(crop);
}

/**
 * Classify every cultivation of one field. Returns the classes in the same
 * order as `cultivations`.
 */
export function classifyCultivations(
  cultivations: ExportCultivation[],
): SharedFruchtklasse[] {
  const mainCrops = cultivations.filter(isHauptfruchtCandidate);
  const firstMain = [...mainCrops].sort(bySowingDate)[0];

  return cultivations.map((cult) => {
    if (cult.herbstansaat) return 'HERBSTANSAAT';
    if (isGrasslandCrop(cult.crop)) return 'GRUENLAND';
    if (cult.cropRole !== 'MAIN') return 'HERBSTANSAAT';
    if (mainCrops.length > 1 && cult !== firstMain) return 'ZWEITFRUCHT';
    return 'HAUPTFRUCHT';
  });
}

/** Arable main crops of the export year — the ones competing for the single HAUPTFRUCHT slot. */
export function isHauptfruchtCandidate(cult: ExportCultivation): boolean {
  return (
    cult.cropRole === 'MAIN' &&
    !cult.herbstansaat &&
    !isGrasslandCrop(cult.crop)
  );
}

export function fruchtklasseName(
  klasse: SharedFruchtklasse,
  dialect: FruchtklasseDialect,
): string {
  return DIALECT_NAMES[dialect][klasse];
}

/** Position of the cultivation in the field's crop sequence of the year (1 = first sown). */
export function kulturfolge(cultivations: ExportCultivation[]): number[] {
  const order = [...cultivations].sort(bySowingDate);
  return cultivations.map((c) => order.indexOf(c) + 1);
}

/** Sowing order; a Herbstansaat (next year's crop) always closes the sequence. */
function bySowingDate(a: ExportCultivation, b: ExportCultivation): number {
  const herbst = (a.herbstansaat ? 1 : 0) - (b.herbstansaat ? 1 : 0);
  if (herbst !== 0) return herbst;
  const ta = a.sowingDate?.getTime() ?? Number.POSITIVE_INFINITY;
  const tb = b.sowingDate?.getTime() ?? Number.POSITIVE_INFINITY;
  if (ta !== tb) return ta - tb;
  // Stable fallback so intercrops without a sowing date sort after main crops.
  return (a.cropRole === 'MAIN' ? 0 : 1) - (b.cropRole === 'MAIN' ? 0 : 1);
}

type DayOfYear = { month: number; day: number };
const onOrBefore = (date: Date, { month, day }: DayOfYear) => {
  const m = date.getUTCMonth() + 1;
  return m < month || (m === month && date.getUTCDate() <= day);
};

/**
 * Dube2.5 `aussaattermin` — when a catch crop (HERBSTANSAAT) was sown; it
 * drives the N-Bedarf of Zwischenfrüchte. ENDO knows four coarse buckets,
 * ENNI adds a finer split before mid-August that also states whether the
 * catch crop is harvested in its sowing year. Undersows have no own
 * Aussaattermin (they go in with the main crop) — callers skip them.
 */
export function aussaatterminPhrase(
  sowingDate: Date | null,
  dialect: FruchtklasseDialect,
  harvestedInSowingYear = false,
): string | null {
  if (!sowingDate) return null;
  if (dialect === 'enni' && onOrBefore(sowingDate, { month: 8, day: 15 })) {
    return harvestedInSowingYear
      ? 'bis 15.08., Ernte im Ansaatjahr'
      : 'bis 15.08., keine Ernte im Ansaatjahr';
  }
  if (onOrBefore(sowingDate, { month: 9, day: 15 }))
    return dialect === 'enni' ? '15.08. bis 15.09.' : 'bis 15.09.';
  if (onOrBefore(sowingDate, { month: 10, day: 1 })) return 'bis 01.10.';
  return 'nach 01.10.';
}
