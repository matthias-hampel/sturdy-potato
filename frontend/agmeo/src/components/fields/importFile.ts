import type { Feature, FeatureCollection, MultiPolygon, Polygon, Position } from 'geojson'
import { t } from '#/i18n'

export interface ImportCandidate {
  index: number
  properties: Record<string, unknown>
  geometry: Polygon | MultiPolygon
}

const strip = (p: Position): Position => [p[0], p[1]]
const ring = (r: Position[]) => r.map(strip)

function toCandidates(fc: FeatureCollection): { candidates: ImportCandidate[]; skipped: number } {
  const candidates: ImportCandidate[] = []
  let skipped = 0
  fc.features.forEach((f: Feature) => {
    const g = f.geometry
    if (g?.type === 'Polygon') candidates.push({ index: candidates.length, properties: f.properties ?? {}, geometry: { type: 'Polygon', coordinates: g.coordinates.map(ring) } })
    else if (g?.type === 'MultiPolygon') candidates.push({ index: candidates.length, properties: f.properties ?? {}, geometry: { type: 'MultiPolygon', coordinates: g.coordinates.map((p) => p.map(ring)) } })
    else skipped += 1
  })
  return { candidates, skipped }
}

function asCollection(data: unknown): FeatureCollection {
  const d = data as { type?: string }
  if (d?.type === 'FeatureCollection') return d as FeatureCollection
  if (d?.type === 'Feature') return { type: 'FeatureCollection', features: [d as Feature] }
  if (d?.type === 'Polygon' || d?.type === 'MultiPolygon') return { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: d as Polygon, properties: {} }] }
  throw new Error(t('fields.import.noGeoJson'))
}

/**
 * Parses GeoJSON, KML or a zipped Shapefile in the browser. Shapefiles are reprojected
 * to WGS 84 using their .prj file; GeoJSON must already be in WGS 84 (RFC 7946).
 */
export async function parseBoundaryFile(file: File): Promise<{ candidates: ImportCandidate[]; skipped: number; format: string }> {
  const name = file.name.toLowerCase()
  if (name.endsWith('.zip')) {
    const { default: shp } = await import('shpjs')
    const result = await shp(await file.arrayBuffer())
    const collections = (Array.isArray(result) ? result : [result]) as FeatureCollection[]
    const merged: FeatureCollection = { type: 'FeatureCollection', features: collections.flatMap((c) => c.features) }
    return { ...toCandidates(merged), format: 'Shapefile' }
  }
  if (name.endsWith('.kml')) {
    const { kml } = await import('@tmcw/togeojson')
    const doc = new DOMParser().parseFromString(await file.text(), 'application/xml')
    return { ...toCandidates(kml(doc) as FeatureCollection), format: 'KML' }
  }
  if (name.endsWith('.geojson') || name.endsWith('.json')) {
    return { ...toCandidates(asCollection(JSON.parse(await file.text()))), format: 'GeoJSON' }
  }
  throw new Error(t('fields.import.unsupported'))
}

const NAME_KEYS = ['name', 'Name', 'NAME', 'schlagname', 'Schlagname', 'SCHLAGNAME', 'bezeichnung', 'Bezeichnung', 'title', 'label']
const ID_KEYS = ['flik', 'FLIK', 'Flik', 'identifier', 'id_schlag', 'SCHLAG_NR', 'schlagnr', 'Schlagnummer', 'parcel_id', 'id']

export function guessProperty(candidates: ImportCandidate[], kind: 'name' | 'identifier'): string | null {
  const keys = new Set(candidates.flatMap((c) => Object.keys(c.properties)))
  const preferred = kind === 'name' ? NAME_KEYS : ID_KEYS
  return preferred.find((k) => keys.has(k)) ?? null
}

export function propertyKeys(candidates: ImportCandidate[]) {
  return [...new Set(candidates.flatMap((c) => Object.keys(c.properties)))].sort()
}
