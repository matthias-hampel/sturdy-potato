import { INDEX_SCALES, type ImageryDate, type ImageryLayer, type ImageryStatus, type ImageryStretch } from '@agmeo/contracts'
import { ChevronLeft, ChevronRight, Satellite } from 'lucide-react'
import { Fragment, useMemo, useRef, useState } from 'react'
import { Slider, SliderOutput, SliderThumb, SliderTrack } from 'react-aria-components'
import { useTranslation } from 'react-i18next'
import { LOCALE, t } from '#/i18n'
import { fmt, today } from '#/lib/format'
import { Button, SegmentedControl } from '#/ui/Button'
import { cx, focusRing } from '#/ui/utils'
import { LAYERS, NO_DATA_COLOR, gradient, layerLabel, relativeGradient, scaleDescription, type ShownIndex } from './indices'

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

/** Position of an ISO date within its calendar year, 0–1. */
function yearPos(iso: string) {
  const y = Number(iso.slice(0, 4))
  const start = Date.UTC(y, 0, 1)
  return (Date.UTC(y, Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) - start) / (Date.UTC(y + 1, 0, 1) - start)
}

function closest(list: ImageryDate[], pos: number) {
  let best: ImageryDate | null = null
  let dist = Infinity
  for (const d of list) {
    const x = Math.abs(yearPos(d.date) - pos)
    if (x < dist) [best, dist] = [d, x]
  }
  return best
}

const MONTHS = Array.from({ length: 12 }, (_, m) => {
  const d = new Date(2001, m, 1)
  return { short: d.toLocaleDateString(LOCALE, { month: 'short' }), narrow: d.toLocaleDateString(LOCALE, { month: 'narrow' }) }
})

/**
 * Acquisition dates of one calendar year on a timeline: click or drag to pick the nearest date,
 * arrow keys step through dates, Page Up/Down switch years. `single` labels dates for one field.
 */
export function AcquisitionTimeline({
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
  const track = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<ImageryDate | null>(null)
  // Dates are newest first: "earlier" moves down the list.
  const i = date ? dates.findIndex((d) => d.date === date.date) : -1
  const earlier = i >= 0 && i < dates.length - 1 ? dates[i + 1] : null
  const later = i > 0 ? dates[i - 1] : null
  const year = (date ?? dates[0])?.date.slice(0, 4) ?? ''
  const years = useMemo(() => [...new Set(dates.map((d) => d.date.slice(0, 4)))], [dates])
  const yi = years.indexOf(year)
  const earlierYear = yi >= 0 ? years[yi + 1] : undefined
  const laterYear = yi > 0 ? years[yi - 1] : undefined
  const shown = useMemo(() => dates.filter((d) => d.date.startsWith(year)), [dates, year])
  const now = today()
  const future = now.startsWith(year) ? yearPos(now) : null

  const pick = (d: ImageryDate | null | undefined) => d && d.date !== date?.date && onDate(d.date)
  const at = (clientX: number) => {
    const r = track.current?.getBoundingClientRect()
    return r ? closest(shown, (clientX - r.left) / r.width) : null
  }
  // Switching years keeps the time of year, preferring cloud-free dates.
  const toYear = (y: string | undefined) => {
    if (!y) return
    const pool = dates.filter((d) => d.date.startsWith(y))
    const clear = pool.filter((d) => d.valid)
    pick(closest(clear.length ? clear : pool, date ? yearPos(date.date) : 1))
  }
  const onKeyDown = (e: React.KeyboardEvent) => {
    const keys: Record<string, () => void> = {
      ArrowLeft: () => pick(earlier),
      ArrowDown: () => pick(earlier),
      ArrowRight: () => pick(later),
      ArrowUp: () => pick(later),
      Home: () => pick(shown.at(-1)),
      End: () => pick(shown[0]),
      PageDown: () => toYear(earlierYear),
      PageUp: () => toYear(laterYear),
    }
    const action = keys[e.key]
    if (!action) return
    e.preventDefault()
    action()
  }
  const edge = (pos: number) => (pos < 0.08 ? 'translate-x-0' : pos > 0.92 ? '-translate-x-full' : '-translate-x-1/2')

  return (
    <div className={cx('@container rounded-lg border border-line bg-surface px-2 pt-1.5 pb-2', className)}>
      <div className="flex items-center gap-1">
        <Button size="icon-sm" variant="ghost" aria-label={t('monitoring.acquisition.earlier')} isDisabled={!earlier} onPress={() => pick(earlier)}>
          <ChevronLeft />
        </Button>
        <Button size="icon-sm" variant="ghost" aria-label={t('monitoring.acquisition.later')} isDisabled={!later} onPress={() => pick(later)}>
          <ChevronRight />
        </Button>
        <span className="min-w-0 flex-1 truncate px-1 text-sm font-medium text-fg">{date ? dateLabel(date, single) : null}</span>
        <Button size="icon-sm" variant="ghost" aria-label={t('monitoring.acquisition.earlierYear')} isDisabled={!earlierYear} onPress={() => toYear(earlierYear)}>
          <ChevronLeft />
        </Button>
        <span className="tabular text-sm font-medium text-fg-2">{year}</span>
        <Button size="icon-sm" variant="ghost" aria-label={t('monitoring.acquisition.laterYear')} isDisabled={!laterYear} onPress={() => toYear(laterYear)}>
          <ChevronRight />
        </Button>
      </div>
      <div
        ref={track}
        role="slider"
        tabIndex={0}
        aria-label={t('monitoring.acquisition.date')}
        aria-valuemin={0}
        aria-valuemax={dates.length - 1}
        aria-valuenow={i >= 0 ? dates.length - 1 - i : undefined}
        aria-valuetext={date ? dateLabel(date, single) : undefined}
        onKeyDown={onKeyDown}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          pick(at(e.clientX))
        }}
        onPointerMove={(e) => {
          const d = at(e.clientX)
          setHover(d)
          if (e.currentTarget.hasPointerCapture(e.pointerId)) pick(d)
        }}
        onPointerLeave={() => setHover(null)}
        className={cx('relative mx-2 mt-1 h-11 cursor-pointer touch-pan-y select-none rounded-sm', focusRing)}
      >
        {future != null && <div className="absolute inset-y-0 right-0 top-1 h-7 rounded-r-sm bg-surface-2" style={{ left: `${future * 100}%` }} aria-hidden />}
        {MONTHS.map((m, k) => {
          const start = yearPos(`${year}-${String(k + 1).padStart(2, '0')}-01`)
          const end = k === 11 ? 1 : yearPos(`${year}-${String(k + 2).padStart(2, '0')}-01`)
          return (
            <Fragment key={k}>
              {k > 0 && <div className="absolute top-1 h-7 w-px bg-grid" style={{ left: `${start * 100}%` }} aria-hidden />}
              <span className="absolute bottom-0 -translate-x-1/2 text-[11px] leading-none text-muted" style={{ left: `${((start + end) / 2) * 100}%` }} aria-hidden>
                <span className="hidden @md:inline">{m.short}</span>
                <span className="@md:hidden">{m.narrow}</span>
              </span>
            </Fragment>
          )
        })}
        <div className="absolute inset-x-0 top-[1.125rem] h-px bg-line-strong" aria-hidden />
        {shown.map((d) => (
          <div
            key={d.date}
            className={cx('absolute w-0.5 -translate-x-1/2 rounded-full', d.valid ? 'top-2 h-5 bg-fg-2/70' : 'top-3.5 h-2 bg-muted/50', hover === d && 'bg-fg')}
            style={{ left: `${yearPos(d.date) * 100}%` }}
            aria-hidden
          />
        ))}
        {date && date.date.startsWith(year) && (
          <div
            className="absolute top-[1.125rem] size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface bg-primary shadow-sm"
            style={{ left: `${yearPos(date.date) * 100}%` }}
            aria-hidden
          />
        )}
        {hover && hover !== date && (
          <div
            className={cx('pointer-events-none absolute bottom-full mb-1 whitespace-nowrap rounded-md bg-fg px-2 py-1 text-xs text-surface shadow-sm', edge(yearPos(hover.date)))}
            style={{ left: `${yearPos(hover.date) * 100}%` }}
            aria-hidden
          >
            {fmt.date(hover.date)} · {fmt.pct(hover.clearPct)}
          </div>
        )}
      </div>
    </div>
  )
}

