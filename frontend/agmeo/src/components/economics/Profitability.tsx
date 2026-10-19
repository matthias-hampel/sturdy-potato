import type { FarmProfitability, Field, FieldProfitability } from '@agmeo/contracts'
import { AlertTriangle, CheckCircle2, ListChecks, Map as MapIcon, Tag, TrendingDown, TrendingUp } from 'lucide-react'
import { useMemo, useState } from 'react'
import { type SortDescriptor } from 'react-aria-components'
import { useTranslation } from 'react-i18next'
import { CropTag } from '#/components/labels'
import { FieldMap } from '#/components/map/FieldMap'
import { t } from '#/i18n'
import { fmt } from '#/lib/format'
import { useOrg } from '#/lib/org'
import { useOrgQuery } from '#/lib/queries'
import { Link, SegmentedControl } from '#/ui/Button'
import { Badge, Card, EmptyState, ErrorNotice, Loading, Stat } from '#/ui/Layout'
import { ModalDialog } from '#/ui/Overlay'
import { Cell, Column, Row, Table, TableBody, TableHeader } from '#/ui/Table'
import { cx } from '#/ui/utils'

/** Per-hectare values that are summed area-weighted when rows are grouped. */
const PER_HA_KEYS = [
  'revenue', 'seedCost', 'fertilizerCost', 'protectionCost', 'otherDirectCost', 'directCosts', 'dfl', 'machineryCosts', 'db1', 'laborCosts', 'db2',
  'buildingCosts', 'leasePerHa', 'landCosts', 'rightsCosts', 'singleCostFreeMargin', 'overhead', 'resultBeforeSubsidies', 'subsidiesPerHa', 'farmResult',
  'dieselLHa', 'hoursHa', 'nKgHa',
] as const
type PerHaKey = (typeof PER_HA_KEYS)[number]

export interface ProfitRow extends Record<PerHaKey, number> {
  id: string
  label: string
  color: string | null
  areaHa: number
  yieldTHa: number | null
  passes: number
  count: number
  fields: FieldProfitability[]
}

/** Area-weighted aggregation (reference: profitability/aggregate.ts weightedAverage). */
export function aggregate(id: string, label: string, color: string | null, list: FieldProfitability[]): ProfitRow {
  const area = list.reduce((s, f) => s + f.areaHa, 0)
  const w = (k: PerHaKey) => (area ? list.reduce((s, f) => s + f[k] * f.areaHa, 0) / area : 0)
  const withYield = list.filter((f) => f.yieldTHa != null)
  const yieldArea = withYield.reduce((s, f) => s + f.areaHa, 0)
  return {
    id,
    label,
    color,
    areaHa: area,
    yieldTHa: yieldArea ? withYield.reduce((s, f) => s + f.yieldTHa! * f.areaHa, 0) / yieldArea : null,
    passes: list.reduce((s, f) => s + f.passes, 0),
    count: list.length,
    fields: list,
    ...(Object.fromEntries(PER_HA_KEYS.map((k) => [k, w(k)])) as Record<PerHaKey, number>),
  }
}

type Level = 'field' | 'crop' | 'group'

function rowsOf(fields: FieldProfitability[], level: Level): ProfitRow[] {
  if (level === 'field') return fields.map((f) => aggregate(f.cropCycleId, f.fieldName, f.cropColor, [f]))
  const groups = new Map<string, { label: string; color: string | null; list: FieldProfitability[] }>()
  for (const f of fields) {
    const keys = level === 'crop' ? [{ id: f.cropId, label: f.cropName, color: f.cropColor }] : f.groups.length ? f.groups : [{ id: '__none', name: t('profitability.noGroup'), color: null }]
    for (const k of keys) {
      const id = k.id
      const label = 'label' in k ? k.label : k.name
      const g = groups.get(id) ?? { label, color: k.color, list: [] }
      g.list.push(f)
      groups.set(id, g)
    }
  }
  return [...groups.entries()].map(([id, g]) => aggregate(id, g.label, g.color, g.list))
}

/**
 * Colour for DB I per ha (reference cm1ColorScale): red below zero, then yellow to green. Hex
 * values, since map paint cannot resolve CSS variables.
 */
