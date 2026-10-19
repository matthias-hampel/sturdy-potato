import {
  DEFAULT_GERMINATION_RATE,
  EQUIPMENT_GONE_STATUSES,
  SEED_PACKAGE_SIZES,
  distributeTotalSeedKg,
  grainsPerM2FromKgHa,
  kgHaFromGrainsPerM2,
  plantsPerM2FromGrains,
  seedPackagesForGrains,
  type Crop,
  type CropCycle,
  type Employee,
  type Equipment,
  type Field,
  type Operation,
  type OperationInputLine,
  type OperationType,
} from '@agmeo/contracts'
import { useNavigate } from '@tanstack/react-router'
import { Ban, CheckCircle2, Map as MapIcon, Pencil, Plus, Scale } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Form, type Selection } from 'react-aria-components'
import { useTranslation } from 'react-i18next'
import { FieldNameLink } from '#/components/crops/FieldNameLink'
import { CropTag, OperationStatusBadge } from '#/components/labels'
import { FieldShape } from '#/components/map/FieldShape'
import { initialState, toPayload } from '#/components/operations/OperationForm'
import { ColumnConfigButton, NoMatches, SelectionBar, selectedIds, useBulkMutation, useColumnConfig, useTableView, type ColumnDef, type FilterKind } from '#/components/table/tableTools'
import { t as tt } from '#/i18n'
import { api } from '#/lib/api'
import { fmt, today } from '#/lib/format'
import { useOrg, useSeason } from '#/lib/org'
import { useOrgQuery } from '#/lib/queries'
import { Button, Link } from '#/ui/Button'
import { Checkbox, DatePicker, NumberField, Option, Select, TextField } from '#/ui/Field'
import { Card, ErrorNotice, Loading, Notice } from '#/ui/Layout'
import { ConfirmButton, ModalDialog } from '#/ui/Overlay'
import { Cell, Column, Row, Table, TableBody, TableHeader } from '#/ui/Table'
import { cx } from '#/ui/utils'

export const OPERATION_TABS = ['tillage', 'base_fertilization', 'sowing', 'nitrogen', 'crop_protection', 'irrigation', 'harvest'] as const
export type OperationTab = (typeof OPERATION_TABS)[number]

/** One operation on one field, with what the field already received before it in this tab. */
interface Entry {
  op: Operation
  /** Treated area on this field, summed over its parts. */
  areaHa: number
  date: string | null
  cycle: CropCycle | null
  /** Running total of the tab's key figure (kg N/ha, mm) on this field up to and including this entry. */
  cumulative: number | null
}

/** A number kept in `details` that can be set on several operations at once. */
interface DetailEdit {
  key: string
  label: string
  unit?: string
  max: number
}

/** What column factories need besides the entry: crop codes and the season's field conditions. */
export interface ColumnCtx {
  cropCode: (cycle: CropCycle | null) => string | null
}

interface TabConfig {
  type: OperationType
  /** Which operations of the type belong in the tab (fertilization is split into base and N). */
  include?: (op: Operation) => boolean
  /** Key figure per entry that is summed up per field. */
  cumulative?: (op: Operation) => number | null
  columns: (ctx: ColumnCtx) => ColumnDef<Entry>[]
  /** Columns about the field rather than one operation (shown on the field's first row). */
  fieldColumns?: (orgId: string) => ColumnDef<GroupRow>[]
  /** Columns shown before the viewer picks their own; all when not set. */
  defaults?: string[]
  edits?: () => DetailEdit[]
  /** BBCH stage and target organism can be edited. */
  protection?: boolean
  /** Machine, implement, operator, diesel, electricity and working time can be edited. */
  work?: boolean
  /** Seed can be distributed over the selected fields. */
  seed?: boolean
}

const dash = <span className="text-muted">—</span>
const detail = (op: Operation, key: string) => {
  const v = op.details[key]
  return typeof v === 'number' ? v : null
}

/** A number column; `get` reads the value, `unit` and `digits` shape how it is shown and searched. */
function numberColumn(id: string, label: string, get: (e: Entry) => number | null | undefined, opts: { unit?: string; digits?: number; strong?: boolean } = {}): ColumnDef<Entry> {
  const text = (e: Entry) => {
    const v = get(e)
    return v == null ? null : `${fmt.num(v, opts.digits ?? 1)}${opts.unit ? ` ${opts.unit}` : ''}`
  }
  return {
    id,
    label,
    align: 'end',
    filter: 'number',
    value: get,
    text,
    render: (e) => (get(e) == null ? dash : <span className={opts.strong ? 'tabular font-medium' : 'tabular'}>{text(e)}</span>),
  }
}

function Products({ op }: { op: Operation }) {
  if (!op.inputs.length) return dash
  return (
    <div className="space-y-0.5">
      {op.inputs.map((i) => (
        <div key={i.id} className="min-w-40 max-w-64">
          {i.productName} <span className="text-muted tabular whitespace-nowrap">· {fmt.qty(i.ratePerHa, i.baseUnit)}/ha</span>
        </div>
      ))}
    </div>
  )
}

