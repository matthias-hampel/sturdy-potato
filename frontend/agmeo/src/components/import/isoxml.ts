import type { MultiPolygon, Polygon, Position } from 'geojson'
import { t } from '#/i18n'
import { decode, extension, type SourceFile, upload } from './files'

/** A partfield (PFD) of an ISO 11783-10 TASKDATA set. */
export interface IsoxmlPartfield {
  name: string
  code: string | null
  farm: string | null
  customer: string | null
  crop: string | null
  /** The uploaded file the partfield came from. */
  file: string
  /** Outer boundary with holes; null when the partfield has no boundary polygon. */
  geometry: Polygon | MultiPolygon | null
}

// PLN type 1 is the partfield boundary, 9 the main field; LSG type 1 an exterior, 2 an interior ring.
const BOUNDARY = '1'
const MAINFIELD = '9'

const kids = (el: Element, tag: string) => Array.from(el.children).filter((c) => c.tagName === tag)

function ring(lsg: Element): Position[] | null {
  const pts = kids(lsg, 'PNT')
    .map((p): Position => [Number(p.getAttribute('D')), Number(p.getAttribute('C'))])
    .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y))
  const [first, last] = [pts[0], pts.at(-1)]
  if (first && last && (first[0] !== last[0] || first[1] !== last[1])) pts.push([first[0], first[1]])
  return pts.length >= 4 ? pts : null
}

function inRing([x, y]: Position, r: Position[]) {
  let inside = false
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i]
    const [xj, yj] = r[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

function boundary(pfd: Element): Polygon | MultiPolygon | null {
  const plns = kids(pfd, 'PLN')
  const own = plns.filter((p) => p.getAttribute('A') === BOUNDARY)
  const polygons: Position[][][] = []
  for (const pln of own.length ? own : plns.filter((p) => p.getAttribute('A') === MAINFIELD)) {
    const lsgs = kids(pln, 'LSG')
    const rings = (type: string) => lsgs.filter((l) => l.getAttribute('A') === type).flatMap((l) => {
        const r = ring(l)
        return r ? [r] : []
      })
    const shells = rings('1').map((r) => [r])
    // Each hole belongs to the exterior that contains it.
    for (const hole of rings('2')) (shells.find((s) => inRing(hole[0], s[0])) ?? shells[0])?.push(hole)
    polygons.push(...shells)
  }
  if (!polygons.length) return null
  return polygons.length === 1 ? { type: 'Polygon', coordinates: polygons[0] } : { type: 'MultiPolygon', coordinates: polygons }
}

const isTaskdata = (f: SourceFile) => f.name.toUpperCase() === 'TASKDATA.XML' || decode(f.data.subarray(0, 4000)).includes('<ISO11783_TaskData')

/**
 * Reads the partfields of every TASKDATA.XML among the files (one per uploaded export), including
 * those in external files (XFR) next to it. ISO-XML coordinates are WGS 84 by definition.
 */
export function readIsoxml(files: SourceFile[]): IsoxmlPartfield[] {
  const xmls = files.filter((f) => extension(f) === 'xml')
  const mains = xmls.filter(isTaskdata)
  if (!mains.length) throw new Error(t('import.isoxml.noTaskdata'))
  const parse = (f: SourceFile) => {
    const doc = new DOMParser().parseFromString(decode(f.data), 'application/xml')
    if (doc.getElementsByTagName('parsererror').length) throw new Error(t('import.isoxml.invalid', { file: f.name }))
    return doc.documentElement
  }
  const attr = (el: Element, a: string) => el.getAttribute(a)?.trim() || null

  return mains.flatMap((main) => {
    const root = parse(main)
    // A file merely named TASKDATA.XML that holds something else is skipped.
    if (root.tagName !== 'ISO11783_TaskData') return []
    // External files lie next to the TASKDATA.XML; IDs such as CTR1 only hold within one set.
    const dir = main.path.slice(0, main.path.length - main.name.length).toLowerCase()
    const roots = [root]
    for (const xfr of kids(root, 'XFR')) {
      const file = xmls.find((f) => f.path.toLowerCase() === `${dir}${xfr.getAttribute('A')}.xml`.toLowerCase())
      if (file) roots.push(parse(file))
    }
    const all = (tag: string) => roots.flatMap((r) => kids(r, tag))
    const designators = (tag: string) => new Map(all(tag).map((e) => [e.getAttribute('A'), e.getAttribute('B')]))
    const customers = designators('CTR')
    const farms = designators('FRM')
    const crops = designators('CTP')
    return all('PFD').map((pfd) => ({
      name: attr(pfd, 'C') ?? attr(pfd, 'B') ?? attr(pfd, 'A') ?? '',
      code: attr(pfd, 'B'),
      customer: customers.get(pfd.getAttribute('E')) ?? null,
      farm: farms.get(pfd.getAttribute('F')) ?? null,
      crop: crops.get(pfd.getAttribute('G')) ?? null,
      file: upload(main),
      geometry: boundary(pfd),
    }))
  })
}
