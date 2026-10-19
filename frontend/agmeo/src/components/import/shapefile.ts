import type { Feature, FeatureCollection, Geometry, MultiPolygon, Polygon, Position } from 'geojson'
import { type CrsId, crsProj, guessCrs } from './crs'
import { decode, extension, type SourceFile, stem, upload } from './files'

export interface ShapeLayer {
  /** Unique within an import: the .shp path without its extension. */
  id: string
  name: string
  /** The uploaded file the layer came from. */
  file: string
  features: Feature<Polygon | MultiPolygon>[]
  /** Features that are not polygons (points, lines, empty geometries). */
  skipped: number
  /**
   * Reference system of the source: from its .prj, guessed from the coordinates when there is
   * none, chosen by the user, or unknown (the coordinates are then not usable).
   */
  crs: { id: CrsId | null; source: 'prj' | 'guessed' | 'chosen' | 'unknown'; certain: boolean }
}

const strip = (p: Position): Position => [p[0], p[1]]
const own = (d: Uint8Array) => d.slice().buffer

function firstPosition(g: Geometry | null): Position | null {
  if (!g || g.type === 'GeometryCollection') return null
  let c: unknown = g.coordinates
  while (Array.isArray(c) && Array.isArray(c[0])) c = c[0]
  return Array.isArray(c) && typeof c[0] === 'number' ? (c as Position) : null
}

export const isLonLat = (p: Position | null) => !!p && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90

export function polygonFeatures(fc: FeatureCollection): { features: Feature<Polygon | MultiPolygon>[]; skipped: number } {
  const features: Feature<Polygon | MultiPolygon>[] = []
  let skipped = 0
  for (const f of fc.features) {
    const g = f.geometry
    const properties = f.properties ?? {}
    if (g?.type === 'Polygon') features.push({ type: 'Feature', properties, geometry: { type: 'Polygon', coordinates: g.coordinates.map((r) => r.map(strip)) } })
    else if (g?.type === 'MultiPolygon') features.push({ type: 'Feature', properties, geometry: { type: 'MultiPolygon', coordinates: g.coordinates.map((p) => p.map((r) => r.map(strip))) } })
    else skipped += 1
  }
  return { features, skipped }
}

/**
 * Reads every Shapefile layer (.shp with its .dbf, .cpg and .prj) among the files and reprojects
 * it to WGS 84. Subsidy-portal exports often lack the .prj; their reference system is then guessed
 * from the coordinates, or taken from `crsOverride`.
 */
export async function readShapefiles(files: SourceFile[], crsOverride: CrsId | null): Promise<ShapeLayer[]> {
  const { default: shp } = await import('shpjs')
  const parts = new Map<string, Partial<Record<'shp' | 'dbf' | 'prj' | 'cpg', SourceFile>>>()
  for (const f of files) {
    const ext = extension(f)
    if (ext === 'shp' || ext === 'dbf' || ext === 'prj' || ext === 'cpg') parts.set(stem(f), { ...parts.get(stem(f)), [ext]: f })
  }
  const layers: ShapeLayer[] = []
  for (const [key, p] of parts) {
    if (!p.shp) continue
    const base = { shp: own(p.shp.data), dbf: p.dbf && own(p.dbf.data), cpg: p.cpg && decode(p.cpg.data).trim() }
    let fc: FeatureCollection
    let crs: ShapeLayer['crs']
    if (p.prj) {
      fc = await shp({ ...base, prj: decode(p.prj.data) })
      crs = { id: null, source: 'prj', certain: true }
    } else {
      fc = await shp(base)
      const guess = guessCrs(firstPosition(fc.features.find((f) => f.geometry)?.geometry ?? null) ?? [0, 0])
      const id = crsOverride ?? guess?.id ?? null
      crs = { id, source: crsOverride ? 'chosen' : guess ? 'guessed' : 'unknown', certain: !!crsOverride || !!guess?.certain }
      const proj = id && crsProj(id)
      if (proj) fc = await shp({ ...base, prj: proj })
    }
    const { features, skipped } = polygonFeatures(fc)
    if (!isLonLat(firstPosition(features[0]?.geometry ?? null)) && features.length) crs = { ...crs, source: 'unknown', certain: false }
    layers.push({ id: key, name: p.shp.name.replace(/\.shp$/i, ''), file: upload(p.shp), features, skipped, crs })
  }
  return layers
}
