import { type ReactNode, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cx } from '#/ui/utils'

/*
 * Daily min–max range chart, following the conventions of components/charts.tsx: one y-axis,
 * recessive grid, thin marks with rounded data ends, hover tooltip on every mark, text in
 * text colours. An optional divider separates observed days from forecast days.
 */

export interface RangeDatum {
  key: string
  label: string
  min: number | null
  max: number | null
  tooltip?: ReactNode
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    if (!ref.current) return
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width))
    ro.observe(ref.current)
    return () => ro.disconnect()
  }, [])
  return [ref, width] as const
}

function niceTicks(min: number, max: number, count = 4): number[] {
  if (min === max) max = min + 1
  const step0 = (max - min) / count
  const mag = 10 ** Math.floor(Math.log10(step0))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0) ?? step0
  const start = Math.floor(min / step) * step
  const ticks = []
  for (let v = start; v <= max + step * 0.5; v += step) ticks.push(Math.round(v * 1e6) / 1e6)
  return ticks
}

export function TemperatureRangeChart({
  data,
  format,
  color = 'var(--color-primary)',
  height = 220,
  ariaLabel,
  divideAt,
  dividerLabels,
  className,
}: {
  data: RangeDatum[]
  format: (v: number) => string
  color?: string
  height?: number
  ariaLabel: string
  /** Index of the first datum after the divider (e.g. the first forecast day). */
  divideAt?: number
  dividerLabels?: [string, string]
  className?: string
}) {
  const { t } = useTranslation()
  const [divLeft, divRight] = dividerLabels ?? [t('weather.observed'), t('weather.forecast')]
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const pad = { top: 22, right: 8, bottom: 28, left: 44 }
  const values = data.flatMap((d) => [d.min, d.max]).filter((v): v is number => v != null)
  const ticks = niceTicks(values.length ? Math.min(...values) : 0, values.length ? Math.max(...values) : 10)
  const lo = ticks[0]
  const hi = ticks[ticks.length - 1]
  const innerW = Math.max(0, width - pad.left - pad.right)
  const innerH = height - pad.top - pad.bottom
  const y = (v: number) => pad.top + innerH - ((v - lo) / (hi - lo || 1)) * innerH
  const band = data.length ? innerW / data.length : 0
  const barW = Math.max(3, Math.min(8, band * 0.4))
  const labelEvery = Math.ceil(data.length / Math.max(1, Math.floor(innerW / 56)))
  const divX = divideAt != null && divideAt > 0 && divideAt < data.length ? pad.left + band * divideAt : null

  const hd = hover != null ? data[hover] : null
  return (
    <div ref={ref} className={cx('relative', className)} style={{ height }}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={ariaLabel} onMouseLeave={() => setHover(null)}>
          {ticks.map((tick) => (
            <g key={tick}>
              <line x1={pad.left} x2={width - pad.right} y1={y(tick)} y2={y(tick)} stroke="var(--color-grid)" strokeWidth={tick === 0 ? 1.5 : 1} />
              <text x={pad.left - 8} y={y(tick)} dy="0.32em" textAnchor="end" className="fill-muted text-[11px] tabular">
                {format(tick)}
              </text>
            </g>
          ))}
          {divX != null && (
            <g>
              <line x1={divX} x2={divX} y1={pad.top - 14} y2={pad.top + innerH} stroke="var(--color-line-strong)" strokeDasharray="3 3" />
              <text x={divX - 6} y={pad.top - 8} textAnchor="end" className="fill-muted text-[11px]">
                {divLeft}
              </text>
              <text x={divX + 6} y={pad.top - 8} textAnchor="start" className="fill-muted text-[11px]">
                {divRight}
              </text>
            </g>
          )}
          {data.map((d, i) => {
            const cx0 = pad.left + band * i + band / 2
            const hasRange = d.min != null && d.max != null
            const top = hasRange ? y(Math.max(d.min!, d.max!)) : 0
            const bottom = hasRange ? y(Math.min(d.min!, d.max!)) : 0
            const h = Math.max(barW, bottom - top)
            return (
              <g key={d.key}>
                {hover === i && <rect x={pad.left + band * i} y={pad.top} width={band} height={innerH} fill="var(--color-surface-2)" opacity={0.7} />}
                {hasRange && <rect x={cx0 - barW / 2} y={top} width={barW} height={h} rx={barW / 2} fill={color} />}
                {i % labelEvery === 0 && (
                  <text x={cx0} y={height - 8} textAnchor="middle" className="fill-muted text-[11px]">
                    {d.label}
                  </text>
                )}
                <rect x={pad.left + band * i} y={pad.top} width={band} height={innerH} fill="transparent" onMouseEnter={() => setHover(i)} />
              </g>
            )
          })}
        </svg>
      )}
      {hd && hover != null && (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs shadow-[var(--shadow-overlay)] whitespace-nowrap"
          style={{ left: Math.min(Math.max(pad.left + band * hover + band / 2, 70), width - 70), top: (hd.max != null ? y(hd.max) : pad.top + innerH / 2) - 8 }}
        >
          <div className="font-medium text-fg mb-0.5">{hd.label}</div>
          {hd.tooltip ?? (
            <>
              <div className="flex justify-between gap-3 text-fg-2">
                {t('weather.max')} <span className="font-medium text-fg tabular">{hd.max == null ? '—' : format(hd.max)}</span>
              </div>
              <div className="flex justify-between gap-3 text-fg-2">
                {t('weather.min')} <span className="font-medium text-fg tabular">{hd.min == null ? '—' : format(hd.min)}</span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
