import {
  ZONE_COUNTS,
  zoneColor,
  type Field,
  type ImageryStatus,
  type ProductivityAnalysis,
  type ProductivityState,
  type ZoneCount,
} from '@agmeo/contracts'
import type { FeatureCollection } from 'geojson'
import { Layers, RefreshCw } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FieldMap } from '#/components/map/FieldMap'
import { t } from '#/i18n'
import { api } from '#/lib/api'
import { fmt } from '#/lib/format'
import { useOrg } from '#/lib/org'
import { useOrgMutation, useOrgQuery } from '#/lib/queries'
import { Button, SegmentedControl } from '#/ui/Button'
import { Checkbox } from '#/ui/Field'
import { Badge, Card, EmptyState, ErrorNotice, Loading, Notice } from '#/ui/Layout'
import { Cell, Column, Row, Table, TableBody, TableHeader } from '#/ui/Table'
import { ImageryProgress } from './MapControls'
import { relativeGradient } from './indices'

type View = 'zones' | 'map'

const STATUS_CODES = ['not_enough_seasons', 'not_enough_scenes', 'no_imagery', 'error'] as const

/** Why a calculation failed, translated; unknown codes read as a generic failure. */
function statusText(code: string | null | undefined) {
  const known = STATUS_CODES.find((c) => c === code) ?? 'error'
  return t(`zones.status.${known}`)
}

type Suitability = NonNullable<ProductivityAnalysis['suitabilityStatus']>
const SUITABILITY_TONE: Record<Suitability, 'success' | 'warning' | 'danger'> = { suitable: 'success', partially_suitable: 'warning', not_suitable: 'danger' }

/** Badge label, tone and explanation of a stability class, translated at render time. */
function suitabilityInfo(status: Suitability) {
  return { label: t(`zones.suitability.${status}.label`), tone: SUITABILITY_TONE[status], text: t(`zones.suitability.${status}.text`) }
}

export function zoneName(zoneNo: number, count: number) {
  if (zoneNo === 1) return t('zones.level.low')
  if (zoneNo === count) return t('zones.level.high')
  if (count % 2 === 1 && zoneNo === (count + 1) / 2) return t('zones.level.medium')
  return ''
}

const busy = (s?: ImageryStatus) => s?.state === 'running' || s?.state === 'queued'

