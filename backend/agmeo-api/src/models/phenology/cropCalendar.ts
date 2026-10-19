/**
 * Ported from AGVOLUTION/agmeo src/lib/phenology/cropCalendar.ts — logic, numbers and
 * thresholds unchanged; only imports adapted to the rewrite.
 */

/**
 * Static crop calendar: typical DE/CH sowing dates and FAO-56 Table 11 crop
 * stage lengths. Pure and DB-free so `buildFieldWaterBalance` can fall back to
 * it when
 *  - no PLANTING transaction exists (default sowing date), and/or
 *  - the ESM phenology model has no parameters for the crop (day-based Kc
 *    curve via a synthetic BBCH map).
 *
 * Northern hemisphere only — all current users farm in DE/CH.
 */

import type { SupportedCrops } from '../crops.js';

type CropCalendarEntry = {
  /** Typical DE/CH sowing when no PLANTING transaction exists. */
  sowing: { month: number; day: number; previousYear?: boolean };
  /**
   * FAO-56 Table 11 stage lengths in days (L_ini/L_dev/L_mid/L_late).
   * Consumed only when `CROP_PARAMS` lacks the crop — the ESM phenology
   * model wins whenever it exists.
   */
  stages: { ini: number; dev: number; mid: number; late: number };
  /**
   * Kc before the season anchor for crops with standing dormant cover
   * (perennials). Absent ⇒ bare soil (transpiration off, Kcb = 0).
   */
  preSeasonKc?: number;
};

const CEREAL_SPRING_STAGES = { ini: 20, dev: 25, mid: 60, late: 30 };
const CEREAL_WINTER_STAGES = { ini: 30, dev: 140, mid: 40, late: 30 };
const GRASS_ENTRY: CropCalendarEntry = {
  sowing: { month: 3, day: 1 },
  stages: { ini: 10, dev: 20, mid: 180, late: 20 },
  preSeasonKc: 0.4,
};
/**
 * Cover crops go in after the previous main crop's harvest and stand into the
 * cultivation year's winter/spring.
 *
 * **Harvest-year allocation.** A cover crop sown in the autumn of Y−1 belongs
 * to harvest year **Y** — the year of the main crop it precedes, not the year
 * it was drilled. This is the same window `getHarvestYearDateSpan` defines
 * (July 1 of Y−1 → November 30 of Y, `@/lib/harvest-year`), and the same
 * convention `isSecondaryOf` implies, since a secondary cultivation group
 * shares its main crop's year. Hence `previousYear: true`.
 */
const INTERCROP_ENTRY: CropCalendarEntry = {
  sowing: { month: 8, day: 15, previousYear: true },
  stages: { ini: 15, dev: 25, mid: 50, late: 30 },
};

/**
 * Crops with no sowing or harvest, so no calendar entry: the water balance keeps
 * its DEFAULT_KC path for them. Mirrors `cropsWithoutSowingHarvesting` in
 * co2calculator/src/types — as a literal type, so `CROP_CALENDAR` below can
 * exclude exactly these and the compiler rejects any other missing crop.
 * `cropCalendar.test.ts` asserts the two stay in sync.
 */
type CropWithoutCalendar =
  'landscapeFeature' | 'nonProductiveArea' | 'unknownCrop';

/**
 * Every crop that is sown and harvested needs an entry — the type is total, so
 * adding a crop to `allSupportedCrops` without a calendar fails the build.
 *
 * Values flagged for agronomist review — see PR description.
 */
const CROP_CALENDAR: Record<
  Exclude<SupportedCrops, CropWithoutCalendar>,
  CropCalendarEntry
