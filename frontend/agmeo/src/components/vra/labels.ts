import type { BaseZoning, VraExportFormat, VraInputType, VraMapSummary, VraMapType, VraRateUnit } from '@agmeo/contracts'
import { t } from '#/i18n'
import { api } from '#/lib/api'
import { fmt } from '#/lib/format'
import { toast } from '#/ui/Toast'

export const typeLabel = (type: VraMapType) => t(`vra.type.${type}`)
export const inputLabel = (type: VraInputType) => t(`vra.type.${type}`)

/** Display label of a rate unit; the unit value itself ('seeds/ha') is data and stays. */
export function unitLabel(unit: string) {
  if (unit === 'seeds/ha') return t('vra.unit.seedsPerHa')
  if (unit === 'seeds/ac') return t('vra.unit.seedsPerAc')
  if (unit === 'plants/ha') return t('vra.unit.plantsPerHa')
  if (unit === 'plants/ac') return t('vra.unit.plantsPerAc')
  return unit
}

/** What a rate unit counts, for totals (shown translated: seeds → Körner). */
export function amountLabel(unit: VraRateUnit) {
  if (unit === 'seeds/ha') return t('vra.unit.seeds')
  if (unit === 'plants/ha') return t('vra.unit.plants')
  return unit === 'kg/ha' ? 'kg' : 'l'
}

export const EXPORT_FORMATS: { id: VraExportFormat; label: string }[] = [
  { id: 'shp', label: 'Shapefile' },
  { id: 'isoxml', label: 'ISO-XML' },
  { id: 'geojson', label: 'GeoJSON' },
]
export const exportsList = () => EXPORT_FORMATS.map((e) => ({ ...e, description: t(`vra.export.${e.id}`) }))

export const exportMap = (orgId: string, fieldId: string, mapId: string, format: VraExportFormat) =>
  api.download(`/orgs/${orgId}/fields/${fieldId}/vra-maps/${mapId}/export`, { format }).catch(() => toast.error(t('apiError.download_failed')))

/** Source of a zoning in words, e.g. "Bodenzonenkarte" or "Satellit (NDVI)". */
export function sourceLabel(source: string, params?: Record<string, unknown> | null) {
  switch (source) {
    case 'productivity':
      return t('vra.base.source.productivity')
    case 'yield_map':
      return t('vra.base.source.yield_map')
    case 'yield_estimate':
      return t('vra.base.source.yield_estimate')
    case 'soil':
      return t('vra.base.source.soil')
    case 'upload':
      return t('vra.base.source.upload')
    case 'satellite': {
      const dates = (params?.sceneDates as string[] | undefined) ?? []
      const index = String(params?.index ?? 'ndvi').toUpperCase()
      return dates.length > 1 ? `${index} · ${t('vra.base.medianOfN', { count: dates.length })}` : `${index} · ${fmt.date(dates[0])}`
    }
    case 'manual':
      return t('vra.base.source.manual')
    case 'uniform':
      return t('vra.base.source.uniform')
    default:
      return source
  }
}

/** Name of a base zoning: its own name, else source and zone count. */
export function baseLabel(z: Pick<BaseZoning, 'name' | 'source' | 'zoneCount' | 'params'>) {
  const zones = t('vra.base.zoneCount', { count: z.zoneCount })
  return z.name ? `${z.name} · ${zones}` : `${sourceLabel(z.source, z.params)} · ${zones}`
}

export function rateRange(map: VraMapSummary) {
  return map.inputs
    .map((i) => {
      const values = Object.values(i.rates)
      const [lo, hi] = [Math.min(...values), Math.max(...values)]
      const label = i.name || i.cropName || inputLabel(i.inputType)
      return `${label} ${lo === hi ? fmt.num(lo, 2) : `${fmt.num(lo, 2)}–${fmt.num(hi, 2)}`} ${unitLabel(i.unit)}`
    })
    .join(' · ')
}

/** Zone name by rank: lowest, middle, highest. */
export function zoneLevel(zoneNo: number, count: number) {
  if (count < 2) return ''
  if (zoneNo === 1) return t('zones.level.low')
  if (zoneNo === count) return t('zones.level.high')
  if (count % 2 === 1 && zoneNo === (count + 1) / 2) return t('zones.level.medium')
  return ''
}
