import {
  APPLICATION_TECHNIQUES,
  NUTRIENT_KEYS,
  OPERATION_TYPES,
  PSM_USAGE_TYPES,
  isOrganicFertilizer,
  nutrientKgPerHa,
  seedKgPerHa,
  type CropCycle,
  type Employee,
  type Equipment,
  type Farm,
  type Field,
  type Operation,
  type OperationType,
  type Product,
  type ProductCategory,
  type PsmUse,
  type StockShortage,
  type StorageLocation,
} from '@agmeo/contracts'
import type { TFunction } from 'i18next'
import { AlertTriangle, Plus, X } from 'lucide-react'
import { type ReactNode, useMemo, useState } from 'react'
import { Form } from 'react-aria-components'
import { useTranslation } from 'react-i18next'
import { NONE, enumItems, keyOrNull } from '#/components/resources/form'
import { baseUnitLabel, operationTypeLabel } from '#/i18n/labels'
import { NUTRIENT_LABELS, applicationTechniqueLabel, psmUsageTypeLabel } from '#/i18n/labels.fieldwork'
import { ApiRequestError, errorMessage } from '#/lib/api'
import { fmt, localToIso, today } from '#/lib/format'
import { useOrg } from '#/lib/org'
import { useOrgQuery } from '#/lib/queries'
import { Button } from '#/ui/Button'
import { Checkbox, ComboBox, DatePicker, NumberField, Option, Select, Switch, TextField, num } from '#/ui/Field'
import { Card, Notice } from '#/ui/Layout'
import { cx, focusRing } from '#/ui/utils'
import { OPERATION_ICONS } from '../labels'
import { FieldMap } from '../map/FieldMap'
import { farmView } from '../map/useMap'

/** Product categories offered for each operation type (others remain selectable via "all"). */
const TYPE_CATEGORIES: Record<OperationType, ProductCategory[]> = {
  sowing: ['seed'],
  fertilization: ['fertilizer'],
  crop_protection: ['crop_protection'],
  irrigation: [],
  tillage: [],
  harvest: [],
  inspection: [],
  other: ['seed', 'fertilizer', 'crop_protection', 'consumable', 'fuel', 'other'],
}

/** Numeric `details` of each operation type (see OPERATION_DETAILS); `organic`: an organic fertilizer is among the inputs. */
function detailFields(type: OperationType, t: TFunction, opts: { organic: boolean }): { key: string; label: string; unit?: string; max?: number }[] {
  switch (type) {
    case 'sowing':
      return [
        { key: 'seedsPerM2', label: t('operations.form.detail.seedsPerM2'), unit: t('operations.form.unit.seedsPerM2') },
        { key: 'rowSpacingCm', label: t('operations.form.detail.rowSpacingCm'), unit: 'cm' },
        { key: 'sowingDepthCm', label: t('operations.form.detail.sowingDepthCm'), unit: 'cm' },
        { key: 'thousandGrainWeightG', label: t('operations.form.detail.thousandGrainWeightG'), unit: 'g' },
        { key: 'germinationPct', label: t('operations.form.detail.germinationPct'), unit: '%', max: 100 },
      ]
    case 'fertilization':
      return opts.organic ? [{ key: 'incorporationHours', label: t('operations.form.detail.incorporationHours'), unit: 'h' }] : []
    case 'tillage':
      return [{ key: 'depthCm', label: t('operations.form.detail.depthCm'), unit: 'cm' }]
    case 'irrigation':
      return [{ key: 'waterMm', label: t('operations.form.detail.waterMm'), unit: 'mm' }]
    case 'crop_protection':
      return [{ key: 'waterLHa', label: t('operations.form.detail.waterLHa'), unit: 'l/ha' }]
    default:
      return []
  }
}

type DetailValue = string | number | boolean | null

/** Number of a detail, NaN when unset (NumberField convention). */
const numDetail = (details: Record<string, DetailValue>, key: string) => {
  const v = details[key]
  return typeof v === 'number' ? v : NaN
}

