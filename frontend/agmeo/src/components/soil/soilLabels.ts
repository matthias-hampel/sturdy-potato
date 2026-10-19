import { SOIL_PARAM_META, type SoilParameter, type SoilZonationMethod } from '@agmeo/contracts'
import { t } from '#/i18n'
import { fmt } from '#/lib/format'

export const paramLabel = (p: SoilParameter) => t(`soil.col.${p}`)

export const paramUnit = (p: SoilParameter) => SOIL_PARAM_META[p].unit

/** A value with the parameter's display precision. */
export const paramValue = (p: SoilParameter, v: number | null | undefined) => fmt.num(v, SOIL_PARAM_META[p].decimals)

export const methodLabel = (m: SoilZonationMethod | string) => t(`soil.zonationMethod.${m}`, { defaultValue: m })

export const sourceLabel = (s: string) => t(`soil.zonationSource.${s}`, { defaultValue: s })

const STATUS_CODES = ['no_imagery', 'no_productivity', 'no_values', 'no_zones', 'grid_mismatch', 'error'] as const

/** Why a zonation run failed. */
export function statusText(code: string | null | undefined) {
  const known = STATUS_CODES.find((c) => c === code) ?? 'error'
  return t(`soil.status.${known}`)
}

export const STAGE_COLORS: Record<string, string> = { A: '#dc2626', B: '#f97316', C: '#22c55e', D: '#3b82f6', E: '#8b5cf6' }
export const NO_DATA_COLOR = '#d1d5db'
