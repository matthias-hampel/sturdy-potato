import type { BaseNutrientRow, CycleBaseFertilization } from '@agmeo/contracts'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '#/lib/api'
import { fmt } from '#/lib/format'
import { useOrgMutation } from '#/lib/queries'
import { NumberField, Switch } from '#/ui/Field'
import { Notice, Stat } from '#/ui/Layout'
import { ModalDialog } from '#/ui/Overlay'
import { Cell, Column, Row, Table, TableBody, TableHeader } from '#/ui/Table'
import { cx } from '#/ui/utils'

const dash = <span className="text-muted">—</span>

/** Soil content with its class and factor (reference "Boden" column). */
export function SoilValueCell({ n }: { n: BaseNutrientRow | undefined }) {
  const { t } = useTranslation()
  if (!n || n.soilMg100g == null) return <span className="text-xs text-muted">{t('baseFertilization.soil.missing')}</span>
  return (
    <span className="inline-flex flex-col items-end leading-tight">
      <span className="tabular">{fmt.num(n.soilMg100g, 1)}</span>
      {n.contentClass && <span className="text-xs text-muted tabular">{t('baseFertilization.soil.class', { level: n.contentClass, factor: fmt.num(n.factor, 1) })}</span>}
    </span>
  )
}

/** Delivered kg/ha with the planned amount below (reference "Zufuhr"). */
export function DeliveredCell({ n }: { n: BaseNutrientRow | undefined }) {
  const { t } = useTranslation()
  if (!n) return dash
  return (
    <span className="inline-flex flex-col items-end leading-tight">
      <span className="tabular">{fmt.num(n.delivered)}</span>
      {n.planned > 0 && <span className="text-xs text-[var(--color-series-1)] tabular">{t('baseFertilization.delivered.planned', { value: fmt.num(n.planned) })}</span>}
    </span>
  )
}

/** need − delivered: under-supply amber, surplus red, balanced green (reference "Saldo"). */
export function BalanceCell({ n }: { n: BaseNutrientRow | undefined }) {
  const { t } = useTranslation()
  if (!n) return dash
  if (n.balance == null) return <span className="text-xs text-muted" title={t('baseFertilization.balance.noSoil')}>—</span>
  const tone = n.balance > 5 ? 'text-warning' : n.balance < -5 ? 'text-danger' : 'text-success'
  const withPlan = n.balance - n.planned
  return (
    <span className="inline-flex flex-col items-end leading-tight">
      <span className={cx('tabular font-medium', tone)}>{`${n.balance > 0 ? '+' : ''}${fmt.num(n.balance)}`}</span>
      <span className="text-xs text-muted tabular">{t('baseFertilization.balance.need', { value: fmt.num(n.need) })}</span>
      {n.planned > 0 && <span className="text-xs text-muted tabular">{t('baseFertilization.balance.withPlan', { value: `${withPlan > 0 ? '+' : ''}${fmt.num(withPlan)}` })}</span>}
    </span>
  )
}

export function StrawCell({ row, writable }: { row: CycleBaseFertilization; writable: boolean }) {
  const { t } = useTranslation()
  const save = useOrgMutation((base, strawRemoved: boolean) => api.put(`${base}/crop-cycles/${row.cropCycleId}/base-fertilization`, { strawRemoved }))
  if (!row.hasStraw) return dash
  return (
    <Switch isSelected={row.strawRemoved} isDisabled={!writable || save.isPending} onChange={(v) => save.mutate(v)}>
      <span className="text-xs whitespace-nowrap">{row.strawRemoved ? t('baseFertilization.straw.removed') : t('baseFertilization.straw.retained')}</span>
    </Switch>
  )
}

/** Entered lime requirement, the computed one as placeholder (reference "Kalkbedarf"). */
export function LimeCell({ row, writable }: { row: CycleBaseFertilization; writable: boolean }) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState<number | null>(null)
  const save = useOrgMutation((base, limeRequirementDtCaO: number | null) => api.put(`${base}/crop-cycles/${row.cropCycleId}/base-fertilization`, { limeRequirementDtCaO }))
  const commit = () => {
    if (draft === null) return
    const v = Number.isNaN(draft) ? null : draft
    setDraft(null)
    if (v !== row.limeOverrideDtCaO) save.mutate(v)
  }
  return (
    <span className="inline-flex flex-col items-end gap-0.5">
      <NumberField
        aria-label={t('baseFertilization.lime')}
        className="w-28"
        unit="dt/ha"
        minValue={0}
        maxValue={500}
        isDisabled={!writable}
        placeholder={row.limeComputedDtCaO == null ? '—' : fmt.num(row.limeComputedDtCaO)}
        value={draft ?? row.limeOverrideDtCaO ?? NaN}
        onChange={setDraft}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
      />
      {row.limeOverrideDtCaO == null && row.limeComputedDtCaO != null && <span className="text-[10px] text-success">{t('baseFertilization.lime.calculated')}</span>}
    </span>
  )
}