/** "≈ N 54 · P₂O₅ 20 kg/ha" for a fertilizer line, or why it cannot be computed. */
function nutrientHint(p: Product, ratePerHa: number, t: TFunction): string | null {
  if (p.category !== 'fertilizer' || Number.isNaN(ratePerHa)) return null
  const rates = nutrientKgPerHa(p, ratePerHa, p.baseUnit)
  const parts = NUTRIENT_KEYS.filter((k) => rates[k] != null).map((k) => `${NUTRIENT_LABELS[k]} ${fmt.num(rates[k], 1)}`)
  if (!parts.length) return p.nPct != null && (p.baseUnit === 'l' || p.baseUnit === 'm3') ? t('operations.form.nutrients.densityMissing') : null
  const text = t('operations.form.nutrients.hint', { values: parts.join(' · ') })
  return rates.densityAssumed ? `${text} ${t('operations.form.nutrients.densityAssumed')}` : text
}

/** `parts`: the part fields (Teilschläge) an existing operation was recorded on, kept when saving again. */
interface FieldLine { fieldId: string; treatedAreaHa: number; parts?: { fieldPartId: string; treatedAreaHa: number }[] }
interface InputLine { key: number; productId: string | null; ratePerHa: number; storageLocationId: string | null; unitCost: number }
interface HoursLine { key: number; id: string | null; hours: number }

export interface OperationFormState {
  farmId: string | null
  type: OperationType
  title: string
  titleTouched: boolean
  plannedOn: string | null
  done: boolean
  performedOn: string | null
  performedTime: string
  responsibleEmployeeId: string | null
  fields: FieldLine[]
  inputs: InputLine[]
  labor: HoursLine[]
  equipment: HoursLine[]
  contractorName: string
  contractorCost: number
  bbchStage: string
  targetOrganism: string
  weatherConditions: string
  details: Record<string, DetailValue>
  notes: string
}

let keySeq = 1
const nextKey = () => keySeq++

export function initialState(opts: { farmId: string | null; fieldIds?: string[]; fields: Field[]; operation?: Operation | null; type?: OperationType }): OperationFormState {
  const op = opts.operation
  if (op) {
    const performed = op.performedAt ? new Date(op.performedAt) : null
    return {
      farmId: op.farmId,
      type: op.type,
      title: op.title,
      titleTouched: true,
      plannedOn: op.plannedOn,
      // Keeps an existing performed time (e.g. of a reopened record) when editing.
      done: performed != null,
      performedOn: performed ? performed.toLocaleDateString('sv-SE') : null,
      performedTime: performed ? performed.toTimeString().slice(0, 5) : '08:00',
      responsibleEmployeeId: op.responsibleEmployee?.id ?? null,
      fields: groupFieldLines(op),
      inputs: op.inputs.map((i) => ({ key: nextKey(), productId: i.productId, ratePerHa: i.ratePerHa ?? NaN, storageLocationId: i.storageLocationId, unitCost: NaN })),
      labor: op.labor.map((l) => ({ key: nextKey(), id: l.employeeId, hours: l.hours })),
      equipment: op.equipment.map((e) => ({ key: nextKey(), id: e.equipmentId, hours: e.hours })),
      contractorName: op.contractorName ?? '',
      contractorCost: op.contractorCost ?? NaN,
      bbchStage: op.bbchStage ?? '',
      targetOrganism: op.targetOrganism ?? '',
      weatherConditions: op.weatherConditions ?? '',
      details: { ...op.details },
      notes: op.notes ?? '',
    }
  }
  const byId = new Map(opts.fields.map((f) => [f.id, f]))
  return {
    farmId: opts.farmId,
    type: opts.type ?? 'fertilization',
    title: operationTypeLabel(opts.type ?? 'fertilization'),
    titleTouched: false,
    plannedOn: today(),
    done: false,
    performedOn: today(),
    performedTime: new Date().toTimeString().slice(0, 5),
    responsibleEmployeeId: null,
    fields: (opts.fieldIds ?? []).filter((id) => byId.has(id)).map((id) => ({ fieldId: id, treatedAreaHa: byId.get(id)!.croppedAreaHa })),
    inputs: [],
    labor: [],
    equipment: [],
    contractorName: '',
    contractorCost: NaN,
    bbchStage: '',
    targetOrganism: '',
    weatherConditions: '',
    details: defaultDetails(opts.type ?? 'fertilization'),
    notes: '',
  }
}

/** Plant protection on arable land is applied in the open field unless the user says otherwise. */
const defaultDetails = (type: OperationType): Record<string, DetailValue> => (type === 'crop_protection' ? { usageType: 'open_field' } : {})

