/**
 * Zone rates for variable-rate maps from relative productivity, after AGVOLUTION/agmeo
 * (applicationMapsPage/utils.ts, vrn/vrs recommendation routes): a zone's factor follows its
 * productivity, is clipped to 0.65–1.35 and normalized so the field receives the standard amount.
 */
export interface ZoneProductivity {
  zoneNo: number;
  areaHa: number;
  /** % of the field mean. */
  relativeProductivity: number | null;
}

export const MIN_FACTOR = 0.65;
export const MAX_FACTOR = 1.35;

/**
 * Factors per zone (area-weighted mean 1). `direction` +1 gives productive zones more,
 * −1 gives them less; `gain` 1 makes the factor follow productivity one to one.
 */
export function zoneFactors(zones: ZoneProductivity[], direction: 1 | -1, gain = 1): Map<number, number> {
  const raw = zones.map((z) => {
    const d = (z.relativeProductivity ?? 100) / 100 - 1;
    return { zone: z, f: Math.min(MAX_FACTOR, Math.max(MIN_FACTOR, 1 + direction * d * gain)) };
  });
  const area = raw.reduce((s, r) => s + r.zone.areaHa, 0);
  const mean = area > 0 ? raw.reduce((s, r) => s + r.f * r.zone.areaHa, 0) / area : 1;
  return new Map(raw.map((r) => [r.zone.zoneNo, mean > 0 ? r.f / mean : 1]));
}

export function zoneRates(
  zones: ZoneProductivity[],
  standardRate: number,
  opts: { direction: 1 | -1; gain?: number; minRate?: number | null; maxRate?: number | null; round: (v: number) => number },
): { rates: Record<string, number>; meanRate: number } {
  const factors = zoneFactors(zones, opts.direction, opts.gain ?? 1);
  const rates: Record<string, number> = {};
  for (const z of zones) {
    let rate = standardRate * (factors.get(z.zoneNo) ?? 1);
    if (opts.minRate != null) rate = Math.max(rate, opts.minRate);
    if (opts.maxRate != null) rate = Math.min(rate, opts.maxRate);
    rates[String(z.zoneNo)] = opts.round(rate);
  }
  const area = zones.reduce((s, z) => s + z.areaHa, 0);
  const meanRate = area > 0 ? zones.reduce((s, z) => s + rates[String(z.zoneNo)] * z.areaHa, 0) / area : standardRate;
  return { rates, meanRate: opts.round(meanRate) };
}
