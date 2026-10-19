import {
  COARSENESS_DEFAULT,
  GRID_CELL_HA_PRESETS,
  GRID_DEFAULT_CELL_HA,
  MIN_ZONE_HA_DEFAULT,
  MIN_ZONE_HA_OPTIONS,
  ZONATION_METHODS,
  ZONATION_SOURCES,
  ZONE_RULE_HA_PER_ZONE_DEFAULT,
  ZONE_RULE_SMALL_FIELD_MAX_HA_DEFAULT,
  zonesForAreaByRule,
  type BatchResult,
  type BatchSamplingPlanInput,
  type BatchZonationInput,
  type SamplingPlanMode,
  type ZonationMethod,
  type ZonationSource,
} from '@agmeo/contracts'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '#/lib/api'
import { fmt } from '#/lib/format'
import { useOrgMutation } from '#/lib/queries'
import { Button, SegmentedControl } from '#/ui/Button'
import { NumberField, Option, Select, num } from '#/ui/Field'
import { Notice } from '#/ui/Layout'
import { ModalDialog } from '#/ui/Overlay'
import { Cell, Column, Row, Table, TableBody, TableHeader } from '#/ui/Table'
import { methodLabel, sourceLabel } from './soilLabels'

export interface BatchField {
  fieldId: string
  fieldName: string
  areaHa: number
  hasZonation: boolean
}

type Kind = 'satellite' | 'plan'
type CountMode = 'auto' | 'manual' | 'rule'

/**
 * Zonation for several fields at once (ported from the reference's BatchZonationModal): satellite
 * zones computed by the worker, or a geometric sampling plan (grid, Voronoi, productivity zones).
 */
