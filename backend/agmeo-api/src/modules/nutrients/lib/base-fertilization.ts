/**
 * Phosphate, potash and magnesium need by removal and soil content class, and the lime requirement
 * (VDLUFA standpoints; DüV Anlage 7 removal values), ported from AGVOLUTION/agmeo
 * (src/lib/farmalyzer/baseFertilization.ts). P classes use mg P/100 g (VDLUFA 2018); lab values in
 * mg P2O5/100 g are converted.
 */
import type { ContentClass, PhMethod, PkNeedResult, SoilClass } from '@agmeo/contracts';

type Contents = { p2o5: number; k2o: number; mgo: number };
interface CropRemoval {
  /** kg per dt of main product (fresh mass). */
  main: Contents;
  /** kg per dt of by-product (straw, leaves). */
  byProduct?: Contents;
  /** dt by-product per dt main product. */
  ratio: number;
}

const WHEAT: CropRemoval = { main: { p2o5: 0.8, k2o: 0.55, mgo: 0.2 }, byProduct: { p2o5: 0.3, k2o: 1.7, mgo: 0.2 }, ratio: 0.8 };
const BARLEY_W: CropRemoval = { main: { p2o5: 0.8, k2o: 0.6, mgo: 0.2 }, byProduct: { p2o5: 0.3, k2o: 1.6, mgo: 0.15 }, ratio: 0.7 };
const RYE: CropRemoval = { main: { p2o5: 0.8, k2o: 0.6, mgo: 0.15 }, byProduct: { p2o5: 0.3, k2o: 1.5, mgo: 0.15 }, ratio: 0.9 };
const TRITICALE: CropRemoval = { main: { p2o5: 0.8, k2o: 0.6, mgo: 0.15 }, byProduct: { p2o5: 0.3, k2o: 1.6, mgo: 0.15 }, ratio: 0.9 };
const OATS: CropRemoval = { main: { p2o5: 0.8, k2o: 0.55, mgo: 0.15 }, byProduct: { p2o5: 0.3, k2o: 1.8, mgo: 0.2 }, ratio: 1.1 };
const RAPE: CropRemoval = { main: { p2o5: 1.8, k2o: 1.0, mgo: 0.55 }, byProduct: { p2o5: 0.4, k2o: 2.5, mgo: 0.2 }, ratio: 1.7 };
const LEGUME: CropRemoval = { main: { p2o5: 1.1, k2o: 1.2, mgo: 0.25 }, byProduct: { p2o5: 0.3, k2o: 1.0, mgo: 0.3 }, ratio: 1.0 };
const GRASS: CropRemoval = { main: { p2o5: 0.18, k2o: 0.73, mgo: 0.07 }, ratio: 0 };

export const CROP_REMOVAL: Record<string, CropRemoval> = {
  winter_wheat: WHEAT,
  spring_wheat: WHEAT,
  winter_spelt: WHEAT,
  winter_barley: BARLEY_W,
  spring_barley: { ...BARLEY_W },
  winter_rye: RYE,
  triticale: TRITICALE,
  oats: OATS,
  winter_oats: OATS,
  winter_rapeseed: RAPE,
  spring_rapeseed: RAPE,
  sunflower: { main: { p2o5: 1.6, k2o: 1.3, mgo: 0.65 }, byProduct: { p2o5: 0.2, k2o: 3.5, mgo: 0.4 }, ratio: 2.5 },
  grain_maize: { main: { p2o5: 0.75, k2o: 0.45, mgo: 0.2 }, byProduct: { p2o5: 0.2, k2o: 1.8, mgo: 0.3 }, ratio: 1.0 },
  silage_maize: { main: { p2o5: 0.16, k2o: 0.45, mgo: 0.1 }, ratio: 0 },
  sugar_beet: { main: { p2o5: 0.1, k2o: 0.25, mgo: 0.06 }, byProduct: { p2o5: 0.1, k2o: 0.6, mgo: 0.1 }, ratio: 0.7 },
  potatoes: { main: { p2o5: 0.14, k2o: 0.6, mgo: 0.04 }, byProduct: { p2o5: 0.04, k2o: 0.3, mgo: 0.05 }, ratio: 0.2 },
  peas: LEGUME,
  field_beans: { main: { p2o5: 1.2, k2o: 1.3, mgo: 0.25 }, byProduct: { p2o5: 0.35, k2o: 1.8, mgo: 0.25 }, ratio: 1.2 },
  soybeans: { main: { p2o5: 1.6, k2o: 2.0, mgo: 0.6 }, byProduct: { p2o5: 0.2, k2o: 1.5, mgo: 0.5 }, ratio: 1.0 },
  lupins: { main: { p2o5: 1.1, k2o: 0.9, mgo: 0.4 }, byProduct: { p2o5: 0.3, k2o: 1.0, mgo: 0.3 }, ratio: 1.0 },
  alfalfa: { main: { p2o5: 0.15, k2o: 0.68, mgo: 0.08 }, ratio: 0 },
  field_grass: GRASS,
  clover_grass: GRASS,
  grassland: GRASS,
};

