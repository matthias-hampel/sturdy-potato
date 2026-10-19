import type { ApplyStrategyResult, CycleNitrogen, FertilizationStrategy, NBalanceValue, Product } from '@agmeo/contracts'
import { useQueryClient } from '@tanstack/react-query'
import { Check, Plus, Settings2, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Form } from 'react-aria-components'
import { useTranslation } from 'react-i18next'
import { InfoPopover } from '#/components/crops/ProtectionExtras'
import { api } from '#/lib/api'
import { fmt } from '#/lib/format'
import { useOrg } from '#/lib/org'
import { useOrgMutation, useOrgQuery } from '#/lib/queries'
import { Button } from '#/ui/Button'
import { NumberField, Option, Select, TextField } from '#/ui/Field'
import { Notice } from '#/ui/Layout'
import { ModalDialog } from '#/ui/Overlay'
import { cx } from '#/ui/utils'

const kgN = (v: number | null | undefined) => (v == null ? '—' : `${fmt.num(v)} kg N/ha`)

function useSave(cropCycleId: string) {
  const { orgId } = useOrg()
  const qc = useQueryClient()
  return useOrgMutation((base, body: Record<string, number | null>) => api.put(`${base}/crop-cycles/${cropCycleId}/n-planning`, body), {
    onSuccess: () => qc.invalidateQueries({ queryKey: ['org', orgId, '/nitrogen'] }),
  })
}

/** One editable value of the balance: own entry (amber) or model/estimate as placeholder (reference NEstimateRow). */
function EstimateRow({ label, hint, v, field, cropCycleId, writable }: { label: string; hint: string; v: NBalanceValue; field: string; cropCycleId: string; writable: boolean }) {
  const { t } = useTranslation()
  const save = useSave(cropCycleId)
  const [draft, setDraft] = useState<number>(v.source === 'user' ? v.value : NaN)
  const commit = () => {
    const next = Number.isNaN(draft) ? null : draft
    if (next === (v.source === 'user' ? v.value : null)) return
    save.mutate({ [field]: next })
  }
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-fg">{label}</span>
        <span className={cx('rounded-full px-1.5 py-0.5 text-[10px] font-medium', v.source === 'user' ? 'bg-[color-mix(in_oklab,var(--color-warning)_20%,transparent)] text-warning' : 'bg-surface-2 text-muted')}>
          {t(`nitrogen.source.${v.source}`)}
        </span>
      </div>
      <p className="text-xs text-muted">{hint}</p>
      <NumberField
        aria-label={label}
        unit="kg N/ha"
        minValue={0}
        maxValue={1000}
        step={1}
        isDisabled={!writable}
        placeholder={fmt.num(v.source === 'user' ? v.estimate : v.value)}
        value={draft}
        onChange={setDraft}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
      />
    </div>
  )
}

/** N supply with its breakdown and the farmer's values (reference NSupplyDetailPanel). */
export function NSupplyCell({ row, writable }: { row: CycleNitrogen; writable: boolean }) {
  const { t } = useTranslation()
  const d = row.deductions
  return (
    <span className="inline-flex items-center gap-1">
      <span className="tabular">{fmt.num(row.nSupply)}</span>
      <InfoPopover label={t('nitrogen.supply.title')} trigger={<Settings2 className="size-3.5" aria-hidden />}>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">{t('nitrogen.supply.title')}</p>
        <Soil row={row} />
        <EstimateRow label={t('nitrogen.supply.nmin')} hint={t('nitrogen.supply.nminHint')} v={row.nMin} field="nMin" cropCycleId={row.cropCycleId} writable={writable} />
        <EstimateRow label={t('nitrogen.supply.mineralisation')} hint={t('nitrogen.supply.mineralisationHint')} v={row.nMinSpring} field="nMinSpring" cropCycleId={row.cropCycleId} writable={writable} />
        <div className="space-y-1 border-t border-line pt-2 text-xs">
          <p className="font-medium text-fg">{t('nitrogen.supply.previousManagement')}</p>
          <Line label={`${t('nitrogen.supply.previousCrop')}${row.previousCropName ? ` (${row.previousCropName})` : ''}`} value={d.previousCrop} />
          <Line label={`${t('nitrogen.supply.organicPreviousYear')} (${fmt.num(row.organicNPreviousYear)} kg N)`} value={d.organicPreviousYear} />
          <Line label={t('nitrogen.supply.humus')} value={d.humus} />
          <Line label={`${t('nitrogen.supply.catchCrop')}${row.catchCropName ? ` (${row.catchCropName})` : ''}`} value={d.catchCrop} />
          <Line label={t('nitrogen.supply.deductions')} value={d.total} strong />
        </div>
        <div className="flex justify-between border-t border-line pt-2 text-sm font-semibold">
          <span>{t('nitrogen.supply.total')}</span>
          <span className="tabular">{kgN(row.nSupply)}</span>
        </div>
      </InfoPopover>
    </span>
  )
}

