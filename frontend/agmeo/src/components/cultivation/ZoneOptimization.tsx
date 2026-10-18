import {
  columnNameFrom,
  roundRate,
  type CropCycle,
  type EconomicsSummary,
  type FertilizerNeed,
  type Field,
  type Operation,
  type Product,
  type ProductivityState,
  type VraInputType,
  type VraMapInput,
  type VraMapSummary,
  type Zoning,
} from '@agmeo/contracts'
import { useQueries, type UseQueryResult } from '@tanstack/react-query'
import { BarChart2, Droplets, Eye, Layers, Leaf, RotateCcw, Save, Shield, SigmaIcon, Sprout, Wand2, type LucideIcon } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ColumnChart } from '#/components/charts'
import { initialState, toPayload } from '#/components/operations/OperationForm'
import { api } from '#/lib/api'
import { fmt } from '#/lib/format'
import { useOrg } from '#/lib/org'
import { useOrgMutation, useOrgQuery } from '#/lib/queries'
import { Button, Link, SegmentedControl } from '#/ui/Button'
import { NumberField, Option, Select } from '#/ui/Field'
import { Badge, Card, DescriptionList, EmptyState, ErrorNotice, Loading, Notice, Tab, TabList, Tabs } from '#/ui/Layout'
import {
  EVALUATIONS,
  OPT_CATEGORIES,
  availableNPerUnit,
  categoryOf,
  distribute,
  lineKey,
  meanRate,
  rateIn,
  zoneLines,
  zoneYield,
  type Evaluation,
  type OptCategory,
  type ZoneLine,
  type ZoneRates,
} from './zoneMath'
import { ZoneTable, type SummaryRow } from './ZoneTable'

/** Same icons as the operation category bar of the original agmeo. */
const CATEGORY_ICONS: Record<OptCategory, LucideIcon> = {
  total: SigmaIcon,
  tillage: Layers,
  sowing: Sprout,
  fertilization: Leaf,
  crop_protection: Shield,
  irrigation: Droplets,
  harvest: BarChart2,
  other: Eye,
}

/** The zone rates of the line in focus, for the map legend. */
export interface ZoneFocus {
  label: string
  unit: string
  rates: Record<string, number>
}

const round2 = (v: number) => Math.round(v * 100) / 100

/**
 * Zone-specific optimization, after the optimization page of the original agmeo: per category
 * the product lines of the crop's operations with a rate per productivity zone, summed up per
 * hectare or for the field, with the N balance (fertilization) and margins (total) per zone.
 * Zone rates are kept as the variable-rate map of their operation.
 */