const LEVELS: ContentClass[] = ['A', 'B', 'C', 'D', 'E'];
/** Upper bounds of classes A–D. */
type Bounds = [number, number, number, number];
const classOf = (value: number, bounds: Bounds): ContentClass => {
  const i = bounds.findIndex((b) => value < b);
  return LEVELS[i === -1 ? 4 : i];
};

export const P2O5_TO_P = 0.4364;
/** mg P/100 g (CAL), normal and dry (< 550 mm) sites. */
const P_BOUNDS: Record<'normal' | 'dry', Bounds> = { normal: [1.5, 3, 6, 12], dry: [2.5, 5, 7.5, 12] };
/** mg K2O/100 g (CAL) by soil class. */
const K_BOUNDS: Record<SoilClass, Bounds> = { light: [4, 10, 20, 35], medium: [5, 12, 25, 40], heavy: [6, 15, 30, 50] };
/** mg MgO/100 g (CaCl2) by soil class. */
const MG_BOUNDS: Record<SoilClass, Bounds> = { light: [2, 4, 8, 15], medium: [3, 5, 10, 20], heavy: [4, 8, 15, 25] };
const P_FACTOR: Record<ContentClass, number> = { A: 2, B: 1.5, C: 1, D: 0.5, E: 0 };
const K_FACTOR: Record<ContentClass, number> = { A: 1.8, B: 1.3, C: 1, D: 0.5, E: 0 };
const MG_FACTOR = P_FACTOR;

export const pClass = (p2o5Mg100g: number, site: 'normal' | 'dry' = 'normal') => classOf(p2o5Mg100g * P2O5_TO_P, P_BOUNDS[site]);
export const kClass = (k2oMg100g: number, soil: SoilClass) => classOf(k2oMg100g, K_BOUNDS[soil]);
export const mgClass = (mgoMg100g: number, soil: SoilClass) => classOf(mgoMg100g, MG_BOUNDS[soil]);

/** Target pH (CaCl2) of arable mineral soils; lowered on humus-rich soils. */
const PH_TARGET: Record<SoilClass, number> = { light: 5.4, medium: 6.3, heavy: 6.8 };
const PH_OFFSET: Record<PhMethod, number> = { cacl2: 0, h2o: -0.5, kcl: 0.5 };
/** dt CaO/ha per 0.1 pH, over three years. */
const LIME_PER_01: Record<SoilClass, number> = { light: 2, medium: 3, heavy: 5 };

export function phTarget(soil: SoilClass, humusPct: number | null) {
  return PH_TARGET[soil] + (humusPct != null && humusPct > 8 ? -0.4 : humusPct != null && humusPct > 4 ? -0.2 : 0);
}

/** pH class: A/B below target, C at target (within +0.5), D/E above. */
export function phClass(ph: number, method: PhMethod | null, soil: SoilClass, humusPct: number | null): ContentClass {
  const delta = ph + PH_OFFSET[method ?? 'cacl2'] - phTarget(soil, humusPct);
  return delta < -0.5 ? 'A' : delta < 0 ? 'B' : delta <= 0.5 ? 'C' : delta <= 1 ? 'D' : 'E';
}

/** Lime requirement in dt CaO/ha over three years, or null without a pH value. */
export function limeRequirement(ph: number | null, method: PhMethod | null, soil: SoilClass, humusPct: number | null): number | null {
  if (ph == null) return null;
  const delta = phTarget(soil, humusPct) - (ph + PH_OFFSET[method ?? 'cacl2']);
  return delta <= 0 ? 0 : Math.round(delta * 10 * LIME_PER_01[soil]);
}

const r1 = (v: number) => Math.round(v * 10) / 10;

/**
 * P2O5, K2O and MgO need: removal by the expected yield (with by-products when they leave the field)
 * times the factor of the soil content class. Without a soil analysis the removal is the need (class C).
 */
export function baseFertilizationNeed(
  cropCode: string,
  expectedYieldTHa: number,
  byProductRemoved: boolean,
  soil: SoilClass,
  analysis: { p2o5Mg100g: number | null; k2oMg100g: number | null; mgoMg100g: number | null } | null,
): PkNeedResult[] {
  const crop = CROP_REMOVAL[cropCode];
  if (!crop) return [];
  const dt = expectedYieldTHa * 10;
  const removal = (k: keyof Contents) => r1(crop.main[k] * dt + (byProductRemoved && crop.byProduct ? crop.byProduct[k] * dt * crop.ratio : 0));
  const row = (nutrient: PkNeedResult['nutrient'], cls: ContentClass | null, factors: Record<ContentClass, number>): PkNeedResult => {
    const factor = factors[cls ?? 'C'];
    const rem = removal(nutrient);
    return { nutrient, removal: rem, contentClass: cls, factor, need: r1(rem * factor) };
  };
  return [
    row('p2o5', analysis?.p2o5Mg100g != null ? pClass(analysis.p2o5Mg100g) : null, P_FACTOR),
    row('k2o', analysis?.k2oMg100g != null ? kClass(analysis.k2oMg100g, soil) : null, K_FACTOR),
    row('mgo', analysis?.mgoMg100g != null ? mgClass(analysis.mgoMg100g, soil) : null, MG_FACTOR),
  ];
}
