/**
 * Ported from AGVOLUTION/agmeo src/lib/irrigation/waterBalance.ts — logic, numbers and
 * thresholds unchanged; only imports adapted to the rewrite.
 */

import { cropProxy, type SupportedCrops } from '../crops.js';
import { dayOfYearUtc } from '../dates.js';
import { clip } from '../util.js';

// ── Types ──

export type WaterBalanceParams = {
  fc: number; // field capacity for root zone (mm)
  pwp: number; // permanent wilting point for root zone (mm)
  p?: number; // FAO-56 depletion fraction (defaults to 0.5)
  /**
   * "Today" as yyyy-mm-dd. Days after it are flagged `forecast: true` and it
   * anchors `currentDeficit`. Defaults to the wall clock — inject in tests.
   */
  todayOverride?: string;
  /**
   * Surface-layer parameters for the FAO-56 dual-Kc approach (Ch. 7). When
   * provided, ETa is split into transpiration (Ks · Kcb · ET0) plus surface
   * evaporation (Ke · ET0), driven by a separate top-layer water balance.
   * If absent, the model runs in single-Kc mode with a flat 15% soil-evap
   * floor (less accurate but FAO-acceptable for "mean" calculations).
   */
  surface?: {
    tew: number; // total evaporable water in top layer (mm), Eq. 73
    rew: number; // readily evaporable water (mm), Table 19
    de0?: number; // initial depletion of TEW (mm), defaults to 0.5·TEW
  };
};

export type WaterBalanceInput = {
  date: string;
  precipitation: number; // mm
  et0: number; // reference evapotranspiration (mm)
  kc: number; // crop coefficient (from NDVI or default)
  /**
   * Explicit basal crop coefficient. Dual-Kc mode uses it instead of
   * kcbFromKc(kc). Pass 0 for bare soil (pre-sowing): transpiration off,
   * only Ke surface evaporation runs.
   */
  kcb?: number;
  irrigation: number; // mm applied
};

export type WaterBalanceDay = {
  date: string;
  swc: number; // soil water content (mm)
  eta: number; // actual ET = Kc × ET0 (mm)
  precipitation: number;
  irrigation: number;
  drainage: number;
  deficit: number; // FC − SWC (mm)
  /** Set on days after "today" — simulated from weather forecast, not observations. */
  forecast?: boolean;
};

export type DeficitLevel = 'ok' | 'warning' | 'critical';

export type WaterBalanceResult = {
  days: WaterBalanceDay[];
  currentDeficit: number;
  deficitLevel: DeficitLevel;
  totalIrrigated: number;
  totalEta: number;
  totalPrecipitation: number;
};

// ── Winter crop detection ──

export function isWinterCrop(crop: SupportedCrops | null): boolean {
  if (!crop) return false;
  return (
    crop.includes('winter') || crop === 'canola' || crop === 'triticaleFodder'
  );
}

// ── Soil-water bucket depth — FALLBACK ONLY ──
//
// The bucket depth is the crop's effective rooting depth from FAO-56 Table 22
// (see ROOT_DEPTH_BY_CROP / getRootDepth below). This value is only the fallback
// for entries Table 22 has no row for and we have no analogue for: set-aside /
// ecological focus area, landscape features, grass seed, the intercrops, and
// fields with no crop assigned at all.
//
// 1.20 m rather than a topsoil depth, because none of these are bare ground in
// practice: German set-aside is self-greening or sown to a mixture, and cover
// crops like oil radish or fodder rye root deeper than most main crops. It sits
// inside Table 22's grazing-pasture span (0.5-1.5 m), which is the closest listed
// analogue for mixed permanent cover. The one case it overstates is a genuinely
// black, vegetation-free fallow — there are no roots there and the only loss is
// surface evaporation. That case is rare here and not separately modelled.
//
// It used to be 0.30 m for EVERY crop, justified by the BFH/AgriAqua rooting
// table, which lists every crop in our SupportedCrops enum at 30 cm. That table
// and FAO-56 Table 22 disagree by a factor of 3-5 (winter wheat 0.30 m vs
// 1.5-1.8 m), which is not a tolerance — one of them is not an effective rooting
// depth. Measured consequence of the old uniform 0.30 m on an 18 ha Lu field over
// 253 days: the bucket sat at PWP on 22 of them and ETa/ET0 came out at 0.65,
// i.e. the model starved the crop through the summer while water was still in the
// profile. Table 22 is the reference now; θ still comes from the texture.
//
// Survey-provided zone nFK overrides bypass the depth entirely (see
// BuildFieldWaterBalanceInput.awcMmOverride) — a measured nFK already contains
// stone content and the real rooting depth.
export const BUCKET_DEPTH_M = 1.2;

