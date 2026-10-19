import type { CalendarDateSource, CalendarOperation, CalendarRow, CropCalendar } from '@agmeo/contracts'
import { Link as RouterLink, createFileRoute } from '@tanstack/react-router'
import { CalendarRange, Plus, Sprout } from 'lucide-react'
import { type CSSProperties, useMemo, useState } from 'react'
import { MultiYearCalendar } from '#/components/calendar/MultiYearCalendar'
import { useTranslation } from 'react-i18next'
import { CropRoleBadge, CropTag, OPERATION_ICONS } from '#/components/labels'
import { LOCALE } from '#/i18n'
import { operationTypeLabel } from '#/i18n/labels'
import { fmt, today } from '#/lib/format'
import { useOrg, useSeason } from '#/lib/org'
import { useOrgQuery } from '#/lib/queries'
import { Link, SegmentedControl } from '#/ui/Button'
import { Card, EmptyState, ErrorNotice, Loading, PageHeader } from '#/ui/Layout'
import { cx, focusRing } from '#/ui/utils'

export const Route = createFileRoute('/o/$orgId/calendar')({ component: CalendarPage })

/** Multi-year crop plan (edit) or one season in detail with its operations. */
function CalendarPage() {
  const { t } = useTranslation()
  const [view, setView] = useState<'years' | 'season'>('years')
  return view === 'years' ? (
    <>
      <PageHeader title={t('calendar.title')} subtitle={t('calendarPlan.subtitle')} actions={<CalendarViewSwitch value={view} onChange={setView} />} />
      <MultiYearCalendar />
    </>
  ) : (
    <CropCalendarPage switcher={<CalendarViewSwitch value={view} onChange={setView} />} />
  )
}

function CalendarViewSwitch({ value, onChange }: { value: 'years' | 'season'; onChange: (v: 'years' | 'season') => void }) {
  const { t } = useTranslation()
  return <SegmentedControl aria-label={t('calendarPlan.view')} value={value} onChange={onChange} items={[{ id: 'years', label: t('calendarPlan.viewYears') }, { id: 'season', label: t('calendarPlan.viewSeason') }]} />
}

/** Label column and timeline share one grid template so rows, header and overlay line up. */
const GRID = 'grid grid-cols-[9rem_1fr] sm:grid-cols-[14rem_1fr]'
/** Minimum width of a month column before the card scrolls sideways. */
const MONTH_REM = 4

const DAY_MS = 86_400_000
const dayIndex = (from: string, iso: string) => Math.round((Date.parse(`${iso}T12:00:00`) - Date.parse(`${from}T12:00:00`)) / DAY_MS)

function nextMonth(iso: string) {
  const d = new Date(`${iso.slice(0, 7)}-15T12:00:00`)
  d.setMonth(d.getMonth() + 1)
  return `${d.toLocaleDateString('sv-SE').slice(0, 7)}-01`
}

// Least certain first: a bar is only as firm as its weaker end.
const CERTAINTY: Record<CalendarDateSource, number> = { default: 0, planned: 1, recorded: 2 }

function barStyle(color: string, source: CalendarDateSource): CSSProperties {
  if (source === 'recorded') return { background: color, borderColor: color }
  if (source === 'planned') return { background: `color-mix(in srgb, ${color} 50%, transparent)`, borderColor: color }
  return { background: `color-mix(in srgb, ${color} 15%, transparent)`, borderColor: color, borderStyle: 'dashed' }
}

function CropCalendarPage({ switcher }: { switcher: React.ReactNode }) {
  const { t } = useTranslation()
  const { orgId } = useOrg()
  const { season, seasonId, isLoading } = useSeason()
  const calendar = useOrgQuery<CropCalendar>('/crop-calendar', { seasonId }, { enabled: !!seasonId })

  if (isLoading || (seasonId && calendar.isLoading)) return <Loading />

  return (
    <>
      <PageHeader
        title={t('calendar.title')}
        subtitle={season ? `${season.harvestYear} · ${fmt.date(season.startDate)} – ${fmt.date(season.endDate)}` : t('calendar.subtitle')}
        actions={
          <>
            {switcher}
            <Link to="/o/$orgId/templates" params={{ orgId }} variant="secondary">
              {t('nav.templates')}
            </Link>
          </>
        }
      />
      {!season ? (
        <Card>
          <EmptyState icon={CalendarRange} title={t('calendar.noSeason.title')} action={<Link to="/o/$orgId/crops" params={{ orgId }} variant="primary"><Plus /> {t('nav.setUpSeason')}</Link>}>
            {t('calendar.noSeason.description')}
          </EmptyState>
        </Card>
      ) : calendar.error ? (
        <ErrorNotice error={calendar.error} />
      ) : !calendar.data?.rows.length ? (
        <Card>
          <EmptyState icon={Sprout} title={t('calendar.empty.title')} action={<Link to="/o/$orgId/crops" params={{ orgId }} variant="primary">{t('nav.crops')}</Link>}>
            {t('calendar.empty.description', { season: season.name })}
          </EmptyState>
        </Card>
      ) : (
        <Timeline calendar={calendar.data} />
      )}
    </>
  )
}

