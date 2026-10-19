import { CARBON_EVALUATIONS, CARBON_LEVELS, type CarbonAnalysis, type CarbonEvaluation, type CarbonLevel, type CarbonSettings, type CarbonSettingsInput } from '@agmeo/contracts'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Factory, Info, Leaf, MapPin, Sprout, Zap } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'
import { AnalysisDashboard } from '#/components/carbon/AnalysisDashboard'
import { AnalysisTable } from '#/components/carbon/AnalysisTable'
import { FarmComparison } from '#/components/carbon/FarmComparison'
import { Scope2Button } from '#/components/carbon/Scope2Dialog'
import { withoutCredits } from '#/components/carbon/shared'
import { api } from '#/lib/api'
import { fmt } from '#/lib/format'
import { useOrg, useSeason } from '#/lib/org'
import { useOrgMutation, useOrgQuery } from '#/lib/queries'
import { Link, SegmentedControl } from '#/ui/Button'
import { Option, Select, Switch } from '#/ui/Field'
import { ErrorNotice, Loading, Notice, PageHeader, Stat, Tab, TabList, TabPanel, Tabs } from '#/ui/Layout'

const TABS = ['dashboard', 'table', 'comparison'] as const
type CarbonTab = (typeof TABS)[number]

export const Route = createFileRoute('/o/$orgId/carbon')({
  validateSearch: z.object({
    tab: z.enum(TABS).optional(),
    level: z.enum(CARBON_LEVELS).optional(),
    evaluation: z.enum(CARBON_EVALUATIONS).optional(),
  }),
  component: CarbonPage,
})

/**
 * Greenhouse-gas balance of the farm after the BEK method (agmeo `analysis/[year]`): yearly
 * comparison with the regional reference, by operation type and emission source, farm overview,
 * table with Excel export, scope 2 and the comparison of the user's farms.
 */
function CarbonPage() {
  const { t } = useTranslation()
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const level: CarbonLevel = search.level ?? 'crop'
  const evaluation: CarbonEvaluation = search.evaluation ?? 'total'
  const [noCredits, setNoCredits] = useState(false)
  const { season } = useSeason()
  const { orgId } = useOrg()
  const analysis = useOrgQuery<CarbonAnalysis>('/carbon/analysis', { level }, { keepPrevious: true })
  const set = (patch: Partial<typeof search>) => navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true })

  const data = analysis.data
  const rows = data ? (noCredits ? withoutCredits(data.rows) : data.rows) : []
  const years = [...new Set(rows.map((r) => r.year))].sort((a, b) => a - b)
  const harvestYear = season?.harvestYear ?? years[years.length - 1] ?? new Date().getFullYear()

  return (
    <>
      <PageHeader
        title={t('carbon.title')}
        subtitle={t('carbon.subtitle')}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <RegionSelect />
            <Scope2Button harvestYear={harvestYear} />
          </div>
        }
      />
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <SegmentedControl
          aria-label={t('carbon.level')}
          items={CARBON_LEVELS.map((l) => ({ id: l, label: t(`carbon.levels.${l}`) }))}
          value={level}
          onChange={(l) => set({ level: l === 'crop' ? undefined : l })}
        />
        <SegmentedControl
          aria-label={t('carbon.evaluation')}
          items={CARBON_EVALUATIONS.map((e) => ({ id: e, label: t(`carbon.evaluations.${e}`) }))}
          value={evaluation}
          onChange={(e) => set({ evaluation: e === 'total' ? undefined : e })}
        />
        <Switch isSelected={noCredits} onChange={setNoCredits}>
          {t('carbon.withoutCredits')}
        </Switch>
      </div>
      {analysis.isLoading ? (
        <Loading />
      ) : analysis.error || !data ? (
        <ErrorNotice error={analysis.error} />
      ) : (
        <div className="space-y-6">
          <YearStats analysis={data} rows={rows} harvestYear={harvestYear} />
          <Tabs selectedKey={search.tab ?? 'dashboard'} onSelectionChange={(k) => set({ tab: k === 'dashboard' ? undefined : (k as CarbonTab) })}>
            <TabList aria-label={t('carbon.title')}>
              <Tab id="dashboard">{t('carbon.tabs.dashboard')}</Tab>
              <Tab id="table">{t('carbon.tabs.table')}</Tab>
              <Tab id="comparison">{t('carbon.tabs.comparison')}</Tab>
            </TabList>
            <TabPanel id="dashboard">
              <AnalysisDashboard analysis={data} rows={rows} level={level} evaluation={evaluation} withoutCredits={noCredits} />
            </TabPanel>
            <TabPanel id="table">
              <AnalysisTable rows={rows} level={level} evaluation={evaluation} years={years.length ? years : [harvestYear]} />
            </TabPanel>
            <TabPanel id="comparison">
              <FarmComparison evaluation={evaluation} noCredits={noCredits} />
            </TabPanel>
          </Tabs>
          <Notice tone="info" icon={Info}>
            {t('carbon.methodNotice', { factorSet: data.factorSet })}{' '}
            <Link to="/o/$orgId/prices" params={{ orgId }} variant="quiet" size="sm">
              {t('carbon.parametersLink')}
            </Link>
          </Notice>
        </div>
      )}
    </>
  )
}

