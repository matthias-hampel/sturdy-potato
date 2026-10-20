import type { CropCycle, Field, YieldEstimatePreview, YieldZoning } from '@agmeo/contracts'
import { useQuery } from '@tanstack/react-query'
import type { FeatureCollection } from 'geojson'
import { Satellite } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FieldMap } from '#/components/map/FieldMap'
import { api } from '#/lib/api'
import { fmt } from '#/lib/format'
import { useOrg } from '#/lib/org'
import { useOrgMutation } from '#/lib/queries'
import { Button } from '#/ui/Button'
import { NumberField, Option, Select } from '#/ui/Field'
import { Card, Notice } from '#/ui/Layout'
import { Tooltip } from '#/ui/Overlay'
import { fmtYield } from './shared'

export interface EstimateParams {
  meanYieldTHa: number | null
  /** Distribution strength, 0..1.5 (1 = proportional to relative NDVI). */
  spread: number
  sceneId: string | null
  zoneCount: number
}

export const DEFAULT_SPREAD = 1

/** Preview of the satellite yield estimate as zones; recomputed when a parameter changes. */
export function useEstimatePreview(cropCycleId: string, params: EstimateParams) {
  const { orgId } = useOrg()
  const mean = params.meanYieldTHa
  return useQuery({
    queryKey: ['org', orgId, 'yield-estimate', cropCycleId, mean, params.spread, params.sceneId, params.zoneCount],
    queryFn: () =>
      api.post<YieldEstimatePreview>(`/orgs/${orgId}/yield-maps/crop-cycles/${cropCycleId}/estimate`, {
        meanYieldTHa: mean,
        spread: params.spread,
        sceneId: params.sceneId,
        zoneCount: params.zoneCount,
      }),
    enabled: mean != null && mean > 0,
    staleTime: 10 * 60_000,
  })
}

export function estimateReason(preview: YieldEstimatePreview | undefined, t: (k: 'yield.estimate.noScene' | 'yield.estimate.notCovered' | 'yield.estimate.failed') => string) {
  if (!preview || preview.ok) return null
  if (preview.reason === 'no_scene') return t('yield.estimate.noScene')
  if (preview.reason === 'not_covered') return t('yield.estimate.notCovered')
  return t('yield.estimate.failed')
}

/** The previewed zones on the field. */
export function EstimateMap({ field, preview, loading, className = 'h-72' }: { field: Field; preview: YieldEstimatePreview | undefined; loading: boolean; className?: string }) {
  const overlay = useMemo<FeatureCollection | null>(
    () =>
      preview?.ok
        ? { type: 'FeatureCollection', features: preview.zones.map((z) => ({ type: 'Feature', geometry: JSON.parse(z.geometry), properties: { color: z.color } })) }
        : null,
    [preview],
  )
  return (
    <div className={loading ? 'opacity-60 transition-opacity' : undefined}>
      <FieldMap fields={[field]} selectedId={field.id} labels={false} fillOpacity={0} overlay={overlay} className={className} />
    </div>
  )
}

