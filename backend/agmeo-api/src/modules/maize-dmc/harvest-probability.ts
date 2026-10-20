/**
 * Harvest-probability model, ported from kws-dmc (app/forecast.py).
 *
 * Whole-plant DM rises monotonically through maturation, so
 * "harvested by day d" is treated as "DM(d) ≥ θ" with an uncertain
 * silage-target threshold θ. Both DM and θ are modeled as normal,
 * giving a closed-form CDF:
 *
 *   P = Φ( (μ_D − μ_θ) / sqrt(σ_D² + σ_θ²) )
 *
 * All DM inputs are fractions in [0, 1] (0.33 = 33 % DM), matching the
 * units of DMCResponse.dailyPredictions.
 *
 * 2026-09-08 changes (assessment against KWS/AMA ground truth):
 *  - The DM model compresses the dry-down (same-day measured vs modelled DM over
 *    1,236 pairs: measured = −11.9 + 1.40·model). The probability — and ONLY the
 *    probability, never the published DM values — is evaluated on a half-strength
 *    corrected DM (`−5.96 + 1.20·DM`, spread scaled alike). Back-test: the share
 *    of CZ fields with P ≥ 0.5 moved from 66 % to 79 % against 70–75 % reported
 *    harvested; 3 of 395 fields known to be standing ever reached P ≥ 0.9.
 *    `DMC_HARVEST_P_CORRECTION=off` restores the uncorrected probability.
 *  - `harvested` needs a reproduced signal: a satellite-confirmed high-trust
 *    detection (lib/maizeDmc/harvestDetection.ts) OR P ≥ 0.9 on three
 *    consecutive run days. A satellite confirmation overrides the DM-based call
 *    (P = 1, confidence 1) but leaves dailyPredictions untouched.
 */

import {
  detectionOverridesStatus,
  type HarvestDetectionStatus,
  type HarvestDetectionTrust,
  type RecentStandingScene,
  vetoesHarvested,
} from './harvest-detection.js';

/** θ mean — silage-maize optimum DM fraction. */
const HARVEST_TARGET_DM = 0.33;
/**
 * θ sigma — harvest-threshold + logistics spread. Also acts as a floor that
 * keeps the CDF finite when the forecast spread collapses (p10 == p90).
 */
const HARVEST_THRESHOLD_SIGMA = 0.025;
/** Φ⁻¹(0.9): the 10th/90th percentiles of a normal sit at μ ± this·σ. */
const Z90 = 1.2815515594457912;

/** Status buckets over the probability (product decision, 0.5 / 0.9). */
const HARVEST_STATUS_POSSIBLE_MIN = 0.5;
const HARVEST_STATUS_HARVESTED_MIN = 0.9;
/** `harvested` from the probability alone needs this many consecutive run days ≥ 0.9 (today included). */
export const HARVEST_PERSISTENCE_DAYS = 3;

/**
 * Half-strength dry-down correction applied inside the probability only.
 * Provenance: linear fit of measured vs same-day modelled DM, 1,236 pairs
 * (CZ workbook 314, DE-KWS workbook 101, DE-AMA lab 821), 2026-09-08:
 * pooled fit −11.92 + 1.40·model, halved to −5.96 + 1.20·model.
 */
const P_CORRECTION_INTERCEPT = -0.0596;
const P_CORRECTION_SLOPE = 1.2;
const P_CORRECTION_MIN_DM = 0.05;
const P_CORRECTION_MAX_DM = 0.6;

function correctionEnabled(): boolean {
  return process.env.DMC_HARVEST_P_CORRECTION !== 'off';
}

export type HarvestStatus =
  'not_harvested' | 'possibly_harvested' | 'harvested';

/** Abramowitz-Stegun 7.1.26 rational approximation (max abs error ~1.5e-7). */
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) *
      t +
      0.254829592) *
      t *
      Math.exp(-ax * ax);
  return sign * y;
}

