import {
  COST_CATEGORIES,
  type CostCategory,
  type CostEntry,
  type CostEntryInput,
  type CropCycle,
  type CropCycleEconomics,
  type CropPrice,
  type CropPricesInput,
  type EconomicsSummary,
  type FarmOverheads,
  type FarmOverheadsInput,
  type FarmResult,
  type Harvest,
  type HarvestInput,
  type RevenueBasis,
} from '@agmeo/contracts'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import {
  CalendarClock,
  CheckCircle2,
  CircleDashed,
  Coins,
  Factory,
  HandCoins,
  Info,
  Landmark,
  Leaf,
  Lock,
  Plus,
  Receipt,
  Scale,
  Sprout,
  Tag,
  Trash2,
  TrendingUp,
  Wheat,
  type LucideIcon,
} from 'lucide-react'
import { type FormEvent, type ReactNode, useMemo, useState } from 'react'
import { Form, type SortDescriptor } from 'react-aria-components'
import { Trans, useTranslation } from 'react-i18next'
import { z } from 'zod'
import { BarList, ColumnChart } from '#/components/charts'
import { CropTag } from '#/components/labels'
import { costCategoryLabel } from '#/i18n/labels'
import { api } from '#/lib/api'
import { fmt, today } from '#/lib/format'
import { useOrg, useSeason } from '#/lib/org'
import { useOrgMutation, useOrgQuery } from '#/lib/queries'
import { Button, Link, SegmentedControl } from '#/ui/Button'
import { DatePicker, NumberField, Option, Select, TextField, num } from '#/ui/Field'
import { Badge, type BadgeTone, Card, EmptyState, ErrorNotice, Loading, Notice, PageHeader, Stat, Tab, TabList, TabPanel, Tabs } from '#/ui/Layout'
import { ConfirmButton, Dialog, DialogTrigger } from '#/ui/Overlay'
import { Cell, Column, Row, Table, TableBody, TableHeader } from '#/ui/Table'
import { cx } from '#/ui/utils'
import { LOCALE } from '#/i18n'

const TABS = ['margins', 'result', 'carbon', 'prices'] as const
type EconomicsTab = (typeof TABS)[number]

export const Route = createFileRoute('/o/$orgId/economics')({
  validateSearch: z.object({ tab: z.enum(TABS).optional() }),
  component: EconomicsPage,
})

const BASIS: Record<RevenueBasis, { tone: BadgeTone; icon: LucideIcon }> = {
  actual: { tone: 'success', icon: CheckCircle2 },
  expected: { tone: 'info', icon: Scale },
  planned: { tone: 'neutral', icon: CalendarClock },
  none: { tone: 'neutral', icon: CircleDashed },
}

/** Translated label and description of a revenue basis (computed at render time). */
function basisText(t: (key: string) => string, basis: RevenueBasis): { label: string; description: string } {
  switch (basis) {
    case 'actual':
      return { label: t('economics.basis.actual'), description: t('economics.basis.actualDescription') }
    case 'expected':
      return { label: t('economics.basis.expected'), description: t('economics.basis.expectedDescription') }
    case 'planned':
      return { label: t('economics.basis.planned'), description: t('economics.basis.plannedDescription') }
    case 'none':
      return { label: t('economics.basis.none'), description: t('economics.basis.noneDescription') }
  }
}

function BasisBadge({ basis }: { basis: RevenueBasis }) {
  const { t } = useTranslation()
  const b = { ...BASIS[basis], ...basisText(t, basis) }
  const Icon = b.icon
  return (
    <Badge tone={b.tone}>
      <Icon className="size-3" aria-hidden />
      {b.label}
    </Badge>
  )
}

function useMoney(currency: string) {
  return useMemo(() => {
    const compact = new Intl.NumberFormat(LOCALE, { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1 })
    return {
      money: (v: number | null | undefined) => fmt.money(v, currency),
      compact: (v: number) => compact.format(v),
    }
  }, [currency])
}

function EconomicsPage() {
  const { t } = useTranslation()
  const { can, orgId } = useOrg()
  const { seasonId, season, isLoading: seasonLoading } = useSeason()

  if (!can('finance.read')) {
    return (
      <>
        <PageHeader title={t('economics.title')} />
        <Card>
          <EmptyState icon={Lock} title={t('economics.noAccess.title')}>
            {t('economics.noAccess.body')}
          </EmptyState>
        </Card>
      </>
    )
  }
  if (seasonLoading) return <Loading />
  if (!seasonId) {
    return (
      <>
        <PageHeader title={t('economics.title')} />
        <Card>
          <EmptyState icon={Sprout} title={t('economics.noSeason.title')} action={<Link to="/o/$orgId/crops" params={{ orgId }} variant="primary">{t('economics.noSeason.action')}</Link>}>
            {t('economics.noSeason.body')}
          </EmptyState>
        </Card>
      </>
    )
  }
  return <SeasonEconomics seasonId={seasonId} seasonName={season?.name ?? ''} harvestYear={season?.harvestYear ?? null} />
}

type Money = ReturnType<typeof useMoney>

function SeasonEconomics({ seasonId, seasonName, harvestYear }: { seasonId: string; seasonName: string; harvestYear: number | null }) {
  const { t } = useTranslation()
  const { org, orgId } = useOrg()
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const summary = useOrgQuery<EconomicsSummary | null>('/economics/summary', { seasonId })
  const s = summary.data
  const currency = s?.currency ?? org.currency
  const m = useMoney(currency)

  const header = <PageHeader title={t('economics.title')} subtitle={t('economics.subtitle', { season: s?.seasonName ?? seasonName })} />

  if (summary.isLoading) return <>{header}<Loading /></>
  if (summary.error) return <>{header}<ErrorNotice error={summary.error} /></>
  if (!s || s.cycles.length === 0) {
    return (
      <>
        {header}
        <Card>
          <EmptyState icon={Sprout} title={t('economics.noCycles.title')} action={<Link to="/o/$orgId/crops" params={{ orgId }} variant="primary">{t('economics.noCycles.action')}</Link>}>
            {seasonName ? t('economics.noCycles.body', { season: seasonName }) : t('economics.noCycles.bodyThisSeason')}
          </EmptyState>
        </Card>
        <div className="mt-6 space-y-6">
          <HarvestsCard seasonId={seasonId} currency={currency} />
          <OtherCostsCard seasonId={seasonId} currency={currency} />
        </div>
      </>
    )
  }

  return (
    <>
      {header}
      <Tabs
        selectedKey={search.tab ?? 'margins'}
        onSelectionChange={(key) => navigate({ search: (prev) => ({ ...prev, tab: key === 'margins' ? undefined : (key as EconomicsTab) }), replace: true })}
      >
        <TabList aria-label={t('economics.tabs.label')}>
          <Tab id="margins">{t('economics.tabs.margins')}</Tab>
          <Tab id="result">{t('economics.tabs.result')}</Tab>
          <Tab id="carbon">{t('economics.tabs.carbon')}</Tab>
          <Tab id="prices">{t('economics.tabs.prices')}</Tab>
        </TabList>
        <TabPanel id="margins">
          <MarginsTab summary={s} seasonId={seasonId} money={m} />
        </TabPanel>
        <TabPanel id="result">
          <FarmResultTab summary={s} seasonId={seasonId} money={m} />
        </TabPanel>
        <TabPanel id="carbon">
          <CarbonTab summary={s} />
        </TabPanel>
        <TabPanel id="prices">
          <PricesTab summary={s} seasonId={seasonId} harvestYear={harvestYear} />
        </TabPanel>
      </Tabs>
    </>
  )
}

// ---------------------------------------------------------------------------
// Contribution margins (Deckungsbeiträge)
// ---------------------------------------------------------------------------

/** Ist (recorded), Plan (expected yield and planned operations) or both side by side. */
type MarginView = 'actual' | 'planned' | 'compare'

/** The margin scheme from revenue down to DB II, either recorded or planned. */
interface Scheme {
  revenue: number
  directCosts: number
  dfl: number
  machineryCosts: number
  db1: number
  laborCosts: number
  db2: number
}
type SchemeKey = keyof Scheme