const dateText = (e: Entry) => (e.op.performedAt ? fmt.date(e.op.performedAt) : tt('operations.table.plannedOn', { date: fmt.date(e.op.plannedOn) }))
const dateColumn = (): ColumnDef<Entry> => ({
  id: 'date',
  label: tt('common.date'),
  filter: 'date',
  value: (e) => e.date,
  text: dateText,
  render: (e) => <span className={e.op.performedAt ? 'tabular whitespace-nowrap' : 'tabular whitespace-nowrap text-muted'}>{dateText(e)}</span>,
})
const titleColumn = (): ColumnDef<Entry> => ({ id: 'title', label: tt('operations.operation'), value: (e) => e.op.title, render: (e) => <span className="font-medium">{e.op.title}</span> })
const productsColumn = (): ColumnDef<Entry> => ({
  id: 'products',
  label: tt('operations.products'),
  filter: 'select',
  value: (e) => e.op.inputs[0]?.productName,
  options: (e) => e.op.inputs.map((i) => i.productName),
  text: (e) => e.op.inputs.map((i) => `${i.productName} ${fmt.qty(i.ratePerHa, i.baseUnit)}/ha`).join(' '),
  render: (e) => <Products op={e.op} />,
})
const nutrientColumn = (key: 'n' | 'nh4N' | 'p2o5' | 'k2o' | 'mgo' | 'cao' | 's', label: string) => numberColumn(key, label, (e) => e.op.nutrientTotals?.[key])
const detailColumn = (id: string, label: string, key: string, unit?: string, digits = 1) => numberColumn(id, label, (e) => detail(e.op, key), { unit, digits })
const textColumn = (id: string, label: string, get: (e: Entry) => string | null | undefined, filter: FilterKind = 'text', options?: (e: Entry) => string[]): ColumnDef<Entry> => ({
  id,
  label,
  filter,
  options,
  value: get,
  render: (e) => get(e) ?? dash,
})

// ---- Machine, implement, operator and consumption (reference seeding/tillage columns) ----

const namesOf = (op: Operation, cls: 'machine' | 'implement') => op.equipment.filter((q) => q.equipmentClass === cls).map((q) => q.equipmentName)
const implementNames = (e: Entry) => {
  const tool = typeof e.op.details.tool === 'string' ? e.op.details.tool : null
  return [...namesOf(e.op, 'implement'), ...(tool ? [tool] : [])]
}
/** Working time of the operation: machine and implement run together, so the longest line counts. */
const workHours = (op: Operation): number | null => {
  const hours = op.equipment.length ? op.equipment.map((q) => q.hours) : op.labor.map((l) => l.hours)
  return hours.length ? Math.max(...hours) : null
}
export const hoursPerHa = (op: Operation): number | null => {
  const h = workHours(op)
  return h != null && op.totalAreaHa > 0 ? h / op.totalAreaHa : null
}
const operatorName = (op: Operation) => op.responsibleEmployee?.name ?? (op.labor.map((l) => l.employeeName).join(', ') || null)
const workColumns = (): ColumnDef<Entry>[] => [
  textColumn('machine', tt('fieldOps.machine'), (e) => namesOf(e.op, 'machine').join(', ') || null, 'select', (e) => namesOf(e.op, 'machine')),
  textColumn('implement', tt('fieldOps.implement'), (e) => implementNames(e).join(', ') || null, 'select', implementNames),
  textColumn('operator', tt('fieldOps.operator'), (e) => operatorName(e.op), 'select'),
  numberColumn('diesel', tt('fieldOps.diesel'), (e) => e.op.dieselLPerHa, { unit: 'l/ha' }),
  numberColumn('electricity', tt('fieldOps.electricity'), (e) => e.op.electricityKWhPerHa, { unit: 'kWh/ha' }),
  numberColumn('hoursPerHa', tt('fieldOps.hoursPerHa'), (e) => hoursPerHa(e.op), { unit: 'h/ha', digits: 2 }),
]

// ---- Seed figures (reference seeding columns; conversions from contracts/seeding) ----

const seedLine = (op: Operation): OperationInputLine | undefined => op.inputs.find((i) => i.category === 'seed')
const KG_PER: Partial<Record<OperationInputLine['baseUnit'], number>> = { kg: 1, t: 1000 }
/** kg seed per hectare: the seed line's rate when it is weighed, else the drill setting × TKG. */
export const seedRateKgHa = (op: Operation): number | null => {
  const line = seedLine(op)
  const factor = line ? KG_PER[line.baseUnit] : undefined
  if (line?.ratePerHa != null && factor) return line.ratePerHa * factor
  return kgHaFromGrainsPerM2(detail(op, 'seedsPerM2'), detail(op, 'thousandGrainWeightG'))
}
const germination = (op: Operation) => detail(op, 'germinationPct') ?? DEFAULT_GERMINATION_RATE
const grainsPerM2 = (op: Operation) => detail(op, 'seedsPerM2') ?? grainsPerM2FromKgHa(seedRateKgHa(op), detail(op, 'thousandGrainWeightG'))
/** Seed units (packages) for the entry's area: counted seed directly, else grains over the crop's package size. */
const seedUnits = (e: Entry, ctx: ColumnCtx): number | null => {
  const line = seedLine(e.op)
  if (line?.baseUnit === 'unit' && line.ratePerHa != null) return line.ratePerHa * e.areaHa
  const size = SEED_PACKAGE_SIZES[ctx.cropCode(e.cycle) ?? '']
  return size ? seedPackagesForGrains(grainsPerM2(e.op), e.areaHa, size) : null
}

/** Field-level column: the button that opens the field's application maps to draw a seeding map. */
const seedMapColumn = (orgId: string): ColumnDef<GroupRow> => ({
  id: 'seedMap',
  label: tt('fieldOps.seedMap'),
  value: () => null,
  render: (r) =>
    r.first ? (
      <Link to="/o/$orgId/fields/$fieldId" params={{ orgId, fieldId: r.field.id }} search={{ tab: 'maps' }} variant="quiet" size="sm" aria-label={tt('fieldOps.seedMapFor', { field: r.field.name })}>
        <MapIcon /> {tt('fieldOps.seedMap')}
      </Link>
    ) : null,
})

