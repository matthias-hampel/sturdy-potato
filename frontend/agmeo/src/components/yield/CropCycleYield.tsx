import { type CropCycle, type CropCycleYield as CropCycleYieldData, type Field, type YieldCleaning, type YieldMapSource, type YieldRaster, type YieldZoning, type ZoneYieldSet } from '@agmeo/contracts'
import type { FeatureCollection } from 'geojson'
import { FileUp, Layers, RefreshCw, Sprout, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FieldMap } from '#/components/map/FieldMap'
import { t as tt } from '#/i18n'
import { api } from '#/lib/api'
import { fmt } from '#/lib/format'
import { useOrg } from '#/lib/org'
import { useOrgMutation, useOrgQuery } from '#/lib/queries'
import { Button, SegmentedControl } from '#/ui/Button'
import { Checkbox, NumberField, Option, Select } from '#/ui/Field'
import { Badge, Card, DescriptionList, EmptyState, ErrorNotice, Loading, Stat } from '#/ui/Layout'
import { ConfirmButton } from '#/ui/Overlay'
import { Cell, Column, Row, Table, TableBody, TableHeader } from '#/ui/Table'
import { YieldEstimatePanel } from './YieldEstimatePanel'
import { YieldImportDialog } from './YieldImportDialog'
import { exclusionLabel, fmtTonnes, fmtYield, formatLabel, providerLabel, SourceStatusBadge, writebackText, YieldHistogram, YieldLegend, yieldTiles } from './shared'

type Scale = 'own' | 'crop'

/**
 * The yield of a crop cycle: the merged map of the harvest (raster with legend, statistics,
 * distribution, cleaning report), its sources, the measured yield per zone, the documented
 * yield it fed, and yield zones — from the map, or estimated from satellite data when no
 * monitor map exists.
 */
