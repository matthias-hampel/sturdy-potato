import type { Field } from '@agmeo/contracts'
import turfArea from '@turf/area'
import bbox from '@turf/bbox'
import type { Polygon } from 'geojson'
import { Eraser, MousePointer2, PenLine, Scissors, Spline, Trash2 } from 'lucide-react'
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
import { type DrawnGeometry, type Outer, type Ring, applyCut, compose, simplifyOuters, splitHoles, vertexCount } from './boundaryOps'
import { type Bounds, frameBounds } from './framing'
import { type MapView, useMap } from './useMap'

export type { DrawnGeometry } from './boundaryOps'

interface Props {
  initial?: DrawnGeometry | null
  /** Other fields shown for orientation (not editable). */
  context?: Field[]
  /** Where to start drawing when there is nothing to fit (no boundary, no context fields), e.g. the farm's saved view. */
  view?: MapView | null
  onChange: (geometry: DrawnGeometry | null) => void
  /** Offers the cut (holes) and simplify tools, for editing an existing boundary. */
  advanced?: boolean
  className?: string
}

type Mode = 'polygon' | 'select' | 'cut'

const CONTEXT = `${OWN}context`
const HOLES = `${OWN}holes`
/** Slider steps of 0.00001° up to 0.0002° (about 0.7 m to 14 m), as in the reference app. */
const SIMPLIFY_STEP = 0.00001
const SIMPLIFY_MAX = 20

