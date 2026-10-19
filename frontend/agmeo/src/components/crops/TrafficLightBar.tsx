import type { ConditionDay, ConditionReason, Dimension } from '@agmeo/contracts'
import { t } from '#/i18n'
import { fmt } from '#/lib/format'
import { cx } from '#/ui/utils'

/** Colours of the reference's traffic-light bars: 0 best … 3 worst. */
const LEVEL = ['var(--color-success)', 'color-mix(in oklab, var(--color-success) 45%, var(--color-warning))', 'var(--color-warning)', 'var(--color-danger)'] as const

function reason(r: ConditionReason) {
  if (r.key.startsWith('reason.disease.')) return `${t(`conditions.disease.name.${r.key.slice('reason.disease.'.length)}`)}: ${t(`conditions.disease.level.${r.value ?? 0}`)}`
  const label = t(`conditions.${r.key}`, { defaultValue: r.key.replace('reason.', '') })
  if (r.value == null) return label
  if (r.dimension === 'hours') return `${label}: ${fmt.num(r.value)} h`
  if (r.dimension) return `${label}: ${fmt.measure(r.value, r.dimension as Dimension, { digits: r.dimension === 'speed' ? 0 : 1 })}`
  return `${label}: ${fmt.num(r.value, 1)}`
}

/**
 * A compact bar of daily condition levels for a table cell (reference TrafficLightBar): one cell
 * per day, the level and its reasons on hover. `disease` uses the disease risk labels.
 */
export function TrafficLightBar({ days, kind = 'condition', className }: { days: ConditionDay[] | null | undefined; kind?: 'condition' | 'disease'; className?: string }) {
  if (!days?.length || days.every((d) => d.value == null)) return <span className="text-muted">—</span>
  const label = (v: ConditionDay['value']) => (v == null ? t('conditions.level.none') : kind === 'disease' ? t(`conditions.disease.level.${v}`) : t(`conditions.level.${v}`))
  const summary = days.map((d) => `${fmt.date(d.date, { day: '2-digit', month: '2-digit' })}: ${label(d.value)}${d.reasons.length ? ` (${d.reasons.map(reason).join(', ')})` : ''}`).join('\n')
  return (
    <div role="img" aria-label={summary} title={summary} className={cx('flex w-28 gap-px', className)}>
      {days.map((d) => (
        <span key={d.date} className="h-4 flex-1 rounded-[2px]" style={{ background: d.value == null ? 'var(--color-surface-3)' : LEVEL[d.value] }} />
      ))}
    </div>
  )
}