const hasBaseNutrients = (op: Operation) => {
  const n = op.nutrientTotals
  return !n || [n.p2o5, n.k2o, n.mgo, n.cao, n.s].some((v) => (v ?? 0) > 0)
}
const hasNitrogen = (op: Operation) => !op.nutrientTotals || (op.nutrientTotals.n ?? 0) > 0

const TABS: Record<OperationTab, TabConfig> = {
  tillage: {
    type: 'tillage',
    work: true,
    columns: () => [dateColumn(), titleColumn(), detailColumn('depth', tt('fieldOps.depth'), 'depthCm', 'cm'), ...workColumns()],
    edits: () => [{ key: 'depthCm', label: tt('fieldOps.depth'), unit: 'cm', max: 100 }],
  },
  base_fertilization: {
    type: 'fertilization',
    include: hasBaseNutrients,
    columns: () => [
      dateColumn(),
      productsColumn(),
      nutrientColumn('p2o5', 'P₂O₅'),
      nutrientColumn('k2o', 'K₂O'),
      nutrientColumn('mgo', 'MgO'),
      nutrientColumn('cao', 'CaO'),
      nutrientColumn('s', 'S'),
    ],
  },
  sowing: {
    type: 'sowing',
    work: true,
    seed: true,
    fieldColumns: (orgId) => [seedMapColumn(orgId)],
    defaults: ['date', 'variety', 'products', 'seeds', 'tgw', 'germination', 'seedRate', 'totalSeed', 'seedUnits', 'machine', 'operator', 'seedMap'],
    columns: (ctx) => [
      dateColumn(),
      textColumn('variety', tt('crops.form.variety'), (e) => e.cycle?.varietyName, 'select'),
      productsColumn(),
      detailColumn('seeds', tt('fieldOps.seedsPerM2'), 'seedsPerM2', undefined, 0),
      numberColumn('density', tt('fieldOps.targetDensity'), (e) => plantsPerM2FromGrains(detail(e.op, 'seedsPerM2'), germination(e.op)), { digits: 0 }),
      detailColumn('tgw', tt('fieldOps.tgw'), 'thousandGrainWeightG', 'g'),
      detailColumn('germination', tt('fieldOps.germination'), 'germinationPct', '%', 0),
      numberColumn('seedRate', tt('fieldOps.seedRate'), (e) => seedRateKgHa(e.op), { unit: 'kg/ha' }),
      numberColumn('totalSeed', tt('fieldOps.totalSeed'), (e) => {
        const rate = seedRateKgHa(e.op)
        return rate == null ? null : rate * e.areaHa
      }, { unit: 'kg', digits: 0 }),
      numberColumn('seedUnits', tt('fieldOps.seedUnits'), (e) => seedUnits(e, ctx), { digits: 1 }),
      ...workColumns(),
    ],
    edits: () => [
      { key: 'seedsPerM2', label: tt('fieldOps.seedsPerM2'), max: 5000 },
      { key: 'thousandGrainWeightG', label: tt('fieldOps.tgw'), unit: 'g', max: 2000 },
      { key: 'germinationPct', label: tt('fieldOps.germination'), unit: '%', max: 100 },
    ],
  },
  nitrogen: {
    type: 'fertilization',
    include: hasNitrogen,
    cumulative: (op) => op.nutrientTotals?.n ?? null,
    columns: () => [
      dateColumn(),
      productsColumn(),
      nutrientColumn('n', tt('fieldOps.kgN')),
      nutrientColumn('nh4N', tt('fieldOps.kgNh4N')),
      numberColumn('total', tt('fieldOps.totalN'), (e) => e.cumulative, { strong: true }),
    ],
  },
  crop_protection: {
    type: 'crop_protection',
    protection: true,
    columns: () => [
      dateColumn(),
      textColumn('bbch', 'BBCH', (e) => e.op.bbchStage),
      productsColumn(),
      detailColumn('water', tt('fieldOps.water'), 'waterLHa', 'l/ha', 0),
      textColumn('target', tt('fieldOps.target'), (e) => e.op.targetOrganism, 'select'),
    ],
    edits: () => [{ key: 'waterLHa', label: tt('fieldOps.water'), unit: 'l/ha', max: 5000 }],
  },
  irrigation: {
    type: 'irrigation',
    cumulative: (op) => detail(op, 'waterMm'),
    columns: () => [
      dateColumn(),
      titleColumn(),
      detailColumn('water', tt('fieldOps.waterMm'), 'waterMm', 'mm'),
      numberColumn('total', tt('fieldOps.totalMm'), (e) => e.cumulative, { unit: 'mm', strong: true }),
    ],
    edits: () => [{ key: 'waterMm', label: tt('fieldOps.waterMm'), unit: 'mm', max: 500 }],
  },
  harvest: {
    type: 'harvest',
    columns: () => [
      dateColumn(),
      titleColumn(),
      numberColumn('expected', tt('fieldOps.expectedYield'), (e) => e.cycle?.expectedYieldTHa, { unit: 't/ha' }),
      textColumn('straw', tt('fieldOps.straw'), (e) => {
        const v = e.op.details.strawRemoved
        return v === true ? tt('fieldOps.strawRemoved') : v === false ? tt('fieldOps.strawRetained') : null
      }, 'select'),
    ],
  },
}

export const operationTabType = (tab: OperationTab) => TABS[tab].type

const opDate = (op: Operation) => op.performedAt?.slice(0, 10) ?? op.plannedOn
const isOpen = (op: Operation) => op.status === 'planned' || op.status === 'in_progress'
const STATUS_ORDER = { planned: 0, in_progress: 1, completed: 2, canceled: 3 } as const

/** Field, crop, area and status always show. */
const FIXED_COLUMNS = ['field', 'crop', 'area', 'status']

