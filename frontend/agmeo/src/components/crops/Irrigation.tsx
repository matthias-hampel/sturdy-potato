import type { CycleWaterBalance, Field, WaterBalanceDay } from '@agmeo/contracts'
import { useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ChevronUp, Info, Map as MapIcon } from 'lucide-react'
import { useMemo, useState } from 'react'
import { DialogTrigger } from 'react-aria-components'
import { useTranslation } from 'react-i18next'
import { useWidth } from '#/components/charts'
import { FieldMap } from '#/components/map/FieldMap'
import { api, errorMessage } from '#/lib/api'
import { fmt, today } from '#/lib/format'
import { useOrg } from '#/lib/org'
import { useOrgMutation } from '#/lib/queries'
import { Button, Link } from '#/ui/Button'
import { DatePicker, NumberField } from '#/ui/Field'
import { Card } from '#/ui/Layout'
import { Dialog, ModalDialog } from '#/ui/Overlay'
import { toast } from '#/ui/Toast'
import { cx } from '#/ui/utils'

export const waterBalancesKey = (orgId: string, seasonId: string | null | undefined) => ['org', orgId, '/water-balances', { seasonId }]

/** % nFK colour bands of the reference: ≥ 50 % sufficient, ≥ 30 % increased need, below critical. */
const fillColor = (pct: number | null) => (pct == null ? 'var(--color-muted)' : pct >= 50 ? 'var(--color-series-1)' : pct >= 30 ? 'var(--color-warning)' : 'var(--color-danger)')
const LEVEL_TONE = { ok: 'bg-[color-mix(in_oklab,var(--color-success)_18%,transparent)] text-success', warning: 'bg-[color-mix(in_oklab,var(--color-warning)_20%,transparent)] text-warning', critical: 'bg-[color-mix(in_oklab,var(--color-danger)_18%,transparent)] text-danger' } as const

const displayDay = (days: WaterBalanceDay[]) => days.find((d) => d.date === today()) ?? days[days.length - 1]
const pctOf = (wb: CycleWaterBalance, swc: number) => (wb.pwpMm == null || !wb.awcMm ? null : Math.max(0, Math.min(100, ((swc - wb.pwpMm) / wb.awcMm) * 100)))

/** Sums of the last ten days up to the display day, and the last rain of at least 5 mm (reference sparkline tooltip). */
export function recentSummary(days: WaterBalanceDay[]) {
  const i = days.indexOf(displayDay(days))
  const window = days.slice(Math.max(0, i - 9), i + 1)
  const sum = (k: 'precipitationMm' | 'etaMm' | 'irrigationMm') => window.reduce((s, d) => s + d[k], 0)
  const p = sum('precipitationMm')
  const eta = sum('etaMm')
  const irr = sum('irrigationMm')
  let lastRain: { days: number; mm: number } | null = null
  for (let j = i; j >= 0; j--) {
    if (days[j].precipitationMm >= 5) {
      lastRain = { days: i - j, mm: days[j].precipitationMm }
      break
    }
  }
  return { p, eta, irr, balance: p + irr - eta, lastRain }
}

/** "62 % nFK" with the deficit below when not sufficient (reference deficit cell). */
export function SoilWaterBadge({ wb }: { wb: CycleWaterBalance | undefined }) {
  if (!wb || wb.fillPct == null || !wb.deficitLevel) return <span className="text-muted">—</span>
  return (
    <span className="inline-flex flex-col items-start leading-tight">
      <span className={cx('rounded-full px-2 py-0.5 text-xs font-medium tabular whitespace-nowrap', LEVEL_TONE[wb.deficitLevel])}>{`${fmt.num(wb.fillPct)} % nFK`}</span>
      {wb.deficitLevel !== 'ok' && wb.currentDeficitMm != null && <span className="text-xs text-muted tabular">−{fmt.num(wb.currentDeficitMm)} mm</span>}
    </span>
  )
}