const SCHEME_KEYS: SchemeKey[] = ['revenue', 'directCosts', 'dfl', 'machineryCosts', 'db1', 'laborCosts', 'db2']
const SCHEME_LABELS: Record<SchemeKey, string> = {
  revenue: 'economics.columns.revenue',
  directCosts: 'economics.directCosts',
  dfl: 'economics.margins.dfl',
  machineryCosts: 'economics.margins.machineryCosts',
  db1: 'economics.margins.db1',
  laborCosts: 'economics.margins.laborCosts',
  db2: 'economics.margins.db2',
}
/** Margin lines are emphasised, cost lines are not. */
const MARGIN_LINES = new Set<SchemeKey>(['dfl', 'db1', 'db2'])

function actualScheme(c: CropCycleEconomics): Scheme {
  return { revenue: c.revenue, directCosts: c.directCosts, dfl: c.dfl, machineryCosts: c.machineryCosts, db1: c.db1, laborCosts: c.laborCosts, db2: c.db2 }
}

/** The plan carries revenue, the cost groups and DB II; DfL and DB I follow from them. */
function plannedScheme(c: CropCycleEconomics): Scheme | null {
  const p = c.planned
  if (!p) return null
  const dfl = p.revenue - p.directCosts
  return { revenue: p.revenue, directCosts: p.directCosts, dfl, machineryCosts: p.machineryCosts, db1: dfl - p.machineryCosts, laborCosts: p.laborCosts, db2: p.db2 }
}

function sumSchemes(list: Scheme[]): Scheme {
  const sum: Scheme = { revenue: 0, directCosts: 0, dfl: 0, machineryCosts: 0, db1: 0, laborCosts: 0, db2: 0 }
  for (const s of list) for (const k of SCHEME_KEYS) sum[k] += s[k]
  return sum
}

function MarginsTab({ summary: s, seasonId, money: m }: { summary: EconomicsSummary; seasonId: string; money: Money }) {
  const { t } = useTranslation()
  const [view, setView] = useState<MarginView>('actual')
  const totals = s.totals
  const currency = s.currency
  const revenueByBasis = s.cycles.reduce<Partial<Record<RevenueBasis, number>>>((acc, c) => {
    if (c.revenue) acc[c.revenueBasis] = (acc[c.revenueBasis] ?? 0) + c.revenue
    return acc
  }, {})
  const estimatedCosts = s.cycles.reduce((sum, c) => sum + c.estimatedCosts, 0)
  const db2 = s.cycles.reduce((sum, c) => sum + c.db2, 0)
  const byCrop = [...s.byCrop].sort((a, b) => b.db2PerHa - a.db2PerHa)
  const viewControl = <MarginViewControl value={view} onChange={setView} />

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-3 2xl:grid-cols-5 gap-4">
        <Stat icon={Sprout} label={t('economics.stats.croppedArea')} value={fmt.ha(totals.areaHa, 1)} hint={t('economics.stats.cycleCount', { count: s.cycles.length })} />
        <Stat
          icon={Wheat}
          label={t('economics.revenue')}
          value={m.money(totals.revenue)}
          hint={revenueByBasis.planned ? t('economics.stats.inclPlanned', { amount: m.money(revenueByBasis.planned) }) : totals.revenue ? t('economics.stats.fromHarvests') : t('economics.stats.noRevenueEstimate')}
        />
        <Stat
          icon={Receipt}
          label={t('economics.directCosts')}
          value={m.money(totals.totalCosts)}
          hint={estimatedCosts ? t('economics.stats.inclEstimated', { amount: m.money(estimatedCosts) }) : s.unallocatedCosts ? t('economics.stats.inclUnallocated', { amount: m.money(s.unallocatedCosts) }) : t('economics.stats.recordedCosts')}
        />
        <Stat icon={Coins} label={t('economics.margins.db2')} value={m.money(db2)} hint={t('economics.margins.afterAllCosts', { amount: m.money(totals.margin) })} />
        <Stat icon={TrendingUp} label={t('economics.margins.db2PerHa')} value={m.money(totals.areaHa ? db2 / totals.areaHa : 0)} hint={t('economics.stats.marginPerHaHint')} />
      </div>

      <Notice tone="info" icon={Info}>
        <p>
          <Trans i18nKey="economics.marginNotice" components={{ b: <strong /> }} />
        </p>
        <p className="mt-1.5">{t('economics.margins.schemeNotice')}</p>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
          <span className="text-muted">{t('economics.revenueBasis')}</span>
          {(['actual', 'expected', 'planned'] as const).map((b) => (
            <span key={b} className="inline-flex items-center gap-1.5">
              <BasisBadge basis={b} />
              <span className="text-fg-2">
                {basisText(t, b).description}
                {revenueByBasis[b] ? <span className="text-fg tabular font-medium"> · {m.money(revenueByBasis[b])}</span> : null}
              </span>
            </span>
          ))}
        </div>
      </Notice>

      <div className="grid lg:grid-cols-2 gap-6">
        <Card title={t('economics.margins.chartTitle')} description={t('economics.margins.chartDescription')}>
          <BarList
            items={byCrop.map((c) => ({ key: c.cropId, label: c.cropName, swatch: c.cropColor, value: c.db2PerHa, hint: fmt.ha(c.areaHa, 1) }))}
            format={(v) => `${m.money(v)}/ha`}
          />
        </Card>
        <Card title={t('economics.byCrop.revenueCostsTitle')} description={t('economics.byCrop.revenueCostsDescription', { currency })}>
          <ColumnChart
            data={byCrop.map((c) => ({ key: c.cropId, label: c.cropName, values: [c.revenue, c.totalCosts] }))}
            series={[
              { name: t('economics.revenue'), color: 'var(--color-series-1)' },
              { name: t('economics.directCosts'), color: 'var(--color-series-2)' },
            ]}
            format={m.compact}
            ariaLabel={t('economics.byCrop.revenueCostsTitle')}
          />
        </Card>
      </div>

      <CropMarginTable cycles={s.cycles} view={view} money={m.money} actions={viewControl} />
      <CycleTable cycles={s.cycles} view={view} money={m.money} actions={viewControl} />

      <CostsByCategory summary={s} money={m.money} />

      <HarvestsCard seasonId={seasonId} currency={currency} />
      <OtherCostsCard seasonId={seasonId} currency={currency} />
    </div>
  )
}

function MarginViewControl({ value, onChange }: { value: MarginView; onChange: (v: MarginView) => void }) {
  const { t } = useTranslation()
  return (
    <SegmentedControl
      aria-label={t('economics.margins.viewLabel')}
      value={value}
      onChange={onChange}
      items={[
        { id: 'actual', label: t('economics.margins.actual') },
        { id: 'planned', label: t('economics.margins.planned') },
        { id: 'compare', label: t('economics.margins.compare') },
      ]}
    />
  )
}

/** One scheme value in the chosen view; "compare" shows Ist with the plan beneath. */
function SchemeValue({ actual, planned, view, money }: { actual: number; planned: number | null; view: MarginView; money: (v: number | null | undefined) => string }) {
  const { t } = useTranslation()
  if (view === 'actual') return <div>{money(actual)}</div>
  if (view === 'planned') return <div>{money(planned)}</div>
  return (
    <>
      <div>{money(actual)}</div>
      <div className="text-xs text-muted font-normal">{t('economics.margins.planShort', { amount: money(planned) })}</div>
    </>
  )
}

interface CropMarginRow {
  id: string
  cropName: string
  cropColor: string
  areaHa: number
  cycleCount: number
  planCount: number
  /** Area of the cycles with a plan, for the planned DB II per ha. */
  planAreaHa: number
  actual: Scheme
  planned: Scheme | null
  total: boolean
}

/** Crops sorted by DB II per ha, followed by a season total. */
function cropMarginRows(cycles: CropCycleEconomics[]): CropMarginRow[] {
  const groups = new Map<string, CropCycleEconomics[]>()
  for (const c of cycles) groups.set(c.cropId, [...(groups.get(c.cropId) ?? []), c])
  const row = (id: string, list: CropCycleEconomics[], total = false): CropMarginRow => {
    const withPlan = list.filter((c) => c.planned)
    return {
      id,
      cropName: list[0]?.cropName ?? '',
      cropColor: list[0]?.cropColor ?? '',
      areaHa: list.reduce((sum, c) => sum + c.areaHa, 0),
      cycleCount: list.length,
      planCount: withPlan.length,
      planAreaHa: withPlan.reduce((sum, c) => sum + c.areaHa, 0),
      actual: sumSchemes(list.map(actualScheme)),
      planned: withPlan.length ? sumSchemes(withPlan.map((c) => plannedScheme(c)!)) : null,
      total,
    }
  }
  const rows = [...groups].map(([cropId, list]) => row(cropId, list))
  const perHa = (r: CropMarginRow) => (r.areaHa ? r.actual.db2 / r.areaHa : 0)
  rows.sort((a, b) => perHa(b) - perHa(a) || a.cropName.localeCompare(b.cropName))
  return rows.length > 1 ? [...rows, row('__total', cycles, true)] : rows
}

