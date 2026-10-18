import type { Farm } from '@agmeo/contracts'
import { Map as MapLibreMap, NavigationControl, ScaleControl, setWorkerUrl } from 'maplibre-gl'
import { useEffect, useRef, useState } from 'react'
import { t } from '#/i18n'
import { tokenStore } from '#/lib/api'
import { type Basemap, OWN, styleFor } from './basemaps'

export interface UseMapOptions {
  basemap: Basemap
  center?: [number, number]
  zoom?: number
  interactive?: boolean
  /** Initial extent [west, south, east, north]; avoids loading a country-wide first view. */
  bounds?: [number, number, number, number]
}

export interface MapView {
  center: [number, number]
  zoom: number
}

/** The farm's saved default map view: its location at the zoom chosen in the farm settings. */
export function farmView(farm: Farm | null | undefined): MapView | null {
  return farm?.location && farm.mapZoom != null ? { center: [farm.location.lng, farm.location.lat], zoom: farm.mapZoom } : null
}

// Copied to public/ by the agmeo:maplibre-worker Vite plugin.
setWorkerUrl('/maplibre-gl-worker.mjs')

const GERMANY: [number, number] = [10.2, 51.2]

/** MapLibre's own control texts (tooltips, aria labels) in the UI language. */
const mapLocale = () => ({
  'AttributionControl.ToggleAttribution': t('map.control.toggleAttribution'),
  'AttributionControl.MapFeedback': t('map.control.mapFeedback'),
  'Map.Title': t('map.control.mapTitle'),
  'Marker.Title': t('map.control.markerTitle'),
  'NavigationControl.ResetBearing': t('map.control.resetBearing'),
  'NavigationControl.ZoomIn': t('map.control.zoomIn'),
  'NavigationControl.ZoomOut': t('map.control.zoomOut'),
})

/** Creates a MapLibre map in `container` and keeps agmeo layers across basemap changes. */
export function useMap({ basemap, center, zoom, interactive = true, bounds }: UseMapOptions) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [map, setMap] = useState<MapLibreMap | null>(null)
  const [styleVersion, setStyleVersion] = useState(0)
  const currentBasemap = useRef(basemap)

  useEffect(() => {
    const host = containerRef.current
    if (!host) return
    // Each map instance gets its own element: in development React mounts effects twice,
    // and two maps must never share (and tear down) one container.
    const el = document.createElement('div')
    el.style.cssText = 'position:absolute;inset:0'
    host.appendChild(el)
    const m = new MapLibreMap({
      container: el,
      style: styleFor(basemap),
      ...(bounds
        ? { bounds, fitBoundsOptions: { padding: 48, maxZoom: 16.5 } }
        : { center: center ?? GERMANY, zoom: zoom ?? (center ? 13 : 5) }),
      interactive,
      attributionControl: { compact: true },
      locale: mapLocale(),
      dragRotate: false,
      pitchWithRotate: false,
      // Index tiles come from the agmeo API and need the user's credentials.
      transformRequest: (url) =>
        url.startsWith(`${window.location.origin}/api/`)
          ? { url, headers: { authorization: `Bearer ${tokenStore.get() ?? ''}` } }
          : { url },
    })
    if (interactive) {
      m.addControl(new NavigationControl({ showCompass: false }), 'top-right')
      m.addControl(new ScaleControl({ unit: 'metric' }), 'bottom-left')
    }
    m.touchZoomRotate.disableRotation()
    // 'load' waits for every tile of the first view; layers only need the style.
    m.once('style.load', () => setMap(m))
    m.on('style.load', () => setStyleVersion((v) => v + 1))
    return () => {
      setMap(null)
      // Removed on the next tick so a re-mounted map acquires MapLibre's shared worker pool
      // before this one releases it (an empty pool is terminated).
      setTimeout(() => {
        m.remove()
        el.remove()
      }, 0)
    }
    // The map is created once; later prop changes are applied imperatively.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!map || currentBasemap.current === basemap) return
    currentBasemap.current = basemap
    map.setStyle(styleFor(basemap), {
      transformStyle: (previous, next) => ({
        ...next,
        glyphs: next.glyphs ?? previous?.glyphs,
        sources: {
          ...next.sources,
          ...Object.fromEntries(Object.entries(previous?.sources ?? {}).filter(([id]) => id.startsWith(OWN))),
        },
        layers: [...next.layers, ...(previous?.layers ?? []).filter((l) => l.id.startsWith(OWN))],
      }),
    })
  }, [map, basemap])

  return { containerRef, map, styleVersion }
}
