import booleanWithin from '@turf/boolean-within'
import difference from '@turf/difference'
import { featureCollection, polygon as turfPolygon } from '@turf/helpers'
import simplify from '@turf/simplify'
import type { MultiPolygon, Polygon, Position } from 'geojson'

export type Ring = Position[]
export type Outer = Ring // outer ring of one polygon part
export type DrawnGeometry = Polygon | MultiPolygon

const round = (p: Position): Position => [Math.round(p[0] * 1e7) / 1e7, Math.round(p[1] * 1e7) / 1e7]

/** Splits a boundary into outer rings (editable) and holes (interior rings). */
export function splitHoles(g: DrawnGeometry | null | undefined): { outers: Outer[]; holes: Ring[] } {
  if (!g) return { outers: [], holes: [] }
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates
  return { outers: polys.map((p) => p[0]), holes: polys.flatMap((p) => p.slice(1)) }
}

/**
 * Combines outer rings and holes into one boundary: each hole is cut from the parts it lies
 * in. Returns null when nothing is left.
 */
export function compose(outers: Outer[], holes: Ring[]): DrawnGeometry | null {
  const parts: Position[][][] = []
  for (const outer of outers) {
    if (outer.length < 4) continue
    let current: Polygon | MultiPolygon | null = turfPolygon([outer]).geometry
    for (const hole of holes) {
      if (!current || hole.length < 4) continue
      const cut = difference(featureCollection([{ type: 'Feature', geometry: current, properties: {} }, turfPolygon([hole])]))
      current = cut?.geometry ?? null
    }
    if (!current) continue
    if (current.type === 'Polygon') parts.push(current.coordinates)
    else parts.push(...current.coordinates)
  }
  const rounded = parts.map((p) => p.map((r) => r.map(round)))
  if (!rounded.length) return null
  return rounded.length === 1 ? { type: 'Polygon', coordinates: rounded[0] } : { type: 'MultiPolygon', coordinates: rounded }
}

/**
 * Applies a cut drawn by the user: a cut inside one part becomes a hole; a cut across an
 * edge trims the parts. Returns the new outer rings and holes, or null when the cut would
 * remove everything.
 */
export function applyCut(outers: Outer[], holes: Ring[], cut: Ring): { outers: Outer[]; holes: Ring[] } | null {
  const cutPoly = turfPolygon([cut])
  const inside = outers.find((o) => o.length >= 4 && booleanWithin(cutPoly, turfPolygon([o])))
  if (inside) return { outers, holes: [...holes, cut] }
  const next = splitHoles(compose(outers, [...holes, cut]))
  return next.outers.length ? next : null
}

/**
 * Simplifies outer rings (Ramer–Douglas–Peucker, high quality, as in the reference app).
 * `toleranceDeg` is in degrees; 0.00001° ≈ 0.7–1.1 m in central Europe.
 */
export function simplifyOuters(outers: Outer[], toleranceDeg: number): Outer[] {
  if (toleranceDeg <= 0) return outers
  return outers.map((o) => {
    if (o.length < 5) return o
    const s = simplify(turfPolygon([o]), { tolerance: toleranceDeg, highQuality: true })
    const ring = s.geometry.coordinates[0]
    return ring.length >= 4 ? ring : o
  })
}

/** Vertex count of all rings, to show how much a simplification removes. */
export const vertexCount = (outers: Outer[], holes: Ring[]) => [...outers, ...holes].reduce((n, r) => n + Math.max(0, r.length - 1), 0)
