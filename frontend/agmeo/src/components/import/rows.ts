import type { Crop, Field } from '@agmeo/contracts'
import area from '@turf/area'
import type { Feature, MultiPolygon, Polygon } from 'geojson'
import { t } from '#/i18n'
import type { IsoxmlPartfield } from './isoxml'

export type ImportSource = 'antrag' | 'shapefile' | 'isoxml'

/** One field to import, whatever the source. */
export interface ImportRow {
  key: number
  name: string
  identifier: string | null
  /** What the source says about the crop: a land-use code or a crop name. */
  cropKey: string | null
  landUseCode: string | null
  /** Farm or customer named in the source (ISO-XML). */
  origin: string | null
  /** The uploaded file the row came from, where several can be read at once (ISO-XML). */
  file: string | null
  geometry: Polygon | MultiPolygon | null
  areaHa: number | null
}

const text = (v: unknown) => {
  if (v == null) return null
  const s = String(v).trim()
  return s && s.toLowerCase() !== 'null' ? s : null
}
const clip = (s: string | null) => (s ? s.slice(0, 200) : null)
const ha = (g: Polygon | MultiPolygon | null) => (g ? area(g) / 10_000 : null)

/** Land-use codes come as text or numbers ("115", 115, "115.0"); the catalogue stores "115". */
export function normalizeCode(v: unknown): string | null {
  const s = text(v)
  if (!s) return null
  return /^\d+(\.0+)?$/.test(s) ? String(Number.parseInt(s, 10)) : s.slice(0, 5)
}

// ---------------------------------------------------------------------------
// Subsidy application (Antragsdaten): column detection
// ---------------------------------------------------------------------------

export const ANTRAG_ROLES = ['name', 'number', 'part', 'flik', 'code'] as const
export type AntragRole = (typeof ANTRAG_ROLES)[number]
export type AntragMapping = Record<AntragRole, string | null>

/** Column names of the state portals (InVeKoS exports), most specific first. */
const HEADERS: Record<AntragRole, string[]> = {
  code: ['NUTZ_CODE', 'NUTZUNG_CD', 'NUTZCODE', 'NC', 'NU_CODE', 'NUTZUNGNR', 'KULTURCODE', 'NUTZUNG', 'NUTZART', 'KC', 'CODE'],
  flik: ['FLIK', 'FLIK_FLEK', 'FB_FLIK', 'FELDBLOCK', 'FELDBLOCKNR', 'FBI', 'FBI_NR', 'FLEK'],
  number: ['SCHLAG_NR', 'SCHLAGNR', 'SCHLAGNUMMER', 'FNR', 'SCHL_NR', 'PARZ_NR', 'NR', 'NUMMER'],
  part: ['TSCHLAG_BE', 'TS_BEZ', 'BEZTEILSCH', 'TSCHLAG', 'TS_NR', 'TEILSCHLAG', 'TS'],
  name: ['SCHLAGNAME', 'SCHLAG_BEZ', 'SCHLAGBEZ', 'BEZSCHLAG', 'SCHLAG', 'BEZEICHNUNG', 'FELDNAME', 'PARZ_NAME', 'NAME', 'BEZ'],
}
// FLIK: "DE" + state + 10–12 characters, or the bare field-block code without the prefix.
const FLIK = /^(DE[A-Z]{2})?[0-9A-Z]{8,14}$/i

/**
 * Picks the columns of a subsidy-application export by header name and values: the land-use code
 * column must hold known codes, the FLIK column field-block numbers. Each column is used once.
 */
export function detectAntragColumns(features: Feature[], knownCodes: Set<string>): AntragMapping {
  const keys = propertyKeys(features)
  const sample = features.slice(0, 200).map((f) => f.properties ?? {})
  const share = (key: string, test: (v: string) => boolean) => {
    const values = sample.map((p) => text(p[key])).filter((v): v is string => v != null)
    return values.length ? values.filter(test).length / values.length : 0
  }
  const header = (role: AntragRole, key: string) => {
    const i = HEADERS[role].indexOf(key.toUpperCase())
    return i < 0 ? 0 : 1 - i / 20
  }
  const score: Record<AntragRole, (key: string) => number> = {
    code: (k) => (share(k, (v) => knownCodes.has(normalizeCode(v)!)) >= 0.6 ? 1 + header('code', k) : 0),
    flik: (k) => (share(k, (v) => FLIK.test(v) && /\d/.test(v)) >= 0.6 ? 1 + header('flik', k) : header('flik', k) / 2),
    number: (k) => header('number', k),
    part: (k) => header('part', k),
    name: (k) => (share(k, (v) => /[a-zäöü]{3}/i.test(v)) >= 0.5 ? header('name', k) : header('name', k) / 4),
  }
  const used = new Set<string>()
  const mapping = Object.fromEntries(ANTRAG_ROLES.map((r) => [r, null])) as AntragMapping
  for (const role of ['code', 'flik', 'number', 'part', 'name'] as const) {
    const best = keys.filter((k) => !used.has(k)).map((k) => ({ k, s: score[role](k) })).sort((a, b) => b.s - a.s)[0]
    if (best && best.s > 0) {
      mapping[role] = best.k
      used.add(best.k)
    }
  }
  return mapping
}

/**
 * One row per polygon. A field split into part fields (several rows with the same name and
 * number) gets the part's designation appended, so every row has its own name.
 */
