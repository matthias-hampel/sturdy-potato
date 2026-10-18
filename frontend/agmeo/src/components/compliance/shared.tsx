import type { NutrientGroup, NutrientGroupTotals, PreflightIssue } from '@agmeo/contracts'
import { AlertTriangle, Info, OctagonAlert } from 'lucide-react'
import { LOCALE, t } from '#/i18n'
import { fmt, today } from '#/lib/format'
import { useSeason } from '#/lib/org'
import { Badge } from '#/ui/Layout'
import { cx } from '#/ui/utils'

/** The working season's harvest year, else the current calendar year. */
export function useDefaultYear() {
  const { season } = useSeason()
  return season?.harvestYear ?? Number(today().slice(0, 4))
}

export const NUTRIENT_GROUPS: NutrientGroup[] = ['mineral', 'manure', 'other_organic']

export const nutrientGroupLabel = (group: NutrientGroup | 'total') => t(`regulatory.group.${group}`)

/** Month name of a fertilizer-year start ('MAERZ' → "März"); index 0 is January. */
export const monthLabel = (index: number) => new Date(2000, index, 1).toLocaleDateString(LOCALE, { month: 'long' })

/**
 * Text of a preflight finding. The codes come from the authority library; the common ones are
 * translated under `regulatory.preflight.<code>`, anything else shows the API's message.
 */
export function preflightText(issue: PreflightIssue) {
  return t(`regulatory.preflight.${issue.code}`, { defaultValue: issue.message, ...issue.params })
}

export function PreflightSeverityBadge({ severity }: { severity: PreflightIssue['severity'] }) {
  if (severity === 'blocking')
    return (
      <Badge tone="danger">
        <OctagonAlert className="size-3" aria-hidden />
        {t('regulatory.severity.blocking')}
      </Badge>
    )
  if (severity === 'warning')
    return (
      <Badge tone="warning">
        <AlertTriangle className="size-3" aria-hidden />
        {t('regulatory.severity.warning')}
      </Badge>
    )
  return (
    <Badge tone="info">
      <Info className="size-3" aria-hidden />
      {t('regulatory.severity.info')}
    </Badge>
  )
}

/** kg/ha (or kg) as a whole number; a dash for missing values and a muted zero. */
export function Kg({ value, digits = 0, className }: { value: number | null | undefined; digits?: number; className?: string }) {
  if (value == null) return <span className="text-muted">—</span>
  return <span className={cx('tabular', value === 0 && 'text-muted', className)}>{fmt.num(value, digits)}</span>
}

/** N total · available N · P2O5 of one group in one cell: "120 · 84 · 40". */
export function GroupTriple({ value, className }: { value: NutrientGroupTotals; className?: string }) {
  const empty = !value.n && !value.availableN && !value.p2o5
  if (empty) return <span className="text-muted">—</span>
  return (
    <span className={cx('tabular whitespace-nowrap', className)} title={t('regulatory.triple.title', { n: fmt.num(value.n), availableN: fmt.num(value.availableN), p2o5: fmt.num(value.p2o5) })}>
      {fmt.num(value.n)} <span className="text-muted">·</span> {fmt.num(value.availableN)} <span className="text-muted">·</span> {fmt.num(value.p2o5)}
    </span>
  )
}
