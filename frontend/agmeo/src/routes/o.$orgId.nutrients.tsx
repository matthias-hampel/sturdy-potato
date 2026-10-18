import type { CycleNutrientBalance, FieldSoilSummary, SeasonNutrientBalance, SoilTexture } from '@agmeo/contracts'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { AlertTriangle, CalendarRange, CheckCircle2, ClipboardCheck, Calculator, FlaskConical, Layers, Leaf, Sprout } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'
import { CropTag } from '#/components/labels'
import { SoilValue } from '#/components/nutrients/badges'
import { FertilizerNeedDialog } from '#/components/nutrients/FertilizerNeedDialog'
import { soilTextureLabel } from '#/i18n/labels.agronomy'
import { fmt } from '#/lib/format'
import { useOrg, useSeason } from '#/lib/org'
import { useOrgQuery } from '#/lib/queries'
import { Button, Link } from '#/ui/Button'
import { Badge, Card, EmptyState, ErrorNotice, Loading, Notice, PageHeader, Stat, Tab, TabList, TabPanel, Tabs } from '#/ui/Layout'
import { Cell, Column, Row, Table, TableBody, TableHeader } from '#/ui/Table'
import { cx } from '#/ui/utils'

const TABS = ['balance', 'soil'] as const

export const Route = createFileRoute('/o/$orgId/nutrients')({
  validateSearch: z.object({ tab: z.enum(TABS).optional() }),
  component: NutrientsPage,
})

function NutrientsPage() {
  const { t } = useTranslation()
  const { season } = useSeason()
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  return (
    <>
      <PageHeader title={t('nutrients.title')} subtitle={season ? t('nutrients.subtitleSeason', { season: season.name }) : t('nutrients.subtitle')} />
      <Tabs
        selectedKey={search.tab ?? 'balance'}
        onSelectionChange={(key) => navigate({ search: { tab: key === 'balance' ? undefined : (key as (typeof TABS)[number]) }, replace: true })}
      >
        <TabList aria-label={t('nutrients.tabs.label')}>
          <Tab id="balance">{t('nutrients.tabs.balance')}</Tab>
          <Tab id="soil">{t('nutrients.tabs.soil')}</Tab>
        </TabList>
        <TabPanel id="balance">
          <BalanceTab />
        </TabPanel>
        <TabPanel id="soil">
          <SoilOverview />
        </TabPanel>
      </Tabs>
    </>
  )
}

/** kg/ha with the unit in muted type; a dash for missing values. */
function Kg({ value, className }: { value: number | null | undefined; className?: string }) {
  if (value == null) return <span className="text-muted">—</span>
  return <span className={cx('tabular', className)}>{fmt.num(value, 0)}</span>
}

