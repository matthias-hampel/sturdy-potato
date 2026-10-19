import type { DmcHarvestStatus } from '@agmeo/contracts'
import { fmt } from '#/lib/format'

/** A DM fraction (0.33) as "33.0 %". */
export const dmPct = (v: number | null | undefined, digits = 1) => (v == null ? '—' : fmt.pct(v * 100, digits))

/** An offset fraction as signed DM percentage points: -0.021 → "−2.1". */
export const offsetPts = (v: number | null | undefined) => (v == null ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${fmt.fixed(Math.abs(v) * 100, 1)}`)

/** Map colour by DM: early (grey-green) → harvest window (green) → overripe (orange). */
export function dmColor(dm: number | null | undefined): string | null {
  if (dm == null) return null
  if (dm < 0.25) return '#b9c7a4'
  if (dm < 0.28) return '#d9d36a'
  if (dm < 0.3) return '#f2c94c'
  if (dm <= 0.35) return '#4dc709'
  return '#e8833a'
}

export const HARVEST_TONE: Record<DmcHarvestStatus, 'neutral' | 'warning' | 'success'> = {
  not_harvested: 'neutral',
  possibly_harvested: 'warning',
  harvested: 'success',
}
