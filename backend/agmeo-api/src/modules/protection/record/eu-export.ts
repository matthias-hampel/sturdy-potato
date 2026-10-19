/**
 * The machine-readable record of plant-protection applications, and the preflight that says
 * whether it would be complete.
 *
 * Ported from agmeo `src/lib/protection/euExport.ts`. `buildExport` is pure over the loaded
 * records, so the shape is testable; the preflight reads the document it describes — a
 * preflight that measures something other than the file is the one failure this design rules out.
 *
 * Adapted to the rewrite: the deviations from the BVL approval are not computed here but come
 * with the load from `ProtectionService.check` (the rewrite's port of `bvlChecks.ts`), which
 * the operation page and the compliance report use too; the waiting period is frozen on each
 * record by the loader from the approved use it determined.
 */
import type { PsmFindingCode, PsmUsageType } from '@agmeo/contracts';
import { addDays } from '../../planning/dates.js';
import type { AttestationCheck } from './attestations.js';
import { checkAttestations } from './attestations.js';
import type { ProtectionLoad } from './load.js';
import type { ApplicationRecord, ComplianceSummary } from './records.js';
import { gapsOf, summarise } from './records.js';

/** Bumped whenever the shape changes, so a consumer can tell versions apart. Shared with the reference app. */
export const EXPORT_SCHEMA = 'agmeo.protection.eu-2023-564';
export const EXPORT_SCHEMA_VERSION = 2;

/** The usage types as the schema writes them (the reference app's codes). */
export const USAGE_TYPE_CODES: Record<PsmUsageType, string> = {
  open_field: 'FREILAND',
  greenhouse: 'GEWAECHSHAUS',
  storage: 'LAGER',
  public_area: 'OEFFENTLICHE_FLAECHE',
  seed_treatment: 'BEIZUNG',
  planting_material: 'PFLANZGUT',
};

/** A deviation from the approval, as the readiness and the preflight need it. */
export interface BvlFinding {
  operationId: string;
  /** The pass the finding was measured on; null when it cannot be told. */
  passId: string | null;
  code: PsmFindingCode;
  severity: 'deviation' | 'notice';
  message: string;
  /** The approval it was measured against, so the farmer can check the label. */
  measuredAgainst: string;
}

interface ExportProduct {
  /** The product as booked (its name). */
  articleId: string | null;
  kennr: string | null;
  awgId: string | null;
  targetOrganism: string | null;
  dose: number | null;
  doseUnit: string | null;
  /** dose × area when the unit is per hectare; the dose itself otherwise. */
  absoluteAmount: number | null;
  absoluteAmountUnit: string | null;
  /** Frozen from the approval, so a later amendment does not rewrite history. */
  preHarvestIntervalDays: number | null;
  earliestHarvestDate: string | null;
}

export interface ExportApplication {
  operationId: string;
  passId: string;
  applicationDate: string | null;
  timeOfDay: string | null;
  usageType: string | null;
  field: { id: string; name: string | null; areaHa: number | null; flik: string | null; hasGeometry: boolean };
  crop: { name: string | null; eppoCode: string | null };
  growthStageBbch: number | null;
  applicator: string | null;
  products: ExportProduct[];
  /** Record fields this application does not carry, by their German label. */
  missingFields: string[];
}

export interface ProtectionExport {
  schema: string;
  schemaVersion: number;
  year: number;
  generatedAt: string;
  /** The farm's certificates: not part of the per-application record, but what an audit opens with. */
  farm: {
    sachkunde: { number: string | null; holder: string | null; validUntil: string | null };
    sprayerInspection: { number: string | null; lastInspection: string | null };
  };
  applications: ExportApplication[];
}

const PER_HECTARE = /_ha$|\/\s*ha$/i;

/** A dose per hectare becomes an absolute amount; anything else stays as recorded. */
function absoluteDose(record: ApplicationRecord): { value: number | null; unit: string | null } {
  if (record.dose === null || !record.doseUnit) return { value: null, unit: null };
  if (!PER_HECTARE.test(record.doseUnit)) return { value: record.dose, unit: record.doseUnit };
  if (record.areaHa === null) return { value: null, unit: null };
  return { value: Math.round(record.dose * record.areaHa * 1000) / 1000, unit: record.doseUnit.replace(PER_HECTARE, '') };
}

/**
 * The export document: one application per pass, tank-mix partners nested as products —
 * several products applied in one pass are one application, and flattening them would inflate
 * every count an authority reads.
 */