/** N losses with the farmer's values (reference NLossDetailPanel). */
export function NLossCell({ row, writable }: { row: CycleNitrogen; writable: boolean }) {
  const { t } = useTranslation()
  return (
    <span className="inline-flex items-center gap-1">
      <span className="tabular">{fmt.num(row.nLoss)}</span>
      <InfoPopover label={t('nitrogen.loss.title')} trigger={<Settings2 className="size-3.5" aria-hidden />}>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">{t('nitrogen.loss.title')}</p>
        <p className="text-xs text-muted">{t('nitrogen.loss.hint')}</p>
        <EstimateRow label={t('nitrogen.loss.leaching')} hint={t('nitrogen.loss.leachingHint')} v={row.nLeaching} field="nLeaching" cropCycleId={row.cropCycleId} writable={writable} />
        <EstimateRow label={t('nitrogen.loss.residual')} hint={t('nitrogen.loss.residualHint')} v={row.nResidual} field="nResidual" cropCycleId={row.cropCycleId} writable={writable} />
        <div className="flex justify-between border-t border-line pt-2 text-sm font-semibold">
          <span>{t('nitrogen.loss.total')}</span>
          <span className="tabular">{kgN(row.nLoss)}</span>
        </div>
      </InfoPopover>
    </span>
  )
}

function Soil({ row }: { row: CycleNitrogen }) {
  const { t } = useTranslation()
  return (
    <p className="rounded-md bg-surface-2 p-2 text-xs text-fg-2">
      {t('nitrogen.supply.soil', { soil: row.soilTexture ?? '—', humus: row.humusPct == null ? '—' : fmt.num(row.humusPct, 1) })}
    </p>
  )
}

const Line = ({ label, value, strong }: { label: string; value: number; strong?: boolean }) => (
  <div className={cx('flex justify-between gap-3', strong && 'font-medium text-fg')}>
    <span>{label}</span>
    <span className="tabular whitespace-nowrap">{value ? `${fmt.num(value)} kg` : '—'}</span>
  </div>
)

/** Planned and applied N against the DüV limit (reference DüV ✓/✗ button). */
export function DuevCell({ row, onOpen }: { row: CycleNitrogen; onOpen: () => void }) {
  const { t } = useTranslation()
  if (row.duevNeed == null) return <span className="text-muted">—</span>
  const over = Math.round(row.totalN) > Math.round(row.duevNeed)
  return (
    <Button size="sm" variant="quiet" onPress={onOpen} className={over ? 'text-danger' : 'text-success'} aria-label={over ? t('nitrogen.duev.exceededTitle', { total: fmt.num(row.totalN), limit: fmt.num(row.duevNeed) }) : t('nitrogen.duev.okTitle', { total: fmt.num(row.totalN), limit: fmt.num(row.duevNeed) })}>
      {over ? <X /> : <Check />} {t('nitrogen.duev.label')} {fmt.num(row.duevNeed)}
    </Button>
  )
}

/**
 * Picks a strategy, the fertilizer per dose, and applies it to the selected crops (reference
 * ApplyStrategyContent): planned doses are overwritten, missing ones planned, surplus ones canceled.
 */
