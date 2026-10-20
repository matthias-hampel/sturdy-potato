/**
 * Seed-rate conversions between kg/ha (lot weight), grains/m² (drill setting) and plants/m² (target
 * stand), ported from the reference's `lib/seeding/rate.ts`. Grains ↔ plants goes through the
 * germination rate, grains ↔ kg through the thousand-grain weight. Every function returns `null`
 * when an input is missing or zero, so "no rate" stays distinct from 0.
 */

/** Germination rate (%) assumed when the lot's own figure is not on file. */
export const DEFAULT_GERMINATION_RATE = 94;

const SQM_PER_HA = 10_000;
/** TKG is grams per 1000 grains, so grains × TKG / 10⁶ is kilograms. */
const GRAINS_PER_KG_FACTOR = 1_000_000;

/** Grains per seed unit (package) of crops sold by grain count, by crop code. */
export const SEED_PACKAGE_SIZES: Record<string, number> = {
  silage_maize: 50_000,
  grain_maize: 50_000,
  sugar_beet: 100_000,
  sunflower: 150_000,
};

/** Grains to drill for a target stand. */
export const grainsPerM2FromPlants = (plantsPerM2: number | null | undefined, germinationRate: number | null | undefined): number | null => {
  if (!plantsPerM2 || !germinationRate) return null;
  return (plantsPerM2 * 100) / germinationRate;
};

/** The stand a drilled seed count is expected to establish. */
export const plantsPerM2FromGrains = (grainsPerM2: number | null | undefined, germinationRate: number | null | undefined): number | null => {
  if (!grainsPerM2 || !germinationRate) return null;
  return (grainsPerM2 * germinationRate) / 100;
};

/** What a drill setting weighs; germination does not enter here. */
export const kgHaFromGrainsPerM2 = (grainsPerM2: number | null | undefined, tkg: number | null | undefined): number | null => {
  if (!grainsPerM2 || !tkg) return null;
  return (grainsPerM2 * SQM_PER_HA * tkg) / GRAINS_PER_KG_FACTOR;
};

/** The drill setting a weight per hectare amounts to. */
export const grainsPerM2FromKgHa = (seedRateKgHa: number | null | undefined, tkg: number | null | undefined): number | null => {
  if (!seedRateKgHa || !tkg) return null;
  return (seedRateKgHa * GRAINS_PER_KG_FACTOR) / (SQM_PER_HA * tkg);
};

/** Packages a stand needs — packaged seed (maize, beet) is sold by grain count, so this goes through grains. */
export const seedPackagesForStand = (plantsPerM2: number | null | undefined, germinationRate: number | null | undefined, areaInHa: number, packageSizeInGrains: number): number | null => {
  const grains = grainsPerM2FromPlants(plantsPerM2, germinationRate);
  return seedPackagesForGrains(grains, areaInHa, packageSizeInGrains);
};

/** Packages for a drill setting over an area. */
export const seedPackagesForGrains = (grainsPerM2: number | null | undefined, areaInHa: number, packageSizeInGrains: number): number | null => {
  if (!grainsPerM2 || !packageSizeInGrains || areaInHa <= 0) return null;
  return (grainsPerM2 * SQM_PER_HA * areaInHa) / packageSizeInGrains;
};

/** The single kg/ha rate that spends `totalKg` over the given areas; `null` without a positive area. */
export const distributeTotalSeedKg = (totalKg: number | null | undefined, areasInHa: number[]): number | null => {
  if (!totalKg) return null;
  const totalArea = areasInHa.reduce((sum, area) => sum + (area > 0 ? area : 0), 0);
  if (totalArea <= 0) return null;
  return totalKg / totalArea;
};
