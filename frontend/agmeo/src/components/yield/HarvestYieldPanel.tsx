import type { CropCycle, Field, YieldOverview, YieldOverviewRow, YieldZoning } from '@agmeo/contracts'
import { useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, ChevronRight, FileUp, Map as MapIcon, XCircle } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CropTag } from '#/components/labels'
import { api } from '#/lib/api'
import { fmt } from '#/lib/format'
import { useOrg, useSeason } from '#/lib/org'
import { useOrgQuery } from '#/lib/queries'
import { Button, Link } from '#/ui/Button'
import { Checkbox, NumberField } from '#/ui/Field'
import { Badge, Card, Notice } from '#/ui/Layout'
import { ModalDialog } from '#/ui/Overlay'
import { Cell, Column, Row, Table, TableBody, TableHeader } from '#/ui/Table'
import { cx } from '#/ui/utils'
import { DEFAULT_SPREAD, EstimateControls, EstimateMap, EstimateZoneChips, estimateReason, type EstimateParams, useEstimatePreview } from './YieldEstimatePanel'
import { YieldImportDialog } from './YieldImportDialog'
import { fmtTonnes, fmtYield } from './shared'

const BUCKETS = [
  { key: 'map', color: 'bg-success' },
  { key: 'estimate', color: 'bg-info' },
  { key: 'documented', color: 'bg-accent' },
  { key: 'nothing', color: 'bg-surface-3' },
] as const

/**
 * Yield data of the season on the harvest tab: how many fields carry a monitor map, a saved
 * estimate, only a documented average or nothing (with the hectares behind each), the map per
 * crop cycle, the import of harvest-monitor exports and the batch satellite estimate.
 */
