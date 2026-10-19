/**
 * Ported from AGVOLUTION/agmeo src/lib/trafficability/precompression.ts — logic, numbers and
 * thresholds unchanged; only imports adapted to the rewrite.
 */

/**
 * Soil precompression Pc — Severiano et al. 2013 power-law on matric suction
 * (selected over the Horn & Fleige 2003 multi-regression because the H&F
 * single-formula form yields physically implausible Pc ≤ 0 on very wet
 * clay-rich soils, while Severiano stays positive across the full pF
 * spectrum and is calibrated against compaction risk for agricultural
 * topsoil).
 *
 * Pc is the maximum vertical stress a soil can take without permanent
 * compaction (the "yield stress" of the soil pore network). Pc grows with:
 *   - higher matric suction (drier soil → aggregates held together)
 *   - higher bulk density (we add a small BD scaling on top of the
 *     suction-based form, since Severiano was calibrated on a typical BD
 *     of 1.4–1.5 g/cm³).
 *
 *   Pc = A(clay) · |ψ|^B(clay) · (BD / 1.5)         [kPa]
 *
 *     clay <  20 %:  A=129.0,  B=0.15
 *     clay 20–31 %:  A=123.3,  B=0.13
 *     clay >  31 %:  A=110.0,  B=0.11
 *
 *   |ψ|_kPa ≈ 0.0981 · 10^pF                    (1 cm H₂O ≈ 0.0981 kPa)
 *
 * Pair this with thetaToPF (mualem.ts) to drive Pc from a daily volumetric
 * water content. Per-class clay-% defaults live in `./soilClasses.ts`.
 *
 * References:
 *   - Severiano E.C. et al. 2013 — Pre-compression stress, soil texture
 *     and matric potential. Geoderma 197-198: 254–261.
 *   - Horn R., Fleige H. 2003 — Soil and Tillage Research 73: 89–100
 *     (background / sanity range for Pc).
 */

import { clip } from '../util.js';

export type PrecompressionInput = {
  /** Soil bulk density in g/cm³. Defaults to 1.5 if unknown. */
  bulkDensityGCm3: number;
  /** Clay content in mass-%, e.g. 18 for 18 % clay. */
  clayPct: number;
  /** Matric potential on log scale (pF = log10 |ψ| cm). */
  pf: number;
};

export const DEFAULT_BULK_DENSITY = 1.5;

/** Severiano regression coefficients per clay-% band. */
function severianoCoeffs(clayPct: number): { A: number; B: number } {
  if (clayPct < 20) return { A: 129.0, B: 0.15 };
  if (clayPct <= 31) return { A: 123.3, B: 0.13 };
  return { A: 110.0, B: 0.11 };
}

/**
 * Precompression Pc [kPa] via Severiano 2013, with a small BD-relative
 * scaling factor on top to differentiate soils at the same suction.
 */
export function precompression({
  bulkDensityGCm3,
  clayPct,
  pf,
}: PrecompressionInput): number {
  const bd = clip(bulkDensityGCm3, 0.8, 2.0);
  const c = clip(clayPct, 0, 80);
  const safe_pf = clip(pf, 0, 6);
  const psiKpa = 0.0981 * Math.pow(10, safe_pf);
  const { A, B } = severianoCoeffs(c);
  const pc = A * Math.pow(psiKpa, B) * (bd / 1.5);
  return Math.max(pc, 1); // keep ≥ 1 kPa to avoid divide-by-zero in SCI
}