/** Productivity zones of a field: multi-season productivity map, stability and zones. */
export function ProductivityZones({ field }: { field: Field }) {
  const { t } = useTranslation()
  const { orgId, can } = useOrg()
  const [view, setView] = useState<View>('zones')
  const [count, setCount] = useState<ZoneCount>(3)
  const state = useOrgQuery<ProductivityState>(`/fields/${field.id}/productivity`, undefined, {
    refetchInterval: (s) => (s?.pending ? 3_000 : false),
  })
  const imagery = useOrgQuery<ImageryStatus>('/monitoring/imagery/status', { fieldId: field.id }, { refetchInterval: (s) => (busy(s) ? 5_000 : false) })
  const analysis = state.data?.analysis ?? null
  const pending = state.data?.pending ?? null

  const [excluded, setExcluded] = useState<Set<string>>(new Set())
  useEffect(() => {
    setExcluded(new Set(analysis?.scenes.filter((s) => s.excluded).map((s) => s.sceneId) ?? []))
  }, [analysis])
  const recalculate = useOrgMutation(
    (base, ids: string[]) => api.post<ProductivityState>(`${base}/fields/${field.id}/productivity`, { excludedSceneIds: ids }),
    { success: t('zones.recalculationQueued') },
  )

  const zoning = analysis?.zonings.find((z) => z.zoneCount === count && !z.isCustom) ?? null
  const overlay = useMemo<FeatureCollection | null>(
    () =>
      zoning
        ? {
            type: 'FeatureCollection',
            features: zoning.zones.map((z) => ({
              type: 'Feature',
              geometry: z.geometry,
              properties: { color: zoneColor(z.zoneNo, zoning.zoneCount), zone: z.zoneNo },
            })),
          }
        : null,
    [zoning],
  )
  const raster =
    view === 'map' && analysis?.status === 'finished'
      ? { tiles: `${window.location.origin}/api/v1/orgs/${orgId}/fields/${field.id}/productivity/${analysis.id}/tiles/{z}/{x}/{y}.png`, opacity: 1 }
      : null

  if (state.isLoading) return <Loading />
  if (state.error) return <ErrorNotice error={state.error} />

  const waitingForImagery = !analysis && busy(imagery.data)
  if (!analysis && !pending && !waitingForImagery) {
    return (
      <Card>
        <EmptyState
          icon={Layers}
          title={t('zones.empty.title')}
          action={
            can('field.write') && (
              <Button variant="primary" onPress={() => recalculate.mutate([])} isPending={recalculate.isPending}>
                {t('zones.empty.action')}
              </Button>
            )
          }
        >
          {t('zones.empty.description')}
        </EmptyState>
      </Card>
    )
  }

  const changed = analysis ? analysis.scenes.some((s) => s.excluded !== excluded.has(s.sceneId)) : false
  const seasonsLeft = new Set(analysis?.scenes.filter((s) => !excluded.has(s.sceneId)).map((s) => s.season)).size
  const seasons = analysis ? [...new Set(analysis.scenes.map((s) => s.season))].sort((a, b) => b - a) : []
  const usedSeasons = analysis ? [...new Set(analysis.scenes.filter((s) => s.used).map((s) => s.season))].sort() : []
  const suitability = analysis?.suitabilityStatus ? suitabilityInfo(analysis.suitabilityStatus) : null

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <SegmentedControl
          aria-label={t('zones.view.label')}
          value={view}
          onChange={setView}
          items={[
            { id: 'zones', label: t('zones.view.zones') },
            { id: 'map', label: t('zones.view.map') },
          ]}
        />
        <SegmentedControl
          aria-label={t('zones.numberOfZones')}
          value={String(count) as `${ZoneCount}`}
          onChange={(v) => setCount(Number(v) as ZoneCount)}
          isDisabled={view === 'map'}
          items={ZONE_COUNTS.map((n) => ({ id: String(n) as `${ZoneCount}`, label: t('zones.count', { count: n }) }))}
        />
        <div className="flex-1" />
        {can('field.write') && analysis && (
          <Button onPress={() => recalculate.mutate([...excluded])} isPending={recalculate.isPending} isDisabled={!!pending}>
            <RefreshCw /> {t('zones.recalculate')}
          </Button>
        )}
      </div>

      {waitingForImagery && (
        <>
          <ImageryProgress status={imagery.data ?? null} />
          <Notice>{t('zones.waitingForImagery')}</Notice>
        </>
      )}
      {pending && (
        <Notice>
          {pending.status === 'running' ? t('zones.pending.running') : t('zones.pending.queued')}
          {analysis ? ` ${t('zones.pending.previousShown')}` : ''}
        </Notice>
      )}
      {analysis && !analysis.current && <Notice tone="warning">{t('zones.outdated')}</Notice>}
      {analysis?.status === 'failed' && (
        <Notice tone="warning">
          {statusText(analysis.statusCode)}
          {analysis.sceneCount != null && ` ${t('zones.found', { count: analysis.sceneCount, seasons: analysis.seasonCount ?? 0 })}`}
        </Notice>
      )}

      {analysis?.status === 'finished' && (
        <div className="grid xl:grid-cols-[1fr_26rem] gap-6 items-start">
          <FieldMap fields={[field]} fillOpacity={0} labels={false} overlay={view === 'zones' ? overlay : null} raster={raster} className="h-96 xl:h-[30rem]">
            {view === 'map' ? <ProductivityLegend /> : zoning && <ZoneLegend count={zoning.zoneCount} />}
          </FieldMap>
          <div className="space-y-4">
            <Card title={t('zones.stability.title')}>
              <div className="flex items-baseline gap-3">
                <span className="text-3xl font-semibold tabular">{analysis.suitability != null ? fmt.pct(analysis.suitability * 100) : '—'}</span>
                {suitability && <Badge tone={suitability.tone}>{suitability.label}</Badge>}
              </div>
              {suitability && <p className="mt-2 text-sm text-fg-2">{suitability.text}</p>}
              <p className="mt-2 text-xs text-muted">
                {t('zones.stability.basis', {
                  count: analysis.sceneCount ?? 0,
                  seasons: analysis.seasonCount,
                  from: usedSeasons[0],
                  to: usedSeasons[usedSeasons.length - 1],
                  date: fmt.date(analysis.finishedAt),
                })}
              </p>
            </Card>
            {zoning && (
              <Card title={t('zones.count', { count: zoning.zoneCount })} padded={false}>
                <Table aria-label={t('zones.table.label', { count: zoning.zoneCount, field: field.name })}>
                  <TableHeader>
                    <Column isRowHeader>{t('zones.table.zone')}</Column>
                    <Column align="end">{t('zones.table.area')}</Column>
                    <Column align="end">{t('zones.table.share')}</Column>
                    <Column align="end">{t('zones.table.productivity')}</Column>
                  </TableHeader>
                  <TableBody items={zoning.zones.map((z) => ({ ...z, id: z.zoneNo }))}>
                    {(z) => (
                      <Row id={z.zoneNo}>
                        <Cell>
                          <span className="inline-flex items-center gap-2">
                            <span className="size-3 rounded-sm ring-1 ring-black/10" style={{ background: zoneColor(z.zoneNo, zoning.zoneCount) }} aria-hidden />
                            {z.zoneNo}
                            <span className="text-muted">{zoneName(z.zoneNo, zoning.zoneCount)}</span>
                          </span>
                        </Cell>
                        <Cell align="end">{fmt.ha(z.areaHa)}</Cell>
                        <Cell align="end">{fmt.pct(z.sharePct)}</Cell>
                        <Cell align="end">{fmt.pct(z.relativeProductivity)}</Cell>
                      </Row>
                    )}
                  </TableBody>
                </Table>
                <p className="px-4 py-3 text-xs text-muted border-t border-line">{t('zones.table.productivityHint')}</p>
              </Card>
            )}
          </div>
        </div>
      )}

      {analysis && analysis.scenes.length > 0 && (
        <Card
          title={t('zones.acquisitions.title')}
          description={t('zones.acquisitions.description')}
          actions={
            can('field.write') && (
              <Button size="sm" variant="primary" isDisabled={!changed || seasonsLeft < 2 || !!pending} onPress={() => recalculate.mutate([...excluded])}>
                {t('zones.acquisitions.recalculate')}
              </Button>
            )
          }
        >
          <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-x-6 gap-y-4">
            {seasons.map((season) => (
              <div key={season}>
                <div className="text-sm font-medium mb-1.5">{season}</div>
                <ul className="space-y-1">
                  {analysis.scenes
                    .filter((s) => s.season === season)
                    .map((s) => (
                      <li key={s.sceneId}>
                        <Checkbox
                          isSelected={!excluded.has(s.sceneId)}
                          isDisabled={!can('field.write')}
                          onChange={(on) =>
                            setExcluded((prev) => {
                              const next = new Set(prev)
                              if (on) next.delete(s.sceneId)
                              else next.add(s.sceneId)
                              return next
                            })
                          }
                        >
                          <span className="tabular">{fmt.date(s.date)}</span>
                          <span className="text-muted tabular"> · NDVI {fmt.fixed(s.ndviMean, 2)}</span>
                          {s.used && <Badge tone="primary" className="ml-1.5">{t('zones.acquisitions.used')}</Badge>}
                        </Checkbox>
                      </li>
                    ))}
                </ul>
              </div>
            ))}
          </div>
          {changed && seasonsLeft < 2 && <p className="mt-3 text-sm text-warning">{t('zones.acquisitions.keepTwoSeasons')}</p>}
        </Card>
      )}

      <p className="text-xs text-muted">{t('zones.method')}</p>
    </div>
  )
}

