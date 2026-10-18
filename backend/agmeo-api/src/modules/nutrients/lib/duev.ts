/**
 * Fertilizer need for nitrogen (Düngebedarfsermittlung, DüV §4 and Anlage 4), ported from
 * AGVOLUTION/agmeo (src/lib/farmalyzer/duev.ts) with two corrections: Nmin is subtracted once
 * (agmeo added spring mineralization on top of the humus deduction) and yield surcharges are capped.
 * The result supports, but does not replace, the documentation the ordinance requires; Länder
 * rules and exceptions are not modelled.
 */
import type { NNeedResult, SoilClass } from '@agmeo/contracts';

export const DUEV_RULESET = 'DE-DUEV-2020-Anl4-2026.1';

type CropGroup = 'getreide' | 'raps' | 'silomais' | 'zuckerrueben' | 'kartoffeln' | 'leguminosen' | 'grassland';

interface DuevCrop {
  duevName: string;
  referenceYield: number;
  nRequirement: number;
  group: CropGroup;
  yieldUnit: 'dt/ha' | 'dt FM/ha' | 'dt TM/ha';
  /** Grassland and field forage: corrections per 10 dt DM and per 1 % crude protein. */
  grassland?: { referenceProtein: number; per10dt: number; per1rp: number };
}

/** DüV Anlage 4 Tabelle 2 / 4 values, keyed by agmeo crop code. */
export const DUEV_CROPS: Record<string, DuevCrop> = {
  winter_wheat: { duevName: 'Winterweizen A/B', referenceYield: 80, nRequirement: 230, group: 'getreide', yieldUnit: 'dt/ha' },
  winter_spelt: { duevName: 'Winterweizen C', referenceYield: 80, nRequirement: 210, group: 'getreide', yieldUnit: 'dt/ha' },
  winter_barley: { duevName: 'Wintergerste', referenceYield: 70, nRequirement: 180, group: 'getreide', yieldUnit: 'dt/ha' },
  winter_rye: { duevName: 'Winterroggen', referenceYield: 70, nRequirement: 170, group: 'getreide', yieldUnit: 'dt/ha' },
  triticale: { duevName: 'Wintertriticale', referenceYield: 70, nRequirement: 190, group: 'getreide', yieldUnit: 'dt/ha' },
  spring_barley: { duevName: 'Sommergerste', referenceYield: 50, nRequirement: 140, group: 'getreide', yieldUnit: 'dt/ha' },
  oats: { duevName: 'Hafer', referenceYield: 55, nRequirement: 130, group: 'getreide', yieldUnit: 'dt/ha' },
  grain_maize: { duevName: 'Körnermais', referenceYield: 90, nRequirement: 200, group: 'getreide', yieldUnit: 'dt/ha' },
  sunflower: { duevName: 'Sonnenblume', referenceYield: 30, nRequirement: 120, group: 'getreide', yieldUnit: 'dt/ha' },
  winter_rapeseed: { duevName: 'Winterraps', referenceYield: 40, nRequirement: 200, group: 'raps', yieldUnit: 'dt/ha' },
  silage_maize: { duevName: 'Silomais', referenceYield: 450, nRequirement: 200, group: 'silomais', yieldUnit: 'dt FM/ha' },
  sugar_beet: { duevName: 'Zuckerrübe', referenceYield: 650, nRequirement: 170, group: 'zuckerrueben', yieldUnit: 'dt FM/ha' },
  potatoes: { duevName: 'Kartoffel', referenceYield: 450, nRequirement: 180, group: 'kartoffeln', yieldUnit: 'dt FM/ha' },
  peas: { duevName: 'Erbsen', referenceYield: 40, nRequirement: 0, group: 'leguminosen', yieldUnit: 'dt/ha' },
  field_beans: { duevName: 'Ackerbohnen', referenceYield: 40, nRequirement: 0, group: 'leguminosen', yieldUnit: 'dt/ha' },
  soybeans: { duevName: 'Sojabohnen', referenceYield: 28, nRequirement: 0, group: 'leguminosen', yieldUnit: 'dt/ha' },
  lupins: { duevName: 'Lupinen', referenceYield: 35, nRequirement: 0, group: 'leguminosen', yieldUnit: 'dt/ha' },
  alfalfa: { duevName: 'Luzerne', referenceYield: 110, nRequirement: 0, group: 'leguminosen', yieldUnit: 'dt TM/ha' },
  field_grass: { duevName: 'Ackergras 3–4 Schnitte', referenceYield: 120, nRequirement: 310, group: 'grassland', yieldUnit: 'dt TM/ha', grassland: { referenceProtein: 16.2, per10dt: 24, per1rp: 13 } },
  grassland: { duevName: 'Grünland 4 Schnitte', referenceYield: 90, nRequirement: 245, group: 'grassland', yieldUnit: 'dt TM/ha', grassland: { referenceProtein: 17, per10dt: 27, per1rp: 14 } },
};

/** N delivered by the previous crop (DüV Anlage 4 Tabelle 7), kg N/ha. */
export const PREVIOUS_CROP_DEDUCTION: Record<string, number> = {
  winter_rapeseed: 10,
  spring_rapeseed: 10,
  sugar_beet: 10,
  peas: 10,
  field_beans: 10,
  soybeans: 10,
  lupins: 10,
  field_grass: 10,
  alfalfa: 20,
  clover_grass: 20,
  grassland: 20,
};