/** KA5 soil class of the balance with its hydraulics on hover; without a soil class a link to set one. */
export function SoilTypeCell({ wb, fieldId }: { wb: CycleWaterBalance | undefined; fieldId: string }) {
  const { t } = useTranslation()
  const { orgId } = useOrg()
  if (!wb?.soilTypeKa5 || wb.thetaFc == null) {
    return (
      <Link to="/o/$orgId/fields/$fieldId" params={{ orgId, fieldId }} search={{}} variant="quiet" size="sm">
        {t('irrigation.soilType.empty.cta')}
      </Link>
    )
  }
  const title = [
    `${t('irrigation.fc')}: ${fmt.num(wb.thetaFc)} % vol`,
    `${t('irrigation.pwp')}: ${fmt.num(wb.thetaPwp)} % vol`,
    `${t('irrigation.rootDepth')}: ${fmt.num(wb.rootDepthM, 2)} m`,
    `${t('irrigation.awc')}: ${fmt.num(wb.awcMm)} mm`,
    t('irrigation.rootDepth.cropSpecific'),
    t('irrigation.soilSource', { depth: '0–30 cm' }),
  ].join('\n')
  return (
    <span className="font-mono font-semibold" title={title}>
      {wb.soilTypeKa5}
    </span>
  )
}

/** Rooting depth: the crop's FAO-56 default (muted) or the cycle's override; clearing restores the default. */
export function RootDepthCell({ wb, writable }: { wb: CycleWaterBalance | undefined; writable: boolean }) {
  const { t } = useTranslation()
  const { orgId } = useOrg()
  const qc = useQueryClient()
  const [draft, setDraft] = useState<number | null>(null)
  const save = useOrgMutation((base, v: number | null) => api.patch(`${base}/water-balances/root-depths`, { updates: [{ cropCycleId: wb!.cropCycleId, rootDepthM: v }] }), {
    onSuccess: () => qc.invalidateQueries({ queryKey: ['org', orgId, '/water-balances'] }),
  })
  if (!wb) return <span className="text-muted">—</span>
  const shown = draft ?? wb.rootDepthOverrideM ?? NaN
  if (!writable) return <span className={cx('tabular', wb.rootDepthOverrideM == null && 'text-muted')}>{fmt.num(wb.rootDepthM, 2)} m</span>
  const commit = () => {
    if (draft === null) return
    const v = Number.isNaN(draft) ? null : draft
    setDraft(null)
    if (v === wb.rootDepthOverrideM) return
    save.mutate(v, { onError: (e) => toast.error(t('irrigation.saveError'), errorMessage(e)) })
  }
  return (
    <NumberField
      aria-label={t('irrigation.maxRootDepth')}
      className="w-24"
      unit="m"
      minValue={0.1}
      maxValue={3}
      step={0.1}
      formatOptions={{ maximumFractionDigits: 2 }}
      placeholder={fmt.num(wb.cropRootDepthM, 2)}
      value={shown}
      onChange={(v) => setDraft(v)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
        if (e.key === 'Escape') setDraft(null)
      }}
    />
  )
}

