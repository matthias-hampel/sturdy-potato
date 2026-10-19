import { type CarbonMeasure, type CarbonRecommendationCycle, type CarbonRecommendations, carbonSavingScenarios } from '@agmeo/contracts'
import { Lightbulb } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { StackedColumnChart, type StackedDatum } from '#/components/charts'
import { t } from '#/i18n'
import { fmt } from '#/lib/format'
import { useOrg } from '#/lib/org'
import { useOrgQuery } from '#/lib/queries'
import { Link, SegmentedControl } from '#/ui/Button'
import { Badge, Card, EmptyState, ErrorNotice, Loading } from '#/ui/Layout'
import { formatCo2, PALETTE } from './shared'

const MODES = ['scenario', 'crops', 'all'] as const
type Mode = (typeof MODES)[number]

export const measureLabel = (m: Pick<CarbonMeasure, 'type'>) => t(`carbon.savings.measure.${m.type}`)

/** One measure with the crop cycle it belongs to (the reference's MeasureInfo). */
interface FlatMeasure extends CarbonMeasure {
  key: string
  cycle: CarbonRecommendationCycle
}

export function flattenMeasures(rec: CarbonRecommendations): FlatMeasure[] {
  return rec.cycles.flatMap((c) => c.measures.map((m, i) => ({ ...m, key: `${c.cropCycleId}:${i}`, cycle: c })))
}

/**
 * Savings potential of a harvest year (agmeo `recommendations/[year]`): scenarios of 10–30 %
 * reduction, the potential per crop cycle and in total, the measures and the crop cycles they
 * apply to.
 */
export function Savings({ harvestYear }: { harvestYear: number }) {
  const { t } = useTranslation()
  const [mode, setMode] = useState<Mode>('scenario')
  const rec = useOrgQuery<CarbonRecommendations>('/carbon/recommendations', { harvestYear }, { keepPrevious: true })
  if (rec.isLoading) return <Loading />
  if (rec.error || !rec.data) return <ErrorNotice error={rec.error} />
  const data = rec.data
  const measures = flattenMeasures(data).sort((a, b) => b.savedKg - a.savedKg)
  const series = [
    { name: t('carbon.savings.remaining'), color: PALETTE[1] },
    { name: t('carbon.savings.potential'), color: 'var(--color-success)' },
  ]
  const scenarios = carbonSavingScenarios(data.emissionsKg, measures)
  const withMeasures = data.cycles.filter((c) => c.measures.length)
  const chart: StackedDatum[] =
    mode === 'scenario'
      ? scenarios.map((s, i) => ({
          key: String(i),
          label: s.share == null ? t('carbon.savings.max', { pct: fmt.num(data.emissionsKg ? (100 * s.savedKg) / data.emissionsKg : 0) }) : `${fmt.num(s.share * 100)} %`,
          values: [s.remainingKg, s.savedKg],
        }))
      : mode === 'crops'
        ? withMeasures.map((c) => ({ key: c.cropCycleId, label: `${c.cropName} ${fmt.ha(c.areaHa, 1)}`, values: [c.emissionsKg - c.savingsKg, c.savingsKg] }))
        : [{ key: 'all', label: t('carbon.savings.allFields'), values: [data.emissionsKg - data.savingsKg, data.savingsKg] }]

  if (!data.cycles.length) return <EmptyState icon={Lightbulb} title={t('carbon.savings.noData', { year: harvestYear })} />

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card
        title={t(`carbon.savings.chartTitle.${mode}`)}
        actions={<SegmentedControl aria-label={t('carbon.savings.chartMode')} items={MODES.map((m) => ({ id: m, label: t(`carbon.savings.mode.${m}`) }))} value={mode} onChange={setMode} />}
      >
        <StackedColumnChart data={chart} series={series} format={formatCo2} height={300} ariaLabel={t(`carbon.savings.chartTitle.${mode}`)} />
        <p className="text-xs text-muted mt-2">kg CO₂e</p>
        {mode === 'scenario' && <ScenarioList scenarios={scenarios} measures={measures} total={data.emissionsKg} />}
      </Card>
      <Card title={t('carbon.savings.measuresTitle', { value: fmt.num(data.savingsKg) })}>
        {measures.length === 0 ? (
          <p className="text-sm text-muted">{t('carbon.savings.noMeasures')}</p>
        ) : (
          <ul className="space-y-2 text-sm max-h-[420px] overflow-y-auto">
            {measures.map((m) => (
              <MeasureItem key={m.key} m={m} />
            ))}
          </ul>
        )}
      </Card>
      <Card className="lg:col-span-2" title={t('carbon.savings.byCycle')} padded={false}>
        <CycleTable cycles={withMeasures.length ? withMeasures : data.cycles} />
      </Card>
    </div>
  )
}

