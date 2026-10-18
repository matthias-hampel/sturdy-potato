import type { Farm, WeatherDay, WeatherForecast } from '@agmeo/contracts'
import { createFileRoute } from '@tanstack/react-router'
import { CloudRain, Droplets, Info, MapPin, SprayCan, Thermometer, Wind } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ColumnChart, type ColumnDatum } from '#/components/charts'
import { type RangeDatum, TemperatureRangeChart } from '#/components/insights/TemperatureRangeChart'
import { localClock, localDate, noticeKind, noticeMessage, weatherCode } from '#/components/insights/weather'
import { ApiRequestError } from '#/lib/api'
import { fmt } from '#/lib/format'
import { useOrg } from '#/lib/org'
import { useOrgQuery } from '#/lib/queries'
import { Link } from '#/ui/Button'
import { Option, Select } from '#/ui/Field'
import { Card, EmptyState, ErrorNotice, Loading, Notice, PageHeader } from '#/ui/Layout'
import { Cell, Column, Row, Table, TableBody, TableHeader } from '#/ui/Table'

export const Route = createFileRoute('/o/$orgId/weather')({ component: WeatherPage })

function WeatherPage() {
  const { t } = useTranslation()
  const { orgId } = useOrg()
  const farms = useOrgQuery<Farm[]>('/farms')
  const [farmId, setFarmId] = useState<string | null>(null)
  const activeFarms = (farms.data ?? []).filter((f) => !f.archivedAt)
  const farm = activeFarms.find((f) => f.id === farmId) ?? activeFarms[0] ?? null

  const weather = useOrgQuery<WeatherForecast>(farm ? `/farms/${farm.id}/weather` : null, undefined, { staleTime: 10 * 60_000 })

  const header = (
    <PageHeader
      title={t('weather.title')}
      subtitle={farm ? <span className="inline-flex items-center gap-1.5"><MapPin className="size-3.5" aria-hidden />{farm.name}{weather.data && ` · ${weather.data.location.lat.toFixed(3)}, ${weather.data.location.lng.toFixed(3)}`}</span> : t('weather.subtitle')}
      actions={
        activeFarms.length > 1 && (
          <Select aria-label={t('weather.farm')} className="w-56" items={activeFarms} value={farm?.id ?? null} onChange={(v) => v != null && setFarmId(String(v))}>
            {(f) => <Option id={f.id}>{f.name}</Option>}
          </Select>
        )
      }
    />
  )

  if (farms.isLoading) return <>{header}<Loading /></>
  if (farms.error) return <>{header}<ErrorNotice error={farms.error} /></>
  if (!farm) {
    return (
      <>
        {header}
        <Card>
          <EmptyState icon={MapPin} title={t('weather.noFarm.title')} action={<Link to="/o/$orgId/settings" params={{ orgId }} variant="primary">{t('weather.noFarm.action')}</Link>}>
            {t('weather.noFarm.body')}
          </EmptyState>
        </Card>
      </>
    )
  }

  return (
    <>
      {header}
      {weather.isLoading ? (
        <Loading label={t('weather.loading')} />
      ) : weather.error instanceof ApiRequestError && weather.error.code === 'farm_without_location' ? (
        <Card>
          <EmptyState
            icon={MapPin}
            title={t('weather.noLocation.title', { farm: farm.name })}
            action={<Link to="/o/$orgId/settings" params={{ orgId }} variant="primary">{t('weather.noLocation.action')}</Link>}
          >
            {t('weather.noLocation.body')}
          </EmptyState>
        </Card>
      ) : weather.error ? (
        <ErrorNotice error={weather.error} />
      ) : weather.data ? (
        <WeatherView w={weather.data} />
      ) : null}
    </>
  )
}

