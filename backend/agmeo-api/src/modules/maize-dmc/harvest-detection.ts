/**
 * Satellite harvest detection for maize-DMC fields — pure functions, no I/O.
 *
 * A harvest shows up in the Sentinel-2 field-mean NDVI as a SUDDEN drop between
 * two cloud-free scenes a few days apart (standing crop 0.5–0.9 → stubble/soil
 * 0.1–0.3). The rule below is deliberately conservative — it was back-tested on
 * 2026-09-08 against every piece of ground truth we had (Teams harvest reports
 * for 10 sites, 1,970 lab/workbook sampling dates as "still standing" evidence,
 * the CZ harvest-progress figure, and the 14.3k-field production population):
 * only a clear signature is trusted, and only a REPRODUCED signature confirms.
 *
 *  1. Eligible scenes: field-level cloud cover 0 %, field-mean NDVI ≥ 0.08
 *     (lower = cloud shadow/haze the scene classifier missed), and not flagged
 *     by the site-consistency check (a whole site collapsing and bouncing back
 *     one scene later is a contaminated scene, not ten simultaneous harvests).
 *  2. Candidate drop: reference = highest eligible NDVI within the 7 days before
 *     the scene (≥ 0.45, i.e. a standing crop); the scene must be ≤ 0.35 and at
 *     least 0.25 below the reference (medium trust) — ≤ 0.30 and ≥ 0.30 below
 *     for high trust. Slow declines (senescence, drought) never qualify.
 *  3. Agronomic gate: the standard-run DM on that day must be ≥ 27 %; without a
 *     run the scene must be on/after the season start date.
 *  4. Confirmation: every eligible scene 2–5 days after the drop must be ≤ 0.35
 *     and within ±0.10 of the drop value → `confirmed`. A scene in that window
 *     that disagrees → `rejected` (contradicting confirmation). No scene yet →
 *     `unconfirmed`; a later scene back above 0.35 → `rejected` (bounce-back).
 *  5. Ground-truth veto: a sampling date later than the drop window means the
 *     crop was still standing → `rejected`.
 *
 * Only `confirmed` + `high` may override the DM-based harvest status (see
 * harvestProbability.ts); everything else is informational.
 */

import { daysBetween } from './plausibility.js';

const NDVI_MIN_VALID = 0.08;
const REFERENCE_WINDOW_DAYS = 7;
/** Also the bar a recent clear scene must clear to veto a DM-model "harvested" call — see {@link vetoesHarvested}. */
export const REFERENCE_MIN_NDVI = 0.45;
const DROP_MIN_MEDIUM = 0.25;
const LOW_MAX_MEDIUM = 0.35;
const DROP_MIN_HIGH = 0.3;
const LOW_MAX_HIGH = 0.3;
const DM_GATE = 0.27;
const CONFIRM_MIN_DAYS = 2;
const CONFIRM_MAX_DAYS = 5;
const CONFIRM_MAX_NDVI = 0.35;
const CONFIRM_SIMILARITY = 0.1;
const SITE_MIN_FIELDS = 3;
const SITE_DROP = 0.25;
const SITE_SHARE = 0.6;
const SITE_RECOVER_TOLERANCE = 0.1;
/** A sampling date this many days after the drop window start still counts as "standing". */
const STANDING_GRACE_DAYS = 1;

export type SceneObservation = {
  date: string; // YYYY-MM-DD
  ndvi: number | null;
  cloudCover: number | null; // field-level %, 0 = cloud-free
};

export type HarvestDetectionStatus = 'unconfirmed' | 'confirmed' | 'rejected';
export type HarvestDetectionTrust = 'high' | 'medium';

export type HarvestDetection = {
  status: HarvestDetectionStatus;
  trust: HarvestDetectionTrust;
  /** Last scene that still showed a standing crop (reference scene). */
  windowStart: string;
  /** First scene showing the drop — the harvest happened in (windowStart, windowEnd]. */
  windowEnd: string;
  referenceNdvi: number;
  dropNdvi: number;
  drop: number;
  /** First confirming scene (status `confirmed`). */
  confirmDate: string | null;
  confirmNdvi: number[];
  rejectedReason: string | null;
};

