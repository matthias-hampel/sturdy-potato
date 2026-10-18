import { zoneColor, type Operation, type ProductivityZone, type VraExportFormat, type VraMapSummary } from '@agmeo/contracts'
import { Download, Equal, Wand2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button as AriaButton, Input, NumberField as AriaNumberField } from 'react-aria-components'
import { useTranslation } from 'react-i18next'
import { OperationStatusBadge, OperationTypeLabel } from '#/components/labels'
import { t as tt } from '#/i18n'
import { api } from '#/lib/api'
import { fmt } from '#/lib/format'
import { useOrg } from '#/lib/org'
import { Link, buttonClass } from '#/ui/Button'
import { inputClass } from '#/ui/Field'
import { Menu, MenuItem, MenuTrigger } from '#/ui/Overlay'
import { toast } from '#/ui/Toast'
import { cx } from '#/ui/utils'
import { evaluate, meanRate, rateIn, type Evaluation, type ZoneLine, type ZoneRates } from './zoneMath'

/** A summary row under the lines: one value per zone and an area-weighted mean. */
export interface SummaryRow {
  key: string
  label: ReactNode
  values: (number | null)[]
  format: (v: number) => string
  strong?: boolean
  /** Colour negative values (e.g. N above the need, a negative margin). */
  tone?: (v: number) => 'positive' | 'negative' | null
}

const th = 'px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted border-b border-line whitespace-nowrap text-right align-bottom'
const td = 'px-3 py-2 border-b border-line align-middle'

/** A base unit as text after a price, e.g. €/kg, €/m³. */
const unitText = (unit: string) => (unit === 'm3' ? 'm³' : unit === 'unit' ? tt('enum.baseUnit.unit') : unit)

const EXPORTS: { id: VraExportFormat; label: string }[] = [
  { id: 'shp', label: 'Shapefile' },
  { id: 'isoxml', label: 'ISO-XML' },
  { id: 'geojson', label: 'GeoJSON' },
]

