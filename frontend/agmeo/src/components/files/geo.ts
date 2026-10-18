import type { FileItem } from '@agmeo/contracts'
import type { FeatureCollection } from 'geojson'
import { api } from '#/lib/api'

/** Largest file the browser viewer reads (as in the reference app). */
export const GEO_MAX_BYTES = 60_000_000

export interface GeoLayer {
  id: string
  name: string
  data: FeatureCollection
  visible: boolean
  color: string
  opacity: number
}

const PALETTE = ['#e4572e', '#2e86ab', '#f2a541', '#76b041', '#9c51b6', '#17bebb', '#e83f6f', '#5c6b73']
export const layerColor = (i: number) => PALETTE[i % PALETTE.length]

export const isGeoName = (name: string) => /\.(shp|geojson|json|kml|kmz|zip)$/i.test(name)

const merge = (r: FeatureCollection | FeatureCollection[]): FeatureCollection =>
  Array.isArray(r) ? { type: 'FeatureCollection', features: r.flatMap((c) => c.features) } : r

function asCollection(data: unknown): FeatureCollection {
  const d = data as { type?: string; features?: unknown }
  if (d?.type === 'FeatureCollection') return d as FeatureCollection
  if (d?.type === 'Feature') return { type: 'FeatureCollection', features: [d as never] }
  if (d?.type) return { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: d as never, properties: {} }] }
  throw new Error('Not GeoJSON')
}

async function kmlToGeoJson(text: string): Promise<FeatureCollection> {
  const { kml } = await import('@tmcw/togeojson')
  return kml(new DOMParser().parseFromString(text, 'application/xml')) as FeatureCollection
}

/**
 * Reads a geodata file into GeoJSON (WGS 84). A `.shp` takes its `.dbf`, `.prj` and `.cpg`
 * from the same folder (`siblings`); zips may hold a Shapefile or a KML.
 */
export async function loadGeoFile(orgId: string, file: FileItem, siblings: FileItem[]): Promise<FeatureCollection> {
  if (file.sizeBytes > GEO_MAX_BYTES) throw new Error('too_large')
  const get = async (f: FileItem) => (await api.blob(`/orgs/${orgId}/files/${f.id}/content`)).arrayBuffer()
  const ext = file.name.toLowerCase().split('.').pop()
  if (ext === 'geojson' || ext === 'json') return asCollection(JSON.parse(new TextDecoder().decode(await get(file))))
  if (ext === 'kml') return kmlToGeoJson(new TextDecoder().decode(await get(file)))
  if (ext === 'kmz' || ext === 'zip') {
    const buf = new Uint8Array(await get(file))
    const { unzipSync, strFromU8 } = await import('fflate')
    const entries = unzipSync(buf)
    const kmlEntry = Object.keys(entries).find((n) => n.toLowerCase().endsWith('.kml'))
    if (ext === 'kmz' || (kmlEntry && !Object.keys(entries).some((n) => n.toLowerCase().endsWith('.shp')))) {
      if (!kmlEntry) throw new Error('no_geodata')
      return kmlToGeoJson(strFromU8(entries[kmlEntry]))
    }
    const { default: shp } = await import('shpjs')
    return merge(await shp(buf.buffer))
  }
  if (ext === 'shp') {
    const base = file.name.slice(0, -4).toLowerCase()
    const part = (e: string) => siblings.find((s) => s.name.toLowerCase() === `${base}.${e}`)
    const [shpBuf, dbf, prj, cpg] = await Promise.all([get(file), ...['dbf', 'prj', 'cpg'].map((e) => (part(e) ? get(part(e)!) : Promise.resolve(undefined)))])
    const { default: shp } = await import('shpjs')
    return merge(await shp({ shp: shpBuf, dbf, prj: prj && new TextDecoder().decode(prj), cpg: cpg && new TextDecoder().decode(cpg) }))
  }
  throw new Error('unsupported')
}

/** Bounding box [w, s, e, n] of a collection, or null when it has no coordinates. */
export function bounds(fc: FeatureCollection): [number, number, number, number] | null {
  let w = Infinity
  let s = Infinity
  let e = -Infinity
  let n = -Infinity
  const visit = (c: unknown) => {
    if (Array.isArray(c) && typeof c[0] === 'number') {
      w = Math.min(w, c[0] as number)
      e = Math.max(e, c[0] as number)
      s = Math.min(s, c[1] as number)
      n = Math.max(n, c[1] as number)
    } else if (Array.isArray(c)) c.forEach(visit)
  }
  for (const f of fc.features) {
    const g = f.geometry
    if (!g) continue
    if (g.type === 'GeometryCollection') g.geometries.forEach((x) => 'coordinates' in x && visit(x.coordinates))
    else visit(g.coordinates)
  }
  return Number.isFinite(w) ? [w, s, e, n] : null
}

/** True when coordinates look projected (metres) rather than WGS 84 degrees. */
export function looksProjected(fc: FeatureCollection): boolean {
  const b = bounds(fc)
  return !!b && (Math.abs(b[0]) > 180 || Math.abs(b[2]) > 180 || Math.abs(b[1]) > 90 || Math.abs(b[3]) > 90)
}
