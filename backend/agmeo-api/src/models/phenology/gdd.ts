/**
 * Ported from AGVOLUTION/agmeo src/lib/phenology/gdd.ts — logic, numbers and
 * thresholds unchanged; only imports adapted to the rewrite.
 */

import type { SupportedCrops } from '../crops.js';

/**
 * A crop without a base temperature has no phenology model yet — callers must
 * say so rather than fall back to a related crop.
 */
const GDD_BASE_TEMPS: Partial<Record<SupportedCrops, number>> = {
  // Winter cereals (TBD: 0)
  winterWheat: 0,
  hardWheat: 0,
  winterBarleyFodder: 0,
  winterRyeBaking: 0,
  triticaleFodder: 0,
  // Spring cereals
  springBarleyMalting: 0,
  springOatsFodder: 2,
  springWheatFodder: 0,
  spelt: 2,
  ryeWholePlantSilage: 1,
  // Oilseeds
  canola: 2,
  sunflower: 6,
  // Maize (TBD: 6)
  silageMaize: 6,
  grainMaize: 6,
  // Root crops
  sugarBeet: 2,
  potatoTableLate: 2,
  // Legumes
  broadBeans: 2,
  peasDry: 2,
  peasDryFodder: 2,
  soybeanBeans: 6,
  lupine: 2,
  // Grass & forage
  fieldGrassWiltedSilage: 1,
  permanentGrasslandWiltedSilage: 1,
  grassSeed: 6,
  alfalfa: 6,
  // Cover crops
  cerealRyeIntercrop: 2,
  mustardIntercrop: 2,
  oilRadishIntercrop: 2,
  persianCloverIntercrop: 2,
  phaceliaIntercrop: 2,
  // Non-productive (no GDD applicable)
  landscapeFeature: 0,
  nonProductiveArea: 0,
};

export function calculateDailyGDD(
  tempMin: number,
  tempMax: number,
  crop: SupportedCrops,
): number | null {
  const baseTemp = GDD_BASE_TEMPS[crop];
  if (baseTemp === undefined) return null;
  const meanTemp = (tempMax + tempMin) / 2;
  return Math.max(0, meanTemp - baseTemp);
}

/**
 * Compute cumulative GDD from weather timeseries.
 * Optionally starts accumulation from a sowing date.
 */
export function computeGDDFromWeather(
  weather:
    Record<string, { tempMin: number; tempMax: number }> | null | undefined,
  crop: SupportedCrops,
  sowingDate?: string | null,
): number | null {
  if (GDD_BASE_TEMPS[crop] === undefined) return null;
  if (!weather) return 0;

  const dates = Object.keys(weather).sort();
  if (sowingDate && (dates.length === 0 || dates[0] > sowingDate)) return null;
  const startIdx = sowingDate ? dates.findIndex((d) => d >= sowingDate) : 0;
  if (startIdx === -1) return 0;

  let cumulative = 0;
  for (let i = startIdx; i < dates.length; i++) {
    const day = weather[dates[i]];
    cumulative += calculateDailyGDD(day.tempMin, day.tempMax, crop) ?? 0;
  }

  return cumulative;
}
