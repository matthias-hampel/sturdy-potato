import { INDEX_SCALES, RELATIVE_SCALE, type ImageryLayer, type ImageryStretch } from '@agmeo/contracts'
import { t } from '#/i18n'

export type ShownIndex = keyof typeof INDEX_SCALES

/**
 * What each index shows; chart domains are wide enough for typical arable values. The
 * description is translated when read, so `INDEX_INFO[index].description` follows the language.
 */
const info = (index: ShownIndex, domain: [number, number]) => ({
  label: index.toUpperCase(),
  get description() {
    return t(`monitoring.index.${index}.description`)
  },
  domain,
})

export const INDEX_INFO: Record<ShownIndex, { readonly label: string; readonly description: string; domain: [number, number] }> = {
  ndvi: info('ndvi', [0, 1]),
  ndre: info('ndre', [0, 0.6]),
  ndmi: info('ndmi', [-0.2, 0.6]),
}

/** Translated `INDEX_INFO` entry. */
export const indexInfo = (index: ShownIndex) => INDEX_INFO[index]

/** Fields without a valid observation: neutral grey, outside every index ramp. */
export const NO_DATA_COLOR = '#a7aaa1'

/** Colour of a value on the index's display scale (same ramp as the imagery tiles). */
export function indexColor(index: ShownIndex, value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return NO_DATA_COLOR
  const { min, max, stops } = INDEX_SCALES[index]
  const t = Math.min(1, Math.max(0, (value - min) / (max - min)))
  const pos = t * (stops.length - 1)
  const i = Math.min(stops.length - 2, Math.floor(pos))
  const f = pos - i
  const rgb = (hex: string) => [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16))
  const [a, b] = [rgb(stops[i]), rgb(stops[i + 1])]
  return `#${[0, 1, 2].map((k) => Math.round(a[k] + (b[k] - a[k]) * f).toString(16).padStart(2, '0')).join('')}`
}

export const gradient = (index: ShownIndex) => `linear-gradient(to right, ${INDEX_SCALES[index].stops.join(', ')})`

export const relativeGradient = `linear-gradient(to right, ${RELATIVE_SCALE.stops.join(', ')})`

export const LAYERS: ImageryLayer[] = ['ndvi', 'ndre', 'ndmi', 'rgb']
export const layerLabel = (layer: ImageryLayer) => (layer === 'rgb' ? t('monitoring.layer.rgb') : layer.toUpperCase())

/** Translated short description of an index's display scale (`INDEX_SCALES[index].description`). */
export const scaleDescription = (index: ShownIndex) => t(`monitoring.scale.${index}.description`)

/** Tile URL template for the field imagery of one acquisition date. */
export function imageryTiles(
  orgId: string,
  date: string,
  layer: ImageryLayer,
  { stretch, fieldId, version }: { stretch: ImageryStretch; fieldId?: string | null; version: string },
) {
  const query = new URLSearchParams({ v: version })
  if (layer !== 'rgb' && stretch === 'relative') query.set('stretch', 'relative')
  if (fieldId) query.set('fieldId', fieldId)
  return `${window.location.origin}/api/v1/orgs/${orgId}/monitoring/imagery/${date}/${layer}/{z}/{x}/{y}.png?${query}`
}

/** Changes whenever a field boundary changes, so cached clipped tiles are not reused. */
export function boundaryVersion(geometryVersionIds: string[]): string {
  let hash = 0
  for (const id of [...geometryVersionIds].sort()) for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0
  return (hash >>> 0).toString(36)
}
