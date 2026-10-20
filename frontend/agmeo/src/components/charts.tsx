import { type ReactNode, useLayoutEffect, useRef, useState } from 'react'
import { cx } from '#/ui/utils'
import { LOCALE } from '#/i18n'
import { fmt } from '#/lib/format'

/*
 * Small SVG chart kit. Conventions: one y-axis per chart, recessive grid, thin marks with
 * 4px rounded data ends on the baseline, 2px lines, >= 8px markers, hover tooltips on
 * every mark, a legend whenever there are two or more series, text in text colours.
 */

export function useWidth<T extends HTMLElement>() {
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

function truncate(text: string, max: number) {
  return text.length <= max ? text : `${text.slice(0, Math.max(1, max - 1))}…`
}

function niceTicks(min: number, max: number, count = 4): number[] {
  if (min === max) max = min + 1
  const span = max - min
  const step0 = span / count
  const mag = 10 ** Math.floor(Math.log10(step0))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0) ?? step0
  const start = Math.floor(min / step) * step
  // The last tick must reach max, or the tallest mark overshoots the plot area.
  const end = Math.ceil(max / step - 1e-9) * step
  const ticks = []
  for (let v = start; v <= end + step * 1e-6; v += step) ticks.push(Math.round(v * 1e6) / 1e6)
  return ticks
}

export interface Series {
  name: string
  color: string
}

export function Legend({ series }: { series: Series[] }) {
  if (series.length < 2) return null
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-2">
      {series.map((s) => (
        <span key={s.name} className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm" style={{ background: s.color }} aria-hidden />
          {s.name}
        </span>
      ))}
    </div>
  )
}

