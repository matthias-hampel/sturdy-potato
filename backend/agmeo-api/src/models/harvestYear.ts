/**
 * Ported from AGVOLUTION/agmeo src/lib/harvest-year.ts — only the date span the crop calendar is checked against.
 */

export type DateSpan = { start: Date; end: Date };

export function getHarvestYearDateSpan(harvestYear: number): DateSpan {
  return {
    start: new Date(harvestYear - 1, 6, 1), // July 1st of previous year (month is 0-indexed)
    end: new Date(harvestYear, 10, 30), // November 30th of harvest year
  };
}