export function HarvestYieldPanel() {
  const { t } = useTranslation()
  const { orgId, can } = useOrg()
  const { seasonId } = useSeason()
  const overview = useOrgQuery<YieldOverview>(seasonId ? '/yield-maps/overview' : null, { seasonId }, {
    refetchInterval: (d) => (d?.rows.some((r) => r.sources.pending > 0) ? 5_000 : false),
  })
  const [importOpen, setImportOpen] = useState(false)
  const [batchOpen, setBatchOpen] = useState(false)
  const data = overview.data
  if (!data || data.rows.length === 0) {
    return can('operation.write') ? (
      <div className="mb-4 flex gap-2">
        <Button onPress={() => setImportOpen(true)}>
          <FileUp /> {t('yield.import.button')}
        </Button>
        <YieldImportDialog isOpen={importOpen} onClose={() => setImportOpen(false)} />
      </div>
    ) : null
  }
  const c = data.coverage
  const counts = { map: [c.withMap, c.haMap], estimate: [c.withEstimate, c.haEstimate], documented: [c.withDocumentedOnly, c.haDocumentedOnly], nothing: [c.withNothing, c.haNothing] } as const
  const totalHa = c.haMap + c.haEstimate + c.haDocumentedOnly + c.haNothing
  const label = (key: (typeof BUCKETS)[number]['key']) =>
    key === 'map' ? t('yield.coverage.map') : key === 'estimate' ? t('yield.coverage.estimate') : key === 'documented' ? t('yield.coverage.documented') : t('yield.coverage.nothing')

  return (
    <div className="space-y-4 mb-6">
      <Card
        title={t('yield.coverage.title', { count: c.totalFields })}
        actions={
          <div className="flex flex-wrap gap-2">
            {can('operation.write') && (
              <Button size="sm" variant="primary" onPress={() => setImportOpen(true)}>
                <FileUp /> {t('yield.import.button')}
              </Button>
            )}
            {can('field.write') && (
              <Button size="sm" onPress={() => setBatchOpen(true)}>
                <MapIcon /> {t('yield.batch.button')}
              </Button>
            )}
          </div>
        }
      >
        <div className="space-y-2">
          {c.avgYieldTHa != null && (
            <div className="text-xs text-muted">
              {t('yield.coverage.avgYield')}: {fmtYield(c.avgYieldTHa, 2)}
            </div>
          )}
          <div className="flex h-2 w-full overflow-hidden rounded-full bg-surface-2">
            {BUCKETS.map((b) => (
              <div key={b.key} className={cx(b.color, 'h-full')} style={{ width: `${totalHa > 0 ? (counts[b.key][1] / totalHa) * 100 : 0}%` }} />
            ))}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {BUCKETS.filter((b) => counts[b.key][0] > 0).map((b) => (
              <span key={b.key} className="flex items-center gap-1.5 text-xs text-fg-2">
                <span className={cx(b.color, 'size-2.5 shrink-0 rounded-full')} aria-hidden />
                <span className="font-medium text-fg">{counts[b.key][0]}</span>
                {label(b.key)}
                <span className="text-muted tabular">{fmt.ha(counts[b.key][1], 1)}</span>
              </span>
            ))}
          </div>
        </div>
      </Card>

      <Card title={t('yield.overview.title')} padded={false}>
        <Table aria-label={t('yield.overview.title')}>
          <TableHeader>
            <Column isRowHeader>{t('yield.overview.field')}</Column>
            <Column>{t('yield.overview.crop')}</Column>
            <Column align="end">{t('yield.overview.area')}</Column>
            <Column>{t('yield.overview.maps')}</Column>
            <Column align="end">{t('yield.overview.mapMean')}</Column>
            <Column align="end">{t('yield.overview.total')}</Column>
            <Column align="end">{t('yield.overview.documented')}</Column>
            <Column>{''}</Column>
          </TableHeader>
          <TableBody items={data.rows.map((r) => ({ ...r, id: r.cropCycleId }))}>
            {(r) => (
              <Row id={r.cropCycleId}>
                <Cell className="font-medium">{r.fieldName}</Cell>
                <Cell>
                  <CropTag name={r.cropName} color={r.cropColor} />
                </Cell>
                <Cell align="end">{fmt.ha(r.areaHa, 1)}</Cell>
                <Cell>
                  <SourcesSummary row={r} />
                </Cell>
                <Cell align="end">{fmtYield(r.raster?.meanTHa)}</Cell>
                <Cell align="end">{fmtTonnes(r.raster?.totalT)}</Cell>
                <Cell align="end">
                  {fmtYield(r.documentedYieldTHa)}
                  {r.documentedFromMap && <div className="text-xs text-muted">{t('yield.fromMap')}</div>}
                </Cell>
                <Cell>
                  <Link to="/o/$orgId/crops/$cropCycleId" params={{ orgId, cropCycleId: r.cropCycleId }} search={{ tab: 'yield' }} variant="ghost" size="sm" aria-label={t('yield.overview.open')}>
                    <ChevronRight />
                  </Link>
                </Cell>
              </Row>
            )}
          </TableBody>
        </Table>
      </Card>

      <YieldImportDialog isOpen={importOpen} onClose={() => setImportOpen(false)} />
      {batchOpen && <BatchEstimateDialog rows={data.rows} onClose={() => setBatchOpen(false)} />}
    </div>
  )
}

function SourcesSummary({ row }: { row: YieldOverviewRow }) {
  const { t } = useTranslation()
  const s = row.sources
  if (s.total === 0) return row.hasEstimate ? <Badge tone="accent">{t('yield.coverage.estimate')}</Badge> : <span className="text-muted">—</span>
  return (
    <span className="inline-flex flex-wrap gap-1">
      <Badge tone={s.failed ? 'warning' : s.pending ? 'info' : 'success'}>{t('yield.overview.mapCount', { count: s.total })}</Badge>
      {s.pending > 0 && <Badge tone="info">{t('yield.status.pending')}</Badge>}
      {s.failed > 0 && <Badge tone="danger">{t('yield.overview.failed', { count: s.failed })}</Badge>}
    </span>
  )
}

type RowResult = 'saved' | 'skipped' | 'failed'

/**
 * Batch yield estimate (the soil-map batch pattern): pick fields, set the target Ø yield per
 * field and the distribution strength once, then click through per-field previews — each
 * "Passt" saves the previewed zones.
 */
