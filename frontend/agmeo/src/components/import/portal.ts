import type { Feature, MultiPolygon, Polygon, Position } from 'geojson'
import { t } from '#/i18n'
import { CRS_OPTIONS, type CrsId, crsProj, guessCrs } from './crs'
import { extension, type SourceFile, upload } from './files'
import { isLonLat, type ShapeLayer } from './shapefile'

type Proj4 = typeof import('proj4')

/**
 * Subsidy-application exports that come as XML/GML instead of a Shapefile:
 *
 * - DE-BY (iBALIS "FlächenAbfrage"): one XML, Feldstücke with WKT geometries in ETRS89 / UTM 32N
 * - DE-NW (ELAN): an XML with the parcels (`<nn>`) and a GML with their geometries, joined on
 *   Schlag and Teilschlag
 * - DE-BB, DE-BE, DE-MV (data experts `fa:flaechenantrag`): one XML, each part with an embedded GML
 *   geometry that names its reference system
 *
 * Every parcel becomes a feature with the column names the Antragsdaten column detection knows,
 * so the rest of the import treats it like a Shapefile export.
 */

type Parcel = { name: string | null; number: string | null; part: string | null; flik: string | null; code: string | null }
type RawGeometry = { polygons: Position[][][]; srs: CrsId | null }

const local = (el: Element | null | undefined, name: string) => (el ? Array.from(el.children).filter((c) => c.localName === name) : [])
const first = (el: Element | null | undefined, ...path: string[]) => path.reduce<Element | null>((e, name) => local(e, name)[0] ?? null, el ?? null)
const value = (el: Element | null | undefined, ...path: string[]) => first(el, ...path)?.textContent?.trim() || null
const descendants = (el: Element, ...names: string[]) => Array.from(el.getElementsByTagName('*')).filter((e) => names.includes(e.localName))

function parseXml(text: string, file: string) {
  const doc = new DOMParser().parseFromString(text, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length) throw new Error(t('import.antrag.xmlInvalid', { file }))
  return doc.documentElement
}

/** XML files declare their encoding; portal exports are UTF-8 or ISO-8859-1. */
function decodeXml(data: Uint8Array) {
  const declared = /encoding=["']([\w-]+)["']/.exec(new TextDecoder('ascii').decode(data.subarray(0, 200)))?.[1]
  try {
    return new TextDecoder(declared ?? 'utf-8').decode(data)
  } catch {
    return new TextDecoder('utf-8').decode(data)
  }
}

/** "EPSG:25832", "urn:ogc:def:crs:EPSG::25832" or ".../epsg.xml#25832" → a supported CRS. */
function srsId(srsName: string | null): CrsId | null {
  const code = srsName && /(\d{4,5})\s*$/.exec(srsName)?.[1]
  return (CRS_OPTIONS.find((c) => c.id === `EPSG:${code}`)?.id as CrsId | undefined) ?? null
}

const closed = (r: Position[]) => {
  const [a, b] = [r[0], r.at(-1)]
  return a && b && (a[0] !== b[0] || a[1] !== b[1]) ? [...r, [a[0], a[1]]] : r
}

// ---------------------------------------------------------------------------
// Geometry encodings
// ---------------------------------------------------------------------------

/** Positions of a GML ring: `posList` (with srsDimension), `coordinates` ("x,y x,y") or `pos` elements. */
function gmlRing(ring: Element): Position[] {
  const posList = descendants(ring, 'posList')[0]
  if (posList) {
    const dim = Number(posList.getAttribute('srsDimension') ?? posList.getAttribute('dimension')) || 2
    const n = (posList.textContent ?? '').trim().split(/\s+/).map(Number)
    const out: Position[] = []
    for (let i = 0; i + 1 < n.length; i += dim) out.push([n[i], n[i + 1]])
    return out
  }
  const coordinates = descendants(ring, 'coordinates')[0]
  if (coordinates) {
    const cs = coordinates.getAttribute('cs') ?? ','
    const ts = coordinates.getAttribute('ts') ?? ' '
    return (coordinates.textContent ?? '')
      .trim()
      .split(ts === ' ' ? /\s+/ : ts)
      .map((tuple) => tuple.split(cs).map(Number).slice(0, 2) as Position)
  }
  return descendants(ring, 'pos').map((p) => (p.textContent ?? '').trim().split(/\s+/).map(Number).slice(0, 2) as Position)
}

/** All polygons (GML 2 `Polygon`, GML 3 `Polygon`/`PolygonPatch`) below an element. */
function gmlGeometry(el: Element): RawGeometry {
  const srsHolder = el.hasAttribute('srsName') ? el : descendants(el, ...['Surface', 'MultiSurface', 'MultiPolygon', 'Polygon']).find((e) => e.hasAttribute('srsName'))
  const polygons = [el, ...descendants(el, 'Polygon', 'PolygonPatch')]
    .filter((p) => p.localName === 'Polygon' || p.localName === 'PolygonPatch')
    .map((p) => {
      const outer = [...local(p, 'exterior'), ...local(p, 'outerBoundaryIs')].map(gmlRing)
      const inner = [...local(p, 'interior'), ...local(p, 'innerBoundaryIs')].map(gmlRing)
      return [...outer, ...inner].map(closed).filter((r) => r.length >= 4)
    })
    .filter((rings) => rings.length > 0)
  return { polygons, srs: srsId(srsHolder?.getAttribute('srsName') ?? null) }
}

/** GML stored as escaped text inside an XML element (data experts exports). */
function embeddedGml(text: string | null): RawGeometry | null {
  if (!text) return null
  const xml = text.includes('xmlns:gml') ? text : text.replace(/^(\s*<gml:\w+)/, '$1 xmlns:gml="http://www.opengis.net/gml"')
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length) return null
  return gmlGeometry(doc.documentElement)
}

