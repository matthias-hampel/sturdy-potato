/**
 * Ported from AGVOLUTION/agmeo src/lib/irrigation/recommendation.ts — logic, numbers and
 * thresholds unchanged; only imports adapted to the rewrite.
 */

/**
 * Irrigation recommendation (quantity + timing) derived from a simulated
 * water-balance series that already extends into the forecast window.
 *
 * Pure — no I/O, no clock: `today` is injected. The engine deliberately scans
 * the SAME `WaterBalanceDay[]` the UI charts (incl. `forecast: true` days and
 * any already-planned irrigation transactions) instead of re-running the
 * bucket, so the recommendation can never disagree with the displayed series.
 *
 * Trigger philosophy: the base trigger is 50 % depletion of AWC — exactly the
 * `getDeficitLevel` ok/warning boundary — so "badge turns yellow" and
 * "irrigation is due" are the same event. FAO-56's raw RAW = p·TAW is NOT used
 * directly because crop-specific p (0.35–0.6) would let the recommendation
 * fire before/after the badge. During yield-sensitive BBCH windows the trigger
 * tightens to 40 % depletion.
 */

import type { SupportedCrops } from '../crops.js';
import {
  fillRatioPct,
  REFILL_TARGET,
  type WaterBalanceDay,
} from './waterBalance.js';

// ── Public types ──

export type RecommendationStatus = 'due' | 'upcoming' | 'none' | 'missing_data';

export type RecommendationReason =
  | 'deficit_below_trigger'
  | 'rain_expected'
  | 'heat_stress_ahead'
  | 'sensitive_stage';

export type IrrigationRecommendation = {
  status: RecommendationStatus;
  /** ISO date the trigger is (expected to be) crossed. Absent when `none`/`missing_data`. */
  triggerDate?: string;
  /** Days until the trigger is crossed; 0 = due today. */
  daysUntil?: number;
  /** Recommended dose (mm), rounded to 5, clamped to [MIN_DOSE_MM, maxDoseMm]. */
  doseMm?: number;
  /** Today's deficit (mm below FC). */
  deficitMm?: number;
  /** Today's plant-available water as % nFK. */
  nfkPct?: number;
  /** Absolute trigger deficit (mm). */
  triggerMm?: number;
  reasons?: RecommendationReason[];
  /** Forecast dates (within the horizon) with Tmax at/above the crop's stress threshold. */
  heatStressDays?: string[];
  /** Last modeled BBCH stage, when the phenology model covers the crop. */
  bbchStage?: number;
};

export type RecommendationInput = {
  crop: SupportedCrops | null;
  /** Field capacity over the root zone (mm). */
  fcMm: number | null;
  /** Available water capacity (FC − PWP) over the root zone (mm). */
  awcMm: number | null;
  /** Simulated daily series incl. forecast-flagged days (chronological). */
  days: WaterBalanceDay[] | null;
  /** yyyy-mm-dd — injected so routes and tests share one clock. */
  today: string;
  /** Forecast daily Tmax by ISO date (only forecast days need to be present). */
  tempMaxByDate?: Record<string, number>;
  /** Last modeled BBCH stage (null when the phenology model lacks the crop). */
  bbchStage?: number | null;
  /** Dose cap (mm) — application-technique constraint. */
  maxDoseMm?: number;
};

// ── Tunables (exported for tests) ──

/** How many forecast days ahead the timing scan looks. */
const HORIZON_DAYS = 7;
export const MAX_DOSE_MM = 35;
export const MIN_DOSE_MM = 10;
const DOSE_STEP_MM = 5;
/** Depletion fraction of AWC that triggers irrigation (= getDeficitLevel warning boundary). */
export const BASE_TRIGGER_DEPLETION = 0.5;
/** Tightened trigger during yield-sensitive BBCH windows. */
export const SENSITIVE_TRIGGER_DEPLETION = 0.4;
/** A "due" today is deferred when rain within this window refills below the trigger. */
const RAIN_DELAY_LOOKAHEAD_DAYS = 2;
/** …and that rain amounts to at least this fraction of the dose. */
const RAIN_DELAY_FRACTION = 0.5;
/** A heat day within this many days of a "due" adds the heat-stress reason. */
const HEAT_NEAR_DUE_DAYS = 3;