/**
 * Topsoil depth for the trafficability / machine-compaction path (m).
 *
 * NOT a rooting depth and deliberately not derived from one. `precompression`
 * and `thetaToPF` describe the compaction behaviour of the plough layer, and
 * `applyMachineLoad` evaluates axle stress at 0.25 m — the topsoil yield
 * horizon. They need the water content of THAT layer.
 *
 * Feeding them the root-zone mean instead makes the traffic light depth- and
 * crop-dependent and mutes it exactly when it matters: 25 mm of rain lifts a
 * 1.8 m wheat profile by ~1.4 vol-% while the seedbed goes to field capacity,
 * so a wet topsoil would still read as trafficable. Two neighbouring fields
 * with identical topsoil moisture would also disagree because one grows wheat
 * and the other potatoes.
 *
 * The proper fix is to surface the dual-Kc surface-layer state (De/TEW) as a
 * real topsoil water content; until then a second bucket at plough depth
 * reproduces what trafficability was fed before the root zone became
 * crop-specific.
 */
export const TOPSOIL_DEPTH_M = 0.3;

// ── LUFA soil type → hydraulic properties (KA5/AG Boden standard values) ──

/**
 * Typical theta_fc and theta_pwp (vol-%) per LUFA soil type group.
 * Source: AG Boden (2005), KA5 Tab. 70; KTBL Datensammlung.
 * Values represent topsoil (0-30 cm) midpoint estimates.
 */
export const LUFA_HYDRAULIC_PARAMS: Record<
  string,
  { thetaFc: number; thetaPwp: number }
> = {
  S: { thetaFc: 12, thetaPwp: 3 }, // Sand
  lS: { thetaFc: 18, thetaPwp: 5 }, // lehmiger Sand
  sU: { thetaFc: 28, thetaPwp: 6 }, // sandiger Schluff
  ssL: { thetaFc: 25, thetaPwp: 8 }, // stark sandiger Lehm
  lU: { thetaFc: 33, thetaPwp: 8 }, // lehmiger Schluff
  sL: { thetaFc: 27, thetaPwp: 10 }, // sandiger Lehm
  uL: { thetaFc: 34, thetaPwp: 13 }, // schluffiger Lehm
  L: { thetaFc: 32, thetaPwp: 14 }, // Lehm
  utL: { thetaFc: 36, thetaPwp: 15 }, // schluffig-toniger Lehm
  tL: { thetaFc: 35, thetaPwp: 19 }, // toniger Lehm
  T: { thetaFc: 38, thetaPwp: 25 }, // Ton
};

// ── AWC computation ──

/**
 * Convert volumetric water content (%) to mm for a given soil depth.
 * theta_pct is in % (0-100), depthM is in meters.
 */
export function thetaToMm(thetaPct: number, depthM: number): number {
  return thetaPct * 10 * depthM;
}

/**
 * Compute Available Water Capacity (AWC) in mm from soil hydraulic params.
 * Returns { fc, pwp } both in mm for the given root zone depth.
 */
export function computeAWC(
  thetaFc: number,
  thetaPwp: number,
  depthM: number,
): { fc: number; pwp: number; awc: number } {
  const fc = thetaToMm(thetaFc, depthM);
  const pwp = thetaToMm(thetaPwp, depthM);
  return { fc, pwp, awc: fc - pwp };
}

// ── Kc from NDVI (FAO linear mapping) ──

/**
 * Derive crop coefficient Kc from NDVI using the standard linear relationship.
 * Clamped to [0.15, 1.2] — bare soil ≈ 0.15, full canopy ≈ 1.2.
 */
export function kcFromNDVI(ndvi: number): number {
  return Math.max(0.15, Math.min(1.2, 1.25 * ndvi + 0.2));
}

/** Default Kc when no BBCH or NDVI is available. */
export const DEFAULT_KC = 0.6;

/** Kc for bare soil before sowing (matches the kcFromNDVI floor). */
export const BARE_SOIL_KC = 0.15;

// ── Kc from BBCH (FAO-56 dual crop coefficient adapted for BBCH scale) ──

/**
 * Crop-specific Kc values per FAO-56 growth phase.
 * Kc_ini: sowing to ~10% ground cover (BBCH 00–19)
 * Kc_mid: full canopy to start of senescence (BBCH 30–69)
 * Kc_end: senescence to harvest (BBCH 80–97)
 *
 * Between phases, Kc is linearly interpolated via BBCH.
 * Sources: FAO-56 Table 12; Allen et al. 1998; KTBL.
 */
const KC_DEFAULTS = { ini: 0.3, mid: 1.1, end: 0.3 };

const KC_BY_CROP: Partial<
  Record<SupportedCrops, { ini: number; mid: number; end: number }>