export function CropCycleYield({ cycle, field }: { cycle: CropCycle; field: Field }) {
  const { t } = useTranslation()
  const { orgId, can } = useOrg()
  const [importOpen, setImportOpen] = useState(false)
  const [eventId, setEventId] = useState<string | null>(null)
  const [scale, setScale] = useState<Scale>('own')
  const [showZoning, setShowZoning] = useState<string | null>(null)
  const data = useOrgQuery<CropCycleYieldData>(`/yield-maps/crop-cycles/${cycle.id}`, undefined, {
    // While the worker parses, poll so the map appears without a reload.
    refetchInterval: (d) => (d?.sources.some((s) => s.status === 'pending_parse' || s.status === 'pending_download') ? 4_000 : false),
  })
  const overview = useOrgQuery<{ scales: { cropName: string; range: [number, number]; cropCycleIds: string[] }[] }>('/yield-maps/overview', { seasonId: cycle.seasonId }, { enabled: scale === 'crop' })
  const rebuild = useOrgMutation((p) => api.post(`${p}/yield-maps/crop-cycles/${cycle.id}/rebuild`), { success: t('yield.rebuildQueued') })
  const writable = can('operation.write')

  const d = data.data
  const raster = d?.rasters.find((r) => r.id === eventId) ?? d?.rasters[0] ?? null
  const cropRange = overview.data?.scales.find((s) => s.cropCycleIds.includes(cycle.id))?.range
  const range: [number, number] | null = raster ? (scale === 'crop' && cropRange ? cropRange : raster.displayRange) : null
  const zoning = d?.zonings.find((z) => z.id === showZoning) ?? null
  const overlay = useMemo<FeatureCollection | null>(
    () =>
      zoning
        ? { type: 'FeatureCollection', features: zoning.zones.map((z) => ({ type: 'Feature', geometry: JSON.parse(z.geometry), properties: { color: z.color } })) }
        : null,
    [zoning],
  )

  if (data.isLoading) return <Loading />
  if (data.error) return <ErrorNotice error={data.error} />
  if (!d) return null
  const pending = d.sources.some((s) => s.status === 'pending_parse' || s.status === 'pending_download')

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        {writable && (
          <Button variant="primary" onPress={() => setImportOpen(true)}>
            <FileUp /> {t('yield.import.button')}
          </Button>
        )}
        {writable && d.sources.length > 0 && (
          <Button onPress={() => rebuild.mutate(undefined)} isPending={rebuild.isPending}>
            <RefreshCw /> {t('yield.rebuild')}
          </Button>
        )}
        {pending && (
          <Badge tone="info" dot="var(--color-info)">
            {t('yield.processing')}
          </Badge>
        )}
      </div>

      {d.rasters.length === 0 ? (
        <Card>
          <EmptyState icon={Sprout} title={pending ? t('yield.notBuilt') : t('yield.empty.title')}>
            {pending ? t('yield.notBuiltHint') : t('yield.empty.description')}
          </EmptyState>
        </Card>
      ) : (
        <>
          {d.rasters.length > 1 && (
            <SegmentedControl
              aria-label={t('yield.events')}
              items={d.rasters.map((r, i) => ({ id: r.id, label: r.eventFrom ? fmt.date(r.eventFrom) : t('yield.eventN', { number: i + 1 }) }))}
              value={raster!.id}
              onChange={setEventId}
            />
          )}
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
            <Card padded={false} className="overflow-hidden">
              <FieldMap
                fields={[field]}
                selectedId={field.id}
                labels={false}
                fillOpacity={0}
                raster={range ? { tiles: yieldTiles(orgId, raster!.id, range), opacity: 0.9 } : null}
                overlay={overlay}
                className="h-96"
              />
              <div className="p-3 space-y-3">
                {range && <YieldLegend range={range} note={scale === 'crop' ? t('yield.scale.cropNote', { crop: d.cropName }) : undefined} />}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <SegmentedControl
                    aria-label={t('yield.scale.label')}
                    items={[
                      { id: 'own', label: t('yield.scale.own') },
                      { id: 'crop', label: t('yield.scale.crop') },
                    ]}
                    value={scale}
                    onChange={setScale}
                  />
                  {d.zonings.length > 0 && (
                    <Select
                      aria-label={t('yield.zones.show')}
                      className="w-56"
                      items={[{ id: 'none', name: t('yield.zones.hide') }, ...d.zonings.map((z) => ({ id: z.id, name: zoningLabel(z) }))]}
                      value={showZoning ?? 'none'}
                      onChange={(v) => setShowZoning(v === 'none' ? null : String(v))}
                    >
                      {(o) => <Option id={o.id}>{o.name}</Option>}
                    </Select>
                  )}
                </div>
              </div>
            </Card>
            <RasterStats raster={raster!} data={d} />
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <Card title={t('yield.distribution')}>
              <YieldHistogram raster={raster!} />
            </Card>
            <CleaningReport raster={raster!} sources={d.sources} />
          </div>
        </>
      )}

      <SourcesCard sources={d.sources} raster={raster} writable={writable} onImport={() => setImportOpen(true)} />

      {raster && <ZoneYieldsCard sets={d.zoneYields} />}

      <YieldZonesCard cycle={cycle} data={d} raster={raster} onShow={setShowZoning} />

      {!raster && can('field.write') && <YieldEstimatePanel cycle={cycle} field={field} documentedYieldTHa={d.documented.yieldTHa ?? cycle.expectedYieldTHa} />}

      <YieldImportDialog isOpen={importOpen} onClose={() => setImportOpen(false)} cropCycleId={cycle.id} />
    </div>
  )
}

function zoningLabel(z: YieldZoning) {
  return z.source === 'yield_map' ? tt('yield.zones.fromMap', { count: z.zoneCount }) : tt('yield.zones.fromEstimate', { count: z.zoneCount })
}