interface GroupRow {
  id: string
  field: Field
  cycle: CropCycle | null
  entry: Entry | null
  first: boolean
  /** Same crop cycle as the row above in the field's group, so the crop is not repeated. */
  sameCycle?: boolean
}

/** The operations of one kind in the season, grouped per field: each field once, with all its operations below it. */
export function OperationTabPanel({ tab, label }: { tab: OperationTab; label: string }) {
  const { t } = useTranslation()
  const { orgId, can } = useOrg()
  const { seasonId } = useSeason()
  const navigate = useNavigate()
  const cfg = TABS[tab]
  const fields = useOrgQuery<Field[]>('/fields', { seasonId })
  const cycles = useOrgQuery<CropCycle[]>('/crop-cycles', { seasonId }, { enabled: !!seasonId })
  const ops = useOrgQuery<Operation[]>('/operations', { seasonId, type: cfg.type })
  const crops = useOrgQuery<Crop[]>('/crops')
  const [selection, setSelection] = useState<Selection>(new Set())
  const [dialog, setDialog] = useState<'edit' | 'complete' | 'distribute' | null>(null)
  const writable = can('operation.write')
  const ctx = useMemo<ColumnCtx>(() => {
    const codes = new Map((crops.data ?? []).map((c) => [c.id, c.code]))
    return { cropCode: (c) => (c ? (codes.get(c.cropId) ?? null) : null) }
  }, [crops.data])

  const allColumns = useMemo<ColumnDef<GroupRow>[]>(
    () => [
      { id: 'field', label: t('crops.plan.field'), value: (r) => r.field.name, text: (r) => `${r.field.name} ${r.field.farmName}`, render: () => null },
      { id: 'crop', label: t('crops.plan.crop'), filter: 'select', value: (r) => r.cycle?.cropName, render: (r) => (r.sameCycle ? null : r.cycle ? <CropTag name={r.cycle.cropName} color={r.cycle.cropColor} /> : r.first ? dash : null) },
      {
        id: 'area',
        label: t('crops.plan.area'),
        align: 'end',
        filter: 'number',
        value: (r) => r.entry?.areaHa ?? r.field.croppedAreaHa,
        text: (r) => fmt.ha(r.entry?.areaHa ?? r.field.croppedAreaHa),
        render: (r) => fmt.ha(r.entry?.areaHa ?? r.field.croppedAreaHa),
      },
      ...(cfg.fieldColumns?.(orgId) ?? []),
      // The tab's own columns are about the operation; a field without one has nothing to show or match.
      ...cfg.columns(ctx).map<ColumnDef<GroupRow>>((c) => ({
        ...c,
        value: (r) => (r.entry ? c.value(r.entry) : null),
        text: (r) => (r.entry ? (c.text ?? c.value)(r.entry)?.toString() : null),
        options: c.options && ((r) => (r.entry ? c.options!(r.entry) : [])),
        render: (r) => (r.entry ? c.render(r.entry) : null),
      })),
      {
        id: 'status',
        label: t('common.status'),
        filter: 'select',
        value: (r) => (r.entry ? STATUS_ORDER[r.entry.op.status] : null),
        text: (r) => (r.entry ? t(`enum.operationStatus.${r.entry.op.status}`) : null),
        render: (r) => r.entry && <OperationStatusBadge status={r.entry.op.status} />,
      },
    ],
    [cfg, t, ctx, orgId],
  )
  const fixed = FIXED_COLUMNS
  const config = useColumnConfig(`agmeo.fieldOps.${tab}.columns`, { all: allColumns.map((c) => c.id), fixed, defaults: cfg.defaults ?? allColumns.map((c) => c.id) })
  const visibleIds = allColumns.flatMap((c) => (config.isVisible(c.id) ? [c.id] : [])).join(',')
  const columns = useMemo(() => allColumns.filter((c) => visibleIds.split(',').includes(c.id)), [allColumns, visibleIds])
  const rows = useMemo(() => {
    const visible = (ops.data ?? []).filter((o) => o.status !== 'canceled' && (!cfg.include || cfg.include(o)))
    const cyclesById = new Map((cycles.data ?? []).map((c) => [c.id, c]))
    const mainCycle = new Map<string, CropCycle>()
    for (const c of cycles.data ?? []) if (c.role === 'main' && !mainCycle.has(c.fieldId)) mainCycle.set(c.fieldId, c)
    const byField = new Map<string, Entry[]>()
    for (const op of visible) {
      const perField = new Map<string, { areaHa: number; cycleId: string | null }>()
      for (const f of op.fields) {
        const cur = perField.get(f.fieldId) ?? { areaHa: 0, cycleId: f.cropCycleId }
        cur.areaHa += f.treatedAreaHa
        perField.set(f.fieldId, cur)
      }
      for (const [fieldId, v] of perField) {
        const entry: Entry = { op, areaHa: v.areaHa, date: opDate(op), cycle: (v.cycleId && cyclesById.get(v.cycleId)) || mainCycle.get(fieldId) || null, cumulative: null }
        byField.set(fieldId, [...(byField.get(fieldId) ?? []), entry])
      }
    }
    const out: GroupRow[] = []
    for (const field of fields.data ?? []) {
      const entries = (byField.get(field.id) ?? []).sort((a, b) => (a.date ?? '9999').localeCompare(b.date ?? '9999'))
      if (cfg.cumulative) {
        let sum: number | null = null
        for (const e of entries) {
          const v = cfg.cumulative(e.op)
          if (v != null) sum = (sum ?? 0) + v
          e.cumulative = sum
        }
      }
      const cycle = mainCycle.get(field.id) ?? null
      if (!entries.length) out.push({ id: `${field.id}:none`, field, cycle, entry: null, first: true })
      else entries.forEach((e, i) => out.push({ id: `${field.id}:${e.op.id}`, field, cycle: e.cycle ?? cycle, entry: e, first: i === 0 }))
    }
    return out
  }, [fields.data, cycles.data, ops.data, cfg])
  const view = useTableView(columns, rows)

  // Search and sort the operations, then put each field's rows back together, in the order its first row landed.
  const shown = useMemo(() => {
    let list = rows.filter(view.matches)
    if (view.compare) list = [...list].sort(view.compare)
    const groups = new Map<string, GroupRow[]>()
    for (const r of list) groups.set(r.field.id, [...(groups.get(r.field.id) ?? []), r])
    return [...groups.values()].flatMap((g) =>
      g.map((r, i) => ({ ...r, first: i === 0, sameCycle: i > 0 && (r.cycle?.id ?? null) === (g[i - 1].cycle?.id ?? null) })),
    )
  }, [rows, view])

  // Only a field's first row has a checkbox; it stands for all of the field's rows.
  const followUps = useMemo(() => shown.filter((r) => !r.first).map((r) => r.id), [shown])
  const selected = useMemo(() => {
    const ids = selectedIds(selection, shown)
    const fieldIds = new Set(shown.filter((r) => r.first && ids.has(r.id)).map((r) => r.field.id))
    const picked = shown.filter((r) => fieldIds.has(r.field.id))
    const opsById = new Map(picked.flatMap((r) => (r.entry ? [[r.entry.op.id, r.entry.op] as const] : [])))
    return { count: fieldIds.size, ops: [...opsById.values()], fieldIds: [...fieldIds] }
  }, [selection, shown])
  const openOps = selected.ops.filter(isOpen)
  const clear = () => setSelection(new Set())

  const cancel = useBulkMutation((base, op: Operation) => api.post(`${base}/operations/${op.id}/cancel`, { version: op.version }), {
    label: (op) => op.title,
    success: (count) => t('fieldOps.bulk.canceled', { count }),
    onDone: clear,
  })

  if (fields.isLoading || ops.isLoading) return <Loading />
  if (ops.error) return <ErrorNotice error={ops.error} />

  // The plan link sits in the first column about the operation.
  const firstColumn = columns.find((c) => !fixed.includes(c.id) && !(cfg.fieldColumns?.(orgId) ?? []).some((f) => f.id === c.id))?.id
  return (
    <>
      <div className="flex justify-end mb-2">
        <ColumnConfigButton
          columns={allColumns}
          fixed={fixed}
          presets={[
            ...(cfg.defaults ? [{ id: 'default', label: t('fieldOps.views.default'), columns: cfg.defaults }] : []),
            { id: 'all', label: t('fieldOps.views.all'), columns: allColumns.map((c) => c.id) },
          ]}
          config={config}
        />
      </div>
      <Card padded={false}>
        <Table
          aria-label={label}
          selectionMode={writable ? 'multiple' : 'none'}
          selectedKeys={selection}
          onSelectionChange={setSelection}
          disabledKeys={followUps}
          disabledBehavior="selection"
          sortDescriptor={view.sort}
          onSortChange={view.setSort}
        >
          <TableHeader>
            {writable && (
              <Column className="w-10">
                <Checkbox slot="selection" />
              </Column>
            )}
            {columns.map((c) => (
              <Column key={c.id} id={c.id} isRowHeader={c.id === 'field'} align={c.align} allowsSorting>
                {view.head(c)}
              </Column>
            ))}
          </TableHeader>
          <TableBody items={shown} dependencies={[selected.fieldIds]} renderEmptyState={() => (view.filtered ? <NoMatches onReset={view.clearFilters} /> : <div className="py-10 text-center text-sm text-muted">{t('crops.plan.empty')}</div>)}>
            {(r) => (
              <Row id={r.id} href={r.entry ? `/o/${orgId}/operations/${r.entry.op.id}` : undefined} className={cx(r.first && '[&>td]:border-t [&>td]:border-line', !r.first && selected.fieldIds.includes(r.field.id) && 'bg-primary-soft')}>
                {writable && <Cell>{r.first && <Checkbox slot="selection" />}</Cell>}
                {columns.map((c) =>
                  c.id === 'field' ? (
                    <Cell key={c.id}>
                      {r.first && (
                        <div className="flex items-center gap-2.5">
                          <FieldShape geometry={r.field.geometry} fill={r.cycle?.cropColor ?? '#9aa392'} className="size-8 text-fg" />
                          <div className="min-w-0">
                            <FieldNameLink field={r.field} cycle={r.cycle} />
                            <div className="text-xs text-muted">{r.field.farmName}</div>
                          </div>
                        </div>
                      )}
                    </Cell>
                  ) : (
                    <Cell key={c.id} align={c.align}>
                      {!r.entry && c.id === firstColumn ? (
                        writable ? (
                          <Link to="/o/$orgId/operations/new" params={{ orgId }} search={{ type: cfg.type, fieldIds: [r.field.id] }} variant="quiet" size="sm">
                            <Plus /> {t('fieldOps.planShort')}
                          </Link>
                        ) : (
                          <span className="text-muted">{t('fieldOps.none')}</span>
                        )
                      ) : (
                        c.render(r)
                      )}
                    </Cell>
                  ),
                )}
              </Row>
            )}
          </TableBody>
        </Table>
      </Card>

      <SelectionBar count={selected.count} onClear={clear}>
        <Button size="sm" isDisabled={!openOps.length} onPress={() => setDialog('edit')}>
          <Pencil /> {t('fieldOps.bulk.edit')}
        </Button>
        <Button size="sm" isDisabled={!openOps.length} onPress={() => setDialog('complete')}>
          <CheckCircle2 /> {t('fieldOps.bulk.complete')}
        </Button>
        {cfg.seed && (
          <Button size="sm" isDisabled={!openOps.length} onPress={() => setDialog('distribute')}>
            <Scale /> {t('fieldOps.distribute.open')}
          </Button>
        )}
        <ConfirmButton
          title={t('fieldOps.bulk.cancelTitle', { count: openOps.length })}
          message={t('fieldOps.bulk.cancelMessage')}
          confirmLabel={t('fieldOps.bulk.cancel')}
          onConfirm={() => cancel.mutateAsync(openOps)}
          trigger={
            <Button size="sm" isDisabled={!openOps.length}>
              <Ban /> {t('fieldOps.bulk.cancel')}
            </Button>
          }
        />
        <Button size="sm" variant="primary" onPress={() => navigate({ to: '/o/$orgId/operations/new', params: { orgId }, search: { type: cfg.type, fieldIds: selected.fieldIds } })}>
          <Plus /> {t('fieldOps.bulk.plan', { count: selected.fieldIds.length })}
        </Button>
      </SelectionBar>

      {dialog === 'edit' && <BulkEditDialog ops={openOps} skipped={selected.ops.length - openOps.length} cfg={cfg} onClose={() => { setDialog(null); clear() }} />}
      {dialog === 'complete' && <CompleteDialog ops={openOps} onClose={() => { setDialog(null); clear() }} />}
      {dialog === 'distribute' && <DistributeSeedDialog ops={openOps} onClose={() => { setDialog(null); clear() }} />}
    </>
  )
}