> = {
  winterWheat: { ini: 0.3, mid: 1.15, end: 0.25 },
  winterBarleyFodder: { ini: 0.3, mid: 1.15, end: 0.25 },
  winterRyeBaking: { ini: 0.3, mid: 1.15, end: 0.25 },
  triticaleFodder: { ini: 0.3, mid: 1.15, end: 0.25 },
  spelt: { ini: 0.3, mid: 1.15, end: 0.25 },
  hardWheat: { ini: 0.3, mid: 1.15, end: 0.25 },
  springBarleyMalting: { ini: 0.3, mid: 1.15, end: 0.25 },
  springOatsFodder: { ini: 0.3, mid: 1.15, end: 0.25 },
  canola: { ini: 0.35, mid: 1.15, end: 0.35 },
  silageMaize: { ini: 0.3, mid: 1.2, end: 0.6 },
  grainMaize: { ini: 0.3, mid: 1.2, end: 0.35 },
  sugarBeet: { ini: 0.35, mid: 1.2, end: 0.7 },
  potatoTableLate: { ini: 0.4, mid: 1.15, end: 0.75 },
  sunflower: { ini: 0.3, mid: 1.0, end: 0.35 },
  soybeanBeans: { ini: 0.3, mid: 1.15, end: 0.5 },
  peasDry: { ini: 0.4, mid: 1.15, end: 0.3 },
  peasDryFodder: { ini: 0.4, mid: 1.15, end: 0.3 },
  broadBeans: { ini: 0.4, mid: 1.15, end: 0.3 },
  lupine: { ini: 0.4, mid: 1.15, end: 0.3 },
  alfalfa: { ini: 0.4, mid: 1.2, end: 1.1 },
  fieldGrassWiltedSilage: { ini: 0.3, mid: 1.0, end: 0.85 },
  permanentGrasslandWiltedSilage: { ini: 0.3, mid: 1.0, end: 0.85 },
};

/**
 * Derive crop coefficient Kc from BBCH growth stage.
 *
 * BBCH → FAO phase mapping:
 *   00–09  Germination       → Kc_ini
 *   10–19  Leaf development  → Kc_ini → ramp up starts
 *   20–29  Tillering         → linear ramp Kc_ini → Kc_mid
 *   30–59  Stem elong./Boot. → Kc_mid (full canopy)
 *   60–69  Flowering         → Kc_mid
 *   70–79  Grain fill        → linear ramp Kc_mid → Kc_end
 *   80–97  Ripening/Harvest  → Kc_end
 */
export function kcFromBbch(bbch: number, crop: SupportedCrops | null): number {
  const kc = (crop && KC_BY_CROP[crop]) || KC_DEFAULTS;

  if (bbch < 10) return kc.ini;
  if (bbch < 30) return kc.ini + ((bbch - 10) / 20) * (kc.mid - kc.ini);
  if (bbch < 70) return kc.mid;
  if (bbch < 80) return kc.mid + ((bbch - 70) / 10) * (kc.end - kc.mid);
  return kc.end;
}

// ── Crop max height (FAO-56 Table 12) ──
//
// Typical maximum crop height during mid-season, used by the climate
// adjustment (Eq. 70). Values from FAO-56 Table 12 / KTBL.
const DEFAULT_CROP_HEIGHT = 0.6;

const CROP_HEIGHTS: Partial<Record<SupportedCrops, number>> = {
  winterWheat: 1.0,
  winterBarleyFodder: 1.0,
  winterRyeBaking: 1.4,
  triticaleFodder: 1.2,
  spelt: 1.1,
  hardWheat: 1.0,
  springBarleyMalting: 1.0,
  springOatsFodder: 1.0,
  canola: 0.6,
  silageMaize: 2.0,
  grainMaize: 2.0,
  sugarBeet: 0.5,
  potatoTableLate: 0.6,
  sunflower: 2.0,
  soybeanBeans: 0.5,
  peasDry: 0.5,
  peasDryFodder: 0.5,
  broadBeans: 0.8,
  lupine: 0.8,
  alfalfa: 0.7,
  fieldGrassWiltedSilage: 0.4,
  permanentGrasslandWiltedSilage: 0.4,
};

export function getCropHeight(crop: SupportedCrops | null): number {
  if (!crop) return DEFAULT_CROP_HEIGHT;
  return CROP_HEIGHTS[crop] ?? DEFAULT_CROP_HEIGHT;
}

// ── Saturation vapor pressure (FAO-56 Eq. 11) ──
//
// e°(T) in kPa for temperature T in °C. Used to convert dew-point to RH_min:
// RH_min ≈ 100 · e°(T_dew) / e°(T_max).
export function saturationVaporPressure(tempC: number): number {
  return 0.6108 * Math.exp((17.27 * tempC) / (tempC + 237.3));
}

export function estimateRHmin(
  tempMax: number | null | undefined,
  dewPointMean: number | null | undefined,
  humidityMean: number | null | undefined,
): number {
  if (dewPointMean != null && tempMax != null && tempMax > -50) {
    const ratio =
      saturationVaporPressure(dewPointMean) / saturationVaporPressure(tempMax);
    return Math.max(5, Math.min(95, 100 * ratio));
  }
  // Fall back to a rough rule of thumb: RH_min ≈ RH_mean − 15 percentage points.
  if (humidityMean != null) return Math.max(5, Math.min(95, humidityMean - 15));
  return 45; // FAO baseline
}

