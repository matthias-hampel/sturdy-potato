import type { ConditionDay, ConditionLevel, CropCycle, CropTableConditions, CropTableConditionsRow, CropTableEvaluation, CropTableEvaluationRow } from '@agmeo/contracts'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { TFunction } from 'i18next'
import { AlertTriangle, Pencil } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Button as AriaButton, Dialog as AriaDialog, DialogTrigger, Form, Popover } from 'react-aria-components'
import { useTranslation } from 'react-i18next'
import { MiniConditionBar } from '#/components/fields/ConditionsTab'
import type { ColumnDef } from '#/components/table/tableTools'
import { api } from '#/lib/api'
import { fmt, today } from '#/lib/format'
import { useOrg } from '#/lib/org'
import { useOrgMutation } from '#/lib/queries'
import { Button, buttonClass } from '#/ui/Button'
import { NumberField } from '#/ui/Field'
import { Skeleton } from '#/ui/Layout'
import { cx } from '#/ui/utils'

/**
 * The crop table's weather, phenology, satellite and economic columns (the reference's field
 * list, fields/[year]/columns.tsx). Their values come from two batch requests per season, made
 * only while one of their columns is shown.
 */

export const METRIC_GROUPS = ['development', 'weather', 'satellite', 'economics'] as const
export type MetricGroup = (typeof METRIC_GROUPS)[number]

const CONDITION_COLUMNS = ['precipSeason', 'gdd', 'bbch', 'weatherRisk', 'trafficability', 'sowingWindow', 'sprayingWindow', 'diseaseRisk', 'precipLast24h', 'precipLast7d', 'precipNext24h', 'precipNext7d', 'ndvi', 'lai'] as const
const EVALUATION_COLUMNS = ['yield', 'yieldMap', 'margin', 'co2e', 'nitrogen'] as const

export const METRIC_COLUMN_GROUP: Record<string, MetricGroup> = {
  precipSeason: 'development',
  gdd: 'development',
  bbch: 'development',
  weatherRisk: 'weather',
  trafficability: 'weather',
  sowingWindow: 'weather',
  sprayingWindow: 'weather',
  diseaseRisk: 'weather',
  precipLast24h: 'weather',
  precipLast7d: 'weather',
  precipNext24h: 'weather',
  precipNext7d: 'weather',
  ndvi: 'satellite',
  lai: 'satellite',
  yield: 'economics',
  yieldMap: 'economics',
  margin: 'economics',
  co2e: 'economics',
  nitrogen: 'economics',
}

const STALE = 5 * 60_000

/** Key prefix of the batch queries; refetched explicitly after edits that change them. */
export const cropTableKey = (orgId: string) => ['crop-table', orgId] as const

/** The batch values of the season's crops, by crop cycle id; each request only while one of its columns shows. */
export function useCropTableMetrics(seasonId: string | null, visible: (id: string) => boolean) {
  const { orgId } = useOrg()
  const needConditions = !!seasonId && CONDITION_COLUMNS.some(visible)
  const needEvaluation = !!seasonId && EVALUATION_COLUMNS.some(visible)
  const conditions = useQuery({
    queryKey: [...cropTableKey(orgId), 'conditions', seasonId],
    queryFn: () => api.get<CropTableConditions>(`/orgs/${orgId}/crop-table/conditions`, { seasonId }),
    enabled: needConditions,
    staleTime: STALE,
  })
  const evaluation = useQuery({
    queryKey: [...cropTableKey(orgId), 'evaluation', seasonId],
    queryFn: () => api.get<CropTableEvaluation>(`/orgs/${orgId}/crop-table/evaluation`, { seasonId }),
    enabled: needEvaluation,
    staleTime: STALE,
  })
  return {
    conditions: new Map((conditions.data?.rows ?? []).map((r) => [r.cropCycleId, r])),
    evaluation: new Map((evaluation.data?.rows ?? []).map((r) => [r.cropCycleId, r])),
    currency: evaluation.data?.currency ?? 'EUR',
    conditionsLoading: conditions.isLoading,
    evaluationLoading: evaluation.isLoading,
    refreshedAt: conditions.data?.refreshedAt ?? null,
  }
}

