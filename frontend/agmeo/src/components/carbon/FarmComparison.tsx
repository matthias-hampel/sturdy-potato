import type { CarbonComparison, CarbonComparisonRow, CarbonEvaluation } from '@agmeo/contracts'
import { Download } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ColumnChart } from '#/components/charts'
import { useOrg } from '#/lib/org'
import { useOrgQuery } from '#/lib/queries'
import { Button } from '#/ui/Button'
import { Checkbox, Option, Select } from '#/ui/Field'
import { Card, EmptyState, ErrorNotice, Loading } from '#/ui/Layout'
import { YearFilter } from './AnalysisDashboard'
import { exportComparison } from './exports'
import { evaluationUnit, formatCo2, PALETTE, per, withoutCredits } from './shared'

/**
 * Farm comparison (agmeo "Projekt" level): the crop-level balance of several organizations the user
 * belongs to, per year, and the multi-sheet Excel export.
 */
export function FarmComparison({ evaluation, noCredits }: { evaluation: CarbonEvaluation; noCredits: boolean }) {
  const { t } = useTranslation()
  const { orgId } = useOrg()
  const orgs = useOrgQuery<{ id: string; name: string }[]>('/carbon/organizations', undefined, { staleTime: 60_000 })
  const [chosen, setChosen] = useState<string[] | null>(null)
  const selected = chosen ?? (orgs.data ?? []).map((o) => o.id)
  const cmp = useOrgQuery<CarbonComparison>('/carbon/comparison', { orgIds: selected.filter((id) => id !== orgId).join(',') }, { enabled: orgs.isSuccess, keepPrevious: true })
  const [crop, setCrop] = useState<string | null>(null)
  const [hidden, setHidden] = useState<number[]>([])

  if (orgs.isLoading) return <Loading />
  if (orgs.error) return <ErrorNotice error={orgs.error} />
  const rawRows: CarbonComparisonRow[] = (cmp.data?.rows ?? []).filter((r) => selected.includes(r.orgId))
  const rows = noCredits ? (withoutCredits(rawRows) as CarbonComparisonRow[]) : rawRows
  const crops = [...new Map(rows.map((r) => [r.cropCode, r.cropName])).entries()].sort((a, b) => a[1].localeCompare(b[1]))
  const cropCode = crop ?? crops[0]?.[0] ?? null
  const years = [...new Set(rows.map((r) => r.year))].sort((a, b) => a - b)
  const organizations = (cmp.data?.organizations ?? []).filter((o) => selected.includes(o.id))
  const series = organizations.map((o, i) => ({ name: o.name, color: PALETTE[i % PALETTE.length] }))
  const data = years
    .filter((y) => !hidden.includes(y))
    .map((year) => ({
      key: String(year),
      label: String(year),
      values: organizations.map((o) => {
        const sel = rows.filter((r) => r.orgId === o.id && r.year === year && r.cropCode === cropCode)
        if (!sel.length) return null
        const agg = sel.reduce((a, r) => ({ total: a.total + r.total, areaHa: a.areaHa + r.areaHa, yieldT: a.yieldT + r.yieldT, yieldTDm: a.yieldTDm + r.yieldTDm }), { total: 0, areaHa: 0, yieldT: 0, yieldTDm: 0 })
        return per(agg.total, agg, evaluation)
      }),
    }))

  return (
    <div className="space-y-4">
      <Card title={t('carbon.comparison.organizations')} description={t('carbon.comparison.description')}>
        <div className="flex flex-wrap items-center gap-4">
          {(orgs.data ?? []).map((o) => (
            <Checkbox key={o.id} isSelected={selected.includes(o.id)} isDisabled={o.id === orgId} onChange={(on) => setChosen(on ? [...selected, o.id] : selected.filter((id) => id !== o.id))}>
              {o.name}
            </Checkbox>
          ))}
          <Button className="ml-auto" isDisabled={!rows.length || !cmp.data} onPress={() => cmp.data && exportComparison(cmp.data, rows, cmp.data.scope2.filter((s) => selected.includes(s.orgId)))}>
            <Download /> {t('carbon.downloadXlsx')}
          </Button>
        </div>
      </Card>
      <Card
        title={t('carbon.farmComparison')}
        actions={
          crops.length > 0 && (
            <Select aria-label={t('carbon.crop')} className="w-48" items={crops.map(([id, name]) => ({ id, name }))} value={cropCode} onChange={(v) => v && setCrop(String(v))}>
              {(c) => <Option id={c.id}>{c.name}</Option>}
            </Select>
          )
        }
      >
        {cmp.isLoading ? (
          <Loading />
        ) : cmp.error ? (
          <ErrorNotice error={cmp.error} />
        ) : !rows.length ? (
          <EmptyState title={t('carbon.empty.title')}>{t('carbon.empty.body')}</EmptyState>
        ) : (
          <div className="space-y-3">
            <YearFilter years={years} hidden={hidden} onChange={setHidden} />
            <ColumnChart data={data} series={series} format={formatCo2} height={300} ariaLabel={t('carbon.farmComparison')} />
            <p className="text-xs text-muted">{evaluationUnit(evaluation)}</p>
          </div>
        )}
      </Card>
    </div>
  )
}