// ── Kc climate adjustment (FAO-56 Eq. 70) ──
//
// Adjusts Kc_mid / Kc_end for non-baseline climate (RH_min ≠ 45%, u₂ ≠ 2 m/s).
// Only applied when the standard Kc value is ≥ 0.45 (i.e. mid- and late-season
// portions of the curve, not the initial bare-soil phase).
//
//   ΔKc = [0.04(u₂ − 2) − 0.004(RH_min − 45)] · (h/3)^0.3
export function kcClimateAdjustment(
  h: number,
  u2: number,
  rhMin: number,
): number {
  const hClamped = Math.max(0.05, h);
  return (0.04 * (u2 - 2) - 0.004 * (rhMin - 45)) * Math.pow(hClamped / 3, 0.3);
}

export function adjustKcForClimate(
  baseKc: number,
  h: number,
  u2: number,
  rhMin: number,
): number {
  if (baseKc < 0.45) return baseKc;
  return Math.max(0, baseKc + kcClimateAdjustment(h, u2, rhMin));
}

// ── Surface-layer parameters (FAO-56 Ch. 7) ──
//
// Top-layer evaporation is governed by Total Evaporable Water (TEW) and
// Readily Evaporable Water (REW). TEW = (θ_FC − 0.5·θ_PWP) · Z_e (Eq. 73);
// REW is texture-specific (Table 19, 5–12 mm). Z_e ≈ 0.10–0.15 m (Table 19).
export const Z_E_DEFAULT_M = 0.15;

/**
 * TEW in mm for the top Z_e meters of soil. θ values are in vol-% (0–100),
 * matching LUFA_HYDRAULIC_PARAMS. Eq. 73: TEW = 1000·(θ_FC − 0.5·θ_PWP)·Z_e.
 */
export function computeTEW(
  thetaFcPct: number,
  thetaPwpPct: number,
  zeM: number = Z_E_DEFAULT_M,
): number {
  return Math.max(0, 10 * (thetaFcPct - 0.5 * thetaPwpPct) * zeM);
}

/**
 * Readily Evaporable Water (mm) per LUFA texture group, midpoint of FAO-56
 * Table 19 ranges. Sand drains fast → low REW; clay holds wetter → high REW.
 */
const REW_BY_LUFA: Record<string, number> = {
  S: 5,
  lS: 7,
  sU: 8,
  ssL: 8,
  lU: 10,
  sL: 8,
  uL: 10,
  L: 9,
  utL: 11,
  tL: 11,
  T: 12,
};

export function getREW(soilTypeLUFA: string | null | undefined): number {
  if (!soilTypeLUFA) return 9;
  return REW_BY_LUFA[soilTypeLUFA] ?? 9;
}

/**
 * Texture-based REW (mm), FAO-56 Table 19. Used when LUFA code is unavailable
 * and clay/sand fractions come from the soil-overview pipeline.
 */
export function getREWFromTexture(
  clayPct: number | null,
  sandPct: number | null,
): number {
  if (clayPct == null && sandPct == null) return 9;
  const clay = clayPct ?? 0;
  const sand = sandPct ?? 0;
  if (clay > 35) return 11;
  if (sand > 65) return 5;
  if (sand > 50) return 7;
  return 9;
}

/**
 * Approximate basal Kcb from a single-Kc-curve value. Table 17 (Kcb) is
 * roughly Table 12 (Kc) minus 0.05 in mid-season, with a 0.15 minimum
 * to avoid driving transpiration to zero before Kcb_ini is reached.
 */
export function kcbFromKc(kc: number): number {
  return Math.max(0.15, kc - 0.05);
}

// ── Depletion fraction p — FAO-56 Ch. 8 Table 22 ──
//
// p is the fraction of TAW the crop can extract before suffering water stress.
// Below depletion p · TAW (Readily Available Water), Ks = 1 (no stress); above
// it, Ks declines linearly to 0 at PWP. Default 0.50 covers cereals/maize/beet.
const DEFAULT_DEPLETION_FRACTION = 0.5;

const DEPLETION_FRACTIONS: Partial<Record<SupportedCrops, number>> = {
  winterWheat: 0.55,
  winterBarleyFodder: 0.55,
  winterRyeBaking: 0.55,
  triticaleFodder: 0.55,
  spelt: 0.55,
  hardWheat: 0.55,
  springBarleyMalting: 0.55,
  springOatsFodder: 0.55,
  canola: 0.6,
  silageMaize: 0.55,
  grainMaize: 0.55,
  sugarBeet: 0.55,
  potatoTableLate: 0.35,
  sunflower: 0.45,
  soybeanBeans: 0.5,
  peasDry: 0.4,
  peasDryFodder: 0.4,
  broadBeans: 0.45,
  lupine: 0.5,
  alfalfa: 0.55,
  fieldGrassWiltedSilage: 0.6,
  permanentGrasslandWiltedSilage: 0.6,
};

