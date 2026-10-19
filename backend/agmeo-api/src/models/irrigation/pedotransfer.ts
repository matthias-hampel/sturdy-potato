/**
 * Ported from AGVOLUTION/agmeo src/lib/irrigation/pedotransfer.ts — logic, numbers and
 * thresholds unchanged; only imports adapted to the rewrite.
 */

/**
 * Wösten 1999 HYPRES continuous pedotransfer function (topsoil).
 *
 * Wösten, J.H.M., Lilly, A., Nemes, A., Le Bas, C. (1999): Development and use of
 * a database of hydraulic properties of European soils. Geoderma 90, 169-185.
 *
 * Predicts van Genuchten-Mualem retention curve parameters (θ_s, α, n) from
 * clay/silt/organic-matter/bulk-density, then evaluates θ at the field-capacity
 * (-330 cm) and permanent-wilting-point (-15000 cm) pressure heads.
 *
 * Inputs are clamped to non-degenerate ranges before logs/reciprocals to avoid
 * NaN/Inf when caller passes 0 (e.g. when SOC unknown).
 */

const MIN_OM = 0.1;
const MIN_SI = 0.1;
const MIN_D = 0.5;
const SOC_TO_OM = 1.724;
const THETA_R = 0.01;

const FC_HEAD_CM = 330;
const PWP_HEAD_CM = 15000;

type WostenInputs = {
  clayPct: number;
  siltPct: number;
  socPct: number | null;
  bulkDensity: number | null;
};

type VanGenuchten = {
  thetaR: number;
  thetaS: number;
  alpha: number;
  n: number;
  m: number;
};

type WostenResult = {
  thetaFc: number;
  thetaPwp: number;
  vg: VanGenuchten;
};

function vanGenuchtenTheta(vg: VanGenuchten, headCm: number): number {
  const { thetaR, thetaS, alpha, n, m } = vg;
  return (
    thetaR + (thetaS - thetaR) / Math.pow(1 + Math.pow(alpha * headCm, n), m)
  );
}

// SOC defaults to 1.5 % (typical EU arable topsoil) and BD to 1.4 g/cm³ when the
// caller has no data — produces a sensible FC/PWP rather than null.
// Returns θ as volumetric fractions (0..1); caller multiplies by 100 for % vol.
export function wostenTopsoilHydraulics({
  clayPct,
  siltPct,
  socPct,
  bulkDensity,
}: WostenInputs): WostenResult {
  const C = Math.max(0, clayPct);
  const Si = Math.max(MIN_SI, siltPct);
  const OM = Math.max(MIN_OM, (socPct ?? 1.5) * SOC_TO_OM);
  const D = Math.max(MIN_D, bulkDensity ?? 1.4);
  const ts = 1;

  const thetaS =
    0.7919 +
    0.001691 * C -
    0.29619 * D -
    0.000001491 * Si * Si +
    0.0000821 * OM * OM +
    0.02427 / C +
    0.01113 / Si +
    0.01472 * Math.log(Si) -
    0.0000733 * OM * C -
    0.000619 * D * C -
    0.001183 * D * OM -
    0.0001664 * ts * Si;

  const alphaStar =
    -14.96 +
    0.03135 * C +
    0.0351 * Si +
    0.646 * OM +
    15.29 * D -
    0.192 * ts -
    4.671 * D * D -
    0.000781 * C * C -
    0.00687 * OM * OM +
    0.0449 / OM +
    0.0663 * Math.log(Si) +
    0.1482 * Math.log(OM) -
    0.04546 * D * Si -
    0.4852 * D * OM +
    0.00673 * ts * C;

  const nStar =
    -25.23 -
    0.02195 * C +
    0.0074 * Si -
    0.194 * OM +
    45.5 * D -
    7.24 * D * D +
    0.0003658 * C * C +
    0.002885 * OM * OM -
    12.81 / D -
    0.1524 / Si -
    0.01958 / OM -
    0.2876 * Math.log(Si) -
    0.0709 * Math.log(OM) -
    44.6 * Math.log(D) -
    0.02264 * D * C +
    0.0896 * D * OM +
    0.00718 * ts * C;

  const alpha = Math.exp(alphaStar);
  const n = Math.exp(nStar) + 1;
  const m = 1 - 1 / n;
  const vg: VanGenuchten = { thetaR: THETA_R, thetaS, alpha, n, m };

  return {
    thetaFc: vanGenuchtenTheta(vg, FC_HEAD_CM),
    thetaPwp: vanGenuchtenTheta(vg, PWP_HEAD_CM),
    vg,
  };
}
