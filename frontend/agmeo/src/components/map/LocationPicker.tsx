import type { LatLng } from '@agmeo/contracts'
import { Marker, type MapMouseEvent } from 'maplibre-gl'
import { useEffect, useRef } from 'react'
import { cx } from '#/ui/utils'
import { useMap } from './useMap'

/** Below this zoom a click also zooms in, so the saved default view shows the farm. */
const MIN_FARM_ZOOM = 12
const FARM_ZOOM = 14

interface Props {
  value: LatLng | null | undefined
  /** Zoom of the farm's default map view; follows the picker's zoom once a location is set. */
  zoom?: number | null
  onChange: (v: LatLng) => void
  onZoomChange?: (zoom: number) => void
  className?: string
}

/** Click the map to place the farm location; the current zoom becomes the farm's default map zoom. */
export function LocationPicker({ value, zoom, onChange, onZoomChange, className }: Props) {
  const { containerRef, map } = useMap({ basemap: 'map', center: value ? [value.lng, value.lat] : undefined, zoom: value ? (zoom ?? 13) : undefined })
  const marker = useRef<Marker | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const onZoomChangeRef = useRef(onZoomChange)
  onZoomChangeRef.current = onZoomChange

  useEffect(() => {
    if (!map) return
    const click = (e: MapMouseEvent) => {
      onChangeRef.current({ lat: round(e.lngLat.lat), lng: round(e.lngLat.lng) })
      if (map.getZoom() < MIN_FARM_ZOOM) map.easeTo({ center: e.lngLat, zoom: FARM_ZOOM })
      else onZoomChangeRef.current?.(roundZoom(map.getZoom()))
    }
    const zoomEnd = () => {
      if (marker.current) onZoomChangeRef.current?.(roundZoom(map.getZoom()))
    }
    map.on('click', click)
    map.on('zoomend', zoomEnd)
    map.getCanvas().style.cursor = 'crosshair'
    return () => {
      map.off('click', click)
      map.off('zoomend', zoomEnd)
    }
  }, [map])

  useEffect(() => {
    if (!map) return
    if (!value) {
      marker.current?.remove()
      marker.current = null
      return
    }
    if (!marker.current) marker.current = new Marker({ color: '#3d6b2f' }).setLngLat([value.lng, value.lat]).addTo(map)
    else marker.current.setLngLat([value.lng, value.lat])
  }, [map, value])

  return (
    <div className={cx('relative overflow-hidden rounded-xl border border-line bg-surface-3', className)}>
      <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />
    </div>
  )
}

const round = (v: number) => Math.round(v * 1e5) / 1e5
const roundZoom = (z: number) => Math.round(z * 10) / 10