export function cm1Color(v: number, max: number): string {
  if (v < 0) return '#c2410c'
  const share = max > 0 ? Math.min(1, v / max) : 0
  const from = [0xea, 0xb3, 0x08]
  const to = [0x15, 0x80, 0x3d]
  return `#${from.map((c, i) => Math.round(c + (to[i] - c) * share).toString(16).padStart(2, '0')).join('')}`
}

const COLUMNS: { key: PerHaKey | 'areaHa' | 'yieldTHa' | 'passes'; label: string; money?: boolean; digits?: number }[] = [
  { key: 'areaHa', label: 'profitability.col.area', digits: 2 },
  { key: 'yieldTHa', label: 'profitability.col.yield', digits: 1 },
  { key: 'revenue', label: 'profitability.col.revenue', money: true },
  { key: 'directCosts', label: 'profitability.col.directCosts', money: true },
  { key: 'dfl', label: 'profitability.col.dfl', money: true },
  { key: 'db1', label: 'profitability.col.db1', money: true },
  { key: 'db2', label: 'profitability.col.db2', money: true },
  { key: 'farmResult', label: 'profitability.col.farmResult', money: true },
  { key: 'dieselLHa', label: 'profitability.col.diesel', digits: 1 },
  { key: 'hoursHa', label: 'profitability.col.hours', digits: 2 },
  { key: 'nKgHa', label: 'profitability.col.n', digits: 0 },
  { key: 'passes', label: 'profitability.col.passes', digits: 0 },
]