/** The season's soil water between wilting point and field capacity in 140 × 36 px (reference WaterBalanceSparkline). */
export function WaterBalanceSparkline({ wb, onOpen }: { wb: CycleWaterBalance | undefined; onOpen: () => void }) {
  const { t } = useTranslation()
  if (!wb?.days.length || wb.fcMm == null || wb.pwpMm == null || !wb.awcMm) return <span className="text-muted">—</span>
  const { days, fcMm: fc, pwpMm: pwp, awcMm: awc } = wb
  const W = 140
  const H = 36
  const pad = 2
  const x = (i: number) => pad + (i / Math.max(1, days.length - 1)) * (W - 2 * pad)
  const y = (mm: number) => pad + (1 - (Math.max(pwp, Math.min(fc, mm)) - pwp) / (fc - pwp)) * (H - 2 * pad)
  const shown = displayDay(days)
  const pct = pctOf(wb, shown.swcMm)
  const color = fillColor(pct)
  const line = days.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d.swcMm).toFixed(1)}`).join(' ')
  const todayIdx = days.findIndex((d) => d.date === today())
  const sowIdx = wb.sowingDate ? days.findIndex((d) => d.date === wb.sowingDate) : -1
  const s = recentSummary(days)
  const title = [
    `${t('irrigation.waterBalance')} · ${fmt.date(shown.date)}`,
    `${t('irrigation.simulationFrom', { date: fmt.date(wb.simulationStartDate) })}${wb.sowingDate ? ` · ${t('irrigation.sowingOn', { date: fmt.date(wb.sowingDate) })}` : ''}`,
    `${t('irrigation.soilWater')}: ${pct == null ? '—' : `${fmt.num(pct)} % nFK`} (${fmt.num(shown.swcMm)} mm)`,
    `${t('irrigation.fc')}: ${fmt.num(fc)} mm · ${t('irrigation.pwp')}: ${fmt.num(pwp)} mm`,
    `${t('irrigation.deficit')}: ${fmt.num(shown.deficitMm)} mm`,
    `${t('irrigation.windowSummary')} ${t('irrigation.precipitation')} ${fmt.num(s.p, 1)} mm · ETa ${fmt.num(s.eta, 1)} mm · ${t('irrigation.irrigated')} ${fmt.num(s.irr, 1)} mm · ${t('irrigation.netBalance')} ${s.balance >= 0 ? '+' : ''}${fmt.num(s.balance, 1)} mm`,
    `${t('irrigation.lastRain', { amount: '5 mm' })} ${s.lastRain ? `${t('irrigation.daysAgo', { count: s.lastRain.days })} (${fmt.num(s.lastRain.mm, 1)} mm)` : '—'}`,
  ].join('\n')
  const band = (from: number, to: number, fill: string, opacity: number) => <rect x={pad} width={W - 2 * pad} y={y(pwp + to * awc)} height={Math.max(0, y(pwp + from * awc) - y(pwp + to * awc))} fill={fill} opacity={opacity} />
  return (
    <button type="button" onClick={onOpen} title={title} aria-label={title} className="block rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-primary/50">
      <svg width={W} height={H} aria-hidden>
        {band(0.5, 1, 'var(--color-success)', 0.1)}
        {band(0.3, 0.5, 'var(--color-warning)', 0.12)}
        {band(0, 0.3, 'var(--color-danger)', 0.12)}
        <line x1={pad} x2={W - pad} y1={y(fc)} y2={y(fc)} stroke="var(--color-muted)" strokeDasharray="2 2" />
        <line x1={pad} x2={W - pad} y1={y(pwp)} y2={y(pwp)} stroke="var(--color-muted)" strokeDasharray="2 2" />
        <path d={`${line} L${x(days.length - 1)},${H - pad} L${x(0)},${H - pad} Z`} fill={color} opacity={0.25} />
        <path d={line} fill="none" stroke={color} strokeWidth={1.5} />
        {sowIdx >= 0 && <line x1={x(sowIdx)} x2={x(sowIdx)} y1={pad} y2={H - pad} stroke="var(--color-success)" />}
        {todayIdx >= 0 && todayIdx < days.length - 1 && <line x1={x(todayIdx)} x2={x(todayIdx)} y1={pad} y2={H - pad} stroke="var(--color-fg)" strokeDasharray="2 2" />}
        {days.map((d, i) => (d.irrigationMm > 0 ? <line key={d.date} x1={x(i)} x2={x(i)} y1={H - pad - 6} y2={H - pad} stroke="var(--color-series-1)" strokeWidth={1.5} /> : null))}
      </svg>
      <span className="flex justify-between text-[10px] text-muted tabular">
        <span>{fmt.shortDate(days[0].date)}</span>
        <span>{fmt.shortDate(days[days.length - 1].date)}</span>
      </span>
    </button>
  )
}

/**
 * Soil water, precipitation and irrigation of one crop over the season (reference
 * WaterBalanceDetailModal): soil water as an area between wilting point and field capacity with
 * the 50 % and 30 % nFK thresholds, daily precipitation and irrigation as bars on a second axis,
 * sowing and today, a date range, today's state and the season totals.
 */
export function WaterBalanceDialog({ wb, fieldName, onClose }: { wb: CycleWaterBalance; fieldName: string; onClose: () => void }) {
  const { t } = useTranslation()
  const [from, setFrom] = useState<string | null>(null)
  const [to, setTo] = useState<string | null>(null)
  const days = useMemo(() => wb.days.filter((d) => (!from || d.date >= from) && (!to || d.date <= to)), [wb.days, from, to])
  const shown = displayDay(wb.days)
  const pct = pctOf(wb, shown.swcMm)
  const totals = wb.days.reduce((s, d) => ({ p: s.p + d.precipitationMm, eta: s.eta + d.etaMm, irr: s.irr + d.irrigationMm, n: s.n + (d.irrigationMm > 0 ? 1 : 0), drain: s.drain + d.drainageMm }), { p: 0, eta: 0, irr: 0, n: 0, drain: 0 })
  const kpi = (label: string, value: string, hint?: string, color?: string) => (
    <div>
      <p className="text-xs text-muted">{label}</p>
      <p className="text-lg font-semibold tabular" style={color ? { color } : undefined}>{value}</p>
      {hint && <p className="text-xs text-muted tabular">{hint}</p>}
    </div>
  )
  return (
    <ModalDialog
      isOpen
      onOpenChange={(o) => !o && onClose()}
      title={`${fieldName} · ${t('irrigation.waterBalance')} (${t('irrigation.rootDepth')})`}
      description={`${t('irrigation.simulationFrom', { date: fmt.date(wb.simulationStartDate) })}${wb.sowingDate ? ` · ${t('irrigation.sowingOn', { date: fmt.date(wb.sowingDate) })}` : ''}`}
      size="xl"
    >
      <div className="grid lg:grid-cols-[1fr_17rem] gap-5">
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <DatePicker label={t('irrigation.detail.from')} value={from} onChange={setFrom} minValue={wb.days[0]?.date} maxValue={to ?? wb.days[wb.days.length - 1]?.date} />
            <DatePicker label={t('irrigation.detail.to')} value={to} onChange={setTo} minValue={from ?? wb.days[0]?.date} maxValue={wb.days[wb.days.length - 1]?.date} />
            {(from || to) && (
              <Button size="sm" variant="quiet" onPress={() => { setFrom(null); setTo(null) }}>
                {t('irrigation.detail.reset')}
              </Button>
            )}
          </div>
          {days.length > 1 && wb.fcMm != null && wb.pwpMm != null && wb.awcMm ? <WaterBalanceChart wb={wb} days={days} /> : <p className="text-sm text-muted">{t('irrigation.detail.noDays')}</p>}
          <p className="text-xs text-muted font-mono">{t('irrigation.info.formula')}</p>
        </div>
        <aside className="space-y-4">
          <Card>
            <div className="grid grid-cols-2 gap-3">
              {kpi(t('irrigation.soilWater'), pct == null ? '—' : `${fmt.num(pct)} % nFK`, `${fmt.num(shown.swcMm)} mm`, fillColor(pct))}
              {kpi(t('irrigation.deficit'), `${fmt.num(shown.deficitMm)} mm`, t('irrigation.detail.tillFc'))}
              {kpi(t('irrigation.awc'), `${fmt.num(wb.awcMm)} mm`, t('irrigation.detail.fcMinusPwp', { fc: fmt.num(wb.fcMm), pwp: fmt.num(wb.pwpMm) }))}
              {kpi(t('irrigation.rootDepth'), `${fmt.num(wb.rootDepthM, 2)} m`, wb.soilTypeKa5 ?? undefined)}
            </div>
          </Card>
          <Card title={t('irrigation.detail.season')}>
            <div className="grid grid-cols-2 gap-3">
              {kpi(t('irrigation.precipitation'), `${fmt.num(totals.p)} mm`)}
              {kpi(t('irrigation.eta'), `${fmt.num(totals.eta)} mm`)}
              {kpi(t('irrigation.irrigated'), `${fmt.num(totals.irr)} mm`, `${totals.n} ×`)}
              {kpi(t('irrigation.netBalance'), `${fmt.num(totals.p + totals.irr - totals.eta - totals.drain)} mm`)}
            </div>
          </Card>
          <dl className="space-y-2 text-xs">
            {(['sowing', 'today', 'fcPwp', 'precipitation', 'irrigated', 'yellowThreshold', 'redThreshold'] as const).map((k) => (
              <div key={k}>
                <dt className="font-medium text-fg-2">{t(`irrigation.legend.${k}.title`)}</dt>
                <dd className="text-muted">{t(`irrigation.legend.${k}.hint`)}</dd>
              </div>
            ))}
          </dl>
        </aside>
      </div>
    </ModalDialog>
  )
}

function WaterBalanceChart({ wb, days }: { wb: CycleWaterBalance; days: WaterBalanceDay[] }) {
  const { t } = useTranslation()
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const H = 360
  const pad = { top: 12, right: 56, bottom: 28, left: 64 }
  const fc = wb.fcMm!
  const pwp = wb.pwpMm!
  const awc = wb.awcMm!
  const innerW = Math.max(0, width - pad.left - pad.right)
  const innerH = H - pad.top - pad.bottom
  const yMin = pwp - 0.1 * awc
  const yMax = pwp + 1.1 * awc
  const barMax = Math.max(20, ...days.map((d) => Math.max(d.precipitationMm, d.irrigationMm))) * 1.4
  const x = (i: number) => pad.left + (i / Math.max(1, days.length - 1)) * innerW
  const y = (mm: number) => pad.top + innerH - ((Math.max(yMin, Math.min(yMax, mm)) - yMin) / (yMax - yMin)) * innerH
  const yb = (mm: number) => pad.top + innerH - (mm / barMax) * innerH
  const bw = Math.max(1, innerW / days.length / 2.5)
  const pct = pctOf(wb, displayDay(wb.days).swcMm)
  const color = fillColor(pct)
  const line = days.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d.swcMm).toFixed(1)}`).join(' ')
  const todayIdx = days.findIndex((d) => d.date === today())
  const sowIdx = wb.sowingDate ? days.findIndex((d) => d.date === wb.sowingDate) : -1
  const ref1 = (mm: number, stroke: string, dash: string, opacity = 1) => <line x1={pad.left} x2={pad.left + innerW} y1={y(mm)} y2={y(mm)} stroke={stroke} strokeDasharray={dash} opacity={opacity} />
  const ticks = [-10, 0, 15, 30, 50, 75, 100, 110]
  const step = Math.max(1, Math.ceil(days.length / 8))
  const h = hover == null ? null : days[hover]
  return (
    <div ref={ref} className="relative" style={{ height: H }}>
      {width > 0 && (
        <svg
          width={width}
          height={H}
          role="img"
          aria-label={t('irrigation.waterBalance')}
          onMouseMove={(e) => {
            const mx = e.clientX - e.currentTarget.getBoundingClientRect().left
            setHover(Math.max(0, Math.min(days.length - 1, Math.round(((mx - pad.left) / (innerW || 1)) * (days.length - 1)))))
          }}
          onMouseLeave={() => setHover(null)}
        >
          {ticks.map((p) => (
            <text key={p} x={pad.left - 6} y={y(pwp + (p / 100) * awc)} dy="0.32em" textAnchor="end" className="fill-muted text-[10px] tabular">
              {`${fmt.num(pwp + (p / 100) * awc)} · ${p} %`}
            </text>
          ))}
          {[0, 0.5, 1].map((f) => (
            <text key={f} x={pad.left + innerW + 6} y={yb(f * barMax)} dy="0.32em" className="fill-muted text-[10px] tabular">
              {fmt.num(f * barMax)}
            </text>
          ))}
          <text x={12} y={pad.top + innerH / 2} transform={`rotate(-90 12 ${pad.top + innerH / 2})`} textAnchor="middle" className="fill-muted text-[10px]">{t('irrigation.detail.axisSwc')}</text>
          <text x={width - 8} y={pad.top + innerH / 2} transform={`rotate(90 ${width - 8} ${pad.top + innerH / 2})`} textAnchor="middle" className="fill-muted text-[10px]">{t('irrigation.detail.axisRain')}</text>
          {ref1(fc, 'var(--color-muted)', '4 4')}
          {ref1(pwp + 0.5 * awc, 'var(--color-warning)', '2 2', 0.6)}
          {ref1(pwp + 0.3 * awc, 'var(--color-danger)', '2 2', 0.6)}
          {ref1(pwp, 'var(--color-muted)', '4 4')}
          <path d={`${line} L${x(days.length - 1)},${y(yMin)} L${x(0)},${y(yMin)} Z`} fill={color} opacity={0.18} />
          <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />
          {days.map((d, i) => (
            <g key={d.date}>
              {d.precipitationMm > 0 && <rect x={x(i) - bw} width={bw} y={yb(d.precipitationMm)} height={pad.top + innerH - yb(d.precipitationMm)} fill="var(--color-series-1)" opacity={d.forecast ? 0.45 : 0.8} />}
              {d.irrigationMm > 0 && <rect x={x(i)} width={bw} y={yb(d.irrigationMm)} height={pad.top + innerH - yb(d.irrigationMm)} fill="var(--color-series-3)" />}
            </g>
          ))}
          {sowIdx >= 0 && <line x1={x(sowIdx)} x2={x(sowIdx)} y1={pad.top} y2={pad.top + innerH} stroke="var(--color-success)" />}
          {todayIdx >= 0 && <line x1={x(todayIdx)} x2={x(todayIdx)} y1={pad.top} y2={pad.top + innerH} stroke="var(--color-fg)" strokeDasharray="4 4" />}
          {days.map((d, i) => (i % step === 0 ? <text key={d.date} x={x(i)} y={H - 8} textAnchor="middle" className="fill-muted text-[10px] tabular">{fmt.shortDate(d.date)}</text> : null))}
          {hover != null && <line x1={x(hover)} x2={x(hover)} y1={pad.top} y2={pad.top + innerH} stroke="var(--color-muted)" />}
        </svg>
      )}
      {h && (
        <div className="pointer-events-none absolute top-2 rounded-md border border-line bg-surface px-2 py-1 text-xs shadow" style={{ left: Math.min(Math.max(0, x(hover!) + 8), width - 180) }}>
          <div className="text-muted">{fmt.date(h.date)}{h.forecast ? ` · ${t('irrigation.detail.forecast')}` : ''}</div>
          <div className="tabular">{t('irrigation.swc')}: {fmt.num(h.swcMm, 1)} mm</div>
          <div className="tabular">{t('irrigation.precipitation')}: {fmt.num(h.precipitationMm, 1)} mm</div>
          <div className="tabular">{t('irrigation.irrigated')}: {fmt.num(h.irrigationMm, 1)} mm</div>
          <div className="tabular">ETa: {fmt.num(h.etaMm, 1)} mm</div>
        </div>
      )}
    </div>
  )
}