/**
 * Air-Tmax proxy for leaf/canopy heat stress (canopy temperature is not in the
 * data model). Crossing the threshold during the sensitive season marks the
 * day as a stress day; irrigation shortly before it mitigates via
 * transpirational cooling. Literature anchors: small-grain cereals ~31 °C at
 * anthesis/grain fill (Porter & Gawith 1999), canola ~29.5 °C at flowering
 * (Morrison & Stewart 2002), maize ~34–35 °C around pollination (Lobell et
 * al. 2013); sugar beet is comparatively heat-tolerant.
 */
const HEAT_STRESS_TMAX_DEFAULT = 32;
export const HEAT_STRESS_TMAX: Partial<Record<SupportedCrops, number>> = {
  winterWheat: 30,
  winterBarleyFodder: 30,
  winterRyeBaking: 30,
  triticaleFodder: 30,
  spelt: 30,
  hardWheat: 30,
  springBarleyMalting: 30,
  springOatsFodder: 30,
  canola: 29,
  silageMaize: 34,
  grainMaize: 34,
  sugarBeet: 34,
};

/**
 * Yield-sensitive BBCH windows (FAO-66 / FAO-56 yield-response stages):
 * cereals booting→grain fill, canola bud→flowering, maize tassel→blister,
 * sugar beet rapid canopy/root growth. Inside the window the trigger tightens
 * to SENSITIVE_TRIGGER_DEPLETION.
 */
const SENSITIVE_BBCH: Partial<
  Record<SupportedCrops, { from: number; to: number }>
> = {
  winterWheat: { from: 39, to: 77 },
  winterBarleyFodder: { from: 39, to: 77 },
  winterRyeBaking: { from: 39, to: 77 },
  triticaleFodder: { from: 39, to: 77 },
  spelt: { from: 39, to: 77 },
  hardWheat: { from: 39, to: 77 },
  springBarleyMalting: { from: 39, to: 77 },
  springOatsFodder: { from: 39, to: 77 },
  canola: { from: 57, to: 69 },
  silageMaize: { from: 51, to: 75 },
  grainMaize: { from: 51, to: 75 },
  sugarBeet: { from: 33, to: 49 },
};

// ── Helpers ──

const MS_PER_DAY = 86_400_000;

function diffDays(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(toIso) - Date.parse(fromIso)) / MS_PER_DAY);
}

function roundToStep(mm: number): number {
  return Math.round(mm / DOSE_STEP_MM) * DOSE_STEP_MM;
}

function isInSensitiveWindow(
  crop: SupportedCrops | null,
  bbch: number | null | undefined,
): boolean {
  if (!crop || bbch == null) return false;
  const window = SENSITIVE_BBCH[crop];
  return !!window && bbch >= window.from && bbch <= window.to;
}

function getHeatStressThreshold(crop: SupportedCrops | null): number {
  if (!crop) return HEAT_STRESS_TMAX_DEFAULT;
  return HEAT_STRESS_TMAX[crop] ?? HEAT_STRESS_TMAX_DEFAULT;
}

// ── Engine ──