function WeatherView({ w }: { w: WeatherForecast }) {
  const { t } = useTranslation()
  const today = w.daily[0]
  return (
    <div className="space-y-6">
      <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] gap-6">
        <CurrentConditions w={w} today={today} />
        <SprayWindows w={w} />
      </div>

      <Notices w={w} />

      <ForecastTable days={w.daily} />

      <div className="grid lg:grid-cols-2 gap-6">
        <TemperatureCard w={w} />
        <PrecipitationCard w={w} />
      </div>

      <p className="text-xs text-muted">
        <a href={w.providerUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline underline-offset-2">
          {t('weather.attribution')}
        </a>{' '}
        · {t('weather.footer', { updated: fmt.dateTime(w.fetchedAt), timezone: w.timezone })}
      </p>
    </div>
  )
}

function CurrentConditions({ w, today }: { w: WeatherForecast; today: WeatherDay | undefined }) {
  const { t } = useTranslation()
  const c = w.current
  const code = weatherCode(c?.weatherCode ?? today?.weatherCode)
  const Icon = code.icon
  return (
    <Card title={t('weather.current.title')} description={c ? t('weather.current.asOf', { time: localClock(c.time) }) : undefined}>
      {c ? (
        <div className="space-y-4">
          <div className="flex items-center gap-4">
            <span className="size-14 rounded-2xl bg-primary-soft text-primary flex items-center justify-center shrink-0">
              <Icon className="size-7" aria-hidden />
            </span>
            <div>
              <div className="text-4xl font-semibold tabular text-fg leading-none">{fmt.num(c.tempC, 1)}°C</div>
              <div className="text-sm text-fg-2 mt-1">
                {code.label}
                {today && <span className="text-muted"> · {t('weather.current.today', { min: fmt.num(today.tempMinC), max: fmt.num(today.tempMaxC) })}</span>}
              </div>
            </div>
          </div>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <Metric icon={Droplets} label={t('weather.current.humidity')} value={fmt.pct(c.humidityPct)} />
            <Metric icon={Wind} label={t('weather.current.wind')} value={`${fmt.num(c.windKmh)} km/h`} />
            <Metric icon={CloudRain} label={t('weather.current.precipitationNow')} value={`${fmt.fixed(c.precipitationMm, 1)} mm`} />
            <Metric icon={CloudRain} label={t('weather.current.last7Days')} value={`${fmt.fixed(w.precipitationLast7dMm, 1)} mm`} />
          </dl>
        </div>
      ) : (
        <p className="text-sm text-muted">{t('weather.current.unavailable')}</p>
      )}
    </Card>
  )
}

function Metric({ icon: Icon, label, value }: { icon: typeof Wind; label: string; value: string }) {
  return (
    <div className="rounded-lg bg-surface-2 px-3 py-2 min-w-0">
      <dt className="text-xs text-muted flex items-center gap-1.5">
        <Icon className="size-3.5" aria-hidden />
        {label}
      </dt>
      <dd className="font-medium text-fg tabular mt-0.5">{value}</dd>
    </div>
  )
}

function SprayWindows({ w }: { w: WeatherForecast }) {
  const { t } = useTranslation()
  return (
    <Card title={t('weather.spray.title')} description={t('weather.spray.description')}>
      <div className="flex flex-col gap-6">
        {w.sprayWindows.length === 0 ? (
          <p className="text-sm text-muted">{t('weather.spray.empty')}</p>
        ) : (
          <ul className="divide-y divide-line -my-1">
            {w.sprayWindows.map((s) => {
              const sameDay = localDate(s.start) === localDate(s.end) || localClock(s.end) === '00:00'
              return (
                <li key={s.start} className="py-2 flex items-center gap-3 text-sm">
                  <SprayCan className="size-4 text-muted shrink-0" aria-hidden />
                  <span className="flex-1 min-w-0 text-fg">
                    <span className="font-medium">{fmt.weekday(localDate(s.start))} {fmt.shortDate(localDate(s.start))}</span>
                    <span className="text-fg-2 tabular">
                      {' '}
                      {localClock(s.start)}–{sameDay ? localClock(s.end) : `${fmt.weekday(localDate(s.end))} ${localClock(s.end)}`}
                    </span>
                  </span>
                  <span className="tabular text-fg-2 whitespace-nowrap">{fmt.num(s.hours)} h</span>
                </li>
              )
            })}
          </ul>
        )}
        <Notice tone="info" icon={Info}>
          {t('weather.spray.disclaimer')}
        </Notice>
      </div>
    </Card>
  )
}