function ZoneLegend({ count }: { count: number }) {
  const { t } = useTranslation()
  return (
    <div className="absolute bottom-8 left-3 z-10 rounded-lg border border-line bg-surface/95 px-3 py-2 shadow-[var(--shadow-overlay)] text-xs">
      <div className="font-medium text-fg mb-1.5">{t('zones.legend.title')}</div>
      <div className="flex gap-0.5" aria-hidden>
        {Array.from({ length: count }, (_, i) => (
          <span key={i} className="h-2.5 w-6 first:rounded-l-full last:rounded-r-full" style={{ background: zoneColor(i + 1, count) }} />
        ))}
      </div>
      <div className="flex justify-between text-muted mt-1">
        <span>{t('zones.level.low')}</span>
        <span>{t('zones.level.high')}</span>
      </div>
    </div>
  )
}

function ProductivityLegend() {
  const { t } = useTranslation()
  return (
    <div className="absolute bottom-8 left-3 z-10 rounded-lg border border-line bg-surface/95 px-3 py-2 shadow-[var(--shadow-overlay)] text-xs w-56">
      <div className="font-medium text-fg mb-1.5">{t('zones.legend.relativeTitle')}</div>
      <div className="h-2.5 rounded-full" style={{ background: relativeGradient }} aria-hidden />
      <div className="flex justify-between text-muted mt-1">
        <span>{t('zones.legend.below')}</span>
        <span>{t('zones.legend.fieldMean')}</span>
        <span>{t('zones.legend.above')}</span>
      </div>
      <div className="text-fg-2 mt-1.5">{t('zones.legend.relativeHint')}</div>
    </div>
  )
}