export function ProfitabilityTab({ seasonId }: { seasonId: string }) {
  const { t } = useTranslation()
  const { orgId } = useOrg()
  const data = useOrgQuery<FarmProfitability | null>('/economics/profitability', { seasonId })
  const fields = useOrgQuery<Field[]>('/fields', { seasonId })
  const [level, setLevel] = useState<Level>('field')
  const [crop, setCrop] = useState<string | null>(null)
  const [sort, setSort] = useState<SortDescriptor>({ column: 'db2', direction: 'descending' })
  const [detail, setDetail] = useState<ProfitRow | null>(null)
  const [showMap, setShowMap] = useState(false)

  const p = data.data
  const visible = useMemo(() => (p?.fields ?? []).filter((f) => !crop || f.cropId === crop), [p, crop])
  const rows = useMemo(() => {
    const list = rowsOf(visible, level)
    const key = sort.column as keyof ProfitRow
    const dir = sort.direction === 'ascending' ? 1 : -1
    return list.sort((a, b) => (((a[key] as number | null) ?? -Infinity) - ((b[key] as number | null) ?? -Infinity)) * dir)
  }, [visible, level, sort])

  if (data.isLoading) return <Loading />
  if (data.error) return <ErrorNotice error={data.error} />
  if (!p || p.fields.length === 0) return <Card><EmptyState icon={Tag} title={t('profitability.empty')} /></Card>

  const m = (v: number | null | undefined, digits = 0) => fmt.money(v, p.currency, digits)
  const farm = aggregate('farm', t('profitability.farm'), null, visible)
  const crops = [...new Map(p.fields.map((f) => [f.cropId, { id: f.cropId, name: f.cropName, color: f.cropColor }])).values()]
  const byField = new Map(p.fields.map((f) => [f.fieldId, f]))
  const maxDb1 = Math.max(0, ...p.fields.map((f) => f.db1))
  const ranked = [...visible].sort((a, b) => b.db2 - a.db2)

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 xl:grid-cols-5 gap-4">
        <Stat label={t('profitability.kpi.area')} value={fmt.ha(farm.areaHa)} />
        <Stat label={t('profitability.kpi.revenue')} value={`${m(farm.revenue)}/ha`} />
        <Stat label={t('profitability.kpi.db1')} value={`${m(farm.db1)}/ha`} />
        <Stat label={t('profitability.kpi.db2')} value={`${m(farm.db2)}/ha`} tone={farm.db2 < 0 ? 'danger' : 'default'} />
        <Stat label={t('profitability.kpi.farmResult')} value={`${m(farm.farmResult)}/ha`} hint={t('profitability.kpi.subsidies', { amount: m(p.subsidies.perHa) })} tone={farm.farmResult < 0 ? 'danger' : 'success'} />
      </div>

      <CoverageCard p={p} />

      <div className="flex flex-wrap items-center gap-3">
        <SegmentedControl<Level>
          aria-label={t('profitability.level.label')}
          value={level}
          onChange={setLevel}
          items={[
            { id: 'field', label: t('profitability.level.field') },
            { id: 'crop', label: t('profitability.level.crop') },
            { id: 'group', label: t('profitability.level.group') },
          ]}
        />
        <div className="flex flex-wrap gap-1.5">
          <button type="button" onClick={() => setCrop(null)} className={cx('rounded-full border px-2.5 py-0.5 text-xs', !crop ? 'border-primary bg-primary-soft text-primary' : 'border-line')}>
            {t('profitability.allCrops')}
          </button>
          {crops.map((c) => (
            <button key={c.id} type="button" onClick={() => setCrop(crop === c.id ? null : c.id)} className={cx('rounded-full border px-2.5 py-0.5 text-xs', crop === c.id ? 'border-primary bg-primary-soft text-primary' : 'border-line')}>
              <CropTag name={c.name} color={c.color} />
            </button>
          ))}
        </div>
        <button type="button" onClick={() => setShowMap((v) => !v)} className="ml-auto inline-flex items-center gap-1.5 text-sm text-primary">
          <MapIcon className="size-4" aria-hidden /> {showMap ? t('profitability.hideMap') : t('profitability.showMap')}
        </button>
      </div>

      {showMap && fields.data && (
        <Card padded={false} title={t('profitability.map.title')} description={t('profitability.map.description')}>
          <FieldMap
            fields={fields.data.filter((f) => byField.has(f.id))}
            className="h-96"
            labels
            colorBy={(f) => {
              const r = byField.get(f.id)
              return r ? cm1Color(r.db1, maxDb1) : null
            }}
            fillOpacity={0.75}
          />
        </Card>
      )}

      <Card padded={false}>
        <Table aria-label={t('profitability.table')} sortDescriptor={sort} onSortChange={setSort} onRowAction={(key) => setDetail(rows.find((r) => r.id === key) ?? null)}>
          <TableHeader>
            <Column id="label" isRowHeader>
              {level === 'field' ? t('profitability.level.field') : level === 'crop' ? t('profitability.level.crop') : t('profitability.level.group')}
            </Column>
            {COLUMNS.map((c) => (
              <Column key={c.key} id={c.key} align="end" allowsSorting>
                {t(c.label)}
              </Column>
            ))}
          </TableHeader>
          <TableBody items={rows} dependencies={[level, p.currency]}>
            {(r) => (
              <Row id={r.id}>
                <Cell>
                  <div className="font-medium flex items-center gap-2 min-w-40">
                    {r.color && <span className="size-2.5 rounded-full shrink-0" style={{ background: r.color }} aria-hidden />}
                    {r.label}
                  </div>
                  {level === 'field' && <div className="text-xs text-muted">{r.fields[0].cropName}</div>}
                  {level !== 'field' && <div className="text-xs text-muted">{t('profitability.count', { count: r.count })}</div>}
                </Cell>
                {COLUMNS.map((c) => {
                  const v = r[c.key] as number | null
                  return (
                    <Cell key={c.key} align="end" className={cx('tabular whitespace-nowrap', c.money && v != null && v < 0 && 'text-danger')}>
                      {v == null ? '—' : c.key === 'areaHa' ? fmt.ha(v) : c.money ? m(v) : fmt.num(v, c.digits ?? 0)}
                    </Cell>
                  )
                })}
              </Row>
            )}
          </TableBody>
        </Table>
        <p className="px-4 py-2 text-xs text-muted border-t border-line">{t('profitability.perHaHint')}</p>
      </Card>

      <div className="grid lg:grid-cols-2 gap-6 items-start">
        <Card title={t('profitability.waterfall.title')} description={t('profitability.waterfall.farm')}>
          <Waterfall row={farm} money={m} />
        </Card>
        <Card title={t('profitability.ranking.title')} description={t('profitability.ranking.description')}>
          <Ranking list={ranked} money={m} onOpen={(f) => setDetail(aggregate(f.cropCycleId, f.fieldName, f.cropColor, [f]))} />
        </Card>
      </div>

      <ModalDialog isOpen={!!detail} onOpenChange={(open) => !open && setDetail(null)} title={detail?.label ?? ''} size="lg">
        {() =>
          detail && (
            <div className="space-y-4">
              <p className="text-sm text-muted">
                {fmt.ha(detail.areaHa)}
                {detail.yieldTHa != null && ` · ${t('profitability.yield', { value: fmt.num(detail.yieldTHa, 1) })}`}
                {` · ${t('profitability.physical', { diesel: fmt.num(detail.dieselLHa, 1), hours: fmt.num(detail.hoursHa, 2), n: fmt.num(detail.nKgHa) })}`}
              </p>
              <Waterfall row={detail} money={m} />
              {detail.fields.length === 1 && (
                <Link to="/o/$orgId/crops/$cropCycleId" params={{ orgId, cropCycleId: detail.fields[0].cropCycleId }} variant="secondary" size="sm">
                  {t('profitability.openCycle')}
                </Link>
              )}
            </div>
          )
        }
      </ModalDialog>
    </div>
  )
}

