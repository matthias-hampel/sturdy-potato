import { BEK_GROUPS, type CarbonAnalysis, type CarbonEvaluation, type CarbonLevel, type CarbonReportRow, GHG_PROTOCOL_GROUPS, ghgProtocolSplit, OPERATION_TYPES } from '@agmeo/contracts'
import { HelpCircle } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DonutChart, Legend, StackedColumnChart, type StackedDatum } from '#/components/charts'
import { fmt } from '#/lib/format'
import { Button } from '#/ui/Button'
import { Checkbox, NumberField, Option, Select } from '#/ui/Field'
import { Card, EmptyState } from '#/ui/Layout'
import { Tooltip } from '#/ui/Overlay'
import { entityLabel, evaluationUnit, formatCo2, opTypeLabel, PALETTE, per, presentSources, sourceColor, sourceLabel } from './shared'

const ALL = '__all'

/** Year chips to leave years out of a chart. */
export function YearFilter({ years, hidden, onChange }: { years: number[]; hidden: number[]; onChange: (hidden: number[]) => void }) {
  const { t } = useTranslation()
  if (years.length < 2) return null
  return (
    <div className="flex flex-wrap items-center gap-3" role="group" aria-label={t('carbon.selectYears')}>
      {years.map((y) => (
        <Checkbox key={y} isSelected={!hidden.includes(y)} onChange={(on) => onChange(on ? hidden.filter((h) => h !== y) : [...hidden, y])}>
          {y}
        </Checkbox>
      ))}
    </div>
  )
}

export function CropFilter({ rows, value, onChange, label }: { rows: CarbonReportRow[]; value: string; onChange: (v: string) => void; label?: string }) {
  const { t } = useTranslation()
  const crops = [...new Map(rows.map((r) => [r.cropId, r.cropName])).entries()].sort((a, b) => a[1].localeCompare(b[1]))
  return (
    <Select aria-label={label ?? t('carbon.crop')} className="w-48" items={[{ id: ALL, name: t('carbon.allCrops') }, ...crops.map(([id, name]) => ({ id, name }))]} value={value} onChange={(v) => onChange(String(v ?? ALL))}>
      {(c) => <Option id={c.id}>{c.name}</Option>}
    </Select>
  )
}

export const cropMatches = (r: CarbonReportRow, crop: string) => crop === ALL || r.cropId === crop
export { ALL as ALL_CROPS }

