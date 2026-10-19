import { FERTILIZER_TYPE_LABELS, type ApplicationTechnique, type NutrientRates, type PsmUsageType } from '@agmeo/contracts'
import { t } from './index'

/**
 * Translated enum labels for field work records, as in `labels.ts`: the UI shows
 * `enum.<kind>.<value>` and falls back to the English contract label.
 */
function translated<K extends string>(kind: string, english: Record<K, string>) {
  const label = (value: K) => t(`enum.${kind}.${value}`, { defaultValue: english[value] ?? value })
  const all = () => Object.fromEntries((Object.keys(english) as K[]).map((k) => [k, label(k)])) as Record<K, string>
  return Object.assign(label, { all })
}

// The contracts have no English labels for these yet.
const APPLICATION_TECHNIQUE_LABELS: Record<ApplicationTechnique, string> = {
  broadcast: 'Broadcast',
  trailing_hose: 'Trailing hose',
  trailing_shoe: 'Trailing shoe',
  injection: 'Injection',
  other: 'Other',
}

const PSM_USAGE_TYPE_LABELS: Record<PsmUsageType, string> = {
  open_field: 'Open field',
  greenhouse: 'Greenhouse',
  storage: 'Stored products',
  public_area: 'Public area',
  seed_treatment: 'Seed treatment',
  planting_material: 'Planting material',
}

export const fertilizerTypeLabel = translated('fertilizerType', FERTILIZER_TYPE_LABELS)
export const applicationTechniqueLabel = translated('applicationTechnique', APPLICATION_TECHNIQUE_LABELS)
export const psmUsageTypeLabel = translated('psmUsageType', PSM_USAGE_TYPE_LABELS)

/** Chemical symbols of the nutrients in `NutrientRates`, in display order. */
export const NUTRIENT_LABELS: Record<keyof NutrientRates, string> = { n: 'N', nh4N: 'NH₄-N', p2o5: 'P₂O₅', k2o: 'K₂O', mgo: 'MgO', s: 'S', cao: 'CaO' }