export type CropTableMetrics = ReturnType<typeof useCropTableMetrics>

const dash = <span className="text-muted">—</span>
const pending = <Skeleton className="h-4 w-14" />

/** Today's level of a bar (the disease bar ends at its last simulated day). */
const levelNow = (days: ConditionDay[] | null | undefined, trailing = false): ConditionLevel | null => {
  if (!days?.length) return null
  if (trailing) return days[days.length - 1].value
  return (days.find((d) => d.date >= today()) ?? days[0]).value
}

/** A satellite value older than two weeks is flagged, as in the reference. */
function SatelliteValue({ v }: { v: { value: number; observedOn: string } | null }) {
  const { t } = useTranslation()
  if (!v) return dash
  const old = Date.now() - Date.parse(`${v.observedOn}T12:00:00`) > 14 * 86_400_000
  return (
    <span className="inline-flex flex-col items-end leading-tight">
      <span className="tabular inline-flex items-center gap-1">
        {old && <AlertTriangle className="size-3.5 text-warning" aria-label={t('cropTable.satellite.old')} />}
        {fmt.fixed(v.value, 2)}
      </span>
      <span className="text-xs text-muted tabular">{fmt.shortDate(v.observedOn)}</span>
    </span>
  )
}

/**
 * Column definitions of the batch values. `cycleOf` names the crop a row's values belong to
 * (its main crop); `yieldCell` renders the yield column of a crop without a documented harvest
 * (the expected yield, editable while the table is edited).
 */