> = {
  potatoTableLate: {
    sowing: { month: 4, day: 25 },
    stages: { ini: 25, dev: 30, mid: 45, late: 30 },
  },
  silageMaize: {
    sowing: { month: 4, day: 25 },
    stages: { ini: 20, dev: 35, mid: 40, late: 10 },
  },
  grainMaize: {
    sowing: { month: 4, day: 25 },
    stages: { ini: 20, dev: 35, mid: 40, late: 30 },
  },
  sugarBeet: {
    sowing: { month: 4, day: 5 },
    stages: { ini: 30, dev: 45, mid: 90, late: 15 },
  },
  springBarleyMalting: {
    sowing: { month: 3, day: 20 },
    stages: CEREAL_SPRING_STAGES,
  },
  springOatsFodder: {
    sowing: { month: 3, day: 20 },
    stages: CEREAL_SPRING_STAGES,
  },
  springWheatFodder: {
    sowing: { month: 3, day: 15 },
    stages: CEREAL_SPRING_STAGES,
  },
  // Durum is grown as a spring cereal in DE — review if winter durum matters.
  hardWheat: { sowing: { month: 3, day: 20 }, stages: CEREAL_SPRING_STAGES },
  winterWheat: {
    sowing: { month: 10, day: 10, previousYear: true },
    stages: CEREAL_WINTER_STAGES,
  },
  winterBarleyFodder: {
    sowing: { month: 9, day: 25, previousYear: true },
    stages: CEREAL_WINTER_STAGES,
  },
  winterRyeBaking: {
    sowing: { month: 10, day: 1, previousYear: true },
    stages: CEREAL_WINTER_STAGES,
  },
  triticaleFodder: {
    sowing: { month: 10, day: 1, previousYear: true },
    stages: CEREAL_WINTER_STAGES,
  },
  spelt: {
    sowing: { month: 10, day: 15, previousYear: true },
    stages: CEREAL_WINTER_STAGES,
  },
  ryeWholePlantSilage: {
    sowing: { month: 10, day: 1, previousYear: true },
    stages: { ini: 30, dev: 140, mid: 30, late: 10 },
  },
  canola: {
    sowing: { month: 8, day: 25, previousYear: true },
    stages: { ini: 30, dev: 170, mid: 45, late: 25 },
  },
  sunflower: {
    sowing: { month: 4, day: 15 },
    stages: { ini: 25, dev: 35, mid: 45, late: 25 },
  },
  soybeanBeans: {
    sowing: { month: 5, day: 1 },
    stages: { ini: 20, dev: 35, mid: 60, late: 25 },
  },
  peasDry: {
    sowing: { month: 3, day: 25 },
    stages: { ini: 20, dev: 30, mid: 35, late: 15 },
  },
  peasDryFodder: {
    sowing: { month: 3, day: 25 },
    stages: { ini: 20, dev: 30, mid: 35, late: 15 },
  },
  broadBeans: {
    sowing: { month: 3, day: 10 },
    stages: { ini: 25, dev: 35, mid: 45, late: 30 },
  },
  lupine: {
    sowing: { month: 3, day: 25 },
    stages: { ini: 25, dev: 35, mid: 45, late: 25 },
  },
  alfalfa: {
    sowing: { month: 3, day: 1 },
    stages: { ini: 10, dev: 20, mid: 160, late: 30 },
    preSeasonKc: 0.4,
  },
  fieldGrassWiltedSilage: GRASS_ENTRY,
  permanentGrasslandWiltedSilage: GRASS_ENTRY,
  grassSeed: GRASS_ENTRY,
  cerealRyeIntercrop: INTERCROP_ENTRY,
  mustardIntercrop: INTERCROP_ENTRY,
  oilRadishIntercrop: INTERCROP_ENTRY,
  persianCloverIntercrop: INTERCROP_ENTRY,
  phaceliaIntercrop: INTERCROP_ENTRY,

  // ── Crops that ship without model data (see `cropsWithoutModelData`) ──
  // Phenology is never proxied (see the note on `cropProxy`), so each gets its
  // own dates. Entries marked `review:` are the ones an agronomist should
  // confirm — the rest follow directly from the crop above them.
  winterOats: {
    sowing: { month: 9, day: 25, previousYear: true },
    stages: CEREAL_WINTER_STAGES,
  },
  springRye: { sowing: { month: 3, day: 20 }, stages: CEREAL_SPRING_STAGES },
  springTriticale: {
    sowing: { month: 3, day: 20 },
    stages: CEREAL_SPRING_STAGES,
  },
  springCanola: {
    sowing: { month: 4, day: 1 },
    stages: { ini: 20, dev: 35, mid: 45, late: 25 },
  },
  springDurum: { sowing: { month: 3, day: 20 }, stages: CEREAL_SPRING_STAGES },
  winterBroadBeans: {
    sowing: { month: 10, day: 20, previousYear: true },
    stages: { ini: 30, dev: 130, mid: 45, late: 30 },
  },
  winterPeas: {
    sowing: { month: 10, day: 15, previousYear: true },
    stages: { ini: 30, dev: 130, mid: 40, late: 20 },
  },
  potatoStarch: {
    sowing: { month: 4, day: 20 },
    stages: { ini: 25, dev: 30, mid: 45, late: 30 },
  },
  seedPotato: {
    sowing: { month: 4, day: 10 },
    stages: { ini: 25, dev: 30, mid: 40, late: 20 },
  },
  potatoTableEarly: {
    sowing: { month: 3, day: 25 },
    stages: { ini: 20, dev: 25, mid: 30, late: 20 },
  },
  cornCobMix: {
    sowing: { month: 4, day: 25 },
    stages: { ini: 20, dev: 35, mid: 40, late: 30 },
  },
  maizeBiogas: {
    sowing: { month: 4, day: 25 },
    stages: { ini: 20, dev: 35, mid: 45, late: 15 },
  },
  sorghum: {
    sowing: { month: 5, day: 10 },
    stages: { ini: 20, dev: 30, mid: 40, late: 30 },
  },
  buckwheat: {
    sowing: { month: 5, day: 20 },
    stages: { ini: 15, dev: 25, mid: 40, late: 20 },
  },
  // review: millet is a niche crop in DE; sowing follows the last frost like sorghum.
  millet: {
    sowing: { month: 5, day: 15 },
    stages: { ini: 15, dev: 25, mid: 40, late: 25 },
  },
  lentils: {
    sowing: { month: 4, day: 1 },
    stages: { ini: 20, dev: 30, mid: 40, late: 20 },
  },
  // review: chickpeas are barely grown in DE/CH — treated as a late-sown spring legume.
  chickpeas: {
    sowing: { month: 4, day: 15 },
    stages: { ini: 20, dev: 30, mid: 40, late: 25 },
  },
  linseed: {
    sowing: { month: 4, day: 1 },
    stages: { ini: 20, dev: 30, mid: 40, late: 20 },
  },
  hemp: {
    sowing: { month: 4, day: 25 },
    stages: { ini: 20, dev: 30, mid: 60, late: 25 },
  },
  // review: winter poppy exists in DE too — this is the spring form.
  poppy: {
    sowing: { month: 3, day: 25 },
    stages: { ini: 25, dev: 35, mid: 45, late: 25 },
  },
  fodderBeet: {
    sowing: { month: 4, day: 10 },
    stages: { ini: 30, dev: 45, mid: 85, late: 15 },
  },
  vetch: {
    sowing: { month: 3, day: 25 },
    stages: { ini: 20, dev: 30, mid: 40, late: 20 },
  },
  // review: quinoa is a niche crop; sown once soils warm, harvested late September.
  quinoa: {
    sowing: { month: 4, day: 20 },
    stages: { ini: 20, dev: 30, mid: 50, late: 30 },
  },
  emmer: {
    sowing: { month: 10, day: 15, previousYear: true },
    stages: CEREAL_WINTER_STAGES,
  },
  einkorn: {
    sowing: { month: 10, day: 15, previousYear: true },
    stages: CEREAL_WINTER_STAGES,
  },
  // Perennial forage: standing cover through winter, like alfalfa and grassland.
  clover: {
    sowing: { month: 3, day: 15 },
    stages: { ini: 15, dev: 25, mid: 160, late: 30 },
    preSeasonKc: 0.4,
  },
  cloverGrass: {
    sowing: { month: 3, day: 10 },
    stages: { ini: 10, dev: 20, mid: 175, late: 25 },
    preSeasonKc: 0.4,
  },
  alfalfaGrass: {
    sowing: { month: 3, day: 5 },
    stages: { ini: 10, dev: 20, mid: 175, late: 25 },
    preSeasonKc: 0.4,
  },

  // Cover crops: sown after the previous main crop's harvest, standing into
  // the cultivation year (see INTERCROP_ENTRY for the harvest-year rule).
  intercropMixture: INTERCROP_ENTRY,
  blackOatIntercrop: INTERCROP_ENTRY,
  vetchIntercrop: INTERCROP_ENTRY,
  crimsonCloverIntercrop: INTERCROP_ENTRY,
  alexandrineCloverIntercrop: INTERCROP_ENTRY,
  buckwheatIntercrop: {
    sowing: { month: 8, day: 10, previousYear: true },
    stages: { ini: 10, dev: 20, mid: 35, late: 20 },
  },
  sunflowerIntercrop: {
    sowing: { month: 8, day: 10, previousYear: true },
    stages: { ini: 15, dev: 25, mid: 40, late: 20 },
  },
  // review: niger (Guizotia) is frost-sensitive — sown early in the cover-crop window.
  nigerIntercrop: {
    sowing: { month: 8, day: 5, previousYear: true },
    stages: { ini: 15, dev: 20, mid: 35, late: 20 },
  },
  // review: sorghum as a cover crop is frost-killed early.
  sorghumIntercrop: {
    sowing: { month: 8, day: 5, previousYear: true },
    stages: { ini: 15, dev: 25, mid: 40, late: 20 },
  },
  linseedIntercrop: {
    sowing: { month: 8, day: 15, previousYear: true },
    stages: { ini: 15, dev: 25, mid: 45, late: 25 },
  },
  // review: camelina overwinters in mild years; treated as winter-killed here.
  camelinaIntercrop: {
    sowing: { month: 8, day: 20, previousYear: true },
    stages: { ini: 15, dev: 25, mid: 50, late: 30 },
  },
  // review: serradella is slow to establish and often overwinters.
  serradellaIntercrop: {
    sowing: { month: 8, day: 10, previousYear: true },
    stages: { ini: 20, dev: 30, mid: 55, late: 30 },
  },
  // Undersows go in with the main crop and stay after its harvest.
  ryegrassUndersow: {
    sowing: { month: 4, day: 15 },
    stages: { ini: 20, dev: 40, mid: 120, late: 30 },
    preSeasonKc: 0.4,
  },
  cloverGrassUndersow: {
    sowing: { month: 4, day: 15 },
    stages: { ini: 20, dev: 40, mid: 120, late: 30 },
    preSeasonKc: 0.4,
  },
  onion: {
    sowing: { month: 3, day: 25 },
    stages: { ini: 15, dev: 25, mid: 70, late: 40 },
  },
  garlic: {
    sowing: { month: 10, day: 15, previousYear: true },
    stages: { ini: 30, dev: 120, mid: 70, late: 30 },
  },
  leek: {
    sowing: { month: 5, day: 1 },
    stages: { ini: 20, dev: 40, mid: 90, late: 40 },
  },
  carrot: {
    sowing: { month: 4, day: 10 },
    stages: { ini: 20, dev: 30, mid: 80, late: 30 },
  },
  whiteCabbage: {
    sowing: { month: 5, day: 10 },
    stages: { ini: 40, dev: 60, mid: 50, late: 15 },
  },
  redCabbage: {
    sowing: { month: 5, day: 10 },
    stages: { ini: 40, dev: 60, mid: 50, late: 15 },
  },
  savoyCabbage: {
    sowing: { month: 5, day: 10 },
    stages: { ini: 35, dev: 55, mid: 50, late: 15 },
  },
  cauliflower: {
    sowing: { month: 5, day: 1 },
    stages: { ini: 35, dev: 50, mid: 40, late: 15 },
  },
  broccoli: {
    sowing: { month: 5, day: 1 },
    stages: { ini: 35, dev: 45, mid: 40, late: 15 },
  },
  kale: {
    sowing: { month: 6, day: 1 },
    stages: { ini: 30, dev: 50, mid: 60, late: 20 },
  },
  kohlrabi: {
    sowing: { month: 4, day: 20 },
    stages: { ini: 25, dev: 35, mid: 30, late: 10 },
  },
  brusselsSprouts: {
    sowing: { month: 5, day: 10 },
    stages: { ini: 35, dev: 60, mid: 70, late: 20 },
  },
  chineseCabbage: {
    sowing: { month: 7, day: 15 },
    stages: { ini: 20, dev: 30, mid: 30, late: 10 },
  },
  lettuce: {
    sowing: { month: 4, day: 15 },
    stages: { ini: 20, dev: 30, mid: 15, late: 10 },
  },
  lambsLettuce: {
    sowing: { month: 8, day: 20 },
    stages: { ini: 15, dev: 30, mid: 40, late: 10 },
  },
  spinach: {
    sowing: { month: 4, day: 1 },
    stages: { ini: 20, dev: 20, mid: 15, late: 5 },
  },
  beetroot: {
    sowing: { month: 4, day: 20 },
    stages: { ini: 25, dev: 30, mid: 50, late: 20 },
  },
  celeriac: {
    sowing: { month: 5, day: 10 },
    stages: { ini: 25, dev: 40, mid: 80, late: 30 },
  },
  fennel: {
    sowing: { month: 5, day: 15 },
    stages: { ini: 20, dev: 30, mid: 40, late: 15 },
  },
  endive: {
    sowing: { month: 6, day: 15 },
    stages: { ini: 20, dev: 30, mid: 30, late: 10 },
  },
  bushBeans: {
    sowing: { month: 5, day: 15 },
    stages: { ini: 20, dev: 30, mid: 30, late: 10 },
  },
  sweetCorn: {
    sowing: { month: 4, day: 25 },
    stages: { ini: 20, dev: 30, mid: 40, late: 10 },
  },
  pumpkin: {
    sowing: { month: 5, day: 15 },
    stages: { ini: 20, dev: 30, mid: 50, late: 25 },
  },
  cucumber: {
    sowing: { month: 5, day: 15 },
    stages: { ini: 20, dev: 30, mid: 40, late: 15 },
  },
  tomato: {
    sowing: { month: 5, day: 15 },
    stages: { ini: 30, dev: 40, mid: 45, late: 30 },
  },
  bellPepper: {
    sowing: { month: 5, day: 20 },
    stages: { ini: 30, dev: 40, mid: 70, late: 20 },
  },
  asparagus: {
    sowing: { month: 3, day: 1 },
    stages: { ini: 115, dev: 30, mid: 90, late: 30 },
    preSeasonKc: 0.4,
  },
  strawberry: {
    sowing: { month: 3, day: 1 },
    stages: { ini: 30, dev: 40, mid: 90, late: 60 },
    preSeasonKc: 0.4,
  },
  hops: {
    sowing: { month: 3, day: 1 },
    stages: { ini: 30, dev: 60, mid: 60, late: 30 },
    preSeasonKc: 0.4,
  },
  grapevine: {
    sowing: { month: 3, day: 1 },
    stages: { ini: 30, dev: 60, mid: 80, late: 30 },
    preSeasonKc: 0.4,
  },
  rhubarb: {
    sowing: { month: 3, day: 1 },
    stages: { ini: 20, dev: 40, mid: 120, late: 30 },
    preSeasonKc: 0.4,
  },
  pomeFruit: {
    sowing: { month: 3, day: 1 },
    stages: { ini: 30, dev: 60, mid: 100, late: 30 },
    preSeasonKc: 0.4,
  },
  stoneFruit: {
    sowing: { month: 3, day: 1 },
    stages: { ini: 30, dev: 60, mid: 70, late: 30 },
    preSeasonKc: 0.4,
  },
  rice: {
    sowing: { month: 5, day: 1 },
    stages: { ini: 30, dev: 30, mid: 60, late: 30 },
  },
  cowpeas: {
    sowing: { month: 5, day: 15 },
    stages: { ini: 20, dev: 30, mid: 35, late: 20 },
  },
  dryBeans: {
    sowing: { month: 5, day: 15 },
    stages: { ini: 20, dev: 30, mid: 40, late: 20 },
  },
  grainSorghum: {
    sowing: { month: 5, day: 15 },
    stages: { ini: 20, dev: 35, mid: 40, late: 30 },
  },
};

