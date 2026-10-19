import { BEK_SOURCES, type BekSource, bekGroup, type CarbonEvaluation, type CarbonReportRow, CREDIT_SOURCES, OPERATION_TYPES, type OperationType } from '@agmeo/contracts'
import { t } from '#/i18n'
import { operationTypeLabel } from '#/i18n/labels'
import { fmt } from '#/lib/format'

/** Colours of the reference charts (agmeo analysis Charts.tsx). */
export const PALETTE = ['#fd7f6f', '#7eb0d5', '#b2e061', '#bd7ebe', '#fdcce5', '#ffb55a', '#ffee65', '#beb9db', '#8bd3c7']

/** A distinct colour per emission source: pf warm, pb cool, pn green. */
export function sourceColor(source: BekSource): string {
  const group = bekGroup(source)
  const list = BEK_SOURCES.filter((s) => bekGroup(s) === group)
  const i = list.indexOf(source)
  const [h0, h1] = group === 'pf' ? [0, 45] : group === 'pb' ? [190, 290] : [95, 150]
  const hue = h0 + ((h1 - h0) * i) / Math.max(1, list.length - 1)
  return `hsl(${Math.round(hue)} 65% ${i % 2 ? 62 : 50}%)`
}

export const sourceLabel = (s: BekSource) => t(`carbon.source.${s}`)
export const opTypeLabel = (type: string) => ((OPERATION_TYPES as readonly string[]).includes(type) ? operationTypeLabel(type as OperationType) : type)

/** What each evaluation divides by. */
export function divisor(row: Pick<CarbonReportRow, 'areaHa' | 'yieldT' | 'yieldTDm'>, evaluation: CarbonEvaluation): number | null {
  if (evaluation === 'total') return 1
  if (evaluation === 'perArea') return row.areaHa || null
  if (evaluation === 'perYield') return row.yieldT || null
  return row.yieldTDm || null
}

export const per = (value: number, row: Pick<CarbonReportRow, 'areaHa' | 'yieldT' | 'yieldTDm'>, evaluation: CarbonEvaluation) => {
  const d = divisor(row, evaluation)
  return d ? value / d : null
}

export const evaluationUnit = (e: CarbonEvaluation) => t(`carbon.unit.${e}`)
export const formatCo2 = (v: number) => fmt.num(v, Math.abs(v) < 10 && v !== 0 ? 1 : 0)

/**
 * The balance without credits and humus (reference "ohne Humusbilanz anzeigen"): removes the
 * by-product credits, the humus balance and land-use change; by operation the values cannot be
 * split, so they are dropped as in the reference.
 */
export function withoutCredits(rows: CarbonReportRow[]): CarbonReportRow[] {
  return rows.map((r) => {
    const bySource = { ...r.bySource }
    let total = r.total
    let pf = r.pf
    let pn = r.pn
    for (const s of CREDIT_SOURCES) {
      const v = bySource[s] ?? 0
      if (!v) continue
      total -= v
      if (bekGroup(s) === 'pf') pf -= v
      else pn -= v
      delete bySource[s]
    }
    return { ...r, bySource, total, pf, pn, byOperationType: {} }
  })
}

/** Sources with a value in at least one row, in method order. */
export function presentSources(rows: CarbonReportRow[], thresholdPerHa = 0): BekSource[] {
  return BEK_SOURCES.filter((s) => rows.some((r) => Math.abs(r.bySource[s] ?? 0) / (r.areaHa || 1) > thresholdPerHa))
}

/** Label of a row's entity: crop, template (with crop) or field (with crop). */
export function entityLabel(r: CarbonReportRow, level: string): string {
  if (level === 'crop') return r.cropName
  if (level === 'template') return r.templateName ? `${r.templateName} (${r.cropName})` : `${r.cropName} · ${t('carbon.noTemplate')}`
  return `${r.entityName} (${r.cropName})`
}
