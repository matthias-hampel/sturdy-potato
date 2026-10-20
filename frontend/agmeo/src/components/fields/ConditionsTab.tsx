import type { ConditionDay, ConditionLevel, ConditionReason, Dimension, Equipment, FieldConditions, FieldTrafficability, FieldWeather, StoredWeatherHour } from '@agmeo/contracts'
import { CloudSun, Droplets, Gauge, type LucideIcon, Sprout } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LineChart } from '#/components/charts'
import { t } from '#/i18n'
import { fmt } from '#/lib/format'
import { useOrgQuery } from '#/lib/queries'
import { NumberField, Option, Select } from '#/ui/Field'
import { Badge, Card, EmptyState, ErrorNotice, Loading, Notice } from '#/ui/Layout'
import { cx } from '#/ui/utils'

/** Colour of a 0 (good) … 3 (bad) condition level, as in the reference's bars. */
const LEVEL_COLOR: Record<ConditionLevel, string> = {
  0: 'var(--color-success)',
  1: 'color-mix(in oklab, var(--color-success) 45%, var(--color-warning))',
  2: 'var(--color-warning)',
  3: 'var(--color-danger)',
}

const levelLabel = (v: ConditionLevel | null) => (v == null ? t('conditions.level.none') : t(`conditions.level.${v}`))

function reasonText(r: ConditionReason) {
  if (r.key.startsWith('reason.disease.')) return `${t(`conditions.disease.name.${r.key.slice('reason.disease.'.length)}`)}: ${t(`conditions.disease.level.${r.value ?? 0}`)}`
  const label = t(`conditions.${r.key}`, { defaultValue: r.key.replace('reason.', '') })
  if (r.value == null) return label
  if (r.dimension === 'hours') return `${label}: ${fmt.num(r.value)} h`
  if (r.dimension) return `${label}: ${fmt.measure(r.value, r.dimension as Dimension, { digits: r.dimension === 'speed' ? 0 : 1 })}`
  return `${label}: ${fmt.num(r.value, 1)}`
}

function Cell({ level, title, className }: { level: ConditionLevel | null; title: string; className?: string }) {
  return <span title={title} className={cx('block h-6 rounded-sm', className)} style={{ background: level == null ? 'var(--color-surface-3)' : LEVEL_COLOR[level] }} />
}

/** One condition bar: a coloured cell per day with its reasons on hover. */
function ConditionBar({ label, days, missing }: { label: string; days: ConditionDay[] | null; missing?: string }) {
  return (
    <div className="grid grid-cols-[9rem_1fr] items-center gap-3">
      <span className="text-sm text-fg-2">{label}</span>
      {days ? (
        <div className="grid gap-0.5" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}>
          {days.map((d) => (
            <Cell key={d.date} level={d.value} title={[`${fmt.date(d.date)}: ${levelLabel(d.value)}`, ...d.reasons.map(reasonText)].join('\n')} />
          ))}
        </div>
      ) : (
        <span className="text-xs text-muted">{missing ?? t('conditions.level.none')}</span>
      )}
    </div>
  )
}

/**
 * A condition bar small enough for a table cell: one coloured slice per day, the day's level and
 * reasons on hover (the reference's TrafficLightBar).
 */
export function MiniConditionBar({ days, label }: { days: ConditionDay[] | null | undefined; label: string }) {
  if (!days?.length || days.every((d) => d.value == null)) return <span className="text-muted">—</span>
  return (
    <div role="img" aria-label={`${label}: ${days.map((d) => `${fmt.shortDate(d.date)} ${levelLabel(d.value)}`).join(', ')}`} className="flex h-4 w-28 gap-px overflow-hidden rounded-sm">
      {days.map((d) => (
        <span
          key={d.date}
          title={[`${fmt.date(d.date)}: ${levelLabel(d.value)}`, ...d.reasons.map(reasonText)].join('\n')}
          className="flex-1"
          style={{ background: d.value == null ? 'var(--color-surface-3)' : LEVEL_COLOR[d.value] }}
        />
      ))}
    </div>
  )
}

