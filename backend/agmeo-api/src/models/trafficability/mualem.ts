/**
 * Ported from AGVOLUTION/agmeo src/lib/trafficability/mualem.ts — logic, numbers and
 * thresholds unchanged; only imports adapted to the rewrite.
 */

/**
 * Mualem–Van Genuchten soil water retention curve.
 *
 * Bridges the agronomy world (volumetric water content θ from FAO-56 water
 * balance) to the mechanics world (matric potential ψ in kPa or pF on log
 * scale, needed by Severiano 2013 to estimate soil precompression Pc).
 *
 * Per-class parameters live in `./soilClasses.ts` (single source of truth
 * shared with the clay-% lookup used by Pc).
 *
 * pF = log10(|ψ| in cm water column):
 *   pF 1.8 ≈ field capacity        (≈ 63 cm ≈ 6 kPa)
 *   pF 4.2 ≈ permanent wilting     (≈ 15 849 cm ≈ 1554 kPa)
 *
 * Reference: Wösten 1999 HYPRES EU JRC database (parameters);
 *            Van Genuchten 1980 (curve shape).
 */

import { clip } from '../util.js';

export type VanGenuchtenParams = {
  /** Residual volumetric water content (vol fraction, e.g. 0.05). */
  thetaR: number;
  /** Saturated volumetric water content (vol fraction, e.g. 0.43). */
  thetaS: number;
  /** Inverse air-entry value (1/cm). */
  alpha: number;
  /** Pore-size distribution shape parameter (unitless, n > 1). */
  n: number;
};

/**
 * Convert volumetric water content θ (vol fraction, 0..1) to matric potential
 * |ψ| in cm water column via Mualem–Van Genuchten.
 *
 *   |ψ| = (1/α) · ((Sₑ^(-1/m) − 1))^(1/n)
 *   Sₑ  = (θ − θᵣ) / (θₛ − θᵣ)
 *   m   = 1 − 1/n
 */
export function thetaToPsiCm(theta: number, p: VanGenuchtenParams): number {
  const Se = clip((theta - p.thetaR) / (p.thetaS - p.thetaR), 1e-6, 1 - 1e-9);
  const m = 1 - 1 / p.n;
  return (1 / p.alpha) * Math.pow(Math.pow(Se, -1 / m) - 1, 1 / p.n);
}

/** Convert θ to pF = log10(|ψ| in cm). */
export function thetaToPF(theta: number, p: VanGenuchtenParams): number {
  const psiCm = thetaToPsiCm(theta, p);
  return Math.log10(Math.max(psiCm, 1));
}

/** Convert pF (log10 cm) back to θ via the inverse Mualem–VG. */
export function pfToTheta(pf: number, p: VanGenuchtenParams): number {
  const psiCm = Math.pow(10, pf);
  const m = 1 - 1 / p.n;
  const Se = Math.pow(1 + Math.pow(p.alpha * psiCm, p.n), -m);
  return p.thetaR + Se * (p.thetaS - p.thetaR);
}
