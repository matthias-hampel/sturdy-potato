import bbox from '@turf/bbox'
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from 'geojson'
import type { GeoJSONSource, MapLayerMouseEvent, MapMouseEvent } from 'maplibre-gl'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { TerraDraw, TerraDrawPolygonMode } from 'terra-draw'
import { TerraDrawMapLibreGLAdapter } from 'terra-draw-maplibre-gl-adapter'
import { SegmentedControl } from '#/ui/Button'
import { cx } from '#/ui/utils'
import { type Basemap, OWN } from '../map/basemaps'
import { useMap } from '../map/useMap'

export type LngLat = [number, number]
export type MapTool = 'select' | 'brush' | 'fill' | 'pencil' | 'axis' | 'points'

export interface MapZone {
  key: string
  geometry: MultiPolygon
  color: string
  /** Text on the map, e.g. the probe number. */
  label?: string
  /** [lng, lat] of the sampling point. */
  point?: LngLat | null
}

interface Props {
  boundary: MultiPolygon
  zones: MapZone[]
  selectedKey?: string | null
  /** Plan preview drawn instead of the zones (dashed outlines). */
  preview?: MapZone[] | null
  lines?: LngLat[][]
  /** Editable points (Voronoi generators) and the grid axis. */
  points?: LngLat[]
  axis?: [LngLat, LngLat] | null
  tool?: MapTool
  brushSizeM?: number
  fillOpacity?: number
  onSelect?: (key: string | null) => void
  onBrush?: (from: LngLat, to: LngLat, start: boolean) => void
  onFill?: (at: LngLat) => void
  onPolygon?: (polygon: Polygon) => void
  onAxisPoint?: (at: LngLat) => void
  onPointsChange?: (points: LngLat[]) => void
  className?: string
}

const ZONES = `${OWN}soil-zones`
const BOUNDARY = `${OWN}soil-boundary`
const LABELS = `${OWN}soil-labels`
const PREVIEW = `${OWN}soil-preview`
const LINES = `${OWN}soil-lines`
const POINTS = `${OWN}soil-points`
const CURSOR = `${OWN}soil-cursor`

const fc = (features: Feature[]): FeatureCollection => ({ type: 'FeatureCollection', features })

/**
 * The soil map of one field: zones coloured, probe numbers and sampling points, a plan preview,
 * and the editor's pointer tools (brush, fill, pencil, grid axis, Voronoi points).
 */