export function AnalysisDashboard({
  analysis,
  rows,
  level,
  evaluation,
  withoutCredits,
}: {
  analysis: CarbonAnalysis
  rows: CarbonReportRow[]
  level: CarbonLevel
  evaluation: CarbonEvaluation
  withoutCredits: boolean
}) {
  const { t } = useTranslation()
  const years = [...new Set(rows.map((r) => r.year))].sort((a, b) => a - b)
  const latest = years[years.length - 1]
  const unit = evaluationUnit(evaluation)
  const fmtV = (v: number) => formatCo2(v)

  // Yearly comparison
  const [yearHidden, setYearHidden] = useState<number[]>([])
  const [yearCrop, setYearCrop] = useState(ALL)
  const yearData: StackedDatum[] = rows
    .filter((r) => !yearHidden.includes(r.year) && cropMatches(r, yearCrop))
    .map((r) => {
      const ref = analysis.regionalReference[r.cropCode]
      return {
        key: r.key,
        label: `${entityLabel(r, level)} ${r.year}`,
        values: [per(r.total, r, evaluation)],
        // The reference is per t dry matter; shown on that basis only, as in the reference app.
        reference: evaluation === 'perYieldDm' && ref != null ? ref : null,
        annotation: evaluation === 'total' && r.areaHa ? fmt.ha(r.areaHa, 0) : undefined,
      }
    })

  // By operation type
  const [opYear, setOpYear] = useState<number | null>(null)
  const [opCrop, setOpCrop] = useState(ALL)
  const [opType, setOpType] = useState(ALL)
  const opYearValue = opYear ?? latest
  const opRows = rows.filter((r) => r.year === opYearValue && cropMatches(r, opCrop))
  const types = OPERATION_TYPES.filter((type) => (opType === ALL || type === opType) && opRows.some((r) => r.byOperationType[type]))
  const opSeries = types.map((type, i) => ({ name: opTypeLabel(type), color: PALETTE[i % PALETTE.length] }))
  const opData: StackedDatum[] = opRows.map((r) => ({ key: r.key, label: entityLabel(r, level), values: types.map((type) => per(r.byOperationType[type] ?? 0, r, evaluation)) }))

  // Emission sources
  const [srcHidden, setSrcHidden] = useState<number[]>([])
  const [srcCrop, setSrcCrop] = useState(ALL)
  const [mode, setMode] = useState<'detail' | 'sum' | 'ghgProtocol'>('detail')
  const [threshold, setThreshold] = useState(0)
  const srcRows = rows.filter((r) => !srcHidden.includes(r.year) && cropMatches(r, srcCrop))
  const sourceChart = useMemo(() => {
    const label = (r: CarbonReportRow) => `${entityLabel(r, level)} ${r.year}`
    if (mode === 'sum') {
      const colors = ['#fd7f6f', '#7eb0d5', '#b2e061']
      return {
        series: BEK_GROUPS.map((g, i) => ({ name: t(`carbon.group.${g}`), color: colors[i] })),
        data: srcRows.map((r) => ({ key: r.key, label: label(r), values: BEK_GROUPS.map((g) => per(r[g], r, evaluation)) })),
      }
    }
    if (mode === 'ghgProtocol') {
      return {
        series: GHG_PROTOCOL_GROUPS.map((g, i) => ({ name: t(`carbon.ghg.${g}`), color: PALETTE[i] })),
        data: srcRows.map((r) => {
          const split = ghgProtocolSplit(r.bySource)
          return { key: r.key, label: label(r), values: GHG_PROTOCOL_GROUPS.map((g) => per(split[g], r, evaluation)) }
        }),
      }
    }
    const sources = presentSources(srcRows, threshold)
    return {
      series: sources.map((s) => ({ name: `${s.toUpperCase()} · ${sourceLabel(s)}`, color: sourceColor(s) })),
      data: srcRows.map((r) => ({ key: r.key, label: label(r), values: sources.map((s) => per(r.bySource[s] ?? 0, r, evaluation)) })),
    }
  }, [srcRows, mode, threshold, evaluation, level, t])

  // Farm overview: shares of the emissions per year (negative totals left out).
  const donutYears = years.slice(-4)

  if (!rows.length) {
    return (
      <Card>
        <EmptyState title={t('carbon.empty.title')}>{t('carbon.empty.body')}</EmptyState>
      </Card>
    )
  }

  return (
    <div className="grid lg:grid-cols-2 gap-6">
      <Card title={t('carbon.yearlyComparison')} actions={<CropFilter rows={rows} value={yearCrop} onChange={setYearCrop} />}>
        <div className="space-y-3">
          <YearFilter years={years} hidden={yearHidden} onChange={setYearHidden} />
          <StackedColumnChart
            data={yearData}
            series={[{ name: t(`carbon.chart.${evaluation}`), color: 'var(--color-series-1)' }]}
            format={fmtV}
            ariaLabel={t('carbon.yearlyComparison')}
            referenceLabel={t('carbon.regionalReference')}
          />
          {evaluation === 'perYieldDm' && !analysis.nuts2Code && <p className="text-xs text-muted">{t('carbon.regionHint')}</p>}
          <p className="text-xs text-muted">{unit}</p>
        </div>
      </Card>

      {!withoutCredits && (
        <Card
          title={t('carbon.byOperations')}
          actions={
            <div className="flex flex-wrap gap-2">
              <CropFilter rows={rows.filter((r) => r.year === opYearValue)} value={opCrop} onChange={setOpCrop} />
              <Select aria-label={t('carbon.operationType')} className="w-40" items={[{ id: ALL, name: t('carbon.allOperations') }, ...OPERATION_TYPES.map((o) => ({ id: o, name: opTypeLabel(o) }))]} value={opType} onChange={(v) => setOpType(String(v ?? ALL))}>
                {(o) => <Option id={o.id}>{o.name}</Option>}
              </Select>
              <Select aria-label={t('carbon.year')} className="w-24" items={years.map((y) => ({ id: y, name: String(y) }))} value={opYearValue} onChange={(v) => v != null && setOpYear(Number(v))}>
                {(y) => <Option id={y.id}>{y.name}</Option>}
              </Select>
            </div>
          }
        >
          <StackedColumnChart data={opData} series={opSeries} format={fmtV} ariaLabel={t('carbon.byOperations')} />
          <p className="text-xs text-muted mt-2">{unit}</p>
        </Card>
      )}

      <Card
        title={t('carbon.farmOverview')}
        actions={
          <Tooltip content={t('carbon.negativeLeftOut')}>
            <Button variant="ghost" size="icon-xs" aria-label={t('carbon.negativeLeftOut')}>
              <HelpCircle />
            </Button>
          </Tooltip>
        }
      >
        <FarmOverview rows={rows} years={donutYears} level={level} />
      </Card>

      <Card
        className="lg:col-span-2"
        title={t('carbon.emissionSources')}
        actions={
          <div className="flex flex-wrap items-end gap-2">
            <CropFilter rows={rows} value={srcCrop} onChange={setSrcCrop} />
            {mode === 'detail' && (
              <NumberField label={t('carbon.thresholdLabel')} className="w-40" minValue={0} maxValue={8000} value={threshold} onChange={(v) => setThreshold(Number.isNaN(v) ? 0 : v)} />
            )}
            <Select aria-label={t('carbon.mode')} className="w-44" items={(['detail', 'sum', 'ghgProtocol'] as const).map((m) => ({ id: m, name: t(`carbon.mode.${m}`) }))} value={mode} onChange={(v) => v && setMode(v as typeof mode)}>
              {(m) => <Option id={m.id}>{m.name}</Option>}
            </Select>
          </div>
        }
      >
        <div className="space-y-3">
          <YearFilter years={years} hidden={srcHidden} onChange={setSrcHidden} />
          <StackedColumnChart data={sourceChart.data} series={sourceChart.series} format={fmtV} height={360} ariaLabel={t('carbon.emissionSources')} />
          <p className="text-xs text-muted">{unit}</p>
        </div>
      </Card>
    </div>
  )
}

function FarmOverview({ rows, years, level }: { rows: CarbonReportRow[]; years: number[]; level: CarbonLevel }) {
  const { t } = useTranslation()
  const groups = years.map((year) => {
    const byKey = new Map<string, { label: string; value: number; color: string }>()
    for (const r of rows.filter((x) => x.year === year)) {
      const key = level === 'template' ? r.entityId : r.cropId
      const label = level === 'template' ? entityLabel(r, level) : r.cropName
      const cur = byKey.get(key) ?? { label, value: 0, color: r.cropColor }
      cur.value += r.total
      byKey.set(key, cur)
    }
    return { year, items: [...byKey.entries()].map(([key, v]) => ({ key, ...v })).filter((i) => i.value >= 0) }
  })
  const legend = [...new Map(groups.flatMap((g) => g.items.map((i) => [i.label, i.color] as const))).entries()].map(([name, color]) => ({ name, color }))
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-4 justify-items-center">
        {groups.map((g) => (
          <DonutChart key={g.year} items={g.items} format={(v) => `${fmt.num(v / 1000, 1)} t`} centerLabel={String(g.year)} ariaLabel={`${t('carbon.farmOverview')} ${g.year}`} />
        ))}
      </div>
      <Legend series={legend} />
    </div>
  )
}