function Notices({ w }: { w: WeatherForecast }) {
  const { t } = useTranslation()
  if (!w.notices.length) {
    return <p className="text-sm text-muted">{t('weather.notices.empty')}</p>
  }
  return (
    <section aria-label={t('weather.notices.ariaLabel')} className="grid gap-3">
      {w.notices.map((n, i) => {
        const kind = noticeKind(n.kind)
        return (
          <Notice key={`${n.kind}-${n.date}-${i}`} tone={n.severity === 'warning' ? 'warning' : 'info'} icon={kind.icon}>
            <strong className="font-semibold">{kind.label}</strong>
            <span className="text-muted"> · {fmt.weekday(n.date)} {fmt.shortDate(n.date)}</span>
            <div>{noticeMessage(n, w)}</div>
          </Notice>
        )
      })}
    </section>
  )
}

function ForecastTable({ days }: { days: WeatherDay[] }) {
  const { t } = useTranslation()
  const sum = (k: 'precipitationMm' | 'et0Mm') => days.reduce((s, d) => s + (d[k] ?? 0), 0)
  return (
    <Card
      title={t('weather.forecastTable.title', { count: days.length })}
      description={t('weather.forecastTable.description', { precipitation: fmt.fixed(sum('precipitationMm'), 1), et0: fmt.fixed(sum('et0Mm'), 1) })}
      padded={false}
    >
      <Table aria-label={t('weather.forecastTable.ariaLabel')}>
        <TableHeader>
          <Column isRowHeader>{t('weather.forecastTable.day')}</Column>
          <Column>{t('weather.forecastTable.conditions')}</Column>
          <Column align="end">{t('weather.forecastTable.minMax')}</Column>
          <Column align="end">{t('weather.forecastTable.precipitation')}</Column>
          <Column align="end">{t('weather.forecastTable.probability')}</Column>
          <Column align="end">{t('weather.forecastTable.windGust')}</Column>
          <Column align="end">ET0</Column>
          <Column align="end">{t('weather.forecastTable.gdd')}</Column>
        </TableHeader>
        <TableBody items={days}>
          {(d) => {
            const code = weatherCode(d.weatherCode)
            const Icon = code.icon
            return (
              <Row id={d.date}>
                <Cell>
                  <span className="font-medium">{fmt.weekday(d.date)}</span> <span className="text-muted tabular">{fmt.shortDate(d.date)}</span>
                </Cell>
                <Cell>
                  <span className="inline-flex items-center gap-1.5 text-fg-2 whitespace-nowrap">
                    <Icon className="size-4 text-muted" aria-hidden />
                    {code.label}
                  </span>
                </Cell>
                <Cell align="end">
                  {fmt.num(d.tempMinC)}° / <span className="font-medium">{fmt.num(d.tempMaxC)}°</span>
                </Cell>
                <Cell align="end">{fmt.fixed(d.precipitationMm, 1)} mm</Cell>
                <Cell align="end">{fmt.pct(d.precipitationProbabilityPct)}</Cell>
                <Cell align="end">
                  {fmt.num(d.windMaxKmh)} / {fmt.num(d.gustMaxKmh)} km/h
                </Cell>
                <Cell align="end">{fmt.fixed(d.et0Mm, 1)} mm</Cell>
                <Cell align="end">{fmt.fixed(d.gdd, 1)}</Cell>
              </Row>
            )
          }}
        </TableBody>
      </Table>
      <p className="px-4 py-2.5 text-xs text-muted">{t('weather.forecastTable.footnote')}</p>
    </Card>
  )
}