function Timeline({ calendar }: { calendar: CropCalendar }) {
  const { t } = useTranslation()
  const { from, to, rows } = calendar
  const days = dayIndex(from, to) + 1
  const pct = (index: number) => `${(Math.min(Math.max(index, 0), days) / days) * 100}%`
  const months = useMemo(() => {
    const list: { key: string; start: number; end: number; label: string; year: string | null }[] = []
    for (let m = `${from.slice(0, 7)}-01`; m <= to; m = nextMonth(m)) {
      list.push({
        key: m,
        start: Math.max(dayIndex(from, m), 0),
        end: Math.min(dayIndex(from, nextMonth(m)), days),
        label: new Date(`${m}T12:00:00`).toLocaleDateString(LOCALE, { month: 'short' }),
        year: list.length === 0 || m.slice(5, 7) === '01' ? m.slice(0, 4) : null,
      })
    }
    return list
  }, [from, to, days])
  const now = today()
  const todayIndex = now >= from && now <= to ? dayIndex(from, now) : null

  return (
    <Card padded={false} title={t('calendar.card.title')} description={t('calendar.card.description', { count: rows.length })}>
      <div className="overflow-x-auto">
        <div className="relative" style={{ minWidth: `${months.length * MONTH_REM + 14}rem` }}>
          {/* Month grid and today line behind the rows. */}
          <div className={cx(GRID, 'absolute inset-0 pointer-events-none')} aria-hidden>
            <div />
            <div className="relative">
              {months.map((m) => (
                <div key={m.key} className={cx('absolute inset-y-0 border-l border-line/70', m.year && m.start > 0 && 'border-line-strong')} style={{ left: pct(m.start) }} />
              ))}
              {todayIndex != null && <div className="absolute inset-y-0 w-px bg-danger z-[5]" style={{ left: pct(todayIndex + 0.5) }} />}
            </div>
          </div>

          <div className={cx(GRID, 'relative border-b border-line text-xs text-muted')}>
            <div className="sticky left-0 z-10 bg-surface px-4 py-2 font-medium">{t('calendar.column.cultivation')}</div>
            <div className="relative h-9">
              {months.map((m) => (
                <div key={m.key} className="absolute inset-y-0 px-1.5 py-1 overflow-hidden whitespace-nowrap leading-tight" style={{ left: pct(m.start), width: `calc(${pct(m.end)} - ${pct(m.start)})` }}>
                  <div className="font-medium text-fg-2">{m.label}</div>
                  {m.year && <div className="text-[10px]">{m.year}</div>}
                </div>
              ))}
              {todayIndex != null && (
                <span className="absolute bottom-0.5 -translate-x-1/2 rounded bg-danger px-1 text-[10px] font-medium text-white z-[6]" style={{ left: pct(todayIndex + 0.5) }}>
                  {t('calendar.today')}
                </span>
              )}
            </div>
          </div>

          <ul>
            {rows.map((row, i) => (
              <CalendarRowView key={row.cropCycleId} row={row} from={from} pct={pct} firstOfField={i === 0 || rows[i - 1].fieldId !== row.fieldId} />
            ))}
          </ul>
        </div>
      </div>
      <Legend />
    </Card>
  )
}

