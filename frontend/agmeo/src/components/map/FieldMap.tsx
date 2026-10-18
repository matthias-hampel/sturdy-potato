import type { Field } from '@agmeo/contracts'
import bbox from '@turf/bbox'
import type { Feature, FeatureCollection, Geometry, MultiPolygon, Polygon } from 'geojson'
import { Layers, Map as MapIcon } from 'lucide-react'
import type { GeoJSONSource, LngLatBoundsLike, Map as MapLibreMap, MapLayerMouseEvent } from 'maplibre-gl'
import { type ReactNode, type RefObject, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { fmt } from '#/lib/format'
import { SegmentedControl } from '#/ui/Button'
import { cx } from '#/ui/utils'
import { type Basemap, OWN } from './basemaps'
import { frameBounds, MIN_FIT_ZOOM } from './framing'
import { type MapView, useMap } from './useMap'

const NO_CROP = '#9aa392'
const SOURCE = `${OWN}fields`
const HIGHLIGHT = `${OWN}highlight`
const RASTER = `${OWN}raster`
const OVERLAY = `${OWN}overlay`

export interface FieldMapProps {
  fields: Field[]
  selectedId?: string | null
  onSelect?: (fieldId: string | null) => void
  /** Extra geometry drawn on top, e.g. a historical boundary or an import preview. */
  highlight?: Geometry | FeatureCollection | null
  className?: string
  interactive?: boolean
  labels?: boolean
  /** Fit to these fields instead of all. */
  fitIds?: string[]
  /** Fallback view (e.g. the farm's saved view) when there are no fields or highlight to fit. */
  view?: MapView | null
  defaultBasemap?: Basemap
  children?: ReactNode
  colorBy?: (field: Field) => string | null
  /** Fill opacity of unselected fields; raise it when the colour encodes a value. */
  fillOpacity?: number
  /** Raster overlay drawn below the field outlines, e.g. a satellite index layer. */
  raster?: { tiles: string; opacity: number; attribution?: string } | null
  /** Polygons drawn below the field outlines, coloured by their `color` property (e.g. zones). */
  overlay?: FeatureCollection | null
  overlayOpacity?: number
  /** An overlay (e.g. a popup child) the selected field is centred clear of. */
  occludedBy?: RefObject<HTMLElement | null>
}

export function FieldMap({
  fields,
  selectedId,
  onSelect,
  highlight,
  className,
  interactive = true,
  labels = true,
  fitIds,
  view,
  defaultBasemap = 'satellite',
  children,
  colorBy,
  fillOpacity = 0.32,
  raster,
  overlay,
  overlayOpacity = 0.85,
  occludedBy,
}: FieldMapProps) {
  const { t } = useTranslation()
  const [basemap, setBasemap] = useState<Basemap>(defaultBasemap)
  const fitFields = useMemo(() => (fitIds ? fields.filter((f) => fitIds.includes(f.id)) : fields), [fields, fitIds])
  // A highlight (e.g. an import preview) is always framed whole; fields far apart only by their largest group.
  const fitBounds = useMemo(() => (highlight ? boundsOf(fitFields, highlight) : frameBounds(fitFields)), [fitFields, highlight])
  const fallbackView = fitBounds ? null : (view ?? null)
  const [initial] = useState(() => (fitBounds ? { bounds: fitBounds } : { center: fallbackView?.center, zoom: fallbackView?.zoom }))
  const { containerRef, map, styleVersion } = useMap({ basemap, interactive, ...initial })
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect

  const data = useMemo<FeatureCollection>(
    () => ({
      type: 'FeatureCollection',
      features: fields.map((f) => ({
        type: 'Feature',
        id: f.id,
        geometry: f.geometry,
        properties: {
          id: f.id,
          name: f.name,
          label: `${f.name}\n${fmt.ha(f.areaHa, 1)}`,
          color: (colorBy ? colorBy(f) : f.currentCrop?.color) ?? NO_CROP,
        },
      })),
    }),
    [fields, colorBy],
  )

  // Layers (re-added after a basemap change only if missing).
  useEffect(() => {
    if (!map) return
    ensureLayers(map, basemap, labels)
    ;(map.getSource(SOURCE) as GeoJSONSource).setData(data)
  }, [map, data, basemap, labels, styleVersion])

  useEffect(() => {
    if (!map || !map.getLayer(`${OWN}fields-outline`)) return
    const sel = selectedId ?? ''
    map.setPaintProperty(`${OWN}fields-fill`, 'fill-opacity', ['case', ['==', ['get', 'id'], sel], Math.max(0.6, fillOpacity), fillOpacity])
    map.setPaintProperty(`${OWN}fields-outline`, 'line-width', ['case', ['==', ['get', 'id'], sel], 3.5, 1.6])
    map.setPaintProperty(`${OWN}fields-outline`, 'line-color', ['case', ['==', ['get', 'id'], sel], '#f2b632', basemap === 'satellite' ? '#ffffff' : '#2b3a24'])
  }, [map, selectedId, basemap, styleVersion, data, fillOpacity])

  // Raster overlay: replaced whenever the tile URL changes (another scene or index).
  useEffect(() => {
    if (!map) return
    const layer = `${OWN}raster`
    if (map.getLayer(layer)) map.removeLayer(layer)
    if (map.getSource(RASTER)) map.removeSource(RASTER)
    if (!raster) return
    map.addSource(RASTER, { type: 'raster', tiles: [raster.tiles], tileSize: 256, maxzoom: 17, attribution: raster.attribution })
    map.addLayer({ id: layer, type: 'raster', source: RASTER, paint: { 'raster-opacity': raster.opacity, 'raster-resampling': 'nearest' } }, `${OWN}fields-fill`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, raster?.tiles, styleVersion])

  useEffect(() => {
    if (map?.getLayer(`${OWN}raster`) && raster) map.setPaintProperty(`${OWN}raster`, 'raster-opacity', raster.opacity)
  }, [map, raster?.opacity])

  // Polygon overlay (zones): data updated in place, layers created once per style.
  useEffect(() => {
    if (!map || !map.getLayer(`${OWN}fields-fill`)) return
    const empty: FeatureCollection = { type: 'FeatureCollection', features: [] }
    if (!map.getSource(OVERLAY)) {
      map.addSource(OVERLAY, { type: 'geojson', data: empty })
      map.addLayer({ id: `${OVERLAY}-fill`, type: 'fill', source: OVERLAY, paint: { 'fill-color': ['get', 'color'], 'fill-opacity': overlayOpacity } }, `${OWN}fields-fill`)
      map.addLayer({ id: `${OVERLAY}-line`, type: 'line', source: OVERLAY, paint: { 'line-color': '#ffffff', 'line-width': 0.8, 'line-opacity': 0.9 } }, `${OWN}fields-fill`)
    }
    ;(map.getSource(OVERLAY) as GeoJSONSource).setData(overlay ?? empty)
    map.setPaintProperty(`${OVERLAY}-fill`, 'fill-opacity', overlayOpacity)
  }, [map, overlay, overlayOpacity, styleVersion, data])

  useEffect(() => {
    if (!map) return
    const source = map.getSource(HIGHLIGHT) as GeoJSONSource | undefined
    source?.setData(toCollection(highlight))
  }, [map, highlight, styleVersion])

  // Click and hover.
  useEffect(() => {
    if (!map || !interactive) return
    const layer = `${OWN}fields-fill`
    const click = (e: MapLayerMouseEvent) => onSelectRef.current?.((e.features?.[0]?.properties?.id as string) ?? null)
    const enter = () => (map.getCanvas().style.cursor = onSelectRef.current ? 'pointer' : '')
    const leave = () => (map.getCanvas().style.cursor = '')
    map.on('click', layer, click)
    map.on('mouseenter', layer, enter)
    map.on('mouseleave', layer, leave)
    return () => {
      map.off('click', layer, click)
      map.off('mouseenter', layer, enter)
      map.off('mouseleave', layer, leave)
    }
  }, [map, interactive])

  // Centre a newly selected field in the area left free by `occludedBy`. Keeps the zoom unless the field
  // doesn't fit or the map is zoomed out past the labels.
  const centredId = useRef(selectedId)
  useEffect(() => {
    if (!map || selectedId === centredId.current) return
    centredId.current = selectedId
    const field = selectedId ? fields.find((f) => f.id === selectedId) : undefined
    const b = field && boundsOf([field], null)
    if (!b) return
    const padding = freePadding(map.getContainer(), occludedBy?.current, 48)
    const fit = map.cameraForBounds(b as LngLatBoundsLike, { padding, maxZoom: 16.5 })
    const fitZoom = fit?.zoom ?? map.getZoom()
    const zoom = map.getZoom() < 12.5 ? Math.min(fitZoom, 15) : Math.min(map.getZoom(), fitZoom)
    const offset: [number, number] = [(padding.left - padding.right) / 2, (padding.top - padding.bottom) / 2]
    map.easeTo({ center: [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2], zoom, offset, duration: 500 })
  }, [map, selectedId, fields, occludedBy])

  // Fit to fields when the set of fields changes; the fallback view only applies without any. A selected
  // field that is still shown keeps the camera (e.g. while another index or layer loads).
  const fitKey = fitBounds
    ? fitFields.map((f) => f.id).join(',') + (highlight ? ':h' : '')
    : fallbackView ? `view:${fallbackView.center.join(',')}@${fallbackView.zoom}` : ''
  const fitted = useRef(false)
  useEffect(() => {
    if (!map) return
    map.resize()
    if (fitted.current && selectedId && fields.some((f) => f.id === selectedId)) return
    fitted.current = true
    if (fitBounds) {
      const camera = map.cameraForBounds(fitBounds as LngLatBoundsLike, { padding: 48, maxZoom: 16.5 })
      if (camera) map.jumpTo({ center: camera.center, zoom: highlight ? camera.zoom : Math.max(camera.zoom ?? MIN_FIT_ZOOM, MIN_FIT_ZOOM) })
    } else if (fallbackView) map.jumpTo(fallbackView)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, fitKey])

  return (
    <div className={cx('relative overflow-hidden rounded-xl border border-line bg-surface-3', className)}>
      <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />
      {interactive && (
        <div className="absolute top-3 left-3 z-10">
          <SegmentedControl
            aria-label={t('map.basemap.label')}
            value={basemap}
            onChange={setBasemap}
            items={[
              { id: 'satellite', label: <><Layers aria-hidden /> {t('map.basemap.satellite')}</> },
              { id: 'map', label: <><MapIcon aria-hidden /> {t('map.basemap.map')}</> },
            ]}
          />
        </div>
      )}
      {children}
    </div>
  )
}

function boundsOf(fields: Field[], highlight: Geometry | FeatureCollection | null | undefined): [number, number, number, number] | undefined {
  const features = [...fields.map((f) => ({ type: 'Feature' as const, geometry: f.geometry, properties: {} })), ...toCollection(highlight).features]
  if (!features.length) return undefined
  const [w, s, e, n] = bbox({ type: 'FeatureCollection', features })
  return [w, s, e, n]
}

/** Padding that keeps the camera clear of an overlay: beside it or above it, whichever leaves more room. */
function freePadding(container: HTMLElement, overlay: HTMLElement | null | undefined, base: number) {
  const padding = { top: base, right: base, bottom: base, left: base }
  if (!overlay) return padding
  const c = container.getBoundingClientRect()
  const o = overlay.getBoundingClientRect()
  const besideArea = (c.right - o.right) * c.height
  const aboveArea = (o.top - c.top) * c.width
  if (besideArea > aboveArea) padding.left += o.right - c.left
  else padding.bottom += c.bottom - o.top
  return padding
}

function toCollection(g: Geometry | FeatureCollection | null | undefined): FeatureCollection {
  if (!g) return { type: 'FeatureCollection', features: [] }
  if (g.type === 'FeatureCollection') return g
  return { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: g, properties: {} } as Feature] }
}