function YearStats({ analysis, rows, harvestYear }: { analysis: CarbonAnalysis; rows: CarbonAnalysis['rows']; harvestYear: number }) {
  const { t } = useTranslation()
  const year = rows.some((r) => r.year === harvestYear) ? harvestYear : Math.max(harvestYear, ...rows.map((r) => r.year))
  const own = rows.filter((r) => r.year === year)
  const total = own.reduce((s, r) => s + r.total, 0)
  const area = own.reduce((s, r) => s + r.areaHa, 0)
  const scope2 = analysis.scope2.find((s) => s.harvestYear === year)?.totalKg ?? 0
  const unallocated = analysis.unallocatedKg[String(year)] ?? 0
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <Stat icon={Leaf} label={t('carbon.stats.total', { year })} value={`${fmt.num(total / 1000, 1)} t CO₂e`} hint={t('carbon.stats.fields', { count: own.reduce((s, r) => s + r.cyclesCount, 0) })} />
        <Stat icon={Sprout} label={t('carbon.stats.perHa')} value={area ? `${fmt.num(total / area)} kg CO₂e/ha` : '—'} hint={fmt.ha(area, 1)} />
        <Stat icon={Zap} label={t('carbon.stats.scope2')} value={`${fmt.num(scope2 / 1000, 1)} t CO₂e`} hint={t('carbon.stats.scope2Hint')} />
        <Stat icon={Factory} label={t('carbon.stats.farmTotal')} value={`${fmt.num((total + scope2 + unallocated) / 1000, 1)} t CO₂e`} hint={unallocated ? t('carbon.stats.unallocated', { value: fmt.num(unallocated) }) : t('carbon.stats.farmTotalHint')} />
      </div>
      {own.some((r) => !r.hasModelData) && (
        <Notice tone="warning">{t('carbon.noModelDataNotice', { crops: [...new Set(own.filter((r) => !r.hasModelData).map((r) => r.cropName))].join(', ') })}</Notice>
      )}
    </div>
  )
}

function RegionSelect() {
  const { t } = useTranslation()
  const { can } = useOrg()
  const settings = useOrgQuery<CarbonSettings>('/carbon/settings', undefined, { staleTime: 60_000 })
  const save = useOrgMutation((base, input: CarbonSettingsInput) => api.put<CarbonSettings>(`${base}/carbon/settings`, input), { success: t('carbon.region.saved') })
  if (!settings.data) return null
  const value = settings.data.nuts2Code ?? settings.data.suggestedNuts2Code ?? null
  return (
    <div className="flex items-center gap-2">
      <MapPin className="size-4 text-muted" aria-hidden />
      <Select
        aria-label={t('carbon.region.label')}
        placeholder={t('carbon.region.placeholder')}
        className="w-56"
        isDisabled={!can('farm.write')}
        items={settings.data.regions.map((r) => ({ id: r.code, name: `${r.name} (${r.code})` }))}
        value={value}
        onChange={(v) => v && v !== settings.data.nuts2Code && save.mutate({ nuts2Code: String(v) })}
      >
        {(r) => <Option id={r.id}>{r.name}</Option>}
      </Select>
    </div>
  )
}