function CalendarRowView({ row, from, pct, firstOfField }: { row: CalendarRow; from: string; pct: (index: number) => string; firstOfField: boolean }) {
  const { t } = useTranslation()
  const { orgId } = useOrg()
  const source = (s: CalendarDateSource) => t(`calendar.source.${s}`)
  const sowing = row.sowing ? `${t('calendar.sowing')}: ${fmt.date(row.sowing.date)} (${source(row.sowing.source)})` : null
  const harvest = row.harvest ? `${t('calendar.harvest')}: ${fmt.date(row.harvest.date)} (${source(row.harvest.source)})` : null
  const describe = [row.cropName, sowing, harvest].filter(Boolean).join(' · ')
  return (
    <li className={cx(GRID, 'relative', firstOfField ? 'border-t border-line first:border-t-0' : 'border-t border-line/40')}>
      <div className="sticky left-0 z-10 bg-surface px-4 py-1.5 min-w-0">
        <div className="text-sm truncate">
          {firstOfField ? (
            <RouterLink to="/o/$orgId/fields/$fieldId" params={{ orgId, fieldId: row.fieldId }} className={cx('font-medium text-fg hover:text-primary rounded-sm', focusRing)}>
              {row.fieldName}
            </RouterLink>
          ) : (
            <span className="text-muted">{row.fieldName}</span>
          )}
          {row.fieldPartName && <span className="text-muted"> · {row.fieldPartName}</span>}
        </div>
        <div className="flex items-center gap-1.5 min-w-0 [&>span:first-child]:truncate">
          <CropTag name={row.cropName} color={row.cropColor} />
          <CropRoleBadge role={row.role} />
        </div>
      </div>
      <div className="relative min-h-12">
        {row.sowing && row.harvest ? (
          <div
            role="img"
            aria-label={describe}
            title={describe}
            className="absolute top-1/2 -translate-y-1/2 h-4 rounded-full border"
            style={{
              left: pct(dayIndex(from, row.sowing.date)),
              width: `max(0.5rem, calc(${pct(dayIndex(from, row.harvest.date) + 1)} - ${pct(dayIndex(from, row.sowing.date))}))`,
              ...barStyle(row.cropColor, CERTAINTY[row.sowing.source] <= CERTAINTY[row.harvest.source] ? row.sowing.source : row.harvest.source),
            }}
          />
        ) : (
          // Only one end known: mark that day instead of guessing a span.
          (row.sowing ?? row.harvest) && (
            <div
              role="img"
              aria-label={describe}
              title={describe}
              className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 size-3 rotate-45 border"
              style={{ left: pct(dayIndex(from, (row.sowing ?? row.harvest)!.date) + 0.5), ...barStyle(row.cropColor, (row.sowing ?? row.harvest)!.source) }}
            />
          )
        )}
        {row.operations.map((o) => (
          <OperationMarker key={o.id} operation={o} left={pct(dayIndex(from, o.date) + 0.5)} />
        ))}
      </div>
    </li>
  )
}

function OperationMarker({ operation: o, left }: { operation: CalendarOperation; left: string }) {
  const { t } = useTranslation()
  const { orgId } = useOrg()
  const Icon = OPERATION_ICONS[o.type]
  const done = o.status === 'completed'
  const label = [o.title, operationTypeLabel(o.type), fmt.date(o.date), t(`enum.operationStatus.${o.status}`)].join(' · ')
  return (
    <RouterLink
      to="/o/$orgId/operations/$operationId"
      params={{ orgId, operationId: o.id }}
      aria-label={label}
      title={label}
      className={cx(
        'absolute top-1/2 -translate-x-1/2 -translate-y-1/2 z-[6] size-4.5 rounded-full flex items-center justify-center ring-2 ring-surface hover:scale-125 transition-transform',
        done ? 'bg-fg-2 text-surface' : 'bg-surface text-fg-2 border border-fg-2',
        focusRing,
      )}
      style={{ left }}
    >
      <Icon className="size-2.5" aria-hidden />
    </RouterLink>
  )
}

function Legend() {
  const { t } = useTranslation()
  const swatch = 'var(--color-primary)'
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3 border-t border-line text-xs text-muted">
      {(['recorded', 'planned', 'default'] as const).map((s) => (
        <span key={s} className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-6 rounded-full border" style={barStyle(swatch, s)} aria-hidden />
          {t(`calendar.legend.${s}`)}
        </span>
      ))}
      <span className="inline-flex items-center gap-1.5">
        <span className="size-3 rounded-full bg-fg-2" aria-hidden />
        {t('calendar.legend.completed')}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="size-3 rounded-full border border-fg-2 bg-surface" aria-hidden />
        {t('calendar.legend.planned_operation')}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-3 w-px bg-danger" aria-hidden />
        {t('calendar.today')}
      </span>
    </div>
  )
}