function MeasureItem({ m }: { m: FlatMeasure }) {
  const { t } = useTranslation()
  const { orgId } = useOrg()
  return (
    <li className="flex items-start gap-3 rounded-md border border-line px-3 py-2">
      <Lightbulb className="size-4 mt-0.5 shrink-0 text-accent" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="font-medium">{measureLabel(m)}</div>
        <div className="text-xs text-muted">
          {m.cycle.cropName} · {m.cycle.fieldName} · {fmt.ha(m.cycle.areaHa, 1)}
          {m.productName ? ` · ${m.productName}` : ''}
          {m.date ? ` · ${fmt.date(m.date)}` : ''}
          {m.operationId && (
            <>
              {' · '}
              <Link to="/o/$orgId/operations/$operationId" params={{ orgId, operationId: m.operationId }} variant="quiet" size="sm">
                {m.operationTitle ?? t('carbon.savings.operation')}
              </Link>
            </>
          )}
        </div>
      </div>
      <div className="text-right tabular shrink-0">
        <div className="font-medium">−{fmt.num(m.savedKg)} kg</div>
        <div className="text-xs text-muted">{fmt.num(m.savedKgPerHa, 1)} kg/ha</div>
      </div>
    </li>
  )
}

function ScenarioList({ scenarios, measures, total }: { scenarios: ReturnType<typeof carbonSavingScenarios>; measures: FlatMeasure[]; total: number }) {
  const { t } = useTranslation()
  const byKey = new Map(measures.map((m) => [m.key, m]))
  const shown = scenarios.filter((s) => s.measures.length)
  if (!shown.length) return null
  return (
    <div className="mt-4 space-y-3 text-sm">
      {shown.map((s, i) => (
        <div key={i}>
          <div className="font-medium">
            {s.share == null ? t('carbon.savings.max', { pct: fmt.num(total ? (100 * s.savedKg) / total : 0) }) : `${fmt.num(s.share * 100)} %`} · −{fmt.num(s.savedKg)} kg CO₂e
          </div>
          <ul className="ml-4 list-disc text-fg-2">
            {s.measures.map((x) => {
              const m = byKey.get(x.key)!
              return (
                <li key={x.key}>
                  [{m.cycle.cropName} {fmt.ha(m.cycle.areaHa, 1)}] {measureLabel(m)} ({x.countedKg < x.savedKg - 0.05 ? `${fmt.num(x.countedKg)}/${fmt.num(x.savedKg)}` : fmt.num(x.savedKg)} kg CO₂e)
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </div>
  )
}

function CycleTable({ cycles }: { cycles: CarbonRecommendationCycle[] }) {
  const { t } = useTranslation()
  const { orgId } = useOrg()
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs text-muted">
            <th className="px-4 py-2 font-medium">{t('carbon.savings.col.field')}</th>
            <th className="px-4 py-2 font-medium">{t('carbon.savings.col.crop')}</th>
            <th className="px-4 py-2 font-medium">{t('carbon.savings.col.template')}</th>
            <th className="px-4 py-2 font-medium text-right">{t('carbon.savings.col.area')}</th>
            <th className="px-4 py-2 font-medium text-right">{t('carbon.savings.col.yield')}</th>
            <th className="px-4 py-2 font-medium text-right">{t('carbon.savings.col.emissions')}</th>
            <th className="px-4 py-2 font-medium text-right">{t('carbon.savings.col.savings')}</th>
            <th className="px-4 py-2 font-medium">{t('carbon.savings.col.measures')}</th>
          </tr>
        </thead>
        <tbody>
          {cycles.map((c) => (
            <tr key={c.cropCycleId} className="border-b border-line last:border-0 align-top">
              <td className="px-4 py-2">
                <Link to="/o/$orgId/crops/$cropCycleId" params={{ orgId, cropCycleId: c.cropCycleId }} className="font-medium">
                  {c.fieldName}
                </Link>
              </td>
              <td className="px-4 py-2">
                <Badge dot={c.cropColor}>{c.cropName}</Badge>
              </td>
              <td className="px-4 py-2">{c.templateName ?? '—'}</td>
              <td className="px-4 py-2 text-right tabular">{fmt.ha(c.areaHa)}</td>
              <td className="px-4 py-2 text-right tabular">{c.yieldTHa != null ? `${fmt.num(c.yieldTHa, 1)} t/ha` : '—'}</td>
              <td className="px-4 py-2 text-right tabular">{fmt.num(c.emissionsKg)} kg</td>
              <td className="px-4 py-2 text-right tabular font-medium">{c.savingsKg ? `−${fmt.num(c.savingsKg)} kg` : '—'}</td>
              <td className="px-4 py-2">{c.measures.map((m) => measureLabel(m)).join('; ') || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