/** "{ratio} %" pill of the six-year P2O5 balance; opens the year-by-year view. */
export function P2o5BalancePill({ row, fieldName }: { row: CycleBaseFertilization; fieldName: string }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const b = row.p2o5Balance
  if (b.ratioPct == null && b.supply === 0) return dash
  const incomplete = b.yearsWithYield < 6
  const tone = b.ratioPct == null || incomplete ? 'bg-surface-2 text-fg-2' : b.compliant ? 'bg-[color-mix(in_oklab,var(--color-success)_18%,transparent)] text-success' : 'bg-[color-mix(in_oklab,var(--color-warning)_20%,transparent)] text-warning'
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={cx('rounded-full px-2 py-0.5 text-xs font-medium tabular whitespace-nowrap', tone)} title={incomplete ? t('baseFertilization.p2o5Balance.incompleteTooltip', { count: b.yearsWithYield }) : undefined}>
        {b.ratioPct == null ? '—' : `${b.ratioPct} %`}
        {incomplete && <span className="ml-1 opacity-70">·{b.yearsWithYield}/6</span>}
      </button>
      {open && (
        <ModalDialog isOpen onOpenChange={setOpen} title={t('baseFertilization.drawer.title')} description={`${fieldName} · ${t('baseFertilization.drawer.window')} ${b.fromYear}–${b.toYear} · ${t('baseFertilization.p2o5Balance.yearsData', { count: b.yearsWithYield })}`} size="md">
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <Stat label={t('baseFertilization.drawer.supply')} value={`${fmt.num(b.supply)} kg`} />
              <Stat label={t('baseFertilization.drawer.removal')} value={`${fmt.num(b.removal)} kg`} />
              <Stat
                label={t('baseFertilization.p2o5Balance.ratio')}
                value={b.ratioPct == null ? '—' : `${b.ratioPct} %`}
                tone={incomplete ? 'default' : b.compliant ? 'success' : 'warning'}
                hint={incomplete ? t('baseFertilization.p2o5Balance.incomplete') : b.compliant ? t('baseFertilization.duevCompliant') : t('baseFertilization.duevWarning')}
              />
            </div>
            {b.yearsWithYield === 0 ? (
              <Notice tone="info">{t('baseFertilization.p2o5Balance.noYieldData')}</Notice>
            ) : incomplete ? (
              <Notice tone="warning">{t('baseFertilization.p2o5Balance.incompleteWarning', { count: b.yearsWithYield })}</Notice>
            ) : null}
            <Table aria-label={t('baseFertilization.drawer.title')}>
              <TableHeader>
                <Column isRowHeader>{t('baseFertilization.drawer.year')}</Column>
                <Column align="end">{t('baseFertilization.drawer.supply')}</Column>
                <Column align="end">{t('baseFertilization.drawer.removal')}</Column>
                <Column align="end">{t('baseFertilization.balance.label')}</Column>
              </TableHeader>
              <TableBody items={b.years.map((y) => ({ ...y, id: String(y.year) }))}>
                {(y) => {
                  const saldo = y.supply - (y.removal ?? 0)
                  return (
                    <Row id={y.id}>
                      <Cell>{y.year}</Cell>
                      <Cell align="end" className="tabular">{fmt.num(y.supply)}</Cell>
                      <Cell align="end" className="tabular">{y.removal == null ? '—' : fmt.num(y.removal)}</Cell>
                      <Cell align="end" className={cx('tabular', saldo > 0 && 'text-warning')}>{`${saldo > 0 ? '+' : ''}${fmt.num(saldo)}`}</Cell>
                    </Row>
                  )
                }}
              </TableBody>
            </Table>
            <p className="text-xs text-muted">{t('baseFertilization.p2o5Balance.tooltip')}</p>
          </div>
        </ModalDialog>
      )}
    </>
  )
}