/** The reference's extended waterfall from revenue to the farm result, per hectare. */
function Waterfall({ row: r, money }: { row: ProfitRow; money: (v: number) => string }) {
  const { t } = useTranslation()
  const steps: { key: string; value: number; total?: boolean }[] = [
    { key: 'revenue', value: r.revenue, total: true },
    { key: 'seedCost', value: -r.seedCost },
    { key: 'fertilizerCost', value: -r.fertilizerCost },
    { key: 'protectionCost', value: -r.protectionCost },
    { key: 'otherDirectCost', value: -r.otherDirectCost },
    { key: 'dfl', value: r.dfl, total: true },
    { key: 'machineryCosts', value: -r.machineryCosts },
    { key: 'db1', value: r.db1, total: true },
    { key: 'laborCosts', value: -(r.db1 - r.db2) },
    { key: 'db2', value: r.db2, total: true },
    { key: 'buildingCosts', value: -r.buildingCosts },
    { key: 'landCosts', value: -r.landCosts },
    { key: 'rightsCosts', value: -r.rightsCosts },
    { key: 'singleCostFreeMargin', value: r.singleCostFreeMargin, total: true },
    { key: 'overhead', value: -r.overhead },
    { key: 'resultBeforeSubsidies', value: r.resultBeforeSubsidies, total: true },
    { key: 'subsidiesPerHa', value: r.subsidiesPerHa },
    { key: 'farmResult', value: r.farmResult, total: true },
  ]
  const max = Math.max(1, ...steps.map((s) => Math.abs(s.value)))
  return (
    <ul className="space-y-1">
      {steps.map((s) => (
        <li key={s.key} className={cx('grid grid-cols-[11rem_1fr_6rem] items-center gap-2 text-sm', s.total && 'font-medium')}>
          <span className={cx('truncate', !s.total && 'text-fg-2 pl-3')}>{t(`profitability.step.${s.key}`)}</span>
          <span className="h-3 rounded-sm bg-surface-2 overflow-hidden">
            <span
              className="block h-full rounded-sm"
              style={{ width: `${(Math.abs(s.value) / max) * 100}%`, background: s.total ? (s.value < 0 ? 'var(--color-danger)' : 'var(--color-primary)') : s.value < 0 ? 'color-mix(in oklab, var(--color-danger) 55%, transparent)' : 'var(--color-success)' }}
            />
          </span>
          <span className={cx('text-right tabular', s.value < 0 && 'text-danger')}>{money(s.value)}</span>
        </li>
      ))}
    </ul>
  )
}