function BalanceTab() {
  const { t } = useTranslation()
  const { orgId } = useOrg()
  const { seasonId, season, isLoading } = useSeason()
  const balance = useOrgQuery<SeasonNutrientBalance>('/nutrients/season', { seasonId }, { enabled: !!seasonId })
  const [open, setOpen] = useState<string | null>(null)
  const rows = balance.data?.rows ?? []

  const stats = useMemo(() => {
    const withNeed = rows.filter((r) => r.nNeed != null)
    const needArea = withNeed.reduce((s, r) => s + r.areaHa, 0)
    const area = rows.reduce((s, r) => s + r.areaHa, 0)
    const appliedKg = rows.reduce((s, r) => s + (r.applied.availableN ?? 0) * r.areaHa, 0)
    return {
      meanNeed: needArea ? withNeed.reduce((s, r) => s + r.nNeed! * r.areaHa, 0) / needArea : null,
      appliedKg,
      appliedPerHa: area ? appliedKg / area : null,
      undocumented: withNeed.filter((r) => !r.nNeedRecorded).length,
      violations: rows.reduce((s, r) => s + r.closedPeriodViolations, 0),
    }
  }, [rows])

  if (isLoading || balance.isLoading) return <Loading />
  if (!season)
    return (
      <Card>
        <EmptyState icon={CalendarRange} title={t('nutrients.noSeason.title')}>
          {t('nutrients.noSeason.body')}
        </EmptyState>
      </Card>
    )
  if (balance.error) return <ErrorNotice error={balance.error} />

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <Stat icon={Calculator} label={t('nutrients.stat.meanNeed')} value={stats.meanNeed != null ? `${fmt.num(stats.meanNeed)} kg N/ha` : '—'} hint={t('nutrients.stat.meanNeedHint')} />
        <Stat icon={Leaf} label={t('nutrients.stat.applied')} value={fmt.qty(stats.appliedKg, 'kg N')} hint={stats.appliedPerHa != null ? t('nutrients.stat.appliedHint', { value: fmt.num(stats.appliedPerHa) }) : undefined} />
        <Stat
          icon={ClipboardCheck}
          label={t('nutrients.stat.undocumented')}
          value={fmt.num(stats.undocumented)}
          hint={t('nutrients.stat.undocumentedHint')}
          tone={stats.undocumented ? 'warning' : 'success'}
        />
        <Stat
          icon={AlertTriangle}
          label={t('nutrients.stat.closedPeriod')}
          value={fmt.num(stats.violations)}
          hint={t('nutrients.stat.closedPeriodHint')}
          tone={stats.violations ? 'danger' : 'success'}
        />
      </div>

      <Card title={t('nutrients.balance.title', { season: season.name })} description={t('nutrients.balance.description')} padded={false}>
        <Table aria-label={t('nutrients.balance.title', { season: season.name })}>
          <TableHeader>
            <Column isRowHeader>{t('crops.plan.field')}</Column>
            <Column>{t('crops.plan.crop')}</Column>
            <Column align="end">{t('crops.plan.area')}</Column>
            <Column align="end">{t('nutrients.col.nNeed')}</Column>
            <Column align="end">{t('nutrients.col.nApplied')}</Column>
            <Column align="end">{t('nutrients.col.nPlanned')}</Column>
            <Column align="end">{t('nutrients.col.nRemaining')}</Column>
            <Column align="end">{t('nutrients.col.p2o5')}</Column>
            <Column align="end">{t('nutrients.col.k2o')}</Column>
            <Column>
              <span className="sr-only">{t('common.actions')}</span>
            </Column>
          </TableHeader>
          <TableBody
            items={rows.map((r) => ({ ...r, id: r.cropCycleId }))}
            renderEmptyState={() => (
              <EmptyState icon={Sprout} title={t('nutrients.balance.empty.title')}>
                {t('nutrients.balance.empty.body')}
              </EmptyState>
            )}
          >
            {(r) => (
              <Row id={r.id}>
                <Cell>
                  <Link to="/o/$orgId/fields/$fieldId" params={{ orgId, fieldId: r.fieldId }} className="font-medium">
                    {r.fieldName}
                  </Link>
                  {r.fieldPartName && <div className="text-xs text-muted">{r.fieldPartName}</div>}
                </Cell>
                <Cell>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <CropTag name={r.cropName} color={r.cropColor} />
                    {r.nitrateSensitiveZone && <Badge tone="danger">{t('soil.redZone')}</Badge>}
                    {r.closedPeriodViolations > 0 && (
                      <Badge tone="danger">
                        <AlertTriangle className="size-3" aria-hidden />
                        {t('nutrients.closedPeriod', { count: r.closedPeriodViolations })}
                      </Badge>
                    )}
                  </div>
                </Cell>
                <Cell align="end">{fmt.ha(r.areaHa)}</Cell>
                <Cell align="end">
                  <NeedCell row={r} />
                </Cell>
                <Cell align="end">
                  <Kg value={r.applied.availableN} />
                  {r.applied.organicN != null && r.applied.organicN > 0 && (
                    <div className="text-xs text-muted">{t('nutrients.organicN', { value: fmt.num(r.applied.organicN) })}</div>
                  )}
                </Cell>
                <Cell align="end">
                  <Kg value={r.planned.availableN} className="text-fg-2" />
                </Cell>
                <Cell align="end">
                  <Kg value={r.nRemaining} className={cx('font-medium', r.nRemaining != null && r.nRemaining < 0 && 'text-danger')} />
                  {r.nRemaining != null && r.nRemaining < 0 && <div className="text-xs text-danger">{t('nutrients.aboveNeed')}</div>}
                </Cell>
                <Cell align="end">
                  <NeedVsApplied need={r.p2o5Need} applied={r.applied.p2o5} />
                </Cell>
                <Cell align="end">
                  <NeedVsApplied need={r.k2oNeed} applied={r.applied.k2o} />
                </Cell>
                <Cell>
                  <Button size="sm" variant="quiet" onPress={() => setOpen(r.cropCycleId)}>
                    <FlaskConical /> {t('nutrients.determineNeed')}
                  </Button>
                </Cell>
              </Row>
            )}
          </TableBody>
        </Table>
      </Card>
      <p className="text-xs text-muted">{t('nutrients.balance.footnote', { ruleset: balance.data?.ruleset ?? '' })}</p>

      {open && <FertilizerNeedDialog cropCycleId={open} onClose={() => setOpen(null)} />}
    </div>
  )
}

