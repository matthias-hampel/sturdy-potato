import type { DmcCycleRow, DmcForecast, DmcOverview, Field } from '@agmeo/contracts'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { PlugZap, RefreshCw, Satellite, Wheat } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'
import { CycleDetail } from '#/components/maize-dmc/CycleDetail'
import { dmColor, dmPct, HARVEST_TONE, offsetPts } from '#/components/maize-dmc/format'
import { VarietyOffsets } from '#/components/maize-dmc/VarietyOffsets'
import { FieldMap } from '#/components/map/FieldMap'
import { api, errorMessage } from '#/lib/api'
import { fmt } from '#/lib/format'
import { useOrg, useSeason } from '#/lib/org'
import { useOrgQuery } from '#/lib/queries'
import { Button } from '#/ui/Button'
import { Badge, Card, EmptyState, ErrorNotice, Loading, Notice, PageHeader } from '#/ui/Layout'
import { Cell, Column, Row, Table, TableBody, TableHeader } from '#/ui/Table'
import { toast } from '#/ui/Toast'

export const Route = createFileRoute('/o/$orgId/maize-dmc')({
  validateSearch: z.object({ cycle: z.string().uuid().optional() }),
  component: MaizeDmcPage,
})

/**
 * Maize dry-matter monitoring (reference app/[orgId]/maize-dmc/[year]): the season's silage and
 * grain maize with today's DM, the forecast to the harvest window, the map with the DM raster of
 * the selected crop, and the calibration inputs (FAO maturity, DM measurements, variety offsets).
 */
