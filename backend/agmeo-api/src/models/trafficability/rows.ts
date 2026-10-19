/**
 * Ported from AGVOLUTION/agmeo src/lib/trafficability/rows.ts, plus the pure
 * per-field projection from src/actions/trafficability.ts (`projectField`,
 * `swcMmToTheta`) — the server action itself (auth + DB) is not ported.
 */

import {
  TOPSOIL_DEPTH_M,
  type WaterBalanceDay,
} from '../irrigation/waterBalance.js';
import {
  type FieldTrafficabilityPrep,
  prepareFieldTrafficability,
} from './index.js';

export type TrafficabilityDelta = {
  /** Resolved KA5 code (fine or coarse, e.g. "Ls3"). null when the field has no
   *  soil texture. */
  ka5: string | null;
  /** Pre-computed prep for TODAY. The slider hot path reuses this and only
   *  recomputes σ → SCI (see evaluateFieldsForMachine). */
  today: FieldTrafficabilityPrep;
  /** Daily prep for the next 7 days from the water-balance forecast.
   *  Empty when the series has no forecast tail. */
  forecast: { date: string; prep: FieldTrafficabilityPrep }[];
};

type MaybeTrafficabilityDelta = {
  [K in keyof TrafficabilityDelta]: TrafficabilityDelta[K] | null;
};

/** Rows with no water-balance simulation carry this; the layer skips them. */
export const EMPTY_TRAFFICABILITY_DELTA: MaybeTrafficabilityDelta = {
  ka5: null,
  today: null,
  forecast: null,
};

export const hasTrafficability = <R extends MaybeTrafficabilityDelta>(
  row: R,
): row is R & TrafficabilityDelta =>
  row.today !== null && row.forecast !== null;

/**
 * Convert a daily soil-water-content (mm over the plough layer) into a
 * volumetric water content θ (vol fraction).
 *
 * The series this reads is the TOPSOIL water balance, computed at
 * TOPSOIL_DEPTH_M — not the crop's root zone. `precompression`/`thetaToPF`
 * describe the plough layer and `applyMachineLoad` evaluates stress at 0.25 m,
 * so θ has to be the water content of that layer. Dividing the root-zone
 * series by its own depth would yield a profile mean that barely moves after
 * rain, muting the traffic light in exactly the wet conditions it exists to
 * catch.
 */
export function swcMmToTheta(swcMm: number): number {
  return swcMm / (TOPSOIL_DEPTH_M * 1000);
}

/**
 * Project one field's TOPSOIL water balance (buildFieldWaterBalance with
 * rootDepthM = TOPSOIL_DEPTH_M and no awcMmOverride) into the trafficability
 * shape. Returns null when there is no series or no day up to today.
 *
 * @param topsoilWaterBalance days from buildFieldWaterBalance(...).days
 * @param soilTypeKa5 buildFieldWaterBalance(...).soilTypeKa5
 * @param todayIso yyyy-mm-dd; defaults to the wall clock (UTC date)
 */
export function projectFieldTrafficability(
  topsoilWaterBalance: WaterBalanceDay[] | null | undefined,
  soilTypeKa5: string | null,
  todayIso: string = new Date().toISOString().split('T')[0],
): TrafficabilityDelta | null {
  const days = topsoilWaterBalance ?? [];
  if (days.length === 0) return null;

  // The balance covers historical + forecast days. "Today" is the last entry
  // whose date is ≤ today; everything after is the forecast tail.
  const todayIdx = days.findLastIndex((d) => d.date <= todayIso);
  if (todayIdx < 0) return null;

  const todayDay = days[todayIdx];
  const today = prepareFieldTrafficability({
    thetaCurrent: swcMmToTheta(todayDay.swc),
    ka5: soilTypeKa5,
  });

  const forecast = days.slice(todayIdx + 1, todayIdx + 1 + 7).map((d) => ({
    date: d.date,
    prep: prepareFieldTrafficability({
      thetaCurrent: swcMmToTheta(d.swc),
      ka5: soilTypeKa5,
    }),
  }));

  return { ka5: soilTypeKa5, today, forecast };
}