export function computeIrrigationRecommendation(
  input: RecommendationInput,
): IrrigationRecommendation {
  const {
    crop,
    fcMm,
    awcMm,
    days,
    today,
    tempMaxByDate = {},
    bbchStage = null,
  } = input;
  const maxDoseMm = input.maxDoseMm ?? MAX_DOSE_MM;

  if (
    !days ||
    days.length === 0 ||
    fcMm == null ||
    awcMm == null ||
    awcMm <= 0
  ) {
    return { status: 'missing_data' };
  }

  // Anchor "today" exactly like computeWaterBalance's currentIdx: today's day
  // if simulated, else the last non-forecast day.
  let todayIdx = days.findIndex((d) => d.date === today);
  if (todayIdx === -1) {
    for (let i = days.length - 1; i >= 0; i--) {
      if (!days[i].forecast) {
        todayIdx = i;
        break;
      }
    }
  }
  if (todayIdx === -1) return { status: 'missing_data' };

  const todayDay = days[todayIdx];
  const sensitive = isInSensitiveWindow(crop, bbchStage);
  const triggerDepletion = sensitive
    ? SENSITIVE_TRIGGER_DEPLETION
    : BASE_TRIGGER_DEPLETION;
  const triggerMm = Math.round(triggerDepletion * awcMm * 10) / 10;

  const horizon = days.slice(todayIdx, todayIdx + HORIZON_DAYS + 1); // today + up to 7 forecast days

  const heatThreshold = getHeatStressThreshold(crop);
  const heatStressDays = horizon
    .slice(1)
    .map((d) => d.date)
    .filter((date) => {
      const tmax = tempMaxByDate[date];
      return tmax != null && tmax >= heatThreshold;
    });

  const base = {
    deficitMm: todayDay.deficit,
    nfkPct: Math.round(fillRatioPct(awcMm, todayDay.deficit) ?? 0),
    triggerMm,
    ...(bbchStage != null ? { bbchStage } : {}),
    ...(heatStressDays.length > 0 ? { heatStressDays } : {}),
  };

  // First crossing within the horizon (the series already contains forecast
  // rain, ET and any planned irrigation — no separate projection needed).
  const crossingIdx = horizon.findIndex((d) => d.deficit >= triggerMm);

  const reasons: RecommendationReason[] = [];
  if (sensitive) reasons.push('sensitive_stage');

  // Dose for a given crossing day: refill to REFILL_TARGET·FC minus rain that
  // the forecast still expects after that day (within the horizon).
  const doseFor = (idx: number): number => {
    const day = horizon[idx];
    const refillNeed = REFILL_TARGET * fcMm - day.swc;
    const rainAfter = horizon
      .slice(idx + 1)
      .reduce((sum, d) => sum + d.precipitation, 0);
    const raw = roundToStep(refillNeed - rainAfter);
    return Math.max(MIN_DOSE_MM, Math.min(maxDoseMm, raw));
  };

  if (crossingIdx === -1) {
    return { status: 'none', ...base, ...(reasons.length ? { reasons } : {}) };
  }

  if (crossingIdx === 0) {
    // Due today. Rain refinement: if the next days' rain both (a) amounts to a
    // meaningful fraction of the dose and (b) actually pulls the simulated
    // deficit back under the trigger, defer instead of recommending now.
    const dose = doseFor(0);
    const nearRain = horizon
      .slice(1, 1 + RAIN_DELAY_LOOKAHEAD_DAYS)
      .reduce((sum, d) => sum + d.precipitation, 0);
    const recoveryIdx = horizon.findIndex(
      (d, i) =>
        i > 0 && i <= RAIN_DELAY_LOOKAHEAD_DAYS && d.deficit < triggerMm,
    );
    if (nearRain >= RAIN_DELAY_FRACTION * dose && recoveryIdx !== -1) {
      reasons.push('rain_expected');
      // Recommend again only if the deficit re-crosses after the recovery.
      const reCrossIdx = horizon.findIndex(
        (d, i) => i > recoveryIdx && d.deficit >= triggerMm,
      );
      if (reCrossIdx === -1) {
        return { status: 'none', ...base, reasons };
      }
      return {
        status: 'upcoming',
        triggerDate: horizon[reCrossIdx].date,
        daysUntil: diffDays(todayDay.date, horizon[reCrossIdx].date),
        doseMm: doseFor(reCrossIdx),
        ...base,
        reasons,
      };
    }

    reasons.unshift('deficit_below_trigger');
    if (
      heatStressDays.length > 0 &&
      diffDays(todayDay.date, heatStressDays[0]) <= HEAT_NEAR_DUE_DAYS
    ) {
      reasons.push('heat_stress_ahead');
    }
    return {
      status: 'due',
      triggerDate: todayDay.date,
      daysUntil: 0,
      doseMm: dose,
      ...base,
      reasons,
    };
  }

  // Upcoming. Heat refinement: a stress day at/before (trigger + 1 day) pulls
  // the recommended date forward to the day before the first heat day, so the
  // crop enters the hot spell with a refilled profile.
  let recommendIdx = crossingIdx;
  let triggerDate = horizon[crossingIdx].date;
  if (heatStressDays.length > 0) {
    const firstHeat = heatStressDays[0];
    if (
      diffDays(todayDay.date, firstHeat) <=
      diffDays(todayDay.date, triggerDate) + 1
    ) {
      const advancedIdx = Math.max(
        1,
        horizon.findIndex((d) => d.date === firstHeat) - 1,
      );
      if (advancedIdx < crossingIdx) {
        recommendIdx = advancedIdx;
        triggerDate = horizon[advancedIdx].date;
      }
      reasons.push('heat_stress_ahead');
    }
  }

  return {
    status: 'upcoming',
    triggerDate,
    daysUntil: diffDays(todayDay.date, triggerDate),
    doseMm: doseFor(recommendIdx),
    ...base,
    ...(reasons.length ? { reasons } : {}),
  };
}
