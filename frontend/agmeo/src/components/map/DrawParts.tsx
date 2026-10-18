import bbox from '@turf/bbox'
import type { FeatureCollection, MultiPolygon, Polygon, Position } from 'geojson'
import type { GeoJSONSource } from 'maplibre-gl'
import { useEffect, useRef } from 'react'
import { TerraDraw, TerraDrawPolygonMode, TerraDrawSelectMode, type GeoJSONStoreFeatures } from 'terra-draw'
import { TerraDrawMapLibreGLAdapter } from 'terra-draw-maplibre-gl-adapter'
import { cx } from '#/ui/utils'
import { OWN } from './basemaps'
import { useMap } from './useMap'

export type PartGeometry = Polygon | MultiPolygon

export interface DrawnPart {
  key: string
  /** Null for the remainder, which has no shape of its own. */
  geometry: PartGeometry | null
}

interface Props {
  boundary: MultiPolygon
  parts: DrawnPart[]
  /** Clipped parts as computed by the server, coloured by their `color` property. */
  preview: FeatureCollection | null
  selectedKey: string | null
  /** While true, the next polygon drawn becomes a new part. */
  drawing: boolean
  onSelect: (key: string | null) => void
  onGeometry: (key: string, geometry: PartGeometry | null) => void
  onCreate: (geometry: Polygon) => string
  className?: string
}

const BOUNDARY = `${OWN}parts-boundary`
const PREVIEW = `${OWN}parts-preview`
const round = (p: Position): Position => [Math.round(p[0] * 1e7) / 1e7, Math.round(p[1] * 1e7) / 1e7]

/**
 * Draws the parts of a field on aerial imagery. Shapes may reach beyond the field; the
 * preview shows what each part covers after clipping to the boundary.
 */