function RasterStats({ raster, data }: { raster: YieldRaster; data: CropCycleYieldData }) {
  const { t } = useTranslation()
  const s = raster.stats
  const wb = writebackText(raster.writeback)
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Stat label={t('yield.stats.mean')} value={fmtYield(s.mean, 2)} hint={raster.targetMoisture != null ? t('yield.stats.moisture', { pct: raster.targetMoisture }) : t('yield.stats.asHarvested')} />
        <Stat label={t('yield.stats.total')} value={fmtTonnes(raster.totalT)} hint={raster.harvestedHa != null ? t('yield.stats.harvestedHa', { area: fmt.ha(raster.harvestedHa, 1) }) : t('yield.stats.noWidths')} />
        <Stat label={t('yield.stats.coverage')} value={fmt.pct(raster.fieldCoverage != null ? raster.fieldCoverage * 100 : null)} hint={fmt.ha(raster.areaHa, 1)} />
        <Stat label={t('yield.stats.spread')} value={`${fmt.fixed(s.q20, 1)}–${fmtYield(s.q80)}`} hint={t('yield.stats.spreadHint')} />
      </div>
      <Card>
        <DescriptionList
          items={[
            { label: t('yield.stats.median'), value: fmtYield(s.median, 2) },
            { label: t('yield.stats.minMax'), value: `${fmt.fixed(s.min, 1)}–${fmtYield(s.max)}` },
            { label: t('yield.stats.stddev'), value: fmtYield(s.stddev, 2) },
            { label: t('yield.stats.cropMean'), value: fmtYield(data.cropSeasonMeanTHa, 2) },
            { label: t('yield.stats.documented'), value: data.documented.yieldTHa != null ? <span>{fmtYield(data.documented.yieldTHa, 2)} {data.documented.fromMap && <Badge tone="info">{t('yield.fromMap')}</Badge>}</span> : t('yield.stats.notDocumented') },
            ...(wb ? [{ label: t('yield.stats.writeback'), value: wb }] : []),
            ...(raster.totalCalibrationFactor != null ? [{ label: t('yield.stats.calibrated'), value: t('yield.stats.calibratedValue', { factor: fmt.fixed(raster.totalCalibrationFactor, 3) }) }] : []),
            { label: t('yield.stats.filled'), value: t('yield.pixelCount', { count: raster.filledPixels ?? 0 }) },
            { label: t('yield.stats.source'), value: <span className="break-all">{raster.attribute ?? '—'}</span> },
            { label: t('yield.stats.basis'), value: raster.basis === 'dry' ? t('yield.basis.dry') : t('yield.basis.wet') },
            { label: t('yield.stats.grid'), value: `EPSG:${raster.grid.epsg} · ${fmt.num(raster.grid.resolution)} m` },
            { label: t('yield.stats.built'), value: fmt.dateTime(raster.builtAt) },
          ]}
        />
      </Card>
    </div>
  )
}

