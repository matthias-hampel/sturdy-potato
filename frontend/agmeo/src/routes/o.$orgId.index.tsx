import type { Dashboard, Field, WeatherForecast, Farm } from '@agmeo/contracts'
import { createFileRoute } from '@tanstack/react-router'
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Circle,
  ClipboardList,
  CloudRain,
  Map as MapIcon,
  Package,
  ShieldCheck,
  Sprout,
  Thermometer,
  Wind,
  Wrench,
} from 'lucide-react'
import { Trans, useTranslation } from 'react-i18next'
import { BarList } from '#/components/charts'
import { noticeMessage } from '#/components/insights/weather'
import { OperationTypeLabel, TaskStatusBadge } from '#/components/labels'
import { FieldMap } from '#/components/map/FieldMap'
import { farmView } from '#/components/map/useMap'
import { errorMessage } from '#/lib/api'
import { fmt } from '#/lib/format'
import { useOrg, useSeason } from '#/lib/org'
import { useOrgQuery } from '#/lib/queries'
import { Link } from '#/ui/Button'
import { Card, EmptyState, ErrorNotice, Loading, Notice, PageHeader, Stat } from '#/ui/Layout'
import { cx } from '#/ui/utils'

export const Route = createFileRoute('/o/$orgId/')({ component: Overview })

