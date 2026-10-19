/**
 * Ported from AGVOLUTION/agmeo src/lib/trafficability/soilClasses.ts — logic, numbers and
 * thresholds unchanged; only imports adapted to the rewrite.
 */

/**
 * Per-KA5-class soil parameters for the trafficability pipeline.
 *
 * One table, one source of truth. Avoids the drift risk of maintaining
 * separate `KA5_MVG_PARAMS` and `KA5_CLAY_PCT` tables: adding a soil class
 * must update VG params AND clay-% AND nothing else.
 *
 * Keys here are the COARSE KA5 group codes (Ss, Su, Sl, …). Callers that
 * have the FINE codes from `classifyBodenart()` (Sl3, Ut4, Lts, …) pass
 * them through `coarseKa5()` first.
 *
 * Sources:
 *   - VG params: Wösten 1999 HYPRES (EU JRC soil hydraulic database).
 *   - Clay %:    KA5 / AG Boden 2005 standard table.
 */

import type { VanGenuchtenParams } from './mualem.js';

export type Ka5SoilParams = {
  /** Mualem–Van Genuchten parameters (Wösten 1999). */
  mvg: VanGenuchtenParams;
  /** Typical clay content in mass-% for the class. */
  clayPct: number;
};

export const KA5_SOIL_PARAMS: Record<string, Ka5SoilParams> = {
  // Sands
  Ss: {
    mvg: { thetaR: 0.045, thetaS: 0.43, alpha: 0.145, n: 2.68 },
    clayPct: 3,
  },
  Su: {
    mvg: { thetaR: 0.057, thetaS: 0.41, alpha: 0.124, n: 2.28 },
    clayPct: 5,
  },
  Sl: {
    mvg: { thetaR: 0.065, thetaS: 0.41, alpha: 0.075, n: 1.89 },
    clayPct: 9,
  },
  St: {
    mvg: { thetaR: 0.067, thetaS: 0.39, alpha: 0.059, n: 1.48 },
    clayPct: 14,
  },
  // Loams
  Ls: {
    mvg: { thetaR: 0.083, thetaS: 0.41, alpha: 0.067, n: 1.58 },
    clayPct: 22,
  },
  Lu: {
    mvg: { thetaR: 0.078, thetaS: 0.43, alpha: 0.036, n: 1.56 },
    clayPct: 18,
  },
  Ll: {
    mvg: { thetaR: 0.078, thetaS: 0.43, alpha: 0.036, n: 1.56 },
    clayPct: 25,
  },
  Lt: {
    mvg: { thetaR: 0.095, thetaS: 0.41, alpha: 0.019, n: 1.31 },
    clayPct: 35,
  },
  // Silts
  Uu: {
    mvg: { thetaR: 0.034, thetaS: 0.46, alpha: 0.016, n: 1.37 },
    clayPct: 4,
  },
  Us: {
    mvg: { thetaR: 0.067, thetaS: 0.45, alpha: 0.02, n: 1.41 },
    clayPct: 7,
  },
  Ul: {
    mvg: { thetaR: 0.067, thetaS: 0.45, alpha: 0.02, n: 1.41 },
    clayPct: 10,
  },
  Ut: {
    mvg: { thetaR: 0.07, thetaS: 0.42, alpha: 0.005, n: 1.18 },
    clayPct: 18,
  },
  // Clays
  Ts: {
    mvg: { thetaR: 0.1, thetaS: 0.38, alpha: 0.027, n: 1.23 },
    clayPct: 30,
  },
  Tl: {
    mvg: { thetaR: 0.068, thetaS: 0.36, alpha: 0.008, n: 1.09 },
    clayPct: 50,
  },
  Tt: {
    mvg: { thetaR: 0.068, thetaS: 0.38, alpha: 0.008, n: 1.09 },
    clayPct: 65,
  },
  Tu: {
    mvg: { thetaR: 0.07, thetaS: 0.42, alpha: 0.005, n: 1.18 },
    clayPct: 45,
  },
};

/** Mid-range silty-loam fallback for unknown classes. */
export const DEFAULT_SOIL_PARAMS: Ka5SoilParams = {
  mvg: { thetaR: 0.067, thetaS: 0.45, alpha: 0.02, n: 1.41 },
  clayPct: 15,
};

/**
 * Strip the fine-code suffix from a KA5 code so the coarse lookup hits.
 *
 *   "Sl3" → "Sl"      "Ut4" → "Ut"     "Lts" → "Lt"      "Tt" → "Tt"
 *
 * `classifyBodenart()` (soil-classification.ts) emits fine codes; the
 * Wösten HYPRES table only carries the 12 coarse groups, so we collapse.
 */
export function coarseKa5(ka5: string | null | undefined): string {
  if (!ka5) return '';
  // The coarse code is the leading uppercase + optional lowercase letter,
  // e.g. "Ss", "Su", "Sl", "St", "Ls", "Lu", "Ll", "Lt", "Uu", "Us", "Ul",
  // "Ut", "Ts", "Tl", "Tt", "Tu". Anything after that is the fine numeric
  // or compound suffix (2/3/4/s).
  const match = ka5.match(/^[A-Z][a-z]?/);
  return match ? match[0] : '';
}

/**
 * Get the soil-params row for a KA5 code (fine or coarse), with a sane
 * mid-range default when the code is unknown / missing.
 */
export function getKa5SoilParams(
  ka5: string | null | undefined,
): Ka5SoilParams {
  return KA5_SOIL_PARAMS[coarseKa5(ka5)] ?? DEFAULT_SOIL_PARAMS;
}
