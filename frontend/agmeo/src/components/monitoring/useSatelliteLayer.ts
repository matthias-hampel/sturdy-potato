import type { Field, ImageryDate, ImageryLayer, ImageryStatus, ImageryStretch } from '@agmeo/contracts'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useOrg } from '#/lib/org'
import { useOrgQuery } from '#/lib/queries'
import type { Opacity } from './MapControls'
import { boundaryVersion, imageryTiles } from './indices'

const busy = (s?: ImageryStatus) => s?.state === 'running' || s?.state === 'queued'

/**
 * State of the satellite imagery layer: acquisition dates with field imagery (of one field,
 * or of all the organization's fields), the chosen date, opacity, backfill progress, and the
 * raster definition for FieldMap.
 */
export function useSatelliteLayer({
  enabled,
  layer,
  stretch,
  fieldId,
  fields,
  date: controlled,
  onDate,
}: {
  enabled: boolean
  layer: ImageryLayer
  stretch: ImageryStretch
  fieldId?: string | null
  fields: Field[]
  /** Optional controlled date (e.g. from the URL). */
  date?: string | null
  onDate?: (date: string) => void
}) {
  const { orgId } = useOrg()
  const { t } = useTranslation()
  const [internal, setInternal] = useState<string | null>(null)
  const chosen = controlled !== undefined ? controlled : internal
  const setDate = onDate ?? setInternal
  const [opacity, setOpacity] = useState<Opacity>('1')
  // While the history is being backfilled, progress and new dates are polled.
  const status = useOrgQuery<ImageryStatus>('/monitoring/imagery/status', { fieldId: fieldId ?? undefined }, { enabled, refetchInterval: (s) => (busy(s) ? 5_000 : false) })
  const dates = useOrgQuery<ImageryDate[]>('/monitoring/imagery/dates', { fieldId: fieldId ?? undefined }, { enabled, refetchInterval: busy(status.data) ? 20_000 : false })
  const list = dates.data ?? []
  const date = list.find((d) => d.date === chosen) ?? list.find((d) => d.valid) ?? list[0] ?? null

  const version = useMemo(() => boundaryVersion(fields.map((f) => f.geometryVersionId)), [fields])
  const raster =
    enabled && date && (layer !== 'rgb' || date.hasRgb)
      ? {
          tiles: imageryTiles(orgId, date.date, layer, { stretch, fieldId, version }),
          opacity: Number(opacity),
          attribution: t('monitoring.attribution', { year: date.date.slice(0, 4) }),
        }
      : null

  return { dates: list, isLoading: dates.isLoading, date, setDate, opacity, setOpacity, raster, status: status.data ?? null }
}