const INFO_SECTIONS = ['model', 'et0', 'bbch', 'kc', 'stress', 'surface', 'soil', 'start', 'precip', 'deficit', 'weather'] as const

/** "Bewässerungsplanung — Methodik" (reference IrrigationInfoModal); constants as in the model. */
export function IrrigationInfoButton() {
  const { t } = useTranslation()
  const thetaToMm = (theta: number, depth: number) => (theta / 100) * depth * 1000
  const params = {
    interception: `${fmt.num(0.3, 1)} mm`,
    runoff: '10 mm',
    heavy: '30 mm',
    depth: `${fmt.num(0.15, 2)} m`,
    topsoil: '0–30 cm',
    // getRootDepth of winter wheat, grain maize, sugar beet, late table potato and grassland.
    wheat: `${fmt.num(1.8, 1)} m`,
    maize: `${fmt.num(1.7, 1)} m`,
    beet: `${fmt.num(1.1, 1)} m`,
    potato: `${fmt.num(1.0, 1)} m`,
    grassland: `${fmt.num(1.5, 1)} m`,
    examples: [0.3, 1.1, 1.8].map((m) => `${fmt.num(m, 1)} m → ${fmt.num(thetaToMm(26.5 - 10.7, m))} mm`).join(', '),
  }
  return (
    <DialogTrigger>
      <Button size="sm" variant="quiet">
        <Info /> {t('irrigation.info.title')}
      </Button>
      <Dialog title={t('irrigation.info.title')} size="lg">
        <div className="space-y-4 text-sm">
          {INFO_SECTIONS.map((k) => (
            <section key={k} className="space-y-1">
              <h3 className="font-semibold text-fg">{t(`irrigation.info.${k}Title`)}</h3>
              <p className="text-fg-2">{t(`irrigation.info.${k}Desc`, params)}</p>
            </section>
          ))}
          <p className="text-xs font-mono text-muted">{t('irrigation.info.formula')}</p>
          <p className="text-xs text-muted">{t('irrigation.info.disclaimer')}</p>
        </div>
      </Dialog>
    </DialogTrigger>
  )
}

