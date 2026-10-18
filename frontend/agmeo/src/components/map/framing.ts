import type { Field } from '@agmeo/contracts'
import bbox from '@turf/bbox'

export type Bounds = [number, number, number, number]

/** Fields spread wider than this aren't framed together: the map opens on their largest group instead. */
const MAX_EXTENT_KM = 25
/** Fields whose centres are closer than this belong to the same group. */
const GROUP_GAP_KM = 3
/** The default framing never zooms out further than this (a group can still be wide). */
export const MIN_FIT_ZOOM = 10

/**
 * Default extent for a set of fields: all of them while they lie close together, otherwise the
 * group with the largest area (e.g. one farm of an organization with farms far apart).
 */
export function frameBounds(fields: Pick<Field, 'geometry' | 'areaHa'>[]): Bounds | undefined {
  if (!fields.length) return undefined
  const boxes = fields.map((f) => {
    const [w, s, e, n] = bbox(f.geometry)
    return [w, s, e, n] as Bounds
  })
  const all = union(boxes)
  const lat0 = (((all[1] + all[3]) / 2) * Math.PI) / 180
  const kx = 111.32 * Math.cos(lat0)
  const ky = 110.57
  if (Math.hypot((all[2] - all[0]) * kx, (all[3] - all[1]) * ky) <= MAX_EXTENT_KM) return all

  // Single-linkage grouping of the field centres, looked up through a grid of GROUP_GAP_KM cells.
  const centres = boxes.map((b) => [((b[0] + b[2]) / 2) * kx, ((b[1] + b[3]) / 2) * ky])
  const parent = centres.map((_, i) => i)
  const find = (i: number): number => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]]
    return i
  }
  const cells = new Map<string, number[]>()
  centres.forEach(([x, y], i) => {
    const cx = Math.floor(x / GROUP_GAP_KM)
    const cy = Math.floor(y / GROUP_GAP_KM)
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (const j of cells.get(`${cx + dx},${cy + dy}`) ?? []) {
          if (Math.hypot(x - centres[j][0], y - centres[j][1]) <= GROUP_GAP_KM) parent[find(i)] = find(j)
        }
    const key = `${cx},${cy}`
    cells.set(key, [...(cells.get(key) ?? []), i])
  })

  const area = new Map<number, number>()
  fields.forEach((f, i) => area.set(find(i), (area.get(find(i)) ?? 0) + f.areaHa))
  const largest = [...area].reduce((best, g) => (g[1] > best[1] ? g : best))[0]
  return union(boxes.filter((_, i) => find(i) === largest))
}

function union(boxes: Bounds[]): Bounds {
  return boxes.reduce((a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])])
}
