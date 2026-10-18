import {
  BASE_UNIT_LABELS,
  COST_CATEGORY_LABELS,
  EQUIPMENT_KIND_LABELS,
  OPERATION_TYPE_LABELS,
  PRODUCT_CATEGORY_LABELS,
  ROLE_LABELS,
  type CropRole,
  type TemplateAnchor,
} from '@agmeo/contracts'
import { t } from './index'

/**
 * Translated enum labels. The contracts keep English labels (API, exports); the UI shows
 * `enum.<kind>.<value>`. `label(value)` for one value, `label.all()` for a select's items.
 */
function translated<K extends string>(kind: string, english: Record<K, string>) {
  const label = (value: K) => t(`enum.${kind}.${value}`, { defaultValue: english[value] ?? value })
  const all = () => Object.fromEntries((Object.keys(english) as K[]).map((k) => [k, label(k)])) as Record<K, string>
  return Object.assign(label, { all })
}

export const roleLabel = translated('role', ROLE_LABELS)
export const operationTypeLabel = translated('operationType', OPERATION_TYPE_LABELS)
export const costCategoryLabel = translated('costCategory', COST_CATEGORY_LABELS)
export const productCategoryLabel = translated('productCategory', PRODUCT_CATEGORY_LABELS)
export const baseUnitLabel = translated('baseUnit', BASE_UNIT_LABELS)
export const equipmentKindLabel = translated('equipmentKind', EQUIPMENT_KIND_LABELS)

// The contracts have no English labels for these yet.
const CROP_ROLE_LABELS: Record<CropRole, string> = { main: 'Main crop', catch_crop: 'Catch crop', undersown: 'Undersown crop' }
const TEMPLATE_ANCHOR_LABELS: Record<TemplateAnchor, string> = { sowing: 'Sowing', harvest: 'Harvest', season_start: 'Season start' }
export const cropRoleLabel = translated('cropRole', CROP_ROLE_LABELS)
export const templateAnchorLabel = translated('templateAnchor', TEMPLATE_ANCHOR_LABELS)