/** What the cleaning removed, per source — the terms farmers know from yield-cleaning services. */
function CleaningReport({ raster, sources }: { raster: YieldRaster; sources: YieldMapSource[] }) {
  const { t } = useTranslation()
  const name = (id: string) => sources.find((s) => s.id === id)?.fileName ?? id.slice(0, 8)
  const q = (raster.quality ?? {}) as { overlapRemoved?: number; overCoveredPixels?: number; calibrationSkipped?: boolean }
  const rows = (c: YieldCleaning) => {
    const track = c.track
    return [
      [t('yield.cleaning.edge'), c.edgeRemoved],
      [t('yield.cleaning.passTrim'), track?.passTrimRemoved],
      [t('yield.cleaning.velocity'), track ? track.velocityRemoved + track.smoothVelocityRemoved : undefined],
      [t('yield.cleaning.capped'), sources.find((s) => s.id === c.sourceId)?.quality?.cappedPoints],
    ] as [string, number | undefined][]
  }
  return (
    <Card title={t('yield.cleaning.title')} description={t('yield.cleaning.description')}>
      <div className="space-y-4">
        {raster.cleaning.map((c) => (
          <div key={c.sourceId} className="space-y-1.5">
            <div className="text-sm font-medium truncate">{name(c.sourceId!)}</div>
            <ul className="text-sm space-y-0.5">
              {rows(c)
                .filter(([, v]) => v != null)
                .map(([label, v]) => (
                  <li key={label} className="flex justify-between gap-2">
                    <span className="text-fg-2">{label}</span>
                    <span className="tabular">{t('yield.cleaning.points', { count: v ?? 0 })}</span>
                  </li>
                ))}
              {c.track && !c.track.untimed && (
                <li className="flex justify-between gap-2">
                  <span className="text-fg-2">{t('yield.cleaning.lag')}</span>
                  <span className="tabular">{c.track.lagSource === 'skipped' ? t('yield.cleaning.lagSkipped') : `${fmt.num(c.track.lagShiftS, 1)} s`}</span>
                </li>
              )}
              {c.track && !c.track.untimed && (
                <li className="flex justify-between gap-2">
                  <span className="text-fg-2">{t('yield.cleaning.passes')}</span>
                  <span className="tabular">{fmt.num(c.track.passes)}</span>
                </li>
              )}
              {c.track?.untimed && <li className="text-xs text-muted">{t('yield.cleaning.untimed')}</li>}
              {c.sectionsCorrected.length > 0 && (
                <li className="flex justify-between gap-2">
                  <span className="text-fg-2">{t('yield.cleaning.sections')}</span>
                  <span className="tabular">{c.sectionsCorrected.map((s) => `${s.section}: ×${fmt.fixed(s.factor, 2)}`).join(', ')}</span>
                </li>
              )}
            </ul>
          </div>
        ))}
        <ul className="text-sm space-y-0.5 border-t border-line pt-3">
          <li className="flex justify-between gap-2">
            <span className="text-fg-2">{t('yield.cleaning.overlap')}</span>
            <span className="tabular">{t('yield.cleaning.points', { count: q.overlapRemoved ?? 0 })}</span>
          </li>
          {(q.overCoveredPixels ?? 0) > 0 && (
            <li className="flex justify-between gap-2">
              <span className="text-fg-2">{t('yield.cleaning.overCovered')}</span>
              <span className="tabular">{t('yield.pixelCount', { count: q.overCoveredPixels ?? 0 })}</span>
            </li>
          )}
          {raster.contributions.some((c) => Math.abs(c.calibrationFactor - 1) > 0.001) && (
            <li className="flex justify-between gap-2">
              <span className="text-fg-2">{t('yield.cleaning.calibration')}</span>
              <span className="tabular">{raster.contributions.map((c) => `×${fmt.fixed(c.calibrationFactor, 2)}`).join(', ')}</span>
            </li>
          )}
        </ul>
      </div>
    </Card>
  )
}

