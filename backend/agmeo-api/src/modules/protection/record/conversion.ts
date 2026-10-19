/**
 * The conversion window of Art. 3 EU 2023/564.
 *
 * Ported from agmeo `src/lib/protection/conversion.ts`. A planned pass is not a record. Once
 * its day has gone by, it is either a pass that happened and still has to be recorded, or one
 * that did not happen and should be removed. The regulation gives 30 days for the first case;
 * this module names the passes inside the last week of that window and those past it.
 * Nothing here blocks the file: a planned pass is not in the record either way.
 */
import { calendarDate } from '@agmeo/contracts';
import { daysBetween } from '../../planning/dates.js';

export const CONVERSION_WINDOW_DAYS = 30;
export const CONVERSION_WARN_DAYS = 7;

/** A pass still planned or in progress. */
export interface PlannedPass {
  operationId: string;
  passId: string;
  date: string | null;
  cropCycleId: string | null;
  fieldId: string | null;
  fieldName: string | null;
}

export type ConversionFinding = PlannedPass & {
  date: string;
  state: 'overdue' | 'due_soon';
  /** Days left in the window; negative once it has lapsed. */
  daysLeft: number;
};

/** Planned passes whose date lies in the past, worst first. Future plans are not judged. */
export function checkConversion(passes: readonly PlannedPass[], today: Date = new Date()): ConversionFinding[] {
  const todayIso = calendarDate(today);
  if (!todayIso) return [];
  const findings: ConversionFinding[] = [];
  for (const pass of passes) {
    if (!pass.date) continue;
    const daysLeft = CONVERSION_WINDOW_DAYS - daysBetween(pass.date, todayIso);
    if (daysLeft > CONVERSION_WARN_DAYS) continue;
    findings.push({ ...pass, date: pass.date, state: daysLeft < 0 ? 'overdue' : 'due_soon', daysLeft });
  }
  return findings.sort((a, b) => a.daysLeft - b.daysLeft);
}
