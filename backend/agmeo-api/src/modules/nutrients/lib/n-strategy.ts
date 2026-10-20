/**
 * Fertilization strategies (reference StrategyForm and applyStrategyToSelection): the N need of a
 * crop split into doses by percentage, each dose as kg N/ha and as a product rate.
 */

const round1 = (v: number) => Math.round(v * 10) / 10;

/** Even split for a number of doses; what does not divide goes to the first dose (3 → 34/33/33). */
export function defaultSplits(doses: number): number[] {
  const each = Math.floor(100 / doses);
  return Array.from({ length: doses }, (_, i) => (i === 0 ? 100 - each * (doses - 1) : each));
}

export interface PlannedDose {
  index: number;
  pct: number;
  /** kg N/ha of the dose. */
  kgN: number;
  /** Product rate per ha in the product's base unit; null when the product carries no N. */
  rate: number | null;
}

/**
 * The doses of a strategy for an N need: kg N = max(0, need × share) to one decimal, the rate
 * from the product's N per unit (kg N per kg, t, l or m³).
 */
export function planDoses(needKgN: number, splitPercentages: number[], nPerUnit: (index: number) => number | null): PlannedDose[] {
  return splitPercentages
    .filter((p) => p > 0)
    .map((pct, index) => {
      const kgN = Math.max(0, round1((needKgN * pct) / 100));
      const per = nPerUnit(index);
      return { index, pct, kgN, rate: per && per > 0 ? round1(kgN / per) : null };
    });
}

/** Day a new dose is planned for: a month after the previous one (the last fertilization, else today). */
export function nextDoseDate(previous: string): string {
  const d = new Date(`${previous}T12:00:00Z`);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + 1);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString().slice(0, 10);
}