function round4(x: number): number {
  return Math.round(x * 10000) / 10000;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

/**
 * P(DM ≥ θ) with DM ~ N(dmMean, σ_D²) and θ ~ N(0.33, 0.025²), where σ_D is
 * recovered from the day's p10/p90 spread: σ_D = (p90 − p10) / (2·Φ⁻¹(0.9)).
 * With the correction enabled, mean and spread are first mapped through the
 * half-strength dry-down fit (see file header); the published DM is unaffected.
 */
export function probHarvested(
  dmMean: number,
  dmP10: number,
  dmP90: number,
): number {
  const slope = correctionEnabled() ? P_CORRECTION_SLOPE : 1;
  const mean = correctionEnabled()
    ? clamp(
        P_CORRECTION_INTERCEPT + P_CORRECTION_SLOPE * dmMean,
        P_CORRECTION_MIN_DM,
        P_CORRECTION_MAX_DM,
      )
    : dmMean;
  const sigmaD = (Math.max(0, dmP90 - dmP10) * slope) / (2 * Z90);
  const sigma = Math.sqrt(
    sigmaD * sigmaD + HARVEST_THRESHOLD_SIGMA * HARVEST_THRESHOLD_SIGMA,
  );
  if (sigma <= 0) return mean >= HARVEST_TARGET_DM ? 1 : 0;
  const z = (mean - HARVEST_TARGET_DM) / sigma;
  return round4(0.5 * (1 + erf(z / Math.SQRT2)));
}

/**
 * Bucket today's probability. `harvested` from the probability alone requires
 * the previous {@link HARVEST_PERSISTENCE_DAYS} − 1 run days to have been ≥ 0.9
 * as well — one hot day never flips a field to harvested. When fewer previous
 * runs exist the bucket stays at `possibly_harvested`.
 *
 * A recent clear scene that still looks like a standing crop vetoes the
 * `harvested` promotion regardless of how persistent P is (see
 * {@link vetoesHarvested}) — this is what should have kept KWS field
 * ee660829-8468-434d-9959-c23fa24a6afe at `possibly_harvested` on 2026-09-08:
 * its last clear scene (2026-09-06, NDVI 0.73) flatly contradicted the DM
 * model. A stale (> 14 days) or absent scene is uninformative and the DM
 * model drives the call alone, same as before this check existed.
 */
export function harvestStatusOf(
  p: number,
  previousProbabilities: readonly number[] = [],
  recentStandingScene?: RecentStandingScene | null,
  todayIso?: string,
): HarvestStatus {
  if (p >= HARVEST_STATUS_HARVESTED_MIN) {
    const needed = HARVEST_PERSISTENCE_DAYS - 1;
    const persistent =
      previousProbabilities.length >= needed &&
      previousProbabilities
        .slice(0, needed)
        .every((q) => q >= HARVEST_STATUS_HARVESTED_MIN);
    if (!persistent) return 'possibly_harvested';
    if (todayIso && vetoesHarvested(recentStandingScene, todayIso))
      return 'possibly_harvested';
    return 'harvested';
  }
  if (p >= HARVEST_STATUS_POSSIBLE_MIN) return 'possibly_harvested';
  return 'not_harvested';
}

/** Decisiveness: 0 at P = 0.5 (maximally uncertain), 1 at P = 0 or 1. */
export function harvestConfidenceOf(p: number): number {
  return round4(Math.abs(2 * p - 1));
}

export type HarvestDayPrediction = {
  /** ISO date (YYYY-MM-DD). */
  date: string;
  /** Field-mean DM fraction. */
  median: number;
  /** Spatial 10th percentile DM fraction. */
  q5: number;
  /** Spatial 90th percentile DM fraction. */
  q95: number;
};

/** Satellite detection as exposed on the API (subset of the stored row). */
export type HarvestDetectedSummary = {
  status: HarvestDetectionStatus;
  trust: HarvestDetectionTrust;
  windowStart: string;
  windowEnd: string;
  confirmedAt: string | null;
};

export type HarvestEvaluation = {
  harvestProbability: number;
  harvestStatus: HarvestStatus;
  confidence: number;
};

export type HarvestEvaluationOptions = {
  /** P of the previous run days, most recent first (for the persistence rule). */
  previousProbabilities?: readonly number[];
  /** Satellite detection for the field/year, if any. */
  detection?: HarvestDetectedSummary | null;
  /** Latest clear scene for the field/year, if any — vetoes a DM-model "harvested" call when recent and still standing. */
  recentStandingScene?: RecentStandingScene | null;
};

/** Probability for a day of a prediction window (today clamped to the window). */
export function probabilityForDay(
  daily: readonly HarvestDayPrediction[],
  dayIso: string,
): number | null {
  if (daily.length === 0) return null;
  const sorted = [...daily].sort((a, b) => a.date.localeCompare(b.date));
  const day =
    sorted.find((d) => d.date === dayIso) ??
    (dayIso < sorted[0].date ? sorted[0] : sorted[sorted.length - 1]);
  return probHarvested(day.median, day.q5, day.q95);
}

/**
 * Evaluate the harvest probability for today over a DMC daily-prediction
 * window. Today's probability is clamped to the window (DM is monotone, so
 * the first day bounds earlier dates and the last day bounds later ones).
 * A confirmed high-trust satellite detection overrides the DM-based call.
 * Returns null when the window is empty.
 */
export function evaluateHarvest(
  daily: HarvestDayPrediction[],
  todayIso: string,
  opts: HarvestEvaluationOptions = {},
): HarvestEvaluation | null {
  if (detectionOverridesStatus(opts.detection)) {
    return { harvestProbability: 1, harvestStatus: 'harvested', confidence: 1 };
  }
  const todayP = probabilityForDay(daily, todayIso);
  if (todayP == null) return null;
  return {
    harvestProbability: todayP,
    harvestStatus: harvestStatusOf(
      todayP,
      opts.previousProbabilities ?? [],
      opts.recentStandingScene,
      todayIso,
    ),
    confidence: harvestConfidenceOf(todayP),
  };
}

/** The harvest fields exposed on both /harvest and /dmc responses. */
export type HarvestFields = HarvestEvaluation & {
  /** The UTC day all values above were evaluated for. */
  detectionDate: string;
  /** Satellite harvest detection, when one exists for the field/year. */
  harvestDetected?: HarvestDetectedSummary;
};

/**
 * Attach the harvest fields (`harvestProbability`, `harvestStatus`,
 * `detectionDate`, `confidence`, `harvestDetected`) to a DMC-shaped response,
 * derived from the response's own `dailyPredictions` for `todayIso` — or from a
 * confirmed high-trust satellite detection, which overrides the model call.
 *
 * Any pre-existing `harvestProbability` is deliberately overwritten so that all
 * fields describe the same day — see the call site in forecast.ts for why that
 * matters. Returns the response untouched (hence the `Partial`) when the
 * prediction window is empty and no override applies: there is nothing to
 * derive from, and inventing values would be worse than omitting them.
 */
export function withHarvestEvaluation<
  T extends { dailyPredictions: HarvestDayPrediction[] },
>(
  response: T,
  todayIso: string,
  opts: HarvestEvaluationOptions = {},
): T & Partial<HarvestFields> {
  const evaluation = evaluateHarvest(response.dailyPredictions, todayIso, opts);
  if (!evaluation)
    return opts.detection
      ? { ...response, harvestDetected: opts.detection }
      : response;
  return {
    ...response,
    ...evaluation,
    detectionDate: todayIso,
    ...(opts.detection ? { harvestDetected: opts.detection } : {}),
  };
}
