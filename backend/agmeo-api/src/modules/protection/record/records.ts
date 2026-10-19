/**
 * The record a plant-protection application has to carry, field by field.
 *
 * Ported from agmeo `src/lib/protection/records.ts`. §11 PflSchG together with EU 2023/564 has
 * been in force since 01.01.2026; the machine-readable record becomes mandatory on 01.01.2027.
 *
 * What this module does and does not claim:
 *
 * - It checks whether a FIELD IS RECORDED, not whether the application was lawful. A complete
 *   record of an inadmissible application is complete and inadmissible.
 * - The list below is this product's reading of the requirement, tied to where each value comes
 *   from. It is not legal advice, and no deadline or penalty is stated anywhere in the output.
 * - `conditional` fields are only demanded when their condition holds. The time of day is
 *   required where an Auflage demands it (NT127, bee protection), not on every pass.
 *
 * Adapted to the rewrite: one application is one pass of an operation over one field or field
 * part (`passId`, the operation's field line), because an operation here can cover several
 * fields; the labels stay German because the record is the German statutory one.
 */
import { PSM_RECORD_FIRST_YEAR } from '@agmeo/contracts';

export const FIRST_RECORD_YEAR = PSM_RECORD_FIRST_YEAR;

/** One of the record fields, with the place its value is taken from. */
interface RecordField {
  key: string;
  /** What the farmer calls it. */
  label: string;
  /** Where the value lives, so a gap can be fixed rather than argued about. */
  source: string;
  /** `conditional` fields are only required when `condition` holds. */
  requirement: 'always' | 'conditional';
  condition?: string;
}

export const RECORD_FIELDS: readonly RecordField[] = [
  { key: 'date', label: 'Anwendungsdatum', source: 'Datum der Maßnahme', requirement: 'always' },
  { key: 'product', label: 'Mittelname', source: 'Pflanzenschutzmittel der Maßnahme', requirement: 'always' },
  { key: 'kennr', label: 'BVL-Zulassungsnummer', source: 'Zulassungsnummer des Mittels (BVL-Register)', requirement: 'always' },
  { key: 'dose', label: 'Aufwandmenge', source: 'Aufwandmenge je Hektar der Maßnahme', requirement: 'always' },
  { key: 'area', label: 'Behandelte Fläche', source: 'behandelte Fläche der Maßnahme', requirement: 'always' },
  { key: 'fieldName', label: 'Flächenbezeichnung', source: 'Name des Schlags', requirement: 'always' },
  { key: 'fieldLocation', label: 'Lage der Fläche', source: 'Schlaggeometrie oder FLIK', requirement: 'always' },
  { key: 'crop', label: 'Kulturpflanze', source: 'Kultur des Anbaus', requirement: 'always' },
  { key: 'cropEppo', label: 'EPPO-Code der Kultur', source: 'EPPO-Code der Kultur', requirement: 'always' },
  { key: 'applicator', label: 'Anwender', source: 'verantwortliche Person der Maßnahme', requirement: 'always' },
  { key: 'usageType', label: 'Art der Verwendung', source: 'Freiland / Gewächshaus der Maßnahme', requirement: 'always' },
  { key: 'targetOrganism', label: 'Anwendungsgebiet', source: 'Schadorganismus der Maßnahme', requirement: 'always' },
  { key: 'growthStage', label: 'Entwicklungsstadium (BBCH)', source: 'BBCH-Stadium der Maßnahme', requirement: 'always' },
  {
    key: 'timeOfDay',
    label: 'Anwendungsuhrzeit',
    source: 'Uhrzeit der Maßnahme',
    requirement: 'conditional',
    condition: 'nur wo eine Auflage sie verlangt (NT127, Bienenschutz)',
  },
];

