/**
 * Closed periods for N fertilizers (Sperrfristen, DüV §6 Abs. 8 and §13a Abs. 2), ported from
 * AGVOLUTION/agmeo (src/lib/duev/sperrfrist.ts). An orientation check: Länder may shift the arable
 * window by up to four weeks, and the autumn exceptions (winter rape, winter barley after cereals,
 * catch crops and field forage until 1 October with limited amounts) are not modelled.
 */
import type { FertilizerType } from '@agmeo/contracts';

/** Solid manure of hoofed animals and compost have their own, shorter window. */
const SOLID_MANURE_COMPOST: FertilizerType[] = ['cattle_solid_manure', 'pig_solid_manure', 'horse_sheep_manure', 'compost'];

export interface ClosedPeriod {
  /** 'MM-DD', inclusive; windows run over the turn of the year. */
  from: string;
  to: string;
  rule: string;
}

export function closedPeriod(landUse: 'arable' | 'grassland', type: FertilizerType | null | undefined, redArea: boolean): ClosedPeriod {
  if (type && SOLID_MANURE_COMPOST.includes(type)) {
    return redArea ? { from: '11-01', to: '01-31', rule: 'DüV §13a Abs. 2 (Festmist/Kompost, rotes Gebiet)' } : { from: '12-01', to: '01-15', rule: 'DüV §6 Abs. 8 Satz 2 (Festmist/Kompost)' };
  }
  if (landUse === 'grassland') {
    return redArea ? { from: '10-01', to: '01-31', rule: 'DüV §13a Abs. 2 (Grünland, rotes Gebiet)' } : { from: '11-01', to: '01-31', rule: 'DüV §6 Abs. 8 (Grünland)' };
  }
  return { from: '10-01', to: '01-31', rule: 'DüV §6 Abs. 8 (Ackerland)' };
}

/** Whether a date ('YYYY-MM-DD') falls in a closed period. */
export function inClosedPeriod(date: string, period: ClosedPeriod): boolean {
  const md = date.slice(5);
  return period.from <= period.to ? md >= period.from && md <= period.to : md >= period.from || md <= period.to;
}

/** Only fertilizers with a significant N content are restricted; P/K fertilizers are not. */
export const restrictedByClosedPeriod = (type: FertilizerType | null | undefined, nPct: number | null) => type !== 'pk' && (nPct ?? 0) > 0;