/** Request body for POST/PUT /operations. */
/** One line per field; an operation recorded on several parts of a field shows their total. */
function groupFieldLines(op: Operation): FieldLine[] {
  const lines = new Map<string, FieldLine>()
  for (const f of op.fields) {
    const line = lines.get(f.fieldId) ?? { fieldId: f.fieldId, treatedAreaHa: 0 }
    line.treatedAreaHa = Math.round((line.treatedAreaHa + f.treatedAreaHa) * 1e4) / 1e4
    if (f.fieldPartId) line.parts = [...(line.parts ?? []), { fieldPartId: f.fieldPartId, treatedAreaHa: f.treatedAreaHa }]
    lines.set(f.fieldId, line)
  }
  return [...lines.values()]
}

export function toPayload(s: OperationFormState, fields: Field[], version?: number) {
  const byId = new Map(fields.map((f) => [f.id, f]))
  return {
    farmId: s.farmId,
    type: s.type,
    title: s.title.trim() || operationTypeLabel(s.type),
    status: 'planned' as const,
    plannedOn: s.plannedOn,
    performedAt: s.done && s.performedOn ? localToIso(s.performedOn, s.performedTime || '08:00') : null,
    responsibleEmployeeId: s.responsibleEmployeeId,
    contractorName: s.contractorName.trim() || null,
    contractorCost: num(s.contractorCost),
    bbchStage: s.bbchStage.trim() || null,
    targetOrganism: s.targetOrganism.trim() || null,
    weatherConditions: s.weatherConditions.trim() || null,
    // Empty inputs (NaN, blank text, "none") are left out.
    details: Object.fromEntries(Object.entries(s.details).filter(([, v]) => v != null && v !== '' && !(typeof v === 'number' && Number.isNaN(v)))),
    notes: s.notes.trim() || null,
    fields: s.fields.flatMap((f) => {
      if (f.parts?.length) {
        // Recorded per part: keep the parts, scaled to the edited total area.
        const total = f.parts.reduce((sum, p) => sum + p.treatedAreaHa, 0)
        const factor = Number.isNaN(f.treatedAreaHa) || !total ? 1 : f.treatedAreaHa / total
        return f.parts.map((p) => ({ fieldId: f.fieldId, fieldPartId: p.fieldPartId, treatedAreaHa: Math.round(p.treatedAreaHa * factor * 1e4) / 1e4 }))
      }
      return [{
        fieldId: f.fieldId,
        // Only send an explicit area when it differs from the field's (cropped) area.
        treatedAreaHa: Number.isNaN(f.treatedAreaHa) || Math.abs(f.treatedAreaHa - (byId.get(f.fieldId)?.croppedAreaHa ?? 0)) < 1e-4 ? null : f.treatedAreaHa,
      }]
    }),
    inputs: s.inputs.filter((i) => i.productId && !Number.isNaN(i.ratePerHa)).map((i) => ({ productId: i.productId, ratePerHa: i.ratePerHa, storageLocationId: i.storageLocationId, unitCost: num(i.unitCost) })),
    labor: s.labor.filter((l) => l.id && l.hours > 0).map((l) => ({ employeeId: l.id, hours: l.hours })),
    equipment: s.equipment.filter((e) => e.id && e.hours > 0).map((e) => ({ equipmentId: e.id, hours: e.hours })),
    ...(version ? { version } : {}),
  }
}

interface Props {
  value: OperationFormState
  onChange: (s: OperationFormState) => void
  onSubmit: () => void
  isPending: boolean
  submitLabel: string
  /** New operations can be recorded as already done; existing ones complete via the detail page. */
  allowRecordDone?: boolean
  error?: unknown
  onForceComplete?: () => void
  extraActions?: ReactNode
}

