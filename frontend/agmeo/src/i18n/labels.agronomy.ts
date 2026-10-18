import { SOIL_TEXTURE_LABELS, SOIL_TEXTURES, type NeedSource, type SoilTexture } from '@agmeo/contracts'
import { t } from './index'

/**
 * Translated enum labels for soil and fertilizer planning, as in `labels.ts`: the UI shows
 * `enum.<kind>.<value>` and falls back to the English contract label.
 */
function translated<K extends string>(kind: string, english: Record<K, string>) {
  const label = (value: K) => t(`enum.${kind}.${value}`, { defaultValue: english[value] ?? value })
  const all = () => Object.fromEntries((Object.keys(english) as K[]).map((k) => [k, label(k)])) as Record<K, string>
  return Object.assign(label, { all })
}

// The contracts have no English labels for these yet.
const NEED_SOURCE_LABELS: Record<NeedSource, string> = {
  sample: 'Sample',
  reference: 'Reference value',
  entered: 'Entered',
  derived: 'Derived',
  default: 'Estimate',
}

export const soilTextureLabel = translated('soilTexture', SOIL_TEXTURE_LABELS)
export const needSourceLabel = translated('needSource', NEED_SOURCE_LABELS)

/** Soil textures for a select, light to heavy: "Lehmiger Sand (lS)". */
export const soilTextureItems = () => SOIL_TEXTURES.map((id: SoilTexture) => ({ id, name: `${soilTextureLabel(id)} (${id})` }))
