import { buildSoilAnalysisSummary, type ContentClass, type SoilAnalysisPayload, type StageCount } from '@agmeo/contracts'
import { BarChart3, FlaskConical, Mountain, Sprout } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { soilTextureLabel } from '#/i18n/labels.agronomy'
import { fmt } from '#/lib/format'
import { useOrgQuery } from '#/lib/queries'
import { Button } from '#/ui/Button'
import { Checkbox, SearchField } from '#/ui/Field'
import { Card, EmptyState, ErrorNotice, Loading, Stat } from '#/ui/Layout'
import { Cell, Column, Row, Table, TableBody, TableHeader } from '#/ui/Table'
import { Dialog, DialogTrigger, Popover } from 'react-aria-components'
import { paramLabel, paramValue, STAGE_COLORS } from './soilLabels'

const STAGES: ContentClass[] = ['A', 'B', 'C', 'D', 'E']

/**
 * Soil analysis dashboard (reference: soil/analyse): averages, VDLUFA class distribution of the
 * sampled zones, lime need, recommendations and per-field averages, for all or selected fields.
 */
export function AnalysisDashboard() {
  const { t } = useTranslation()
  const payload = useOrgQuery<SoilAnalysisPayload>('/soil/analysis')
  const [selected, setSelected] = useState<Set<string> | null>(null)
  const ids = useMemo(() => selected ?? new Set(payload.data?.fields.map((f) => f.id) ?? []), [selected, payload.data])
  const summary = useMemo(() => (payload.data ? buildSoilAnalysisSummary(payload.data, ids) : null), [payload.data, ids])

  if (payload.isLoading) return <Loading />
  if (payload.error) return <ErrorNotice error={payload.error} />
  if (!payload.data?.fields.length || !summary)
    return (
      <Card>
        <EmptyState icon={BarChart3} title={t('soil.analyse.empty')} />
      </Card>
    )

  const years =
    summary.earliestYear == null
      ? ''
      : summary.earliestYear === summary.latestYear
        ? t('soil.analyse.dateRange.single', { year: summary.earliestYear })
        : t('soil.analyse.dateRange.span', { earliest: summary.earliestYear, latest: summary.latestYear })

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-fg-2 mr-auto">
          {t('soil.analyse.subtitle')} {years && `· ${years}`}
        </p>
        <FieldFilter fields={payload.data.fields} selected={ids} onChange={setSelected} />
      </div>
      {summary.sampleCount === 0 ? (
        <Card>
          <EmptyState title={t('soil.analyse.emptySelection')} />
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
            <Stat icon={FlaskConical} label={t('soil.analyse.kpi.avgPh')} value={paramValue('ph', summary.avg.ph)} />
            <Stat label={t('soil.analyse.kpi.avgP')} value={`${paramValue('p2o5', summary.avg.p2o5)} mg/100 g`} hint={paramLabel('p2o5')} />
            <Stat label={t('soil.analyse.kpi.avgK')} value={`${paramValue('k2o', summary.avg.k2o)} mg/100 g`} hint={paramLabel('k2o')} />
            <Stat label={t('soil.analyse.kpi.avgMg')} value={`${paramValue('mgo', summary.avg.mgo)} mg/100 g`} hint={paramLabel('mgo')} />
            <Stat icon={Sprout} label={t('soil.analyse.kpi.avgHumus')} value={summary.avg.humus != null ? fmt.pct(summary.avg.humus, 1) : '—'} hint={summary.humusClass ? t(`soil.analyse.humusGauge.class${summary.humusClass[0].toUpperCase()}${summary.humusClass.slice(1)}`) : undefined} />
            <Stat icon={Mountain} label={t('soil.analyse.kpi.dominantBodenart')} value={summary.dominantSoilTexture ? soilTextureLabel(summary.dominantSoilTexture as never) : '—'} />
            <Stat label={t('soil.analyse.kpi.kalkbedarf')} value={summary.totalLimeT != null ? `${fmt.num(summary.totalLimeT, 1)} t CaO` : '—'} hint={t('soil.analyse.kpi.kalkbedarfHint')} />
            <Stat label={t('soil.analyse.kpi.sampleCount')} value={fmt.num(summary.sampleCount)} hint={t('soil.analyse.kpi.fieldCountInline', { count: summary.fieldCount, total: summary.totalFieldCount })} />
          </div>
          <div className="grid lg:grid-cols-2 gap-4">
            <Card title={t('soil.analyse.stages')}>
              <div className="space-y-4">
                {(['ph', 'p2o5', 'k2o', 'mgo'] as const).map((p) => (
                  <StageBar key={p} label={paramLabel(p)} counts={summary.stages[p]} />
                ))}
                <div className="flex flex-wrap gap-3 text-xs text-muted">
                  {STAGES.map((s) => (
                    <span key={s} className="inline-flex items-center gap-1">
                      <span className="size-2.5 rounded-sm" style={{ background: STAGE_COLORS[s] }} /> {t(`soil.analyse.donut.stage${s}`)}
                    </span>
                  ))}
                </div>
              </div>
            </Card>
            <Card title={t('soil.analyse.recommendations.title')}>
              {summary.recommendations.length ? (
                <ul className="space-y-2 text-sm">
                  {summary.recommendations.map((r) => (
                    <li key={r.key} className="flex gap-2">
                      <span className={r.priority === 'high' ? 'text-danger' : r.priority === 'mid' ? 'text-warning' : 'text-success'}>●</span>
                      <span>{t(`soil.analyse.rec.${r.key}`, { count: r.fields.length, fields: r.fields.slice(0, 5).join(', ') + (r.fields.length > 5 ? ` (${t('soil.analyse.rec.moreFields', { count: r.fields.length - 5 })})` : '') })}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted">{t('soil.analyse.recommendations.none')}</p>
              )}
            </Card>
          </div>
          <Card title={t('soil.analyse.table.title')} padded={false}>
            <Table aria-label={t('soil.analyse.table.title')}>
              <TableHeader>
                <Column isRowHeader>{t('soil.analyse.table.field')}</Column>
                <Column align="end">{t('soil.analyse.table.sampleCount')}</Column>
                {(['ph', 'p2o5', 'k2o', 'mgo', 'humus'] as const).map((p) => (
                  <Column key={p} align="end">
                    {paramLabel(p)}
                  </Column>
                ))}
                <Column align="end">{t('soil.analyse.table.kalkbedarf')}</Column>
              </TableHeader>
              <TableBody items={summary.perField.map((r) => ({ ...r, id: r.fieldId }))}>
                {(r) => (
                  <Row id={r.id}>
                    <Cell>{r.fieldName}</Cell>
                    <Cell align="end">{r.sampleCount}</Cell>
                    {(['ph', 'p2o5', 'k2o', 'mgo', 'humus'] as const).map((p) => (
                      <Cell key={p} align="end">
                        {paramValue(p, r.avg[p])}
                      </Cell>
                    ))}
                    <Cell align="end">{r.limeDt != null ? `${fmt.num(r.limeDt, 1)} dt` : '—'}</Cell>
                  </Row>
                )}
              </TableBody>
            </Table>
            <p className="px-4 py-2 text-xs text-muted">{t('soil.analyse.table.footer')}</p>
          </Card>
        </>
      )}
    </div>
  )
}

function StageBar({ label, counts }: { label: string; counts: StageCount }) {
  const { t } = useTranslation()
  const total = STAGES.reduce((s, k) => s + counts[k], 0)
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-sm">
        <span className="font-medium text-fg">{label}</span>
        <span className="text-muted text-xs">{t('soil.analyse.donut.measuredFooter', { measured: total, total })}</span>
      </div>
      <div className="flex h-3 rounded-full overflow-hidden bg-surface-2" role="img" aria-label={STAGES.map((s) => `${s}: ${counts[s]}`).join(', ')}>
        {total > 0 && STAGES.map((s) => counts[s] > 0 && <span key={s} title={`${s}: ${counts[s]}`} style={{ width: `${(counts[s] / total) * 100}%`, background: STAGE_COLORS[s] }} />)}
      </div>
    </div>
  )
}

function FieldFilter({ fields, selected, onChange }: { fields: { id: string; name: string; sampleCount: number }[]; selected: Set<string>; onChange: (s: Set<string>) => void }) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const shown = fields.filter((f) => f.name.toLowerCase().includes(query.trim().toLowerCase()))
  const label = selected.size === fields.length ? t('soil.analyse.fieldFilter.all') : t('soil.analyse.fieldFilter.selected', { count: selected.size, total: fields.length })
  return (
    <DialogTrigger>
      <Button>{label}</Button>
      <Popover placement="bottom end" className="w-72 rounded-xl border border-line bg-surface p-3 shadow-[var(--shadow-overlay)]">
        <Dialog aria-label={label} className="outline-none space-y-2">
        <SearchField aria-label={t('soil.analyse.fieldFilter.searchPlaceholder')} value={query} onChange={setQuery} />
        <div className="flex gap-2">
          <Button size="sm" variant="quiet" onPress={() => onChange(new Set(fields.map((f) => f.id)))}>
            {t('soil.analyse.fieldFilter.selectAll')}
          </Button>
          <Button size="sm" variant="quiet" onPress={() => onChange(new Set())}>
            {t('soil.analyse.fieldFilter.selectNone')}
          </Button>
        </div>
        <ul className="max-h-64 overflow-y-auto space-y-1">
          {shown.length === 0 && <li className="text-xs text-muted py-2 text-center">{t('soil.analyse.fieldFilter.empty')}</li>}
          {shown.map((f) => (
            <li key={f.id}>
              <Checkbox
                isSelected={selected.has(f.id)}
                onChange={(on) => {
                  const next = new Set(selected)
                  if (on) next.add(f.id)
                  else next.delete(f.id)
                  onChange(next)
                }}
              >
                <span className="flex-1">{f.name}</span>
                <span className="text-xs text-muted ml-2">{t('soil.analyse.fieldFilter.samples', { count: f.sampleCount })}</span>
              </Checkbox>
            </li>
          ))}
        </ul>
        </Dialog>
      </Popover>
    </DialogTrigger>
  )
}