export function ApplyStrategyDialog({ cropCycleIds, onClose }: { cropCycleIds: string[]; onClose: () => void }) {
  const { t } = useTranslation()
  const { orgId } = useOrg()
  const qc = useQueryClient()
  const strategies = useOrgQuery<FertilizationStrategy[]>('/fertilization-strategies')
  const products = useOrgQuery<Product[]>('/products')
  const fertilizers = useMemo(() => (products.data ?? []).filter((p) => p.category === 'fertilizer' && (p.nPct ?? 0) > 0 && !p.archivedAt), [products.data])
  const [strategyId, setStrategyId] = useState<string | null>(null)
  const [productIds, setProductIds] = useState<(string | null)[]>([])
  const [creating, setCreating] = useState(false)
  const strategy = strategies.data?.find((s) => s.id === strategyId)
  const pick = (s: FertilizationStrategy) => {
    setStrategyId(s.id)
    setProductIds(s.products.map((p) => p?.id ?? null))
  }
  const apply = useOrgMutation((base, _: void) => api.post<ApplyStrategyResult>(`${base}/fertilization-strategies/${strategyId}/apply`, { cropCycleIds, productIds }), {
    success: (r: ApplyStrategyResult) => t('nitrogen.strategy.applied', { created: r.created, updated: r.updated, canceled: r.canceled }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['org', orgId] })
      onClose()
    },
  })
  const ready = !!strategy && productIds.length === strategy.splitPercentages.length && productIds.every(Boolean)
  return (
    <ModalDialog isOpen onOpenChange={(o) => !o && onClose()} title={t('nitrogen.strategy.applyTitle')} description={t('nitrogen.strategy.applyDescription', { count: cropCycleIds.length })} size="md">
      {creating ? (
        <StrategyForm
          strategies={strategies.data ?? []}
          fertilizers={fertilizers}
          onCancel={() => setCreating(false)}
          onCreated={(s) => {
            setCreating(false)
            pick(s)
          }}
        />
      ) : (
        <Form onSubmit={(e) => { e.preventDefault(); if (ready) apply.mutate() }} className="space-y-4">
          {(strategies.data ?? []).length === 0 ? (
            <Notice tone="info">{t('nitrogen.strategy.none')}</Notice>
          ) : (
            <div role="radiogroup" aria-label={t('nitrogen.strategy.label')} className="space-y-1.5">
              {strategies.data!.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  role="radio"
                  aria-checked={s.id === strategyId}
                  onClick={() => pick(s)}
                  className={cx('w-full rounded-md border px-3 py-2 text-left text-sm', s.id === strategyId ? 'border-primary bg-primary-soft' : 'border-line hover:bg-surface-2')}
                >
                  <span className="font-medium text-fg">{s.name}</span>
                  <span className="ml-2 text-muted tabular">{s.splitPercentages.join('/')}</span>
                  {s.public && <span className="ml-2 text-xs text-muted">{t('nitrogen.strategy.public')}</span>}
                  {s.products.some(Boolean) && <span className="block text-xs text-muted">{s.products.map((p) => p?.name ?? '—').join(' · ')}</span>}
                </button>
              ))}
            </div>
          )}
          {strategy && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-fg">{t('nitrogen.strategy.fertilizers')}</p>
              {strategy.splitPercentages.map((pct, i) => (
                <Select
                  key={i}
                  label={t('nitrogen.strategy.dose', { n: i + 1, pct })}
                  items={fertilizers}
                  value={productIds[i] ?? null}
                  onChange={(v) => setProductIds((x) => Object.assign([...x], { [i]: v ? String(v) : null }))}
                  placeholder={t('nitrogen.strategy.pickFertilizer')}
                >
                  {(p) => <Option id={p.id}>{`${p.name} (${fmt.num(p.nPct, 1)} % N)`}</Option>}
                </Select>
              ))}
            </div>
          )}
          <p className="text-xs text-muted">{t('nitrogen.strategy.applyHint')}</p>
          <div className="flex justify-between gap-2">
            <Button variant="quiet" onPress={() => setCreating(true)}>
              <Plus /> {t('nitrogen.strategy.create')}
            </Button>
            <div className="flex gap-2">
              <Button onPress={onClose}>{t('common.cancel')}</Button>
              <Button type="submit" variant="primary" isDisabled={!ready} isPending={apply.isPending}>
                {t('nitrogen.strategy.apply')}
              </Button>
            </div>
          </div>
        </Form>
      )}
    </ModalDialog>
  )
}

