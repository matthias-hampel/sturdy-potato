/**
 * Ported from AGVOLUTION/agmeo src/lib/trafficability/contactPressure.ts — logic, numbers and
 * thresholds unchanged; only imports adapted to the rewrite.
 */

/**
 * Tyre–soil contact pressure model (Keller 2005, refined Söhne 1953 family).
 *
 * Inputs:
 *   - axle load F [kN] (total vertical wheel load on one tyre)
 *   - tyre width B [m]
 *   - tyre diameter D [m]
 *   - inflation pressure P_i [kPa]
 *   - recommended inflation pressure P_rec [kPa] (vendor-spec for the load)
 *
 * The model returns the peak normal contact stress σ_max at the soil
 * surface. Søhne's classical assumption σ ≈ P_i underestimates: the carcass
 * adds carcass stiffness on top of the inflation pressure, especially on
 * stiff radial agricultural tyres at low pressure ("flex tyres"). Keller's
 * regression captures this with three terms:
 *
 *   σ_max = 34.4 + 1.13·P_i + 0.72·F − 33.4·ln(P_i / P_rec)            [kPa]
 *
 * Note on directionality: the dominant term is 1.13·P_i, so dropping
 * inflation pressure ALWAYS reduces σ overall — that's why letting air out
 * before driving onto a damp field is the standard agronomic advice. The
 * −33.4·ln(P_i/P_rec) term *partially compensates* for under-inflation by
 * adding a carcass-stiffness penalty, but it never overpowers the 1.13·P_i
 * direction within the tractor operating range.
 *
 * For a tractor in field operation the axle-load distribution typically
 * splits 35–45 % to the front (frontAxleFraction on Machines). We expose
 * helpers to compute both axle σ values from a single Machine record.
 *
 * Reference:
 *   Keller T. 2005 — A Model for the Prediction of the Contact Area and the
 *   Distribution of Vertical Stress below Agricultural Tyres from Readily
 *   Available Tyre Parameters. Biosystems Engineering 92 (1): 85–96.
 */

/** Earth's gravitational acceleration, used for kg → kN conversion. */
const G_MS2 = 9.80665;

export type ContactStressInput = {
  /** Vertical load on this tyre in kN. */
  loadKn: number;
  /** Inflation pressure in kPa (the current "tyre pressure"). */
  inflationKpa: number;
  /** Vendor-recommended pressure in kPa for the given load. */
  recommendedKpa: number;
};

/** Peak normal contact stress σ_max at the tyre–soil interface (kPa). */
export function contactStress(input: ContactStressInput): number {
  const { loadKn, inflationKpa, recommendedKpa } = input;
  const ratio = Math.max(inflationKpa / Math.max(recommendedKpa, 1), 0.01);
  return 34.4 + 1.13 * inflationKpa + 0.72 * loadKn - 33.4 * Math.log(ratio);
}

export type AxleStressMachineInput = {
  /** Total operating mass [kg] (laden — what's actually on the field). */
  operatingMassKg: number;
  /** Front axle load share, 0..1. Typical tractor 0.35–0.45. */
  frontAxleFraction: number;
  /** Inflation pressure currently on the front tyres [kPa]. */
  frontInflationKpa: number;
  /** Vendor-recommended pressure for front tyres at this load [kPa]. */
  frontRecommendedKpa: number;
  /** Inflation pressure currently on the rear tyres [kPa]. */
  rearInflationKpa: number;
  /** Vendor-recommended pressure for rear tyres at this load [kPa]. */
  rearRecommendedKpa: number;
};

export type AxleStressOutput = {
  /** Per-tyre load on the front (assumes 2 tyres per axle), kN. */
  frontLoadPerTyreKn: number;
  /** Per-tyre load on the rear, kN. */
  rearLoadPerTyreKn: number;
  /** σ_max on the front [kPa]. */
  frontStressKpa: number;
  /** σ_max on the rear [kPa]. */
  rearStressKpa: number;
};

/**
 * Compute per-axle σ_max from a Machine record. Splits the total operating
 * mass to front/rear via frontAxleFraction, divides each axle load by 2
 * tyres, then applies the Keller contact-stress formula.
 */
export function axleContactStress(
  input: AxleStressMachineInput,
): AxleStressOutput {
  const totalLoadKn = (input.operatingMassKg * G_MS2) / 1000;
  const frontAxleLoadKn = totalLoadKn * input.frontAxleFraction;
  const rearAxleLoadKn = totalLoadKn * (1 - input.frontAxleFraction);
  const frontLoadPerTyreKn = frontAxleLoadKn / 2;
  const rearLoadPerTyreKn = rearAxleLoadKn / 2;

  return {
    frontLoadPerTyreKn,
    rearLoadPerTyreKn,
    frontStressKpa: contactStress({
      loadKn: frontLoadPerTyreKn,
      inflationKpa: input.frontInflationKpa,
      recommendedKpa: input.frontRecommendedKpa,
    }),
    rearStressKpa: contactStress({
      loadKn: rearLoadPerTyreKn,
      inflationKpa: input.rearInflationKpa,
      recommendedKpa: input.rearRecommendedKpa,
    }),
  };
}