export function ZoneOptimization({
  cycle,
  field,
  operations,
  productivity,
  maps,
  zonings,
  zoning,
  onZoning,
  category,
  onCategory,
  onFocus,
}: {
  cycle: CropCycle
  field: Field
  operations: Operation[]
  productivity: UseQueryResult<ProductivityState>
  maps: VraMapSummary[]
  zonings: Zoning[]
  zoning: Zoning | null
  onZoning: (id: string) => void
  category: OptCategory
  onCategory: (c: OptCategory) => void
  onFocus: (f: ZoneFocus | null) => void
}) {
  const { t } = useTranslation()
  const { orgId, org, can } = useOrg()
  const canEdit = can('operation.write') && can('field.write')
  const showMoney = can('finance.read')
  const products = useOrgQuery<Product[]>('/products')
  const economics = useOrgQuery<EconomicsSummary>('/economics/summary', { seasonId: cycle.seasonId }, { enabled: showMoney })
  const [evaluation, setEvaluation] = useState<Evaluation>('avgQtyPerHa')
  const [edits, setEdits] = useState<Record<string, ZoneRates | null>>({})
  const [focusKey, setFocusKey] = useState<string | null>(null)
  const [yieldLevel, setYieldLevel] = useState(cycle.expectedYieldTHa ?? NaN)
  const [price, setPrice] = useState(cycle.expectedPricePerT ?? NaN)
  useEffect(() => setEdits({}), [zoning?.id])
  useEffect(() => {
    setYieldLevel(cycle.expectedYieldTHa ?? NaN)
    setPrice(cycle.expectedPricePerT ?? NaN)
  }, [cycle.expectedYieldTHa, cycle.expectedPricePerT])

  const zones = zoning?.zones ?? []
  const lines = useMemo(() => zoneLines(operations, maps, products.data ?? [], zoning?.id ?? null), [operations, maps, products.data, zoning?.id])
  const ratesOf = (l: ZoneLine) => (l.key in edits ? edits[l.key] : l.savedRates)
  const groups = useMemo(
    () =>
      operations
        .filter((op) => category === 'total' || categoryOf(op.type) === category)
        .sort((a, b) => (a.performedAt ?? a.plannedOn ?? '9999').localeCompare(b.performedAt ?? b.plannedOn ?? '9999'))
        .map((op) => ({ op, lines: lines.filter((l) => l.op.id === op.id) })),
    [operations, lines, category],
  )
  const shownLines = groups.flatMap((g) => g.lines)
  const dirty = Object.keys(edits).length > 0

  // The map shows the rates of the line in focus (or the first line of the category).
  const focusLine = shownLines.find((l) => l.key === focusKey) ?? shownLines[0] ?? null
  const focusRates = focusLine ? ratesOf(focusLine) : null
  useEffect(() => {
    if (!focusLine || !zoning) return onFocus(null)
    onFocus({
      label: focusLine.line.productName,
      unit: `${focusLine.line.baseUnit === 'm3' ? 'm³' : focusLine.line.baseUnit}/ha`,
      rates: Object.fromEntries(zoning.zones.map((z) => [String(z.zoneNo), rateIn(focusRates, focusLine.flatRate, z.zoneNo)])),
    })
  }, [focusLine?.key, JSON.stringify(focusRates), zoning?.id])
  useEffect(() => () => onFocus(null), [onFocus])

  // N balance per zone: the DüV need at the zone's expected yield.
  const needed = category === 'fertilization' && !!zoning
  const fieldNeed = useOrgQuery<FertilizerNeed>(needed ? `/crop-cycles/${cycle.id}/fertilizer-need` : null)
  const zoneNeeds = useQueries({
    queries: zones.map((z) => {
      const y = Number.isNaN(yieldLevel) ? null : Math.round(zoneYield(yieldLevel, z) * 10) / 10
      return {
        queryKey: ['org', orgId, 'fertilizer-need-preview', cycle.id, y],
        queryFn: () => api.post<FertilizerNeed>(`/orgs/${orgId}/crop-cycles/${cycle.id}/fertilizer-need/preview`, { expectedYieldTHa: y }),
        enabled: needed && y != null,
        staleTime: 60_000,
      }
    }),
  })

  const save = useOrgMutation(
    async (base, _: void) => {
      if (!zoning) return
      const opIds = [...new Set(Object.keys(edits).map((k) => k.split(':')[0]))]
      for (const opId of opIds) {
        const op = operations.find((o) => o.id === opId)
        if (!op) continue
        const opLines = lines.filter((l) => l.op.id === opId && l.vra && l.inputType)
        const existing = maps.find((m) => m.operationId === opId)
        const zoned = opLines.filter((l) => ratesOf(l))
        if (!zoned.length) {
          if (existing) await api.delete(`${base}/fields/${field.id}/vra-maps/${existing.id}`)
        } else {
          const columns = new Set<string>()
          const inputs = opLines.slice(0, 6).map((l, i) => {
            const unit = l.vra!.unit
            const r = ratesOf(l)
            let column = columnNameFrom(l.line.productName) || `P${i + 1}`
            if (columns.has(column)) column = `${column.slice(0, 5)}${i + 1}`
            columns.add(column)
            return {
              inputType: l.inputType as VraInputType,
              productId: l.line.productId,
              cropId: l.inputType === 'sowing' ? cycle.cropId : null,
              name: l.line.productName,
              unit,
              standardRate: roundRate(meanRate(r, l.flatRate, zones) * l.vra!.factor, unit) || null,
              columnName: column,
              rates: Object.fromEntries(zones.map((z) => [String(z.zoneNo), roundRate(rateIn(r, l.flatRate, z.zoneNo) * l.vra!.factor, unit)])),
            }
          })
          const body: VraMapInput = {
            zoningId: zoning.id,
            type: inputs.length === 1 ? inputs[0].inputType : 'several',
            title: op.title.slice(0, 120),
            status: 'draft',
            inputs,
            operationId: op.id,
            ...(existing ? { version: existing.version } : {}),
          }
          if (existing) await api.put(`${base}/fields/${field.id}/vra-maps/${existing.id}`, body)
          else await api.post(`${base}/fields/${field.id}/vra-maps`, body)
        }
        // Planned work on this field alone takes the mean of the zones as its uniform rate.
        if ((op.status === 'planned' || op.status === 'in_progress') && op.fields.every((f) => f.fieldId === field.id)) {
          const s = initialState({ farmId: op.farmId, fields: [field], operation: op })
          const productCost = new Map((products.data ?? []).map((p) => [p.id, p.unitCost]))
          let changed = false
          s.inputs = s.inputs.map((input, i) => {
            // The API returns the line's own cost or the product's; only a cost of its own is sent back.
            const own = op.inputs[i].unitCost
            input = { ...input, unitCost: own != null && own !== productCost.get(op.inputs[i].productId) ? own : NaN }
            const l = lines.find((x) => x.key === lineKey(op.id, op.inputs[i].id))
            if (!l || !l.vra) return input
            const mean = round2(meanRate(ratesOf(l), l.flatRate, zones))
            if (Math.abs(mean - (input.ratePerHa || 0)) < 0.005) return input
            changed = true
            return { ...input, ratePerHa: mean }
          })
          if (changed) await api.put(`${base}/operations/${op.id}`, { ...toPayload(s, [field], op.version), status: op.status })
        }
      }
    },
    { success: t('cultivation.zones.saved'), onSuccess: () => setEdits({}) },
  )
  const saveExpectation = useOrgMutation(
    (base, _: void) => api.patch<CropCycle>(`${base}/crop-cycles/${cycle.id}`, { expectedYieldTHa: Number.isNaN(yieldLevel) ? null : yieldLevel, expectedPricePerT: Number.isNaN(price) ? null : price }),
    { success: t('crops.updated') },
  )

  const analysis = productivity.data?.analysis ?? null
  if (productivity.isLoading) return <Loading />
  if (productivity.error) return <ErrorNotice error={productivity.error} />
  if (!analysis || !zoning) {
    return <NoZones fieldId={field.id} pending={!!productivity.data?.pending} />
  }

  // --- Summary rows ------------------------------------------------------------------------
  const currency = org.currency
  const money = (v: number) => fmt.money(v, currency, 0)
  const product = new Map((products.data ?? []).map((p) => [p.id, p]))
  const costIn = (ls: ZoneLine[]) => zones.map((z) => ls.reduce((s, l) => s + rateIn(ratesOf(l), l.flatRate, z.zoneNo) * (l.unitCost ?? 0), 0))
  const summary: SummaryRow[] = []
  if (category !== 'total' && category !== 'harvest' && showMoney && shownLines.length) {
    summary.push({ key: 'direct', label: t('cultivation.zones.row.directCategory', { category: t(`cultivation.category.${category}`) }), values: costIn(shownLines), format: (v) => `${money(v)}/ha` })
  }
  let nValues: number[] = []
  let needValues: (number | null)[] = []
  if (category === 'fertilization') {
    const nLines = shownLines.map((l) => ({ l, perUnit: availableNPerUnit(l.line, product.get(l.line.productId)) })).filter((x) => x.perUnit != null)
    nValues = zones.map((z) => nLines.reduce((s, x) => s + rateIn(ratesOf(x.l), x.l.flatRate, z.zoneNo) * x.perUnit!, 0))
    needValues = zoneNeeds.map((q) => {
      const n = q.data?.n
      return n ? n.need : null
    })
    summary.push(
      { key: 'n', label: t('cultivation.zones.row.availableN'), values: nValues, format: (v) => `${fmt.num(v)} kg N/ha` },
      { key: 'need', label: t('cultivation.zones.row.nNeed'), values: needValues, format: (v) => `${fmt.num(v)} kg N/ha` },
      {
        key: 'balance',
        label: t('cultivation.zones.row.nBalance'),
        values: needValues.map((need, i) => (need == null ? null : need - nValues[i])),
        format: (v) => `${v > 0 ? '+' : ''}${fmt.num(v)} kg N/ha`,
        strong: true,
        tone: (v) => (v < -10 ? 'negative' : null),
      },
    )
  }
  const yields = zones.map((z) => (Number.isNaN(yieldLevel) ? null : zoneYield(yieldLevel, z)))
  if (category === 'total' || category === 'harvest') {
    summary.push({ key: 'yield', label: t('cultivation.zones.row.yield'), values: yields, format: (v) => `${fmt.fixed(v, 1)} t/ha` })
    if (showMoney) {
      const ce = economics.data?.cycles.find((c) => c.cropCycleId === cycle.id)
      const work = ce && ce.areaHa > 0 ? (ce.machineryCosts + ce.laborCosts || (ce.planned ? ce.planned.machineryCosts + ce.planned.laborCosts : 0)) / ce.areaHa : 0
      const revenue = yields.map((y) => (y == null || Number.isNaN(price) ? null : y * price))
      const direct = costIn(lines)
      summary.push(
        { key: 'revenue', label: t('cultivation.zones.row.revenue'), values: revenue, format: (v) => `${money(v)}/ha` },
        { key: 'direct', label: t('cultivation.zones.row.direct'), values: direct, format: (v) => `${money(v)}/ha` },
        { key: 'work', label: t('cultivation.zones.row.work'), values: zones.map(() => work), format: (v) => `${money(v)}/ha` },
        {
          key: 'db2',
          label: t('cultivation.zones.row.db2'),
          values: revenue.map((r, i) => (r == null ? null : r - direct[i] - work)),
          format: (v) => `${money(v)}/ha`,
          strong: true,
          tone: (v) => (v < 0 ? 'negative' : 'positive'),
        },
      )
    }
  }
  const db2 = summary.find((r) => r.key === 'db2')

  const editableShown = shownLines.filter((l) => l.editable)
  const yieldChanged = (Number.isNaN(yieldLevel) ? null : yieldLevel) !== cycle.expectedYieldTHa || (Number.isNaN(price) ? null : price) !== cycle.expectedPricePerT

  return (
    <div className="space-y-4">
      <Tabs selectedKey={category} onSelectionChange={(k) => onCategory(k as OptCategory)}>
        <TabList aria-label={t('cultivation.zones.categories')}>
          {OPT_CATEGORIES.map((c) => {
            const Icon = CATEGORY_ICONS[c]
            const n = c === 'total' ? operations.length : operations.filter((o) => categoryOf(o.type) === c).length
            return (
              <Tab key={c} id={c} className="inline-flex items-center gap-1.5">
                <Icon className="size-4" aria-hidden /> {t(`cultivation.category.${c}`)}
                {n > 0 && <span className="text-xs text-muted tabular">{n}</span>}
              </Tab>
            )
          })}
        </TabList>
      </Tabs>

      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold mr-auto">{t('cultivation.zones.title', { category: t(`cultivation.category.${category}`) })}</h2>
        {dirty ? <Badge tone="warning">{t('cultivation.zones.unsaved')}</Badge> : null}
        <SegmentedControl
          aria-label={t('cultivation.zones.zoneCount')}
          items={zonings.map((z) => ({ id: z.id, label: `${t('cultivation.zones.zonesShort', { count: z.zoneCount })}${z.isCustom ? ' *' : ''}` }))}
          value={zoning.id}
          onChange={(id) => (dirty ? null : onZoning(id))}
          isDisabled={dirty}
        />
        <Select
          aria-label={t('cultivation.zones.evaluationLabel')}
          className="w-44"
          items={EVALUATIONS.filter((e) => showMoney || e === 'avgQtyPerHa' || e === 'totalQty').map((e) => ({ id: e, name: t(`cultivation.zones.evaluation.${e}`) }))}
          value={evaluation}
          onChange={(v) => v && setEvaluation(v as Evaluation)}
        >
          {(e) => <Option id={e.id}>{e.name}</Option>}
        </Select>
        {canEdit && (
          <>
            <Button size="sm" isDisabled={!editableShown.length} onPress={() => setEdits((prev) => ({ ...prev, ...Object.fromEntries(editableShown.map((l) => [l.key, distribute(l.flatRate, zones, l.vra?.unit ?? null)])) }))}>
              <Wand2 /> {t('cultivation.zones.distributeAll')}
            </Button>
            <Button size="sm" isDisabled={!dirty} onPress={() => setEdits({})}>
              <RotateCcw /> {t('common.reset')}
            </Button>
            <Button size="sm" variant="primary" isDisabled={!dirty} isPending={save.isPending} onPress={() => save.mutate()}>
              <Save /> {t('common.save')}
            </Button>
          </>
        )}
      </div>

      {(category === 'fertilization' || category === 'total' || category === 'harvest') && (
        <div className="grid lg:grid-cols-[18rem_1fr] gap-4 items-start">
          <Card title={t('cultivation.zones.parameters')}>
            <div className="space-y-3">
              <NumberField label={t('cultivation.zones.yieldLevel')} unit="t/ha" minValue={0} step={0.1} formatOptions={{ maximumFractionDigits: 2 }} value={yieldLevel} onChange={setYieldLevel} />
              {showMoney && <NumberField label={t('cultivation.zones.productPrice')} unit={`${currency === 'EUR' ? '€' : currency}/t`} minValue={0} value={price} onChange={setPrice} />}
              <p className="text-xs text-muted">{t('cultivation.zones.parametersHint')}</p>
              {can('crop.write') && yieldChanged && (
                <Button size="sm" onPress={() => saveExpectation.mutate()} isPending={saveExpectation.isPending}>
                  {t('cultivation.zones.applyExpectation')}
                </Button>
              )}
              {category === 'fertilization' && <NeedSummary need={fieldNeed} />}
            </div>
          </Card>
          {category === 'fertilization' ? (
            <Card title={t('cultivation.zones.nChart')} description={t('cultivation.zones.nChartHint')}>
              <ColumnChart
                ariaLabel={t('cultivation.zones.nChart')}
                series={[
                  { name: t('cultivation.zones.row.nNeed'), color: 'var(--color-series-2)' },
                  { name: t('cultivation.zones.row.availableN'), color: 'var(--color-series-1)' },
                ]}
                data={zones.map((z, i) => ({ key: String(z.zoneNo), label: t('cultivation.zone', { number: z.zoneNo }), values: [needValues[i] ?? null, nValues[i] ?? null] }))}
                format={(v) => `${fmt.num(v)} kg`}
              />
            </Card>
          ) : db2 ? (
            <Card title={t('cultivation.zones.marginChart')} description={t('cultivation.zones.marginChartHint')}>
              <ColumnChart
                ariaLabel={t('cultivation.zones.marginChart')}
                series={[{ name: t('cultivation.zones.row.db2'), color: 'var(--color-series-1)' }]}
                data={zones.map((z, i) => ({ key: String(z.zoneNo), label: t('cultivation.zone', { number: z.zoneNo }), values: [db2.values[i]] }))}
                format={(v) => `${money(v)}`}
              />
            </Card>
          ) : (
            <Card title={t('cultivation.zones.yieldChart')}>
              <ColumnChart
                ariaLabel={t('cultivation.zones.yieldChart')}
                series={[{ name: t('cultivation.zones.row.yield'), color: 'var(--color-series-1)' }]}
                data={zones.map((z, i) => ({ key: String(z.zoneNo), label: t('cultivation.zone', { number: z.zoneNo }), values: [yields[i]] }))}
                format={(v) => `${fmt.fixed(v, 1)} t`}
              />
            </Card>
          )}
        </div>
      )}

      {!analysis.current && <Notice tone="warning">{t('cultivation.zones.outdated')}</Notice>}

      <Card padded={false}>
        <ZoneTable
          zones={zones}
          zoneCount={zoning.zoneCount}
          groups={groups}
          rates={ratesOf}
          onRates={(l, r) => setEdits((prev) => ({ ...prev, [l.key]: r }))}
          onDistribute={(l) => setEdits((prev) => ({ ...prev, [l.key]: distribute(l.flatRate, zones, l.vra?.unit ?? null) }))}
          evaluation={evaluation}
          currency={currency}
          showMoney={showMoney}
          canEdit={canEdit}
          focusKey={focusLine?.key ?? null}
          onFocus={setFocusKey}
          maps={maps}
          fieldId={field.id}
          summary={summary}
          emptyText={
            <span className="inline-flex flex-col items-center gap-2">
              {t('cultivation.zones.empty')}
              {can('operation.write') && category !== 'total' && (
                <Link to="/o/$orgId/operations/new" params={{ orgId }} search={{ fieldId: field.id, type: category === 'other' ? 'other' : category }} variant="quiet" size="sm">
                  {t('fieldOps.plan')}
                </Link>
              )}
            </span>
          }
        />
      </Card>
      <p className="text-xs text-muted">{t('cultivation.zones.method')}</p>
    </div>
  )
}

