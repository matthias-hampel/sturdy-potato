import type { ExportPreflight, FarmRegulatory, FarmRegulatoryInput, FederalExportFormat, PreflightIssue } from '@agmeo/contracts'
import { LOCALE, t } from '#/i18n'

/** The wizard's steps, in the order of agmeo's fertilizer-reports page. */
export const REPORT_STEPS = ['region', 'readiness', 'farm-data', 'download'] as const
export type ReportStep = (typeof REPORT_STEPS)[number]

/** Where the wizard goes next; `focus: null` clears the field to focus. */
export interface ReportNavigation {
  step?: ReportStep
  format?: FederalExportFormat
  focus?: string | null
}

/** Number of "what happens next" steps per format (`fertilizerReports.formats.<format>.uploadStep<n>`). */
const UPLOAD_STEPS: Record<FederalExportFormat, number> = { enni: 4, endo: 3, st: 3, besyd: 4 }

export const formatTitle = (format: FederalExportFormat) => t(`fertilizerReports.formats.${format}.title`)
export const formatShortName = (format: FederalExportFormat) => t(`fertilizerReports.formats.${format}.shortName`)
export const formatAuthority = (format: FederalExportFormat) => t(`fertilizerReports.formats.${format}.authority`)
export const uploadSteps = (format: FederalExportFormat, date: string) =>
  Array.from({ length: UPLOAD_STEPS[format] }, (_, i) => t(`fertilizerReports.formats.${format}.uploadStep${i + 1}`, { date }))

/** Deadline as the authorities print it (dd.mm.yyyy, Berlin). */
export const formatDeadline = (iso: string) => new Date(iso).toLocaleDateString(LOCALE, { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Berlin' })

export function daysUntil(iso: string, now = new Date()) {
  const days = (Date.parse(iso) - now.getTime()) / 86_400_000
  return days >= 0 ? Math.ceil(days) : Math.floor(days)
}

export type DeadlineTone = 'past' | 'urgent' | 'soon' | 'relaxed'

export function deadlineTone(days: number): DeadlineTone {
  if (days < 0) return 'past'
  if (days <= 14) return 'urgent'
  if (days <= 60) return 'soon'
  return 'relaxed'
}

/** Betriebsnummer patterns of the authorities (the API stores 6–20 digits, the formats are stricter). */
const BETRIEBSNUMMER: Record<FederalExportFormat, RegExp> = {
  enni: /^276\d{12}$/,
  endo: /^276\d{12}$/,
  besyd: /^(12|14|15|16)\d{10}$/,
  st: /^\d{12}$/,
}
export const BETRIEBSNUMMER_EXAMPLES: Record<FederalExportFormat, string> = {
  enni: '276030000000001',
  endo: '276010000000001',
  besyd: '150000000001',
  st: '150000000001',
}
export const isValidBetriebsnummer = (format: FederalExportFormat, value: string) => BETRIEBSNUMMER[format].test(value.trim())

/** A farm datum the authority needs and the farm has not stored (`missing.<key>` findings). */
export interface MissingFarmDatum {
  key: string
  label: string
}

/** An agmeo crop without an authority crop code (`missing_crop_mapping` findings). */
export interface MissingCropMapping {
  cropKey: string
  cropName: string
  count: number
}

const MISSING_PREFIX = 'missing.'

/** Splits the preflight into missing farm data, missing crop mappings and the remaining rule findings. */
export function splitPreflight(preflight: ExportPreflight) {
  const missingFields: MissingFarmDatum[] = []
  const missingCropMappings: MissingCropMapping[] = []
  const issues: PreflightIssue[] = []
  for (const issue of preflight.issues) {
    if (issue.code.startsWith(MISSING_PREFIX)) {
      const key = issue.code.slice(MISSING_PREFIX.length)
      missingFields.push({ key, label: t(`fertilizerReports.missing.${key}`, { defaultValue: issue.message.replace(/^Missing: /, '') }) })
    } else if (issue.code === 'missing_crop_mapping') {
      const cropKey = String(issue.params?.cropKey ?? issue.params?.crop ?? '')
      missingCropMappings.push({ cropKey, cropName: String(issue.params?.crop ?? cropKey), count: Number(issue.params?.count ?? 0) })
    } else issues.push(issue)
  }
  return { missingFields, missingCropMappings, issues }
}

/**
 * The stored farm data as a PUT body. The endpoint replaces the ENNI/ENDO sections, the contact and
 * the declarations, so a change to one value sends everything else unchanged.
 */
export function regulatoryInput(d: FarmRegulatory): FarmRegulatoryInput {
  return {
    holdingNumber: d.holdingNumber,
    euHoldingNumber: d.euHoldingNumber,
    federalState: d.federalState,
    fertilizerYearStart: d.fertilizerYearStart,
    organicCertified: d.organicCertified,
    enni: d.enni,
    endo: d.endo,
    besyd: d.besyd,
    st: d.st,
    contact: d.contact,
    otherFertilizersApplied: d.otherFertilizersApplied,
    compostApplied: d.compostApplied,
    restrictions: d.restrictions,
  }
}