export function OperationForm({ value: s, onChange, onSubmit, isPending, submitLabel, allowRecordDone, error, onForceComplete, extraActions }: Props) {
  const { t } = useTranslation()
  const { can } = useOrg()
  const farms = useOrgQuery<Farm[]>('/farms')
  const allFields = useOrgQuery<Field[]>('/fields')
  const products = useOrgQuery<Product[]>('/products')
  const employees = useOrgQuery<Employee[]>('/employees')
  const equipment = useOrgQuery<Equipment[]>('/equipment')
  const storage = useOrgQuery<StorageLocation[]>('/storage-locations')
  const [allProducts, setAllProducts] = useState(false)
  const set = (patch: Partial<OperationFormState>) => onChange({ ...s, ...patch })

  const farmFields = useMemo(() => (allFields.data ?? []).filter((f) => !s.farmId || f.farmId === s.farmId), [allFields.data, s.farmId])
  const fieldById = useMemo(() => new Map(farmFields.map((f) => [f.id, f])), [farmFields])
  const totalArea = s.fields.reduce((sum, f) => sum + (Number.isNaN(f.treatedAreaHa) ? fieldById.get(f.fieldId)?.croppedAreaHa ?? 0 : f.treatedAreaHa), 0)
  const categories = TYPE_CATEGORIES[s.type]
  const productItems = (products.data ?? []).filter((p) => allProducts || categories.length === 0 || categories.includes(p.category))
  const productById = new Map((products.data ?? []).map((p) => [p.id, p]))
  const activeEmployees = (employees.data ?? []).filter((e) => e.active)
  const activeEquipment = (equipment.data ?? []).filter((e) => e.status !== 'retired')
  const selectedIds = new Set(s.fields.map((f) => f.fieldId))
  const shortages = error instanceof ApiRequestError && error.code === 'insufficient_stock' ? (error.details as StockShortage[]) : null
  const organicInput = s.inputs.some((i) => i.productId && isOrganicFertilizer(productById.get(i.productId)?.fertilizerType))
  // The approved use is picked for the first registered product on the crop of the first field.
  const psmProduct = s.type === 'crop_protection' ? s.inputs.map((i) => (i.productId ? productById.get(i.productId) : undefined)).find((p) => p?.category === 'crop_protection' && p.registrationNumber) : undefined
  const firstField = s.fields.length ? fieldById.get(s.fields[0].fieldId) : undefined
  const setDetail = (key: string, v: DetailValue) => set({ details: { ...s.details, [key]: v } })
  const seedsPerM2 = numDetail(s.details, 'seedsPerM2')
  const tgw = numDetail(s.details, 'thousandGrainWeightG')

  const toggleField = (id: string, on: boolean) =>
    set({ fields: on ? [...s.fields, { fieldId: id, treatedAreaHa: fieldById.get(id)?.croppedAreaHa ?? NaN }] : s.fields.filter((f) => f.fieldId !== id) })

  const setType = (type: OperationType) =>
    set({ type, title: s.titleTouched ? s.title : operationTypeLabel(type), details: defaultDetails(type), inputs: TYPE_CATEGORIES[type].length === 0 && type !== 'other' ? [] : s.inputs })

  return (
    <Form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit()
      }}
    >
      <Card title={t('operations.form.what')}>
        <div className="space-y-5">
          <div role="radiogroup" aria-label={t('operations.typeLabel')} className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {OPERATION_TYPES.map((ty) => {
              const Icon = OPERATION_ICONS[ty]
              const active = s.type === ty
              return (
                <button
                  key={ty}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setType(ty)}
                  className={cx(
                    'flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-sm text-left transition-colors',
                    active ? 'border-primary bg-primary-soft text-primary font-medium' : 'border-line hover:bg-surface-2 text-fg-2',
                    focusRing,
                  )}
                >
                  <Icon className="size-4 shrink-0" aria-hidden />
                  {operationTypeLabel(ty)}
                </button>
              )
            })}
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <TextField label={t('operations.form.title')} isRequired value={s.title} onChange={(title) => set({ title, titleTouched: true })} />
            {(farms.data?.length ?? 0) > 1 && (
              <Select label={t('operations.farm')} items={farms.data ?? []} value={s.farmId} onChange={(v) => set({ farmId: v ? String(v) : null, fields: [] })}>
                {(f) => <Option id={f.id}>{f.name}</Option>}
              </Select>
            )}
            <DatePicker label={t('operations.form.plannedFor')} value={s.plannedOn} onChange={(plannedOn) => set({ plannedOn })} />
            <Select label={t('operations.responsible')} items={[{ id: '__none', name: t('operations.form.notAssigned') }, ...activeEmployees]} value={s.responsibleEmployeeId ?? '__none'} onChange={(v) => set({ responsibleEmployeeId: v && v !== '__none' ? String(v) : null })}>
              {(e) => <Option id={e.id}>{e.name}</Option>}
            </Select>
          </div>
          {allowRecordDone && (
            <div className="rounded-lg border border-line bg-surface-2/60 p-3 space-y-3">
              <Switch isSelected={s.done} onChange={(done) => set({ done })}>
                {t('operations.form.alreadyDone')}
              </Switch>
              {s.done && (
                <div className="grid grid-cols-2 gap-3 max-w-md">
                  <DatePicker label={t('operations.performedOn')} value={s.performedOn} onChange={(performedOn) => set({ performedOn })} maxValue={today()} isRequired />
                  <TextField label={t('operations.time')} type="time" value={s.performedTime} onChange={(performedTime) => set({ performedTime })} />
                </div>
              )}
            </div>
          )}
        </div>
      </Card>

      <Card title={t('operations.form.where')} description={t('operations.form.whereSummary', { count: s.fields.length, area: fmt.ha(totalArea) })}>
        <div className="grid lg:grid-cols-[1fr_1.1fr] gap-4">
          <div className="border border-line rounded-lg max-h-96 overflow-y-auto divide-y divide-line">
            {farmFields.map((f) => {
              const line = s.fields.find((l) => l.fieldId === f.id)
              return (
                <div key={f.id} className={cx('px-3 py-2 flex items-center gap-3', line && 'bg-primary-soft/40')}>
                  <Checkbox isSelected={!!line} onChange={(on) => toggleField(f.id, on)} className="flex-1 min-w-0">
                    <span className="min-w-0">
                      <span className="block truncate">{f.name}</span>
                      <span className="block text-xs text-muted truncate">{fmt.ha(f.croppedAreaHa)}{f.partCount > 0 && ` ${t('fieldParts.ofParts', { area: fmt.ha(f.areaHa) })}`} · {f.currentCrop?.cropName ?? t('operations.form.noCrop')}</span>
                    </span>
                  </Checkbox>
                  {line && (
                    <NumberField
                      aria-label={t('operations.form.treatedAreaOn', { name: f.name })}
                      className="w-32"
                      unit="ha"
                      minValue={0.0001}
                      maxValue={f.croppedAreaHa * 1.05}
                      step={0.01}
                      formatOptions={{ maximumFractionDigits: 4 }}
                      value={line.treatedAreaHa}
                      onChange={(v) => set({ fields: s.fields.map((l) => (l.fieldId === f.id ? { ...l, treatedAreaHa: v } : l)) })}
                    />
                  )}
                </div>
              )
            })}
            {!farmFields.length && <p className="p-4 text-sm text-muted">{t('operations.form.noFields')}</p>}
          </div>
          <FieldMap
            fields={farmFields}
            view={farmView(farms.data?.find((f) => f.id === s.farmId))}
            onSelect={(id) => id && toggleField(id, !selectedIds.has(id))}
            colorBy={(f) => (selectedIds.has(f.id) ? '#f2b632' : '#9aa392')}
            className="h-72 lg:h-auto min-h-72"
          />
        </div>
      </Card>

      {(categories.length > 0 || s.inputs.length > 0) && (
        <Card
          title={t('operations.products')}
          description={t('operations.form.productsDescription')}
          actions={
            <Button size="sm" onPress={() => set({ inputs: [...s.inputs, { key: nextKey(), productId: null, ratePerHa: NaN, storageLocationId: null, unitCost: NaN }] })}>
              <Plus /> {t('operations.form.addProduct')}
            </Button>
          }
        >
          {s.inputs.length === 0 ? (
            <p className="text-sm text-muted">{t('operations.form.noProducts')}</p>
          ) : (
            <div className="space-y-3">
              {s.inputs.map((line, idx) => {
                const p = line.productId ? productById.get(line.productId) : undefined
                const unit = p ? baseUnitLabel(p.baseUnit) : ''
                const total = Number.isNaN(line.ratePerHa) ? null : line.ratePerHa * totalArea
                const short = p && total != null && total > p.stock
                const hint = p ? nutrientHint(p, line.ratePerHa, t) : null
                const update = (patch: Partial<InputLine>) => set({ inputs: s.inputs.map((l, i) => (i === idx ? { ...l, ...patch } : l)) })
                return (
                  <div key={line.key} className="grid sm:grid-cols-[minmax(12rem,1.6fr)_9rem_minmax(9rem,1fr)_auto] gap-3 items-end rounded-lg border border-line p-3">
                    <ComboBox label={t('operations.product')} items={productItems} value={line.productId} onChange={(v) => update({ productId: v ? String(v) : null })} placeholder={t('operations.form.searchProducts')}>
                      {(item) => <Option id={item.id} textValue={item.name} description={t('operations.form.inStock', { qty: fmt.qty(item.stock, item.baseUnit) })}>{item.name}</Option>}
                    </ComboBox>
                    <NumberField label={t('operations.rate')} unit={unit ? `${unit}/ha` : '/ha'} minValue={0} formatOptions={{ maximumFractionDigits: 4 }} value={line.ratePerHa} onChange={(ratePerHa) => update({ ratePerHa })} isRequired />
                    <div className="text-sm pb-2">
                      <div className="text-muted text-xs">{t('common.total')}</div>
                      <div className={cx('tabular font-medium', short && 'text-warning')}>
                        {total != null && p ? fmt.qty(total, p.baseUnit) : '—'}
                        {p && <span className="text-xs text-muted font-normal"> · {t('operations.form.inStock', { qty: fmt.qty(p.stock, p.baseUnit) })}</span>}
                      </div>
                      {short && <div className="text-xs text-warning flex items-center gap-1"><AlertTriangle className="size-3" /> {t('operations.form.exceedsStock')}</div>}
                      {hint && <div className="text-xs text-fg-2">{hint}</div>}
                    </div>
                    <Button variant="ghost" size="icon" aria-label={t('operations.form.removeProduct')} onPress={() => set({ inputs: s.inputs.filter((_, i) => i !== idx) })}>
                      <X />
                    </Button>
                    {(storage.data?.length ?? 0) > 1 && (
                      <Select label={t('operations.form.fromStorage')} className="sm:col-span-2" items={[{ id: '__any', name: t('operations.form.anyLocation') }, ...(storage.data ?? [])]} value={line.storageLocationId ?? '__any'} onChange={(v) => update({ storageLocationId: v && v !== '__any' ? String(v) : null })}>
                        {(l) => <Option id={l.id}>{l.name}</Option>}
                      </Select>
                    )}
                    {can('finance.read') && (
                      <NumberField label={t('operations.form.unitCostOverride')} unit={unit ? `€/${unit}` : '€'} minValue={0} placeholder={p?.unitCost != null ? String(p.unitCost) : t('operations.form.productDefault')} formatOptions={{ maximumFractionDigits: 4 }} value={line.unitCost} onChange={(unitCost) => update({ unitCost })} className="sm:col-span-2" />
                    )}
                  </div>
                )
              })}
              {categories.length > 0 && (
                <Checkbox isSelected={allProducts} onChange={setAllProducts}>
                  {t('operations.form.allCategories')}
                </Checkbox>
              )}
            </div>
          )}
        </Card>
      )}

      <Card title={t('operations.form.work')} description={t('operations.form.workDescription')}>
        <div className="grid lg:grid-cols-2 gap-6">
          <HoursList
            label={t('operations.form.people')}
            addLabel={t('operations.form.addPerson')}
            items={activeEmployees.map((e) => ({ id: e.id, name: e.name, hint: e.hourlyRate != null ? `${fmt.money(e.hourlyRate, 'EUR', 2)}/h` : undefined }))}
            lines={s.labor}
            onChange={(labor) => set({ labor })}
          />
          <HoursList
            label={t('operations.form.machinery')}
            addLabel={t('operations.form.addMachine')}
            items={activeEquipment.map((e) => ({ id: e.id, name: e.name, hint: e.hourlyCost != null ? `${fmt.money(e.hourlyCost, 'EUR', 2)}/h` : undefined }))}
            lines={s.equipment}
            onChange={(equipment) => set({ equipment })}
          />
          <TextField label={t('operations.contractor')} value={s.contractorName} onChange={(contractorName) => set({ contractorName })} placeholder={t('operations.form.contractorPlaceholder')} />
          <NumberField label={t('operations.form.contractorCost')} unit="€" minValue={0} value={s.contractorCost} onChange={(contractorCost) => set({ contractorCost })} />
        </div>
      </Card>

      <Card title={t('operations.form.recordDetails')}>
        <div className="grid sm:grid-cols-2 gap-4">
          {detailFields(s.type, t, { organic: organicInput }).map((d) => (
            <NumberField
              key={d.key}
              label={d.label}
              unit={d.unit}
              minValue={0}
              maxValue={d.max}
              formatOptions={{ maximumFractionDigits: 2 }}
              value={numDetail(s.details, d.key)}
              onChange={(v) => setDetail(d.key, v)}
              description={d.key === 'thousandGrainWeightG' && !Number.isNaN(seedsPerM2) && !Number.isNaN(tgw) ? t('operations.form.seedRateHint', { kg: fmt.num(seedKgPerHa(seedsPerM2, tgw), 1) }) : undefined}
            />
          ))}
          {s.type === 'fertilization' && organicInput && (
            <Select
              label={t('operations.form.detail.applicationTechnique')}
              items={[{ id: NONE, name: t('operations.form.notSpecified') }, ...enumItems(APPLICATION_TECHNIQUES, applicationTechniqueLabel.all())]}
              value={typeof s.details.applicationTechnique === 'string' ? s.details.applicationTechnique : NONE}
              onChange={(v) => setDetail('applicationTechnique', keyOrNull(v == null ? null : String(v)))}
            >
              {(i) => <Option id={i.id}>{i.name}</Option>}
            </Select>
          )}
          {s.type === 'tillage' && (
            <TextField label={t('operations.form.detail.tool')} value={typeof s.details.tool === 'string' ? s.details.tool : ''} onChange={(v) => setDetail('tool', v)} placeholder={t('operations.form.toolPlaceholder')} />
          )}
          {psmProduct && firstField?.currentCrop && (
            <PsmUseSelect
              kennr={psmProduct.psm?.kennr ?? psmProduct.registrationNumber!}
              fieldId={firstField.id}
              cropCycleId={firstField.currentCrop.cropCycleId}
              value={typeof s.details.psmUseId === 'string' ? s.details.psmUseId : null}
              onChange={(v) => setDetail('psmUseId', v)}
            />
          )}
          {s.type === 'crop_protection' && (
            <>
              <Select
                label={t('operations.form.detail.usageType')}
                items={[{ id: NONE, name: t('operations.form.notSpecified') }, ...enumItems(PSM_USAGE_TYPES, psmUsageTypeLabel.all())]}
                value={typeof s.details.usageType === 'string' ? s.details.usageType : NONE}
                onChange={(v) => setDetail('usageType', keyOrNull(v == null ? null : String(v)))}
              >
                {(i) => <Option id={i.id}>{i.name}</Option>}
              </Select>
              <TextField label={t('operations.form.bbch')} value={s.bbchStage} onChange={(bbchStage) => set({ bbchStage })} placeholder={t('operations.form.bbchPlaceholder')} />
              <TextField label={t('operations.form.targetOrganism')} value={s.targetOrganism} onChange={(targetOrganism) => set({ targetOrganism })} placeholder={t('operations.form.targetOrganismPlaceholder')} />
            </>
          )}
          {(s.type === 'crop_protection' || s.type === 'fertilization') && (
            <TextField label={t('operations.form.weather')} value={s.weatherConditions} onChange={(weatherConditions) => set({ weatherConditions })} placeholder={t('operations.form.weatherPlaceholder')} />
          )}
          <TextField label={t('common.notes')} multiline rows={3} value={s.notes} onChange={(notes) => set({ notes })} className="sm:col-span-2" />
        </div>
      </Card>

      {shortages ? (
        <Notice tone="warning" icon={AlertTriangle}>
          <strong>{t('operations.form.shortageTitle')}</strong>
          <ul className="list-disc pl-4 mt-1">
            {shortages.map((sh) => (
              <li key={sh.productId}>
                {t('operations.form.shortageLine', { product: sh.productName, required: fmt.qty(sh.required, sh.baseUnit), available: fmt.qty(sh.available, sh.baseUnit) })}
              </li>
            ))}
          </ul>
          <p className="mt-1">{t('operations.form.shortageHint')}</p>
          {onForceComplete && can('inventory.write') && (
            <Button size="sm" variant="secondary" className="mt-2" onPress={onForceComplete}>
              {t('operations.completeAnyway')}
            </Button>
          )}
        </Notice>
      ) : error ? (
        <Notice tone="danger">{errorMessage(error)}</Notice>
      ) : null}

      <div className="flex flex-wrap justify-end gap-2 sticky bottom-0 z-20 bg-canvas/95 backdrop-blur py-3 -mx-1 px-1 border-t border-line">
        {extraActions}
        <Button type="submit" variant="primary" isPending={isPending} isDisabled={!s.fields.length || !s.farmId}>
          {submitLabel}
        </Button>
      </div>
    </Form>
  )
}

