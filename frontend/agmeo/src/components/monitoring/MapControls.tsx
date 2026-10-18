import { INDEX_SCALES, type ImageryDate, type ImageryLayer, type ImageryStatus, type ImageryStretch } from '@agmeo/contracts'
import { ChevronLeft, ChevronRight, Satellite } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { t } from '#/i18n'
import { fmt } from '#/lib/format'
import { Button, SegmentedControl } from '#/ui/Button'
import { Option, Select } from '#/ui/Field'
import { cx } from '#/ui/utils'
import { LAYERS, gradient, layerLabel, relativeGradient, scaleDescription, type ShownIndex } from './indices'

export type Opacity = '0.5' | '0.8' | '1'

export function LayerPicker({ value, onChange }: { value: ImageryLayer; onChange: (v: ImageryLayer) => void }) {
  const { t } = useTranslation()
  return <SegmentedControl aria-label={t('monitoring.layerPicker')} value={value} onChange={onChange} items={LAYERS.map((id) => ({ id, label: layerLabel(id) }))} />
}

export function StretchPicker({ value, onChange, isDisabled }: { value: ImageryStretch; onChange: (v: ImageryStretch) => void; isDisabled?: boolean }) {
  const { t } = useTranslation()
  return (
    <SegmentedControl
      aria-label={t('monitoring.stretch.label')}
      value={value}
      onChange={onChange}
      isDisabled={isDisabled}
      items={[
        { id: 'absolute', label: t('monitoring.stretch.absolute') },
        { id: 'relative', label: t('monitoring.stretch.relative') },
      ]}
    />
  )
}

export function dateLabel(d: ImageryDate, single: boolean) {
  const date = fmt.date(d.date)
  const clear = fmt.pct(d.clearPct)
  if (single) {
    const ndvi = d.ndvi != null ? ` · NDVI ${fmt.fixed(d.ndvi, 2)}` : ''
    return d.valid ? t('monitoring.date.single', { date, clear, ndvi }) : t('monitoring.date.singlePartlyCloudy', { date, clear, ndvi })
  }
  return t('monitoring.date.fields', { date, clear, count: d.fieldCount })
}

/** Acquisition date with previous/next stepping; `single` labels dates for one field. */
export function AcquisitionPicker({
  dates,
  date,
  onDate,
  single = false,
  className,
}: {
  dates: ImageryDate[]
  date: ImageryDate | null
  onDate: (d: string) => void
  single?: boolean
  className?: string
}) {
  const { t } = useTranslation()
  const i = date ? dates.findIndex((d) => d.date === date.date) : -1
  // Dates are newest first: "earlier" moves down the list.
  const earlier = i >= 0 && i < dates.length - 1 ? dates[i + 1] : null
  const later = i > 0 ? dates[i - 1] : null
  return (
    <div className={cx('flex items-center gap-1', className)}>
      <Button size="icon" variant="ghost" aria-label={t('monitoring.acquisition.earlier')} isDisabled={!earlier} onPress={() => earlier && onDate(earlier.date)}>
        <ChevronLeft />
      </Button>
      <Select
        aria-label={t('monitoring.acquisition.date')}
        className="w-80 max-w-full"
        items={dates.map((d) => ({ id: d.date, name: dateLabel(d, single) }))}
        value={date?.date ?? null}
        onChange={(v) => v && onDate(String(v))}
      >
        {(item) => <Option id={item.id}>{item.name}</Option>}
      </Select>
      <Button size="icon" variant="ghost" aria-label={t('monitoring.acquisition.later')} isDisabled={!later} onPress={() => later && onDate(later.date)}>
        <ChevronRight />
      </Button>
    </div>
  )
}