/** Draw or edit a field boundary on aerial imagery. */
export function DrawField({ initial, context = [], view, onChange, advanced = false, className }: Props) {
  const { t } = useTranslation()
  const [bounds] = useState(() => {
    if (!initial) return frameBounds(context)
    const [w, s, e, n] = bbox(initial)
    return [w, s, e, n] as Bounds
  })
  const { containerRef, map } = useMap({ basemap: 'satellite', center: bounds ? undefined : view?.center, zoom: bounds ? undefined : view?.zoom, bounds })
  const drawRef = useRef<TerraDraw | null>(null)
  const [mode, setMode] = useState<Mode>(initial ? 'select' : 'polygon')
  const [areaHa, setAreaHa] = useState<number | null>(initial ? turfArea(initial) / 10000 : null)
  // Holes live outside the drawing tool, which edits outer rings only.
  const holes = useRef<Ring[]>(splitHoles(initial).holes)
  const [holeCount, setHoleCount] = useState(holes.current.length)
  const [simplifyLevel, setSimplifyLevel] = useState(0)
  const beforeSimplify = useRef<Outer[] | null>(null)
  const [vertices, setVertices] = useState<{ before: number; after: number } | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  const outersOf = (draw: TerraDraw): Outer[] =>
    draw
      .getSnapshot()
      .filter((f) => f.geometry.type === 'Polygon' && (f.properties?.mode === 'polygon' || f.properties?.mode == null))
      .map((f) => (f.geometry as Polygon).coordinates[0])
      .filter((r) => r?.length >= 4)

  const setOuters = (draw: TerraDraw, outers: Outer[]) => {
    draw.clear()
    if (outers.length) draw.addFeatures(outers.map((o) => ({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [o] }, properties: { mode: 'polygon' } }) as GeoJSONStoreFeatures))
  }

  const showHoles = () => {
    const src = map?.getSource(HOLES) as GeoJSONSource | undefined
    src?.setData({ type: 'FeatureCollection', features: holes.current.map((h) => ({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [h] }, properties: {} })) })
    setHoleCount(holes.current.length)
  }

  const emit = (draw: TerraDraw) => {
    const geometry = compose(outersOf(draw), holes.current)
    setAreaHa(geometry ? turfArea(geometry) / 10000 : null)
    onChangeRef.current(geometry)
  }

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
    map.addSource(HOLES, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
    map.addLayer({ id: `${OWN}holes-fill`, type: 'fill', source: HOLES, paint: { 'fill-color': '#d64545', 'fill-opacity': 0.35 } })
    map.addLayer({ id: `${OWN}holes-line`, type: 'line', source: HOLES, paint: { 'line-color': '#d64545', 'line-width': 2, 'line-dasharray': [2, 1] } })

    const draw = new TerraDraw({
      adapter: new TerraDrawMapLibreGLAdapter({ map }),
      modes: [
        new TerraDrawPolygonMode({
          styles: { fillColor: '#f2b632', fillOpacity: 0.25, outlineColor: '#f2b632', outlineWidth: 2.5, closingPointColor: '#ffffff', closingPointOutlineColor: '#f2b632' },
        }),
        new TerraDrawPolygonMode({
          modeName: 'cut',
          styles: { fillColor: '#d64545', fillOpacity: 0.3, outlineColor: '#d64545', outlineWidth: 2, closingPointColor: '#ffffff', closingPointOutlineColor: '#d64545' },
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

    const { outers } = splitHoles(initial)
    if (outers.length) {
      setOuters(draw, outers)
      draw.setMode('select')
    } else {
      draw.setMode('polygon')
    }
    showHoles()

    draw.on('finish', (id) => {
      const feature = draw.getSnapshot().find((f) => f.id === id)
      if (feature?.properties?.mode === 'cut') {
        const cut = (feature.geometry as Polygon).coordinates[0]
        draw.removeFeatures([id])
        const result = applyCut(outersOf(draw), holes.current, cut)
        if (result) {
          holes.current = result.holes
          setOuters(draw, result.outers)
          showHoles()
        }
      }
      emit(draw)
      // After closing a polygon, switch to editing so vertices can be adjusted.
      draw.setMode('select')
      setMode('select')
    })
    draw.on('change', (_ids, type) => {
      if (type !== 'styling') emit(draw)
    })

    return () => {
      drawRef.current = null
      // The map may already be removed (its effect cleans up first); then nothing is left to undo.
      try {
        draw.stop()
        for (const id of [`${OWN}holes-line`, `${OWN}holes-fill`, `${OWN}context-label`, `${OWN}context-line`, `${OWN}context-fill`]) if (map.getLayer(id)) map.removeLayer(id)
        for (const id of [HOLES, CONTEXT]) if (map.getSource(id)) map.removeSource(id)
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

  const switchMode = (m: Mode) => {
    drawRef.current?.setMode(m)
    setMode(m)
  }

  // Simplification previews on the original rings, so moving the slider back restores detail.
  const onSimplify = (level: number) => {
    const draw = drawRef.current
    if (!draw) return
    beforeSimplify.current ??= outersOf(draw)
    const original = beforeSimplify.current
    const next = simplifyOuters(original, level * SIMPLIFY_STEP)
    setOuters(draw, next)
    draw.setMode('select')
    setMode('select')
    setSimplifyLevel(level)
    setVertices({ before: vertexCount(original, []), after: vertexCount(next, []) })
    if (level === 0) beforeSimplify.current = null
    emit(draw)
  }

  return (
    <div className={cx('relative overflow-hidden rounded-xl border border-line bg-surface-3', className)}>
      <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />
      <div className="absolute top-3 left-3 z-10 flex flex-wrap gap-1 rounded-[var(--radius-control)] bg-surface/95 p-1 shadow-[var(--shadow-overlay)] border border-line max-w-[calc(100%-5rem)]">
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
        {advanced && (
          <Tooltip content={t('map.draw.cutTooltip')}>
            <Button size="sm" variant={mode === 'cut' ? 'primary' : 'ghost'} onPress={() => switchMode('cut')}>
              <Scissors /> {t('map.draw.cut')}
            </Button>
          </Tooltip>
        )}
        {advanced && holeCount > 0 && (
          <Tooltip content={t('map.draw.removeHolesTooltip')}>
            <Button
              size="sm"
              variant="ghost"
              onPress={() => {
                holes.current = []
                showHoles()
                if (drawRef.current) emit(drawRef.current)
              }}
            >
              <Eraser /> {t('map.draw.removeHoles', { count: holeCount })}
            </Button>
          </Tooltip>
        )}
        <Tooltip content={t('map.draw.clearTooltip')}>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={t('map.draw.clear')}
            onPress={() => {
              drawRef.current?.clear()
              holes.current = []
              beforeSimplify.current = null
              setSimplifyLevel(0)
              setVertices(null)
              showHoles()
              setAreaHa(null)
              onChangeRef.current(null)
              switchMode('polygon')
            }}
          >
            <Trash2 />
          </Button>
        </Tooltip>
      </div>
      {advanced && (
        <label className="absolute top-3 right-14 z-10 flex items-center gap-2 rounded-[var(--radius-control)] bg-surface/95 px-3 py-1.5 shadow-[var(--shadow-overlay)] border border-line text-xs">
          <Spline className="size-4 text-muted" aria-hidden />
          <span>{t('map.draw.simplify')}</span>
          <input type="range" min={0} max={SIMPLIFY_MAX} step={1} value={simplifyLevel} onChange={(e) => onSimplify(Number(e.target.value))} className="w-28 accent-[var(--color-primary)]" aria-valuetext={t('map.draw.simplifyValue', { meters: fmt.num(simplifyLevel * 0.9, 1) })} />
          {vertices && simplifyLevel > 0 && <span className="tabular text-muted">{t('map.draw.vertices', { before: vertices.before, after: vertices.after })}</span>}
        </label>
      )}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-10 rounded-full bg-surface/95 border border-line shadow-[var(--shadow-overlay)] px-4 py-1.5 text-sm">
        {mode === 'cut' ? (
          <span className="text-muted">{t('map.draw.cutHint')}</span>
        ) : areaHa != null ? (
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
