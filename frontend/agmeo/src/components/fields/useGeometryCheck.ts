import type { GeometryValidation } from '@agmeo/contracts'
import type { MultiPolygon, Polygon } from 'geojson'
import { useEffect, useState } from 'react'
import { api } from '#/lib/api'
import { useOrg } from '#/lib/org'

/** Server-side geometry validation (validity, PostGIS area, overlaps), debounced. */
export function useGeometryCheck(geometry: Polygon | MultiPolygon | null, excludeFieldId?: string) {
  const { orgId } = useOrg()
  const [result, setResult] = useState<GeometryValidation | null>(null)
  const [checking, setChecking] = useState(false)
  useEffect(() => {
    if (!geometry) {
      setResult(null)
      return
    }
    let cancelled = false
    setChecking(true)
    const t = setTimeout(() => {
      api
        .post<GeometryValidation>(`/orgs/${orgId}/fields/validate-geometry`, { geometry, excludeFieldId })
        .then((r) => !cancelled && setResult(r))
        .catch(() => !cancelled && setResult(null))
        .finally(() => !cancelled && setChecking(false))
    }, 350)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [geometry, orgId, excludeFieldId])
  return { result, checking }
}