/** The field's N need (DüV), as the zone needs are derived from it. */
function NeedSummary({ need }: { need: UseQueryResult<FertilizerNeed> }) {
  const { t } = useTranslation()
  const { orgId } = useOrg()
  if (need.isLoading) return <Loading />
  const n = need.data?.n
  if (!n) return <p className="text-xs text-muted">{t('cultivation.zones.noNeed')}</p>
  const deductions = n.humusDeduction + n.organicPreviousYearDeduction + n.previousCropDeduction + n.catchCropDeduction + n.zoneReduction
  return (
    <div className="border-t border-line pt-3 space-y-2">
      <div className="text-sm font-medium">{t('cultivation.zones.fieldNeed')}</div>
      <DescriptionList
        items={[
          { label: t('cultivation.zones.need.requirement'), value: `${fmt.num(n.nRequirement + n.yieldCorrection)} kg` },
          { label: 'Nmin', value: `− ${fmt.num(n.nmin)} kg` },
          { label: t('cultivation.zones.need.deductions'), value: `− ${fmt.num(deductions - n.filmSurcharge)} kg` },
          { label: t('cultivation.zones.need.total'), value: <strong className="tabular">{fmt.num(need.data?.lastRecord?.n ?? n.need)} kg N/ha</strong> },
        ]}
      />
      <Link to="/o/$orgId/nutrients" params={{ orgId }} variant="quiet" size="sm">{t('cultivation.zones.needLink')}</Link>
    </div>
  )
}

function NoZones({ fieldId, pending }: { fieldId: string; pending: boolean }) {
  const { t } = useTranslation()
  const { orgId, can } = useOrg()
  const calculate = useOrgMutation((base, _: void) => api.post<ProductivityState>(`${base}/fields/${fieldId}/productivity`, { excludedSceneIds: [] }), {
    success: t('zones.recalculationQueued'),
  })
  if (pending) return <Notice>{t('cultivation.zones.calculating')}</Notice>
  return (
    <Card>
      <EmptyState
        icon={Layers}
        title={t('cultivation.zones.noZones.title')}
        action={
          <div className="flex gap-2">
            {can('field.write') && (
              <Button variant="primary" onPress={() => calculate.mutate()} isPending={calculate.isPending}>
                {t('zones.empty.action')}
              </Button>
            )}
            <Link to="/o/$orgId/fields/$fieldId" params={{ orgId, fieldId }} search={{ tab: 'zones' }} variant="secondary">
              {t('cultivation.zones.noZones.open')}
            </Link>
          </div>
        }
      >
        {t('cultivation.zones.noZones.description')}
      </EmptyState>
    </Card>
  )
}