/** Yield corrections for arable crops (DüV Anlage 4 Tabelle 3): per yield step, surcharge and deduction. */
const YIELD_CORRECTION: Record<Exclude<CropGroup, 'grassland'>, { step: number; surcharge: number; deduction: number }> = {
  getreide: { step: 10, surcharge: 10, deduction: 15 },
  raps: { step: 5, surcharge: 10, deduction: 15 },
  silomais: { step: 50, surcharge: 10, deduction: 15 },
  zuckerrueben: { step: 100, surcharge: 10, deduction: 15 },
  kartoffeln: { step: 50, surcharge: 10, deduction: 10 },
  leguminosen: { step: 10, surcharge: 0, deduction: 0 },
};
/** Upper limit of yield surcharges for arable crops, kg N/ha (DüV Anlage 4 Tabelle 3). */
const MAX_YIELD_SURCHARGE = 40;

/**
 * Share of last year's organic total N credited to this year's crop. 10 % in general; lower for
 * slowly mineralizing fertilizers (compost, sewage sludge 3 %, digestate 5 %, pig manure 7 %).
 */
export const ORGANIC_FOLLOW_UP_SHARE: Record<string, number> = {
  compost: 0.03,
  sewage_sludge: 0.03,
  digestate_liquid: 0.05,
  digestate_solid: 0.05,
  pig_slurry: 0.07,
  pig_liquid_manure: 0.07,
  pig_solid_manure: 0.07,
  other_organic: 0.03,
};
export const organicFollowUpShare = (type: string | null | undefined) => (type ? (ORGANIC_FOLLOW_UP_SHARE[type] ?? 0.1) : 0.1);

/** Default Nmin by soil class when there is neither a sample nor a reference value (estimate only). */
export const DEFAULT_NMIN: Record<SoilClass, number> = { light: 25, medium: 35, heavy: 45 };

/** N supplied by a catch crop to the following main crop (DüV Anlage 4 Tabelle 7). */
export function catchCropDeduction(catchCrop: { legume: boolean; winterHardy: boolean } | null): number {
  if (!catchCrop) return 0;
  // Incorporated in spring when it survives the winter, otherwise frozen off.
  if (catchCrop.winterHardy) return catchCrop.legume ? 40 : 20;
  return catchCrop.legume ? 10 : 0;
}

export interface NNeedInput {
  cropCode: string;
  expectedYieldTHa: number;
  nmin: number;
  humusPct: number;
  previousCropCode: string | null;
  catchCrop: { legume: boolean; winterHardy: boolean } | null;
  /** kg N/ha of last year's organic N credited (already multiplied by the follow-up share). */
  organicPreviousYearDeduction: number;
  filmOrFleece: boolean;
  proteinPct: number | null;
  nitrateSensitiveZone: boolean;
}

const r1 = (v: number) => Math.round(v * 10) / 10;

export function nitrogenNeed(input: NNeedInput): NNeedResult | null {
  const crop = DUEV_CROPS[input.cropCode];
  if (!crop) return null;
  // Yields are recorded in t/ha fresh mass; grassland is assessed in dt dry matter (18 % DM).
  const dtFm = input.expectedYieldTHa * 10;
  const expectedYield = r1(crop.grassland ? dtFm * 0.18 : dtFm);
  const diff = expectedYield - crop.referenceYield;
  let yieldCorrection: number;
  if (crop.grassland) {
    yieldCorrection = (diff / 10) * crop.grassland.per10dt;
    if (input.proteinPct != null) yieldCorrection += (input.proteinPct - crop.grassland.referenceProtein) * crop.grassland.per1rp;
  } else {
    const c = YIELD_CORRECTION[crop.group as Exclude<CropGroup, 'grassland'>];
    const steps = diff / c.step;
    // Only full yield steps count, in either direction.
    yieldCorrection = steps > 0 ? Math.min(Math.floor(steps) * c.surcharge, MAX_YIELD_SURCHARGE) : Math.ceil(steps) * c.deduction || 0;
  }
  const humusDeduction = input.humusPct > 4 ? 20 : 0;
  const previousCropDeduction = input.previousCropCode ? (PREVIOUS_CROP_DEDUCTION[input.previousCropCode] ?? 0) : 0;
  const catchCrop = catchCropDeduction(input.catchCrop);
  const filmSurcharge = input.filmOrFleece ? 20 : 0;
  const needBeforeZone = Math.max(
    r1(crop.nRequirement + yieldCorrection - input.nmin - humusDeduction - input.organicPreviousYearDeduction - previousCropDeduction - catchCrop + filmSurcharge),
    0,
  );
  // Nitrate-polluted areas (DüV §13a Abs. 2 Nr. 1): 20 % below the calculated need.
  const zoneReduction = input.nitrateSensitiveZone ? r1(needBeforeZone * 0.2) : 0;
  return {
    duevCrop: crop.duevName,
    yieldUnit: crop.yieldUnit,
    referenceYield: crop.referenceYield,
    nRequirement: crop.nRequirement,
    expectedYield,
    yieldCorrection: r1(yieldCorrection),
    nmin: r1(input.nmin),
    humusDeduction,
    organicPreviousYearDeduction: r1(input.organicPreviousYearDeduction),
    previousCropDeduction,
    catchCropDeduction: catchCrop,
    filmSurcharge,
    needBeforeZone,
    zoneReduction,
    need: r1(needBeforeZone - zoneReduction),
  };
}