export function BatchZonationDialog({
  fields,
  isOpen,
  onOpenChange,
  onQueued,
}: {
  fields: BatchField[]
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  onQueued?: (result: BatchResult) => void
}) {
  const { t } = useTranslation()
  const [kind, setKind] = useState<Kind>('satellite')
  const [method, setMethod] = useState<ZonationMethod>('fcm')
  const [source, setSource] = useState<ZonationSource>('ndvi')
  const [countMode, setCountMode] = useState<CountMode>('auto')
  const [count, setCount] = useState(3)
  const [smallMax, setSmallMax] = useState(ZONE_RULE_SMALL_FIELD_MAX_HA_DEFAULT)
  const [haPerZone, setHaPerZone] = useState(ZONE_RULE_HA_PER_ZONE_DEFAULT)
  const [overrides, setOverrides] = useState<Record<string, number>>({})
  const [minZoneHa, setMinZoneHa] = useState(MIN_ZONE_HA_DEFAULT)
  const [coarseness, setCoarseness] = useState(COARSENESS_DEFAULT)
  const [cleanup, setCleanup] = useState<'merge' | 'fix-kws'>('merge')
  const [planMode, setPlanMode] = useState<SamplingPlanMode>('grid')
  const [cellHa, setCellHa] = useState(GRID_DEFAULT_CELL_HA)
  const [result, setResult] = useState<BatchResult | null>(null)

  const ruleCounts = useMemo(
    () => Object.fromEntries(fields.map((f) => [f.fieldId, overrides[f.fieldId] ?? zonesForAreaByRule(f.areaHa, smallMax, haPerZone)])),
    [fields, overrides, smallMax, haPerZone],
  )
  const withZonation = fields.filter((f) => f.hasZonation).length

  const queue = useOrgMutation((base, input: BatchZonationInput) => api.post<BatchResult>(`${base}/soil/zonations`, input), {
    onSuccess: (r) => {
      setResult(r)
      onQueued?.(r)
    },
  })
  const plan = useOrgMutation((base, input: BatchSamplingPlanInput) => api.post<BatchResult>(`${base}/soil/plans`, input), {
    onSuccess: (r) => {
      setResult(r)
      onQueued?.(r)
    },
  })

  const run = () => {
    const fieldIds = fields.map((f) => f.fieldId)
    if (kind === 'plan') {
      plan.mutate({ fieldIds, mode: planMode, cellHa })
      return
    }
    queue.mutate({
      fieldIds,
      method,
      source,
      zoneCount: countMode === 'manual' ? count : 'auto',
      zoneCounts: countMode === 'rule' ? ruleCounts : undefined,
      minZoneHa,
      coarseness,
      cleanup,
    })
  }

  const close = (open: boolean) => {
    if (!open) setResult(null)
    onOpenChange(open)
  }

  return (
    <ModalDialog
      isOpen={isOpen}
      onOpenChange={close}
      size="lg"
      title={t('soil.batch.title', { count: fields.length })}
      description={t('soil.batch.description')}
      footer={(closeDialog) =>
        result ? (
          <Button variant="primary" onPress={closeDialog}>
            {t('soil.done')}
          </Button>
        ) : (
          <>
            <Button onPress={closeDialog}>{t('common.cancel')}</Button>
            <Button variant="primary" onPress={run} isPending={queue.isPending || plan.isPending} isDisabled={!fields.length}>
              {t('soil.batch.run')}
            </Button>
          </>
        )
      }
    >
      {result ? (
        <BatchResultList result={result} fields={fields} />
      ) : (
        <div className="space-y-5">
          <SegmentedControl
            aria-label={t('soil.batch.kind')}
            value={kind}
            onChange={setKind}
            items={[
              { id: 'satellite', label: t('soil.batch.kind.satellite') },
              { id: 'plan', label: t('soil.batch.kind.plan') },
            ]}
          />
          {withZonation > 0 && <Notice tone="warning">{t('soil.batch.replaceWarning', { count: withZonation })}</Notice>}

          {kind === 'satellite' ? (
            <>
              <div className="grid sm:grid-cols-2 gap-4">
                <Select label={t('soil.batch.method')} items={ZONATION_METHODS.map((id) => ({ id }))} value={method} onChange={(v) => v && setMethod(v as ZonationMethod)}>
                  {(item) => (
                    <Option id={item.id} description={t(`soil.zonationMethod.${item.id}.hint`)}>
                      {methodLabel(item.id)}
                    </Option>
                  )}
                </Select>
                <Select label={t('soil.batch.source')} items={ZONATION_SOURCES.map((id) => ({ id }))} value={source} onChange={(v) => v && setSource(v as ZonationSource)}>
                  {(item) => <Option id={item.id}>{sourceLabel(item.id)}</Option>}
                </Select>
              </div>
              <p className="text-xs text-muted">{source === 'productivity' ? t('soil.batch.productivityHint') : t('soil.batch.satelliteHint')}</p>

              <div className="space-y-3">
                <SegmentedControl
                  aria-label={t('soil.batch.numberOfZones')}
                  value={countMode}
                  onChange={setCountMode}
                  items={[
                    { id: 'auto', label: t('soil.batch.count.auto') },
                    { id: 'manual', label: t('soil.batch.count.manual') },
                    { id: 'rule', label: t('soil.batch.count.rule') },
                  ]}
                />
                {countMode === 'auto' && <p className="text-xs text-muted">{t('soil.batch.count.autoHint')}</p>}
                {countMode === 'manual' && (
                  <NumberField className="max-w-48" label={t('soil.batch.numberOfZones')} minValue={1} maxValue={30} value={count} onChange={(v) => setCount(num(v) ?? 1)} />
                )}
                {countMode === 'rule' && (
                  <>
                    <div className="grid sm:grid-cols-2 gap-4">
                      <NumberField label={t('soil.batch.rule.smallFieldMax')} unit="ha" minValue={0} step={0.5} value={smallMax} onChange={(v) => setSmallMax(num(v) ?? 0)} />
                      <NumberField label={t('soil.batch.rule.haPerZone')} unit="ha" minValue={0.5} step={0.5} value={haPerZone} onChange={(v) => setHaPerZone(num(v) ?? 1)} />
                    </div>
                    <p className="text-xs text-muted">{t('soil.batch.fields.hint')}</p>
                    <div className="max-h-64 overflow-y-auto rounded-lg border border-line">
                      <Table aria-label={t('soil.batch.step.fields')}>
                        <TableHeader>
                          <Column isRowHeader>{t('soil.page.field')}</Column>
                          <Column align="end">{t('soil.batch.fields.area')}</Column>
                          <Column align="end">{t('soil.batch.fields.zones')}</Column>
                        </TableHeader>
                        <TableBody items={fields.map((f) => ({ ...f, id: f.fieldId }))}>
                          {(f) => (
                            <Row id={f.id}>
                              <Cell>{f.fieldName}</Cell>
                              <Cell align="end">{fmt.ha(f.areaHa)}</Cell>
                              <Cell align="end">
                                <NumberField
                                  aria-label={t('soil.batch.fields.zonesFor', { name: f.fieldName })}
                                  className="w-24 ml-auto"
                                  minValue={1}
                                  maxValue={30}
                                  value={ruleCounts[f.fieldId]}
                                  onChange={(v) => setOverrides((o) => ({ ...o, [f.fieldId]: num(v) ?? 1 }))}
                                />
                              </Cell>
                            </Row>
                          )}
                        </TableBody>
                      </Table>
                    </div>
                  </>
                )}
              </div>

              <div className="grid sm:grid-cols-3 gap-4">
                <Select
                  label={t('soil.batch.minArea')}
                  description={t('soil.batch.minAreaHint')}
                  items={MIN_ZONE_HA_OPTIONS.map((v) => ({ id: String(v), v }))}
                  value={String(minZoneHa)}
                  onChange={(v) => v && setMinZoneHa(Number(v))}
                >
                  {(item) => <Option id={item.id}>{fmt.ha(item.v)}</Option>}
                </Select>
                <NumberField
                  label={t('soil.batch.coarseness')}
                  description={t('soil.batch.coarsenessHint')}
                  minValue={0}
                  maxValue={1}
                  step={0.05}
                  formatOptions={{ maximumFractionDigits: 2 }}
                  value={coarseness}
                  onChange={(v) => setCoarseness(num(v) ?? COARSENESS_DEFAULT)}
                />
                <Select
                  label={t('soil.batch.cleanup')}
                  isDisabled={method === 'probe' || method === 'probe-v2'}
                  items={[{ id: 'merge' }, { id: 'fix-kws' }]}
                  value={cleanup}
                  onChange={(v) => v && setCleanup(v as 'merge' | 'fix-kws')}
                >
                  {(item) => <Option id={item.id}>{t(`soil.batch.cleanup.${item.id}`)}</Option>}
                </Select>
              </div>
            </>
          ) : (
            <PlanSettings mode={planMode} onMode={setPlanMode} cellHa={cellHa} onCellHa={setCellHa} />
          )}
        </div>
      )}
    </ModalDialog>
  )
}