export function buildExport(load: ProtectionLoad, now: Date = new Date()): ProtectionExport {
  const byPass = new Map<string, ExportApplication>();

  for (const record of load.documented) {
    const dose = absoluteDose(record);
    const product: ExportProduct = {
      articleId: record.product,
      kennr: record.kennr,
      awgId: record.awgId,
      targetOrganism: record.targetOrganism,
      dose: record.dose,
      doseUnit: record.doseUnit,
      absoluteAmount: dose.value,
      absoluteAmountUnit: dose.unit,
      preHarvestIntervalDays: record.preHarvestIntervalDays,
      earliestHarvestDate: record.date && record.preHarvestIntervalDays !== null ? addDays(record.date, record.preHarvestIntervalDays) : null,
    };
    // A pass with no product carries no product entry — an empty one would read as "a product
    // with nothing filled in" rather than "no product was recorded".
    const hasProduct = !!record.product || !!record.kennr || record.dose !== null;

    const existing = byPass.get(record.passId);
    if (existing) {
      if (hasProduct) existing.products.push(product);
      // The application is as incomplete as its worst product row.
      for (const label of gapsOf(record).map((g) => g.label)) {
        if (!existing.missingFields.includes(label)) existing.missingFields.push(label);
      }
      continue;
    }
    byPass.set(record.passId, {
      operationId: record.operationId,
      passId: record.passId,
      applicationDate: record.date,
      timeOfDay: record.timeOfDay,
      usageType: record.usageType,
      field: { id: record.fieldId, name: record.fieldName, areaHa: record.areaHa, flik: record.flik, hasGeometry: record.hasGeometry },
      crop: { name: record.crop, eppoCode: record.cropEppo },
      growthStageBbch: record.bbch,
      applicator: record.applicatorName,
      products: hasProduct ? [product] : [],
      missingFields: gapsOf(record).map((g) => g.label),
    });
  }

  const attestations = checkAttestations(load.attestations, now);
  return {
    schema: EXPORT_SCHEMA,
    schemaVersion: EXPORT_SCHEMA_VERSION,
    year: load.year,
    generatedAt: now.toISOString(),
    farm: {
      sachkunde: { number: attestations.sachkunde.number, holder: attestations.sachkunde.holder, validUntil: attestations.sachkunde.validUntil },
      sprayerInspection: { number: attestations.sprayer.number, lastInspection: attestations.sprayer.lastInspection },
    },
    applications: [...byPass.values()].sort((a, b) => (a.applicationDate ?? '').localeCompare(b.applicationDate ?? '')),
  };
}

export interface ExportPreflight {
  year: number;
  /** Applications the export would contain. */
  applications: number;
  /** Passes still in planning — not records, not exported. */
  planned: number;
  /** Applications whose record fields are all present. */
  exportable: number;
  /** Applications that would go out with a gap. */
  incomplete: number;
  records: ComplianceSummary;
  /** Deviations from the approval, deviations before notices. */
  bvl: BvlFinding[];
  /** Counts per finding code, so the answer can lead with the biggest group. */
  bvlByCode: { code: string; severity: string; count: number }[];
  /** Applications without a FLIK — the record carries the geometry instead. */
  withoutFlik: number;
  /** Sachkundenachweis and sprayer inspection, kept apart from the record fields. */
  attestations: AttestationCheck;
  /** True when nothing blocks a complete file and nothing deviates from the approval. */
  ready: boolean;
}

/** What would make the file wrong or incomplete, without writing it. */
export function preflight(load: ProtectionLoad, document: ProtectionExport, now: Date = new Date()): ExportPreflight {
  const bvl = [...load.bvl].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'deviation' ? -1 : 1));
  const byCode = new Map<string, { severity: string; count: number }>();
  for (const finding of bvl) {
    const entry = byCode.get(finding.code) ?? { severity: finding.severity, count: 0 };
    entry.count += 1;
    byCode.set(finding.code, entry);
  }

  const incomplete = document.applications.filter((a) => a.missingFields.length > 0).length;
  return {
    year: load.year,
    applications: document.applications.length,
    planned: load.planned,
    exportable: document.applications.length - incomplete,
    incomplete,
    records: summarise(load.documented),
    bvl,
    bvlByCode: [...byCode.entries()].map(([code, v]) => ({ code, severity: v.severity, count: v.count })).sort((a, b) => b.count - a.count),
    withoutFlik: document.applications.filter((a) => !a.field.flik).length,
    attestations: checkAttestations(load.attestations, now),
    // The certificates do not block the file — the record of what was applied is complete
    // without them. They are reported beside it, because an audit asks for them first.
    ready: incomplete === 0 && bvl.every((f) => f.severity !== 'deviation'),
  };
}