export function getDepletionFraction(crop: SupportedCrops | null): number {
  if (!crop) return DEFAULT_DEPLETION_FRACTION;
  return DEPLETION_FRACTIONS[crop] ?? DEFAULT_DEPLETION_FRACTION;
}

// ── Effective rooting depth Zr — FAO-56 Table 22, same table as p above ──
//
// Zr is the depth the water-balance bucket integrates over. Table 22 gives a
// RANGE per crop (soil and management vary); the values below are the UPPER end
// of each range, on the reasoning that German arable soils rarely carry a
// restricting layer inside the rooting zone, so the crop reaches the deep end of
// the published span. Two entries are agronomic decisions rather than table
// reads and are marked as such — do not describe those two as FAO-56 values.
// Crops with no Table 22 row (rye, triticale, spelt, lupin) use the nearest
// listed analogue, named per entry; everything else falls back to
// BUCKET_DEPTH_M.
//
// Callers: changing a depth here changes what `swc` is integrated over, so every
// consumer that converts mm back to a volumetric θ must divide by the SAME
// depth — and must first ask whether the root zone is the layer it means at all.
// Trafficability does not: it reads the separate TOPSOIL_DEPTH_M series, because
// a compaction model evaluated at 0.25 m needs plough-layer water, not a profile
// mean that barely moves after rain.
//
// Two limits of this implementation, stated rather than hidden:
//
//  1. Zr in Table 22 is the MAXIMUM effective depth at full canopy. FAO-56 grows
//     the root zone from ~0.1-0.3 m over the development period; a constant Zr
//     lets a November-sown cereal draw from 1.80 m before it has roots there.
//     Making Zr follow development requires a BBCH course for every crop, and
//     bbchModel.ts has CROP_PARAMS for ten of them (potato is not among them).
//  2. θ_FC and θ_PWP come from wostenTopsoilHydraulics — the Wösten (1999)
//     TOPSOIL coefficient set. Applying topsoil θ down to 1.80 m overstates the
//     subsoil, which is denser, lower in organic matter and usually holds less
//     plant-available water. Wösten publishes a separate subsoil set; until it
//     is wired in, deep-rooting crops carry an optimistic reservoir.
const ROOT_DEPTH_BY_CROP: Partial<Record<SupportedCrops, number>> = {
  // Winter Wheat 1.5-1.8
  winterWheat: 1.8,
  spelt: 1.8, // no row; wheat analogue
  winterRyeBaking: 1.8, // no row; winter-cereal analogue
  triticaleFodder: 1.8, // no row; winter-cereal analogue
  // Barley 1.0-1.5 / Oats 1.0-1.5 / Spring Wheat 1.0-1.5
  winterBarleyFodder: 1.5,
  springBarleyMalting: 1.5,
  springOatsFodder: 1.5,
  springWheatFodder: 1.5,
  // Durum sits under the SPRING row on purpose: cropCalendar sows it on 20 Mar
  // with CEREAL_SPRING_STAGES and isWinterCrop() returns false, so a
  // winter-wheat profile would be a depth the modelled crop never grows.
  hardWheat: 1.5,
  // Listed explicitly to BLOCK the cropProxy hop below. cropProxy answers "which
  // crop's model data may I borrow" and sends these three onto winter cereals;
  // for rooting depth that is the wrong question, and they would inherit 1.8 m
  // despite carrying CEREAL_SPRING_STAGES in the crop calendar.
  springRye: 1.5,
  springTriticale: 1.5,
  springDurum: 1.5,
  ryeWholePlantSilage: 1.5, // no row; small-grain analogue
  // Maize, Field (grain) 1.0-1.7
  grainMaize: 1.7,
  // Rice 0.5-1.0; listed to block the cropProxy hop onto maize
  rice: 0.8,
  silageMaize: 1.7,
  // Rapeseed, Canola 1.0-1.5
  canola: 1.5,
  // Sunflower 0.8-1.5
  sunflower: 1.5,
  // Soybeans 0.6-1.3
  soybeanBeans: 1.3,
  // DECISION, not Table 22: sugar beet sits at 1.10, inside the published
  // 0.7-1.2 span but deliberately below its top.
  sugarBeet: 1.1,
  // DECISION, NOT Table 22 — and outside it. Table 22 gives potato 0.4-0.6 m,
  // which is also the agronomic consensus (shallow, dense root system). 1.00 m
  // is set here because the shallow bucket left the layer without a usable
  // irrigation signal. Consequence to keep in view: at 1.00 m the model can draw
  // water from twice the depth the crop actually roots in, so it will UNDERSTATE
  // potato drought stress — the opposite of the error this table fixes for
  // cereals. Measured on one Lu season: days at 0 % nFK go 17 -> 0, and a real
  // irrigation demand disappears with them.
  potatoTableLate: 1.0,
  // Peas, Dry/Seed 0.6-1.0
  peasDry: 1.0,
  peasDryFodder: 1.0,
  // Fababean (broad bean), Dry/Seed 0.5-0.7
  broadBeans: 0.7,
  // no row. Lentil (0.6-0.8) is the nearest Table 22 legume but the wrong
  // analogue: lupin is a taproot crop grown on light, drought-prone sandy soils
  // precisely because that root reaches water shallow-rooted legumes cannot.
  // Placed at the Soybean top (1.3) rather than a literature 1.5+, keeping it
  // inside the range of a crop the table does cover.
  lupine: 1.3,
  // Alfalfa (hay) 1.0-2.0
  alfalfa: 2.0,
  // Grazing Pasture 0.5-1.5
  fieldGrassWiltedSilage: 1.5,
  permanentGrasslandWiltedSilage: 1.5,
};

