/**
 * Ported from AGVOLUTION/agmeo src/lib/trafficability/sci.ts — logic, numbers and
 * thresholds unchanged; only imports adapted to the rewrite.
 */

/**
 * Soil Compaction Index (SCI) and trafficability classification.
 *
 *   SCI = σ_z / Pc
 *
 * where σ_z is the vertical stress that arrives at a given soil depth and
 * Pc is the precompression of the soil at that depth. SCI > 1 means the
 * load exceeds the soil's mechanical yield → permanent compaction risk.
 *
 * Two related but independent pieces live here:
 *
 *   1. stressAtDepth — propagate σ from the surface (from contactPressure)
 *      to a given depth via the Söhne 1953 form of Boussinesq (1885) with
 *      the Fröhlich 1934 concentration factor ν that grows with soil
 *      moisture (wet soils transmit stress deeper).
 *
 *   2. trafficabilityBand — classify the SCI into a 4-step traffic-light
 *      band (good / caution / risk / unsafe) that drives map colours.
 *
 * References:
 *   - Söhne W. 1953 — Druckverteilung im Boden und Bodenformung unter
 *     Schlepperreifen. Grundlagen der Landtechnik 5: 49–63.
 *   - Horn R., Fleige H. 2003 — see precompression.ts.
 *   - Lebert M., Horn R. 1991 — A method to predict the mechanical strength
 *     of agricultural soils. Soil Tillage Res. 19: 275-286.
 */

import { clip } from '../util.js';

/**
 * Fröhlich concentration factor ν as a function of soil pF.
 *
 * Wetter soil (low pF) → higher ν → stress concentrates more directly
 * under the wheel and reaches deeper. Drier soil (high pF) → ν toward 4
 * → stress fans out laterally and dissipates faster with depth.
 *
 * Mapping calibrated to Lebert & Horn 1991 / Söhne 1953:
 *   pF 1.5 (saturated) → ν ≈ 6
 *   pF 2.5 (field capacity) → ν ≈ 5
 *   pF 4.2 (wilting) → ν ≈ 4
 */
export function froehlichNu(pf: number): number {
  const t = clip((pf - 1.5) / (4.2 - 1.5), 0, 1);
  return 6 - 2 * t;
}

export type StressAtDepthInput = {
  /** Surface contact stress σ_max [kPa] from contactPressure(). */
  surfaceStressKpa: number;
  /** Tyre footprint radius approximation r0 [m]. For agricultural tyres
   *  ≈ width/2 is a reasonable single-tyre footprint half-width. */
  footprintRadiusM: number;
  /** Depth at which to evaluate σ_z [m]. Trafficability typically looks at
   *  0.2–0.3 m (root-zone topsoil) where Pc is the binding constraint. */
  depthM: number;
  /** Soil pF (drives the Fröhlich concentration factor). */
  pf: number;
};

/**
 * Vertical stress at depth via Söhne's adaptation of Boussinesq–Fröhlich.
 *
 *   σ_z(z) = σ_surface · (1 − (z² / (z² + r₀²))^(ν/2))
 *
 * For z → 0 → σ_z → σ_surface. For z → ∞ → σ_z → 0. The (ν/2) exponent
 * is the Fröhlich concentration factor halved.
 */
export function stressAtDepth(input: StressAtDepthInput): number {
  const { surfaceStressKpa, footprintRadiusM, depthM, pf } = input;
  if (depthM <= 0) return surfaceStressKpa;
  const r2 = footprintRadiusM * footprintRadiusM;
  const z2 = depthM * depthM;
  const nu = froehlichNu(pf);
  // σ_z = σ_surface · (1 − (z² / (z² + r²))^(ν/2))
  return surfaceStressKpa * (1 - Math.pow(z2 / (z2 + r2), nu / 2));
}

export type TrafficabilityBand = 'good' | 'caution' | 'risk' | 'unsafe';

/**
 * SCI break-points for the 4-step traffic-light. The 1.0 boundary is Pc by
 * definition (load = yield); the others are rough half-decade steps for
 * actionable signalling. UI legend reads from this same const so labels
 * never drift from the band logic.
 */
export const TRAFFICABILITY_THRESHOLDS = {
  /** SCI < good → "good" band. */
  good: 0.8,
  /** SCI < caution → "caution" band (i.e. 0.8 ≤ SCI < 1.0). */
  caution: 1.0,
  /** SCI < risk → "risk" band (i.e. 1.0 ≤ SCI < 1.5). Above → "unsafe". */
  risk: 1.5,
} as const;

/** Classify an SCI value into a 4-step traffic-light band. */
export function trafficabilityBand(sci: number): TrafficabilityBand {
  if (sci < TRAFFICABILITY_THRESHOLDS.good) return 'good';
  if (sci < TRAFFICABILITY_THRESHOLDS.caution) return 'caution';
  if (sci < TRAFFICABILITY_THRESHOLDS.risk) return 'risk';
  return 'unsafe';
}

/** Hex colours used by the map layer + legend, mirrored for the UI badge. */
export const TRAFFICABILITY_COLORS: Record<TrafficabilityBand, string> = {
  good: '#16a34a', // green-600
  caution: '#facc15', // yellow-400
  risk: '#f97316', // orange-500
  unsafe: '#dc2626', // red-600
};

export type SciInput = {
  /** σ at the relevant evaluation depth in kPa. */
  stressAtDepthKpa: number;
  /** Pc at the same depth from Horn & Fleige in kPa. */
  precompressionKpa: number;
};

/** SCI = σ/Pc. Pc=0 returns +∞ to signal unsafe (avoid divide-by-zero). */
export function sci({ stressAtDepthKpa, precompressionKpa }: SciInput): number {
  if (precompressionKpa <= 0) return Number.POSITIVE_INFINITY;
  return stressAtDepthKpa / precompressionKpa;
}