export function metricColumns<R>(
  t: TFunction,
  m: CropTableMetrics,
  cycleOf: (r: R) => CropCycle | undefined,
  opts: { canObserveBbch: boolean; yieldCell: (r: R, cycle: CropCycle) => ReactNode },
): ColumnDef<R>[] {
  const c = (r: R): CropTableConditionsRow | undefined => {
    const cy = cycleOf(r)
    return cy ? m.conditions.get(cy.id) : undefined
  }
  const e = (r: R): CropTableEvaluationRow | undefined => {
    const cy = cycleOf(r)
    return cy ? m.evaluation.get(cy.id) : undefined
  }
  const cond = (r: R, render: (row: CropTableConditionsRow) => ReactNode) => {
    if (!cycleOf(r)) return dash
    if (m.conditionsLoading) return pending
    const row = c(r)
    return row ? render(row) : dash
  }
  const evalCell = (r: R, render: (row: CropTableEvaluationRow) => ReactNode) => {
    if (!cycleOf(r)) return dash
    if (m.evaluationLoading) return pending
    const row = e(r)
    return row ? render(row) : dash
  }
  const mm = (v: number | null) => (v == null ? dash : <span className="tabular">{fmt.measure(v, 'precipDepth', { digits: 1 })}</span>)
  const precip = (id: string, label: string, key: keyof CropTableConditionsRow['precipitation']): ColumnDef<R> => ({
    id,
    label,
    align: 'end',
    filter: 'number',
    value: (r) => c(r)?.precipitation[key],
    text: (r) => fmt.measure(c(r)?.precipitation[key], 'precipDepth', { digits: 1 }),
    render: (r) => cond(r, (row) => mm(row.precipitation[key])),
  })
  const levelText = (v: ConditionLevel | null) => (v == null ? null : t(`conditions.level.${v}`))
  const bar = (id: string, label: string, key: keyof CropTableConditionsRow['bars'], trailing = false): ColumnDef<R> => ({
    id,
    label,
    filter: 'select',
    // Sorted and filtered by today's level.
    value: (r) => levelNow(c(r)?.bars[key], trailing),
    text: (r) => levelText(levelNow(c(r)?.bars[key], trailing)),
    render: (r) => cond(r, (row) => <MiniConditionBar days={row.bars[key]} label={label} />),
  })
  return [
    precip('precipSeason', t('cropTable.col.precipSeason'), 'seasonMm'),
    {
      id: 'gdd',
      label: t('cropTable.col.gdd'),
      align: 'end',
      filter: 'number',
      value: (r) => c(r)?.gdd,
      text: (r) => fmt.measure(c(r)?.gdd, 'gdd'),
      render: (r) => cond(r, (row) => (row.gdd == null ? dash : <span className="tabular">{fmt.measure(row.gdd, 'gdd')}</span>)),
    },
    {
      id: 'bbch',
      label: t('cropTable.col.bbch'),
      align: 'end',
      filter: 'number',
      value: (r) => c(r)?.bbch,
      render: (r) => cond(r, (row) => <BbchCell row={row} canObserve={opts.canObserveBbch} />),
    },
    bar('weatherRisk', t('cropTable.col.weatherRisk'), 'weatherRisk'),
    bar('trafficability', t('cropTable.col.trafficability'), 'trafficability'),
    bar('sowingWindow', t('cropTable.col.sowingWindow'), 'sowing'),
    bar('sprayingWindow', t('cropTable.col.sprayingWindow'), 'spraying'),
    bar('diseaseRisk', t('cropTable.col.diseaseRisk'), 'disease', true),
    precip('precipLast24h', t('cropTable.col.precipLast24h'), 'last24hMm'),
    precip('precipLast7d', t('cropTable.col.precipLast7d'), 'last7dMm'),
    precip('precipNext24h', t('cropTable.col.precipNext24h'), 'next24hMm'),
    precip('precipNext7d', t('cropTable.col.precipNext7d'), 'next7dMm'),
    {
      id: 'ndvi',
      label: t('cropTable.col.ndvi'),
      align: 'end',
      filter: 'number',
      value: (r) => c(r)?.ndvi?.value,
      render: (r) => cond(r, (row) => <SatelliteValue v={row.ndvi} />),
    },
    {
      id: 'lai',
      label: t('cropTable.col.lai'),
      align: 'end',
      filter: 'number',
      value: (r) => c(r)?.lai?.value,
      render: (r) => cond(r, (row) => <SatelliteValue v={row.lai} />),
    },
    {
      id: 'yield',
      label: t('cropTable.col.yield'),
      align: 'end',
      filter: 'number',
      // Documented harvest, else the expectation.
      value: (r) => e(r)?.documentedYieldTHa ?? cycleOf(r)?.expectedYieldTHa,
      text: (r) => fmt.measure(e(r)?.documentedYieldTHa ?? cycleOf(r)?.expectedYieldTHa, 'yieldMass'),
      render: (r) => {
        const cy = cycleOf(r)
        if (!cy) return dash
        const documented = e(r)?.documentedYieldTHa
        if (documented != null) {
          return (
            <span className="tabular font-medium text-success" title={t('cropTable.yield.documented')}>
              {fmt.measure(documented, 'yieldMass')}
            </span>
          )
        }
        return opts.yieldCell(r, cy)
      },
    },
    {
      id: 'yieldMap',
      label: t('cropTable.col.yieldMap'),
      align: 'end',
      filter: 'number',
      value: (r) => e(r)?.yieldMapTHa,
      render: (r) => evalCell(r, (row) => (row.yieldMapTHa == null ? dash : <span className="tabular">{fmt.measure(row.yieldMapTHa, 'yieldMass')}</span>)),
    },
    {
      id: 'margin',
      label: t('cropTable.col.margin'),
      align: 'end',
      filter: 'number',
      value: (r) => e(r)?.db2PerHa,
      render: (r) =>
        evalCell(r, (row) =>
          row.db2PerHa == null ? (
            dash
          ) : (
            <span className={cx('tabular', row.db2PerHa < 0 && 'text-danger')} title={t(`cropTable.margin.basis.${row.revenueBasis}`)}>
              {fmt.money(row.db2PerHa, m.currency)}/ha
            </span>
          ),
        ),
    },
    {
      id: 'co2e',
      label: t('cropTable.col.co2e'),
      align: 'end',
      filter: 'number',
      value: (r) => e(r)?.co2ePerHa,
      render: (r) => evalCell(r, (row) => (row.co2ePerHa == null ? dash : <span className="tabular">{t('cropTable.co2eValue', { value: fmt.num(row.co2ePerHa) })}</span>)),
    },
    {
      id: 'nitrogen',
      label: t('cropTable.col.nitrogen'),
      align: 'end',
      filter: 'number',
      value: (r) => e(r)?.nAppliedKgHa,
      render: (r) =>
        evalCell(r, (row) =>
          row.nAppliedKgHa == null && row.nNeedKgHa == null ? (
            dash
          ) : (
            <span className="inline-flex flex-col items-end leading-tight">
              <span className="tabular">{fmt.measure(row.nAppliedKgHa ?? 0, 'massRate')}</span>
              {row.nNeedKgHa != null && <span className="text-xs text-muted tabular">{t('cropTable.nitrogen.need', { value: fmt.num(row.nNeedKgHa) })}</span>}
            </span>
          ),
        ),
    },
  ]
}