function Ranking({ list, money, onOpen }: { list: FieldProfitability[]; money: (v: number) => string; onOpen: (f: FieldProfitability) => void }) {
  const { t } = useTranslation()
  if (list.length < 2) return <p className="text-sm text-muted">{t('profitability.ranking.few')}</p>
  const top = list.slice(0, 5)
  const bottom = list.slice(-5).reverse().filter((f) => !top.includes(f))
  const item = (f: FieldProfitability) => (
    <li key={f.cropCycleId}>
      <button type="button" onClick={() => onOpen(f)} className="w-full flex items-center justify-between gap-2 text-sm py-1 hover:text-primary">
        <span className="truncate">
          {f.fieldName} <span className="text-muted">· {f.cropName}</span>
        </span>
        <span className={cx('tabular', f.db2 < 0 && 'text-danger')}>{money(f.db2)}/ha</span>
      </button>
    </li>
  )
  return (
    <div className="grid sm:grid-cols-2 gap-4">
      <div>
        <h4 className="text-xs font-medium text-muted flex items-center gap-1.5 mb-1"><TrendingUp className="size-3.5" /> {t('profitability.ranking.top')}</h4>
        <ul>{top.map(item)}</ul>
      </div>
      <div>
        <h4 className="text-xs font-medium text-muted flex items-center gap-1.5 mb-1"><TrendingDown className="size-3.5" /> {t('profitability.ranking.bottom')}</h4>
        <ul>{bottom.map(item)}</ul>
      </div>
    </div>
  )
}

/** How complete the records behind the figures are (reference CoverageStats). */
function CoverageCard({ p }: { p: FarmProfitability }) {
  const { t } = useTranslation()
  const { orgId } = useOrg()
  const [open, setOpen] = useState(false)
  const c = p.coverage
  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 100)
  const items = [
    { label: t('profitability.coverage.ops'), value: pct(c.documentedOps, c.totalOps), detail: `${c.documentedOps}/${c.totalOps}` },
    { label: t('profitability.coverage.prices'), value: pct(c.pricedProducts, c.totalProducts), detail: `${c.pricedProducts}/${c.totalProducts}` },
    { label: t('profitability.coverage.fields'), value: pct(c.fieldsWithCrop, c.totalFields), detail: `${c.fieldsWithCrop}/${c.totalFields}` },
  ]
  const complete = items.every((i) => i.value === 100)
  return (
    <Card padded={false}>
      <button type="button" onClick={() => setOpen((v) => !v)} className="w-full p-4 flex flex-wrap items-center gap-4 text-left">
        {complete ? <CheckCircle2 className="size-5 text-success" aria-hidden /> : <AlertTriangle className="size-5 text-warning" aria-hidden />}
        <span className="font-medium">{complete ? t('profitability.coverage.complete') : t('profitability.coverage.incomplete')}</span>
        <span className="flex flex-wrap gap-4 ml-auto">
          {items.map((i) => (
            <span key={i.label} className="text-sm">
              <span className="text-muted">{i.label}</span> <Badge tone={i.value === 100 ? 'success' : i.value >= 70 ? 'warning' : 'danger'}>{i.value} %</Badge>{' '}
              <span className="text-xs text-muted">{i.detail}</span>
            </span>
          ))}
        </span>
      </button>
      {open && (c.undocumentedOps.length > 0 || c.unpricedProducts.length > 0) && (
        <div className="border-t border-line p-4 grid md:grid-cols-2 gap-6 text-sm">
          {c.undocumentedOps.length > 0 && (
            <div>
              <h4 className="text-xs font-medium text-muted mb-2 flex items-center gap-1.5"><ListChecks className="size-3.5" /> {t('profitability.coverage.undocumented')}</h4>
              <ul className="space-y-1">
                {c.undocumentedOps.slice(0, 15).map((o) => (
                  <li key={o.operationId}>
                    <Link to="/o/$orgId/operations/$operationId" params={{ orgId, operationId: o.operationId }}>{o.title}</Link>
                    <span className="text-muted"> · {o.fieldName} · {o.cropName}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {c.unpricedProducts.length > 0 && (
            <div>
              <h4 className="text-xs font-medium text-muted mb-2 flex items-center gap-1.5"><Tag className="size-3.5" /> {t('profitability.coverage.unpriced')}</h4>
              <ul className="space-y-1">
                {c.unpricedProducts.map((x) => (
                  <li key={x.id}>{x.name}</li>
                ))}
              </ul>
              <Link to="/o/$orgId/prices" params={{ orgId }} size="sm" variant="secondary" className="mt-2">
                {t('profitability.coverage.setPrices')}
              </Link>
            </div>
          )}
        </div>
      )}
    </Card>
  )
}