export function OpacityPicker({ value, onChange }: { value: Opacity; onChange: (v: Opacity) => void }) {
  const { t } = useTranslation()
  return (
    <SegmentedControl
      aria-label={t('monitoring.opacity')}
      value={value}
      onChange={onChange}
      items={[
        { id: '0.5', label: '50 %' },
        { id: '0.8', label: '80 %' },
        { id: '1', label: '100 %' },
      ]}
    />
  )
}

/** Progress of the imagery history backfill; nothing once it is complete. */
export function ImageryProgress({ status, className }: { status: ImageryStatus | null; className?: string }) {
  const { t } = useTranslation()
  if (!status || (status.state !== 'running' && status.state !== 'queued')) return null
  const pct = status.scenesTotal ? Math.round((100 * status.scenesDone) / status.scenesTotal) : 0
  return (
    <div className={cx('rounded-lg border border-line bg-surface px-3 py-2 text-sm flex items-center gap-3', className)} role="status">
      <Satellite className="size-4 text-muted shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="text-fg">
          {status.scenesTotal
            ? t('monitoring.progress.loading', { year: status.historyFrom?.slice(0, 4), done: fmt.num(status.scenesDone), total: fmt.num(status.scenesTotal) })
            : t('monitoring.progress.searching', { year: status.historyFrom?.slice(0, 4) })}
        </div>
        <div className="mt-1.5 h-1.5 rounded-full bg-surface-2 overflow-hidden" aria-hidden>
          <div className="h-full bg-primary transition-[width]" style={{ width: `${pct}%` }} />
        </div>
      </div>
      {status.scenesTotal > 0 && <span className="tabular text-muted">{pct} %</span>}
    </div>
  )
}

/** Map legend for absolute imagery, within-field contrast or true colour. */
export function IndexLegend({ index, stretch = 'absolute' }: { index: ShownIndex | 'rgb'; stretch?: ImageryStretch }) {
  const { t } = useTranslation()
  const box = 'absolute bottom-8 left-3 z-10 rounded-lg border border-line bg-surface/95 px-3 py-2 shadow-[var(--shadow-overlay)] text-xs w-56'
  if (index === 'rgb') {
    return (
      <div className={box}>
        <div className="font-medium text-fg">{t('monitoring.layer.rgb')}</div>
        <div className="text-fg-2 mt-1">{t('monitoring.legend.rgb')}</div>
      </div>
    )
  }
  const scale = INDEX_SCALES[index]
  if (stretch === 'relative') {
    return (
      <div className={box}>
        <div className="font-medium text-fg mb-1.5">
          {t('monitoring.legend.relativeTitle', { index: scale.label })}<span className="font-normal text-muted"> · {t('monitoring.legend.relativeNote')}</span>
        </div>
        <div className="h-2.5 rounded-full" style={{ background: relativeGradient }} aria-hidden />
        <div className="flex justify-between text-muted mt-1">
          <span>{t('monitoring.legend.lower')}</span>
          <span>{t('monitoring.legend.median')}</span>
          <span>{t('monitoring.legend.higher')}</span>
        </div>
        <div className="text-fg-2 mt-1.5">{t('monitoring.legend.relativeHint')}</div>
      </div>
    )
  }
  return (
    <div className={box}>
      <div className="font-medium text-fg mb-1.5">
        {t('monitoring.legend.imageryTitle', { index: scale.label })}
        <span className="font-normal text-muted"> · {scaleDescription(index)}</span>
      </div>
      <div className="h-2.5 rounded-full" style={{ background: gradient(index) }} aria-hidden />
      <div className="flex justify-between text-muted tabular mt-1">
        <span>≤ {fmt.fixed(scale.min, 1)}</span>
        <span>{fmt.fixed((scale.min + scale.max) / 2, 2)}</span>
        <span>≥ {fmt.fixed(scale.max, 1)}</span>
      </div>
      <div className="mt-1.5 text-fg-2">{t('monitoring.legend.transparent')}</div>
      <div className="text-muted mt-1">{t('monitoring.legend.disclaimer')}</div>
    </div>
  )
}