/**
 * Entry for a crop, or undefined for the two crops that have no sowing or
 * harvest. The cast widens the total record back to a partial one — the table
 * itself stays total, which is what makes a newly added crop a build error.
 */
function calendarEntry(crop: SupportedCrops): CropCalendarEntry | undefined {
  return (CROP_CALENDAR as Partial<Record<SupportedCrops, CropCalendarEntry>>)[
    crop
  ];
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

/**
 * Typical sowing date for a harvest year, e.g. potato 2026 → "2026-04-25",
 * winter wheat 2026 → "2025-10-10". Null for crops without a calendar entry.
 */
export function getDefaultSowingDate(
  crop: SupportedCrops,
  harvestYear: number,
): string | null {
  const entry = calendarEntry(crop);
  if (!entry) return null;
  const year = entry.sowing.previousYear ? harvestYear - 1 : harvestYear;
  return `${year}-${pad2(entry.sowing.month)}-${pad2(entry.sowing.day)}`;
}

/**
 * Typical harvest date for a harvest year: the calendar's sowing anchor plus
 * the FAO-56 stage lengths. Null for crops without a calendar entry.
 *
 * Only an estimate for display when a cultivation has no HARVESTING operation
 * — never a substitute for a recorded one.
 */
export function getDefaultHarvestDate(
  crop: SupportedCrops,
  harvestYear: number,
): string | null {
  const entry = calendarEntry(crop);
  const sowingDate = getDefaultSowingDate(crop, harvestYear);
  if (!entry || !sowingDate) return null;
  const { ini, dev, mid, late } = entry.stages;
  const harvest = new Date(`${sowingDate}T00:00:00Z`);
  harvest.setUTCDate(harvest.getUTCDate() + ini + dev + mid + late);
  return harvest.toISOString().split('T')[0];
}

/** Dormant-cover Kc before the season anchor; null ⇒ bare soil (Kcb 0). */
export function getPreSeasonKc(crop: SupportedCrops): number | null {
  return calendarEntry(crop)?.preSeasonKc ?? null;
}

/** BBCH for a given day-offset since sowing on the FAO-56 stage timeline. */
function calendarBbch(
  daysSinceSowing: number,
  stages: CropCalendarEntry['stages'],
): number {
  const { ini, dev, mid, late } = stages;
  if (daysSinceSowing < ini) return Math.round((9 * daysSinceSowing) / ini);
  const sinceDev = daysSinceSowing - ini;
  if (sinceDev < dev) return Math.round(10 + (20 * sinceDev) / dev);
  const sinceMid = sinceDev - dev;
  if (sinceMid < mid) return Math.round(30 + (40 * sinceMid) / mid);
  const sinceLate = sinceMid - mid;
  if (sinceLate < late) return Math.round(70 + (10 * sinceLate) / late);
  return 80;
}

/**
 * Synthetic day-based BBCH curve anchored at sowing (FAO-56 Table 11 stage
 * lengths mapped linearly onto the BBCH ranges `kcFromBbch` interpolates
 * over, so Kc(BBCH(date)) reproduces the FAO-56 trapezoid exactly).
 *
 * Mirrors `calculateDailyBbchMap` semantics: entries only for dates from
 * sowing up to `today` (carry-forward past `today` is the caller's job).
 * Returns null when the crop has no calendar entry.
 */
export function buildCalendarBbchMap(
  dates: string[],
  crop: SupportedCrops,
  sowingDate: string,
  today: string,
): Map<string, number> | null {
  const entry = calendarEntry(crop);
  if (!entry) return null;
  const sowingMs = Date.parse(sowingDate);
  const map = new Map<string, number>();
  for (const date of dates) {
    if (date < sowingDate || date > today) continue;
    const daysSinceSowing = Math.round(
      (Date.parse(date) - sowingMs) / 86_400_000,
    );
    map.set(date, calendarBbch(daysSinceSowing, entry.stages));
  }
  return map;
}