function Tooltip({ x, y, width, children }: { x: number; y: number; width: number; children: ReactNode }) {
  const left = Math.min(Math.max(x, 70), width - 70)
  return (
    <div
      className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs shadow-[var(--shadow-overlay)] whitespace-nowrap"
      style={{ left, top: y - 8 }}
    >
      {children}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Column chart (single or grouped series)
// ---------------------------------------------------------------------------

export interface ColumnDatum {
  key: string
  label: string
  values: (number | null)[]
  tooltip?: ReactNode
}

export function ColumnChart({
  data,
  series,
  format,
  height = 220,
  className,
  ariaLabel,
}: {
  data: ColumnDatum[]
  series: Series[]
  format: (v: number) => string
  height?: number
  className?: string
  ariaLabel: string
}) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const pad = { top: 12, right: 8, bottom: 28, left: 56 }
  const all = data.flatMap((d) => d.values.filter((v): v is number => v != null))
  const ticks = niceTicks(Math.min(0, ...all), Math.max(0, ...all))
  const lo = ticks[0]
  const hi = ticks[ticks.length - 1]
  const innerW = Math.max(0, width - pad.left - pad.right)
  const innerH = height - pad.top - pad.bottom
  const y = (v: number) => pad.top + innerH - ((v - lo) / (hi - lo || 1)) * innerH
  const band = data.length ? innerW / data.length : 0
  const groupW = Math.min(band * 0.7, 28 * series.length + 2 * (series.length - 1))
  const barW = Math.max(2, (groupW - 2 * (series.length - 1)) / series.length)
  const labelEvery = Math.ceil(data.length / Math.max(1, Math.floor(innerW / 64)))

  return (
    <div className={cx('space-y-2', className)}>
      <Legend series={series} />
      <div ref={ref} className="relative" style={{ height }}>
        {width > 0 && (
          <svg width={width} height={height} role="img" aria-label={ariaLabel} onMouseLeave={() => setHover(null)}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={pad.left} x2={width - pad.right} y1={y(t)} y2={y(t)} stroke="var(--color-grid)" strokeWidth={t === 0 ? 1.5 : 1} />
                <text x={pad.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-muted text-[11px] tabular">
                  {format(t)}
                </text>
              </g>
            ))}
            {data.map((d, i) => {
              const gx = pad.left + band * i + (band - groupW) / 2
              return (
                <g key={d.key}>
                  {hover === i && <rect x={pad.left + band * i} y={pad.top} width={band} height={innerH} fill="var(--color-surface-2)" opacity={0.7} />}
                  {d.values.map((v, s) => {
                    if (v == null) return null
                    const top = y(Math.max(v, 0))
                    const h = Math.max(1, Math.abs(y(v) - y(0)))
                    const x = gx + s * (barW + 2)
                    const r = Math.min(4, barW / 2, h)
                    // Rounded data end, square on the baseline.
                    const path =
                      v >= 0
                        ? `M${x},${top + h} V${top + r} Q${x},${top} ${x + r},${top} H${x + barW - r} Q${x + barW},${top} ${x + barW},${top + r} V${top + h} Z`
                        : `M${x},${top} V${top + h - r} Q${x},${top + h} ${x + r},${top + h} H${x + barW - r} Q${x + barW},${top + h} ${x + barW},${top + h - r} V${top} Z`
                    return <path key={s} d={path} fill={series[s].color} />
                  })}
                  {i % labelEvery === 0 && (
                    <text x={pad.left + band * i + band / 2} y={height - 8} textAnchor="middle" className="fill-muted text-[11px]">
                      {truncate(d.label, Math.floor((band * labelEvery) / 6.5))}
                    </text>
                  )}
                  <rect x={pad.left + band * i} y={pad.top} width={band} height={innerH} fill="transparent" onMouseEnter={() => setHover(i)} />
                </g>
              )
            })}
          </svg>
        )}
        {hover != null && data[hover] && (
          <Tooltip x={pad.left + band * hover + band / 2} y={y(Math.max(0, ...data[hover].values.map((v) => v ?? 0)))} width={width}>
            <div className="font-medium text-fg mb-0.5">{data[hover].label}</div>
            {data[hover].tooltip ??
              series.map((s, i) => (
                <div key={s.name} className="flex items-center gap-1.5 text-fg-2">
                  <span className="size-2 rounded-sm" style={{ background: s.color }} aria-hidden />
                  {series.length > 1 && <span>{s.name}</span>}
                  <span className="ml-auto pl-3 font-medium text-fg tabular">{data[hover].values[i] == null ? '—' : format(data[hover].values[i]!)}</span>
                </div>
              ))}
          </Tooltip>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Time-series line chart (single series, irregular dates)
// ---------------------------------------------------------------------------

export interface LinePoint {
  date: string
  value: number | null
  /** Points that exist but are not reliable (e.g. cloud-covered) are drawn hollow. */
  muted?: boolean
  tooltip?: ReactNode
}

export function LineChart({
  points,
  color = 'var(--color-series-1)',
  format,
  domain,
  height = 220,
  ariaLabel,
  markers = [],
  selectedDate,
  onSelect,
}: {
  points: LinePoint[]
  color?: string
  format: (v: number) => string
  domain?: [number, number]
  height?: number
  ariaLabel: string
  /** Vertical event markers, e.g. field operations. */
  markers?: { date: string; label: string }[]
  /** Highlights a date (e.g. the one shown on a map); clicking a point selects its date. */
  selectedDate?: string | null
  onSelect?: (date: string) => void
}) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const pad = { top: 14, right: 12, bottom: 28, left: 44 }
  const valid = points.filter((p) => p.value != null)
  const ts = points.map((p) => Date.parse(p.date))
  const t0 = Math.min(...ts)
  const t1 = Math.max(...ts, t0 + 86_400_000)
  const values = valid.map((p) => p.value!)
  const ticks = niceTicks(domain?.[0] ?? Math.min(...values), domain?.[1] ?? Math.max(...values))
  const lo = ticks[0]
  const hi = ticks[ticks.length - 1]
  const innerW = Math.max(0, width - pad.left - pad.right)
  const innerH = height - pad.top - pad.bottom
  const x = (t: number) => pad.left + ((t - t0) / (t1 - t0)) * innerW
  const y = (v: number) => pad.top + innerH - ((v - lo) / (hi - lo || 1)) * innerH
  const reliable = points.map((p, i) => ({ p, i })).filter(({ p }) => p.value != null && !p.muted)
  const path = reliable.map(({ p }, k) => `${k ? 'L' : 'M'}${x(Date.parse(p.date))},${y(p.value!)}`).join(' ')

  const monthTicks: number[] = []
  if (points.length) {
    const d = new Date(t0)
    d.setDate(1)
    d.setMonth(d.getMonth() + 1)
    while (d.getTime() <= t1) {
      monthTicks.push(d.getTime())
      d.setMonth(d.getMonth() + 1)
    }
  }
  const monthEvery = Math.ceil(monthTicks.length / Math.max(1, Math.floor(innerW / 56)))

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const mx = e.clientX - rect.left
    let best = -1
    let bestDist = Infinity
    points.forEach((p, i) => {
      if (p.value == null) return
      const dist = Math.abs(x(Date.parse(p.date)) - mx)
      if (dist < bestDist) {
        best = i
        bestDist = dist
      }
    })
    setHover(best >= 0 ? best : null)
  }

  const hp = hover != null ? points[hover] : null
  return (
    <div ref={ref} className="relative" style={{ height }}>
      {width > 0 && points.length > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={ariaLabel}
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
          onClick={() => onSelect && hover != null && onSelect(points[hover].date)}
          className={onSelect ? 'cursor-pointer' : undefined}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.left} x2={width - pad.right} y1={y(t)} y2={y(t)} stroke="var(--color-grid)" />
              <text x={pad.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-muted text-[11px] tabular">
                {format(t)}
              </text>
            </g>
          ))}
          {monthTicks.map((t, i) =>
            i % monthEvery === 0 ? (
              <text key={t} x={x(t)} y={height - 8} textAnchor="middle" className="fill-muted text-[11px]">
                {new Date(t).toLocaleDateString(LOCALE, { month: 'short', ...(new Date(t).getMonth() === 0 ? { year: '2-digit' } : {}) })}
              </text>
            ) : null,
          )}
          {markers.map((m) => (
            <g key={m.date + m.label}>
              <line x1={x(Date.parse(m.date))} x2={x(Date.parse(m.date))} y1={pad.top} y2={pad.top + innerH} stroke="var(--color-line-strong)" strokeDasharray="3 3" />
            </g>
          ))}
          {selectedDate && Date.parse(selectedDate) >= t0 && Date.parse(selectedDate) <= t1 && (
            <line x1={x(Date.parse(selectedDate))} x2={x(Date.parse(selectedDate))} y1={pad.top} y2={pad.top + innerH} stroke="var(--color-fg-2)" strokeWidth={1.5} />
          )}
          {hp && <line x1={x(Date.parse(hp.date))} x2={x(Date.parse(hp.date))} y1={pad.top} y2={pad.top + innerH} stroke="var(--color-muted)" strokeWidth={1} />}
          <path d={path} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {points.map((p, i) =>
            p.value == null ? null : (
              <circle
                key={i}
                cx={x(Date.parse(p.date))}
                cy={y(p.value)}
                r={hover === i ? 5.5 : 4}
                fill={p.muted ? 'var(--color-surface)' : color}
                stroke={p.muted ? 'var(--color-muted)' : 'var(--color-surface)'}
                strokeWidth={2}
              />
            ),
          )}
        </svg>
      )}
      {hp && hp.value != null && (
        <Tooltip x={x(Date.parse(hp.date))} y={y(hp.value)} width={width}>
          {hp.tooltip ?? (
            <>
              <div className="text-muted">{fmt.date(hp.date)}</div>
              <div className="font-medium text-fg tabular">{format(hp.value)}</div>
            </>
          )}
        </Tooltip>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// XY line chart: several series over a numeric x axis (e.g. N over BBCH).
// ---------------------------------------------------------------------------

export interface XYSeries extends Series {
  points: { x: number; y: number }[]
  dashed?: boolean
}

export function XYChart({
  series,
  formatX,
  formatY,
  xLabel,
  height = 240,
  ariaLabel,
}: {
  series: XYSeries[]
  formatX: (v: number) => string
  formatY: (v: number) => string
  xLabel?: string
  height?: number
  ariaLabel: string
}) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hoverX, setHoverX] = useState<number | null>(null)
  const pad = { top: 12, right: 12, bottom: xLabel ? 40 : 28, left: 52 }
  const xs = series.flatMap((s) => s.points.map((p) => p.x))
  const ys = series.flatMap((s) => s.points.map((p) => p.y))
  const xTicks = niceTicks(Math.min(...xs), Math.max(...xs), 5)
  const yTicks = niceTicks(Math.min(0, ...ys), Math.max(...ys))
  const [x0, x1] = [xTicks[0], xTicks[xTicks.length - 1]]
  const [y0, y1] = [yTicks[0], yTicks[yTicks.length - 1]]
  const innerW = Math.max(0, width - pad.left - pad.right)
  const innerH = height - pad.top - pad.bottom
  const x = (v: number) => pad.left + ((v - x0) / (x1 - x0 || 1)) * innerW
  const y = (v: number) => pad.top + innerH - ((v - y0) / (y1 - y0 || 1)) * innerH
  const nearest = (s: XYSeries, v: number) => s.points.reduce<{ x: number; y: number } | null>((b, p) => (b == null || Math.abs(p.x - v) < Math.abs(b.x - v) ? p : b), null)

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const mx = e.clientX - e.currentTarget.getBoundingClientRect().left
    setHoverX(x0 + ((mx - pad.left) / (innerW || 1)) * (x1 - x0))
  }
  const hovered = hoverX == null ? [] : series.map((s) => ({ s, p: nearest(s, hoverX) })).filter((h) => h.p)
  return (
    <div className="space-y-2">
      <Legend series={series} />
      <div ref={ref} className="relative" style={{ height }}>
        {width > 0 && xs.length > 0 && (
          <svg width={width} height={height} role="img" aria-label={ariaLabel} onMouseMove={onMove} onMouseLeave={() => setHoverX(null)}>
            {yTicks.map((t) => (
              <g key={t}>
                <line x1={pad.left} x2={width - pad.right} y1={y(t)} y2={y(t)} stroke="var(--color-grid)" />
                <text x={pad.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-muted text-[11px] tabular">
                  {formatY(t)}
                </text>
              </g>
            ))}
            {xTicks.map((t) => (
              <text key={t} x={x(t)} y={pad.top + innerH + 16} textAnchor="middle" className="fill-muted text-[11px] tabular">
                {formatX(t)}
              </text>
            ))}
            {xLabel && (
              <text x={pad.left + innerW / 2} y={height - 4} textAnchor="middle" className="fill-muted text-[11px]">
                {xLabel}
              </text>
            )}
            {hovered[0] && <line x1={x(hovered[0].p!.x)} x2={x(hovered[0].p!.x)} y1={pad.top} y2={pad.top + innerH} stroke="var(--color-muted)" />}
            {series.map((s) => (
              <path
                key={s.name}
                d={s.points.map((p, i) => `${i ? 'L' : 'M'}${x(p.x)},${y(p.y)}`).join(' ')}
                fill="none"
                stroke={s.color}
                strokeWidth={2}
                strokeDasharray={s.dashed ? '5 4' : undefined}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ))}
            {hovered.map(({ s, p }) => (
              <circle key={s.name} cx={x(p!.x)} cy={y(p!.y)} r={4} fill={s.color} stroke="var(--color-surface)" strokeWidth={2} />
            ))}
          </svg>
        )}
        {hovered[0] && (
          <Tooltip x={x(hovered[0].p!.x)} y={y(Math.max(...hovered.map((h) => h.p!.y)))} width={width}>
            <div className="text-muted">{formatX(hovered[0].p!.x)}</div>
            {hovered.map(({ s, p }) => (
              <div key={s.name} className="tabular">
                <span style={{ color: s.color }}>●</span> {s.name}: <span className="font-medium text-fg">{formatY(p!.y)}</span>
              </div>
            ))}
          </Tooltip>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Horizontal bar list: label, bar, value. Identity is carried by the label.
// ---------------------------------------------------------------------------

export function BarList({
  items,
  format,
  color = 'var(--color-primary)',
}: {
  items: { key: string; label: ReactNode; value: number; swatch?: string; hint?: ReactNode }[]
  format: (v: number) => string
  color?: string
}) {
  const max = Math.max(0, ...items.map((i) => Math.abs(i.value)))
  return (
    <ul className="space-y-2.5">
      {items.map((item) => (
        <li key={item.key} className="grid grid-cols-[minmax(6rem,10rem)_1fr_auto] items-center gap-3 text-sm" title={`${typeof item.label === 'string' ? item.label : ''} ${format(item.value)}`}>
          <span className="flex items-center gap-2 min-w-0 text-fg-2">
            {item.swatch && <span className="size-2.5 rounded-sm shrink-0" style={{ background: item.swatch }} aria-hidden />}
            <span className="truncate">{item.label}</span>
          </span>
          <span className="h-2.5 rounded-full bg-surface-2 overflow-hidden">
            <span
              className="block h-full rounded-full"
              style={{ width: `${max ? (Math.abs(item.value) / max) * 100 : 0}%`, background: item.value < 0 ? 'var(--color-danger)' : color }}
            />
          </span>
          <span className="tabular text-fg font-medium text-right whitespace-nowrap">
            {format(item.value)}
            {item.hint && <span className="text-muted font-normal ml-1.5">{item.hint}</span>}
          </span>
        </li>
      ))}
    </ul>
  )
}

// ---------------------------------------------------------------------------
// Stacked column chart: positive parts stack upwards, negative ones (credits) downwards
// ---------------------------------------------------------------------------

export interface StackedDatum {
  key: string
  label: string
  /** One value per series; null or 0 draws nothing. */
  values: (number | null)[]
  /** A reference value drawn as a short horizontal mark over the column (e.g. a regional benchmark). */
  reference?: number | null
  /** Small text above the column (e.g. the area). */
  annotation?: string
}

export function StackedColumnChart({
  data,
  series,
  format,
  height = 260,
  ariaLabel,
  referenceLabel,
  className,
}: {
  data: StackedDatum[]
  series: Series[]
  format: (v: number) => string
  height?: number
  ariaLabel: string
  referenceLabel?: string
  className?: string
}) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const pad = { top: 16, right: 8, bottom: 28, left: 64 }
  const sums = data.map((d) => {
    let pos = 0
    let neg = 0
    for (const v of d.values) if (v) v > 0 ? (pos += v) : (neg += v)
    return { pos, neg }
  })
  const ticks = niceTicks(Math.min(0, ...sums.map((s) => s.neg)), Math.max(0, ...sums.map((s) => s.pos), ...data.map((d) => d.reference ?? 0)))
  const lo = ticks[0]
  const hi = ticks[ticks.length - 1]
  const innerW = Math.max(0, width - pad.left - pad.right)
  const innerH = height - pad.top - pad.bottom
  const y = (v: number) => pad.top + innerH - ((v - lo) / (hi - lo || 1)) * innerH
  const band = data.length ? innerW / data.length : 0
  const barW = Math.max(3, Math.min(band * 0.6, 40))
  const labelEvery = Math.ceil(data.length / Math.max(1, Math.floor(innerW / 72)))
  const legend = referenceLabel && data.some((d) => d.reference != null) ? [...series, { name: referenceLabel, color: 'var(--color-fg-2)' }] : series

  return (
    <div className={cx('space-y-2', className)}>
      <Legend series={legend} />
      <div ref={ref} className="relative" style={{ height }}>
        {width > 0 && (
          <svg width={width} height={height} role="img" aria-label={ariaLabel} onMouseLeave={() => setHover(null)}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={pad.left} x2={width - pad.right} y1={y(t)} y2={y(t)} stroke="var(--color-grid)" strokeWidth={t === 0 ? 1.5 : 1} />
                <text x={pad.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-muted text-[11px] tabular">
                  {format(t)}
                </text>
              </g>
            ))}
            {data.map((d, i) => {
              const x = pad.left + band * i + (band - barW) / 2
              let pos = 0
              let neg = 0
              return (
                <g key={d.key}>
                  {hover === i && <rect x={pad.left + band * i} y={pad.top} width={band} height={innerH} fill="var(--color-surface-2)" opacity={0.7} />}
                  {d.values.map((v, s) => {
                    if (!v) return null
                    const from = v > 0 ? pos : neg
                    const to = from + v
                    if (v > 0) pos = to
                    else neg = to
                    const top = y(Math.max(from, to))
                    const h = Math.max(1, Math.abs(y(from) - y(to)))
                    return <rect key={s} x={x} y={top} width={barW} height={h} fill={series[s].color} stroke="var(--color-surface)" strokeWidth={0.5} />
                  })}
                  {d.reference != null && <line x1={x - 4} x2={x + barW + 4} y1={y(d.reference)} y2={y(d.reference)} stroke="var(--color-fg-2)" strokeWidth={2.5} />}
                  {d.annotation && (
                    <text x={x + barW / 2} y={y(sums[i].pos) - 4} textAnchor="middle" className="fill-muted text-[10px] tabular">
                      {d.annotation}
                    </text>
                  )}
                  {i % labelEvery === 0 && (
                    <text x={pad.left + band * i + band / 2} y={height - 8} textAnchor="middle" className="fill-muted text-[11px]">
                      {truncate(d.label, Math.floor((band * labelEvery) / 6.5))}
                    </text>
                  )}
                  <rect x={pad.left + band * i} y={pad.top} width={band} height={innerH} fill="transparent" onMouseEnter={() => setHover(i)} />
                </g>
              )
            })}
          </svg>
        )}
        {hover != null && data[hover] && (
          <Tooltip x={pad.left + band * hover + band / 2} y={y(sums[hover].pos)} width={width}>
            <div className="font-medium text-fg mb-0.5">{data[hover].label}</div>
            {series.map((s, i) =>
              data[hover].values[i] ? (
                <div key={s.name} className="flex items-center gap-1.5 text-fg-2">
                  <span className="size-2 rounded-sm" style={{ background: s.color }} aria-hidden />
                  <span>{s.name}</span>
                  <span className="ml-auto pl-3 font-medium text-fg tabular">{format(data[hover].values[i]!)}</span>
                </div>
              ) : null,
            )}
            <div className="flex gap-1.5 border-t border-line mt-1 pt-1 text-fg-2">
              <span>Σ</span>
              <span className="ml-auto pl-3 font-medium text-fg tabular">{format(sums[hover].pos + sums[hover].neg)}</span>
            </div>
            {data[hover].reference != null && referenceLabel && (
              <div className="flex gap-1.5 text-fg-2">
                <span>{referenceLabel}</span>
                <span className="ml-auto pl-3 font-medium text-fg tabular">{format(data[hover].reference!)}</span>
              </div>
            )}
          </Tooltip>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Donut: shares of a whole (non-negative values only)
// ---------------------------------------------------------------------------

export function DonutChart({
  items,
  format,
  size = 180,
  centerLabel,
  ariaLabel,
}: {
  items: { key: string; label: string; value: number; color: string }[]
  format: (v: number) => string
  size?: number
  centerLabel?: string
  ariaLabel: string
}) {
  const [hover, setHover] = useState<number | null>(null)
  const parts = items.filter((i) => i.value > 0)
  const total = parts.reduce((s, i) => s + i.value, 0)
  const r = size / 2
  const inner = r * 0.62
  let angle = -Math.PI / 2
  const arc = (a0: number, a1: number) => {
    const large = a1 - a0 > Math.PI ? 1 : 0
    const p = (rad: number, a: number) => `${r + rad * Math.cos(a)},${r + rad * Math.sin(a)}`
    return `M${p(r, a0)} A${r},${r} 0 ${large} 1 ${p(r, a1)} L${p(inner, a1)} A${inner},${inner} 0 ${large} 0 ${p(inner, a0)} Z`
  }
  const shown = hover != null ? parts[hover] : null
  return (
    <svg width={size} height={size} role="img" aria-label={ariaLabel} onMouseLeave={() => setHover(null)}>
      {total > 0 &&
        parts.map((p, i) => {
          const a0 = angle
          const a1 = angle + (p.value / total) * Math.PI * 2 - (parts.length > 1 ? 0.004 : 0)
          angle += (p.value / total) * Math.PI * 2
          return parts.length === 1 ? (
            <g key={p.key} onMouseEnter={() => setHover(i)}>
              <circle cx={r} cy={r} r={(r + inner) / 2} fill="none" stroke={p.color} strokeWidth={r - inner} />
            </g>
          ) : (
            <path key={p.key} d={arc(a0, a1)} fill={p.color} opacity={hover == null || hover === i ? 1 : 0.5} onMouseEnter={() => setHover(i)} />
          )
        })}
      <text x={r} y={r - 6} textAnchor="middle" className="fill-muted text-[11px]">
        {shown ? truncate(shown.label, 18) : centerLabel}
      </text>
      <text x={r} y={r + 12} textAnchor="middle" className="fill-fg text-[13px] font-medium tabular">
        {format(shown ? shown.value : total)}
      </text>
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Line chart with uncertainty bands over a numeric x axis (e.g. months of a simulation)
// ---------------------------------------------------------------------------

export interface BandSeries extends Series {
  points: { x: number; y: number; lower?: number; upper?: number }[]
}

export function BandLineChart({
  series,
  format,
  formatX,
  height = 280,
  ariaLabel,
}: {
  series: BandSeries[]
  format: (v: number) => string
  formatX: (x: number) => string
  height?: number
  ariaLabel: string
}) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const pad = { top: 14, right: 12, bottom: 28, left: 56 }
  const pts = series.flatMap((s) => s.points)
  const xs = pts.map((p) => p.x)
  const x0 = Math.min(...xs)
  const x1 = Math.max(...xs, x0 + 1)
  const ticks = niceTicks(Math.min(...pts.map((p) => p.lower ?? p.y)), Math.max(...pts.map((p) => p.upper ?? p.y)))
  const lo = ticks[0]
  const hi = ticks[ticks.length - 1]
  const innerW = Math.max(0, width - pad.left - pad.right)
  const innerH = height - pad.top - pad.bottom
  const x = (v: number) => pad.left + ((v - x0) / (x1 - x0)) * innerW
  const y = (v: number) => pad.top + innerH - ((v - lo) / (hi - lo || 1)) * innerH
  const xTicks = niceTicks(x0, x1, 6).filter((t) => t >= x0 && t <= x1)
  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const first = series[0]?.points ?? []
    let best = -1
    let bestD = Infinity
    first.forEach((p, i) => {
      const d = Math.abs(x(p.x) - mx)
      if (d < bestD) {
        bestD = d
        best = i
      }
    })
    setHover(best >= 0 ? best : null)
  }
  return (
    <div className="space-y-2">
      <Legend series={series} />
      <div ref={ref} className="relative" style={{ height }}>
        {width > 0 && pts.length > 0 && (
          <svg width={width} height={height} role="img" aria-label={ariaLabel} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={pad.left} x2={width - pad.right} y1={y(t)} y2={y(t)} stroke="var(--color-grid)" />
                <text x={pad.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-muted text-[11px] tabular">
                  {format(t)}
                </text>
              </g>
            ))}
            {xTicks.map((t) => (
              <text key={t} x={x(t)} y={height - 8} textAnchor="middle" className="fill-muted text-[11px]">
                {formatX(t)}
              </text>
            ))}
            {series.map((s) => {
              const band = s.points.filter((p) => p.lower != null && p.upper != null)
              const area = band.length
                ? `M${band.map((p) => `${x(p.x)},${y(p.upper!)}`).join(' L')} L${[...band].reverse().map((p) => `${x(p.x)},${y(p.lower!)}`).join(' L')} Z`
                : ''
              const line = s.points.map((p, i) => `${i ? 'L' : 'M'}${x(p.x)},${y(p.y)}`).join(' ')
              return (
                <g key={s.name}>
                  {area && <path d={area} fill={s.color} opacity={0.15} />}
                  <path d={line} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" />
                </g>
              )
            })}
            {hover != null && series[0]?.points[hover] && <line x1={x(series[0].points[hover].x)} x2={x(series[0].points[hover].x)} y1={pad.top} y2={pad.top + innerH} stroke="var(--color-muted)" />}
          </svg>
        )}
        {hover != null && series[0]?.points[hover] && (
          <Tooltip x={x(series[0].points[hover].x)} y={pad.top + 20} width={width}>
            <div className="text-muted">{formatX(series[0].points[hover].x)}</div>
            {series.map((s) => {
              const p = s.points[hover]
              if (!p) return null
              return (
                <div key={s.name} className="flex items-center gap-1.5 text-fg-2">
                  <span className="size-2 rounded-sm" style={{ background: s.color }} aria-hidden />
                  {series.length > 1 && <span>{s.name}</span>}
                  <span className="ml-auto pl-3 font-medium text-fg tabular">{format(p.y)}</span>
                  {p.lower != null && p.upper != null && (
                    <span className="text-muted tabular">
                      ({format(p.lower)} – {format(p.upper)})
                    </span>
                  )}
                </div>
              )
            })}
          </Tooltip>
        )}
      </div>
    </div>
  )
}
