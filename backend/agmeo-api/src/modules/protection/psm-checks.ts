/**
 * Deviations of plant-protection applications from the BVL approval as recorded in agmeo's copy of
 * the register, ported from AGVOLUTION/agmeo (src/lib/protection/bvlChecks.ts). A finding is a
 * deviation from the approval data, not a legal assessment: the label on the purchased product is
 * what counts, and when several approved uses fit, the farm may have applied under another one.
 * A dose is only compared when the units are comparable; otherwise there is no finding rather
 * than a wrong one.
 */
import type { PsmFindingCode } from '@agmeo/contracts';
import { addDays, daysBetween } from '../planning/dates.js';

export interface ApprovalFacts {
  awgId: string | null;
  /** Approval end of the product. */
  approvalEndsOn: string | null;
  /** End of the use-up period after an approval ended. */
  useUpUntil: string | null;
  bbchFrom: number | null;
  bbchTo: number | null;
  maxApplications: number | null;
  minIntervalDays: number | null;
  /** Highest approved dose, converted to the product's base unit per hectare; null if not comparable. */
  doseMax: number | null;
  doseUnitLabel: string | null;
  /** Pre-harvest interval for the crop; null when covered by the application window or unknown. */
  waitingDays: number | null;
}

export interface AppliedRecord {
  operationId: string;
  date: string | null;
  /** Rate per hectare in the product's base unit. */
  dose: number | null;
  bbch: number | null;
}

export interface RawFinding {
  code: PsmFindingCode;
  severity: 'deviation' | 'notice';
  operationId: string;
  params: Record<string, string | number>;
  message: string;
}

/** BBCH from text like "32", "BBCH 32" or "31-32" (the latest stage counts). */
export function parseBbch(value: string | null | undefined): number | null {
  const all = [...String(value ?? '').matchAll(/\d{1,2}/g)].map((m) => Number(m[0]));
  return all.length ? Math.max(...all) : null;
}

export function checkApplication(applied: AppliedRecord, approval: ApprovalFacts, context: { harvestDate?: string | null; harvestRecorded?: boolean } = {}): RawFinding[] {
  const out: RawFinding[] = [];
  const add = (code: PsmFindingCode, severity: RawFinding['severity'], params: RawFinding['params'], message: string) =>
    out.push({ code, severity, operationId: applied.operationId, params, message });

  if (applied.date) {
    // A product past its approval end stays usable until the use-up period lapses.
    const limit = approval.useUpUntil ?? approval.approvalEndsOn;
    if (limit && applied.date > limit) {
      add('approval_expired', 'deviation', { date: applied.date, limit }, `Applied on ${applied.date}, after the end of the ${approval.useUpUntil ? 'use-up period' : 'approval'} (${limit}).`);
    }
  }
  if (applied.dose != null && approval.doseMax != null && applied.dose > approval.doseMax * 1.0001) {
    add('dose_above_max', 'deviation', { dose: applied.dose, max: approval.doseMax, unit: approval.doseUnitLabel ?? '' }, `Dose ${applied.dose} above the approved maximum of ${approval.doseMax} ${approval.doseUnitLabel ?? ''}.`.trim());
  }
  if (applied.bbch != null && (approval.bbchFrom != null || approval.bbchTo != null)) {
    if ((approval.bbchFrom != null && applied.bbch < approval.bbchFrom) || (approval.bbchTo != null && applied.bbch > approval.bbchTo)) {
      const window = `${approval.bbchFrom ?? '–'}–${approval.bbchTo ?? '–'}`;
      add('bbch_outside_window', 'deviation', { bbch: applied.bbch, window }, `BBCH ${applied.bbch} is outside the approved stages ${window}.`);
    }
  }
  if (applied.date && approval.waitingDays != null && context.harvestDate) {
    const gap = daysBetween(applied.date, context.harvestDate);
    if (gap < approval.waitingDays) {
      add(
        'harvest_before_waiting_period',
        context.harvestRecorded ? 'deviation' : 'notice',
        { gap, waitingDays: approval.waitingDays, harvestDate: context.harvestDate, earliest: addDays(applied.date, approval.waitingDays), harvestRecorded: context.harvestRecorded ? 1 : 0 },
        `${gap} days between application and ${context.harvestRecorded ? 'harvest' : 'planned harvest'} (${context.harvestDate}); the waiting period is ${approval.waitingDays} days.`,
      );
    }
  }
  return out;
}

/** Findings across the applications of ONE product on ONE crop cycle: number and spacing. */
export function checkSeries(applications: readonly AppliedRecord[], approval: ApprovalFacts): RawFinding[] {
  const out: RawFinding[] = [];
  const dated = applications.filter((a) => a.date).sort((a, b) => (a.date! < b.date! ? -1 : 1));
  if (approval.maxApplications != null && applications.length > approval.maxApplications) {
    const last = dated.at(-1) ?? applications[0];
    out.push({
      code: 'too_many_applications',
      severity: 'deviation',
      operationId: last.operationId,
      params: { count: applications.length, max: approval.maxApplications },
      message: `${applications.length} applications on this crop; ${approval.maxApplications} are approved per crop and year.`,
    });
  }
  if (approval.minIntervalDays != null) {
    for (let i = 1; i < dated.length; i++) {
      const gap = daysBetween(dated[i - 1].date!, dated[i].date!);
      if (gap < approval.minIntervalDays) {
        out.push({
          code: 'interval_too_short',
          severity: 'deviation',
          operationId: dated[i].operationId,
          params: { gap, min: approval.minIntervalDays, previous: dated[i - 1].date! },
          message: `${gap} days after the application on ${dated[i - 1].date}; the approved minimum interval is ${approval.minIntervalDays} days.`,
        });
      }
    }
  }
  return out;
}

export const earliestHarvest = (applicationDate: string, waitingDays: number | null) => (waitingDays == null ? null : addDays(applicationDate, waitingDays));