function HoursList({ label, addLabel, items, lines, onChange }: { label: string; addLabel: string; items: { id: string; name: string; hint?: string }[]; lines: HoursLine[]; onChange: (l: HoursLine[]) => void }) {
  const { t } = useTranslation()
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-fg-2">{label}</span>
        <Button size="sm" variant="quiet" onPress={() => onChange([...lines, { key: nextKey(), id: null, hours: NaN }])}>
          <Plus /> {addLabel}
        </Button>
      </div>
      {lines.length === 0 && <p className="text-sm text-muted">{t('operations.form.noneRecorded')}</p>}
      {lines.map((line, i) => (
        <div key={line.key} className="flex gap-2 items-end">
          <Select aria-label={label} className="flex-1" items={items} value={line.id} onChange={(v) => onChange(lines.map((l, j) => (j === i ? { ...l, id: v ? String(v) : null } : l)))} placeholder={t('operations.form.select')}>
            {(item) => <Option id={item.id} description={item.hint}>{item.name}</Option>}
          </Select>
          <NumberField aria-label={t('operations.form.hours')} className="w-28" unit="h" minValue={0} step={0.25} value={line.hours} onChange={(hours) => onChange(lines.map((l, j) => (j === i ? { ...l, hours } : l)))} />
          <Button variant="ghost" size="icon" aria-label={t('common.remove')} onPress={() => onChange(lines.filter((_, j) => j !== i))}>
            <X />
          </Button>
        </div>
      ))}
    </div>
  )
}