/** Bounds for a manual per-cultivation override of the depth above. Below 0.1 m
 *  nothing roots; above 3 m no crop in the enum does — Table 22's deepest entry
 *  is alfalfa at 2.0 m. Kept here rather than next to the persistence code so the
 *  table cell can import them without pulling the DB module into the client. */
export const MIN_ROOT_DEPTH_M = 0.1;
export const MAX_ROOT_DEPTH_M = 3;

export function getRootDepth(crop: SupportedCrops | null): number {
  if (!crop) return BUCKET_DEPTH_M;
  const own = ROOT_DEPTH_BY_CROP[crop];
  if (own !== undefined) return own;
  // Crops without model data are not in the table above, but
  // the repo already states what each one behaves like: cropProxy maps every one
  // of them onto a covered crop. Without this hop `potatoStarch` and
  // `maizeBiogas` would fall to the generic fallback — 1.2 m for a potato and
  // 1.2 m for a maize whose own species is listed at 1.7.
  const proxy = cropProxy[crop];
  if (proxy) return ROOT_DEPTH_BY_CROP[proxy] ?? BUCKET_DEPTH_M;
  return BUCKET_DEPTH_M;
}

// ── Water-stress coefficient Ks — FAO-56 Ch. 8 Eq. 84 ──
//
// Ks reduces ETa once root-zone depletion exceeds the readily-available
// threshold (RAW = p · TAW). At depletion = RAW, Ks = 1 (no stress). At
// depletion = TAW (i.e. SWC = PWP), Ks = 0. Linear interpolation between.
//
//   Ks = 1                            when Dr ≤ RAW
//   Ks = (TAW − Dr) / ((1 − p) · TAW) when RAW < Dr < TAW
//   Ks = 0                            when Dr ≥ TAW
export function computeKs(
  swc: number,
  fc: number,
  pwp: number,
  p: number,
): number {
  const taw = fc - pwp;
  if (taw <= 0) return 0;
  const dr = fc - swc;
  const raw = p * taw;
  if (dr <= raw) return 1;
  return clip((taw - dr) / (taw - raw), 0, 1);
}

// ── Soil-evaporation reduction Kr — FAO-56 Ch. 7 Eq. 74 ──
//
// Kr = 1 while De ≤ REW (energy-limited stage 1), then linearly declines to 0
// as De approaches TEW (falling rate stage 2). Returns 0 once the top layer
// is fully evaporated.
export function computeKr(de: number, tew: number, rew: number): number {
  if (tew <= 0 || de >= tew) return 0;
  if (de <= rew) return 1;
  return clip((tew - de) / (tew - rew), 0, 1);
}

// ── Hargreaves ET0 estimation ──

/**
 * Extraterrestrial radiation Ra (MJ/m²/day) via FAO-56 simplified formula.
 * Uses solar constant, inverse relative distance, sunset hour angle.
 */
function extraterrestrialRadiation(lat: number, dayOfYear: number): number {
  const Gsc = 0.082; // solar constant (MJ/m²/min)
  const dr = 1 + 0.033 * Math.cos((2 * Math.PI * dayOfYear) / 365);
  const delta = 0.409 * Math.sin((2 * Math.PI * dayOfYear) / 365 - 1.39);
  const phi = (lat * Math.PI) / 180;
  const ws = Math.acos(-Math.tan(phi) * Math.tan(delta));
  return (
    ((24 * 60) / Math.PI) *
    Gsc *
    dr *
    (ws * Math.sin(phi) * Math.sin(delta) +
      Math.cos(phi) * Math.cos(delta) * Math.sin(ws))
  );
}

/**
 * Estimate reference ET0 (mm/day) using the Hargreaves-Samani equation.
 * ET0 = 0.0023 × (Tmean + 17.8) × (Tmax − Tmin)^0.5 × Ra / λ
 * where λ = 2.45 MJ/kg (latent heat of vaporization), converting MJ/m² to mm.
 */
export function hargreavesET0(
  tempMin: number,
  tempMax: number,
  tempMean: number,
  latitude: number,
  dayOfYear: number,
): number {
  const ra = extraterrestrialRadiation(latitude, dayOfYear);
  const tempRange = Math.max(0, tempMax - tempMin);
  const et0 = 0.0023 * (tempMean + 17.8) * Math.sqrt(tempRange) * (ra / 2.45);
  return Math.max(0, et0);
}

