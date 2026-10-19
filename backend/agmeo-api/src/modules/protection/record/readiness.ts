/**
 * The readiness list of the record wizard: the preflight regrouped into rows a farmer can act on.
 *
 * Ported from agmeo `src/lib/protection/readiness.ts`. Nothing is checked here: the record
 * fields come from `records.gapsOf` via the export document, the deviations from the BVL checks,
 * the certificates from `attestations`, the conversion window from `conversion` — one engine,
 * so the page can never report a gap the file would silently fill. What this module adds is
 * the grouping (one row per rule, the passes it concerns underneath) and where each gap is closed.
 */
import type { PsmAffectedPass, PsmIssueTargets, PsmReadinessFix, PsmReadinessItem, PsmReadinessSeverity } from '@agmeo/contracts';
import { SACHKUNDE_WARN_DAYS } from './attestations.js';
import { checkConversion } from './conversion.js';
import type { ExportPreflight, ProtectionExport } from './eu-export.js';
import type { ProtectionLoad } from './load.js';
import { RECORD_FIELDS } from './records.js';

type Finding = Omit<PsmReadinessItem, 'affected' | 'count'> & { passes: PsmAffectedPass[] };

/** Enough to recognise the problem; the full list is one request away. */
const AFFECTED_SHOWN = 8;

/**
 * Record fields that are not a property of the operation; every other one (product, dose and
 * treated area included — they are edited on the operation here) is closed on the operation.
 */
const FIELD_FIX: Record<string, PsmReadinessFix> = {
  fieldName: 'fieldsManager',
  fieldLocation: 'fieldsManager',
  crop: 'fieldsManager',
  cropEppo: 'fieldsManager',
};

const SACHKUNDE_CODES: Record<string, string> = { missing: 'sachkunde_missing', unknown: 'sachkunde_unknown', expired: 'sachkunde_expired' };
const SPRAYER_CODES: Record<string, string> = { missing: 'sprayer_missing', unknown: 'sprayer_unknown', overdue: 'sprayer_overdue' };

const item = (code: string, severity: PsmReadinessSeverity, fix: PsmReadinessFix, passes: PsmAffectedPass[], params?: Record<string, string | number>): Finding => ({
  code,
  severity,
  fix,
  params,
  passes,
});

function collectFindings(load: ProtectionLoad, document: ProtectionExport, assessment: ExportPreflight, now: Date): Finding[] {
  const byPass = new Map(document.applications.map((a) => [a.passId, a]));
  const firstPassOf = new Map<string, string>();
  for (const a of document.applications) if (!firstPassOf.has(a.operationId)) firstPassOf.set(a.operationId, a.passId);
  const passOf = (operationId: string, passId: string | null, detail?: string): PsmAffectedPass => {
    const id = passId ?? firstPassOf.get(operationId) ?? operationId;
    const application = byPass.get(id);
    return {
      operationId,
      passId: id,
      cropCycleId: load.cultivationOf.get(id) ?? null,
      fieldId: application?.field.id || null,
      fieldName: application?.field.name ?? null,
      date: application?.applicationDate ?? null,
      detail,
    };
  };
  const items: Finding[] = [];

  // One row per record field, the field most often missing first. The export document is one
  // entry per pass, so a tank mix counts once.
  const keyByLabel = new Map(RECORD_FIELDS.map((field) => [field.label, field.key]));
  const gaps = new Map<string, PsmAffectedPass[]>();
  for (const application of document.applications) {
    for (const label of application.missingFields) {
      const key = keyByLabel.get(label);
      if (!key) continue;
      const list = gaps.get(key) ?? [];
      list.push(passOf(application.operationId, application.passId));
      gaps.set(key, list);
    }
  }
  items.push(
    ...[...gaps.entries()].sort((a, b) => b[1].length - a[1].length).map(([key, passes]) => item(`field_${key}`, 'blocking', FIELD_FIX[key] ?? 'protection', passes)),
  );

  // Deviations from the approval belong IN the record; they do not block the file, so a
  // deviation is a warning and a notice stays a hint.
  const deviations = new Map<string, { severity: PsmReadinessSeverity; passes: PsmAffectedPass[] }>();
  for (const finding of assessment.bvl) {
    let entry = deviations.get(finding.code);
    if (!entry) {
      entry = { severity: finding.severity === 'deviation' ? 'warning' : 'info', passes: [] };
      deviations.set(finding.code, entry);
    }
    entry.passes.push(passOf(finding.operationId, finding.passId, finding.message));
  }
  for (const [code, entry] of deviations) items.push(item(`bvl_${code}`, entry.severity, 'protection', entry.passes));

  const { sachkunde, sprayer } = assessment.attestations;
  const sachkundeCode = SACHKUNDE_CODES[sachkunde.state];
  if (sachkundeCode) items.push(item(sachkundeCode, 'warning', 'farmData', [], { date: sachkunde.validUntil ?? '' }));
  if (sachkunde.state === 'ok' && sachkunde.daysLeft !== null && sachkunde.daysLeft <= SACHKUNDE_WARN_DAYS) {
    items.push(item('sachkunde_expiring', 'warning', 'farmData', [], { date: sachkunde.validUntil ?? '' }));
  }
  const sprayerCode = SPRAYER_CODES[sprayer.state];
  if (sprayerCode) items.push(item(sprayerCode, 'warning', 'farmData', [], { date: sprayer.lastInspection ?? '' }));

  const asPass = (p: ProtectionLoad['plannedPasses'][number]): PsmAffectedPass => ({
    operationId: p.operationId,
    passId: p.passId,
    cropCycleId: p.cropCycleId,
    fieldId: p.fieldId,
    fieldName: p.fieldName,
    date: p.date,
  });
  const conversion = checkConversion(load.plannedPasses, now);
  const overdue = conversion.filter((finding) => finding.state === 'overdue');
  const dueSoon = conversion.filter((finding) => finding.state === 'due_soon');
  if (overdue.length > 0) items.push(item('conversion_overdue', 'warning', 'protection', overdue.map(asPass)));
  // The findings arrive worst first, so the first due-soon pass has the fewest days left.
  if (dueSoon.length > 0) items.push(item('conversion_due_soon', 'warning', 'protection', dueSoon.map(asPass), { days: dueSoon[0].daysLeft }));

  const withoutFlik = document.applications.filter((a) => !a.field.flik).map((a) => passOf(a.operationId, a.passId));
  if (withoutFlik.length > 0) items.push(item('without_flik', 'info', 'fieldsManager', withoutFlik));
  if (load.plannedPasses.length > 0) items.push(item('planned', 'info', 'protection', load.plannedPasses.map(asPass)));

  return items;
}

export const buildReadiness = (load: ProtectionLoad, document: ProtectionExport, assessment: ExportPreflight, now: Date = new Date()): PsmReadinessItem[] =>
  collectFindings(load, document, assessment, now).map(({ passes, ...finding }) => ({ ...finding, affected: passes.slice(0, AFFECTED_SHOWN), count: passes.length }));

/** All passes of the row `code`; empty once the row is gone, i.e. fixed. */
export function issueTargets(load: ProtectionLoad, document: ProtectionExport, assessment: ExportPreflight, code: string, now: Date = new Date()): PsmIssueTargets {
  const finding = collectFindings(load, document, assessment, now).find((f) => f.code === code);
  // A BVL finding is per product, so a tank mix can name its pass twice.
  const passes = [...new Map((finding?.passes ?? []).map((pass) => [pass.passId, pass])).values()];
  return { passes, params: finding?.params };
}