/** One documented product application on one pass, normalised to what the checks need. */
export interface ApplicationRecord {
  operationId: string;
  /** The operation's field line: one pass over one field or field part. */
  passId: string;
  /** The operation's input line; null for a pass without a plant-protection product. */
  inputId: string | null;
  date: string | null;
  product: string | null;
  kennr: string | null;
  awgId: string | null;
  /** Rate per hectare in `doseUnit` (e.g. "l/ha"). */
  dose: number | null;
  doseUnit: string | null;
  areaHa: number | null;
  fieldName: string | null;
  fieldId: string;
  hasGeometry: boolean;
  flik: string | null;
  crop: string | null;
  cropEppo: string | null;
  applicatorName: string | null;
  usageType: string | null;
  targetOrganism: string | null;
  bbch: number | null;
  timeOfDay: string | null;
  /** True when an Auflage of this application demands the time of day. */
  timeOfDayRequired: boolean;
  /** Waiting period of the approved use, frozen on the record; null when no use is determined. */
  preHarvestIntervalDays: number | null;
}

interface FieldGap {
  key: string;
  label: string;
  source: string;
}

/**
 * Which required fields this record does not carry.
 *
 * The location counts as recorded when EITHER a geometry or a FLIK is present: the requirement
 * is that the area can be identified, and agmeo's fields are polygons. The export preflight
 * names passes without a FLIK separately.
 */
export function gapsOf(record: ApplicationRecord): FieldGap[] {
  const present: Record<string, boolean> = {
    date: !!record.date,
    product: !!record.product,
    kennr: !!record.kennr,
    dose: record.dose !== null && record.dose > 0 && !!record.doseUnit,
    area: record.areaHa !== null && record.areaHa > 0,
    fieldName: !!record.fieldName,
    fieldLocation: record.hasGeometry || !!record.flik,
    crop: !!record.crop,
    cropEppo: !!record.cropEppo,
    applicator: !!record.applicatorName,
    usageType: !!record.usageType,
    targetOrganism: !!record.targetOrganism,
    growthStage: record.bbch !== null,
    timeOfDay: !!record.timeOfDay,
  };
  return RECORD_FIELDS.filter((field) => {
    if (present[field.key]) return false;
    if (field.requirement === 'conditional') return field.key === 'timeOfDay' ? record.timeOfDayRequired : false;
    return true;
  }).map((field) => ({ key: field.key, label: field.label, source: field.source }));
}

export interface ComplianceSummary {
  applications: number;
  complete: number;
  /** How many applications miss this field, per field, worst first. */
  byField: { key: string; label: string; source: string; missing: number }[];
  /** The applications with the most gaps, for naming examples rather than counts. */
  worst: { operationId: string; passId: string; fieldName: string | null; date: string | null; product: string | null; missing: string[] }[];
}

const WORST_SHOWN = 5;

/** Counts over all applications, with examples: a count alone is not actionable. */
export function summarise(records: readonly ApplicationRecord[]): ComplianceSummary {
  const perField = new Map<string, number>();
  const withGaps: ComplianceSummary['worst'] = [];
  let complete = 0;

  for (const record of records) {
    const gaps = gapsOf(record);
    if (gaps.length === 0) {
      complete += 1;
      continue;
    }
    for (const gap of gaps) perField.set(gap.key, (perField.get(gap.key) ?? 0) + 1);
    withGaps.push({
      operationId: record.operationId,
      passId: record.passId,
      fieldName: record.fieldName,
      date: record.date,
      product: record.product,
      missing: gaps.map((gap) => gap.label),
    });
  }

  const byField = RECORD_FIELDS.filter((field) => (perField.get(field.key) ?? 0) > 0)
    .map((field) => ({ key: field.key, label: field.label, source: field.source, missing: perField.get(field.key) ?? 0 }))
    .sort((a, b) => b.missing - a.missing);

  return {
    applications: records.length,
    complete,
    byField,
    worst: withGaps.sort((a, b) => b.missing.length - a.missing.length).slice(0, WORST_SHOWN),
  };
}