/**
 * Get day-of-year (1-366) from an ISO date string. Feeds the solar declination
 * in `hargreavesET0`, so it must not depend on the runtime's time zone.
 */
export function dayOfYear(dateStr: string): number {
  return dayOfYearUtc(dateStr);
}

// ── Water balance model (FAO-56 + Geisenheimer Regeln) ──

/** Minimum precipitation threshold (mm). Rain below this is ignored (interception). */
export const MIN_PRECIP_MM = 0.3;

/** Heavy rain threshold (mm). Above this, a 2-day drainage pause is triggered. */
export const HEAVY_RAIN_MM = 30;

/** Days to pause after heavy rain (macropore drainage). */
const DRAINAGE_PAUSE_DAYS = 2;

/** Target refill level as fraction of FC. Geisenheim: 90% to leave buffer for rain. */
export const REFILL_TARGET = 0.9;

/** Fraction of heavy rain (>10 mm/day) lost to surface runoff on near-saturated soil. */
const RUNOFF_FRACTION = 0.15;

/** Runoff threshold: rain intensity above which surface losses occur (mm/day). */
export const RUNOFF_THRESHOLD_MM = 10;

/** Minimum bare-soil evaporation as fraction of ET0 when Kc is very low (BBCH <10). */
const SOIL_EVAP_FRACTION = 0.15;

/**
 * Run a daily soil water balance (FAO-56 bucket model with Geisenheim rules).
 *
 * Core equation:
 *   ETa = max(Kc × ET0, soilEvap)
 *   P_eff = P − interception − runoff
 *   SWC(t) = SWC(t−1) + P_eff + I − ETa − Drainage
 *
 * Loss mechanisms:
 * 1. Interception: P < 0.3 mm/day ignored (Geisenheim)
 * 2. Runoff: 15% of rain above 10 mm/day when soil > 80% FC (SCS-inspired)
 * 3. Drainage: excess above FC removed instantly; heavy rain >30 mm triggers 2-day pause
 * 4. Bare-soil evaporation: minimum 15% of ET0 even when Kc is near zero
 *
 * References:
 * - FAO-56 (Allen et al. 1998): bucket model, Kc × ET0, soil evaporation
 * - Geisenheim (Paschold, Zinkernagel): precipitation rules, drainage pause
 * - BBCH phenology model (ESM): dynamic Kc from crop development stage
 * - Open-Meteo: FAO-56 Penman-Monteith ET0 (with Hargreaves fallback)
 */
