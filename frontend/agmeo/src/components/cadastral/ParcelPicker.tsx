import type { CadastralLookup, CadastralParcelCandidate, Farm, Field, Tenure } from '@agmeo/contracts'
import { TENURES } from '@agmeo/contracts'
import { useNavigate } from '@tanstack/react-router'
import type { FeatureCollection } from 'geojson'
import { AlertTriangle, Landmark, MousePointerClick, X } from 'lucide-react'
import type { Map as MapLibreMap, MapLayerMouseEvent } from 'maplibre-gl'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Form } from 'react-aria-components'
import { useTranslation } from 'react-i18next'
import { OWN } from '#/components/map/basemaps'
import { FieldMap } from '#/components/map/FieldMap'
import { farmView } from '#/components/map/useMap'
import { api } from '#/lib/api'
import { fmt } from '#/lib/format'
import { useOrg } from '#/lib/org'
import { useOrgMutation, useOrgQuery } from '#/lib/queries'
import { Button } from '#/ui/Button'
import { Option, Select, TextField } from '#/ui/Field'
import { Card, Notice } from '#/ui/Layout'

/** Parcels are loaded from this zoom on; the extent sent is at most the server's limit around the centre. */
const MIN_ZOOM = 15
const MAX_SPAN = { lon: 0.03, lat: 0.02 }
const SELECTED = '#f2b632'
const LOADED = '#cbd5e1'

const keyOf = (p: CadastralParcelCandidate) => p.officialId ?? JSON.stringify(p.geometry.coordinates[0][0][0])

/** A parcel's number as written in the land register: Gemarkung, Flur, Flurstück. */
export function parcelTitle(p: Pick<CadastralParcelCandidate, 'label' | 'officialId'>) {
  return p.label ?? p.officialId ?? '—'
}

/**
 * Pick cadastral parcels (Flurstücke) on the map and make a field of them. The parcels come
 * from the federal state's cadastre service through the API; the field's boundary is their union.
 */
