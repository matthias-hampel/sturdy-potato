/**
 * Plausibility guard for maize-dmc-api responses before they are cached in
 * MaizeDmcRuns for the rest of the day.
 *
 * Background (2026-09-07/08): Open-Meteo's historical API returned 502s and
 * maize-dmc-api < 0.3.3 silently padded the whole season with 18 °C, i.e.
 * 12 GDD/day instead of ~10 → +~290 accumulated GDD → +5..9 pp DM on ~1,500
 * fields, cached for the day and forwarded to KWS/AMA's deviation mailer.
 * The service now fails loud; this is the second line of defence on our side.
 */

import type { PredictResponse } from './types.js';

/** Generous upper bound for real day-over-day GDD growth (base 6 °C, hot day ≈ 20). */
const MAX_GDD_PER_DAY = 20;
/**
 * Tolerance on top of the per-day allowance before a jump counts as implausible.
 * 125 (was 60): the cached-weather series runs ~1 % (15–20 GDD) above the
 * service's own Open-Meteo fetch — up to 6 % (110 GDD) for single fields whose
 * cache grid cell differs from the service's — and Open-Meteo revises history
 * day to day. Measured 2026-09-09 over 14,124 KWS fields: p99.9 of the excess
 * 44 GDD, max 110. The 18 °C incident was +~290 and stays far outside.
 */
const GDD_JUMP_TOLERANCE = 125;
/** Only compare against a recent reference; older runs legitimately diverge more. */
const MAX_REFERENCE_AGE_DAYS = 14;

export type PlausibilityInput = {
  runDate: string; // YYYY-MM-DD
  sowingDate: string | null;
  accumulatedGdd: number | null; // dailyPredictions[0].accumulatedGdd of the new run
  weather: PredictResponse['weather'];
  /** The field's recent runs (newest first); the highest GDD among them is the reference. */
  previous:
    | readonly {
        runDate: string;
        sowingDate: string | null;
        accumulatedGdd: number | null;
      }[]
    | null;
};

export type PlausibilityVerdict = { ok: true } | { ok: false; reason: string };

/** Past days the service may bridge with its recent-mean fallback (mirrors DMC_WEATHER_GAP_TOLERANCE_DAYS). */
const MAX_RECENT_MEAN_PAST_DAYS = 3;

/**
 * Accept only the bounded fallbacks maize-dmc-api is allowed to make: the lone
 * `today` row, or (>= 0.3.4) a `recent_mean` bridge whose PAST days number at
 * most MAX_RECENT_MEAN_PAST_DAYS (forecast days may all be bridged — they are
 * forecasts either way). Anything else means invented weather → reject.
 */
function assessWeatherFallback(
  weather: PredictResponse['weather'],
  runDate: string,
): PlausibilityVerdict {
  const fallbackDays = weather?.days_fallback ?? 0;
  if (fallbackDays === 0) return { ok: true };
  const kind = weather?.fallback_kind;
  if (kind === 'recent_mean') {
    const pastDays = (weather?.fallback_dates ?? []).filter(
      (d) => d < runDate,
    ).length;
    if (pastDays <= MAX_RECENT_MEAN_PAST_DAYS) return { ok: true };
    return {
      ok: false,
      reason: `weather fallback bridged ${pastDays} past days (max ${MAX_RECENT_MEAN_PAST_DAYS})`,
    };
  }
  if (fallbackDays <= 1) return { ok: true }; // legacy today-row padding
  return {
    ok: false,
    reason: `weather provider fallback on ${fallbackDays}/${weather?.days_total ?? '?'} days`,
  };
}

/** Whole days from `a` to `b` (positive when `b` is later). Shared with harvestDetection.ts. */
export function daysBetween(a: string, b: string): number {
  return Math.round(
    (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000,
  );
}

/**
 * Reject a response whose weather is (partly) invented or whose accumulated
 * GDD jumped far beyond what elapsed time can explain relative to the field's
 * recent runs. The reference is the HIGHEST GDD among the recent runs with the
 * same sowing date and within MAX_REFERENCE_AGE_DAYS — one low outlier (an
 * inconsistent Open-Meteo answer on an earlier day) must not fail today's run.
 * A changed sowing date legitimately moves GDD and bypasses the jump check.
 */
export function assessRunPlausibility(
  input: PlausibilityInput,
): PlausibilityVerdict {
  const weatherVerdict = assessWeatherFallback(input.weather, input.runDate);
  if (!weatherVerdict.ok) return weatherVerdict;
  if (input.accumulatedGdd === null || !input.previous?.length)
    return { ok: true };

  const candidates = input.previous.filter((p) => {
    if (p.accumulatedGdd === null) return false;
    if (p.sowingDate && input.sowingDate && p.sowingDate !== input.sowingDate)
      return false;
    const days = daysBetween(p.runDate, input.runDate);
    return days >= 1 && days <= MAX_REFERENCE_AGE_DAYS;
  });
  if (candidates.length === 0) return { ok: true };
  const ref = candidates.reduce((best, p) =>
    (p.accumulatedGdd ?? -1) > (best.accumulatedGdd ?? -1) ? p : best,
  );
  const refGdd = ref.accumulatedGdd as number;
  const days = daysBetween(ref.runDate, input.runDate);

  const excess = input.accumulatedGdd - refGdd - MAX_GDD_PER_DAY * days;
  if (excess > GDD_JUMP_TOLERANCE) {
    return {
      ok: false,
      reason:
        `accumulated GDD ${input.accumulatedGdd.toFixed(1)} vs ${refGdd.toFixed(1)} ` +
        `${days} day(s) earlier (${ref.runDate}, highest of ${candidates.length} recent run(s)); ` +
        `excess ${excess.toFixed(0)} GDD beyond ${MAX_GDD_PER_DAY}/day`,
    };
  }
  return { ok: true };
}