export function computeWaterBalance(
  params: WaterBalanceParams,
  inputs: WaterBalanceInput[],
): WaterBalanceResult {
  const { fc, pwp } = params;
  const p = params.p ?? DEFAULT_DEPLETION_FRACTION;
  const awc = fc - pwp;
  const startSwc = fc * REFILL_TARGET;

  // Dual-Kc surface-layer state (FAO-56 Ch. 7). Active when params.surface
  // is set; otherwise the loop runs the single-Kc path with a flat soil-evap
  // floor.
  // Dual mode requires non-degenerate TEW; otherwise Kr would divide by zero.
  const tew = params.surface?.tew ?? 0;
  const rew = params.surface?.rew ?? 0;
  const dual = !!params.surface && tew > 0;
  let de = params.surface?.de0 ?? tew * 0.5;

  const todayStr =
    params.todayOverride ?? new Date().toISOString().split('T')[0];

  const days: WaterBalanceDay[] = [];
  let swc = startSwc;
  let totalIrrigated = 0;
  let totalEta = 0;
  let totalPrecipitation = 0;
  let pauseDaysRemaining = 0;

  for (const input of inputs) {
    const forecast = input.date > todayStr || undefined;
    // Geisenheim drainage pause after heavy rain — saturated soil routes all
    // inflow to drainage and suppresses ETa, keeping the bucket conservative.
    if (pauseDaysRemaining > 0) {
      swc = fc;
      pauseDaysRemaining--;
      const effPrecip =
        input.precipitation >= MIN_PRECIP_MM ? input.precipitation : 0;
      const drainage = effPrecip + input.irrigation;
      if (dual)
        de = Math.min(tew, Math.max(0, de - effPrecip - input.irrigation));
      days.push({
        date: input.date,
        swc: Math.round(fc * 10) / 10,
        eta: 0,
        precipitation: input.precipitation,
        irrigation: input.irrigation,
        drainage: Math.round(drainage * 10) / 10,
        deficit: 0,
        forecast,
      });
      totalPrecipitation += input.precipitation;
      totalIrrigated += input.irrigation;
      continue;
    }

    // Geisenheim rule: ignore precipitation < 0.3 mm (interception)
    let effPrecip =
      input.precipitation >= MIN_PRECIP_MM ? input.precipitation : 0;

    // Runoff: when soil is near saturation (>80% FC) and rain is intense,
    // a fraction runs off and never enters the root zone. Tracked as part
    // of total drainage so the bucket equation closes (P − ETa − drainage = ΔSWC).
    let runoff = 0;
    if (effPrecip > RUNOFF_THRESHOLD_MM && swc > fc * 0.8) {
      runoff = (effPrecip - RUNOFF_THRESHOLD_MM) * RUNOFF_FRACTION;
      effPrecip -= runoff;
    }

    // ETa demand. Dual-Kc (FAO-56 Ch. 7): ETa = Ks·Kcb·ET0 + Ke·ET0, with Ke
    // driven by a top-layer balance (TEW, REW, De). Single-Kc: ETa = Ks·max(
    // Kc·ET0, 0.15·ET0). Final value is capped by water deliverable above PWP.
    const ks = computeKs(swc, fc, pwp, p);
    let etaDemand: number;
    let surfaceEvapDemand = 0;
    let dePostWet = de;
    if (dual) {
      const kcb = input.kcb ?? kcbFromKc(input.kc);
      dePostWet = Math.max(0, de - effPrecip - input.irrigation);
      const kcMax = Math.max(1.2, kcb + 0.05);
      const kr = computeKr(dePostWet, tew, rew);
      surfaceEvapDemand = clip(kr * (kcMax - kcb), 0, kcMax) * input.et0;
      etaDemand = ks * kcb * input.et0 + surfaceEvapDemand;
    } else {
      const cropEta = input.kc * input.et0;
      const soilEvap = SOIL_EVAP_FRACTION * input.et0;
      etaDemand = ks * Math.max(cropEta, soilEvap);
    }
    const available = swc + effPrecip + input.irrigation - pwp;
    const eta = Math.max(0, Math.min(etaDemand, available));

    // Propagate the (possibly water-capped) surface-evap share back into De
    // so the top layer dries at the right rate.
    if (dual) {
      const surfaceShare =
        etaDemand > 0 ? eta * (surfaceEvapDemand / etaDemand) : 0;
      de = Math.min(tew, dePostWet + surfaceShare);
    }

    const swcRaw = swc + effPrecip + input.irrigation - eta;
    const deepDrainage = Math.max(0, swcRaw - fc);
    const drainage = deepDrainage + runoff;
    swc = Math.max(pwp, Math.min(fc, swcRaw - deepDrainage));
    const deficit = fc - swc;

    totalIrrigated += input.irrigation;
    totalEta += eta;
    totalPrecipitation += input.precipitation;

    // Geisenheim rule: heavy rain triggers 2-day drainage pause
    if (effPrecip > HEAVY_RAIN_MM && swcRaw > fc) {
      pauseDaysRemaining = DRAINAGE_PAUSE_DAYS;
    }

    days.push({
      date: input.date,
      swc: Math.round(swc * 10) / 10,
      eta: Math.round(eta * 10) / 10,
      precipitation: input.precipitation,
      irrigation: input.irrigation,
      drainage: Math.round(drainage * 10) / 10,
      deficit: Math.round(deficit * 10) / 10,
      forecast,
    });
  }

  // "Current" = today's bucket if today is in the simulated window, otherwise
  // the last simulated day. Matches the sparkline tooltip's `displayDay` so the
  // cell badge and tooltip never disagree.
  const todayIdx = days.findIndex((d) => d.date === todayStr);
  const currentIdx = todayIdx >= 0 ? todayIdx : days.length - 1;
  const currentDeficit = days.length > 0 ? days[currentIdx].deficit : 0;

  return {
    days,
    currentDeficit: Math.round(currentDeficit * 10) / 10,
    deficitLevel: getDeficitLevel(currentDeficit, awc),
    totalIrrigated: Math.round(totalIrrigated * 10) / 10,
    totalEta: Math.round(totalEta * 10) / 10,
    totalPrecipitation: Math.round(totalPrecipitation * 10) / 10,
  };
}

// ── Fill ratio (% nFK) ──
//
// Single source of truth for the farmer-convention "% nFK" metric — the
// fraction of the root-zone bucket that is still plant-available, expressed
// as 0–100. Returns null when the soil has no usable AWC.
export function fillRatioPct(
  awcMm: number | null,
  deficitMm: number | null,
): number | null {
  if (awcMm == null || deficitMm == null || awcMm <= 0) return null;
  const raw = ((awcMm - deficitMm) / awcMm) * 100;
  return clip(raw, 0, 100);
}

// ── Deficit classification ──
//
// Farmer-convention traffic-light on % nFK (fraction of AWC still available):
//   ≥ 50 %  green   (ausreichend)
//   30–50 %  yellow  (Bewässerung empfohlen)
//   < 30 %  red     (kritisch)
//
// Equivalent in depletion terms: ok ≤ 50 %, warning ≤ 70 %, else critical.
export function getDeficitLevel(deficit: number, awc: number): DeficitLevel {
  if (awc <= 0) return 'critical';
  const ratio = deficit / awc;
  if (ratio <= 0.5) return 'ok';
  if (ratio <= 0.7) return 'warning';
  return 'critical';
}