/** Sets the filled-in values on all selected operations; empty inputs leave each operation as it is. */
function BulkEditDialog({ ops, skipped, cfg, onClose }: { ops: Operation[]; skipped: number; cfg: TabConfig; onClose: () => void }) {
  const { t } = useTranslation()
  const allFields = useOrgQuery<Field[]>('/fields')
  const edits = useMemo(() => cfg.edits?.() ?? [], [cfg])
  const products = useMemo(() => {
    const m = new Map<string, { name: string; unit: string }>()
    for (const op of ops) for (const i of op.inputs) if (!m.has(i.productId)) m.set(i.productId, { name: i.productName, unit: i.baseUnit })
    return [...m.entries()]
  }, [ops])
  const [plannedOn, setPlannedOn] = useState<string | null>(null)
  const [details, setDetails] = useState<Record<string, number>>({})
  const [bbch, setBbch] = useState('')
  const [target, setTarget] = useState('')
  const [rates, setRates] = useState<Record<string, number>>({})
  const [work, setWork] = useState<WorkEdit>({ machineId: null, implementId: null, operatorId: null, diesel: NaN, electricity: NaN, hoursPerHa: NaN })
  const equipment = useOrgQuery<Equipment[]>('/equipment', undefined, { enabled: !!cfg.work })
  const employees = useOrgQuery<Employee[]>('/employees', undefined, { enabled: !!cfg.work })
  const filled = (v: number | undefined) => v != null && !Number.isNaN(v)
  const workChanged = !!work.machineId || !!work.implementId || !!work.operatorId || filled(work.diesel) || filled(work.electricity) || filled(work.hoursPerHa)
  const changed = !!plannedOn || !!bbch.trim() || !!target.trim() || Object.values(details).some(filled) || Object.values(rates).some(filled) || workChanged
  const multiField = ops.some((op) => new Set(op.fields.map((f) => f.fieldId)).size > 1)
  // A machine or implement is recorded with its hours; operations without any need the time per hectare.
  const needsHours = (!!work.machineId || !!work.implementId) && !filled(work.hoursPerHa) && ops.some((op) => workHours(op) == null)
  const classOf = useMemo(() => new Map((equipment.data ?? []).map((e) => [e.id, e.class])), [equipment.data])

  const save = useBulkMutation(
    (base, op: Operation) => {
      const fields = allFields.data ?? []
      const s = initialState({ farmId: op.farmId, fields, operation: op })
      if (plannedOn) s.plannedOn = plannedOn
      for (const [k, v] of Object.entries(details)) if (filled(v)) s.details[k] = v
      if (bbch.trim()) s.bbchStage = bbch.trim()
      if (target.trim()) s.targetOrganism = target.trim()
      s.inputs = s.inputs.map((i) => (i.productId && filled(rates[i.productId]) ? { ...i, ratePerHa: rates[i.productId] } : i))
      if (cfg.work) applyWork(s, op, work, classOf)
      return api.put(`${base}/operations/${op.id}`, { ...toPayload(s, fields, op.version), status: op.status === 'in_progress' ? 'in_progress' : 'planned' })
    },
    { label: (op) => op.title, success: (count) => t('fieldOps.bulk.updated', { count }), onDone: onClose },
  )

  return (
    <ModalDialog isOpen onOpenChange={(o) => !o && onClose()} title={t('fieldOps.bulk.editTitle', { count: ops.length })} description={t('fieldOps.bulk.editHint')} size="md">
      <Form onSubmit={(e) => { e.preventDefault(); save.mutate(ops) }} className="space-y-4">
        {skipped > 0 && <Notice tone="info">{t('fieldOps.bulk.skipped', { count: skipped })}</Notice>}
        {multiField && <Notice tone="warning">{t('fieldOps.bulk.multiField')}</Notice>}
        <div className="grid sm:grid-cols-2 gap-4">
          <DatePicker label={t('fieldOps.bulk.plannedOn')} value={plannedOn} onChange={setPlannedOn} />
          {cfg.protection && (
            <>
              <TextField label="BBCH" value={bbch} onChange={setBbch} placeholder={t('fieldOps.bulk.unchanged')} />
              <TextField label={t('fieldOps.target')} value={target} onChange={setTarget} placeholder={t('fieldOps.bulk.unchanged')} />
            </>
          )}
          {edits.map((d) => (
            <NumberField key={d.key} label={d.label} unit={d.unit} minValue={0} maxValue={d.max} value={details[d.key] ?? NaN} onChange={(v) => setDetails((x) => ({ ...x, [d.key]: v }))} placeholder={t('fieldOps.bulk.unchanged')} />
          ))}
        </div>
        {cfg.work && <WorkFields value={work} onChange={setWork} equipment={equipment.data ?? []} employees={employees.data ?? []} />}
        {needsHours && <Notice tone="warning">{t('fieldOps.bulk.needsHours')}</Notice>}
        {products.length > 0 && (
          <section className="space-y-2">
            <h3 className="text-sm font-semibold text-fg">{t('fieldOps.bulk.rates')}</h3>
            <div className="grid sm:grid-cols-2 gap-4">
              {products.map(([id, p]) => (
                <NumberField key={id} label={p.name} unit={`${p.unit === 'm3' ? 'm³' : p.unit}/ha`} minValue={0} formatOptions={{ maximumFractionDigits: 3 }} value={rates[id] ?? NaN} onChange={(v) => setRates((x) => ({ ...x, [id]: v }))} placeholder={t('fieldOps.bulk.unchanged')} />
              ))}
            </div>
          </section>
        )}
        <div className="flex justify-end gap-2">
          <Button onPress={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" variant="primary" isDisabled={!changed || needsHours || !allFields.data} isPending={save.isPending}>
            {t('fieldOps.bulk.apply', { count: ops.length })}
          </Button>
        </div>
      </Form>
    </ModalDialog>
  )
}

interface WorkEdit {
  machineId: string | null
  implementId: string | null
  operatorId: string | null
  diesel: number
  electricity: number
  hoursPerHa: number
}

type FormState = ReturnType<typeof initialState>

/**
 * Puts the chosen machine, implement and operator on the operation (replacing the line of the same
 * class), and sets diesel, electricity and the working time per hectare. The time goes on every
 * machine and implement line; without one it stays as recorded.
 */
function applyWork(s: FormState, op: Operation, w: WorkEdit, classOf: Map<string, string>) {
  const ok = (v: number) => !Number.isNaN(v)
  const hours = ok(w.hoursPerHa) ? Math.round(w.hoursPerHa * op.totalAreaHa * 100) / 100 : (workHours(op) ?? 0)
  const line = (id: string) => ({ key: Math.random(), id, hours })
  for (const [id, cls] of [[w.machineId, 'machine'], [w.implementId, 'implement']] as const) {
    if (!id) continue
    s.equipment = [...s.equipment.filter((l) => l.id && (classOf.get(l.id) ?? 'machine') !== cls), line(id)]
  }
  if (ok(w.hoursPerHa)) s.equipment = s.equipment.map((l) => ({ ...l, hours }))
  if (w.operatorId) {
    s.responsibleEmployeeId = w.operatorId
    if (!s.labor.some((l) => l.id === w.operatorId) && hours > 0) s.labor = [...s.labor, line(w.operatorId)]
  }
  if (ok(w.diesel)) s.dieselLPerHa = w.diesel
  if (ok(w.electricity)) s.electricityKWhPerHa = w.electricity
}

function WorkFields({ value: w, onChange, equipment, employees }: { value: WorkEdit; onChange: (w: WorkEdit) => void; equipment: Equipment[]; employees: Employee[] }) {
  const { t } = useTranslation()
  const active = equipment.filter((e) => !EQUIPMENT_GONE_STATUSES.includes(e.status) && !e.archivedAt)
  const keep = { id: '__keep', name: t('fieldOps.bulk.unchanged') }
  const pick = (v: unknown) => (v && v !== '__keep' ? String(v) : null)
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold text-fg">{t('fieldOps.bulk.work')}</h3>
      <div className="grid sm:grid-cols-3 gap-4">
        <Select label={t('fieldOps.machine')} items={[keep, ...active.filter((e) => e.class === 'machine')]} value={w.machineId ?? '__keep'} onChange={(v) => onChange({ ...w, machineId: pick(v) })}>
          {(e) => <Option id={e.id}>{e.name}</Option>}
        </Select>
        <Select label={t('fieldOps.implement')} items={[keep, ...active.filter((e) => e.class === 'implement')]} value={w.implementId ?? '__keep'} onChange={(v) => onChange({ ...w, implementId: pick(v) })}>
          {(e) => <Option id={e.id}>{e.name}</Option>}
        </Select>
        <Select label={t('fieldOps.operator')} items={[keep, ...employees.filter((e) => e.active)]} value={w.operatorId ?? '__keep'} onChange={(v) => onChange({ ...w, operatorId: pick(v) })}>
          {(e) => <Option id={e.id}>{e.name}</Option>}
        </Select>
        <NumberField label={t('fieldOps.diesel')} unit="l/ha" minValue={0} maxValue={1000} formatOptions={{ maximumFractionDigits: 2 }} value={w.diesel} onChange={(diesel) => onChange({ ...w, diesel })} placeholder={t('fieldOps.bulk.unchanged')} />
        <NumberField label={t('fieldOps.electricity')} unit="kWh/ha" minValue={0} maxValue={10000} formatOptions={{ maximumFractionDigits: 2 }} value={w.electricity} onChange={(electricity) => onChange({ ...w, electricity })} placeholder={t('fieldOps.bulk.unchanged')} />
        <NumberField label={t('fieldOps.hoursPerHa')} unit="h/ha" minValue={0} maxValue={100} formatOptions={{ maximumFractionDigits: 3 }} value={w.hoursPerHa} onChange={(hoursPerHa) => onChange({ ...w, hoursPerHa })} placeholder={t('fieldOps.bulk.unchanged')} />
      </div>
    </section>
  )
}