function NeedCell({ row }: { row: CycleNutrientBalance }) {
  const { t } = useTranslation()
  if (row.nNeed == null) return <span className="text-muted" title={t('nutrients.noDuevValues')}>—</span>
  return (
    <span className="inline-flex flex-col items-end">
      <span className="tabular font-medium">{fmt.num(row.nNeed)}</span>
      {row.nNeedRecorded ? (
        <span className="text-xs text-success inline-flex items-center gap-1">
          <CheckCircle2 className="size-3" aria-hidden /> {t('nutrients.documented')}
        </span>
      ) : (
        <span className="text-xs text-muted">{t('nutrients.calculated')}</span>
      )}
    </span>
  )
}

/** Applied amount over the need: "40 / 65". */
function NeedVsApplied({ need, applied }: { need: number | null; applied: number | null }) {
  if (need == null && applied == null) return <span className="text-muted">—</span>
  return (
    <span className="tabular whitespace-nowrap">
      {fmt.num(applied ?? 0)} <span className="text-muted">/ {fmt.num(need)}</span>
    </span>
  )
}

function SoilOverview() {
  const { t } = useTranslation()
  const { orgId } = useOrg()
  const soil = useOrgQuery<FieldSoilSummary[]>('/soil')
  if (soil.isLoading) return <Loading />
  if (soil.error) return <ErrorNotice error={soil.error} />
  const rows = soil.data ?? []
  const missing = rows.filter((r) => r.basicOutdated).length
  return (
    <div className="space-y-4">
      {missing > 0 && (
        <Notice tone="warning" icon={AlertTriangle}>
          {t('soil.overview.outdated', { count: missing })}
        </Notice>
      )}
      <Card title={t('soil.overview.title')} description={t('soil.overview.description')} padded={false}>
        <Table aria-label={t('soil.overview.title')}>
          <TableHeader>
            <Column isRowHeader>{t('crops.plan.field')}</Column>
            <Column align="end">{t('crops.plan.area')}</Column>
            <Column>{t('soil.texture')}</Column>
            <Column>{t('soil.basicSample')}</Column>
            <Column align="end">pH</Column>
            <Column align="end">P₂O₅</Column>
            <Column align="end">K₂O</Column>
            <Column align="end">MgO</Column>
            <Column align="end">{t('soil.humus')}</Column>
            <Column align="end">{t('soil.nminSample')}</Column>
          </TableHeader>
          <TableBody
            items={rows.map((r) => ({ ...r, id: r.fieldId }))}
            renderEmptyState={() => (
              <EmptyState icon={Layers} title={t('soil.overview.empty')} />
            )}
          >
            {(r) => {
              const b = r.latestBasic
              return (
                <Row id={r.id}>
                  <Cell>
                    <Link to="/o/$orgId/fields/$fieldId" params={{ orgId, fieldId: r.fieldId }} search={{ tab: 'soil' }} className="font-medium">
                      {r.fieldName}
                    </Link>
                    <div className="flex flex-wrap gap-1 mt-0.5">
                      {r.nitrateSensitiveZone && <Badge tone="danger">{t('soil.redZone')}</Badge>}
                      {r.phosphateSensitiveZone && <Badge tone="warning">{t('soil.yellowZone')}</Badge>}
                    </div>
                  </Cell>
                  <Cell align="end">{fmt.ha(r.areaHa)}</Cell>
                  <Cell>{r.soilTexture ? soilTextureLabel(r.soilTexture as SoilTexture) : <span className="text-muted">—</span>}</Cell>
                  <Cell>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="tabular whitespace-nowrap">{b ? fmt.date(b.sampledOn) : <span className="text-muted">{t('soil.noSample')}</span>}</span>
                      {r.basicOutdated && b && <Badge tone="warning">{t('soil.outdated')}</Badge>}
                    </div>
                  </Cell>
                  <Cell align="end"><SoilValue value={b?.ph} cls={b?.classes.ph} /></Cell>
                  <Cell align="end"><SoilValue value={b?.p2o5Mg100g} cls={b?.classes.p} /></Cell>
                  <Cell align="end"><SoilValue value={b?.k2oMg100g} cls={b?.classes.k} /></Cell>
                  <Cell align="end"><SoilValue value={b?.mgoMg100g} cls={b?.classes.mg} /></Cell>
                  <Cell align="end">{b?.humusPct != null ? fmt.pct(b.humusPct, 1) : '—'}</Cell>
                  <Cell align="end">
                    {r.latestNmin ? (
                      <>
                        <span className="tabular">{fmt.num(r.latestNmin.nminTotal)} kg N/ha</span>
                        <div className="text-xs text-muted">{fmt.date(r.latestNmin.sampledOn)}</div>
                      </>
                    ) : (
                      '—'
                    )}
                  </Cell>
                </Row>
              )
            }}
          </TableBody>
        </Table>
      </Card>
      <p className="text-xs text-muted">{t('soil.overview.units')}</p>
    </div>
  )
}