/** Grid / Voronoi / zones mode and the cell size. */
export function PlanSettings({ mode, onMode, cellHa, onCellHa }: { mode: SamplingPlanMode; onMode: (m: SamplingPlanMode) => void; cellHa: number; onCellHa: (v: number) => void }) {
  const { t } = useTranslation()
  return (
    <div className="space-y-3">
      <SegmentedControl
        aria-label={t('soil.plan.mode')}
        value={mode}
        onChange={onMode}
        items={[
          { id: 'grid', label: t('soil.plan.modeCells') },
          { id: 'voronoi', label: t('soil.plan.modeVoronoi') },
          { id: 'zones', label: t('soil.plan.modeZones') },
        ]}
      />
      <p className="text-xs text-muted">{t(`soil.plan.${mode}Hint`)}</p>
      {mode !== 'zones' && (
        <div className="space-y-2">
          <span className="text-sm font-medium text-fg">{t('soil.plan.cellSize')}</span>
          <div className="flex flex-wrap items-center gap-1.5">
            {GRID_CELL_HA_PRESETS.map((ha) => (
              <Button key={ha} size="sm" variant={cellHa === ha ? 'primary' : 'secondary'} onPress={() => onCellHa(ha)}>
                {fmt.ha(ha, 1)}
              </Button>
            ))}
            <NumberField aria-label={t('soil.plan.custom')} className="w-28" unit="ha" minValue={0.1} maxValue={100} step={0.5} value={cellHa} onChange={(v) => onCellHa(num(v) ?? GRID_DEFAULT_CELL_HA)} />
          </div>
        </div>
      )}
    </div>
  )
}

function BatchResultList({ result, fields }: { result: BatchResult; fields: BatchField[] }) {
  const { t } = useTranslation()
  const name = (id: string) => fields.find((f) => f.fieldId === id)?.fieldName ?? id
  const queued = result.results.filter((r) => r.status === 'queued').length
  return (
    <div className="space-y-3">
      {queued > 0 && <Notice tone="info">{t('soil.batch.queuedHint', { count: queued })}</Notice>}
      <ul className="divide-y divide-line rounded-lg border border-line text-sm">
        {result.results.map((r) => (
          <li key={r.fieldId} className="flex items-center justify-between gap-3 px-3 py-2">
            <span>{name(r.fieldId)}</span>
            <span className={r.status === 'failed' || r.status === 'skipped' ? 'text-danger' : 'text-muted'}>
              {r.status === 'created'
                ? t('soil.batch.successZones', { count: r.zoneCount ?? 0 })
                : r.status === 'queued'
                  ? t('soil.batch.pending')
                  : t(`soil.batch.reason.${r.reason ?? 'noZones'}`, { defaultValue: r.reason })}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