/**
 * Spreads a total seed weight over the selected sowings as one kg/ha rate (reference "Gesamtmenge auf
 * die Schläge verteilen"): every operation gets the same rate on its seed line; operations without the
 * seed get it as a new line.
 */
function DistributeSeedDialog({ ops, onClose }: { ops: Operation[]; onClose: () => void }) {
  const { t } = useTranslation()
  const allFields = useOrgQuery<Field[]>('/fields')
  const weighed = useMemo(() => {
    const m = new Map<string, { name: string; unit: 'kg' | 't'; stock: number }>()
    for (const op of ops) for (const i of op.inputs) if (i.category === 'seed' && (i.baseUnit === 'kg' || i.baseUnit === 't') && !m.has(i.productId)) m.set(i.productId, { name: i.productName, unit: i.baseUnit, stock: i.availableStock })
    return [...m.entries()].map(([id, p]) => ({ id, ...p }))
  }, [ops])
  const [productId, setProductId] = useState<string | null>(weighed[0]?.id ?? null)
  const [totalKg, setTotalKg] = useState(NaN)
  const product = weighed.find((p) => p.id === productId)
  const areas = ops.map((op) => op.totalAreaHa)
  const rateKg = distributeTotalSeedKg(Number.isNaN(totalKg) ? null : totalKg, areas)
  const stockKg = product ? product.stock * (product.unit === 't' ? 1000 : 1) : null

  const save = useBulkMutation(
    (base, op: Operation) => {
      const fields = allFields.data ?? []
      const s = initialState({ farmId: op.farmId, fields, operation: op })
      const rate = product!.unit === 't' ? rateKg! / 1000 : rateKg!
      s.inputs = s.inputs.some((i) => i.productId === product!.id)
        ? s.inputs.map((i) => (i.productId === product!.id ? { ...i, ratePerHa: rate } : i))
        : [...s.inputs, { key: Math.random(), productId: product!.id, ratePerHa: rate, storageLocationId: null, unitCost: NaN }]
      return api.put(`${base}/operations/${op.id}`, { ...toPayload(s, fields, op.version), status: op.status === 'in_progress' ? 'in_progress' : 'planned' })
    },
    { label: (op) => op.title, success: (count) => t('fieldOps.bulk.updated', { count }), onDone: onClose },
  )

  return (
    <ModalDialog isOpen onOpenChange={(o) => !o && onClose()} title={t('fieldOps.distribute.title')} description={t('fieldOps.distribute.tooltip')} size="sm">
      <Form onSubmit={(e) => { e.preventDefault(); save.mutate(ops) }} className="space-y-4">
        {weighed.length === 0 ? (
          <Notice tone="info">{t('fieldOps.distribute.noSeed')}</Notice>
        ) : (
          <>
            <Select label={t('fieldOps.distribute.product')} items={weighed} value={productId} onChange={(v) => setProductId(v ? String(v) : null)}>
              {(p) => <Option id={p.id}>{p.name}</Option>}
            </Select>
            <NumberField
              label={t('fieldOps.distribute.total')}
              unit="kg"
              minValue={0}
              value={totalKg}
              onChange={setTotalKg}
              placeholder={t('fieldOps.distribute.placeholder')}
              description={stockKg != null ? t('fieldOps.distribute.stock', { kg: fmt.num(stockKg) }) : undefined}
            />
            {rateKg != null && (
              <p className="text-sm text-fg-2">
                {t('fieldOps.distribute.applied', { total: `${fmt.num(totalKg)} kg`, count: ops.length, rate: `${fmt.num(rateKg, 1)} kg/ha` })}
              </p>
            )}
          </>
        )}
        <div className="flex justify-end gap-2">
          <Button onPress={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" variant="primary" isDisabled={rateKg == null || !product || !allFields.data} isPending={save.isPending}>
            {t('fieldOps.bulk.apply', { count: ops.length })}
          </Button>
        </div>
      </Form>
    </ModalDialog>
  )
}

/** Records the selected open operations as done on one day. */
function CompleteDialog({ ops, onClose }: { ops: Operation[]; onClose: () => void }) {
  const { t } = useTranslation()
  const [date, setDate] = useState<string | null>(today())
  const complete = useBulkMutation(
    (base, op: Operation) => {
      // Today means now (a later hour would be in the future); earlier days are recorded at noon.
      const performedAt = !date || date === today() ? new Date().toISOString() : new Date(`${date}T12:00:00`).toISOString()
      return api.post(`${base}/operations/${op.id}/complete`, { version: op.version, performedAt })
    },
    { label: (op) => op.title, success: (count) => t('fieldOps.bulk.completed', { count }), onDone: onClose },
  )
  return (
    <ModalDialog isOpen onOpenChange={(o) => !o && onClose()} title={t('fieldOps.bulk.completeTitle', { count: ops.length })} size="sm">
      <Form onSubmit={(e) => { e.preventDefault(); complete.mutate(ops) }} className="space-y-4">
        <DatePicker label={t('fieldOps.bulk.performedOn')} value={date} onChange={setDate} maxValue={today()} isRequired />
        <p className="text-xs text-muted">{t('fieldOps.bulk.completeHint')}</p>
        <div className="flex justify-end gap-2">
          <Button onPress={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" variant="primary" isDisabled={!date} isPending={complete.isPending}>
            <CheckCircle2 /> {t('fieldOps.bulk.complete')}
          </Button>
        </div>
      </Form>
    </ModalDialog>
  )
}