export type HarvestDetectionInput = {
  scenes: SceneObservation[];
  /** Scene dates flagged by {@link siteContaminatedDates} for this field's site. */
  contaminatedDates: ReadonlySet<string>;
  /** Standard-run DM fraction by ISO date (any day; only scene dates are looked up). */
  dmByDate: ReadonlyMap<string, number>;
  /** Dates on which the crop was verifiably still standing (lab/workbook sampling). */
  standingDates: readonly string[];
  /** Earliest plausible harvest date when no DM run exists for the scene day. */
  seasonStart: string;
};

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function isCloudFree(
  s: SceneObservation,
): s is SceneObservation & { ndvi: number } {
  return s.cloudCover === 0 && s.ndvi != null && Number.isFinite(s.ndvi);
}

function byDate<T extends { date: string }>(a: T, b: T): number {
  return a.date.localeCompare(b.date);
}

/**
 * Scene dates on which a whole site collapsed and bounced back — a contaminated
 * scene (shadow/haze under a "0 % cloud" label), never a synchronized harvest.
 * `fields` = every field of the site with its cloud-free scenes. Sites with
 * fewer than three fields cannot be checked and return an empty set.
 */
export function siteContaminatedDates(
  fields: ReadonlyMap<string, SceneObservation[]>,
): Set<string> {
  const perDate = new Map<
    string,
    { n: number; drops: number; recovered: number }
  >();
  for (const scenes of fields.values()) {
    const clear = scenes.filter(isCloudFree).sort(byDate);
    for (let k = 0; k < clear.length; k++) {
      const stat = perDate.get(clear[k].date) ?? {
        n: 0,
        drops: 0,
        recovered: 0,
      };
      stat.n += 1;
      if (k > 0) {
        const prev = clear[k - 1].ndvi;
        const dropped = prev - clear[k].ndvi > SITE_DROP;
        if (dropped) {
          stat.drops += 1;
          const next = clear[k + 1];
          if (next && next.ndvi >= prev - SITE_RECOVER_TOLERANCE)
            stat.recovered += 1;
        }
      }
      perDate.set(clear[k].date, stat);
    }
  }
  const contaminated = new Set<string>();
  for (const [date, s] of perDate) {
    if (
      s.n >= SITE_MIN_FIELDS &&
      s.drops > 0 &&
      s.drops >= SITE_SHARE * s.n &&
      s.recovered >= SITE_SHARE * s.drops
    ) {
      contaminated.add(date);
    }
  }
  return contaminated;
}

/** Cloud-free, plausible-NDVI, not site-contaminated — sorted by date. */
export function eligibleScenes(
  scenes: readonly SceneObservation[],
  contaminatedDates: ReadonlySet<string>,
): (SceneObservation & { ndvi: number })[] {
  return scenes
    .filter(isCloudFree)
    .filter((s) => s.ndvi >= NDVI_MIN_VALID && !contaminatedDates.has(s.date))
    .sort(byDate);
}

/**
 * Run the detector over one field. Returns null when no candidate drop exists.
 * A rejected candidate does not stop the scan — a later, clean signature can
 * still confirm — but the last rejection is returned when nothing better
 * follows, so the reason stays visible.
 */