/**
 * Approved uses (Anwendungsgebiete) of a plant-protection product for the crop growing on a field,
 * from the BVL register. Renders nothing while the crop or the uses are unknown.
 */
function PsmUseSelect({ kennr, fieldId, cropCycleId, value, onChange }: { kennr: string; fieldId: string; cropCycleId: string; value: string | null; onChange: (v: string | null) => void }) {
  const { t } = useTranslation()
  const cycles = useOrgQuery<CropCycle[]>('/crop-cycles', { fieldId }, { staleTime: 60_000 })
  const cycle = cycles.data?.find((c) => c.id === cropCycleId)
  const uses = useOrgQuery<PsmUse[]>(cycle ? `/catalogue/psm/${encodeURIComponent(kennr)}/uses` : null, { cropId: cycle?.cropId }, { staleTime: 5 * 60_000 })
  if (!cycle || !uses.data) return null
  const matching = uses.data.filter((u) => u.matchesCrop)
  if (!matching.length) return <p className="text-sm text-muted sm:col-span-2">{t('operations.form.psmUse.none', { crop: cycle.cropName })}</p>

  const summary = (u: PsmUse) =>
    [
      u.awgId,
      (u.bbchFrom != null || u.bbchTo != null) && t('operations.form.psmUse.bbch', { from: u.bbchFrom ?? '–', to: u.bbchTo ?? '–' }),
      u.doseMax != null && t('operations.form.psmUse.maxDose', { dose: fmt.num(u.doseMax, 3), unit: u.doseUnit ?? '' }),
      u.maxApplications != null && t('operations.form.psmUse.maxApplications', { count: u.maxApplications }),
      u.waitingDays != null && t('operations.form.psmUse.waitingDays', { count: u.waitingDays }),
    ]
      .filter(Boolean)
      .join(' · ')
  const items = [{ id: NONE, use: null as PsmUse | null }, ...matching.map((u) => ({ id: u.awgId, use: u }))]

  return (
    <Select
      label={t('operations.form.psmUse')}
      className="sm:col-span-2"
      items={items}
      value={value ?? NONE}
      onChange={(v) => onChange(keyOrNull(v == null ? null : String(v)))}
      description={t('operations.form.psmUse.hint', { crop: cycle.cropName })}
    >
      {(item) =>
        item.use ? (
          <Option id={item.id} textValue={item.use.targets.join(', ') || item.id} description={summary(item.use)}>
            {item.use.targets.join(', ') || item.id}
          </Option>
        ) : (
          <Option id={item.id}>{t('operations.form.notSpecified')}</Option>
        )
      }
    </Select>
  )
}