export function ParcelPicker({ farms, fields }: { farms: Farm[]; fields: Field[] }) {
  const { t } = useTranslation()
  const { orgId } = useOrg()
  const navigate = useNavigate()
  const [map, setMap] = useState<MapLibreMap | null>(null)
  const [extent, setExtent] = useState<{ west: number; south: number; east: number; north: number } | null>(null)
  const [zoomedOut, setZoomedOut] = useState(true)
  const [loaded, setLoaded] = useState<Map<string, CadastralParcelCandidate>>(new Map())
  const [selected, setSelected] = useState<Map<string, CadastralParcelCandidate>>(new Map())
  const [farmId, setFarmId] = useState<string | null>(farms[0]?.id ?? null)
  const [name, setName] = useState('')
  const [identifier, setIdentifier] = useState('')
  const [tenure, setTenure] = useState<Tenure>('owned')
  const lookup = useOrgQuery<CadastralLookup>('/cadastral/lookup', extent ?? undefined, { enabled: !!extent, staleTime: 60 * 60_000, keepPrevious: true })

  // Load the parcels of the visible area once the map is close enough.
  useEffect(() => {
    if (!map) return
    const update = () => {
      const zoom = map.getZoom()
      setZoomedOut(zoom < MIN_ZOOM)
      if (zoom < MIN_ZOOM) return
      const b = map.getBounds()
      const c = map.getCenter()
      const r = (v: number) => Math.round(v * 1e5) / 1e5
      setExtent({
        west: r(Math.max(b.getWest(), c.lng - MAX_SPAN.lon / 2)),
        east: r(Math.min(b.getEast(), c.lng + MAX_SPAN.lon / 2)),
        south: r(Math.max(b.getSouth(), c.lat - MAX_SPAN.lat / 2)),
        north: r(Math.min(b.getNorth(), c.lat + MAX_SPAN.lat / 2)),
      })
    }
    update()
    map.on('moveend', update)
    return () => {
      map.off('moveend', update)
    }
  }, [map])

  useEffect(() => {
    const parcels = lookup.data?.parcels
    if (!parcels?.length) return
    setLoaded((prev) => {
      const next = new Map(prev)
      for (const p of parcels) next.set(keyOf(p), p)
      return next
    })
  }, [lookup.data])

  // Click a parcel to add or remove it.
  const loadedRef = useRef(loaded)
  loadedRef.current = loaded
  useEffect(() => {
    if (!map) return
    const layer = `${OWN}overlay-fill`
    const click = (e: MapLayerMouseEvent) => {
      const key = e.features?.[0]?.properties?.key as string | undefined
      const parcel = key ? loadedRef.current.get(key) : undefined
      if (!key || !parcel) return
      setSelected((prev) => {
        const next = new Map(prev)
        if (next.has(key)) next.delete(key)
        else next.set(key, parcel)
        return next
      })
    }
    const enter = () => (map.getCanvas().style.cursor = 'pointer')
    const leave = () => (map.getCanvas().style.cursor = '')
    map.on('click', layer, click)
    map.on('mouseenter', layer, enter)
    map.on('mouseleave', layer, leave)
    return () => {
      map.off('click', layer, click)
      map.off('mouseenter', layer, enter)
      map.off('mouseleave', layer, leave)
    }
  }, [map])

  const overlay = useMemo<FeatureCollection>(() => {
    const all = new Map([...loaded, ...selected])
    return {
      type: 'FeatureCollection',
      features: [...all].map(([key, p]) => ({ type: 'Feature', geometry: p.geometry, properties: { key, color: selected.has(key) ? SELECTED : LOADED } })),
    }
  }, [loaded, selected])

  const picked = [...selected.values()]
  const areaHa = picked.reduce((s, p) => s + p.areaM2, 0) / 10_000
  const fieldName = name.trim() || (picked[0] ? parcelTitle(picked[0]) : '')
  const create = useOrgMutation(
    (base, _: void) =>
      api.post<Field>(`${base}/cadastral/fields`, {
        farmId,
        name: fieldName.slice(0, 200),
        identifier: identifier.trim() || null,
        tenure,
        state: lookup.data?.state?.code ?? null,
        parcels: picked,
      }),
    {
      success: (f) => t('fields.new.saved', { name: f.name, area: fmt.ha(f.areaHa) }),
      onSuccess: (f) => navigate({ to: '/o/$orgId/fields/$fieldId', params: { orgId, fieldId: f.id } }),
    },
  )

  const status = lookup.data?.status
  const stateName = lookup.data?.state?.name ?? ''
  const tenureLabels: Record<Tenure, string> = { owned: t('fields.tenure.owned'), leased: t('fields.tenure.leased'), other: t('fields.tenure.other') }

  return (
    <div className="grid xl:grid-cols-[1fr_24rem] gap-4 items-start">
      <div className="space-y-2">
        <FieldMap
          fields={fields}
          labels={false}
          fillOpacity={0.15}
          overlay={overlay}
          overlayOpacity={0.55}
          onMap={setMap}
          view={farmView(farms.find((f) => f.id === farmId)) ?? (farms[0]?.location ? { center: [farms[0].location.lng, farms[0].location.lat], zoom: MIN_ZOOM } : null)}
          className="h-[60vh] xl:h-[calc(100dvh-12rem)] min-h-96"
        >
          {zoomedOut && (
            <div className="pointer-events-none absolute inset-x-0 top-14 flex justify-center z-10">
              <span className="rounded-lg bg-surface/95 px-3 py-1.5 text-sm font-medium shadow">{t('cadastral.picker.zoomIn')}</span>
            </div>
          )}
          {!zoomedOut && lookup.isFetching && (
            <div className="pointer-events-none absolute inset-x-0 top-14 flex justify-center z-10">
              <span className="rounded-lg bg-surface/95 px-3 py-1.5 text-sm shadow">{t('cadastral.picker.loading')}</span>
            </div>
          )}
        </FieldMap>
        {lookup.data?.state && <p className="text-xs text-muted">{t('cadastral.attribution', { state: stateName, attribution: lookup.data.state.attribution })}</p>}
      </div>
      <div className="space-y-4">
        {!zoomedOut && status && status !== 'ok' && status !== 'ok_slow' && (
          <Notice tone={status === 'no_coverage' ? 'info' : 'warning'} icon={AlertTriangle}>
            {t(`cadastral.status.${status}`, { state: stateName })}
          </Notice>
        )}
        <Card title={t('cadastral.picker.title')} description={t('cadastral.picker.hint')}>
          {picked.length === 0 ? (
            <p className="text-sm text-muted flex items-center gap-2">
              <MousePointerClick className="size-4" aria-hidden /> {t('cadastral.picker.empty')}
            </p>
          ) : (
            <Form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault()
                if (farmId && fieldName) create.mutate()
              }}
            >
              <ul className="max-h-56 overflow-y-auto text-sm divide-y divide-line border border-line rounded-lg">
                {picked.map((p) => (
                  <li key={keyOf(p)} className="px-3 py-1.5 flex items-center gap-2">
                    <Landmark className="size-4 text-muted shrink-0" aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{parcelTitle(p)}</span>
                      {p.officialId && <span className="block text-xs text-muted tabular truncate">{p.officialId}</span>}
                    </span>
                    <span className="tabular text-muted whitespace-nowrap">{fmt.ha(p.areaM2 / 10_000, 2)}</span>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={t('cadastral.picker.remove', { parcel: parcelTitle(p) })}
                      onPress={() =>
                        setSelected((prev) => {
                          const next = new Map(prev)
                          next.delete(keyOf(p))
                          return next
                        })
                      }
                    >
                      <X />
                    </Button>
                  </li>
                ))}
              </ul>
              <p className="text-sm">{t('cadastral.picker.summary', { count: picked.length, area: fmt.ha(areaHa, 2) })}</p>
              <Select label={t('fields.farm')} items={farms} value={farmId} onChange={(v) => setFarmId(v ? String(v) : null)}>
                {(f) => <Option id={f.id}>{f.name}</Option>}
              </Select>
              <TextField label={t('common.name')} value={name} onChange={setName} placeholder={picked[0] ? parcelTitle(picked[0]) : undefined} />
              <TextField label={t('fields.identifier')} value={identifier} onChange={setIdentifier} />
              <Select label={t('fields.tenure.label')} items={TENURES.map((id) => ({ id, name: tenureLabels[id] }))} value={tenure} onChange={(v) => v && setTenure(v as Tenure)}>
                {(o) => <Option id={o.id}>{o.name}</Option>}
              </Select>
              <div className="flex justify-between gap-2">
                <Button variant="ghost" onPress={() => setSelected(new Map())}>{t('cadastral.picker.clear')}</Button>
                <Button type="submit" variant="primary" isDisabled={!farmId || !fieldName} isPending={create.isPending}>
                  {t('cadastral.picker.create')}
                </Button>
              </div>
            </Form>
          )}
        </Card>
      </div>
    </div>
  )
}