function BatchEstimateDialog({ rows, onClose: close }: { rows: YieldOverviewRow[]; onClose: () => void }) {
  const { t } = useTranslation()
  const { orgId } = useOrg()
  const qc = useQueryClient()
  const onClose = () => {
    void qc.invalidateQueries({ queryKey: ['org', orgId] })
    close()
  }
  const { seasonId } = useSeason()
  const cycles = useOrgQuery<CropCycle[]>('/crop-cycles', { seasonId })
  const fields = useOrgQuery<Field[]>('/fields', { seasonId })
  // Fields without a monitor map; those with a documented yield and no estimate are pre-selected.
  const targets = rows.filter((r) => r.bucket !== 'map')
  const [checked, setChecked] = useState(() => new Set(targets.filter((r) => r.documentedYieldTHa != null && !r.hasEstimate).map((r) => r.cropCycleId)))
  const [means, setMeans] = useState<Record<string, number | null>>({})
  const [spread, setSpread] = useState(DEFAULT_SPREAD)
  const [queue, setQueue] = useState<YieldOverviewRow[] | null>(null)
  const [index, setIndex] = useState(0)
  const [results, setResults] = useState<Record<string, RowResult>>({})

  const meanFor = (r: YieldOverviewRow) => (r.cropCycleId in means ? means[r.cropCycleId] : (r.documentedYieldTHa ?? cycles.data?.find((c) => c.id === r.cropCycleId)?.expectedYieldTHa ?? null))
  const ready = targets.filter((r) => checked.has(r.cropCycleId) && (meanFor(r) ?? 0) > 0)
  const current = queue?.[index]
  const finished = queue && index >= queue.length

  const title = !queue ? t('yield.batch.title', { count: checked.size }) : finished ? t('yield.batch.doneTitle') : t('yield.batch.reviewTitle', { current: index + 1, total: queue.length })

  return (
    <ModalDialog isOpen onOpenChange={(open) => !open && onClose()} size="lg" title={title} footer={(close) => (
      <>
        {!queue && (
          <>
            <Button onPress={close}>{t('common.cancel')}</Button>
            <Button variant="primary" isDisabled={!ready.length} onPress={() => { setQueue(ready); setIndex(0); setResults({}) }}>
              {t('yield.batch.start', { count: ready.length })}
            </Button>
          </>
        )}
        {queue && !finished && <Button onPress={() => setQueue(null)}>{t('common.back')}</Button>}
        {finished && <Button variant="primary" onPress={close}>{t('common.close')}</Button>}
      </>
    )}>
      {!queue && (
        <div className="space-y-4">
          <p className="text-sm text-muted">{t('yield.batch.hint')}</p>
          {targets.length === 0 ? (
            <Notice>{t('yield.batch.noTargets')}</Notice>
          ) : (
            <div className="max-h-[44vh] overflow-y-auto rounded-lg border border-line divide-y divide-line">
              {targets.map((r) => (
                <div key={r.cropCycleId} className={cx('grid grid-cols-[auto_1fr_auto_8rem] items-center gap-3 px-3 py-1.5', checked.has(r.cropCycleId) && 'bg-primary/5')}>
                  <Checkbox aria-label={r.fieldName} isSelected={checked.has(r.cropCycleId)} onChange={(on) => setChecked((prev) => { const next = new Set(prev); if (on) next.add(r.cropCycleId); else next.delete(r.cropCycleId); return next })} />
                  <span className="min-w-0">
                    <span className="font-medium truncate">{r.fieldName}</span>
                    {r.hasEstimate && <CheckCircle2 className="inline size-3.5 ml-1.5 text-success" aria-label={t('yield.batch.hasEstimate')} />}
                    <span className="block"><CropTag name={r.cropName} color={r.cropColor} /></span>
                  </span>
                  <span className="text-xs text-muted tabular">{fmt.ha(r.areaHa, 1)}</span>
                  <NumberField aria-label={t('yield.estimate.mean')} unit={fmt.unit('yieldMass')} minValue={0} step={0.1} value={meanFor(r) ?? Number.NaN} onChange={(v) => setMeans((prev) => ({ ...prev, [r.cropCycleId]: Number.isNaN(v) ? null : v }))} />
                </div>
              ))}
            </div>
          )}
          <NumberField label={t('yield.estimate.spread')} description={t('yield.estimate.spreadHint')} unit="%" minValue={0} maxValue={150} step={5} value={Math.round(spread * 100)} onChange={(v) => setSpread(Number.isNaN(v) ? DEFAULT_SPREAD : v / 100)} className="max-w-xs" />
        </div>
      )}
      {current && !finished && (
        <ReviewStep
          key={current.cropCycleId}
          row={current}
          field={fields.data?.find((f) => f.id === current.fieldId) ?? null}
          initial={{ meanYieldTHa: meanFor(current), spread, sceneId: null, zoneCount: 5 }}
          onResult={(r) => {
            setResults((prev) => ({ ...prev, [current.cropCycleId]: r }))
            setIndex((i) => i + 1)
          }}
        />
      )}
      {finished && (
        <ul className="space-y-1">
          {queue.map((r) => (
            <li key={r.cropCycleId} className="flex items-center gap-2 text-sm">
              {results[r.cropCycleId] === 'saved' ? <CheckCircle2 className="size-4 text-success" aria-hidden /> : <XCircle className={cx('size-4', results[r.cropCycleId] === 'failed' ? 'text-danger' : 'text-warning')} aria-hidden />}
              <span className="font-medium">{r.fieldName}</span>
              <span className="ml-auto text-muted text-xs">
                {results[r.cropCycleId] === 'saved' ? t('yield.batch.saved') : results[r.cropCycleId] === 'failed' ? t('yield.estimate.failed') : t('yield.batch.skipped')}
              </span>
            </li>
          ))}
        </ul>
      )}
    </ModalDialog>
  )
}

