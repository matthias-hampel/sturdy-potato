import type { Position } from 'geojson'

const etrs = (lon0: number, x0: number) => `+proj=tmerc +lat_0=0 +lon_0=${lon0} +k=0.9996 +x_0=${x0} +y_0=0 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs`
const gk = (zone: number) =>
  `+proj=tmerc +lat_0=0 +lon_0=${zone * 3} +k=1 +x_0=${zone * 1_000_000 + 500_000} +y_0=0 +ellps=bessel +towgs84=598.1,73.7,418.2,0.202,0.045,-2.455,6.7 +units=m +no_defs`

/** Reference systems German farm data comes in, as proj4 definitions (WGS 84 needs none). */
export const CRS_OPTIONS = [
  { id: 'EPSG:4326', label: 'WGS 84 (EPSG:4326)', proj: null },
  { id: 'EPSG:25832', label: 'ETRS89 / UTM 32N (EPSG:25832)', proj: etrs(9, 500_000) },
  { id: 'EPSG:25833', label: 'ETRS89 / UTM 33N (EPSG:25833)', proj: etrs(15, 500_000) },
  { id: 'EPSG:4647', label: 'ETRS89 / UTM 32N, zE-N (EPSG:4647)', proj: etrs(9, 32_500_000) },
  { id: 'EPSG:5650', label: 'ETRS89 / UTM 33N, zE-N (EPSG:5650)', proj: etrs(15, 33_500_000) },
  { id: 'EPSG:31466', label: 'DHDN / Gauß-Krüger 2 (EPSG:31466)', proj: gk(2) },
  { id: 'EPSG:31467', label: 'DHDN / Gauß-Krüger 3 (EPSG:31467)', proj: gk(3) },
  { id: 'EPSG:31468', label: 'DHDN / Gauß-Krüger 4 (EPSG:31468)', proj: gk(4) },
  { id: 'EPSG:31469', label: 'DHDN / Gauß-Krüger 5 (EPSG:31469)', proj: gk(5) },
] as const

export type CrsId = (typeof CRS_OPTIONS)[number]['id']

export const crsProj = (id: CrsId) => CRS_OPTIONS.find((c) => c.id === id)!.proj

/**
 * Guesses the reference system of a file without a .prj from one coordinate. UTM without a zone
 * prefix is ambiguous between zone 32 and 33, so that guess is marked uncertain.
 */
export function guessCrs([x, y]: Position): { id: CrsId; certain: boolean } | null {
  if (Math.abs(x) <= 180 && Math.abs(y) <= 90) return { id: 'EPSG:4326', certain: true }
  if (y < 5_000_000 || y > 6_300_000) return null
  if (x >= 32_000_000 && x < 33_000_000) return { id: 'EPSG:4647', certain: true }
  if (x >= 33_000_000 && x < 34_000_000) return { id: 'EPSG:5650', certain: true }
  if (x >= 2_000_000 && x < 6_000_000) return { id: `EPSG:3146${Math.floor(x / 1_000_000) + 4}` as CrsId, certain: true }
  if (x > 0 && x < 1_000_000) return { id: 'EPSG:25832', certain: false }
  return null
}