function CropMarginTable({ cycles, view, money, actions }: { cycles: CropCycleEconomics[]; view: MarginView; money: (v: number | null | undefined) => string; actions: ReactNode }) {
  const { t } = useTranslation()
  const rows = useMemo(() => cropMarginRows(cycles), [cycles])
  return (
    <Card title={t('economics.margins.byCropTitle')} description={t('economics.margins.byCropDescription')} padded={false} actions={actions}>
      <Table aria-label={t('economics.margins.byCropTitle')}>
        <TableHeader>
          <Column isRowHeader>{t('economics.columns.crop')}</Column>
          <Column align="end">{t('economics.columns.area')}</Column>
          {SCHEME_KEYS.map((k) => (
            <Column key={k} id={k} align="end">{t(SCHEME_LABELS[k])}</Column>
          ))}
          <Column align="end">{t('economics.margins.db2PerHa')}</Column>
        </TableHeader>
        <TableBody items={rows} dependencies={[view, money]}>
          {(r) => {
            const total = r.total ? 'bg-surface-2/60 font-semibold' : undefined
            const perHa = (s: Scheme | null, area: number) => (s && area ? s.db2 / area : null)
            return (
              <Row id={r.id}>
                <Cell className={total}>
                  {r.total ? t('common.total') : <CropTag name={r.cropName} color={r.cropColor} />}
                  <div className="text-xs text-muted font-normal">
                    {view !== 'actual' && r.planCount < r.cycleCount
                      ? t('economics.margins.planPartial', { count: r.planCount, total: r.cycleCount })
                      : t('economics.stats.cycleCount', { count: r.cycleCount })}
                  </div>
                </Cell>
                <Cell align="end" className={total}>{fmt.ha(r.areaHa, 1)}</Cell>
                {SCHEME_KEYS.map((k) => (
                  <Cell key={k} align="end" className={cx(total, MARGIN_LINES.has(k) && 'font-medium')}>
                    <SchemeValue actual={r.actual[k]} planned={r.planned?.[k] ?? null} view={view} money={money} />
                  </Cell>
                ))}
                <Cell align="end" className={cx(total, 'font-medium')}>
                  <SchemeValue actual={perHa(r.actual, r.areaHa) ?? 0} planned={perHa(r.planned, r.planAreaHa)} view={view} money={money} />
                </Cell>
              </Row>
            )
          }}
        </TableBody>
      </Table>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Crop cycle table
// ---------------------------------------------------------------------------

type SortKey = 'field' | 'crop' | 'area' | 'yield' | SchemeKey | 'db2PerHa'

/** Sort value of a cycle; scheme columns sort by the plan in the plan view. */
function sortValue(c: CropCycleEconomics, key: SortKey, view: MarginView): string | number {
  switch (key) {
    case 'field':
      return c.fieldName
    case 'crop':
      return c.cropName
    case 'area':
      return c.areaHa
    case 'yield':
      return c.yieldTHa ?? -Infinity
    default: {
      const s = view === 'planned' ? plannedScheme(c) : actualScheme(c)
      if (!s) return -Infinity
      if (key === 'db2PerHa') return c.areaHa ? s.db2 / c.areaHa : -Infinity
      return s[key]
    }
  }
}

function CycleTable({ cycles, view, money, actions }: { cycles: CropCycleEconomics[]; view: MarginView; money: (v: number | null | undefined) => string; actions: ReactNode }) {
  const { t } = useTranslation()
  const [sort, setSort] = useState<SortDescriptor>({ column: 'db2PerHa', direction: 'descending' })
  const sorted = useMemo(() => {
    const key = (sort.column as SortKey) ?? 'db2PerHa'
    const dir = sort.direction === 'descending' ? -1 : 1
    return [...cycles].sort((a, b) => {
      const va = sortValue(a, key, view)
      const vb = sortValue(b, key, view)
      if (typeof va === 'string') return va.localeCompare(vb as string) * dir
      return (va === vb ? 0 : va < (vb as number) ? -1 : 1) * dir
    })
  }, [cycles, sort, view])

  return (
    <Card title={t('economics.cycles.title')} description={t('economics.cycles.description')} padded={false} actions={actions}>
      <Table aria-label={t('economics.cycles.ariaLabel')} sortDescriptor={sort} onSortChange={setSort}>
        <TableHeader>
          <Column id="field" isRowHeader allowsSorting>{t('economics.columns.field')}</Column>
          <Column id="crop" allowsSorting>{t('economics.columns.crop')}</Column>
          <Column id="area" allowsSorting align="end">{t('economics.columns.area')}</Column>
          <Column id="yield" allowsSorting align="end">{t('economics.columns.yield')}</Column>
          {SCHEME_KEYS.map((k) => (
            <Column key={k} id={k} allowsSorting align="end">{t(SCHEME_LABELS[k])}</Column>
          ))}
          <Column id="db2PerHa" allowsSorting align="end">{t('economics.margins.db2PerHa')}</Column>
        </TableHeader>
        <TableBody items={sorted} dependencies={[view, money]}>
          {(c) => {
            const actual = actualScheme(c)
            const planned = plannedScheme(c)
            return (
              <Row id={c.cropCycleId}>
                <Cell className="font-medium">{c.fieldName}</Cell>
                <Cell>
                  <CropTag name={c.cropName} color={c.cropColor} />
                </Cell>
                <Cell align="end">{fmt.ha(c.areaHa, 1)}</Cell>
                <Cell align="end">
                  <div>{c.yieldTHa != null ? `${fmt.fixed(c.yieldTHa, 1)} t/ha` : '—'}</div>
                  {c.expectedYieldTHa != null && <div className="text-xs text-muted">{t('economics.cycles.expectedShort', { value: fmt.fixed(c.expectedYieldTHa, 1) })}</div>}
                </Cell>
                <Cell align="end">
                  {view === 'actual' && c.revenueBasis === 'none' ? <div>—</div> : <SchemeValue actual={c.revenue} planned={planned?.revenue ?? null} view={view} money={money} />}
                  {view !== 'planned' && (
                    <div className="mt-0.5">
                      <BasisBadge basis={c.revenueBasis} />
                    </div>
                  )}
                </Cell>
                {SCHEME_KEYS.filter((k) => k !== 'revenue').map((k) => (
                  <Cell key={k} align="end" className={MARGIN_LINES.has(k) ? 'font-medium' : undefined}>
                    <SchemeValue actual={actual[k]} planned={planned?.[k] ?? null} view={view} money={money} />
                    {k === 'db2' && view !== 'planned' && c.estimatedCosts > 0 && (
                      <div className="text-xs text-muted font-normal">{t('economics.cycles.estimatedShort', { amount: money(c.estimatedCosts) })}</div>
                    )}
                  </Cell>
                ))}
                <Cell align="end" className="font-medium">
                  <SchemeValue actual={c.db2PerHa} planned={planned && c.areaHa ? planned.db2 / c.areaHa : null} view={view} money={money} />
                </Cell>
              </Row>
            )
          }}
        </TableBody>
      </Table>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Costs by category
// ---------------------------------------------------------------------------

function CostsByCategory({ summary, money }: { summary: EconomicsSummary; money: (v: number | null | undefined) => string }) {
  const { t } = useTranslation()
  const entries = (Object.entries(summary.totals.costsByCategory) as [CostCategory, number][])
    .filter(([, v]) => v)
    .sort((a, b) => b[1] - a[1])
  const total = summary.totals.totalCosts
  const max = Math.max(0, ...entries.map(([, v]) => Math.abs(v)))
  return (
    <Card title={t('economics.categories.title')} description={t('economics.categories.description')} padded={false}>
      {entries.length === 0 ? (
        <p className="p-4 text-sm text-muted">{t('economics.categories.empty')}</p>
      ) : (
        <>
          <Table aria-label={t('economics.categories.ariaLabel')}>
            <TableHeader>
              <Column isRowHeader>{t('economics.columns.category')}</Column>
              <Column align="end">{t('economics.columns.amount')}</Column>
              <Column align="end">{t('economics.columns.share')}</Column>
              <Column className="w-[40%] min-w-32"><span className="sr-only">{t('economics.columns.proportion')}</span></Column>
            </TableHeader>
            <TableBody items={entries.map(([category, value]) => ({ id: category, value }))}>
              {(row) => (
                <Row id={row.id}>
                  <Cell>{costCategoryLabel(row.id)}</Cell>
                  <Cell align="end" className="font-medium">{money(row.value)}</Cell>
                  <Cell align="end" className="text-fg-2">{total ? fmt.pct((row.value / total) * 100) : '—'}</Cell>
                  <Cell>
                    <span className="block h-2 rounded-full bg-surface-2 overflow-hidden" aria-hidden>
                      <span className="block h-full rounded-full bg-primary" style={{ width: `${max ? (Math.abs(row.value) / max) * 100 : 0}%` }} />
                    </span>
                  </Cell>
                </Row>
              )}
            </TableBody>
          </Table>
          <div className="px-4 py-3 text-sm space-y-1">
            <div className="flex justify-between gap-4">
              <span className="font-medium text-fg">{t('economics.categories.total')}</span>
              <span className="font-semibold tabular text-fg">{money(total)}</span>
            </div>
            <div className="flex justify-between gap-4 text-fg-2">
              <span>{t('economics.categories.unallocated')}</span>
              <span className="tabular">{money(summary.unallocatedCosts)}</span>
            </div>
            {summary.unallocatedCosts !== 0 && (
              <p className="text-xs text-muted">{t('economics.categories.unallocatedNote')}</p>
            )}
          </div>
        </>
      )}
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Harvests
// ---------------------------------------------------------------------------

function HarvestsCard({ seasonId, currency }: { seasonId: string; currency: string }) {
  const { t } = useTranslation()
  const { can } = useOrg()
  const harvests = useOrgQuery<Harvest[]>('/harvests', { seasonId })
  const remove = useOrgMutation((base, id: string) => api.delete(`${base}/harvests/${id}`), { success: t('economics.harvests.deleted') })
  const canWrite = can('operation.write')
  const list = [...(harvests.data ?? [])].sort((a, b) => b.harvestDate.localeCompare(a.harvestDate))

  return (
    <Card
      title={t('economics.harvests.title')}
      description={t('economics.harvests.description')}
      padded={false}
      actions={
        canWrite && (
          <DialogTrigger>
            <Button size="sm" variant="secondary">
              <Plus /> {t('economics.harvests.record')}
            </Button>
            <Dialog title={t('economics.harvests.record')} description={t('economics.harvests.dialogDescription')}>
              {(close) => <HarvestForm seasonId={seasonId} currency={currency} onDone={close} />}
            </Dialog>
          </DialogTrigger>
        )
      }
    >
      {harvests.isLoading ? (
        <div className="p-4"><Loading /></div>
      ) : harvests.error ? (
        <div className="p-4"><ErrorNotice error={harvests.error} /></div>
      ) : list.length === 0 ? (
        <EmptyState icon={Wheat} title={t('economics.harvests.empty.title')}>
          {t('economics.harvests.empty.body')}
        </EmptyState>
      ) : (
        <Table aria-label={t('economics.harvests.title')}>
          <TableHeader>
            <Column isRowHeader>{t('common.date')}</Column>
            <Column>{t('economics.columns.field')}</Column>
            <Column align="end">{t('economics.columns.quantity')}</Column>
            <Column align="end">{t('economics.columns.yield')}</Column>
            <Column align="end">{t('economics.columns.moisture')}</Column>
            <Column align="end">{t('economics.columns.pricePerT')}</Column>
            <Column align="end">{t('economics.columns.revenue')}</Column>
            <Column><span className="sr-only">{t('economics.columns.actions')}</span></Column>
          </TableHeader>
          <TableBody items={list}>
            {(h) => (
              <Row id={h.id}>
                <Cell className="whitespace-nowrap tabular">{fmt.date(h.harvestDate)}</Cell>
                <Cell>
                  <div className="font-medium">{h.fieldName}</div>
                  <div className="text-xs text-muted">
                    {h.cropName}
                    {h.quality && ` · ${h.quality}`}
                  </div>
                </Cell>
                <Cell align="end">{fmt.fixed(h.quantityT, 1)} t</Cell>
                <Cell align="end">
                  <div>{fmt.fixed(h.yieldTHa, 1)} t/ha</div>
                  <div className="text-xs text-muted">{fmt.ha(h.harvestedAreaHa, 1)}</div>
                </Cell>
                <Cell align="end">{fmt.pct(h.moisturePct, 1)}</Cell>
                <Cell align="end">
                  <div>{h.pricePerT != null ? fmt.money(h.pricePerT, currency, 2) : '—'}</div>
                  {h.pricePerT != null && (
                    <div className="mt-0.5">
                      <BasisBadge basis={h.priceBasis} />
                    </div>
                  )}
                </Cell>
                <Cell align="end" className="font-medium">{fmt.money(h.revenue, currency)}</Cell>
                <Cell className="w-0">
                  {canWrite && (
                    <ConfirmButton
                      title={t('economics.harvests.deleteTitle')}
                      message={t('economics.harvests.deleteMessage', { quantity: fmt.fixed(h.quantityT, 1), field: h.fieldName, date: fmt.date(h.harvestDate) })}
                      confirmLabel={t('common.delete')}
                      onConfirm={() => remove.mutateAsync(h.id).catch(() => {})}
                      trigger={
                        <Button variant="ghost" size="icon-sm" aria-label={t('economics.harvests.deleteAria', { field: h.fieldName })}>
                          <Trash2 />
                        </Button>
                      }
                    />
                  )}
                </Cell>
              </Row>
            )}
          </TableBody>
        </Table>
      )}
    </Card>
  )
}

function FormActions({ onCancel, isPending, label }: { onCancel: () => void; isPending: boolean; label: string }) {
  const { t } = useTranslation()
  return (
    <div className="flex justify-end gap-2 pt-4 mt-1 border-t border-line">
      <Button onPress={onCancel}>{t('common.cancel')}</Button>
      <Button type="submit" variant="primary" isPending={isPending}>
        {label}
      </Button>
    </div>
  )
}

function FieldGroupLabel({ children }: { children: ReactNode }) {
  return <span className="text-sm font-medium text-fg-2">{children}</span>
}

function HarvestForm({ seasonId, currency, onDone }: { seasonId: string; currency: string; onDone: () => void }) {
  const { t } = useTranslation()
  const cycles = useOrgQuery<CropCycle[]>('/crop-cycles', { seasonId })
  const create = useOrgMutation((base, vars: HarvestInput) => api.post<Harvest>(`${base}/harvests`, vars), { success: t('economics.harvests.recorded') })
  const [cycleId, setCycleId] = useState<string | null>(null)
  const [date, setDate] = useState<string | null>(today())
  const [quantity, setQuantity] = useState(NaN)
  const [area, setArea] = useState(NaN)
  const [moisture, setMoisture] = useState(NaN)
  const [quality, setQuality] = useState('')
  const [price, setPrice] = useState(NaN)
  const [basis, setBasis] = useState<'actual' | 'expected'>('expected')
  const [notes, setNotes] = useState('')

  const items = (cycles.data ?? []).map((c) => ({ ...c, label: `${c.fieldName} · ${c.cropName}` }))
  const cycle = items.find((c) => c.id === cycleId)
  const yieldTHa = num(quantity) != null && num(area) ? quantity / area : null

  const selectCycle = (id: string | null) => {
    setCycleId(id)
    const c = items.find((x) => x.id === id)
    if (!c) return
    setArea(c.areaHa)
    if (Number.isNaN(price) && c.expectedPricePerT != null) {
      setPrice(c.expectedPricePerT)
      setBasis('expected')
    }
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!cycleId || !date || num(quantity) == null) return
    try {
      await create.mutateAsync({
        cropCycleId: cycleId,
        harvestDate: date,
        quantityT: quantity,
        harvestedAreaHa: num(area),
        moisturePct: num(moisture),
        quality: quality.trim() || null,
        pricePerT: num(price),
        priceBasis: basis,
        notes: notes.trim() || null,
      })
      onDone()
    } catch {
      // Shown as a toast; keep the dialog open to correct the input.
    }
  }

  if (cycles.isLoading) return <Loading />
  if (cycles.error) return <ErrorNotice error={cycles.error} />
  if (!items.length) return <p className="text-sm text-muted">{t('economics.harvestForm.noCycles')}</p>

  return (
    <Form onSubmit={submit} className="space-y-4">
      <Select
        label={t('economics.form.cropCycle')}
        isRequired
        items={items}
        value={cycleId}
        onChange={(v) => selectCycle(v == null ? null : String(v))}
        placeholder={t('economics.harvestForm.cyclePlaceholder')}
      >
        {(c) => (
          <Option id={c.id} textValue={c.label} description={`${fmt.ha(c.areaHa, 2)}${c.expectedYieldTHa != null ? ` · ${t('economics.harvestForm.expectedYield', { value: fmt.fixed(c.expectedYieldTHa, 1) })}` : ''}`}>
            {c.label}
          </Option>
        )}
      </Select>
      <div className="grid sm:grid-cols-2 gap-4">
        <DatePicker label={t('economics.harvestForm.harvestDate')} isRequired value={date} onChange={setDate} />
        <NumberField label={t('economics.columns.quantity')} unit="t" isRequired minValue={0} value={quantity} onChange={setQuantity} formatOptions={{ maximumFractionDigits: 3 }} />
        <NumberField
          label={t('economics.harvestForm.harvestedArea')}
          unit="ha"
          minValue={0}
          value={area}
          onChange={setArea}
          formatOptions={{ maximumFractionDigits: 4 }}
          description={cycle ? t('economics.harvestForm.cycleArea', { area: fmt.ha(cycle.areaHa, 2) }) : t('economics.harvestForm.areaDefault')}
        />
        <NumberField label={t('economics.columns.moisture')} unit="%" minValue={0} maxValue={100} value={moisture} onChange={setMoisture} formatOptions={{ maximumFractionDigits: 1 }} />
        <TextField label={t('economics.harvestForm.quality')} value={quality} onChange={setQuality} placeholder={t('economics.harvestForm.qualityPlaceholder')} />
        <NumberField label={t('economics.harvestForm.pricePerTonne')} unit={`${currency}/t`} minValue={0} value={price} onChange={setPrice} formatOptions={{ maximumFractionDigits: 2 }} />
      </div>
      <div className="flex flex-col gap-1.5">
        <FieldGroupLabel>{t('economics.harvestForm.priceBasis')}</FieldGroupLabel>
        <div>
          <SegmentedControl
            aria-label={t('economics.harvestForm.priceBasis')}
            value={basis}
            onChange={setBasis}
            items={[
              { id: 'actual', label: t('economics.harvestForm.actualSold') },
              { id: 'expected', label: t('economics.harvestForm.expected') },
            ]}
          />
        </div>
        <span className="text-xs text-muted">{t('economics.harvestForm.actualHint')}</span>
      </div>
      <TextField label={t('common.notes')} multiline rows={2} value={notes} onChange={setNotes} />
      {yieldTHa != null && (
        <p className="text-sm text-fg-2 tabular">
          ≈ {fmt.fixed(yieldTHa, 2)} t/ha
          {cycle?.expectedYieldTHa != null && <span className="text-muted"> ({t('economics.harvestForm.expectedValue', { value: fmt.fixed(cycle.expectedYieldTHa, 1) })})</span>}
          {num(price) != null && <> · {t('economics.harvestForm.revenueEstimate', { amount: fmt.money(quantity * price, currency) })}</>}
        </p>
      )}
      <FormActions onCancel={onDone} isPending={create.isPending} label={t('economics.harvests.record')} />
    </Form>
  )
}

// ---------------------------------------------------------------------------
// Other (manual) costs
// ---------------------------------------------------------------------------

const NOT_ALLOCATED = '__season'

function OtherCostsCard({ seasonId, currency }: { seasonId: string; currency: string }) {
  const { t } = useTranslation()
  const { can } = useOrg()
  const entries = useOrgQuery<CostEntry[]>('/cost-entries', { seasonId })
  const remove = useOrgMutation((base, id: string) => api.delete(`${base}/cost-entries/${id}`), { success: t('economics.otherCosts.deleted') })
  const canWrite = can('finance.write')
  const all = entries.data ?? []
  const manual = all.filter((e) => e.source === 'manual').sort((a, b) => b.incurredOn.localeCompare(a.incurredOn))
  const fromOperations = all.length - manual.length

  return (
    <Card
      title={t('economics.otherCosts.title')}
      description={fromOperations ? `${t('economics.otherCosts.description')} ${t('economics.otherCosts.fromOperations', { count: fromOperations })}` : t('economics.otherCosts.description')}
      padded={false}
      actions={
        canWrite && (
          <DialogTrigger>
            <Button size="sm" variant="secondary">
              <Plus /> {t('economics.otherCosts.add')}
            </Button>
            <Dialog title={t('economics.otherCosts.add')} description={t('economics.otherCosts.dialogDescription')}>
              {(close) => <CostForm seasonId={seasonId} currency={currency} onDone={close} />}
            </Dialog>
          </DialogTrigger>
        )
      }
    >
      {entries.isLoading ? (
        <div className="p-4"><Loading /></div>
      ) : entries.error ? (
        <div className="p-4"><ErrorNotice error={entries.error} /></div>
      ) : manual.length === 0 ? (
        <EmptyState icon={Receipt} title={t('economics.otherCosts.empty.title')}>
          {t('economics.otherCosts.empty.body')}
        </EmptyState>
      ) : (
        <Table aria-label={t('economics.otherCosts.title')}>
          <TableHeader>
            <Column isRowHeader>{t('common.date')}</Column>
            <Column>{t('economics.columns.category')}</Column>
            <Column>{t('common.description')}</Column>
            <Column align="end">{t('economics.columns.amount')}</Column>
            <Column><span className="sr-only">{t('economics.columns.actions')}</span></Column>
          </TableHeader>
          <TableBody items={manual}>
            {(e) => (
              <Row id={e.id}>
                <Cell className="whitespace-nowrap tabular">{fmt.date(e.incurredOn)}</Cell>
                <Cell className="whitespace-nowrap">{costCategoryLabel(e.category)}</Cell>
                <Cell>
                  <div>{e.description || <span className="text-muted">—</span>}</div>
                  <div className="text-xs text-muted">{e.fieldName ?? t('economics.otherCosts.noField')}</div>
                </Cell>
                <Cell align="end">
                  <div className="font-medium">{fmt.money(e.amount, e.currency || currency, 2)}</div>
                  {e.basis === 'estimated' && <div className="text-xs text-muted">{t('economics.otherCosts.estimated')}</div>}
                </Cell>
                <Cell className="w-0">
                  {canWrite && (
                    <ConfirmButton
                      title={t('economics.otherCosts.deleteTitle')}
                      message={t('economics.otherCosts.deleteMessage', { category: costCategoryLabel(e.category), amount: fmt.money(e.amount, e.currency || currency, 2), date: fmt.date(e.incurredOn) })}
                      confirmLabel={t('common.delete')}
                      onConfirm={() => remove.mutateAsync(e.id).catch(() => {})}
                      trigger={
                        <Button variant="ghost" size="icon-sm" aria-label={t('economics.otherCosts.deleteAria', { category: costCategoryLabel(e.category) })}>
                          <Trash2 />
                        </Button>
                      }
                    />
                  )}
                </Cell>
              </Row>
            )}
          </TableBody>
        </Table>
      )}
    </Card>
  )
}

function CostForm({ seasonId, currency, onDone }: { seasonId: string; currency: string; onDone: () => void }) {
  const { t } = useTranslation()
  const cycles = useOrgQuery<CropCycle[]>('/crop-cycles', { seasonId })
  const create = useOrgMutation((base, vars: CostEntryInput) => api.post<CostEntry[]>(`${base}/cost-entries`, vars), { success: t('economics.otherCosts.added') })
  const [category, setCategory] = useState<CostCategory | null>(null)
  const [amount, setAmount] = useState(NaN)
  const [basis, setBasis] = useState<'actual' | 'estimated'>('actual')
  const [description, setDescription] = useState('')
  const [date, setDate] = useState<string | null>(today())
  const [cycleId, setCycleId] = useState<string>(NOT_ALLOCATED)

  const cycleItems = [
    { id: NOT_ALLOCATED, label: t('economics.costForm.notAllocated'), hint: t('economics.costForm.notAllocatedHint') },
    ...(cycles.data ?? []).map((c) => ({ id: c.id, label: `${c.fieldName} · ${c.cropName}`, hint: fmt.ha(c.areaHa, 2) })),
  ]

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!category || !date || num(amount) == null) return
    try {
      await create.mutateAsync({
        seasonId,
        cropCycleId: cycleId === NOT_ALLOCATED ? null : cycleId,
        category,
        amount,
        basis,
        description: description.trim() || null,
        incurredOn: date,
      })
      onDone()
    } catch {
      // Shown as a toast; keep the dialog open to correct the input.
    }
  }

  return (
    <Form onSubmit={submit} className="space-y-4">
      <div className="grid sm:grid-cols-2 gap-4">
        <Select
          label={t('economics.columns.category')}
          isRequired
          items={COST_CATEGORIES.map((c) => ({ id: c, label: costCategoryLabel(c) }))}
          value={category}
          onChange={(v) => setCategory(v == null ? null : (v as CostCategory))}
          placeholder={t('economics.costForm.categoryPlaceholder')}
        >
          {(c) => <Option id={c.id}>{c.label}</Option>}
        </Select>
        <NumberField
          label={t('economics.columns.amount')}
          unit={currency}
          isRequired
          value={amount}
          onChange={setAmount}
          formatOptions={{ maximumFractionDigits: 2 }}
          description={t('economics.costForm.amountDescription')}
        />
        <DatePicker label={t('common.date')} isRequired value={date} onChange={setDate} />
        <div className="flex flex-col gap-1.5">
          <FieldGroupLabel>{t('economics.costForm.basis')}</FieldGroupLabel>
          <div>
            <SegmentedControl
              aria-label={t('economics.costForm.basisAria')}
              value={basis}
              onChange={setBasis}
              items={[
                { id: 'actual', label: t('economics.costForm.actual') },
                { id: 'estimated', label: t('economics.costForm.estimated') },
              ]}
            />
          </div>
        </div>
      </div>
      <TextField label={t('common.description')} value={description} onChange={setDescription} placeholder={t('economics.costForm.descriptionPlaceholder')} />
      <Select label={t('economics.form.cropCycle')} items={cycleItems} value={cycleId} onChange={(v) => setCycleId(v == null ? NOT_ALLOCATED : String(v))} isDisabled={cycles.isLoading}>
        {(c) => (
          <Option id={c.id} textValue={c.label} description={c.hint}>
            {c.label}
          </Option>
        )}
      </Select>
      <FormActions onCancel={onDone} isPending={create.isPending} label={t('economics.otherCosts.add')} />
    </Form>
  )
}

// ---------------------------------------------------------------------------
// Farm result (Betriebsergebnis)
// ---------------------------------------------------------------------------

const OVERHEAD_LINES = ['lease', 'landTax', 'insurance', 'buildings', 'accounting', 'other'] as const
const PAYMENT_LINES = ['basic', 'redistributive', 'ecoSchemes', 'other'] as const

/** A line of the result waterfall: a running subtotal or a change to it. */
interface ResultStep {
  key: string
  label: string
  amount: number
  kind: 'subtotal' | 'delta' | 'total'
}

function FarmResultTab({ summary: s, seasonId, money: m }: { summary: EconomicsSummary; seasonId: string; money: Money }) {
  const { t } = useTranslation()
  const r = s.farmResult
  const area = s.totals.areaHa
  const perHa = (v: number) => t('economics.result.perHa', { amount: m.money(area ? v / area : 0) })

  return (
    <div className="space-y-6">
      {r ? (
        <>
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
            <Stat icon={Landmark} tone={r.result < 0 ? 'danger' : 'success'} label={t('economics.result.result')} value={m.money(r.result)} hint={t('economics.result.perHa', { amount: m.money(r.resultPerHa) })} />
            <Stat icon={Coins} label={t('economics.result.beforePayments')} value={m.money(r.resultBeforePayments)} hint={perHa(r.resultBeforePayments)} />
            <Stat icon={Factory} label={t('economics.result.overheads')} value={m.money(r.overheads.total)} hint={perHa(r.overheads.total)} />
            <Stat icon={HandCoins} label={t('economics.result.payments')} value={m.money(r.payments.total)} hint={t('economics.result.indicative')} />
          </div>
          <ResultWaterfall summary={s} result={r} money={m.money} />
        </>
      ) : (
        <Card>
          <EmptyState icon={Landmark} title={t('economics.result.empty.title')}>
            {t('economics.result.empty.body')}
          </EmptyState>
        </Card>
      )}
      <OverheadsCard seasonId={seasonId} currency={s.currency} areaHa={area} />
    </div>
  )
}

/** DB II down to the farm result as floating bars on a shared scale (waterfall). */
function ResultWaterfall({ summary: s, result: r, money }: { summary: EconomicsSummary; result: FarmResult; money: (v: number | null | undefined) => string }) {
  const { t } = useTranslation()
  const area = s.totals.areaHa
  const db2 = s.cycles.reduce((sum, c) => sum + c.db2, 0)
  const otherCosts = s.cycles.reduce((sum, c) => sum + c.otherCosts, 0)
  // `|| 0` turns -0 into 0 so that empty lines don't print as "-0 €".
  const delta = (key: string, label: string, amount: number): ResultStep => ({ key, label, amount: amount || 0, kind: 'delta' })
  const steps: ResultStep[] = [
    { key: 'db2', label: t('economics.margins.db2'), amount: db2, kind: 'subtotal' },
    delta('otherCosts', t('economics.result.otherCosts'), -otherCosts),
    { key: 'db2AfterOther', label: t('economics.result.db2AfterOther'), amount: r.db2, kind: 'subtotal' },
    ...OVERHEAD_LINES.map((k) => delta(`overhead.${k}`, t(`economics.overheads.${k}`), -r.overheads[k])),
    delta('unallocated', t('economics.result.unallocated'), -r.unallocatedCosts),
    { key: 'beforePayments', label: t('economics.result.beforePayments'), amount: r.resultBeforePayments, kind: 'subtotal' },
    ...PAYMENT_LINES.map((k) => delta(`payment.${k}`, t(`economics.payments.${k}`), r.payments[k])),
    { key: 'result', label: t('economics.result.result'), amount: r.result, kind: 'total' },
  ]

  // Deltas float from the running total; subtotals stand on zero.
  let running = 0
  const bars = steps.map((step) => {
    if (step.kind !== 'delta') {
      running = step.amount
      return { ...step, from: 0, to: step.amount }
    }
    const from = running
    running += step.amount
    return { ...step, from, to: running }
  })
  const lo = Math.min(0, ...bars.flatMap((b) => [b.from, b.to]))
  const hi = Math.max(0, ...bars.flatMap((b) => [b.from, b.to]))
  const pos = (v: number) => ((v - lo) / (hi - lo || 1)) * 100

  return (
    <Card title={t('economics.result.waterfallTitle')} description={t('economics.result.waterfallDescription', { area: fmt.ha(area, 1) })} padded={false}>
      <Table aria-label={t('economics.result.waterfallTitle')}>
        <TableHeader>
          <Column isRowHeader>{t('economics.result.position')}</Column>
          <Column className="w-[40%] min-w-40"><span className="sr-only">{t('economics.columns.proportion')}</span></Column>
          <Column align="end">{t('economics.columns.amount')}</Column>
          <Column align="end">{t('economics.result.perHaColumn')}</Column>
        </TableHeader>
        <TableBody items={bars}>
          {(b) => {
            const strong = b.kind !== 'delta' ? cx('font-semibold', b.kind === 'total' ? 'bg-primary-soft/60' : 'bg-surface-2/60') : undefined
            const tone = b.kind === 'total' ? 'bg-primary' : b.kind === 'subtotal' ? 'bg-primary/45' : b.amount < 0 ? 'bg-danger/70' : 'bg-success/70'
            const signed = b.kind === 'delta' && b.amount > 0 ? `+${money(b.amount)}` : money(b.amount)
            return (
              <Row id={b.key}>
                <Cell className={cx(strong, b.kind === 'delta' && 'pl-6 text-fg-2')}>{b.label}</Cell>
                <Cell className={strong}>
                  <span className="relative block h-3 rounded-sm bg-surface-2" aria-hidden>
                    {lo < 0 && <span className="absolute -inset-y-0.5 w-px bg-line-strong" style={{ left: `${pos(0)}%` }} />}
                    {b.from !== b.to && (
                      <span
                        className={cx('absolute inset-y-0 rounded-sm', tone)}
                        style={{ left: `${pos(Math.min(b.from, b.to))}%`, width: `max(${pos(Math.max(b.from, b.to)) - pos(Math.min(b.from, b.to))}%, 2px)` }}
                      />
                    )}
                  </span>
                </Cell>
                <Cell align="end" className={cx(strong, b.kind === 'delta' && b.amount === 0 && 'text-muted')}>{signed}</Cell>
                <Cell align="end" className={cx(strong, 'text-fg-2')}>{area ? money(b.amount / area) : '—'}</Cell>
              </Row>
            )
          }}
        </TableBody>
      </Table>
      <p className="px-4 py-3 text-xs text-muted">{t('economics.result.capNotice')}</p>
    </Card>
  )
}

const OVERHEAD_FIELDS = ['leasePerHa', 'landTaxPerHa', 'insurancePerHa', 'buildingsPerHa', 'accountingPerHa', 'otherPerHa'] as const
const PAYMENT_FIELDS = ['basicPaymentPerHa', 'redistributive1PerHa', 'redistributive2PerHa', 'ecoSchemesPerHa', 'otherPaymentsPerHa'] as const
type OverheadField = (typeof OVERHEAD_FIELDS)[number] | (typeof PAYMENT_FIELDS)[number]

const OVERHEAD_FIELD_LABELS: Record<OverheadField, string> = {
  leasePerHa: 'economics.overheads.lease',
  landTaxPerHa: 'economics.overheads.landTax',
  insurancePerHa: 'economics.overheads.insurance',
  buildingsPerHa: 'economics.overheads.buildings',
  accountingPerHa: 'economics.overheads.accounting',
  otherPerHa: 'economics.overheads.other',
  basicPaymentPerHa: 'economics.payments.basic',
  redistributive1PerHa: 'economics.payments.redistributive1',
  redistributive2PerHa: 'economics.payments.redistributive2',
  ecoSchemesPerHa: 'economics.payments.ecoSchemes',
  otherPaymentsPerHa: 'economics.payments.other',
}

function OverheadsCard({ seasonId, currency, areaHa }: { seasonId: string; currency: string; areaHa: number }) {
  const { t } = useTranslation()
  const overheads = useOrgQuery<FarmOverheads | null>('/economics/overheads', { seasonId })
  return (
    <Card title={t('economics.overheads.title')} description={t('economics.overheads.description', { area: fmt.ha(areaHa, 1) })}>
      {overheads.isLoading ? (
        <Loading />
      ) : overheads.error ? (
        <ErrorNotice error={overheads.error} />
      ) : (
        <OverheadsForm key={seasonId} seasonId={seasonId} initial={overheads.data ?? null} currency={currency} areaHa={areaHa} />
      )}
    </Card>
  )
}

/** Per-hectare overheads and payments of the season; empty fields are saved as 0. */
function OverheadsForm({ seasonId, initial, currency, areaHa }: { seasonId: string; initial: FarmOverheads | null; currency: string; areaHa: number }) {
  const { t } = useTranslation()
  const { can } = useOrg()
  const canWrite = can('finance.write')
  const [values, setValues] = useState(
    () => Object.fromEntries([...OVERHEAD_FIELDS, ...PAYMENT_FIELDS].map((k) => [k, initial?.[k] ?? NaN])) as Record<OverheadField, number>,
  )
  const save = useOrgMutation((base, input: FarmOverheadsInput) => api.put<FarmOverheads>(`${base}/economics/overheads`, input), { success: t('economics.overheads.saved') })

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const perHa = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, num(v) ?? 0])) as Record<OverheadField, number>
    save.mutate({ seasonId, ...perHa })
  }

  const hint = (k: OverheadField) => {
    if (k === 'redistributive1PerHa') return t('economics.payments.redistributive1Hint')
    if (k === 'redistributive2PerHa') return t('economics.payments.redistributive2Hint')
    const v = num(values[k])
    return v ? t('economics.overheads.seasonTotal', { amount: fmt.money(v * areaHa, currency) }) : undefined
  }
  const field = (k: OverheadField) => (
    <NumberField
      key={k}
      label={t(OVERHEAD_FIELD_LABELS[k])}
      unit={`${currency}/ha`}
      minValue={0}
      placeholder="0"
      value={values[k]}
      onChange={(v) => setValues((prev) => ({ ...prev, [k]: v }))}
      isReadOnly={!canWrite}
      formatOptions={{ maximumFractionDigits: 2 }}
      description={hint(k)}
    />
  )

  return (
    <Form onSubmit={submit} className="space-y-5">
      <fieldset>
        <legend className="mb-3 text-sm font-medium text-fg-2">{t('economics.overheads.costsLegend')}</legend>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">{OVERHEAD_FIELDS.map(field)}</div>
      </fieldset>
      <fieldset>
        <legend className="mb-1 text-sm font-medium text-fg-2">{t('economics.payments.legend')}</legend>
        <p className="mb-3 text-xs text-muted">{t('economics.payments.notice')}</p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">{PAYMENT_FIELDS.map(field)}</div>
      </fieldset>
      {canWrite ? (
        <div className="flex justify-end pt-4 border-t border-line">
          <Button type="submit" variant="primary" isPending={save.isPending}>
            {t('common.save')}
          </Button>
        </div>
      ) : (
        <p className="text-xs text-muted">{t('economics.overheads.readOnly')}</p>
      )}
    </Form>
  )
}