function MaizeDmcPage() {
  const { t } = useTranslation()
  const { orgId } = useOrg()
  const { season } = useSeason()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const qc = useQueryClient()
  const harvestYear = season?.harvestYear ?? new Date().getFullYear()
  const overview = useOrgQuery<DmcOverview>('/maize-dmc', { harvestYear }, { keepPrevious: true })
  const fields = useOrgQuery<Field[]>('/fields')
  const rows = overview.data?.cycles ?? []
  const configured = overview.data?.configured ?? false
  const selected = rows.find((r) => r.cropCycleId === search.cycle) ?? null
  const select = (id: string | null) => navigate({ search: (s) => ({ ...s, cycle: id ?? undefined }), replace: true })

  const forecastPath = selected && configured && selected.missing.length === 0 ? `/maize-dmc/cycles/${selected.cropCycleId}/forecast` : null
  const forecast = useQuery<DmcForecast>({
    queryKey: ['org', orgId, forecastPath, {}],
    queryFn: () => api.get<DmcForecast>(`/orgs/${orgId}${forecastPath}`),
    enabled: forecastPath != null,
    staleTime: 5 * 60_000,
    retry: false,
  })
  // A new run shows up in the table.
  useEffect(() => {
    if (forecast.data && !forecast.data.cached) void qc.invalidateQueries({ queryKey: ['org', orgId, '/maize-dmc'] })
  }, [forecast.data, orgId, qc])
  const [pinnedDate, setPinnedDate] = useState<string | null>(null)
  useEffect(() => setPinnedDate(null), [search.cycle])
  const dates = forecast.data?.dailyPredictions.map((d) => d.date) ?? []
  const selectedDate = pinnedDate && dates.includes(pinnedDate) ? pinnedDate : (dates[0] ?? null)
  const day = forecast.data?.dailyPredictions.find((d) => d.date === selectedDate)
  const image = forecast.data?.bounds && day ? { url: `${window.location.origin}/api/v1${day.pngPath}`, bounds: forecast.data.bounds, opacity: 0.8 } : null

  const fieldIds = useMemo(() => new Set(rows.map((r) => r.fieldId)), [rows])
  const mapFields = useMemo(() => (fields.data ?? []).filter((f) => fieldIds.has(f.id)), [fields.data, fieldIds])
  const dmByField = useMemo(() => new Map(rows.map((r) => [r.fieldId, r.dmToday])), [rows])

  // "Update forecasts": one request after the other for every crop without a run today.
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const stale = rows.filter((r) => r.missing.length === 0 && r.latestRun?.runDate !== overview.data?.today)
  async function updateAll() {
    setProgress({ done: 0, total: stale.length })
    let failed = 0
    for (const [i, r] of stale.entries()) {
      try {
        await api.get(`/orgs/${orgId}/maize-dmc/cycles/${r.cropCycleId}/forecast`)
      } catch (e) {
        failed += 1
        if (failed === 1) toast.error(t('dmc.update.failed', { field: r.fieldName }), errorMessage(e))
      }
      setProgress({ done: i + 1, total: stale.length })
    }
    setProgress(null)
    await qc.invalidateQueries({ queryKey: ['org', orgId] })
  }

  const header = (
    <PageHeader
      title={t('dmc.title')}
      subtitle={season ? t('dmc.subtitle', { season: season.name }) : undefined}
      actions={
        configured &&
        stale.length > 0 && (
          <Button onPress={updateAll} isPending={progress != null}>
            <RefreshCw aria-hidden />
            {progress ? t('dmc.update.progress', { done: progress.done, total: progress.total }) : t('dmc.update.action', { count: stale.length })}
          </Button>
        )
      }
    />
  )

  if (overview.isLoading) return <>{header}<Loading /></>
  if (overview.error) return <>{header}<ErrorNotice error={overview.error} /></>

  return (
    <>
      {header}
      <div className="space-y-6">
        {!configured && (
          <Notice tone="warning" icon={PlugZap}>
            <strong className="font-medium">{t('dmc.notConfigured.title')}</strong> {t('dmc.notConfigured.body')}
          </Notice>
        )}
        {rows.length === 0 ? (
          <Card>
            <EmptyState icon={Wheat} title={t('dmc.empty.title')}>
              {t('dmc.empty.body')}
            </EmptyState>
          </Card>
        ) : (
          <>
            <div className="grid gap-6 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
              <Card padded={false}>
                <Table aria-label={t('dmc.table.label')} selectionMode="single" selectionBehavior="replace" selectedKeys={selected ? [selected.cropCycleId] : []} onSelectionChange={(keys) => select(keys === 'all' ? null : ((([...keys][0] as string) ?? null)))}>
                  <TableHeader>
                    <Column isRowHeader>{t('dmc.table.field')}</Column>
                    <Column>{t('dmc.table.variety')}</Column>
                    <Column align="end">{t('dmc.table.dmToday')}</Column>
                    <Column align="end">{t('dmc.table.dm7d')}</Column>
                    <Column>{t('dmc.table.harvest')}</Column>
                    <Column>{t('dmc.table.measurement')}</Column>
                  </TableHeader>
                  <TableBody items={rows.map((r) => ({ ...r, id: r.cropCycleId }))}>
                    {(r) => (
                      <Row id={r.id}>
                        <Cell>
                          <div className="font-medium">{r.fieldName}</div>
                          <div className="text-xs text-muted">
                            {[r.fieldPartName, r.cropName, r.sowingDate && t('dmc.detail.sown', { date: fmt.shortDate(r.sowingDate) })].filter(Boolean).join(' · ')}
                          </div>
                        </Cell>
                        <Cell>
                          <div>{r.varietyName ?? '—'}</div>
                          <div className="text-xs text-muted">{r.faoMaturity != null ? t('dmc.table.fao', { value: r.faoMaturity }) : t('dmc.table.noFao')}</div>
                        </Cell>
                        <Cell align="end">
                          <DmValue row={r} />
                        </Cell>
                        <Cell align="end" className="tabular">
                          {dmPct(r.dm7d)}
                        </Cell>
                        <Cell>
                          <HarvestCell row={r} />
                        </Cell>
                        <Cell>
                          {r.latestMeasurement ? (
                            <div className="text-sm tabular">
                              {dmPct(r.latestMeasurement.measuredDm)} <span className="text-xs text-muted">{fmt.shortDate(r.latestMeasurement.date)}</span>
                            </div>
                          ) : r.varietyOffset != null ? (
                            <span className="text-xs text-muted">{t('dmc.table.varietyOffset', { offset: offsetPts(r.varietyOffset) })}</span>
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </Cell>
                      </Row>
                    )}
                  </TableBody>
                </Table>
              </Card>
              <div className="space-y-2">
                <FieldMap
                  fields={mapFields}
                  selectedId={selected?.fieldId ?? null}
                  fitIds={selected ? [selected.fieldId] : undefined}
                  onSelect={(fieldId) => select(rows.find((r) => r.fieldId === fieldId)?.cropCycleId ?? null)}
                  colorBy={(f) => dmColor(dmByField.get(f.id))}
                  fillOpacity={0.5}
                  image={image}
                  className="h-96 xl:h-[32rem] rounded-xl overflow-hidden"
                />
                <DmLegend />
              </div>
            </div>
            {selected ? (
              <CycleDetail
                row={selected}
                configured={configured}
                forecast={forecast.data}
                forecastError={forecast.error}
                forecastLoading={forecast.isLoading && forecastPath != null}
                selectedDate={selectedDate}
                onPickDate={setPinnedDate}
              />
            ) : (
              <p className="text-sm text-muted">{t('dmc.selectHint')}</p>
            )}
            <VarietyOffsets harvestYear={harvestYear} />
          </>
        )}
      </div>
    </>
  )
}

function DmValue({ row }: { row: DmcCycleRow }) {
  if (row.dmToday == null) return <span className="text-muted">—</span>
  return (
    <div className="tabular">
      <span className="font-medium">{dmPct(row.dmToday)}</span>
      {row.dmP10 != null && row.dmP90 != null && (
        <div className="text-xs text-muted">
          {fmt.fixed(row.dmP10 * 100, 0)}–{fmt.fixed(row.dmP90 * 100, 0)}
        </div>
      )}
    </div>
  )
}

function HarvestCell({ row }: { row: DmcCycleRow }) {
  const { t } = useTranslation()
  if (row.reportedHarvestDate) return <Badge tone="success">{t('dmc.harvest.reported', { date: fmt.shortDate(row.reportedHarvestDate) })}</Badge>
  return (
    <div className="flex flex-col items-start gap-1">
      {row.harvest && (
        <Badge tone={HARVEST_TONE[row.harvest.status]}>
          {t(`dmc.harvest.status.${row.harvest.status}`)} · {fmt.pct(row.harvest.probability * 100)}
        </Badge>
      )}
      {row.harvestDetected && row.harvestDetected.status !== 'rejected' && (
        <span className="inline-flex items-center gap-1 text-xs text-muted">
          <Satellite className="size-3" aria-hidden />
          {t(`dmc.harvest.detection.${row.harvestDetected.status}`, { date: fmt.shortDate(row.harvestDetected.windowEnd) })}
        </span>
      )}
      {row.harvestWindow && (row.harvest?.status ?? 'not_harvested') !== 'harvested' && (
        <span className="text-xs text-muted">
          {t(row.harvestWindow.estimated ? 'dmc.window.shortEstimated' : 'dmc.window.short', {
            start: row.harvestWindow.start ? fmt.shortDate(row.harvestWindow.start) : '—',
            end: row.harvestWindow.end ? fmt.shortDate(row.harvestWindow.end) : '—',
          })}
        </span>
      )}
      {!row.harvest && !row.harvestWindow && !row.harvestDetected && <span className="text-muted">—</span>}
    </div>
  )
}

function DmLegend() {
  const { t } = useTranslation()
  const items: [string, string][] = [
    [dmColor(0.2)!, '< 25 %'],
    [dmColor(0.26)!, '25–28 %'],
    [dmColor(0.29)!, '28–30 %'],
    [dmColor(0.32)!, '30–35 %'],
    [dmColor(0.4)!, '> 35 %'],
  ]
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs text-muted" aria-label={t('dmc.legend')}>
      <span>{t('dmc.legend')}</span>
      {items.map(([c, l]) => (
        <span key={l} className="inline-flex items-center gap-1">
          <span className="size-3 rounded-sm" style={{ background: c }} aria-hidden />
          {l}
        </span>
      ))}
    </div>
  )
}