export function ZoneTable({
  zones,
  zoneCount,
  groups,
  rates,
  onRates,
  onDistribute,
  evaluation,
  currency,
  showMoney,
  canEdit,
  focusKey,
  onFocus,
  maps,
  fieldId,
  summary,
  emptyText,
}: {
  zones: ProductivityZone[]
  zoneCount: number
  groups: { op: Operation; lines: ZoneLine[] }[]
  rates: (line: ZoneLine) => ZoneRates | null
  onRates: (line: ZoneLine, rates: ZoneRates | null) => void
  onDistribute: (line: ZoneLine) => void
  evaluation: Evaluation
  currency: string
  showMoney: boolean
  canEdit: boolean
  focusKey: string | null
  onFocus: (key: string) => void
  maps: VraMapSummary[]
  fieldId: string
  summary: SummaryRow[]
  emptyText: ReactNode
}) {
  const { t } = useTranslation()
  const { orgId } = useOrg()
  const fieldArea = zones.reduce((s, z) => s + z.areaHa, 0)
  const money = evaluation === 'avgCostPerHa' || evaluation === 'totalCost'
  const perHa = evaluation === 'avgQtyPerHa' || evaluation === 'avgCostPerHa'
  const show = (v: number | null, unit: string) =>
    v == null ? '—' : money ? fmt.money(v, currency, perHa ? 2 : 0) : `${fmt.qty(v, unit)}${perHa ? '/ha' : ''}`
  const colSpan = zones.length + 4

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-separate border-spacing-0">
        <thead>
          <tr>
            <th className={cx(th, 'text-left min-w-52')}>{t('cultivation.zones.measure')}</th>
            {showMoney && <th className={th}>{t('cultivation.zones.price')}</th>}
            {zones.map((z) => (
              <th key={z.zoneNo} className={th}>
                <span className="inline-flex items-center gap-1.5">
                  <span className="size-2.5 rounded-sm" style={{ background: zoneColor(z.zoneNo, zoneCount) }} aria-hidden />
                  {t('cultivation.zone', { number: z.zoneNo })}
                </span>
                <div className="font-normal normal-case tracking-normal tabular">{fmt.ha(z.areaHa, 1)} · {fmt.pct(z.relativeProductivity)}</div>
              </th>
            ))}
            <th className={th}>{t(`cultivation.zones.evaluation.${evaluation}`)}</th>
            <th className={cx(th, 'w-0')}><span className="sr-only">{t('crops.plan.actions')}</span></th>
          </tr>
        </thead>
        <tbody>
          {groups.length === 0 && (
            <tr>
              <td colSpan={colSpan - (showMoney ? 0 : 1)} className="py-10 text-center text-sm text-muted border-b border-line">{emptyText}</td>
            </tr>
          )}
          {groups.map(({ op, lines }) => {
            const map = maps.find((m) => m.operationId === op.id)
            return [
              <tr key={op.id} className="bg-surface-2/60">
                <td colSpan={colSpan - (showMoney ? 0 : 1)} className={cx(td, 'py-1.5')}>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <OperationTypeLabel type={op.type} iconOnly />
                    <Link to="/o/$orgId/operations/$operationId" params={{ orgId, operationId: op.id }} className="font-medium hover:underline">{op.title}</Link>
                    <span className="text-xs text-muted tabular">{op.performedAt ? fmt.date(op.performedAt) : t('operations.table.plannedOn', { date: fmt.date(op.plannedOn) })}</span>
                    <OperationStatusBadge status={op.status} />
                    {map && (
                      <MenuTrigger>
                        <AriaButton aria-label={t('cultivation.zones.exportMap')} className={cx(buttonClass('ghost', 'icon-xs'), 'ml-auto')}>
                          <Download className="size-3.5" />
                        </AriaButton>
                        <Menu
                          onAction={(key) =>
                            api.download(`/orgs/${orgId}/fields/${fieldId}/vra-maps/${map.id}/export`, { format: String(key) }).catch(() => toast.error(tt('apiError.download_failed')))
                          }
                        >
                          {EXPORTS.map((e) => <MenuItem key={e.id} id={e.id}>{e.label}</MenuItem>)}
                        </Menu>
                      </MenuTrigger>
                    )}
                  </div>
                </td>
              </tr>,
              lines.length === 0 ? (
                <tr key={`${op.id}:none`}>
                  <td colSpan={colSpan - (showMoney ? 0 : 1)} className={cx(td, 'text-xs text-muted pl-10')}>{t('cultivation.zones.noProducts')}</td>
                </tr>
              ) : (
                lines.map((l) => {
                  const r = rates(l)
                  const mean = meanRate(r, l.flatRate, zones)
                  const editing = canEdit && l.editable && evaluation === 'avgQtyPerHa'
                  const total = perHa ? evaluate(evaluation, mean, l.unitCost, 1) : zones.reduce((s, z) => s + (evaluate(evaluation, rateIn(r, l.flatRate, z.zoneNo), l.unitCost, z.areaHa) ?? 0), 0)
                  return (
                    <tr key={l.key} className={cx('cursor-default', focusKey === l.key && 'bg-primary-soft/40')} onClick={() => onFocus(l.key)} onFocus={() => onFocus(l.key)}>
                      <td className={cx(td, 'pl-10')}>
                        <div className="font-medium">{l.line.productName}</div>
                        <div className="text-xs text-muted">
                          {r ? t('cultivation.zones.variable', { rate: fmt.qty(mean, l.line.baseUnit) }) : t('cultivation.zones.uniform', { rate: fmt.qty(l.flatRate, l.line.baseUnit) })}
                          {!l.vra && ` · ${t('cultivation.zones.noMapUnit')}`}
                        </div>
                      </td>
                      {showMoney && (
                        <td className={cx(td, 'text-right tabular whitespace-nowrap text-fg-2')}>
                          {l.unitCost != null ? `${fmt.money(l.unitCost, currency, 2)}/${unitText(l.line.baseUnit)}` : '—'}
                        </td>
                      )}
                      {zones.map((z) => {
                        const rate = rateIn(r, l.flatRate, z.zoneNo)
                        return (
                          <td key={z.zoneNo} className={cx(td, 'text-right tabular whitespace-nowrap', r && 'text-fg', !r && 'text-fg-2')}>
                            {editing ? (
                              <AriaNumberField
                                aria-label={t('cultivation.zones.rateFor', { product: l.line.productName, zone: z.zoneNo })}
                                value={rate}
                                minValue={0}
                                formatOptions={{ maximumFractionDigits: 2 }}
                                onChange={(v) => {
                                  if (Number.isNaN(v)) return
                                  const next = Object.fromEntries(zones.map((x) => [String(x.zoneNo), rateIn(r, l.flatRate, x.zoneNo)]))
                                  next[String(z.zoneNo)] = v
                                  onRates(l, next)
                                }}
                              >
                                <Input className={cx(inputClass, 'h-8 w-20 px-2 text-right tabular')} />
                              </AriaNumberField>
                            ) : (
                              show(evaluate(evaluation, rate, l.unitCost, z.areaHa), l.line.baseUnit)
                            )}
                          </td>
                        )
                      })}
                      <td className={cx(td, 'text-right tabular whitespace-nowrap font-medium')}>{show(total, l.line.baseUnit)}</td>
                      <td className={cx(td, 'whitespace-nowrap')}>
                        {canEdit && l.editable && (
                          <span className="inline-flex gap-0.5">
                            <AriaButton aria-label={t('cultivation.zones.distribute')} className={buttonClass('ghost', 'icon-xs')} onPress={() => onDistribute(l)}>
                              <Wand2 className="size-3.5" />
                            </AriaButton>
                            <AriaButton aria-label={t('cultivation.zones.makeUniform')} className={buttonClass('ghost', 'icon-xs')} isDisabled={!r} onPress={() => onRates(l, null)}>
                              <Equal className="size-3.5" />
                            </AriaButton>
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                })
              ),
            ]
          })}
        </tbody>
        {summary.length > 0 && (
          <tfoot>
            {summary.map((row) => {
              const mean = fieldArea > 0 && row.values.every((v) => v != null) ? zones.reduce((s, z, i) => s + row.values[i]! * z.areaHa, 0) / fieldArea : null
              const cell = (v: number | null) => (
                <span className={cx(v != null && row.tone?.(v) === 'negative' && 'text-danger', v != null && row.tone?.(v) === 'positive' && 'text-success')}>{v == null ? '—' : row.format(v)}</span>
              )
              return (
                <tr key={row.key} className={row.strong ? 'font-semibold' : undefined}>
                  <td className={cx(td, 'bg-surface-2/40')}>{row.label}</td>
                  {showMoney && <td className={cx(td, 'bg-surface-2/40')} />}
                  {row.values.map((v, i) => (
                    <td key={zones[i].zoneNo} className={cx(td, 'bg-surface-2/40 text-right tabular whitespace-nowrap')}>{cell(v)}</td>
                  ))}
                  <td className={cx(td, 'bg-surface-2/40 text-right tabular whitespace-nowrap')}>{mean == null ? '—' : <>Ø {cell(mean)}</>}</td>
                  <td className={cx(td, 'bg-surface-2/40')} />
                </tr>
              )
            })}
          </tfoot>
        )}
      </table>
    </div>
  )
}
