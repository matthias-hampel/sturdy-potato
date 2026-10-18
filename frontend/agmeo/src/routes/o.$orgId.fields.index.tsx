import { FIELD_PART_USAGE_COLORS, IMAGERY_LAYERS, type Farm, type Field, type FieldMonitoringSummary, type FieldPart, type ImageryLayer, type ImageryStretch } from '@agmeo/contracts'
import type { FeatureCollection } from 'geojson'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { ArrowDown, ArrowUp, Download, Map as MapIcon, Minus, Plus, Upload } from 'lucide-react'
import { type Ref, useCallback, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'
import { CropTag } from '#/components/labels'
import { FieldMap } from '#/components/map/FieldMap'
import { FieldShape } from '#/components/map/FieldShape'
import { farmView } from '#/components/map/useMap'
import { AcquisitionPicker, ImageryProgress, IndexLegend, LayerPicker, OpacityPicker, StretchPicker } from '#/components/monitoring/MapControls'
import { INDEX_INFO, indexColor, type ShownIndex } from '#/components/monitoring/indices'
import { useSatelliteLayer } from '#/components/monitoring/useSatelliteLayer'
import { api, saveBlob } from '#/lib/api'
import { fmt } from '#/lib/format'
import { useOrg, useSeason } from '#/lib/org'
import { useOrgQuery } from '#/lib/queries'
import { Button, Link, SegmentedControl } from '#/ui/Button'
import { Option, SearchField, Select } from '#/ui/Field'
import { Badge, Card, DescriptionList, EmptyState, ErrorNotice, Loading, PageHeader } from '#/ui/Layout'
import { cx } from '#/ui/utils'

type Layer = 'crops' | 'imagery'

export const Route = createFileRoute('/o/$orgId/fields/')({
  validateSearch: z.object({
    layer: z.enum(['crops', 'imagery']).optional().catch(undefined),
    index: z.enum(IMAGERY_LAYERS).optional(),
  }),
  component: FieldsPage,
})

const ALL = '__all'

function FieldsPage() {
  const { t } = useTranslation()
  const { orgId, can } = useOrg()
  const { seasonId, season } = useSeason()
  const navigate = useNavigate({ from: Route.fullPath })
  const search = Route.useSearch()
  const layer: Layer = search.layer ?? 'crops'
  const imageryLayer: ImageryLayer = search.index ?? 'ndvi'
  // Field means in the list and popup exist for the indices only; true colour falls back to NDVI there.
  const index: ShownIndex = imageryLayer === 'rgb' ? 'ndvi' : imageryLayer
  const setLayer = (l: Layer) => navigate({ search: (s) => ({ ...s, layer: l === 'crops' ? undefined : l }), replace: true })
  const setIndex = (i: ImageryLayer) => navigate({ search: (s) => ({ ...s, index: i === 'ndvi' ? undefined : i }), replace: true })

  const [farmId, setFarmId] = useState<string>(ALL)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const popupRef = useRef<HTMLDivElement>(null)
  const farms = useOrgQuery<Farm[]>('/farms')
  const fields = useOrgQuery<Field[]>('/fields', { seasonId, farmId: farmId === ALL ? undefined : farmId })
  const allFields = useOrgQuery<Field[]>('/fields')
  const parts = useOrgQuery<FieldPart[]>('/field-parts', { seasonId, farmId: farmId === ALL ? undefined : farmId }, { enabled: layer === 'crops' })
  const monitoring = useOrgQuery<FieldMonitoringSummary[]>('/monitoring/fields', { index }, { enabled: layer !== 'crops' })
  const [stretch, setStretch] = useState<ImageryStretch>('absolute')
  const satellite = useSatelliteLayer({ enabled: layer === 'imagery', layer: imageryLayer, stretch, fields: allFields.data ?? [] })

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (fields.data ?? []).filter((f) => !q || f.name.toLowerCase().includes(q) || f.identifier?.toLowerCase().includes(q) || f.currentCrop?.cropName.toLowerCase().includes(q))
  }, [fields.data, query])
  const selectedField = visible.find((f) => f.id === selected) ?? null
  const totalArea = visible.reduce((s, f) => s + f.areaHa, 0)

  // Divided fields are coloured per part: the part's crop, or its usage when it has none.
  const partsByField = useMemo(() => {
    const visibleIds = new Set(visible.filter((f) => f.partCount > 0).map((f) => f.id))
    const byField = new Map<string, FieldPart[]>()
    for (const p of parts.data ?? []) if (visibleIds.has(p.fieldId)) byField.set(p.fieldId, [...(byField.get(p.fieldId) ?? []), p])
    return byField
  }, [parts.data, visible])
  const partOverlay = useMemo<FeatureCollection | null>(
    () =>
      layer === 'crops' && partsByField.size
        ? {
            type: 'FeatureCollection',
            features: [...partsByField.values()].flat().map((p) => ({ type: 'Feature', geometry: p.geometry, properties: { color: partColor(p) } })),
          }
        : null,
    [layer, partsByField],
  )
  const cropColorBy = useCallback((f: Field) => (partsByField.has(f.id) ? 'transparent' : (f.currentCrop?.color ?? null)), [partsByField])

  const latest = useMemo(() => new Map((monitoring.data ?? []).map((m) => [m.fieldId, m])), [monitoring.data])
  // Satellite layers frame the fields that have observations (farms can be far apart).
  const fitIds = useMemo(() => {
    if (layer === 'crops') return undefined
    const monitored = visible.filter((f) => (latest.get(f.id)?.validObservations ?? 0) > 0).map((f) => f.id)
    return monitored.length ? monitored : undefined
  }, [layer, visible, latest])

  const exportGeoJson = async () => {
    const data = await api.get<unknown>(`/orgs/${orgId}/fields/export.geojson`, { farmId: farmId === ALL ? undefined : farmId })
    saveBlob(new Blob([JSON.stringify(data, null, 2)], { type: 'application/geo+json' }), 'fields.geojson')
  }

  return (
    <>
      <PageHeader
        title={t('fields.title')}
        subtitle={
          season
            ? t('fields.subtitleSeason', { count: visible.length, area: fmt.ha(totalArea, 1), season: season.name })
            : t('fields.subtitle', { count: visible.length, area: fmt.ha(totalArea, 1) })
        }
        actions={
          <>
            <Button onPress={exportGeoJson} isDisabled={!visible.length}>
              <Download /> {t('common.export')}
            </Button>
            {can('field.write') && (
              <>
                <Link to="/o/$orgId/fields/new" params={{ orgId }} search={{ mode: 'import' }} variant="secondary">
                  <Upload /> {t('common.import')}
                </Link>
                <Link to="/o/$orgId/fields/new" params={{ orgId }} search={{}} variant="primary">
                  <Plus /> {t('fields.addField')}
                </Link>
              </>
            )}
          </>
        }
      />

      {fields.isLoading ? (
        <Loading />
      ) : fields.error ? (
        <ErrorNotice error={fields.error} />
      ) : !fields.data?.length && farmId === ALL ? (
        <Card>
          <EmptyState
            icon={MapIcon}
            title={t('fields.empty.title')}
            action={can('field.write') && <Link to="/o/$orgId/fields/new" params={{ orgId }} search={{}} variant="primary"><Plus /> {t('fields.empty.action')}</Link>}
          >
            {t('fields.empty.description')}
          </EmptyState>
        </Card>
      ) : (
        <div className="grid xl:grid-cols-[24rem_1fr] gap-4 items-start">
          <Card padded={false}>
            <div className="p-3 flex gap-2 border-b border-line">
              <SearchField placeholder={t('fields.search')} value={query} onChange={setQuery} className="flex-1" />
              {(farms.data?.length ?? 0) > 1 && (
                <Select aria-label={t('fields.farm')} className="w-36" items={[{ id: ALL, name: t('fields.allFarms') }, ...(farms.data ?? [])]} value={farmId} onChange={(v) => setFarmId(String(v ?? ALL))}>
                  {(f) => <Option id={f.id}>{f.name}</Option>}
                </Select>
              )}
            </div>
            <ul className="max-h-[calc(100dvh-16rem)] overflow-y-auto divide-y divide-line" aria-label={t('fields.list')}>
              {visible.map((f) => {
                const value = latest.get(f.id)?.latest?.mean
                const fieldParts = layer === 'crops' ? partsByField.get(f.id) : undefined
                return (
                  <li key={f.id}>
                    <button
                      type="button"
                      onClick={() => setSelected(f.id)}
                      onDoubleClick={() => navigate({ to: '/o/$orgId/fields/$fieldId', params: { orgId, fieldId: f.id } })}
                      className={cx(
                        'w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-surface-2 outline-none focus-visible:bg-primary-soft',
                        selected === f.id && 'bg-primary-soft',
                      )}
                    >
                      <FieldShape
                        geometry={f.geometry}
                        fill={layer === 'crops' ? (f.currentCrop?.color ?? '#9aa392') : indexColor(index, value)}
                        parts={fieldParts?.map((p) => ({ geometry: p.geometry, color: partColor(p) }))}
                        className="size-8 text-fg"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium truncate">{f.name}</span>
                        <span className="block text-xs text-muted truncate">{f.currentCrop?.cropName ?? t('fields.noCropThisSeason')}{f.identifier ? ` · ${f.identifier}` : ''}</span>
                      </span>
                      <span className="text-sm tabular text-fg-2 whitespace-nowrap text-right">
                        {layer === 'crops' ? (
                          fmt.ha(f.areaHa, 1)
                        ) : value != null ? (
                          <>
                            <span className="font-medium text-fg">{fmt.fixed(value, 2)}</span>
                            <span className="block text-xs text-muted">{fmt.shortDate(latest.get(f.id)?.latest?.observedOn)}</span>
                          </>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </span>
                    </button>
                  </li>
                )
              })}
              {!visible.length && <li className="px-4 py-8 text-sm text-muted text-center">{t('fields.noMatch')}</li>}
            </ul>
          </Card>

          <div className="space-y-3 min-w-0 max-xl:order-first">
            <div className="flex flex-wrap items-center gap-2">
              <SegmentedControl
                aria-label={t('fields.layer.label')}
                value={layer}
                onChange={setLayer}
                items={[
                  { id: 'crops', label: t('fields.layer.crops') },
                  { id: 'imagery', label: t('fields.layer.imagery') },
                ]}
              />
              {layer === 'imagery' && (
                <>
                  <LayerPicker value={imageryLayer} onChange={setIndex} />
                  <StretchPicker value={stretch} onChange={setStretch} isDisabled={imageryLayer === 'rgb'} />
                  {satellite.dates.length > 0 ? (
                    <AcquisitionPicker dates={satellite.dates} date={satellite.date} onDate={satellite.setDate} />
                  ) : (
                    !satellite.isLoading && <span className="text-sm text-muted">{t('fields.noImagery')}</span>
                  )}
                  <OpacityPicker value={satellite.opacity} onChange={satellite.setOpacity} />
                </>
              )}
            </div>
            {layer === 'imagery' && <ImageryProgress status={satellite.status} />}
            <FieldMap
              fields={visible}
              selectedId={selected}
              onSelect={setSelected}
              colorBy={layer === 'crops' ? cropColorBy : undefined}
              fillOpacity={layer === 'imagery' ? 0 : 0.32}
              overlay={partOverlay}
              overlayOpacity={0.45}
              raster={satellite.raster}
              fitIds={fitIds}
              occludedBy={popupRef}
              view={farmView(farmId === ALL ? farms.data?.[0] : farms.data?.find((f) => f.id === farmId))}
              className="h-[55vh] xl:h-[calc(100dvh-14rem)] min-h-96"
            >
              {layer === 'imagery' && !selectedField && <IndexLegend index={imageryLayer} stretch={stretch} />}
              {selectedField && (
                <FieldPopup ref={popupRef} field={selectedField} parts={layer === 'crops' ? partsByField.get(selectedField.id) : undefined} summary={latest.get(selectedField.id)} index={index} showIndex={layer !== 'crops'} orgId={orgId} />
              )}
            </FieldMap>
          </div>
        </div>
      )}
    </>
  )
}

function partColor(p: FieldPart) {
  return p.crops[0]?.color ?? FIELD_PART_USAGE_COLORS[p.usage]
}

function FieldPopup({
  ref,
  field,
  parts,
  summary,
  index,
  showIndex,
  orgId,
}: {
  ref: Ref<HTMLDivElement>
  field: Field
  parts?: FieldPart[]
  summary?: FieldMonitoringSummary
  index: ShownIndex
  showIndex: boolean
  orgId: string
}) {
  const { t } = useTranslation()
  const label = INDEX_INFO[index].label
  const change = summary?.latest?.change ?? null
  const ChangeIcon = change == null ? null : change > 0.005 ? ArrowUp : change < -0.005 ? ArrowDown : Minus
  return (
    <div ref={ref} className="absolute bottom-8 left-3 right-3 sm:right-auto sm:w-80 z-10 rounded-xl border border-line bg-surface p-4 shadow-[var(--shadow-overlay)]">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-semibold truncate">{field.name}</div>
          <div className="text-xs text-muted">{field.farmName}</div>
        </div>
        <Badge tone="primary">{fmt.ha(field.areaHa)}</Badge>
      </div>
      <div className="mt-3">
        <DescriptionList
          items={[
            parts
              ? {
                  label: t('fields.popup.parts'),
                  value: (
                    <ul className="space-y-1">
                      {parts.map((p) => (
                        <li key={p.id} className="min-w-0">
                          <div className="flex items-baseline gap-1.5 min-w-0">
                            <span className="truncate">{p.name}</span>
                            <span className="text-muted tabular whitespace-nowrap">{fmt.ha(p.areaHa, 1)}</span>
                          </div>
                          {p.crops[0] ? (
                            <CropTag name={p.crops[0].cropName} color={p.crops[0].color} />
                          ) : (
                            <Badge dot={FIELD_PART_USAGE_COLORS[p.usage]}>{t(`fieldParts.usage.${p.usage}`)}</Badge>
                          )}
                        </li>
                      ))}
                    </ul>
                  ),
                }
              : { label: t('fields.popup.crop'), value: <CropTag name={field.currentCrop?.cropName} color={field.currentCrop?.color} /> },
            ...(showIndex
              ? [
                  {
                    label: t('fields.popup.latestIndex', { index: label }),
                    value: summary?.latest?.mean != null ? (
                      <span className="tabular">
                        <strong className="font-semibold">{fmt.fixed(summary.latest.mean, 2)}</strong>
                        <span className="text-muted"> · {fmt.date(summary.latest.observedOn)}</span>
                        {ChangeIcon && (
                          <span className="ml-1.5 inline-flex items-center gap-0.5 text-fg-2" title={t('fields.popup.change')}>
                            <ChangeIcon className="size-3.5 text-muted" aria-hidden />
                            {change! > 0 ? '+' : ''}
                            {fmt.fixed(change, 2)}
                          </span>
                        )}
                      </span>
                    ) : (
                      <span className="text-muted">{t('fields.popup.noValidObservation')}</span>
                    ),
                  },
                ]
              : [
                  { label: t('fields.identifier'), value: field.identifier },
                  { label: t('fields.popup.soil'), value: field.soilType },
                ]),
          ]}
        />
      </div>
      <Link
        to="/o/$orgId/fields/$fieldId"
        params={{ orgId, fieldId: field.id }}
        search={showIndex ? { tab: 'satellite', index } : {}}
        variant="secondary"
        size="sm"
        className="mt-3 w-full"
      >
        {showIndex ? t('fields.popup.indexHistory', { index: label }) : t('fields.popup.open')}
      </Link>
    </div>
  )
}