export function SoilZoneMap({
  boundary,
  zones,
  selectedKey,
  preview,
  lines,
  points,
  axis,
  tool = 'select',
  brushSizeM = 20,
  fillOpacity = 0.6,
  onSelect,
  onBrush,
  onFill,
  onPolygon,
  onAxisPoint,
  onPointsChange,
  className,
}: Props) {
  const { t } = useTranslation()
  const [basemap, setBasemap] = useState<Basemap>('satellite')
  const [w, s, e, n] = bbox(boundary)
  const { containerRef, map, styleVersion } = useMap({ basemap, bounds: [w, s, e, n] })
  const handlers = useRef({ onSelect, onBrush, onFill, onPolygon, onAxisPoint, onPointsChange, tool, points, brushSizeM })
  handlers.current = { onSelect, onBrush, onFill, onPolygon, onAxisPoint, onPointsChange, tool, points, brushSizeM }

  const zoneData = useMemo(
    () =>
      fc(
        zones.map((z) => ({
          type: 'Feature',
          geometry: z.geometry,
          properties: { key: z.key, color: z.color, selected: z.key === selectedKey ? 1 : 0 },
        })),
      ),
    [zones, selectedKey],
  )
  const labelData = useMemo(
    () =>
      fc(
        (preview ?? zones).flatMap((z) =>
          z.point ? [{ type: 'Feature', geometry: { type: 'Point', coordinates: z.point }, properties: { label: z.label ?? '' } } as Feature] : [],
        ),
      ),
    [zones, preview],
  )
  const previewData = useMemo(() => fc((preview ?? []).map((z) => ({ type: 'Feature', geometry: z.geometry, properties: { color: z.color } }))), [preview])
  const lineData = useMemo(
    () =>
      fc([
        ...(lines ?? []).map((l) => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: l }, properties: { kind: 'grid' } }) as Feature),
        ...(axis ? [{ type: 'Feature', geometry: { type: 'LineString', coordinates: axis }, properties: { kind: 'axis' } } as Feature] : []),
      ]),
    [lines, axis],
  )
  const pointData = useMemo(() => fc((points ?? []).map((p, i) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: p }, properties: { i } }))), [points])

  // Sources and layers, recreated after a basemap change.
  useEffect(() => {
    if (!map) return
    const add = (id: string, data: FeatureCollection) => {
      if (!map.getSource(id)) map.addSource(id, { type: 'geojson', data })
    }
    add(BOUNDARY, fc([{ type: 'Feature', geometry: boundary, properties: {} }]))
    add(ZONES, zoneData)
    add(PREVIEW, previewData)
    add(LINES, lineData)
    add(LABELS, labelData)
    add(POINTS, pointData)
    add(CURSOR, fc([]))
    const layer = (spec: Parameters<typeof map.addLayer>[0]) => {
      if (!map.getLayer(spec.id)) map.addLayer(spec)
    }
    layer({ id: `${ZONES}-fill`, type: 'fill', source: ZONES, paint: { 'fill-color': ['get', 'color'], 'fill-opacity': fillOpacity } })
    layer({ id: `${ZONES}-line`, type: 'line', source: ZONES, paint: { 'line-color': '#ffffff', 'line-width': ['case', ['==', ['get', 'selected'], 1], 3, 1] } })
    layer({ id: `${PREVIEW}-fill`, type: 'fill', source: PREVIEW, paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.45 } })
    layer({ id: `${PREVIEW}-line`, type: 'line', source: PREVIEW, paint: { 'line-color': '#ffffff', 'line-width': 1.5, 'line-dasharray': [2, 1] } })
    layer({ id: `${LINES}-line`, type: 'line', source: LINES, paint: { 'line-color': ['case', ['==', ['get', 'kind'], 'axis'], '#f2b632', 'rgba(255,255,255,0.45)'], 'line-width': ['case', ['==', ['get', 'kind'], 'axis'], 3, 0.8] } })
    layer({ id: `${BOUNDARY}-line`, type: 'line', source: BOUNDARY, paint: { 'line-color': '#ffffff', 'line-width': 2.5 } })
    layer({ id: `${CURSOR}-line`, type: 'line', source: CURSOR, paint: { 'line-color': '#f2b632', 'line-width': 2 } })
    layer({ id: `${POINTS}-circle`, type: 'circle', source: POINTS, paint: { 'circle-radius': 6, 'circle-color': '#f2b632', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2 } })
    layer({
      id: `${LABELS}-circle`,
      type: 'circle',
      source: LABELS,
      paint: { 'circle-radius': 3, 'circle-color': '#111827', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1.5 },
    })
    layer({
      id: `${LABELS}-text`,
      type: 'symbol',
      source: LABELS,
      layout: { 'text-field': ['get', 'label'], 'text-size': 13, 'text-offset': [0, -1.1], 'text-font': ['Noto Sans Regular'], 'text-allow-overlap': true },
      paint: { 'text-color': '#ffffff', 'text-halo-color': 'rgba(15,20,12,0.9)', 'text-halo-width': 1.5 },
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, styleVersion])

  useEffect(() => void (map?.getSource(ZONES) as GeoJSONSource | undefined)?.setData(zoneData), [map, zoneData, styleVersion])
  useEffect(() => void (map?.getSource(PREVIEW) as GeoJSONSource | undefined)?.setData(previewData), [map, previewData, styleVersion])
  useEffect(() => void (map?.getSource(LINES) as GeoJSONSource | undefined)?.setData(lineData), [map, lineData, styleVersion])
  useEffect(() => void (map?.getSource(LABELS) as GeoJSONSource | undefined)?.setData(labelData), [map, labelData, styleVersion])
  useEffect(() => void (map?.getSource(POINTS) as GeoJSONSource | undefined)?.setData(pointData), [map, pointData, styleVersion])
  useEffect(() => {
    if (map?.getLayer(`${ZONES}-fill`)) map.setPaintProperty(`${ZONES}-fill`, 'fill-opacity', fillOpacity)
  }, [map, fillOpacity, styleVersion])

  // Pointer tools.
  useEffect(() => {
    if (!map) return
    const canvas = map.getCanvas()
    let last: LngLat | null = null
    let dragIndex: number | null = null
    const at = (e: MapMouseEvent): LngLat => [e.lngLat.lng, e.lngLat.lat]
    const cursorSquare = (p: LngLat) => {
      const size = handlers.current.brushSizeM
      const dLat = size / 2 / 111_320
      const dLng = size / 2 / (111_320 * Math.cos((p[1] * Math.PI) / 180))
      const ring = [
        [p[0] - dLng, p[1] - dLat],
        [p[0] + dLng, p[1] - dLat],
        [p[0] + dLng, p[1] + dLat],
        [p[0] - dLng, p[1] + dLat],
        [p[0] - dLng, p[1] - dLat],
      ]
      ;(map.getSource(CURSOR) as GeoJSONSource | undefined)?.setData(fc([{ type: 'Feature', geometry: { type: 'LineString', coordinates: ring }, properties: {} }]))
    }
    const down = (e: MapMouseEvent) => {
      const h = handlers.current
      if (h.tool === 'brush') {
        e.preventDefault()
        map.dragPan.disable()
        last = at(e)
        h.onBrush?.(last, last, true)
      } else if (h.tool === 'points') {
        const hit = map.queryRenderedFeatures(e.point, { layers: [`${POINTS}-circle`] })[0]
        if (hit) {
          e.preventDefault()
          map.dragPan.disable()
          dragIndex = Number(hit.properties?.i)
        }
      }
    }
    const move = (e: MapMouseEvent) => {
      const h = handlers.current
      if (h.tool === 'brush') {
        cursorSquare(at(e))
        if (last) {
          const next = at(e)
          h.onBrush?.(last, next, false)
          last = next
        }
      } else if (h.tool === 'points' && dragIndex != null && h.points) {
        const next = [...h.points]
        next[dragIndex] = at(e)
        h.onPointsChange?.(next)
      }
    }
    const up = () => {
      if (last || dragIndex != null) map.dragPan.enable()
      last = null
      dragIndex = null
    }
    const click = (e: MapLayerMouseEvent | MapMouseEvent) => {
      const h = handlers.current
      if (h.tool === 'fill') h.onFill?.(at(e))
      else if (h.tool === 'axis') h.onAxisPoint?.(at(e))
      else if (h.tool === 'points' && h.points) {
        const hit = map.queryRenderedFeatures(e.point, { layers: [`${POINTS}-circle`] })[0]
        // Shift-click removes a point, a click on empty ground adds one.
        if (hit && (e.originalEvent as MouseEvent).shiftKey) h.onPointsChange?.(h.points.filter((_, i) => i !== Number(hit.properties?.i)))
        else if (!hit) h.onPointsChange?.([...h.points, at(e)])
      } else if (h.tool === 'select') {
        const hit = map.queryRenderedFeatures(e.point, { layers: [`${ZONES}-fill`] })[0]
        h.onSelect?.(hit ? String(hit.properties?.key) : null)
      }
    }
    map.on('mousedown', down)
    map.on('mousemove', move)
    map.on('mouseup', up)
    map.on('click', click)
    canvas.addEventListener('mouseleave', up)
    return () => {
      map.off('mousedown', down)
      map.off('mousemove', move)
      map.off('mouseup', up)
      map.off('click', click)
      canvas.removeEventListener('mouseleave', up)
      map.dragPan.enable()
    }
  }, [map])

  useEffect(() => {
    if (!map) return
    map.getCanvas().style.cursor = tool === 'select' ? '' : tool === 'brush' ? 'none' : 'crosshair'
    if (tool !== 'brush') (map.getSource(CURSOR) as GeoJSONSource | undefined)?.setData(fc([]))
  }, [map, tool])

  // Pencil: a polygon drawn with Terra Draw is painted into the selected zone.
  useEffect(() => {
    if (!map || tool !== 'pencil') return
    const draw = new TerraDraw({
      adapter: new TerraDrawMapLibreGLAdapter({ map }),
      modes: [new TerraDrawPolygonMode({ styles: { fillColor: '#f2b632', fillOpacity: 0.25, outlineColor: '#f2b632', outlineWidth: 2 } })],
    })
    draw.start()
    draw.setMode('polygon')
    draw.on('finish', (id) => {
      const feature = draw.getSnapshot().find((f) => f.id === id)
      if (feature?.geometry.type === 'Polygon') handlers.current.onPolygon?.(feature.geometry as Polygon)
      draw.clear()
    })
    return () => {
      try {
        draw.stop()
      } catch {
        // Map already torn down.
      }
    }
  }, [map, tool])

  return (
    <div className={cx('relative overflow-hidden rounded-xl border border-line bg-surface-3', className)}>
      <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />
      <div className="absolute left-3 top-3">
        <SegmentedControl
          aria-label={t('map.basemap.label')}
          value={basemap}
          onChange={setBasemap}
          items={[
            { id: 'satellite', label: t('map.basemap.satellite') },
            { id: 'map', label: t('map.basemap.map') },
          ]}
        />
      </div>
    </div>
  )
}