/** WKT POLYGON / MULTIPOLYGON, optionally with an EWKT `SRID=…;` prefix. */
function wkt(text: string | null): RawGeometry | null {
  const m = text && /^\s*(?:SRID=(\d+);)?\s*(MULTIPOLYGON|POLYGON)\s*(?:Z|M|ZM)?\s*(\(.*\))\s*$/is.exec(text)
  if (!m) return null
  const json = m[3]
    .replace(/(-?[\d.]+(?:e[+-]?\d+)?)\s+(-?[\d.]+(?:e[+-]?\d+)?)(?:\s+-?[\d.]+(?:e[+-]?\d+)?){0,2}/gi, '[$1,$2]')
    .replace(/\(/g, '[')
    .replace(/\)/g, ']')
  try {
    const coords = JSON.parse(json) as Position[][] | Position[][][]
    const polygons = (m[2].toUpperCase() === 'POLYGON' ? [coords] : coords) as Position[][][]
    return { polygons: polygons.map((p) => p.map(closed)), srs: srsId(m[1] ?? null) }
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// State formats
// ---------------------------------------------------------------------------

type Raw = { parcel: Parcel; geometry: RawGeometry | null }
type Format = { raws: Raw[]; defaultSrs: CrsId | null }

/** DE-BY iBALIS: `Ergebnis/Betriebe/Betrieb/Feldstuecke/Feldstueck`. */
function bavaria(root: Element): Format {
  const raws = descendants(root, 'Feldstueck').map((fs) => {
    // Several uses on one Feldstück have no own geometry; the largest one stands for the field.
    const uses = descendants(fs, 'Nutzung').map((n) => ({ code: value(n, 'Code'), area: Number(value(n, 'Flaeche')) || 0 }))
    const main = uses.sort((a, b) => b.area - a.area)[0]
    return {
      parcel: { name: value(fs, 'Name'), number: value(fs, 'Nummer'), part: null, flik: fs.getAttribute('FID'), code: main?.code ?? null },
      geometry: wkt(value(fs, 'Geometrie')),
    }
  })
  return { raws, defaultSrs: 'EPSG:25832' }
}

/** DE-NW ELAN parcels (`nn/land/parzelle`), one per Teilschlag. */
function nrwParcels(root: Element): Parcel[] {
  return descendants(root, 'parzelle').map((p) => ({
    name: value(p, 'schlag', 'bezeichnung'),
    number: value(p, 'schlag', 'nummer'),
    part: value(p, 'teilschlag'),
    flik: value(p, 'feldblock'),
    code: value(p, 'nutzungaj', 'code'),
  }))
}

/** DE-NW ELAN geometries: WFS `featureMember/tschlag` with SCHLAGNR, TEILSCHLAG, FLIK and GEO_COORD_. */
function nrwGeometries(root: Element): Raw[] {
  return descendants(root, 'tschlag').map((ts) => {
    const geo = first(ts, 'GEO_COORD_')
    return {
      parcel: { name: null, number: value(ts, 'SCHLAGNR'), part: value(ts, 'TEILSCHLAG'), flik: value(ts, 'FLIK'), code: null },
      geometry: geo ? gmlGeometry(geo) : null,
    }
  })
}

function nrw(parcels: Parcel[], geometries: Raw[]): Format {
  const key = (p: Parcel) => `${p.number ?? ''}|${(p.part ?? '').toLowerCase()}`
  const byKey = new Map(geometries.map((g) => [key(g.parcel), g]))
  const raws = parcels.length
    ? parcels.map((parcel) => {
        const g = byKey.get(key(parcel)) ?? geometries.find((x) => x.parcel.number === parcel.number && x.parcel.flik === parcel.flik)
        return { parcel: { ...parcel, flik: parcel.flik ?? g?.parcel.flik ?? null }, geometry: g?.geometry ?? null }
      })
    : geometries
  return { raws, defaultSrs: 'EPSG:25832' }
}

/** DE-BB / DE-BE / DE-MV: `fa:flaechenantrag/fa:gesamtparzellen/fa:gesamtparzelle`, main use and strips. */
function dataExperts(root: Element): Format {
  const raws = descendants(root, 'gesamtparzelle').flatMap((gp) => {
    const name = value(gp, 'parzellenname')
    const parts = first(gp, 'teilflaechen')
    return [...local(parts, 'hauptnutzungsflaeche'), ...local(first(parts, 'streifen_flaechen'), 'streifen')].map((tf) => ({
      parcel: { name, number: value(tf, 'teilflaechennummer') ?? value(gp, 'gp_nummer'), part: null, flik: value(tf, 'flik'), code: value(tf, 'nutzung') },
      geometry: embeddedGml(value(tf, 'geometrie')),
    }))
  })
  return { raws, defaultSrs: null }
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/**
 * Reads the XML/GML subsidy-application exports among the files into layers like
 * `readShapefiles` does. Returns no layers when none of the files is a known portal format.
 */
export async function readPortalXml(files: SourceFile[], crsOverride: CrsId | null): Promise<ShapeLayer[]> {
  const docs = files
    .filter((f) => ['xml', 'gml'].includes(extension(f)))
    .map((f) => ({ file: f, root: parseXml(decodeXml(f.data), f.name) }))
  const formats: { name: string; file: SourceFile; format: Format }[] = []
  const nrwXml = docs.filter((d) => d.root.localName === 'nn' && descendants(d.root, 'parzelle').length)
  const nrwGml = docs.filter((d) => d.root.localName === 'FeatureCollection' && descendants(d.root, 'tschlag').length)
  for (const d of docs) {
    const name = d.file.name.replace(/\.(xml|gml)$/i, '')
    if (d.root.localName === 'Ergebnis' && descendants(d.root, 'Feldstueck').length) formats.push({ name, file: d.file, format: bavaria(d.root) })
    if (d.root.localName === 'flaechenantrag') formats.push({ name, file: d.file, format: dataExperts(d.root) })
  }
  if (nrwXml.length || nrwGml.length) {
    if (!nrwGml.length) throw new Error(t('import.antrag.nwGmlMissing'))
    const geometries = nrwGml.flatMap((d) => nrwGeometries(d.root))
    const file = (nrwXml[0] ?? nrwGml[0]).file
    const name = file.name.replace(/\.(xml|gml)$/i, '')
    formats.push({ name, file, format: nrw(nrwXml.flatMap((d) => nrwParcels(d.root)), geometries) })
  }
  if (!formats.length) return []

  const { default: proj4 } = await import('proj4')
  return formats.map(({ name, file, format }) => ({ id: file.path, file: upload(file), ...toLayer(name, format, crsOverride, proj4) }))
}

/** Column names the Antragsdaten detection picks up; columns a format does not fill are left out. */
const columns = (p: Parcel) => ({ SCHLAGNAME: p.name, SCHLAG_NR: p.number, TEILSCHLAG: p.part, FLIK: p.flik, NUTZ_CODE: p.code })

function toLayer(name: string, { raws, defaultSrs }: Format, crsOverride: CrsId | null, proj4: Proj4): Omit<ShapeLayer, 'id' | 'file'> {
  const placed = raws.filter((r): r is Raw & { geometry: RawGeometry } => !!r.geometry?.polygons.length)
  const declared = placed.find((r) => r.geometry.srs)?.geometry.srs ?? null
  const guess = guessCrs(placed[0]?.geometry.polygons[0][0][0] ?? [0, 0])
  // A reference system named in the file or fixed by the format counts like a .prj.
  const known = declared ?? defaultSrs
  const crs: ShapeLayer['crs'] = crsOverride
    ? { id: crsOverride, source: 'chosen', certain: true }
    : known
      ? { id: known, source: 'prj', certain: true }
      : { id: guess?.id ?? null, source: guess ? 'guessed' : 'unknown', certain: !!guess?.certain }

  // Without a reference system the coordinates stay as they are; the page then asks for one.
  const features = placed.map(({ parcel, geometry }): Feature<Polygon | MultiPolygon> => {
    const id = crsOverride ?? geometry.srs ?? crs.id
    const proj = id && crsProj(id)
    const convert = proj ? proj4(proj, 'WGS84') : null
    const coordinates = geometry.polygons.map((p) => p.map((r) => r.map((pos): Position => (convert ? convert.forward([pos[0], pos[1]]) : [pos[0], pos[1]]))))
    return {
      type: 'Feature',
      properties: Object.fromEntries(Object.entries(columns(parcel)).filter(([, v]) => v != null)),
      geometry: coordinates.length === 1 ? { type: 'Polygon', coordinates: coordinates[0] } : { type: 'MultiPolygon', coordinates },
    }
  })
  const g = features[0]?.geometry
  const usable = !g || isLonLat(g.type === 'Polygon' ? g.coordinates[0][0] : g.coordinates[0][0][0])
  return { name, features, skipped: raws.length - features.length, crs: usable ? crs : { ...crs, source: 'unknown', certain: false } }
}