export function DrawParts({ boundary, parts, preview, selectedKey, drawing, onSelect, onGeometry, onCreate, className }: Props) {
  const [w, s, e, n] = bbox(boundary)
  const { containerRef, map } = useMap({ basemap: 'satellite', bounds: [w, s, e, n] })
  const drawRef = useRef<TerraDraw | null>(null)
  // Terra Draw feature id → part key; a part may consist of several polygons.
  const owner = useRef(new Map<string, string>())
  const callbacks = useRef({ onSelect, onGeometry, onCreate })
  callbacks.current = { onSelect, onGeometry, onCreate }

  useEffect(() => {
    if (!map) return
    map.addSource(BOUNDARY, { type: 'geojson', data: { type: 'Feature', geometry: boundary, properties: {} } })
    map.addSource(PREVIEW, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
    map.addLayer({ id: `${PREVIEW}-fill`, type: 'fill', source: PREVIEW, paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.55 } })
    map.addLayer({ id: `${PREVIEW}-line`, type: 'line', source: PREVIEW, paint: { 'line-color': '#ffffff', 'line-width': 1 } })
    map.addLayer({ id: `${BOUNDARY}-line`, type: 'line', source: BOUNDARY, paint: { 'line-color': '#ffffff', 'line-width': 2.5 } })

    const draw = new TerraDraw({
      adapter: new TerraDrawMapLibreGLAdapter({ map }),
      modes: [
        new TerraDrawPolygonMode({
          styles: { fillColor: '#f2b632', fillOpacity: 0.2, outlineColor: '#f2b632', outlineWidth: 2, closingPointColor: '#ffffff', closingPointOutlineColor: '#f2b632' },
        }),
        new TerraDrawSelectMode({
          flags: { polygon: { feature: { draggable: true, coordinates: { midpoints: true, draggable: true, deletable: true } } } },
          styles: {
            selectedPolygonColor: '#f2b632',
            selectedPolygonOutlineColor: '#f2b632',
            selectedPolygonFillOpacity: 0.15,
            selectionPointColor: '#ffffff',
            selectionPointOutlineColor: '#f2b632',
            midPointColor: '#f2b632',
          },
        }),
      ],
    })
    draw.start()
    drawRef.current = draw

    const features: GeoJSONStoreFeatures[] = []
    for (const part of parts) {
      if (!part.geometry) continue
      const polygons = part.geometry.type === 'Polygon' ? [part.geometry.coordinates] : part.geometry.coordinates
      for (const coordinates of polygons) {
        const id = crypto.randomUUID()
        owner.current.set(id, part.key)
        features.push({ id, type: 'Feature', geometry: { type: 'Polygon', coordinates }, properties: { mode: 'polygon' } } as GeoJSONStoreFeatures)
      }
    }
    if (features.length) draw.addFeatures(features)
    draw.setMode('select')

    const emit = (key: string) => {
      const polygons = draw
        .getSnapshot()
        .filter((f) => owner.current.get(String(f.id)) === key && f.geometry.type === 'Polygon')
        .map((f) => (f.geometry as Polygon).coordinates.map((ring) => ring.map(round)))
        .filter((rings) => rings[0]?.length >= 4)
      callbacks.current.onGeometry(
        key,
        polygons.length === 0 ? null : polygons.length === 1 ? { type: 'Polygon', coordinates: polygons[0] } : { type: 'MultiPolygon', coordinates: polygons },
      )
    }
    draw.on('finish', (id, context) => {
      const featureId = String(id)
      if (context.mode === 'polygon' && !owner.current.has(featureId)) {
        const feature = draw.getSnapshot().find((f) => String(f.id) === featureId)
        if (feature?.geometry.type === 'Polygon') {
          const geometry: Polygon = { type: 'Polygon', coordinates: feature.geometry.coordinates.map((ring) => ring.map(round)) }
          owner.current.set(featureId, callbacks.current.onCreate(geometry))
        }
        draw.setMode('select')
        return
      }
      const key = owner.current.get(featureId)
      if (key) emit(key)
    })
    draw.on('change', (ids, type) => {
      if (type === 'styling') return
      const keys = new Set(ids.map((i) => owner.current.get(String(i))).filter((k): k is string => !!k))
      for (const key of keys) emit(key)
    })
    draw.on('select', (id) => {
      const key = owner.current.get(String(id))
      if (key) callbacks.current.onSelect(key)
    })

    return () => {
      drawRef.current = null
      try {
        draw.stop()
        for (const id of [`${BOUNDARY}-line`, `${PREVIEW}-line`, `${PREVIEW}-fill`]) if (map.getLayer(id)) map.removeLayer(id)
        for (const id of [BOUNDARY, PREVIEW]) if (map.getSource(id)) map.removeSource(id)
      } catch {
        // Map already torn down.
      }
    }
    // Initialized once per map; `parts` are starting values, later changes come from the drawing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map])

  useEffect(() => {
    const src = map?.getSource(PREVIEW) as GeoJSONSource | undefined
    src?.setData(preview ?? { type: 'FeatureCollection', features: [] })
  }, [map, preview])

  // Parts removed in the list lose their shapes on the map.
  const keys = parts.map((p) => p.key).join(',')
  useEffect(() => {
    const draw = drawRef.current
    if (!draw) return
    const alive = new Set(keys.split(','))
    const stale = [...owner.current.entries()].filter(([, key]) => !alive.has(key)).map(([id]) => id)
    if (!stale.length) return
    for (const id of stale) owner.current.delete(id)
    draw.removeFeatures(stale)
  }, [keys])

  useEffect(() => {
    const draw = drawRef.current
    if (!draw) return
    if (drawing) {
      draw.setMode('polygon')
      return
    }
    if (draw.getMode() !== 'select') draw.setMode('select')
    const id = [...owner.current.entries()].find(([, key]) => key === selectedKey)?.[0]
    if (id) {
      try {
        draw.selectFeature(id)
      } catch {
        // Feature not selectable (e.g. removed meanwhile).
      }
    } else {
      for (const f of draw.getSnapshot()) if (f.properties?.selected) draw.deselectFeature(f.id!)
    }
  }, [drawing, selectedKey, map])

  return (
    <div className={cx('relative overflow-hidden rounded-xl border border-line bg-surface-3', className)}>
      <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />
    </div>
  )
}
