import type { CropCycle, Field, Operation, OperationType } from '@agmeo/contracts'
import { useNavigate } from '@tanstack/react-router'
import { Ban, CheckCircle2, Pencil, Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Form, type Selection } from 'react-aria-components'
import { useTranslation } from 'react-i18next'
import { FieldNameLink } from '#/components/crops/FieldNameLink'
import { CropTag, OperationStatusBadge } from '#/components/labels'
import { FieldShape } from '#/components/map/FieldShape'
import { initialState, toPayload } from '#/components/operations/OperationForm'
import { NoMatches, SelectionBar, selectedIds, useBulkMutation, useTableView, type ColumnDef, type FilterKind } from '#/components/table/tableTools'
import { t as tt } from '#/i18n'
import { api } from '#/lib/api'
import { fmt, today } from '#/lib/format'
import { useOrg, useSeason } from '#/lib/org'
import { useOrgQuery } from '#/lib/queries'
import { Button, Link } from '#/ui/Button'
import { Checkbox, DatePicker, NumberField, TextField } from '#/ui/Field'
import { Card, ErrorNotice, Loading, Notice } from '#/ui/Layout'
import { ConfirmButton, ModalDialog } from '#/ui/Overlay'
import { Cell, Column, Row, Table, TableBody, TableHeader } from '#/ui/Table'

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

interface TabConfig {
  type: OperationType
  /** Which operations of the type belong in the tab (fertilization is split into base and N). */
  include?: (op: Operation) => boolean
  /** Key figure per entry that is summed up per field. */
  cumulative?: (op: Operation) => number | null
  columns: () => ColumnDef<Entry>[]
  edits?: () => DetailEdit[]
  /** BBCH stage and target organism can be edited. */
  protection?: boolean
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
const equipmentNames = (e: Entry) => {
  const tool = typeof e.op.details.tool === 'string' ? e.op.details.tool : null
  return [...e.op.equipment.map((q) => q.equipmentName), ...(tool ? [tool] : [])]
}

const hasBaseNutrients = (op: Operation) => {
  const n = op.nutrientTotals
  return !n || [n.p2o5, n.k2o, n.mgo, n.cao, n.s].some((v) => (v ?? 0) > 0)
}
const hasNitrogen = (op: Operation) => !op.nutrientTotals || (op.nutrientTotals.n ?? 0) > 0

const TABS: Record<OperationTab, TabConfig> = {
  tillage: {
    type: 'tillage',
    columns: () => [
      dateColumn(),
      titleColumn(),
      detailColumn('depth', tt('fieldOps.depth'), 'depthCm', 'cm'),
      textColumn('equipment', tt('fieldOps.equipment'), (e) => equipmentNames(e).join(', ') || null, 'select', equipmentNames),
      numberColumn('hours', tt('fieldOps.hours'), (e) => (e.op.equipment.length ? e.op.equipment.reduce((s, q) => s + q.hours, 0) : null), { unit: 'h' }),
    ],
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
    columns: () => [
      dateColumn(),
      textColumn('variety', tt('crops.form.variety'), (e) => e.cycle?.varietyName, 'select'),
      productsColumn(),
      detailColumn('seeds', tt('fieldOps.seedsPerM2'), 'seedsPerM2', undefined, 0),
      detailColumn('tgw', tt('fieldOps.tgw'), 'thousandGrainWeightG', 'g'),
      detailColumn('germination', tt('fieldOps.germination'), 'germinationPct', '%', 0),
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

interface GroupRow {
  id: string
  field: Field
  cycle: CropCycle | null
  entry: Entry | null
  first: boolean
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
  const [selection, setSelection] = useState<Selection>(new Set())
  const [dialog, setDialog] = useState<'edit' | 'complete' | null>(null)
  const writable = can('operation.write')

  const columns = useMemo<ColumnDef<GroupRow>[]>(
    () => [
      { id: 'field', label: t('crops.plan.field'), value: (r) => r.field.name, text: (r) => `${r.field.name} ${r.field.farmName}`, render: () => null },
      { id: 'crop', label: t('crops.plan.crop'), filter: 'select', value: (r) => r.cycle?.cropName, render: (r) => (r.cycle ? <CropTag name={r.cycle.cropName} color={r.cycle.cropColor} /> : r.first ? dash : null) },
      {
        id: 'area',
        label: t('crops.plan.area'),
        align: 'end',
        filter: 'number',
        value: (r) => r.entry?.areaHa ?? r.field.croppedAreaHa,
        text: (r) => fmt.ha(r.entry?.areaHa ?? r.field.croppedAreaHa),
        render: (r) => fmt.ha(r.entry?.areaHa ?? r.field.croppedAreaHa),
      },
      // The tab's own columns are about the operation; a field without one has nothing to show or match.
      ...cfg.columns().map<ColumnDef<GroupRow>>((c) => ({
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
    [cfg, t],
  )
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
    return [...groups.values()].flatMap((g) => g.map((r, i) => ({ ...r, first: i === 0 })))
  }, [rows, view])

  const selected = useMemo(() => {
    const ids = selectedIds(selection, shown)
    const picked = shown.filter((r) => ids.has(r.id))
    const opsById = new Map(picked.flatMap((r) => (r.entry ? [[r.entry.op.id, r.entry.op] as const] : [])))
    return { count: picked.length, ops: [...opsById.values()], fieldIds: [...new Set(picked.map((r) => r.field.id))] }
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

  const firstColumn = columns[3]?.id
  return (
    <>
      <Card padded={false}>
        <Table
          aria-label={label}
          selectionMode={writable ? 'multiple' : 'none'}
          selectedKeys={selection}
          onSelectionChange={setSelection}
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
          <TableBody items={shown} renderEmptyState={() => (view.filtered ? <NoMatches onReset={view.clearFilters} /> : <div className="py-10 text-center text-sm text-muted">{t('crops.plan.empty')}</div>)}>
            {(r) => (
              <Row id={r.id} href={r.entry ? `/o/${orgId}/operations/${r.entry.op.id}` : undefined} className={r.first ? '[&>td]:border-t [&>td]:border-line' : undefined}>
                {writable && (
                  <Cell>
                    <Checkbox slot="selection" />
                  </Cell>
                )}
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
  const filled = (v: number | undefined) => v != null && !Number.isNaN(v)
  const changed = !!plannedOn || !!bbch.trim() || !!target.trim() || Object.values(details).some(filled) || Object.values(rates).some(filled)
  const multiField = ops.some((op) => new Set(op.fields.map((f) => f.fieldId)).size > 1)

  const save = useBulkMutation(
    (base, op: Operation) => {
      const fields = allFields.data ?? []
      const s = initialState({ farmId: op.farmId, fields, operation: op })
      if (plannedOn) s.plannedOn = plannedOn
      for (const [k, v] of Object.entries(details)) if (filled(v)) s.details[k] = v
      if (bbch.trim()) s.bbchStage = bbch.trim()
      if (target.trim()) s.targetOrganism = target.trim()
      s.inputs = s.inputs.map((i) => (i.productId && filled(rates[i.productId]) ? { ...i, ratePerHa: rates[i.productId] } : i))
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
          <Button type="submit" variant="primary" isDisabled={!changed || !allFields.data} isPending={save.isPending}>
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