// ---------------------------------------------------------------------------
// Greenhouse gases (Treibhausgase)
// ---------------------------------------------------------------------------

const kgCo2e = (v: number | null | undefined) => (v == null ? '—' : `${fmt.num(v)} kg CO₂e`)

function CarbonTab({ summary: s }: { summary: EconomicsSummary }) {
  const { t } = useTranslation()
  const c = s.carbon
  const sources = Object.entries(c.bySource)
    .filter(([, v]) => v)
    .sort((a, b) => b[1] - a[1])
  const crops = [...s.byCrop].sort((a, b) => b.co2eKg - a.co2eKg)
  const sourceLabel = (source: string) => t(`economics.carbon.source.${source}`, { defaultValue: source })
  const share = (v: number) => fmt.pct(c.totalKg ? (v / c.totalKg) * 100 : 0)
  const top = sources[0]

  const method = (
    <Notice tone="info" icon={Info}>
      {t('economics.carbon.methodNotice', { factorSet: c.factorSet })}
    </Notice>
  )

  if (!c.totalKg) {
    return (
      <div className="space-y-6">
        <Card>
          <EmptyState icon={Leaf} title={t('economics.carbon.empty.title')}>
            {t('economics.carbon.empty.body')}
          </EmptyState>
        </Card>
        {method}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 xl:grid-cols-3 gap-4">
        <Stat icon={Leaf} label={t('economics.carbon.total')} value={kgCo2e(c.totalKg)} hint={t('economics.carbon.tonnes', { value: fmt.fixed(c.totalKg / 1000, 1) })} />
        <Stat icon={Sprout} label={t('economics.carbon.perHa')} value={`${fmt.num(c.perHa)} kg CO₂e/ha`} hint={t('economics.carbon.perHaHint', { area: fmt.ha(s.totals.areaHa, 1) })} />
        {top && <Stat icon={Factory} label={t('economics.carbon.largestSource')} value={sourceLabel(top[0])} hint={t('economics.carbon.sourceShare', { share: share(top[1]), amount: kgCo2e(top[1]) })} />}
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <Card title={t('economics.carbon.bySourceTitle')} description={t('economics.carbon.bySourceDescription')}>
          <BarList items={sources.map(([source, v]) => ({ key: source, label: sourceLabel(source), value: v, hint: share(v) }))} format={kgCo2e} color="var(--color-accent)" />
        </Card>
        <Card title={t('economics.carbon.byCropTitle')} description={t('economics.carbon.byCropDescription')} padded={false}>
          <Table aria-label={t('economics.carbon.byCropTitle')}>
            <TableHeader>
              <Column isRowHeader>{t('economics.columns.crop')}</Column>
              <Column align="end">{t('economics.columns.area')}</Column>
              <Column align="end">{t('economics.carbon.columns.total')}</Column>
              <Column align="end">{t('economics.carbon.columns.perHa')}</Column>
              <Column align="end">{t('economics.carbon.columns.perT')}</Column>
            </TableHeader>
            <TableBody items={crops.map((x) => ({ ...x, id: x.cropId }))}>
              {(x) => (
                <Row id={x.id}>
                  <Cell>
                    <CropTag name={x.cropName} color={x.cropColor} />
                  </Cell>
                  <Cell align="end">{fmt.ha(x.areaHa, 1)}</Cell>
                  <Cell align="end" className="font-medium">{fmt.num(x.co2eKg)}</Cell>
                  <Cell align="end">{fmt.num(x.co2ePerHa)}</Cell>
                  <Cell align="end">{fmt.num(x.co2ePerT)}</Cell>
                </Row>
              )}
            </TableBody>
          </Table>
        </Card>
      </div>

      {method}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Crop prices (Preise)
// ---------------------------------------------------------------------------

interface PriceDraft {
  price: number
  notes: string
}

const EMPTY_DRAFT: PriceDraft = { price: NaN, notes: '' }

function toDrafts(list: CropPrice[]): Record<string, PriceDraft> {
  return Object.fromEntries(list.map((p) => [p.cropId, { price: p.pricePerT, notes: p.notes ?? '' }]))
}

function sameDraft(a: PriceDraft, b: PriceDraft) {
  return (Number.isNaN(a.price) ? Number.isNaN(b.price) : a.price === b.price) && a.notes.trim() === b.notes.trim()
}

function PricesTab({ summary, seasonId, harvestYear }: { summary: EconomicsSummary; seasonId: string; harvestYear: number | null }) {
  const prices = useOrgQuery<CropPrice[]>(harvestYear != null ? '/crop-prices' : null, { harvestYear })
  const cycles = useOrgQuery<CropCycle[]>('/crop-cycles', { seasonId })
  if (harvestYear == null || prices.isLoading) return <Loading />
  if (prices.error) return <ErrorNotice error={prices.error} />
  return <PriceEditor key={harvestYear} summary={summary} harvestYear={harvestYear} prices={prices.data ?? []} cycles={cycles.data ?? []} />
}

/** The farm's sale price per crop for the harvest year, used where a crop cycle has no expected price of its own. */
function PriceEditor({ summary: s, harvestYear, prices, cycles }: { summary: EconomicsSummary; harvestYear: number; prices: CropPrice[]; cycles: CropCycle[] }) {
  const { t } = useTranslation()
  const { can } = useOrg()
  const canWrite = can('finance.write')
  const currency = s.currency
  const [saved, setSaved] = useState(() => toDrafts(prices))
  const [drafts, setDrafts] = useState(saved)
  const save = useOrgMutation((base, input: CropPricesInput) => api.put<CropPrice[]>(`${base}/crop-prices`, input), {
    success: t('economics.prices.saved'),
    onSuccess: (list) => {
      const next = toDrafts(list)
      setSaved(next)
      setDrafts(next)
    },
  })

  // Crops of the season, plus crops priced for the year but not grown, so their price can be cleared.
  const rows = useMemo(() => {
    const map = new Map<string, { cropId: string; cropName: string; cropColor: string | null; areaHa: number; cycleCount: number; own: number[] }>()
    for (const c of s.cycles) {
      const row = map.get(c.cropId) ?? { cropId: c.cropId, cropName: c.cropName, cropColor: c.cropColor, areaHa: 0, cycleCount: 0, own: [] }
      row.areaHa += c.areaHa
      row.cycleCount += 1
      map.set(c.cropId, row)
    }
    for (const p of prices) if (!map.has(p.cropId)) map.set(p.cropId, { cropId: p.cropId, cropName: p.cropName, cropColor: null, areaHa: 0, cycleCount: 0, own: [] })
    for (const c of cycles) if (c.expectedPricePerT != null) map.get(c.cropId)?.own.push(c.expectedPricePerT)
    return [...map.values()].sort((a, b) => b.areaHa - a.areaHa || a.cropName.localeCompare(b.cropName))
  }, [s.cycles, prices, cycles])

  const draftOf = (cropId: string) => drafts[cropId] ?? EMPTY_DRAFT
  const changed = rows.filter((r) => !sameDraft(draftOf(r.cropId), saved[r.cropId] ?? EMPTY_DRAFT))
  const update = (cropId: string, patch: Partial<PriceDraft>) => setDrafts((prev) => ({ ...prev, [cropId]: { ...(prev[cropId] ?? EMPTY_DRAFT), ...patch } }))
  const submit = () =>
    save.mutate({
      harvestYear,
      prices: changed.map((r) => {
        const d = draftOf(r.cropId)
        return { cropId: r.cropId, pricePerT: num(d.price), notes: d.notes.trim() || null }
      }),
    })
  const priceRange = (own: number[]) => {
    const lo = Math.min(...own)
    const hi = Math.max(...own)
    return lo === hi ? fmt.money(lo, currency, 2) : `${fmt.money(lo, currency, 2)} – ${fmt.money(hi, currency, 2)}`
  }

  const th = 'px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted border-b border-line whitespace-nowrap text-left'
  const td = 'px-3 py-2 border-b border-line align-middle'

  return (
    <div className="space-y-6">
      <Notice tone="info" icon={Info}>
        {t('economics.prices.notice', { year: harvestYear })}
      </Notice>
      <Card
        title={t('economics.prices.title', { year: harvestYear })}
        description={t('economics.prices.description')}
        padded={false}
        actions={
          canWrite && (
            <>
              <Button size="sm" variant="ghost" isDisabled={!changed.length || save.isPending} onPress={() => setDrafts(saved)}>
                {t('common.reset')}
              </Button>
              <Button size="sm" variant="primary" isDisabled={!changed.length} isPending={save.isPending} onPress={submit}>
                {t('common.save')}
              </Button>
            </>
          )
        }
      >
        {rows.length === 0 ? (
          <EmptyState icon={Tag} title={t('economics.prices.empty.title')}>
            {t('economics.prices.empty.body')}
          </EmptyState>
        ) : (
          // A plain table: the inputs need their own keyboard handling, which a grid would take over.
          <div className="w-full overflow-x-auto">
            <table className="w-full text-sm border-separate border-spacing-0">
              <thead>
                <tr>
                  <th className={th}>{t('economics.columns.crop')}</th>
                  <th className={cx(th, 'text-right')}>{t('economics.columns.area')}</th>
                  <th className={th}>{t('economics.prices.price')}</th>
                  <th className={th}>{t('common.notes')}</th>
                  <th className={th}>{t('economics.prices.cyclePrices')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const d = draftOf(r.cropId)
                  return (
                    <tr key={r.cropId} className="text-fg">
                      <th scope="row" className={cx(td, 'text-left font-normal')}>
                        <CropTag name={r.cropName} color={r.cropColor} />
                      </th>
                      <td className={cx(td, 'text-right tabular whitespace-nowrap')}>{r.cycleCount ? fmt.ha(r.areaHa, 1) : <span className="text-muted">{t('economics.prices.notGrown')}</span>}</td>
                      <td className={cx(td, 'w-48 min-w-40')}>
                        <NumberField
                          aria-label={t('economics.prices.priceAria', { crop: r.cropName })}
                          unit={`${currency}/t`}
                          minValue={0}
                          value={d.price}
                          onChange={(v) => update(r.cropId, { price: v })}
                          isReadOnly={!canWrite}
                          formatOptions={{ maximumFractionDigits: 2 }}
                        />
                      </td>
                      <td className={cx(td, 'min-w-48')}>
                        <TextField
                          aria-label={t('economics.prices.notesAria', { crop: r.cropName })}
                          value={d.notes}
                          onChange={(v) => update(r.cropId, { notes: v })}
                          isReadOnly={!canWrite}
                          placeholder={t('economics.prices.notesPlaceholder')}
                        />
                      </td>
                      <td className={cx(td, 'text-xs text-fg-2')}>
                        {r.own.length ? t('economics.prices.ownPrices', { count: r.own.length, total: r.cycleCount, range: priceRange(r.own) }) : <span className="text-muted">—</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
