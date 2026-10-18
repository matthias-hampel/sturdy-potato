/** Date arithmetic on calendar dates ('YYYY-MM-DD'), free of timezones. */

export interface SeasonWindow {
  harvestYear: number;
  startDate: string;
  endDate: string;
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** 'MM-DD' in a year; 29 February falls back to 28 February in common years. */
function onYear(md: string, year: number): string {
  const date = `${year}-${md}`;
  return md === '02-29' && new Date(`${date}T00:00:00Z`).getUTCMonth() !== 1 ? `${year}-02-28` : date;
}

/**
 * The date a crop default ('MM-DD') falls on in a season. Seasons are named by harvest year and
 * usually run from one harvest to the next, so a sowing day may fall in the year before the harvest
 * year. The first occurrence inside the season wins; when the season window holds none (a short
 * season), sowing goes to the year before the harvest year if `sownBeforeHarvestYear`, otherwise
 * to the harvest year.
 */
export function defaultDateInSeason(md: string, season: SeasonWindow, sownBeforeHarvestYear = false): string {
  for (const year of [season.harvestYear - 1, season.harvestYear, season.harvestYear + 1]) {
    const date = onYear(md, year);
    if (date >= season.startDate && date <= season.endDate) return date;
  }
  return onYear(md, sownBeforeHarvestYear ? season.harvestYear - 1 : season.harvestYear);
}

/** Planned date of a template step: its anchor date plus the offset. */
export function stepDate(anchor: 'sowing' | 'harvest' | 'season_start', offsetDays: number, dates: { sowing: string | null; harvest: string | null; seasonStart: string }): string | null {
  const base = anchor === 'sowing' ? dates.sowing : anchor === 'harvest' ? dates.harvest : dates.seasonStart;
  return base ? addDays(base, offsetDays) : null;
}

/**
 * Next entry of a rotation for a field. The entry after the one whose crop (and template, when
 * both have one) matches last season's main crop, wrapping round; without a match the rotation
 * is counted from the year the field started it.
 */
export function nextRotationPosition(
  entries: { position: number; cropId: string; templateId: string | null }[],
  previous: { cropId: string; templateId: string | null } | null,
  targetYear: number,
  startYear: number,
): number {
  const sorted = [...entries].sort((a, b) => a.position - b.position);
  const n = sorted.length;
  if (previous) {
    const exact = sorted.findIndex((e) => e.cropId === previous.cropId && e.templateId != null && e.templateId === previous.templateId);
    const byCrop = exact >= 0 ? exact : sorted.findIndex((e) => e.cropId === previous.cropId);
    if (byCrop >= 0) return sorted[(byCrop + 1) % n].position;
  }
  return sorted[(((targetYear - startYear) % n) + n) % n].position;
}