function SourcesCard({ sources, raster, writable, onImport }: { sources: YieldMapSource[]; raster: YieldRaster | null; writable: boolean; onImport: () => void }) {
  const { t } = useTranslation()
  const toggle = useOrgMutation((p, v: { id: string; included: boolean }) => api.patch(`${p}/yield-maps/sources/${v.id}`, { includedInMerge: v.included }))
  const remove = useOrgMutation((p, id: string) => api.delete(`${p}/yield-maps/sources/${id}`), { success: t('yield.sources.deleted') })
  const massT = (id: string) => raster?.contributions.find((c) => c.sourceId === id)?.massT
  return (
    <Card
      title={t('yield.sources.title')}
      description={t('yield.sources.description')}
      padded={false}
      actions={
        writable && (
          <Button size="sm" onPress={onImport}>
            <FileUp /> {t('yield.sources.add')}
          </Button>
        )
      }
    >
      <Table aria-label={t('yield.sources.title')}>
        <TableHeader>
          <Column>{t('yield.sources.included')}</Column>
          <Column isRowHeader>{t('yield.sources.file')}</Column>
          <Column>{t('yield.sources.harvested')}</Column>
          <Column align="end">{t('yield.sources.mean')}</Column>
          <Column align="end">{t('yield.sources.points')}</Column>
          <Column align="end">{t('yield.sources.mass')}</Column>
          <Column>{t('yield.sources.status')}</Column>
          <Column>{''}</Column>
        </TableHeader>
        <TableBody items={sources} renderEmptyState={() => <div className="py-8 text-center text-sm text-muted">{t('yield.sources.empty')}</div>}>
          {(s) => (
            <Row id={s.id}>
              <Cell>
                <Checkbox aria-label={t('yield.sources.included')} isSelected={s.includedInMerge} isDisabled={!writable || toggle.isPending} onChange={(on) => toggle.mutate({ id: s.id, included: on })} />
              </Cell>
              <Cell>
                <div className="font-medium truncate max-w-64">{s.fileName ?? providerLabel(s.provider)}</div>
                <div className="text-xs text-muted">
                  {[s.machineLabel, formatLabel(s.format), s.crs].filter(Boolean).join(' · ')}
                </div>
              </Cell>
              <Cell className="tabular whitespace-nowrap">{fmt.date(s.harvestedFrom)}</Cell>
              <Cell align="end">{fmtYield(s.pixelMeanTHa ?? s.meanRateTHa)}</Cell>
              <Cell align="end" className="tabular">{fmt.num(s.pointCount)}</Cell>
              <Cell align="end">{fmtTonnes(massT(s.id))}</Cell>
              <Cell>
                <SourceStatusBadge status={s.status} />
                {!s.includedInMerge && s.excludedReason && <div className="text-xs text-muted">{exclusionLabel(s.excludedReason)}</div>}
                {s.status === 'failed' && s.error && <div className="text-xs text-danger max-w-56 truncate" title={s.error}>{s.error}</div>}
                {s.quality && !s.quality.plausible && <div className="text-xs text-warning max-w-56 truncate" title={s.quality.note}>{t('yield.implausible')}</div>}
              </Cell>
              <Cell>
                {writable && (
                  <ConfirmButton
                    title={t('yield.sources.deleteTitle')}
                    message={t('yield.sources.deleteMessage')}
                    confirmLabel={t('common.delete')}
                    onConfirm={() => remove.mutateAsync(s.id)}
                    trigger={
                      <Button variant="ghost" size="icon-sm" aria-label={t('common.delete')}>
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
    </Card>
  )
}

/** Measured yield per zone: of the productivity zones and of saved yield zones. */
function ZoneYieldsCard({ sets }: { sets: ZoneYieldSet[] }) {
  const { t } = useTranslation()
  const [id, setId] = useState<string | null>(null)
  const set = sets.find((s) => s.zoningId === id) ?? sets.find((s) => s.source === 'productivity' && s.zoneCount === 3) ?? sets[0]
  if (!set) {
    return (
      <Card title={t('yield.zoneYields.title')}>
        <p className="text-sm text-muted">{t('yield.zoneYields.none')}</p>
      </Card>
    )
  }
  const label = (s: ZoneYieldSet) =>
    s.source === 'productivity' ? t('yield.zoneYields.productivity', { count: s.zoneCount }) : s.source === 'yield_map' ? t('yield.zones.fromMap', { count: s.zoneCount }) : t('yield.zones.fromEstimate', { count: s.zoneCount })
  return (
    <Card
      title={t('yield.zoneYields.title')}
      description={t('yield.zoneYields.description')}
      padded={false}
      actions={
        sets.length > 1 && (
          <Select aria-label={t('yield.zoneYields.zoning')} className="w-56" items={sets.map((s) => ({ id: s.zoningId, name: label(s) }))} value={set.zoningId} onChange={(v) => setId(String(v))}>
            {(o) => <Option id={o.id}>{o.name}</Option>}
          </Select>
        )
      }
    >
      <Table aria-label={t('yield.zoneYields.title')}>
        <TableHeader>
          <Column isRowHeader>{t('yield.zoneYields.zone')}</Column>
          <Column align="end">{t('yield.zoneYields.area')}</Column>
          <Column align="end">{t('yield.zoneYields.mean')}</Column>
          <Column align="end">{t('yield.zoneYields.relative')}</Column>
          {set.source === 'productivity' ? <Column align="end">{t('yield.zoneYields.productivityCol')}</Column> : <Column>{''}</Column>}
          <Column align="end">{t('yield.zoneYields.pixels')}</Column>
        </TableHeader>
        <TableBody items={set.zones.map((z) => ({ ...z, id: z.zoneNo }))}>
          {(z) => (
            <Row id={z.zoneNo}>
              <Cell>{t('yield.zoneYields.zoneN', { number: z.zoneNo })}</Cell>
              <Cell align="end">{fmt.ha(z.areaHa, 1)}</Cell>
              <Cell align="end">{z.meanTHa != null ? fmtYield(z.meanTHa, 2) : <span className="text-muted" title={t('yield.zoneYields.tooFew')}>—</span>}</Cell>
              <Cell align="end">{fmt.pct(z.relativeYield != null ? z.relativeYield * 100 : null)}</Cell>
              <Cell align="end">{set.source === 'productivity' ? fmt.pct(z.relativeProductivity) : ''}</Cell>
              <Cell align="end" className="tabular">{fmt.num(z.pixels)}</Cell>
            </Row>
          )}
        </TableBody>
      </Table>
      <div className="px-4 py-2 text-xs text-muted">{t('yield.zoneYields.fieldMean', { value: fmtYield(set.fieldMeanTHa, 2) })}</div>
    </Card>
  )
}

/** Saved yield zones of the crop cycle, and creating them from the map. */
function YieldZonesCard({ cycle, data, raster, onShow }: { cycle: CropCycle; data: CropCycleYieldData; raster: YieldRaster | null; onShow: (id: string | null) => void }) {
  const { t } = useTranslation()
  const { can } = useOrg()
  const [count, setCount] = useState<number>(Number.NaN)
  const save = useOrgMutation((p, v: { rasterId: string; zoneCount: number | null }) => api.post<YieldZoning>(`${p}/yield-maps/crop-cycles/${cycle.id}/zonings`, { source: 'yield_map', ...v }), {
    success: t('yield.zones.saved'),
    onSuccess: (z) => onShow(z.id),
  })
  const remove = useOrgMutation((p, id: string) => api.delete(`${p}/yield-maps/crop-cycles/${cycle.id}/zonings/${id}`), { success: t('yield.zones.deleted') })
  if (!raster && data.zonings.length === 0) return null
  return (
    <Card
      title={t('yield.zones.title')}
      description={t('yield.zones.description')}
      actions={
        raster &&
        can('field.write') && (
          <div className="flex items-end gap-2">
            <NumberField aria-label={t('yield.zones.count')} className="w-28" minValue={2} maxValue={7} value={count} onChange={setCount} placeholder={t('yield.zones.auto')} />
            <Button size="sm" isPending={save.isPending} onPress={() => save.mutate({ rasterId: raster.id, zoneCount: Number.isNaN(count) ? null : count })}>
              <Layers /> {t('yield.zones.create')}
            </Button>
          </div>
        )
      }
    >
      {data.zonings.length === 0 ? (
        <p className="text-sm text-muted">{t('yield.zones.none')}</p>
      ) : (
        <ul className="space-y-3">
          {data.zonings.map((z) => (
            <li key={z.id} className="rounded-lg border border-line p-3 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{z.source === 'yield_map' ? t('yield.zones.fromMap', { count: z.zoneCount }) : t('yield.zones.fromEstimate', { count: z.zoneCount })}</span>
                <span className="text-xs text-muted">{fmt.dateTime(z.createdAt)}</span>
                {z.source === 'yield_estimate' && typeof z.params?.sceneDate === 'string' && <span className="text-xs text-muted">{t('yield.estimate.basedOn', { date: fmt.date(z.params.sceneDate as string) })}</span>}
                <span className="flex-1" />
                <Button size="sm" variant="ghost" onPress={() => onShow(z.id)}>
                  {t('yield.zones.showOnMap')}
                </Button>
                {can('field.write') && (
                  <ConfirmButton
                    title={t('yield.zones.deleteTitle')}
                    message={t('yield.zones.deleteMessage')}
                    confirmLabel={t('common.delete')}
                    onConfirm={() => remove.mutateAsync(z.id)}
                    trigger={
                      <Button variant="ghost" size="icon-sm" aria-label={t('common.delete')}>
                        <Trash2 />
                      </Button>
                    }
                  />
                )}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {z.zones.map((zone) => (
                  <span key={zone.zoneNo} className="inline-flex items-center gap-1.5 rounded-full border border-line px-2 py-0.5 text-xs">
                    <span className="size-2.5 rounded-full" style={{ background: zone.color }} aria-hidden />
                    {fmtYield(zone.meanYieldTHa)}
                    <span className="text-muted">{fmt.ha(zone.areaHa, 1)}</span>
                  </span>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