/** A new strategy: name, one to three doses with their share and a mineral fertilizer each (reference StrategyForm). */
function StrategyForm({ strategies, fertilizers, onCancel, onCreated }: { strategies: FertilizationStrategy[]; fertilizers: Product[]; onCancel: () => void; onCreated: (s: FertilizationStrategy) => void }) {
  const { t } = useTranslation()
  const [name, setName] = useState(t('nitrogen.strategy.defaultName'))
  const [doses, setDoses] = useState(2)
  const [splits, setSplits] = useState<number[]>([50, 50])
  const [productIds, setProductIds] = useState<(string | null)[]>([null, null])
  const setCount = (n: number) => {
    if (!n || n < 1 || n > 3) return
    const each = Math.floor(100 / n)
    setDoses(n)
    setSplits(Array.from({ length: n }, (_, i) => (i === 0 ? 100 - each * (n - 1) : each)))
    setProductIds((p) => Array.from({ length: n }, (_, i) => p[i] ?? null))
  }
  const sum = splits.reduce((a, b) => a + (Number.isNaN(b) ? 0 : b), 0)
  const error = !name.trim()
    ? t('nitrogen.strategy.error.nameRequired')
    : strategies.some((s) => s.name.toLowerCase() === name.trim().toLowerCase())
      ? t('nitrogen.strategy.error.nameExists')
      : sum !== 100
        ? t('nitrogen.strategy.error.splitSum')
        : productIds.some((p) => !p)
          ? t('nitrogen.strategy.error.fertilizerRequired')
          : null
  const save = useOrgMutation((base, _: void) => api.post<FertilizationStrategy>(`${base}/fertilization-strategies`, { name: name.trim(), splitPercentages: splits, productIds }), {
    success: t('nitrogen.strategy.created'),
    onSuccess: (s: FertilizationStrategy) => onCreated(s),
  })
  return (
    <Form onSubmit={(e) => { e.preventDefault(); if (!error) save.mutate() }} className="space-y-4">
      <p className="text-sm text-fg-2">{t('nitrogen.strategy.formDescription')}</p>
      <TextField label={t('nitrogen.strategy.name')} value={name} onChange={setName} isRequired />
      <NumberField label={t('nitrogen.strategy.doses')} minValue={1} maxValue={3} step={1} value={doses} onChange={setCount} />
      <div className="space-y-2">
        <p className="text-sm font-medium text-fg">{t('nitrogen.strategy.splits')}</p>
        {splits.map((pct, i) => (
          <div key={i} className="grid grid-cols-[7rem_1fr] gap-2 items-end">
            <NumberField label={t('nitrogen.strategy.doseShort', { n: i + 1 })} unit="%" minValue={0} maxValue={100} value={pct} onChange={(v) => setSplits((x) => Object.assign([...x], { [i]: v }))} />
            <Select label={t('nitrogen.strategy.fertilizer')} items={fertilizers} value={productIds[i] ?? null} onChange={(v) => setProductIds((x) => Object.assign([...x], { [i]: v ? String(v) : null }))} placeholder={t('nitrogen.strategy.pickFertilizer')}>
              {(p) => <Option id={p.id}>{`${p.name} (${fmt.num(p.nPct, 1)} % N)`}</Option>}
            </Select>
          </div>
        ))}
        <p className={cx('text-sm tabular', sum === 100 ? 'text-success' : 'text-warning')}>{t('nitrogen.strategy.total', { sum })}</p>
      </div>
      {strategies.length > 0 && (
        <div className="text-xs text-muted">
          <p className="font-medium">{t('nitrogen.strategy.existing')}</p>
          <p>{strategies.map((s) => `${s.name} (${s.splitPercentages.join('/')})`).join(' · ')}</p>
        </div>
      )}
      {error && <p className="text-sm text-warning">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button onPress={onCancel}>{t('common.cancel')}</Button>
        <Button type="submit" variant="primary" isDisabled={!!error} isPending={save.isPending}>
          {t('nitrogen.strategy.save')}
        </Button>
      </div>
    </Form>
  )
}
