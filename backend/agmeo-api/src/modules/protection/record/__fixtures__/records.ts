/** Test fixtures for the plant-protection record specs. */
import type { BvlFinding } from '../eu-export.js';
import type { ProtectionLoad } from '../load.js';
import type { ApplicationRecord } from '../records.js';

export const record = (over: Partial<ApplicationRecord> = {}): ApplicationRecord => ({
  operationId: 'op1',
  passId: over.passId ?? over.operationId ?? 'op1',
  inputId: 'in1',
  date: '2026-05-12',
  product: 'Elatus Era',
  kennr: '024306-00',
  awgId: 'awg1',
  dose: 0.8,
  doseUnit: 'l/ha',
  areaHa: 10,
  fieldName: 'Schlag 001',
  fieldId: 'f1',
  hasGeometry: true,
  flik: 'DENILI0123456789',
  crop: 'Winterweizen',
  cropEppo: 'TRZAW',
  applicatorName: 'M. Hoffmann',
  usageType: 'FREILAND',
  targetOrganism: 'Septoria tritici',
  bbch: 39,
  timeOfDay: null,
  timeOfDayRequired: false,
  preHarvestIntervalDays: 35,
  ...over,
});

export const finding = (over: Partial<BvlFinding> = {}): BvlFinding => ({
  operationId: 'op1',
  passId: 'op1',
  code: 'dose_above_max',
  severity: 'deviation',
  message: 'Dose 1.5 above the approved maximum of 1 l/ha.',
  measuredAgainst: 'Elatus Era, Zulassung 024306-00, Anwendung awg1',
  ...over,
});

export const load = (records: ApplicationRecord[], over: Partial<ProtectionLoad> = {}): ProtectionLoad => ({
  year: 2026,
  documented: records,
  planned: 0,
  plannedPasses: [],
  cultivationOf: new Map(records.map((r) => [r.passId, 'c1'])),
  attestations: {
    certificateNumber: 'NI-12345',
    certificateHolder: 'M. Hoffmann',
    certificateValidUntil: '2029-06-30',
    sprayerInspectionNumber: 'PR-9988',
    sprayerInspectedOn: '2025-04-15',
    updatedAt: null,
  },
  bvl: [],
  ...over,
});