/** Estimate controls: Ø yield, distribution strength, zone count and the acquisition. */
export function EstimateControls({ params, onChange, preview }: { params: EstimateParams; onChange: (p: Partial<EstimateParams>) => void; preview: YieldEstimatePreview | undefined }) {
  const { t } = useTranslation()
  const scenes = preview?.scenes ?? []
  const active = preview?.ok ? preview.sceneId : params.sceneId
  return (
    <div className="grid sm:grid-cols-2 gap-3">
      <NumberField
        label={t('yield.estimate.mean')}
        unit={fmt.unit('yieldMass')}
        minValue={0}
        step={0.1}
        value={params.meanYieldTHa ?? Number.NaN}
        onChange={(v) => onChange({ meanYieldTHa: Number.isNaN(v) ? null : v })}
      />
      <Select
        label={t('yield.estimate.scene')}
        items={scenes.map((s) => ({ id: s.id, name: `${fmt.date(s.date)} · ${fmt.num(s.validPixelPct)} % ${t('yield.estimate.clear')}` }))}
        value={active ?? null}
        onChange={(v) => v && onChange({ sceneId: String(v) })}
        isDisabled={!scenes.length}
        placeholder={t('yield.estimate.sceneAuto')}
      >
        {(o) => <Option id={o.id}>{o.name}</Option>}
      </Select>
      <NumberField
        label={
          <span className="inline-flex items-center gap-1">
            {t('yield.estimate.spread')}
            <Tooltip content={<span className="block max-w-80">{t('yield.estimate.spreadInfo')}</span>}>
              <span tabIndex={0} className="cursor-help text-muted">ⓘ</span>
            </Tooltip>
          </span>
        }
        description={t('yield.estimate.spreadHint')}
        unit="%"
        minValue={0}
        maxValue={150}
        step={5}
        value={Math.round(params.spread * 100)}
        onChange={(v) => onChange({ spread: Number.isNaN(v) ? DEFAULT_SPREAD : v / 100 })}
      />
      <NumberField label={t('yield.zones.count')} minValue={2} maxValue={7} value={params.zoneCount} onChange={(v) => !Number.isNaN(v) && onChange({ zoneCount: v })} />
    </div>
  )
}

export function EstimateZoneChips({ preview }: { preview: YieldEstimatePreview | undefined }) {
  if (!preview?.ok) return null
  return (
    <div className="flex flex-wrap gap-1.5">
      {preview.zones.map((z) => (
        <span key={z.zoneNo} className="inline-flex items-center gap-1.5 rounded-full border border-line px-2 py-0.5 text-xs">
          <span className="size-2.5 rounded-full" style={{ background: z.color }} aria-hidden />
          {fmtYield(z.meanTHa)}
          <span className="text-muted">{fmt.ha(z.areaHa, 1)}</span>
        </span>
      ))}
    </div>
  )
}

/**
 * Harvest yield estimate for a crop cycle without a monitor map (the soil-map principle): the
 * best clear NDVI acquisition before the harvest distributes the documented mean yield. The
 * result is saved as yield zones, never as monitor data.
 */
export function YieldEstimatePanel({ cycle, field, documentedYieldTHa }: { cycle: CropCycle; field: Field; documentedYieldTHa: number | null }) {
  const { t } = useTranslation()
  const [params, setParams] = useState<EstimateParams>({ meanYieldTHa: documentedYieldTHa, spread: DEFAULT_SPREAD, sceneId: null, zoneCount: 5 })
  const preview = useEstimatePreview(cycle.id, params)
  const save = useOrgMutation(
    (p) =>
      api.post<YieldZoning>(`${p}/yield-maps/crop-cycles/${cycle.id}/zonings`, {
        source: 'yield_estimate',
        estimate: { meanYieldTHa: params.meanYieldTHa, spread: params.spread, sceneId: preview.data?.ok ? preview.data.sceneId : params.sceneId, zoneCount: params.zoneCount },
      }),
    { success: t('yield.zones.saved') },
  )
  const reason = estimateReason(preview.data, t)
  return (
    <Card title={<span className="inline-flex items-center gap-2"><Satellite className="size-4" aria-hidden /> {t('yield.estimate.title')}</span>} description={t('yield.estimate.description')}>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-3">
          <EstimateControls params={params} onChange={(p) => setParams((prev) => ({ ...prev, ...p }))} preview={preview.data} />
          {params.meanYieldTHa == null && <Notice>{t('yield.estimate.needMean')}</Notice>}
          {reason && <Notice tone="warning">{reason}</Notice>}
          {preview.error && <Notice tone="danger">{t('yield.estimate.failed')}</Notice>}
          <EstimateZoneChips preview={preview.data} />
          <Button variant="primary" isDisabled={!preview.data?.ok || preview.isFetching} isPending={save.isPending} onPress={() => save.mutate(undefined)}>
            {t('yield.estimate.save')}
          </Button>
        </div>
        <EstimateMap field={field} preview={preview.data} loading={preview.isFetching} />
      </div>
    </Card>
  )
}