function Overview() {
  const { t } = useTranslation()
  const { orgId, org } = useOrg()
  const { seasonId, season } = useSeason()
  const dashboard = useOrgQuery<Dashboard>('/dashboard', { seasonId })
  const fields = useOrgQuery<Field[]>('/fields', { seasonId })
  const farms = useOrgQuery<Farm[]>('/farms')

  if (dashboard.isLoading) return <Loading />
  if (dashboard.error) return <ErrorNotice error={dashboard.error} />
  const d = dashboard.data!
  const setupDone = d.setup.hasFarm && d.setup.hasFields && d.setup.hasSeason && d.setup.hasCropCycles

  return (
    <>
      <PageHeader eyebrow={org.name} title={t('dashboard.title')} subtitle={season ? t('dashboard.subtitleSeason', { season: season.name }) : t('dashboard.subtitle')} />

      {!setupDone && <SetupChecklist setup={d.setup} orgId={orgId} />}

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
        <Stat icon={MapIcon} label={t('dashboard.stat.fields')} value={fmt.num(d.fieldCount)} hint={fmt.ha(d.totalAreaHa, 1)} />
        <Stat icon={Sprout} label={t('dashboard.stat.planted')} value={fmt.ha(d.plantedAreaHa, 1)} hint={d.totalAreaHa ? t('dashboard.stat.plantedShare', { pct: fmt.num((d.plantedAreaHa / d.totalAreaHa) * 100) }) : undefined} />
        <Stat icon={ClipboardList} label={t('dashboard.stat.openTasks')} value={fmt.num(d.openTaskCount)} hint={d.overdueTasks.length ? t('dashboard.stat.overdue', { count: d.overdueTasks.length }) : t('dashboard.stat.noneOverdue')} tone={d.overdueTasks.length ? 'warning' : 'default'} />
        <Stat
          icon={ShieldCheck}
          label={t('dashboard.stat.recordIssues')}
          value={fmt.num(d.complianceIssueCount)}
          hint={d.complianceIssueCount ? t('dashboard.stat.missingDocs') : t('dashboard.stat.recordsComplete')}
          tone={d.complianceIssueCount ? 'warning' : 'success'}
        />
      </div>

      <div className="grid xl:grid-cols-[1.6fr_1fr] gap-6">
        <div className="space-y-6 min-w-0">
          <Card title={t('dashboard.fields')} padded={false} actions={<Link to="/o/$orgId/fields" params={{ orgId }} className="text-sm">{t('dashboard.openMap')}</Link>}>
            {fields.data && fields.data.length > 0 ? (
              <FieldMap fields={fields.data} view={farmView(farms.data?.[0])} className="h-80 rounded-none rounded-b-xl border-0" />
            ) : (
              <EmptyState icon={MapIcon} title={t('dashboard.noFields')} action={<Link to="/o/$orgId/fields/new" params={{ orgId }} variant="primary">{t('dashboard.addFields')}</Link>} />
            )}
          </Card>

          <div className="grid md:grid-cols-2 gap-6">
            <Card title={t('dashboard.upcoming')} description={t('dashboard.next14Days')}>
              <OperationList items={[...d.overdueOperations.map((o) => ({ ...o, overdue: true })), ...d.upcomingOperations]} orgId={orgId} />
            </Card>
            <Card title={t('dashboard.overdueTasks')} actions={<Link to="/o/$orgId/tasks" params={{ orgId }} className="text-sm">{t('dashboard.allTasks')}</Link>}>
              {d.overdueTasks.length === 0 ? (
                <p className="text-sm text-muted flex items-center gap-2"><CheckCircle2 className="size-4 text-success" /> {t('dashboard.nothingOverdue')}</p>
              ) : (
                <ul className="divide-y divide-line -my-2">
                  {d.overdueTasks.map((task) => (
                    <li key={task.id} className="py-2.5 flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-fg truncate">{task.title}</div>
                        <div className="text-xs text-muted mt-0.5">
                          {task.field?.name ?? task.farmName} · {t('dashboard.due', { when: fmt.relativeDays(task.dueOn) })}
                          {task.assignee && ` · ${task.assignee.name}`}
                        </div>
                      </div>
                      <TaskStatusBadge status={task.status} overdue={task.overdue} />
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </div>

        <div className="space-y-6 min-w-0">
          {farms.data?.[0] && <WeatherCard farm={farms.data[0]} />}
          <Card title={t('dashboard.crops')} description={season?.name}>
            {d.cropsByArea.length === 0 ? (
              <p className="text-sm text-muted">{t('dashboard.noCrops')}</p>
            ) : (
              <BarList
                items={d.cropsByArea.map((c) => ({ key: c.cropId, label: c.cropName, swatch: c.color, value: c.areaHa }))}
                format={(v) => fmt.ha(v, 1)}
              />
            )}
          </Card>
          {(d.lowStock.length > 0 || d.maintenanceDue.length > 0) && (
            <Card title={t('dashboard.resources')}>
              <ul className="space-y-2.5 text-sm">
                {d.lowStock.map((p) => (
                  <li key={p.productId} className="flex items-start gap-2.5">
                    <Package className="size-4 text-warning mt-0.5 shrink-0" aria-hidden />
                    <span>
                      <Trans i18nKey="dashboard.lowStock" values={{ name: p.name, stock: fmt.qty(p.stock, p.baseUnit), threshold: fmt.qty(p.threshold, p.baseUnit) }} components={{ b: <strong className="font-medium" /> }} />
                    </span>
                  </li>
                ))}
                {d.maintenanceDue.map((m) => (
                  <li key={m.equipmentId} className="flex items-start gap-2.5">
                    <Wrench className="size-4 text-warning mt-0.5 shrink-0" aria-hidden />
                    <span>
                      <Link to="/o/$orgId/machinery/$equipmentId" params={{ orgId, equipmentId: m.equipmentId }}>{m.name}</Link> {t('dashboard.serviceDue')}
                      {m.dueOn && ` ${fmt.relativeDays(m.dueOn)}`}
                      {m.dueHours != null && ` / ${t('dashboard.atHours', { hours: fmt.num(m.dueHours) })}`}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </>
  )
}

function SetupChecklist({ setup, orgId }: { setup: Dashboard['setup']; orgId: string }) {
  const { t } = useTranslation()
  const steps = [
    { done: setup.hasFarm, label: t('dashboard.setup.farm'), link: <Link to="/o/$orgId/settings" params={{ orgId }}>{t('nav.settings')}</Link> },
    { done: setup.hasFields, label: t('dashboard.setup.fields'), link: <Link to="/o/$orgId/fields/new" params={{ orgId }}>{t('dashboard.addFields')}</Link> },
    { done: setup.hasSeason, label: t('dashboard.setup.season'), link: <Link to="/o/$orgId/crops" params={{ orgId }}>{t('nav.crops')}</Link> },
    { done: setup.hasCropCycles, label: t('dashboard.setup.crops'), link: <Link to="/o/$orgId/crops" params={{ orgId }}>{t('nav.crops')}</Link> },
  ]
  return (
    <Card title={t('dashboard.setup.title')} className="mb-6">
      <ol className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {steps.map((s) => (
          <li key={s.label} className={cx('rounded-lg border p-3 text-sm flex gap-2.5', s.done ? 'border-success/30 bg-success-soft/50' : 'border-line')}>
            {s.done ? <CheckCircle2 className="size-5 text-success shrink-0" /> : <Circle className="size-5 text-muted shrink-0" />}
            <div>
              <div className={cx('font-medium', s.done && 'text-muted line-through')}>{s.label}</div>
              {!s.done && <div className="mt-1">{s.link}</div>}
            </div>
          </li>
        ))}
      </ol>
    </Card>
  )
}

function OperationList({ items, orgId }: { items: (Dashboard['upcomingOperations'][number] & { overdue?: boolean })[]; orgId: string }) {
  const { t } = useTranslation()
  if (!items.length) return <p className="text-sm text-muted">{t('dashboard.noUpcoming')}</p>
  return (
    <ul className="divide-y divide-line -my-2">
      {items.map((o) => (
        <li key={o.id} className="py-2.5 flex items-center gap-3">
          <OperationTypeLabel type={o.type} iconOnly />
          <div className="min-w-0 flex-1">
            <Link to="/o/$orgId/operations/$operationId" params={{ orgId, operationId: o.id }} className="text-sm font-medium block truncate">
              {o.title}
            </Link>
            <div className="text-xs text-muted truncate">{o.fieldNames.join(', ')}</div>
          </div>
          <span className={cx('text-xs whitespace-nowrap flex items-center gap-1', o.overdue ? 'text-danger font-medium' : 'text-muted')}>
            {o.overdue ? <AlertTriangle className="size-3.5" /> : <CalendarClock className="size-3.5" />}
            {fmt.relativeDays(o.plannedOn)}
          </span>
        </li>
      ))}
    </ul>
  )
}

function WeatherCard({ farm }: { farm: Farm }) {
  const { t } = useTranslation()
  const { orgId } = useOrg()
  const weather = useOrgQuery<WeatherForecast>(`/farms/${farm.id}/weather`, undefined, { staleTime: 10 * 60_000 })
  return (
    <Card title={t('dashboard.weather', { farm: farm.name })} actions={<Link to="/o/$orgId/weather" params={{ orgId }} className="text-sm">{t('dashboard.forecast')}</Link>}>
      {weather.isLoading && <Loading />}
      {weather.error && <p className="text-sm text-muted">{t('dashboard.weatherUnavailable', { reason: errorMessage(weather.error) })}</p>}
      {weather.data && (
        <div className="space-y-3">
          <div className="flex items-center gap-5 text-sm">
            <span className="text-3xl font-semibold tabular">{fmt.num(weather.data.current?.tempC, 0)}°</span>
            <span className="space-y-0.5 text-fg-2">
              <span className="flex items-center gap-1.5"><Wind className="size-3.5 text-muted" /> {fmt.num(weather.data.current?.windKmh)} km/h</span>
              <span className="flex items-center gap-1.5"><CloudRain className="size-3.5 text-muted" /> {fmt.fixed(weather.data.precipitationLast7dMm, 1)} mm {t('dashboard.last7Days')}</span>
            </span>
          </div>
          <div className="grid grid-cols-5 gap-1 text-center text-xs">
            {weather.data.daily.slice(0, 5).map((day) => (
              <div key={day.date} className="rounded-lg bg-surface-2 py-2">
                <div className="text-muted">{fmt.weekday(day.date)}</div>
                <div className="font-medium tabular mt-1 flex items-center justify-center gap-0.5"><Thermometer className="size-3 text-muted" />{fmt.num(day.tempMaxC)}° / {fmt.num(day.tempMinC)}°</div>
                <div className="text-muted tabular mt-0.5">{fmt.fixed(day.precipitationMm, 1)} mm</div>
              </div>
            ))}
          </div>
          {weather.data.notices.slice(0, 2).map((n, i) => (
            <Notice key={i} tone={n.severity === 'warning' ? 'warning' : 'info'} icon={AlertTriangle}>
              {fmt.weekday(n.date)}: {noticeMessage(n, weather.data)}
            </Notice>
          ))}
          <p className="text-[11px] text-muted">{t('dashboard.forecastBy', { provider: weather.data.provider, updated: fmt.dateTime(weather.data.fetchedAt) })}</p>
        </div>
      )}
    </Card>
  )
}
