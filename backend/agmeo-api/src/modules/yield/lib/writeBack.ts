/**
 * Documented yield from a merged map — the guards of the reference app, on agmeo's harvest
 * records (one row per harvest with a quantity in t and the harvested area).
 *
 * 1. Never overwrite: a documented quantity is the farmer's own number.
 * 2. Areas of several harvest rows are not summed — two combines each report about half the
 *    field; the documented area is the largest one, capped by the crop cycle.
 * 3. The number to write is the PIXEL mean (equal-area by construction), not the point mean.
 * 4. Harvest dates spread wider than three weeks are separate cuts, not one event.
 * 5. A map covering less than half of the documented area is a partial record.
 */

/** Harvest dates spread wider than this are separate cuts, not one event. */
export const SINGLE_EVENT_DAYS = 21;
/** Below this share of the documented area a merged map is a partial record. */
export const MIN_COVERAGE_SHARE = 0.5;

export type HarvestRow = {
  id: string;
  /** null for harvests created from a yield map. */
  operationId: string | null;
  date: Date;
  quantityT: number;
  areaHa: number | null;
  yieldRasterId?: string | null;
};

export const isSingleHarvestEvent = (dates: Date[]): boolean => {
  if (dates.length <= 1) return true;
  const times = dates.map((date) => date.getTime());
  return Math.max(...times) - Math.min(...times) <= SINGLE_EVENT_DAYS * 24 * 60 * 60 * 1000;
};

/** min(worked, cultivation) when a worked area is known, else the cultivation area. */
export const effectiveAreaHa = (workedAreaHa: number | null, cultivationAreaHa: number): number =>
  workedAreaHa != null && workedAreaHa > 0 ? Math.min(workedAreaHa, cultivationAreaHa) : cultivationAreaHa;

/** The area a documented figure refers to: the largest harvested area of any row, capped by the cultivation. */
export const documentedAreaHa = (rows: HarvestRow[], cultivationAreaHa: number): number =>
  effectiveAreaHa(
    rows.reduce<number | null>((max, row) => (row.areaHa != null && (max === null || row.areaHa > max) ? row.areaHa : max), null),
    cultivationAreaHa,
  );

/** The row a map figure belongs on: the one that covered the most ground, then the latest. */
export const targetRowForWriteBack = (rows: HarvestRow[]): HarvestRow | null =>
  rows.toSorted((a, b) => (b.areaHa ?? 0) - (a.areaHa ?? 0) || +b.date - +a.date)[0] ?? null;

export type WriteBackPlan =
  | { action: 'update'; harvestId: string; quantityT: number; areaHa: number }
  | { action: 'create'; quantityT: number; areaHa: number }
  | { action: 'skip'; reason: string };

/**
 * What to do with a crop cycle's harvest rows given a merged map. A crop cycle without any
 * harvest gets one from the map (agmeo's harvest record is the product row the reference app
 * wrote into); rows that already carry a quantity are left alone; a map figure written earlier
 * is refreshed when the map is rebuilt.
 */
export function planWriteBack(input: {
  rows: HarvestRow[];
  cultivationAreaHa: number;
  pixelMeanTHa: number;
  coveredHa: number;
  hasEventDate: boolean;
}): WriteBackPlan {
  if (!(input.pixelMeanTHa > 0)) return { action: 'skip', reason: 'no-mean' };
  const own = input.rows.filter((row) => row.yieldRasterId);
  const documented = input.rows.filter((row) => !row.yieldRasterId);
  if (documented.some((row) => row.quantityT > 0)) return { action: 'skip', reason: 'already-documented' };
  if (!isSingleHarvestEvent(input.rows.map((row) => row.date))) return { action: 'skip', reason: 'multi-cut' };
  const areaHa = input.rows.length ? documentedAreaHa(input.rows, input.cultivationAreaHa) : Math.min(input.coveredHa, input.cultivationAreaHa);
  if (!(areaHa > 0)) return { action: 'skip', reason: 'no-area' };
  if (input.coveredHa < areaHa * MIN_COVERAGE_SHARE) return { action: 'skip', reason: 'partial-coverage' };
  const quantityT = Math.round(input.pixelMeanTHa * areaHa * 1000) / 1000;
  const target = targetRowForWriteBack(own.length ? own : documented);
  if (target) return { action: 'update', harvestId: target.id, quantityT: Math.round(input.pixelMeanTHa * (target.areaHa ?? areaHa) * 1000) / 1000, areaHa: target.areaHa ?? areaHa };
  if (!input.hasEventDate) return { action: 'skip', reason: 'no-date' };
  return { action: 'create', quantityT, areaHa };
}
