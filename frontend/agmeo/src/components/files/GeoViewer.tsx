import type { FileItem } from '@agmeo/contracts'
import type { Feature } from 'geojson'
import { Eye, EyeOff, FileDown, Locate, Plus, Trash2, X } from 'lucide-react'
import { type GeoJSONSource, type MapLayerMouseEvent, Popup } from 'maplibre-gl'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Dialog as AriaDialog, Heading, Modal, ModalOverlay } from 'react-aria-components'
import { type Basemap, OWN } from '#/components/map/basemaps'
import { useMap } from '#/components/map/useMap'
import { errorMessage, saveBlob } from '#/lib/api'
import { fmt } from '#/lib/format'
import { useOrg } from '#/lib/org'
import { Button, SegmentedControl } from '#/ui/Button'
import { Option, SearchField, Select } from '#/ui/Field'
import { Loading, Notice } from '#/ui/Layout'
import { cx } from '#/ui/utils'
import { type GeoLayer, bounds, isGeoName, layerColor, loadGeoFile, looksProjected } from './geo'

const MAX_TABLE_ROWS = 500
const sourceId = (l: GeoLayer) => `${OWN}geo-${l.id}`

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
}

/** Map viewer for Shapefiles, GeoJSON and KML/KMZ stored in the files, with layers and an attribute table. */
export function GeoViewer({ file, folderFiles, onClose }: { file: FileItem; folderFiles: FileItem[]; onClose: () => void }) {
  const { t } = useTranslation()
  const { orgId } = useOrg()
  const [basemap, setBasemap] = useState<Basemap>('satellite')
  const { containerRef, map, styleVersion } = useMap({ basemap })
  const [layers, setLayers] = useState<GeoLayer[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [loading, setLoading] = useState<string[]>([])
  const [errors, setErrors] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const fitted = useRef(false)
  // Files already requested; state updates would arrive too late to stop a second request.
  const requested = useRef(new Set<string>())

  const addFile = async (f: FileItem) => {
    if (requested.current.has(f.id)) return
    requested.current.add(f.id)
    setLoading((s) => [...s, f.id])
    try {
      const data = await loadGeoFile(orgId, f, folderFiles)
      if (looksProjected(data)) throw new Error(t('files.geo.projected'))
      setLayers((ls) => [...ls, { id: f.id, name: f.name, data, visible: true, color: layerColor(ls.length), opacity: 0.55 }])
      setActiveId(f.id)
    } catch (e) {
      const msg = (e as Error).message
      requested.current.delete(f.id)
      setErrors((s) => [...s, `${f.name}: ${msg === 'too_large' ? t('files.geo.tooLarge') : msg === 'no_geodata' || msg === 'unsupported' ? t('files.geo.noGeodata') : errorMessage(e)}`])
    } finally {
      setLoading((s) => s.filter((id) => id !== f.id))
    }
  }

  useEffect(() => {
    void addFile(file)
    // Load the opened file once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.id])

  // Sync layers to the map (also after basemap changes, which replace the style).
  useEffect(() => {
    if (!map) return
    const wanted = new Set(layers.map(sourceId))
    for (const id of Object.keys(map.getStyle().sources ?? {})) {
      if (id.startsWith(`${OWN}geo-`) && !wanted.has(id)) {
        for (const suffix of ['fill', 'line', 'point']) if (map.getLayer(`${id}-${suffix}`)) map.removeLayer(`${id}-${suffix}`)
        map.removeSource(id)
      }
    }
    for (const l of layers) {
      const id = sourceId(l)
      const src = map.getSource(id) as GeoJSONSource | undefined
      if (!src) {
        map.addSource(id, { type: 'geojson', data: l.data })
        map.addLayer({ id: `${id}-fill`, type: 'fill', source: id, filter: ['==', ['geometry-type'], 'Polygon'], paint: {} })
        map.addLayer({ id: `${id}-line`, type: 'line', source: id, filter: ['!=', ['geometry-type'], 'Point'], paint: { 'line-width': 1.5 } })
        map.addLayer({ id: `${id}-point`, type: 'circle', source: id, filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': 4, 'circle-stroke-width': 1, 'circle-stroke-color': '#fff' } })
      }
      const vis = l.visible ? 'visible' : 'none'
      map.setLayoutProperty(`${id}-fill`, 'visibility', vis)
      map.setLayoutProperty(`${id}-line`, 'visibility', vis)
      map.setLayoutProperty(`${id}-point`, 'visibility', vis)
      map.setPaintProperty(`${id}-fill`, 'fill-color', l.color)
      map.setPaintProperty(`${id}-fill`, 'fill-opacity', l.opacity)
      map.setPaintProperty(`${id}-line`, 'line-color', l.color)
      map.setPaintProperty(`${id}-point`, 'circle-color', l.color)
      map.setPaintProperty(`${id}-point`, 'circle-opacity', Math.min(1, l.opacity + 0.3))
    }
    if (!fitted.current && layers.length) {
      const b = bounds(layers[0].data)
      if (b) map.fitBounds(b, { padding: 48, maxZoom: 17, duration: 0 })
      fitted.current = true
    }
  }, [map, layers, styleVersion])

  // Feature popup with its attributes.
  useEffect(() => {
    if (!map) return
    const onClick = (e: MapLayerMouseEvent) => {
      const ids = layers.filter((l) => l.visible).flatMap((l) => ['point', 'line', 'fill'].map((s) => `${sourceId(l)}-${s}`))
      const f = map.queryRenderedFeatures(e.point, { layers: ids.filter((id) => map.getLayer(id)) })[0]
      if (!f) return
      const rows = Object.entries(f.properties ?? {})
        .map(([k, v]) => `<tr><th style="text-align:left;padding-right:8px;font-weight:600">${escapeHtml(k)}</th><td>${escapeHtml(String(v))}</td></tr>`)
        .join('')
      new Popup({ maxWidth: '320px' }).setLngLat(e.lngLat).setHTML(`<table style="font-size:12px">${rows || `<tr><td>${escapeHtml(t('files.geo.noAttributes'))}</td></tr>`}</table>`).addTo(map)
    }
    map.on('click', onClick)
    return () => {
      map.off('click', onClick)
    }
  }, [map, layers, t])

  const update = (id: string, patch: Partial<GeoLayer>) => setLayers((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)))
  const zoomTo = (l: GeoLayer) => {
    const b = bounds(l.data)
    if (b && map) map.fitBounds(b, { padding: 48, maxZoom: 17 })
  }
  const exportLayer = (l: GeoLayer) => saveBlob(new Blob([JSON.stringify(l.data)], { type: 'application/geo+json' }), `${l.name.replace(/\.[^.]+$/, '')}.geojson`)

  const active = layers.find((l) => l.id === activeId) ?? layers[0]
  const columns = active ? [...new Set(active.data.features.flatMap((f) => Object.keys(f.properties ?? {})))] : []
  const words = search.toLowerCase().split(/\s+/).filter(Boolean)
  const rows: Feature[] = active
    ? active.data.features.filter((f) => !words.length || words.every((w) => Object.values(f.properties ?? {}).some((v) => String(v).toLowerCase().includes(w))))
    : []
  const addable = folderFiles.filter((f) => isGeoName(f.name) && !f.name.toLowerCase().endsWith('.json') && !layers.some((l) => l.id === f.id))

  return (
    <ModalOverlay isOpen onOpenChange={(o) => !o && onClose()} isDismissable className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-2 sm:p-4">
      <Modal className="w-full h-full rounded-2xl bg-surface shadow-[var(--shadow-overlay)] border border-line overflow-hidden">
        <AriaDialog className="outline-none h-full flex flex-col">
          <header className="flex items-center gap-3 px-4 py-3 border-b border-line">
            <Heading slot="title" className="flex-1 min-w-0 truncate text-base font-semibold">{file.name}</Heading>
            <SegmentedControl aria-label={t('map.basemap.label')} value={basemap} onChange={setBasemap} items={[{ id: 'satellite' as const, label: t('map.basemap.satellite') }, { id: 'map' as const, label: t('map.basemap.map') }]} />
            <Button variant="ghost" size="icon-sm" aria-label={t('common.close')} onPress={onClose}><X /></Button>
          </header>
          <div className="flex-1 min-h-0 grid lg:grid-cols-[1fr_22rem] grid-rows-[1fr_auto] lg:grid-rows-1">
            <div className="relative min-h-64">
              <div ref={containerRef} className="absolute inset-0" />
              {loading.length > 0 && <div className="absolute top-3 left-3 rounded-lg bg-surface/90 px-3 py-2 shadow"><Loading label={t('files.geo.loading')} /></div>}
            </div>
            <aside className="border-t lg:border-t-0 lg:border-l border-line flex flex-col min-h-0 max-h-[45vh] lg:max-h-none">
              <section className="p-3 space-y-2 border-b border-line">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">{t('files.geo.layers')}</h3>
                </div>
                {errors.map((e) => <Notice key={e} tone="danger">{e}</Notice>)}
                <ul className="space-y-1.5">
                  {layers.map((l) => (
                    <li key={l.id} className={cx('rounded-lg border px-2 py-1.5 text-sm', l.id === active?.id ? 'border-primary bg-primary-soft/40' : 'border-line')}>
                      <div className="flex items-center gap-1">
                        <input type="color" value={l.color} onChange={(e) => update(l.id, { color: e.target.value })} aria-label={t('files.geo.color')} className="size-5 shrink-0 rounded cursor-pointer border-0 p-0 bg-transparent" />
                        <button type="button" className="flex-1 min-w-0 truncate text-left" onClick={() => setActiveId(l.id)}>{l.name}</button>
                        <span className="text-xs text-muted tabular">{fmt.num(l.data.features.length)}</span>
                        <Button variant="ghost" size="icon-sm" aria-label={l.visible ? t('files.geo.hide') : t('files.geo.show')} onPress={() => update(l.id, { visible: !l.visible })}>{l.visible ? <Eye /> : <EyeOff />}</Button>
                        <Button variant="ghost" size="icon-sm" aria-label={t('files.geo.zoom')} onPress={() => zoomTo(l)}><Locate /></Button>
                        <Button variant="ghost" size="icon-sm" aria-label={t('files.geo.export')} onPress={() => exportLayer(l)}><FileDown /></Button>
                        <Button variant="ghost" size="icon-sm" aria-label={t('files.geo.remove')} onPress={() => { requested.current.delete(l.id); setLayers((ls) => ls.filter((x) => x.id !== l.id)) }}><Trash2 /></Button>
                      </div>
                      <label className="flex items-center gap-2 mt-1 text-xs text-muted">
                        {t('files.geo.opacity')}
                        <input type="range" min={0} max={1} step={0.05} value={l.opacity} onChange={(e) => update(l.id, { opacity: Number(e.target.value) })} className="flex-1 accent-[var(--color-primary)]" />
                      </label>
                    </li>
                  ))}
                </ul>
                {addable.length > 0 && (
                  <Select aria-label={t('files.geo.addLayer')} placeholder={t('files.geo.addLayer')} items={addable.map((f) => ({ id: f.id, name: f.name }))} value={null} onChange={(id) => { const f = addable.find((x) => x.id === id); if (f) void addFile(f) }}>
                    {(o) => <Option id={o.id}><span className="inline-flex items-center gap-1.5"><Plus className="size-3.5" /> {o.name}</span></Option>}
                  </Select>
                )}
              </section>
              {active && (
                <section className="flex-1 min-h-0 flex flex-col">
                  <div className="p-3 pb-2 space-y-2">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">{t('files.geo.attributes', { count: rows.length })}</h3>
                    <SearchField aria-label={t('files.geo.searchAttributes')} value={search} onChange={setSearch} />
                  </div>
                  <div className="flex-1 min-h-0 overflow-auto px-3 pb-3">
                    {columns.length === 0 ? (
                      <p className="text-sm text-muted">{t('files.geo.noAttributes')}</p>
                    ) : (
                      <table className="text-xs tabular border-collapse w-max">
                        <thead className="sticky top-0 bg-surface">
                          <tr>{columns.map((c) => <th key={c} className="px-2 py-1 text-left font-semibold border-b border-line whitespace-nowrap">{c}</th>)}</tr>
                        </thead>
                        <tbody>
                          {rows.slice(0, MAX_TABLE_ROWS).map((f, i) => (
                            <tr
                              key={i}
                              className="odd:bg-surface-2/40 hover:bg-primary-soft/40 cursor-pointer"
                              onClick={() => {
                                const b = bounds({ type: 'FeatureCollection', features: [f] })
                                if (b && map) map.fitBounds(b, { padding: 80, maxZoom: 18 })
                              }}
                            >
                              {columns.map((c) => <td key={c} className="px-2 py-1 border-b border-line/60 whitespace-nowrap max-w-56 truncate">{String(f.properties?.[c] ?? '')}</td>)}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                    {rows.length > MAX_TABLE_ROWS && <p className="text-xs text-muted mt-2">{t('files.preview.truncated', { count: MAX_TABLE_ROWS })}</p>}
                  </div>
                </section>
              )}
            </aside>
          </div>
        </AriaDialog>
      </Modal>
    </ModalOverlay>
  )
}