/** Today's BBCH; where the model takes observations, the stage seen on the field can be entered. */
function BbchCell({ row, canObserve }: { row: CropTableConditionsRow; canObserve: boolean }) {
  const { t } = useTranslation()
  const value = row.bbch == null ? dash : (
    <span className={cx('tabular', row.bbchSource === 'calendar' && 'text-muted')} title={row.bbchCalibrated ? t('cropTable.bbch.calibrated') : t(`cropTable.bbch.source.${row.bbchSource}`)}>
      {row.bbch}
      {row.bbchCalibrated && <span className="ml-0.5 align-super text-[0.6rem] text-primary" aria-hidden>●</span>}
    </span>
  )
  if (!canObserve || !row.bbchCalibratable) return value
  return (
    <span className="inline-flex items-center gap-1">
      {value}
      <BbchObservation row={row} />
    </span>
  )
}

function BbchObservation({ row }: { row: CropTableConditionsRow }) {
  const { t } = useTranslation()
  const { orgId } = useOrg()
  const qc = useQueryClient()
  const [bbch, setBbch] = useState(row.bbchObservedToday ?? row.bbch ?? NaN)
  const refresh = () => qc.invalidateQueries({ queryKey: cropTableKey(orgId) })
  const save = useOrgMutation((base, v: number) => api.post(`${base}/crop-cycles/${row.cropCycleId}/bbch-observations`, { bbch: v }), { success: t('cropTable.bbch.saved'), onSuccess: refresh })
  const clear = useOrgMutation((base, _: void) => api.delete(`${base}/crop-cycles/${row.cropCycleId}/bbch-observations/${today()}`), { success: t('cropTable.bbch.cleared'), onSuccess: refresh })
  return (
    <DialogTrigger>
      <AriaButton aria-label={t('cropTable.bbch.observe')} className={buttonClass('ghost', 'icon-xs')}>
        <Pencil className="size-3" aria-hidden />
      </AriaButton>
      <Popover placement="bottom end" offset={6} className="rounded-[var(--radius-control)] border border-line bg-surface shadow-[var(--shadow-overlay)]">
        <AriaDialog aria-label={t('cropTable.bbch.observe')} className="outline-none p-3 w-64 space-y-3">
          {({ close }) => (
            <Form
              className="space-y-3"
              onSubmit={(ev) => {
                ev.preventDefault()
                if (!Number.isNaN(bbch)) save.mutate(bbch, { onSuccess: close })
              }}
            >
              <NumberField label={t('cropTable.bbch.observedToday')} description={t('cropTable.bbch.observeHint')} autoFocus minValue={0} maxValue={99} step={1} value={bbch} onChange={setBbch} />
              <div className="flex justify-between gap-2">
                <Button size="sm" variant="quiet" isDisabled={row.bbchObservedToday == null} isPending={clear.isPending} onPress={() => clear.mutate(undefined, { onSuccess: close })}>
                  {t('cropTable.bbch.clear')}
                </Button>
                <Button size="sm" type="submit" variant="primary" isDisabled={Number.isNaN(bbch)} isPending={save.isPending}>
                  {t('common.save')}
                </Button>
              </div>
            </Form>
          )}
        </AriaDialog>
      </Popover>
    </DialogTrigger>
  )
}