export function OpacityPicker({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const { t } = useTranslation()
  return (
    <Slider
      aria-label={t('monitoring.opacity')}
      value={value}
      onChange={onChange}
      minValue={0.1}
      maxValue={1}
      step={0.05}
      formatOptions={{ style: 'percent' }}
      className="inline-flex h-9 items-center gap-3 rounded-[var(--radius-control)] border border-line bg-surface-2 pl-3.5 pr-3"
    >
      <SliderTrack className="relative h-5 w-28 cursor-pointer">
        {({ state }) => (
          <>
            <div className="absolute inset-x-0 top-1/2 -mt-0.5 h-1 rounded-full bg-line" />
            <div className="absolute left-0 top-1/2 -mt-0.5 h-1 rounded-full bg-primary" style={{ width: `${state.getThumbPercent(0) * 100}%` }} />
            <SliderThumb
              className={cx(
                'top-1/2 size-4 rounded-full border border-line bg-surface shadow-sm transition-transform dragging:scale-110',
                focusRing,
              )}
            />
          </>
        )}
      </SliderTrack>
      <SliderOutput className="w-10 text-right text-sm font-medium tabular text-fg-2" />
    </Slider>
  )
}

/** Progress of the imagery history backfill; nothing once it is complete. */
export function ImageryProgress({ status, className }: { status: ImageryStatus | null; className?: string }) {
  const { t } = useTranslation()
  if (!status || (status.state !== 'running' && status.state !== 'queued')) return null
  // The job can stay `running` for a while after the last scene while it wraps up.
  if (status.scenesTotal > 0 && status.scenesDone >= status.scenesTotal) return null
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
export function IndexLegend({ index, stretch = 'absolute', uncovered = false }: { index: ShownIndex | 'rgb'; stretch?: ImageryStretch; uncovered?: boolean }) {
  const { t } = useTranslation()
  // Fields imaged on another pass than the shown date are greyed out by the map.
  const notImaged = uncovered && (
    <div className="mt-1.5 flex items-center gap-1.5 text-fg-2">
      <span className="size-2.5 shrink-0 rounded-sm" style={{ background: NO_DATA_COLOR }} aria-hidden />
      {t('monitoring.legend.notImaged')}
    </div>
  )
  const box = 'absolute bottom-8 left-3 z-10 rounded-lg border border-line bg-surface/95 px-3 py-2 shadow-[var(--shadow-overlay)] text-xs w-56'
  if (index === 'rgb') {
    return (
      <div className={box}>
        <div className="font-medium text-fg">{t('monitoring.layer.rgb')}</div>
        <div className="text-fg-2 mt-1">{t('monitoring.legend.rgb')}</div>
        {notImaged}
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
        {notImaged}
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
      {notImaged}
      <div className="text-muted mt-1">{t('monitoring.legend.disclaimer')}</div>
    </div>
  )
}