function ReviewStep({ row, field, initial, onResult }: { row: YieldOverviewRow; field: Field | null; initial: EstimateParams; onResult: (r: RowResult) => void }) {
  const { t } = useTranslation()
  const { orgId } = useOrg()
  const [params, setParams] = useState<EstimateParams>(initial)
  const preview = useEstimatePreview(row.cropCycleId, params)
  const [saving, setSaving] = useState(false)
  const reason = estimateReason(preview.data, t)
  const accept = async () => {
    if (!preview.data?.ok) return
    setSaving(true)
    try {
      await api.post<YieldZoning>(`/orgs/${orgId}/yield-maps/crop-cycles/${row.cropCycleId}/zonings`, {
        source: 'yield_estimate',
        estimate: { meanYieldTHa: params.meanYieldTHa, spread: params.spread, sceneId: preview.data.sceneId, zoneCount: params.zoneCount },
      })
      onResult('saved')
    } catch {
      onResult('failed')
    } finally {
      setSaving(false)
    }
  }
  return (
    <div className="space-y-3">
      <div className="text-sm">
        <span className="font-medium">{row.fieldName}</span>
        <span className="text-muted"> · {row.cropName} · {fmt.ha(row.areaHa, 1)}</span>
      </div>
      {field && <EstimateMap field={field} preview={preview.data} loading={preview.isFetching} />}
      <EstimateZoneChips preview={preview.data} />
      {reason && <Notice tone="warning">{reason}</Notice>}
      <EstimateControls params={params} onChange={(p) => setParams((prev) => ({ ...prev, ...p }))} preview={preview.data} />
      <div className="flex justify-end gap-2 pt-1">
        <Button onPress={() => onResult('skipped')} isDisabled={saving}>
          {t('yield.batch.skip')}
        </Button>
        <Button variant="primary" isDisabled={!preview.data?.ok || preview.isFetching} isPending={saving} onPress={() => void accept()}>
          {t('yield.batch.accept')}
        </Button>
      </div>
    </div>
  )
}