function ensureLayers(map: MapLibreMap, basemap: Basemap, labels: boolean) {
  if (!map.getSource(SOURCE)) map.addSource(SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
  if (!map.getSource(HIGHLIGHT)) map.addSource(HIGHLIGHT, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
  if (!map.getLayer(`${OWN}fields-fill`)) {
    map.addLayer({ id: `${OWN}fields-fill`, type: 'fill', source: SOURCE, paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.32 } })
  }
  if (!map.getLayer(`${OWN}fields-outline`)) {
    map.addLayer({
      id: `${OWN}fields-outline`,
      type: 'line',
      source: SOURCE,
      paint: { 'line-color': basemap === 'satellite' ? '#ffffff' : '#2b3a24', 'line-width': 1.6 },
    })
  }
  if (!map.getLayer(`${OWN}highlight-fill`)) {
    map.addLayer({ id: `${OWN}highlight-fill`, type: 'fill', source: HIGHLIGHT, paint: { 'fill-color': '#f2b632', 'fill-opacity': 0.25 } })
    map.addLayer({ id: `${OWN}highlight-line`, type: 'line', source: HIGHLIGHT, paint: { 'line-color': '#f2b632', 'line-width': 2.5, 'line-dasharray': [2, 1.5] } })
  }
  if (labels && !map.getLayer(`${OWN}fields-label`)) {
    map.addLayer({
      id: `${OWN}fields-label`,
      type: 'symbol',
      source: SOURCE,
      minzoom: 12.5,
      layout: {
        'text-field': ['get', 'label'],
        'text-font': ['Noto Sans Regular'],
        'text-size': 12,
        'text-max-width': 10,
        'symbol-placement': 'point',
      },
      paint: { 'text-color': '#ffffff', 'text-halo-color': 'rgba(20,28,16,0.85)', 'text-halo-width': 1.4 },
    })
  }
}

export type { Polygon, MultiPolygon }
