import type { Field } from '@agmeo/contracts'
import turfArea from '@turf/area'
import bbox from '@turf/bbox'
import type { MultiPolygon, Polygon, Position } from 'geojson'
import { MousePointer2, PenLine, Trash2 } from 'lucide-react'
import type { GeoJSONSource } from 'maplibre-gl'
import { useEffect, useRef, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { TerraDraw, TerraDrawPolygonMode, TerraDrawSelectMode, type GeoJSONStoreFeatures } from 'terra-draw'
import { TerraDrawMapLibreGLAdapter } from 'terra-draw-maplibre-gl-adapter'
import { fmt } from '#/lib/format'
import { Button } from '#/ui/Button'
import { Tooltip } from '#/ui/Overlay'
import { cx } from '#/ui/utils'
import { OWN } from './basemaps'
import { type MapView, useMap } from './useMap'

export type DrawnGeometry = Polygon | MultiPolygon

interface Props {
  initial?: DrawnGeometry | null
  /** Other fields shown for orientation (not editable). */
  context?: Field[]
  /** Where to start drawing a new field, e.g. the farm's saved view; ignored when editing. */
  view?: MapView | null
  onChange: (geometry: DrawnGeometry | null) => void
  className?: string
}

const CONTEXT = `${OWN}context`
const round = (p: Position): Position => [Math.round(p[0] * 1e7) / 1e7, Math.round(p[1] * 1e7) / 1e7]

/** Draw or edit a field boundary on aerial imagery. */
export function DrawField({ initial, context = [], view, onChange, className }: Props) {
  const { t } = useTranslation()
  const [bounds] = useState(() => {
    const features = initial ? [{ type: 'Feature' as const, geometry: initial, properties: {} }] : context.map((f) => ({ type: 'Feature' as const, geometry: f.geometry, properties: {} }))
    if (!features.length || (!initial && view)) return undefined
    const [w, s, e, n] = bbox({ type: 'FeatureCollection', features })
    return [w, s, e, n] as [number, number, number, number]
  })
  const { containerRef, map } = useMap({ basemap: 'satellite', center: initial ? undefined : view?.center, zoom: initial ? undefined : view?.zoom, bounds })
  const drawRef = useRef<TerraDraw | null>(null)
  const [mode, setMode] = useState<'polygon' | 'select'>(initial ? 'select' : 'polygon')
  const [areaHa, setAreaHa] = useState<number | null>(initial ? turfArea(initial) / 10000 : null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEffect(() => {
    if (!map) return
    // Neighbouring fields for orientation.
    map.addSource(CONTEXT, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: context.map((f) => ({ type: 'Feature', geometry: f.geometry, properties: { name: f.name } })) },
    })
    map.addLayer({ id: `${OWN}context-fill`, type: 'fill', source: CONTEXT, paint: { 'fill-color': '#ffffff', 'fill-opacity': 0.12 } })
    map.addLayer({ id: `${OWN}context-line`, type: 'line', source: CONTEXT, paint: { 'line-color': '#ffffff', 'line-width': 1.2, 'line-opacity': 0.8 } })
    map.addLayer({
      id: `${OWN}context-label`,
      type: 'symbol',
      source: CONTEXT,
      layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Regular'], 'text-size': 11 },
      paint: { 'text-color': '#fff', 'text-halo-color': 'rgba(0,0,0,.7)', 'text-halo-width': 1.2 },
    })

    const draw = new TerraDraw({
      adapter: new TerraDrawMapLibreGLAdapter({ map }),
      modes: [
        new TerraDrawPolygonMode({
          styles: { fillColor: '#f2b632', fillOpacity: 0.25, outlineColor: '#f2b632', outlineWidth: 2.5, closingPointColor: '#ffffff', closingPointOutlineColor: '#f2b632' },
        }),
        new TerraDrawSelectMode({
          flags: {
            polygon: { feature: { draggable: true, coordinates: { midpoints: true, draggable: true, deletable: true } } },
          },
          styles: { selectedPolygonColor: '#f2b632', selectedPolygonOutlineColor: '#f2b632', selectedPolygonFillOpacity: 0.3, selectionPointColor: '#ffffff', selectionPointOutlineColor: '#f2b632', midPointColor: '#f2b632' },
        }),
      ],
    })
    draw.start()
    drawRef.current = draw

    if (initial) {
      const polygons = initial.type === 'Polygon' ? [initial.coordinates] : initial.coordinates
      draw.addFeatures(
        polygons.map((coordinates) => ({ type: 'Feature', geometry: { type: 'Polygon', coordinates }, properties: { mode: 'polygon' } }) as GeoJSONStoreFeatures),
      )
      draw.setMode('select')
    } else {
      draw.setMode('polygon')
    }

    const emit = () => {
      const polygons = draw
        .getSnapshot()
        .filter((f) => f.geometry.type === 'Polygon' && (f.properties?.mode === 'polygon' || f.properties?.mode == null))
        .map((f) => (f.geometry as Polygon).coordinates.map((ring) => ring.map(round)))
        .filter((rings) => rings[0]?.length >= 4)
      const geometry: DrawnGeometry | null =
        polygons.length === 0 ? null : polygons.length === 1 ? { type: 'Polygon', coordinates: polygons[0] } : { type: 'MultiPolygon', coordinates: polygons }
      setAreaHa(geometry ? turfArea(geometry) / 10000 : null)
      onChangeRef.current(geometry)
    }
    draw.on('finish', () => {
      emit()
      // After closing a polygon, switch to editing so vertices can be adjusted.
      draw.setMode('select')
      setMode('select')
    })
    draw.on('change', (_ids, type) => {
      if (type !== 'styling') emit()
    })

    return () => {
      drawRef.current = null
      // The map may already be removed (its effect cleans up first); then nothing is left to undo.
      try {
        draw.stop()
        for (const id of [`${OWN}context-label`, `${OWN}context-line`, `${OWN}context-fill`]) if (map.getLayer(id)) map.removeLayer(id)
        if (map.getSource(CONTEXT)) map.removeSource(CONTEXT)
      } catch {
        // Map already torn down.
      }
    }
    // Initialized once per map; `initial` and `context` are starting values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map])

  useEffect(() => {
    if (!map) return
    const src = map.getSource(CONTEXT) as GeoJSONSource | undefined
    src?.setData({ type: 'FeatureCollection', features: context.map((f) => ({ type: 'Feature', geometry: f.geometry, properties: { name: f.name } })) })
  }, [map, context])

  const switchMode = (m: 'polygon' | 'select') => {
    drawRef.current?.setMode(m)
    setMode(m)
  }

  return (
    <div className={cx('relative overflow-hidden rounded-xl border border-line bg-surface-3', className)}>
      <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />
      <div className="absolute top-3 left-3 z-10 flex gap-1 rounded-[var(--radius-control)] bg-surface/95 p-1 shadow-[var(--shadow-overlay)] border border-line">
        <Tooltip content={t('map.draw.drawTooltip')}>
          <Button size="sm" variant={mode === 'polygon' ? 'primary' : 'ghost'} onPress={() => switchMode('polygon')}>
            <PenLine /> {t('map.draw.draw')}
          </Button>
        </Tooltip>
        <Tooltip content={t('map.draw.editTooltip')}>
          <Button size="sm" variant={mode === 'select' ? 'primary' : 'ghost'} onPress={() => switchMode('select')}>
            <MousePointer2 /> {t('common.edit')}
          </Button>
        </Tooltip>
        <Tooltip content={t('map.draw.clearTooltip')}>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={t('map.draw.clear')}
            onPress={() => {
              drawRef.current?.clear()
              setAreaHa(null)
              onChangeRef.current(null)
              switchMode('polygon')
            }}
          >
            <Trash2 />
          </Button>
        </Tooltip>
      </div>
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-10 rounded-full bg-surface/95 border border-line shadow-[var(--shadow-overlay)] px-4 py-1.5 text-sm">
        {areaHa != null ? (
          <span>
            <Trans i18nKey="map.draw.area" values={{ area: fmt.ha(areaHa, 2) }} components={{ b: <strong className="tabular" /> }} />
          </span>
        ) : (
          <span className="text-muted">{t('map.draw.startHint')}</span>
        )}
      </div>
    </div>
  )
}