export function detectHarvest(
  input: HarvestDetectionInput,
): HarvestDetection | null {
  const scenes = eligibleScenes(input.scenes, input.contaminatedDates);
  let lastRejected: HarvestDetection | null = null;

  for (let k = 1; k < scenes.length; k++) {
    const scene = scenes[k];
    const refScenes = scenes.filter(
      (s) =>
        s.date < scene.date &&
        s.date >= addDays(scene.date, -REFERENCE_WINDOW_DAYS),
    );
    if (refScenes.length === 0) continue;
    const reference = refScenes.reduce((best, s) =>
      s.ndvi > best.ndvi ? s : best,
    );
    const drop = reference.ndvi - scene.ndvi;
    if (
      reference.ndvi < REFERENCE_MIN_NDVI ||
      drop < DROP_MIN_MEDIUM ||
      scene.ndvi > LOW_MAX_MEDIUM
    )
      continue;

    const dm = input.dmByDate.get(scene.date);
    if (dm != null ? dm < DM_GATE : scene.date < input.seasonStart) continue;

    const trust: HarvestDetectionTrust =
      drop >= DROP_MIN_HIGH && scene.ndvi <= LOW_MAX_HIGH ? 'high' : 'medium';
    const windowStart = refScenes[refScenes.length - 1].date;
    const base = {
      trust,
      windowStart,
      windowEnd: scene.date,
      referenceNdvi: reference.ndvi,
      dropNdvi: scene.ndvi,
      drop,
    };

    const standingAfter = input.standingDates.find(
      (d) => d > addDays(windowStart, STANDING_GRACE_DAYS),
    );
    if (standingAfter) {
      lastRejected = {
        ...base,
        status: 'rejected',
        confirmDate: null,
        confirmNdvi: [],
        rejectedReason: `crop sampled on ${standingAfter}, after the drop window`,
      };
      continue;
    }

    const later = scenes.filter((s) => s.date > scene.date);
    const window = later.filter(
      (s) =>
        s.date >= addDays(scene.date, CONFIRM_MIN_DAYS) &&
        s.date <= addDays(scene.date, CONFIRM_MAX_DAYS),
    );
    if (window.length === 0) {
      const bounced = later.find((s) => s.ndvi > CONFIRM_MAX_NDVI);
      if (bounced) {
        lastRejected = {
          ...base,
          status: 'rejected',
          confirmDate: null,
          confirmNdvi: [],
          rejectedReason: `NDVI back to ${bounced.ndvi.toFixed(2)} on ${bounced.date}`,
        };
        continue;
      }
      return {
        ...base,
        status: 'unconfirmed',
        confirmDate: null,
        confirmNdvi: [],
        rejectedReason: null,
      };
    }
    const reproduced = window.every(
      (s) =>
        s.ndvi <= CONFIRM_MAX_NDVI &&
        Math.abs(s.ndvi - scene.ndvi) <= CONFIRM_SIMILARITY,
    );
    if (reproduced) {
      return {
        ...base,
        status: 'confirmed',
        confirmDate: window[0].date,
        confirmNdvi: window.map((s) => s.ndvi),
        rejectedReason: null,
      };
    }
    const contradicting = window.find(
      (s) =>
        s.ndvi > CONFIRM_MAX_NDVI ||
        Math.abs(s.ndvi - scene.ndvi) > CONFIRM_SIMILARITY,
    );
    lastRejected = {
      ...base,
      status: 'rejected',
      confirmDate: null,
      confirmNdvi: window.map((s) => s.ndvi),
      rejectedReason: contradicting
        ? `confirmation scene ${contradicting.date} shows NDVI ${contradicting.ndvi.toFixed(2)}`
        : 'confirmation contradicts the drop',
    };
  }
  return lastRejected;
}

/** A recent clear scene, tracked per (field, year) even without a drop candidate — see MaizeDmcSatelliteStatus. */
export type RecentStandingScene = { date: string; ndvi: number };

/** How stale a clear scene may be and still veto a DM-model "harvested" call — matches the cloud-gap tolerance. */
export const STANDING_VETO_LOOKBACK_DAYS = 14;

/**
 * True when the most recent clear scene is fresh enough (≤ {@link STANDING_VETO_LOOKBACK_DAYS}
 * days old) and still shows a standing crop (NDVI ≥ {@link REFERENCE_MIN_NDVI}) — grounds to veto
 * a DM-model-only "harvested" call (harvestStatusOf in harvestProbability.ts), independent of
 * whether the drop detector ever produced a candidate for this field. A stale or absent scene is
 * uninformative: the DM model drives the call alone, same as today.
 */
export function vetoesHarvested(
  scene: RecentStandingScene | null | undefined,
  todayIso: string,
): boolean {
  if (!scene) return false;
  const age = daysBetween(scene.date, todayIso);
  return (
    age >= 0 &&
    age <= STANDING_VETO_LOOKBACK_DAYS &&
    scene.ndvi >= REFERENCE_MIN_NDVI
  );
}

/** Only a reproduced, high-trust signature may override the DM-based harvest status. */
export function detectionOverridesStatus(
  d: Pick<HarvestDetection, 'status' | 'trust'> | null | undefined,
): boolean {
  return d?.status === 'confirmed' && d.trust === 'high';
}