export function antragRows(features: Feature<Polygon | MultiPolygon>[], m: AntragMapping): ImportRow[] {
  const get = (f: Feature, key: string | null) => (key ? text(f.properties?.[key]) : null)
  const base = features.map((f) => ({ f, name: get(f, m.name), number: get(f, m.number), part: get(f, m.part), flik: get(f, m.flik), code: m.code ? normalizeCode(f.properties?.[m.code]) : null }))
  const counts = new Map<string, number>()
  for (const b of base) counts.set(`${b.name}|${b.number}`, (counts.get(`${b.name}|${b.number}`) ?? 0) + 1)
  return base.map((b, key) => {
    let name = b.name ?? (b.number ? t('import.antrag.fieldNumber', { number: b.number }) : t('fields.import.defaultName', { number: key + 1 }))
    if (b.part && (counts.get(`${b.name}|${b.number}`) ?? 0) > 1) name = `${name} – ${b.part}`
    return { key, name: clip(name)!, identifier: clip(b.number ?? b.flik), cropKey: b.code, landUseCode: b.code, origin: null, file: null, geometry: b.f.geometry, areaHa: ha(b.f.geometry) }
  })
}

// ---------------------------------------------------------------------------
// Shapefile and ISO-XML
// ---------------------------------------------------------------------------

export interface ShapeMapping {
  name: string | null
  identifier: string | null
  crop: string | null
}

const NAME_KEYS = ['name', 'schlagname', 'schlag_bez', 'bezeichnung', 'feldname', 'title', 'label']
const ID_KEYS = ['identifier', 'schlag_nr', 'schlagnr', 'schlagnummer', 'flik', 'parcel_id', 'nr', 'id']
const CROP_KEYS = ['kultur', 'crop', 'fruchtart', 'frucht', 'nutzung', 'nutz_code', 'nutzcode', 'nc', 'crop_name']

export function guessShapeMapping(features: Feature[]): ShapeMapping {
  const keys = propertyKeys(features)
  const pick = (preferred: string[]) => preferred.map((p) => keys.find((k) => k.toLowerCase() === p)).find(Boolean) ?? null
  return { name: pick(NAME_KEYS), identifier: pick(ID_KEYS), crop: pick(CROP_KEYS) }
}

export function shapeRows(features: Feature<Polygon | MultiPolygon>[], m: ShapeMapping): ImportRow[] {
  return features.map((f, key) => {
    const crop = m.crop ? text(f.properties?.[m.crop]) : null
    const code = crop && /^\d{1,3}(\.0+)?$/.test(crop) ? normalizeCode(crop) : null
    return {
      key,
      name: clip((m.name && text(f.properties?.[m.name])) || t('fields.import.defaultName', { number: key + 1 }))!,
      identifier: clip(m.identifier ? text(f.properties?.[m.identifier]) : null),
      cropKey: code ?? crop,
      landUseCode: code,
      origin: null,
      file: null,
      geometry: f.geometry,
      areaHa: ha(f.geometry),
    }
  })
}

export function isoxmlRows(partfields: IsoxmlPartfield[]): ImportRow[] {
  return partfields.map((p, key) => ({
    key,
    name: clip(p.name || t('fields.import.defaultName', { number: key + 1 }))!,
    identifier: clip(p.code),
    cropKey: p.crop,
    landUseCode: null,
    origin: [p.customer, p.farm].filter(Boolean).join(' · ') || null,
    file: p.file,
    geometry: p.geometry,
    areaHa: ha(p.geometry),
  }))
}

export function propertyKeys(features: Feature[]) {
  return [...new Set(features.flatMap((f) => Object.keys(f.properties ?? {})))].sort()
}

// ---------------------------------------------------------------------------
// Matching against agmeo data
// ---------------------------------------------------------------------------

/** The catalogue crop for a land-use code or crop name from the source. */
export function matchCrop(key: string, crops: Crop[]): Crop | null {
  const code = normalizeCode(key)
  if (code && /^\d+$/.test(code)) {
    const byCode = crops.filter((c) => c.landUseCode === code)
    return byCode.find((c) => !c.custom) ?? byCode[0] ?? null
  }
  const k = key.trim().toLowerCase()
  return crops.find((c) => c.name.toLowerCase() === k || c.nameEn?.toLowerCase() === k || c.code.toLowerCase() === k) ?? null
}

/**
 * Rows naming a field that a later row names again (same name and identifier), e.g. the field's
 * boundary in the exports of several years, mapped to that later row. Files are
 * read in name order, so the later row usually comes from the newer export.
 */
export function repeatedRows(rows: ImportRow[]): Map<number, ImportRow> {
  const last = new Map<string, ImportRow>()
  const keyOf = (r: ImportRow) => `${r.name.trim().toLowerCase()}|${r.identifier?.trim().toLowerCase() ?? ''}`
  for (const r of rows) if (r.geometry) last.set(keyOf(r), r)
  const repeated = new Map<number, ImportRow>()
  for (const r of rows) {
    const later = last.get(keyOf(r))
    if (r.geometry && later && later.key !== r.key) repeated.set(r.key, later)
  }
  return repeated
}

/**
 * An existing field of the farm with the same name, else with the same identifier. Names go first
 * because the parts of a field share its number.
 */
export function existingField(row: ImportRow, fields: Field[], farmId: string | null): Field | null {
  const same = (a: string | null, b: string | null) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase()
  const farmFields = fields.filter((f) => f.farmId === farmId)
  return farmFields.find((f) => same(f.name, row.name)) ?? farmFields.find((f) => same(f.identifier, row.identifier)) ?? null
}
