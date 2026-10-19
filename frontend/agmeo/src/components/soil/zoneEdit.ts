/**
 * Zone editor geometry (ported from AGVOLUTION/agmeo ZoneGeometryEditor): a square brush or a
 * drawn polygon paints into the selected zone and is taken out of every other zone; a click
 * moves a whole connected part to the selected zone. Everything stays inside the field.
 */
import area from '@turf/area'
import type { MultiPolygon, Polygon, Position } from 'geojson'
import { difference, intersection, union, type Geom } from 'polyclip-ts'

export interface EditZone {
  key: string
  /** Stored zone id; null for zones added in the editor. */
  id: string | null
  label: string
  color: string
  geometry: MultiPolygon
}

export const EMPTY: MultiPolygon = { type: 'MultiPolygon', coordinates: [] }
const EMPTY_ZONE_M2 = 25

const toGeom = (g: Polygon | MultiPolygon): Geom => (g.type === 'Polygon' ? (g.coordinates as Geom) : (g.coordinates as Geom))
const toMulti = (coords: Position[][][]): MultiPolygon => ({ type: 'MultiPolygon', coordinates: coords })

export const areaHa = (g: MultiPolygon) => (g.coordinates.length ? area({ type: 'Feature', geometry: g, properties: {} }) / 10_000 : 0)

/** Paints `shape` (clipped to the field) into the zone `key`; every other zone loses it. */
export function paint(zones: EditZone[], key: string, shape: Polygon | MultiPolygon, field: MultiPolygon): EditZone[] {
  const clipped = intersection(toGeom(shape), toGeom(field))
  if (!clipped.length) return zones
  return zones.map((z) => {
    if (!z.geometry.coordinates.length) return z.key === key ? { ...z, geometry: toMulti(clipped) } : z
    const geometry = z.key === key ? toMulti(union(toGeom(z.geometry), clipped)) : toMulti(difference(toGeom(z.geometry), clipped))
    return { ...z, geometry }
  })
}

/** The connected part of any zone under the point, moved into the zone `key`. */
export function fillAt(zones: EditZone[], key: string, point: [number, number]): EditZone[] {
  for (const z of zones) {
    const part = z.geometry.coordinates.find((polygon) => insidePolygon(point, polygon))
    if (!part || z.key === key) continue
    return paint(zones, key, { type: 'Polygon', coordinates: part }, { type: 'MultiPolygon', coordinates: [part] })
  }
  return zones
}

/** Square brush of `sizeM` metres around a point. */
export function squareBrush([lng, lat]: [number, number], sizeM: number): Polygon {
  const dLat = sizeM / 2 / 111_320
  const dLng = sizeM / 2 / (111_320 * Math.cos((lat * Math.PI) / 180))
  return {
    type: 'Polygon',
    coordinates: [
      [
        [lng - dLng, lat - dLat],
        [lng + dLng, lat - dLat],
        [lng + dLng, lat + dLat],
        [lng - dLng, lat + dLat],
        [lng - dLng, lat - dLat],
      ],
    ],
  }
}

/** Brush stroke between two cursor positions: squares along the segment so fast drags leave no gaps. */
export function strokeBrush(from: [number, number], to: [number, number], sizeM: number): Polygon[] {
  const dLat = to[1] - from[1]
  const dLng = (to[0] - from[0]) * Math.cos((from[1] * Math.PI) / 180)
  const distM = Math.hypot(dLat, dLng) * 111_320
  const steps = Math.max(1, Math.ceil(distM / (sizeM / 2)))
  return Array.from({ length: steps }, (_, i) => {
    const f = (i + 1) / steps
    return squareBrush([from[0] + (to[0] - from[0]) * f, from[1] + (to[1] - from[1]) * f], sizeM)
  })
}

/** Brush sizes (square side, m): small ones always, plus sizes scaled to the field. */
export function brushSizesForArea(areaHaValue: number): { sizes: number[]; defaultSize: number } {
  const nice = [2, 5, 10, 20, 50, 100, 200, 500]
  const characteristic = Math.sqrt(Math.max(areaHaValue, 0.01) * 10_000)
  const snap = (fraction: number) => nice.reduce((best, s) => (Math.abs(s - characteristic * fraction) < Math.abs(best - characteristic * fraction) ? s : best))
  const sizes = [...new Set([2, 5, 10, ...[0.04, 0.08, 0.15, 0.3].map(snap)])].sort((a, b) => a - b)
  return { sizes, defaultSize: snap(0.08) }
}

/** Zones that still cover something, in order, ready to save. */
export const nonEmpty = (zones: EditZone[]) => zones.filter((z) => z.geometry.coordinates.length && areaHa(z.geometry) * 10_000 >= EMPTY_ZONE_M2)

function insidePolygon(p: [number, number], rings: Position[][]): boolean {
  let inside = false
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i]
      const [xj, yj] = ring[j]
      if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside
    }
  }
  return inside
}

/** Undo/redo stack of zone snapshots. */
export class History<T> {
  private past: T[] = []
  private future: T[] = []
  push(state: T) {
    this.past.push(state)
    if (this.past.length > 100) this.past.shift()
    this.future = []
  }
  undo(current: T): T | null {
    const prev = this.past.pop()
    if (prev === undefined) return null
    this.future.push(current)
    return prev
  }
  redo(current: T): T | null {
    const next = this.future.pop()
    if (next === undefined) return null
    this.past.push(current)
    return next
  }
  get canUndo() {
    return this.past.length > 0
  }
  get canRedo() {
    return this.future.length > 0
  }
  clear() {
    this.past = []
    this.future = []
  }
}