function dayLabel(date: string) {
  return fmt.shortDate(date)
}

function TemperatureCard({ w }: { w: WeatherForecast }) {
  const { t } = useTranslation()
  const days = [...w.past.map((d) => ({ d, observed: true })), ...w.daily.map((d) => ({ d, observed: false }))]
  const data: RangeDatum[] = days.map(({ d, observed }) => ({
    key: d.date,
    label: dayLabel(d.date),
    min: d.tempMinC,
    max: d.tempMaxC,
    tooltip: (
      <>
        <div className="text-muted mb-0.5">{observed ? t('weather.observed') : t('weather.forecast')} · {fmt.weekday(d.date)}</div>
        <div className="flex justify-between gap-3 text-fg-2">{t('weather.max')} <span className="font-medium text-fg tabular">{fmt.fixed(d.tempMaxC, 1)} °C</span></div>
        <div className="flex justify-between gap-3 text-fg-2">{t('weather.min')} <span className="font-medium text-fg tabular">{fmt.fixed(d.tempMinC, 1)} °C</span></div>
      </>
    ),
  }))
  return (
    <Card title={t('weather.temperature.title')} description={t('weather.temperature.description')}>
      <TemperatureRangeChart data={data} format={(v) => `${fmt.num(v)}°`} divideAt={w.past.length} ariaLabel={t('weather.temperature.ariaLabel')} />
      <p className="text-xs text-muted mt-2 flex items-center gap-1.5">
        <Thermometer className="size-3.5" aria-hidden />
        {t('weather.temperature.note')}
      </p>
    </Card>
  )
}

function PrecipitationCard({ w }: { w: WeatherForecast }) {
  const { t } = useTranslation()
  const days = [...w.past.map((d) => ({ d, observed: true })), ...w.daily.map((d) => ({ d, observed: false }))]
  const data: ColumnDatum[] = days.map(({ d, observed }) => ({
    key: d.date,
    label: dayLabel(d.date),
    values: [d.precipitationMm],
    tooltip: (
      <>
        <div className="text-muted mb-0.5">{observed ? t('weather.observed') : t('weather.forecast')} · {fmt.weekday(d.date)}</div>
        <div className="flex justify-between gap-3 text-fg-2">
          {t('weather.precipitation.label')} <span className="font-medium text-fg tabular">{fmt.fixed(d.precipitationMm, 1)} mm</span>
        </div>
        {!observed && (
          <div className="flex justify-between gap-3 text-fg-2">
            {t('weather.precipitation.probability')} <span className="font-medium text-fg tabular">{fmt.pct(d.precipitationProbabilityPct)}</span>
          </div>
        )}
      </>
    ),
  }))
  const first = w.past[0]?.date
  const lastPast = w.past[w.past.length - 1]?.date
  const firstForecast = w.daily[0]?.date
  const lastForecast = w.daily[w.daily.length - 1]?.date
  return (
    <Card
      title={t('weather.precipitation.title')}
      description={t('weather.precipitation.description', { value: fmt.fixed(w.precipitationLast7dMm, 1) })}
    >
      <ColumnChart data={data} series={[{ name: t('weather.precipitation.label'), color: 'var(--color-primary)' }]} format={(v) => `${fmt.num(v, 1)}`} ariaLabel={t('weather.precipitation.ariaLabel')} />
      <p className="text-xs text-muted mt-2 flex items-center gap-1.5">
        <CloudRain className="size-3.5" aria-hidden />
        {first && lastPast ? t('weather.precipitation.observedRange', { from: fmt.shortDate(first), to: fmt.shortDate(lastPast) }) : t('weather.observed')} ·{' '}
        {firstForecast && lastForecast
          ? t('weather.precipitation.forecastRange', { from: fmt.shortDate(firstForecast), to: fmt.shortDate(lastForecast) })
          : t('weather.precipitation.forecastShort')}{' '}
        · {t('weather.precipitation.hoverHint')}
      </p>
    </Card>
  )
}