const COVERAGE_STOPS = [
  { mm: 0, color: '#dbeafe' },
  { mm: 10, color: '#93c5fd' },
  { mm: 20, color: '#3b82f6' },
  { mm: 30, color: '#1d4ed8' },
  { mm: 40, color: '#1e3a8a' },
] as const
const coverageColor = (mm: number) => [...COVERAGE_STOPS].reverse().find((s) => mm >= s.mm)!.color

/**
 * Irrigation map of the season: fields coloured by the water applied to their crop (reference
 * Beregnungskarte, which draws irrigator tracks imported from Raindancer; without that
 * integration the map shows the documented amounts per field).
 */
export function IrrigationMapCard({ fields, balances }: { fields: Field[]; balances: CycleWaterBalance[] }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(true)
  const applied = useMemo(() => {
    const m = new Map<string, number>()
    for (const b of balances) {
      const mm = b.events.filter((e) => e.status === 'completed').reduce((s, e) => s + e.mm, 0)
      if (mm > 0) m.set(b.fieldId, (m.get(b.fieldId) ?? 0) + mm)
    }
    return m
  }, [balances])
  if (!applied.size) return null
  return (
    <Card padded={false} className="mb-4">
      <button type="button" className="flex w-full items-center gap-2 px-4 py-3 text-left font-semibold text-fg" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <MapIcon className="size-4" aria-hidden /> {t('irrigation.coverageMap.title')}
        <span className="ml-auto text-muted">{open ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}</span>
      </button>
      {open && (
        <div className="relative h-96 border-t border-line">
          <FieldMap fields={fields.filter((f) => applied.has(f.id))} colorBy={(f) => (applied.has(f.id) ? coverageColor(applied.get(f.id)!) : null)} fillOpacity={0.6} className="h-full" />
          <div className="absolute right-3 top-3 rounded-md bg-surface/95 p-2 text-xs shadow">
            <p className="font-medium text-fg mb-1">{t('irrigation.coverageMap.legendTitle')} (mm)</p>
            <div className="flex gap-1">
              {COVERAGE_STOPS.map((s) => (
                <span key={s.mm} className="flex flex-col items-center">
                  <span className="h-3 w-6 rounded-sm" style={{ background: s.color }} />
                  <span className="tabular text-muted">{s.mm}</span>
                </span>
              ))}
            </div>
            <p className="mt-1 max-w-48 text-muted">{t('irrigation.coverageMap.perField')}</p>
          </div>
        </div>
      )}
    </Card>
  )
}
