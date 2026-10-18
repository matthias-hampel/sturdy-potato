import type { MultiPolygon } from 'geojson'
import { useMemo } from 'react'
import { cx } from '#/ui/utils'

const SIZE = 32
const PAD = 2

/** Small north-up silhouette of a field, scaled to fit a square. Divided fields fill each part in its own colour. */
export function FieldShape({
  geometry,
  fill,
  parts,
  className,
}: {
  geometry: MultiPolygon
  fill: string
  parts?: { geometry: MultiPolygon; color: string }[]
  className?: string
}) {
  const { outline, partPaths } = useMemo(() => {
    const project = projector(geometry)
    return { outline: toPath(geometry, project), partPaths: parts?.map((p) => ({ d: toPath(p.geometry, project), color: p.color })) }
  }, [geometry, parts])

  return (
    <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className={cx('shrink-0', className)} aria-hidden>
      <path d={outline} fill={partPaths ? 'none' : fill} fillRule="evenodd" />
      {partPaths?.map((p, i) => <path key={i} d={p.d} fill={p.color} fillRule="evenodd" />)}
      <path d={outline} fill="none" fillRule="evenodd" stroke="currentColor" strokeOpacity={0.35} strokeWidth={1} strokeLinejoin="round" />
    </svg>
  )
}

/** Equirectangular projection around the field's latitude, fitted and centred in the viewBox. */
function projector(geometry: MultiPolygon) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const poly of geometry.coordinates)
    for (const [x, y] of poly[0] ?? []) {
      minX = Math.min(minX, x)
      maxX = Math.max(maxX, x)
      minY = Math.min(minY, y)
      maxY = Math.max(maxY, y)
    }
  const kx = Math.cos((((minY + maxY) / 2) * Math.PI) / 180)
  const w = (maxX - minX) * kx
  const h = maxY - minY
  const scale = (SIZE - 2 * PAD) / (Math.max(w, h) || 1)
  const ox = (SIZE - w * scale) / 2
  const oy = (SIZE - h * scale) / 2
  return ([x, y]: number[]) => [ox + (x - minX) * kx * scale, oy + (maxY - y) * scale] as const
}

function toPath(geometry: MultiPolygon, project: ReturnType<typeof projector>) {
  return geometry.coordinates
    .flatMap((poly) => poly.map((ring) => 'M' + ring.map((c) => project(c).map((v) => v.toFixed(2)).join(' ')).join('L') + 'Z'))
    .join('')
}