export function ConditionsTab({ fieldId }: { fieldId: string }) {
  const { t } = useTranslation()
  const conditions = useOrgQuery<FieldConditions>(`/fields/${fieldId}/conditions`, undefined, { staleTime: 10 * 60_000 })
  const weather = useOrgQuery<FieldWeather>(`/fields/${fieldId}/weather`, undefined, { staleTime: 10 * 60_000 })

  if (conditions.isLoading || weather.isLoading) return <Loading />
  if (conditions.error) return <ErrorNotice error={conditions.error} />
  const c = conditions.data!
  const w = weather.data
  if (!c.refreshedAt)
    return (
      <Card>
        <EmptyState icon={CloudSun} title={t('conditions.empty.title')}>
          {t('conditions.empty.text')}
        </EmptyState>
      </Card>
    )
  const days = c.bars.spraying.map((d) => d.date)
  const hourByTime = new Map((w?.hourly ?? []).map((h) => [h.time.slice(0, 13), h]))

  return (
    <div className="space-y-6">
      <p className="text-xs text-muted">
        {t('conditions.refreshed', { time: fmt.date(c.refreshedAt, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) })}
        {c.cropCycle && ` · ${c.cropCycle.cropName}`}
        {c.cropCycle?.sowingDate && ` · ${t(`conditions.sowing.${c.cropCycle.sowingSource ?? 'calendar'}`, { date: fmt.date(c.cropCycle.sowingDate) })}`}
      </p>

      <Card title={t('conditions.bars.title')} description={t('conditions.bars.description')}>
        <div className="space-y-2">
          <div className="grid grid-cols-[9rem_1fr] gap-3">
            <span />
            <div className="grid gap-0.5 text-[10px] text-muted" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}>
              {days.map((d) => (
                <span key={d} className="text-center truncate">
                  {new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short' })}
                  <br />
                  {d.slice(8, 10)}.
                </span>
              ))}
            </div>
          </div>
          <ConditionBar label={t('conditions.bars.spraying')} days={c.bars.spraying} />
          <ConditionBar label={t('conditions.bars.sowing')} days={c.bars.sowing} />
          <ConditionBar
            label={t('conditions.bars.trafficability')}
            days={c.bars.trafficability}
            missing={c.soil.texture ? t('conditions.water.notEnoughWeather') : t('conditions.noWaterBalance')}
          />
          <ConditionBar label={t('conditions.bars.weatherRisk')} days={c.bars.weatherRisk} />
          {c.disease.supported && (
            <ConditionBar
              label={t('conditions.bars.disease')}
              days={c.bars.disease?.some((d) => d.value != null) ? c.bars.disease : null}
              missing={c.disease.configured || c.disease.refreshedAt ? t('conditions.disease.noData') : t('conditions.disease.notConfigured')}
            />
          )}
          <div className="flex flex-wrap gap-3 pt-2 text-xs text-muted">
            {([0, 1, 2, 3] as ConditionLevel[]).map((l) => (
              <span key={l} className="inline-flex items-center gap-1.5">
                <span className="size-3 rounded-sm" style={{ background: LEVEL_COLOR[l] }} /> {levelLabel(l)}
              </span>
            ))}
          </div>
        </div>
      </Card>

      {c.sprayHours.length > 0 && (
        <Card title={t('conditions.hours.title')} description={t('conditions.hours.description')} padded={false}>
          <div className="overflow-x-auto">
            <table className="w-full text-xs tabular">
              <tbody>
                <tr>
                  <th className="sticky left-0 bg-surface px-3 py-1.5 text-left font-medium text-muted whitespace-nowrap">{t('conditions.hours.time')}</th>
                  {c.sprayHours.map((h) => (
                    <td key={h.time} className="px-0.5 py-1.5 text-center text-muted">
                      {new Date(h.time).getHours()}
                    </td>
                  ))}
                </tr>
                <tr>
                  <th className="sticky left-0 bg-surface px-3 py-1 text-left font-medium text-muted whitespace-nowrap">{t('conditions.bars.spraying')}</th>
                  {c.sprayHours.map((h) => (
                    <td key={h.time} className="px-0.5 py-1 min-w-6">
                      <Cell level={h.level} title={[`${fmt.date(h.time, { weekday: 'short', hour: '2-digit', minute: '2-digit' })}: ${levelLabel(h.level)}`, ...h.reasons.map(reasonText)].join('\n')} />
                    </td>
                  ))}
                </tr>
                {(
                  [
                    ['temp', (x: StoredWeatherHour) => fmt.num(x.tempC)],
                    ['wind', (x: StoredWeatherHour) => fmt.num(x.windKmh)],
                    ['gust', (x: StoredWeatherHour) => fmt.num(x.gustKmh)],
                    ['rain', (x: StoredWeatherHour) => (x.precipitationMm ? fmt.num(x.precipitationMm, 1) : '')],
                  ] as const
                ).map(([key, value]) => (
                  <tr key={key}>
                    <th className="sticky left-0 bg-surface px-3 py-1 text-left font-medium text-muted whitespace-nowrap">{t(`conditions.hours.${key}`)}</th>
                    {c.sprayHours.map((h) => {
                      const x = hourByTime.get(h.time.slice(0, 13))
                      return (
                        <td key={h.time} className="px-0.5 py-1 text-center">
                          {x ? value(x) : ''}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <div className="grid lg:grid-cols-2 gap-6 items-start">
        <PhenologyCard c={c} />
        <WaterBalanceCard c={c} />
      </div>
      {c.disease.supported && <DiseaseCard c={c} />}
      <TrafficabilityCard fieldId={fieldId} hasSoil={!!c.soil.texture} />
    </div>
  )
}

function PhenologyCard({ c }: { c: FieldConditions }) {
  const { t } = useTranslation()
  const p = c.phenology
  if (!p) return <Card title={t('conditions.phenology.title')}><p className="text-sm text-muted">{t('conditions.phenology.noCrop')}</p></Card>
  const points = Object.entries(p.bbchByDate ?? {}).map(([date, value]) => ({ date, value }))
  return (
    <Card title={t('conditions.phenology.title')} description={p.bbchSource ? t(`conditions.phenology.source.${p.bbchSource}`) : undefined}>
      <div className="grid grid-cols-2 gap-3 mb-4">
        <Figure icon={Sprout} label={t('conditions.phenology.bbch')} value={p.currentBbch != null ? `BBCH ${p.currentBbch}` : '—'} />
        <Figure icon={Gauge} label={t('conditions.phenology.gdd')} value={p.gdd != null ? `${fmt.num(p.gdd)} °Cd` : '—'} hint={p.sowingDate ? t('conditions.phenology.since', { date: fmt.date(p.sowingDate) }) : undefined} />
      </div>
      <p className="text-xs text-muted mb-1">{t('conditions.phenology.chart')}</p>
      {points.length > 1 && <LineChart points={points} format={(v) => fmt.num(v)} domain={[0, 100]} height={180} ariaLabel={t('conditions.phenology.chart')} />}
    </Card>
  )
}

function WaterBalanceCard({ c }: { c: FieldConditions }) {
  const { t } = useTranslation()
  const wb = c.waterBalance
  if (!wb || wb.awcMm == null)
    return (
      <Card title={t('conditions.water.title')}>
        <Notice tone="info">{c.soil.texture ? t('conditions.water.notEnoughWeather') : t('conditions.water.noSoil')}</Notice>
      </Card>
    )
  const rec = wb.recommendation as { status?: string; triggerDate?: string | null; doseMm?: number | null; nfkPct?: number | null }
  const points = wb.days.slice(-120).map((d) => ({ date: d.date, value: d.deficitMm, muted: d.forecast }))
  return (
    <Card title={t('conditions.water.title')} description={t('conditions.water.description', { awc: fmt.num(wb.awcMm), depth: fmt.num(wb.rootDepthM, 1) })}>
      <div className="grid grid-cols-2 gap-3 mb-4">
        <Figure
          icon={Droplets}
          label={t('conditions.water.deficit')}
          value={wb.currentDeficitMm != null ? `${fmt.num(wb.currentDeficitMm)} mm` : '—'}
          tone={wb.deficitLevel === 'critical' ? 'danger' : wb.deficitLevel === 'warning' ? 'warning' : undefined}
          hint={rec.nfkPct != null ? t('conditions.water.nfk', { pct: fmt.num(rec.nfkPct) }) : undefined}
        />
        <div className="rounded-lg border border-line p-3">
          <div className="text-xs text-muted">{t('conditions.water.recommendation')}</div>
          <Badge tone={rec.status === 'due' ? 'danger' : rec.status === 'upcoming' ? 'warning' : rec.status === 'none' ? 'success' : 'neutral'} className="mt-1">
            {t(`conditions.water.status.${rec.status ?? 'missing_data'}`)}
          </Badge>
          {rec.triggerDate && rec.doseMm != null && <div className="text-sm mt-1">{t('conditions.water.dose', { date: fmt.date(rec.triggerDate), mm: fmt.num(rec.doseMm) })}</div>}
        </div>
      </div>
      <p className="text-xs text-muted mb-1">{t('conditions.water.chartAxis')}</p>
      {points.length > 1 && <LineChart points={points} format={(v) => fmt.num(v)} height={180} color="var(--color-info)" ariaLabel={t('conditions.water.chart')} />}
      <p className="text-xs text-muted mt-2">{t('conditions.water.textureHint')}</p>
    </Card>
  )
}

/** A compact figure that wraps instead of truncating in narrow cards. */
function Figure({ icon: Icon, label, value, hint, tone }: { icon: LucideIcon; label: string; value: string; hint?: string; tone?: 'warning' | 'danger' }) {
  return (
    <div className="rounded-lg border border-line p-3 min-w-0">
      <div className="flex items-center gap-1.5 text-xs text-muted">
        <Icon className="size-3.5 shrink-0" aria-hidden /> {label}
      </div>
      <div className={cx('text-lg font-semibold tabular mt-0.5', tone === 'danger' ? 'text-danger' : tone === 'warning' ? 'text-warning' : 'text-fg')}>{value}</div>
      {hint && <div className="text-xs text-muted">{hint}</div>}
    </div>
  )
}

const BAND_TONE: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = { good: 'success', caution: 'warning', risk: 'danger', unsafe: 'danger' }

function TrafficabilityCard({ fieldId, hasSoil }: { fieldId: string; hasSoil: boolean }) {
  const { t } = useTranslation()
  const equipment = useOrgQuery<Equipment[]>('/equipment')
  const machines = (equipment.data ?? []).filter((e) => e.class === 'machine')
  const [machineId, setMachineId] = useState<string | null>(null)
  const [front, setFront] = useState(NaN)
  const [rear, setRear] = useState(NaN)
  const chosen = machineId ?? machines.find((m) => m.sciReady)?.id ?? machines[0]?.id ?? null
  const result = useOrgQuery<FieldTrafficability>(
    chosen && hasSoil ? `/fields/${fieldId}/trafficability` : null,
    { equipmentId: chosen ?? undefined, frontKpa: Number.isNaN(front) ? undefined : front, rearKpa: Number.isNaN(rear) ? undefined : rear },
  )
  return (
    <Card title={t('conditions.traffic.title')} description={t('conditions.traffic.description')}>
      {!hasSoil ? (
        <Notice tone="info">{t('conditions.water.noSoil')}</Notice>
      ) : machines.length === 0 ? (
        <p className="text-sm text-muted">{t('conditions.traffic.noMachines')}</p>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <Select label={t('conditions.traffic.machine')} items={machines} value={chosen} onChange={(v) => v && setMachineId(String(v))} className="w-72">
              {(m) => <Option id={m.id} description={m.sciReady ? undefined : t('machinery.sci.missingHint')}>{m.name}</Option>}
            </Select>
            <NumberField label={t('conditions.traffic.front')} unit="kPa" value={front} onChange={setFront} minValue={40} maxValue={400} className="w-36" />
            <NumberField label={t('conditions.traffic.rear')} unit="kPa" value={rear} onChange={setRear} minValue={40} maxValue={400} className="w-36" />
          </div>
          {result.isLoading ? (
            <Loading />
          ) : result.error ? (
            <ErrorNotice error={result.error} />
          ) : result.data ? (
            <>
              {!result.data.sciReady && <Notice tone="warning">{t('conditions.traffic.defaults')}</Notice>}
              <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
                {result.data.days.map((d, i) => (
                  <div key={d.date} className="rounded-lg border border-line p-2 text-center">
                    <div className="text-xs text-muted">{i === 0 ? t('conditions.traffic.today') : fmt.date(d.date, { weekday: 'short', day: 'numeric' })}</div>
                    <Badge tone={d.band ? BAND_TONE[d.band] ?? 'neutral' : 'neutral'} className="mt-1">
                      {d.band ? t(`conditions.traffic.band.${d.band}`) : '—'}
                    </Badge>
                    <div className="text-xs text-muted mt-1 tabular">SCI {d.sci != null ? fmt.num(d.sci, 2) : '—'}</div>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted">
                {t('conditions.traffic.footer', { ka5: result.data.ka5 ?? '—', front: fmt.num(result.data.frontKpa), rear: fmt.num(result.data.rearKpa) })}
              </p>
            </>
          ) : null}
        </div>
      )}
    </Card>
  )
}

/** Risk level per disease on the last days with ISIP data (the reference's disease card). */
function DiseaseCard({ c }: { c: FieldConditions }) {
  const { t } = useTranslation()
  const d = c.disease
  const dates = d.diseases[0]?.days.map((x) => x.date) ?? []
  return (
    <Card
      title={t('conditions.disease.title')}
      description={d.refreshedAt ? t('conditions.disease.refreshed', { time: fmt.date(d.refreshedAt, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) }) : t('conditions.disease.source')}
      padded={dates.length === 0}
    >
      {dates.length === 0 ? (
        <Notice tone="info">{d.configured || d.refreshedAt ? t('conditions.disease.noData') : t('conditions.disease.notConfigured')}</Notice>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs tabular">
            <tbody>
              <tr>
                <th className="sticky left-0 bg-surface px-3 py-1.5" />
                {dates.map((date) => (
                  <td key={date} className="px-0.5 py-1.5 text-center text-muted">
                    {date.slice(8, 10)}.{date.slice(5, 7)}.
                  </td>
                ))}
              </tr>
              {d.diseases.map((disease) => (
                <tr key={disease.key}>
                  <th className="sticky left-0 bg-surface px-3 py-1 text-left font-medium text-fg-2 whitespace-nowrap">{t(`conditions.disease.name.${disease.key}`)}</th>
                  {disease.days.map((x) => (
                    <td key={x.date} className="px-0.5 py-1 min-w-6">
                      <Cell level={x.value} title={`${fmt.date(x.date)}: ${t(`conditions.disease.level.${x.value}`)}`} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="px-3 py-2 text-xs text-muted">{t('conditions.disease.source')}</p>
        </div>
      )}
    </Card>
  )
}
