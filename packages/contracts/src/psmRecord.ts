import { z } from 'zod';
import { isoDate } from './common.js';

// ---------------------------------------------------------------------------
// Plant-protection record (§11 PflSchG, EU Implementing Regulation 2023/564)
// ---------------------------------------------------------------------------

/**
 * The record of EU 2023/564 applies to applications from 01.01.2026; earlier years were
 * recorded under the previous rules and are not judged by its checks.
 */
export const PSM_RECORD_FIRST_YEAR = 2026;

/** Where a product was applied ("Art der Verwendung"); kept in the crop-protection operation's details. */
export const PSM_USAGE_TYPES = ['open_field', 'greenhouse', 'storage', 'public_area', 'seed_treatment', 'planting_material'] as const;
export type PsmUsageType = (typeof PSM_USAGE_TYPES)[number];

export const PSM_RECORD_FORMATS = ['csv', 'json'] as const;
export type PsmRecordFormat = (typeof PSM_RECORD_FORMATS)[number];

/** The farm's Sachkundenachweis and sprayer inspection, kept once per organization. */
export interface PsmAttestations {
  certificateNumber: string | null;
  certificateHolder: string | null;
  certificateValidUntil: string | null;
  sprayerInspectionNumber: string | null;
  sprayerInspectedOn: string | null;
  updatedAt: string | null;
}

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => v || null);

export const PsmAttestationsInput = z.object({
  certificateNumber: text(30),
  certificateHolder: text(100),
  certificateValidUntil: isoDate.nullish().transform((v) => v ?? null),
  sprayerInspectionNumber: text(30),
  sprayerInspectedOn: isoDate.nullish().transform((v) => v ?? null),
});
export type PsmAttestationsInput = z.input<typeof PsmAttestationsInput>;

export const PsmRecordInput = z.object({
  year: z.int().min(2000).max(2100),
  format: z.enum(PSM_RECORD_FORMATS),
  /** Generate the record as it stands although applications still miss required fields. */
  includeIncomplete: z.boolean().default(false),
});
export type PsmRecordInput = z.input<typeof PsmRecordInput>;

export type PsmReadinessSeverity = 'blocking' | 'warning' | 'info';
/** Where a gap is closed: the operation, the field's master data, or the farm-data step. */
export type PsmReadinessFix = 'protection' | 'fieldsManager' | 'farmData';

/** One pass of an operation over one field (or field part) that a readiness rule concerns. */
export interface PsmAffectedPass {
  operationId: string;
  /** The operation's field line; an operation over several fields is one pass per field. */
  passId: string;
  cropCycleId: string | null;
  fieldId: string | null;
  fieldName: string | null;
  date: string | null;
  /** The finding's own sentence where there is one (BVL deviations). */
  detail?: string;
}

export interface PsmReadinessItem {
  /** `field_<key>`, `bvl_<code>`, `sachkunde_*`, `sprayer_*`, `conversion_*`, `without_flik`, `planned`. */
  code: string;
  severity: PsmReadinessSeverity;
  fix: PsmReadinessFix;
  params?: Record<string, string | number>;
  /** The first passes this row concerns; `count` has them all. */
  affected: PsmAffectedPass[];
  count: number;
}

export interface PsmRecordReadiness {
  year: number;
  items: PsmReadinessItem[];
  /** Documented applications (passes) the record would contain. */
  applications: number;
  /** Of those, the ones still missing a required field. */
  incomplete: number;
  /** Passes still in planning: not records, not exported. */
  planned: number;
  /** No gap and no deviation from the approval. */
  ready: boolean;
}

/** Every pass of one readiness row, beyond the few the readiness list carries. */
export interface PsmIssueTargets {
  passes: PsmAffectedPass[];
  params?: Record<string, string | number>;
}

export interface PsmRecordResult {
  filename: string;
  mimeType: string;
  body: string;
  /** False when the copy for Files > Exports could not be stored; the download still works. */
  archived: boolean;
  fileId: string | null;
}

/** A generated record archived in Files > Exports. */
export interface PsmRecordFile {
  id: string;
  name: string;
  sizeBytes: number;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Form validation of the certificates (ported from agmeo src/lib/protection/attestationValidation.ts)
// ---------------------------------------------------------------------------

/**
 * The calendar date of a value as the farm wrote it: the local components of a Date, or the
 * first ten characters of a string — never through UTC, which renders local midnight in
 * Europe/Berlin as 22:00 of the day before.
 */
export function calendarDate(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(value).trim());
  return m?.[1] ?? null;
}

export type PsmAttestationError = 'required' | 'invalidFormat' | 'tooLong' | 'invalidDate' | 'notInFuture' | 'expired';
export type PsmAttestationErrors = Partial<Record<keyof PsmAttestationsInput, PsmAttestationError>>;
export type PsmAttestationsForm = { [K in keyof PsmAttestationsInput]?: string | null };

const NUMBER_LENGTH = { min: 3, max: 30 };
const NAME_MAX_LENGTH = 100;

const numberError = (value: string | null | undefined): PsmAttestationError | null => {
  const trimmed = value?.trim() || '';
  if (!trimmed) return 'required';
  return trimmed.length < NUMBER_LENGTH.min || trimmed.length > NUMBER_LENGTH.max ? 'invalidFormat' : null;
};

/** The stored `YYYY-MM-DD` as a calendar day, or null when it is not one. */
const calendarDay = (value: string): string | null => {
  const iso = calendarDate(value);
  return iso && !Number.isNaN(Date.parse(`${iso}T00:00:00Z`)) ? iso : null;
};

/**
 * Errors of the farm-data form, as codes the form translates. Dates compare as calendar days,
 * so an inspection dated today is not "in the future" and a certificate expiring today is valid.
 */
export function validateAttestations(form: PsmAttestationsForm, today: Date): PsmAttestationErrors {
  const errors: PsmAttestationErrors = {};
  const todayIso = calendarDate(today) ?? '';

  const certificate = numberError(form.certificateNumber);
  if (certificate) errors.certificateNumber = certificate;

  const holder = form.certificateHolder?.trim() || '';
  if (!holder) errors.certificateHolder = 'required';
  else if (holder.length > NAME_MAX_LENGTH) errors.certificateHolder = 'tooLong';

  if (!form.certificateValidUntil) errors.certificateValidUntil = 'required';
  else {
    const expiry = calendarDay(form.certificateValidUntil);
    if (!expiry) errors.certificateValidUntil = 'invalidDate';
    else if (expiry < todayIso) errors.certificateValidUntil = 'expired';
  }

  const sprayer = numberError(form.sprayerInspectionNumber);
  if (sprayer) errors.sprayerInspectionNumber = sprayer;

  if (!form.sprayerInspectedOn) errors.sprayerInspectedOn = 'required';
  else {
    const inspected = calendarDay(form.sprayerInspectedOn);
    if (!inspected) errors.sprayerInspectedOn = 'invalidDate';
    else if (inspected > todayIso) errors.sprayerInspectedOn = 'notInFuture';
  }

  return errors;
}
