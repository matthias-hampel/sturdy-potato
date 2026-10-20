import type { MultiPolygon, Polygon } from 'geojson'

/**
 * Whether imported fields sit where they plausibly belong — a wrong or guessed reference system puts
 * them in another country or the sea. Ported from the reference's lib/geo/crsSanity.ts (the
 * open-water check of its import preview needs a land mask and is not ported).
 */
export type Centre = { lon: number; lat: number }
type Box = { west: number; east: number; south: number; north: number }
export type LocationWarning = 'outsideEurope' | 'countryMismatch' | 'farFromOrgFields'

const COUNTRY_BOUNDS: Record<string, Box> = {
  AT: { west: 9.5, east: 17.2, south: 46.3, north: 49.1 },
  BE: { west: 2.5, east: 6.5, south: 49.4, north: 51.6 },
  BG: { west: 22.3, east: 28.7, south: 41.2, north: 44.3 },
  CH: { west: 5.9, east: 10.5, south: 45.8, north: 47.9 },
  CZ: { west: 12, east: 18.9, south: 48.5, north: 51.1 },
  DE: { west: 5.8, east: 15.1, south: 47.2, north: 55.1 },
  DK: { west: 8, east: 15.3, south: 54.5, north: 57.8 },
  EE: { west: 21.7, east: 28.3, south: 57.5, north: 59.8 },
  ES: { west: -9.5, east: 3.4, south: 35.9, north: 43.9 },
  FR: { west: -5.2, east: 8.3, south: 41.3, north: 51.2 },
  GB: { west: -8.7, east: 1.8, south: 49.8, north: 60.9 },
  HR: { west: 13.4, east: 19.5, south: 42.3, north: 46.6 },
  HU: { west: 16.1, east: 22.9, south: 45.7, north: 48.6 },
  IT: { west: 6.6, east: 18.6, south: 36.6, north: 47.1 },
  LT: { west: 20.9, east: 26.9, south: 53.8, north: 56.5 },
  LV: { west: 20.9, east: 28.3, south: 55.6, north: 58.1 },
  NL: { west: 3.3, east: 7.3, south: 50.7, north: 53.6 },
  PL: { west: 14.1, east: 24.2, south: 49, north: 54.9 },
  RO: { west: 20.2, east: 29.7, south: 43.6, north: 48.3 },
  SI: { west: 13.3, east: 16.7, south: 45.4, north: 46.9 },
  SK: { west: 16.8, east: 22.6, south: 47.7, north: 49.7 },
  UA: { west: 22, east: 40.3, south: 44.3, north: 52.4 },
  ZA: { west: 16.4, east: 33, south: -34.9, north: -22 },
}

const ORG_DISTANCE_LIMIT_KM = 300

/** Mean of the first vertex of each geometry — cheap and good enough to place a set of fields. */
export function centreOf(geometries: (Polygon | MultiPolygon | null | undefined)[]): Centre | null {
  const points = geometries.flatMap((g) => {
    const ring = g?.type === 'Polygon' ? g.coordinates[0] : g?.coordinates[0]?.[0]
    return ring?.[0] ? [ring[0]] : []
  })
  if (!points.length) return null
  return { lon: points.reduce((s, [x]) => s + x, 0) / points.length, lat: points.reduce((s, [, y]) => s + y, 0) / points.length }
}

export function distanceKm(a: Centre, b: Centre): number {
  const rad = (d: number) => (d * Math.PI) / 180
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon - a.lon) / 2) ** 2
  return 12_742 * Math.asin(Math.sqrt(h))
}

export function liesInCountry(c: Centre | null, country: string): boolean {
  const b = COUNTRY_BOUNDS[country]
  return !!c && !!b && c.lon >= b.west && c.lon <= b.east && c.lat >= b.south && c.lat <= b.north
}

/**
 * A warning when fields at `centre` look misplaced: outside Europe (for European sources), outside
 * every expected country, or far from the organization's other fields. Countries without a known
 * extent are not judged.
 */
export function locationWarning(centre: Centre | null, ctx: { countries: string[]; orgCentre: Centre | null; europeOnly?: boolean }): LocationWarning | null {
  if (!centre) return null
  if (ctx.europeOnly && (centre.lat < 34 || centre.lat > 72 || centre.lon < -25 || centre.lon > 45)) return 'outsideEurope'
  const known = ctx.countries.filter((c) => COUNTRY_BOUNDS[c])
  if (known.length && !known.some((c) => liesInCountry(centre, c))) return 'countryMismatch'
  if (ctx.orgCentre && distanceKm(centre, ctx.orgCentre) > ORG_DISTANCE_LIMIT_KM) return 'farFromOrgFields'
  return null
}
