import {
  columnNameFrom,
  exportRate,
  isCountUnit,
  multiplierViolations,
  presetRate,
  relativeColor,
  roundRate,
  strategyRates,
  VRA_IMPERIAL,
  VRA_PRESETS,
  VRA_RATE_STEPS,
  VRA_UNITS_BY_TYPE,
  VraMapInput,
  vraInputTotals,
  type BaseZoning,
  type Crop,
  type CropCycle,
  type Field,
  type Product,
  type ProductCategory,
  type SuggestedRates,
  type SuggestRatesInput,
  type VraExportFormat,
  type VraInputType,
  type VraMap,
  type VraMapType,
  type VraRateUnit,
  type VraStrategy,
  type VraUnitSystem,
} from '@agmeo/contracts'
import { ChevronDown, Download, Info, Paintbrush, Plus, SlidersHorizontal, Trash2, Wand2 } from 'lucide-react'
import { useMutation } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { Button as AriaButton } from 'react-aria-components'
import { useTranslation } from 'react-i18next'
import { t } from '#/i18n'
import { api, errorMessage } from '#/lib/api'
import { fmt } from '#/lib/format'
import { useOrg, useSeason } from '#/lib/org'
import { useOrgMutation, useOrgQuery } from '#/lib/queries'
import { Button, buttonClass, SegmentedControl } from '#/ui/Button'
import { Checkbox, ComboBox, NumberField, Option, Select, Switch, TextField, num } from '#/ui/Field'
import { Notice } from '#/ui/Layout'
import { Menu, MenuItem, MenuTrigger, ModalDialog } from '#/ui/Overlay'
import { toast } from '#/ui/Toast'
import { SoilZoneMap } from '../soil/SoilZoneMap'
import { amountLabel, baseLabel, exportMap, exportsList, inputLabel, typeLabel, unitLabel, zoneLevel } from './labels'

const MAP_TYPES: VraMapType[] = ['sowing', 'fertilizing', 'spraying', 'several']
const INPUT_TYPES: VraInputType[] = ['sowing', 'fertilizing', 'spraying']
/** Default title of a new map, e.g. "Düngung Schlag 1"; kept in step with the type while untouched. */
const defaultTitle = (type: VraMapType, fieldName: string) => t('vra.defaultTitle', { type: typeLabel(type), field: fieldName })
const PRODUCT_CATEGORY: Record<VraInputType, ProductCategory> = { sowing: 'seed', fertilizing: 'fertilizer', spraying: 'crop_protection' }
/** Germination rate assumed for a target stand until one is entered (reference DEFAULT_GERMINATION_RATE). */
const DEFAULT_GERMINATION = 94

/** Validation messages of `VraMapInput` (English in the contracts), translated where known. */
const ISSUE_KEYS: Record<string, string> = {
  'Up to six letters or digits': 'vra.issue.columnFormat',
  'Sowing needs a standard rate above 0': 'vra.issue.sowingRate',
  'Sowing needs a crop': 'vra.issue.sowingCrop',
  'Enter the product name': 'vra.issue.productName',
  'Each input needs a column name': 'vra.issue.columnMissing',
  'Column names must be unique': 'vra.issue.columnUnique',
  'A map with several inputs needs at least two': 'vra.issue.severalInputs',
  'A target stand needs the germination rate': 'vra.issue.germination',
}
function issueText(issue: { path: PropertyKey[]; message: string }) {
  if (issue.path[0] === 'title') return t('vra.issue.title')
  const key = ISSUE_KEYS[issue.message]
  return key ? t(key) : issue.message
}

interface DraftInput {
  key: string
  inputType: VraInputType
  productId: string | null
  cropId: string | null
  name: string
  unit: VraRateUnit
  standardRate: number | null
  columnName: string
  /** Column name typed by the user rather than derived from the name. */
  columnTouched: boolean
  rates: Record<string, number>
  germinationPct: number | null
  strategy: VraStrategy
  /** Spreader resolution the rates are rounded to (reference rateSnap); not stored. */
  rateStep: number | null
}

interface Draft {
  id: string | null
  version: number | null
  zoningId: string
  title: string
  type: VraMapType
  unitSystem: VraUnitSystem
  status: 'draft' | 'final'
  inputs: DraftInput[]
}

interface ZoneRow {
  zoneNo: number
  areaHa: number
  sharePct: number
  relativeProductivity: number | null
  geometry?: import('geojson').MultiPolygon
}

let keySeq = 0
function newInput(inputType: VraInputType, zones: ZoneRow[], cropId: string | null = null): DraftInput {
  return {
    key: `input-${++keySeq}`,
    inputType,
    productId: null,
    cropId: inputType === 'sowing' ? cropId : null,
    name: '',
    unit: VRA_UNITS_BY_TYPE[inputType][0],
    standardRate: null,
    columnName: '',
    columnTouched: false,
    rates: Object.fromEntries(zones.map((z) => [String(z.zoneNo), 0])),
    germinationPct: null,
    strategy: 'proportional',
    rateStep: null,
  }
}

/** Zone rates of an input for its strategy (manual rates stay as typed). */
function distribute(input: DraftInput, zones: ZoneRow[], standardRate = input.standardRate): Record<string, number> {
  if (!standardRate) return Object.fromEntries(zones.map((z) => [String(z.zoneNo), input.rates[String(z.zoneNo)] ?? 0]))
  const strategy = input.strategy === 'manual' ? 'proportional' : input.strategy
  return strategyRates(zones, standardRate, strategy, input.unit, isCountUnit(input.unit) ? null : input.rateStep)
}

function toPayload(draft: Draft) {
  return {
    zoningId: draft.zoningId,
    type: draft.type,
    title: draft.title,
    unitSystem: draft.unitSystem,
    status: draft.status,
    version: draft.version ?? undefined,
    inputs: draft.inputs.map((i) => ({
      inputType: i.inputType,
      productId: i.productId,
      cropId: i.inputType === 'sowing' ? i.cropId : null,
      name: i.name,
      unit: i.unit,
      standardRate: i.standardRate,
      columnName: draft.type === 'several' ? i.columnName || undefined : undefined,
      rates: i.rates,
      germinationPct: i.unit === 'plants/ha' ? (i.germinationPct ?? DEFAULT_GERMINATION) : null,
      strategy: i.strategy,
    })),
  }
}

/** The saved content of a draft, ignoring its version. */
const snapshot = (draft: Draft) => JSON.stringify({ ...toPayload(draft), version: undefined })

/**
 * Editor of one application map (reference applicationMapsPage): the base zoning, inputs with
 * product, unit and standard rate, zone rates by strategy (proportional or inverted, clipped to
 * 65–135 %), spreader resolution, presets and suggestions, totals and a preview map.
 */
export function VraMapEditor({
  field,
  bases,
  map,
  initialZoningId,
  switchTo,
  readOnly,
  onClose,
  onEditZones,
}: {
  field: Field
  bases: BaseZoning[]
  map: VraMap | null
  initialZoningId?: string | null
  /** Moves the open draft to another zoning (back from the brush editor). */
  switchTo?: { zoningId: string; nonce: number }
  readOnly: boolean
  onClose: () => void
  /** Opens the brush editor on a zoning; resolves to the zoning the edits were saved as. */
  onEditZones?: (zoningId: string, zones: ZoneRow[]) => void
}) {
  const { t } = useTranslation()
  const { orgId } = useOrg()
  const products = useOrgQuery<Product[]>('/products')
  const crops = useOrgQuery<Crop[]>('/crops')

  /** Zones of a zoning: a base of the field, or the edited map's own (possibly older) zoning. */
  const zonesOf = (zoningId: string): ZoneRow[] => bases.find((z) => z.id === zoningId)?.zones ?? (map && map.zoningId === zoningId ? map.zones : [])
  const options = useMemo(() => {
    const list = bases.map((b) => ({ id: b.id, label: `${b.isDefault ? '★ ' : ''}${baseLabel(b)}` }))
    if (map && !bases.some((b) => b.id === map.zoningId))
      list.unshift({ id: map.zoningId, label: `${map.zoningName ?? t('vra.base.mapOwn')} · ${t('vra.base.zoneCount', { count: map.zoneCount })}` })
    return list
  }, [bases, map, t])

  /** The map as saved, and the draft opened: on another zoning when the editor comes back from the brush editor. */
  const [{ initial, saved }] = useState<{ initial: Draft; saved: Draft | null }>(() => {
    if (map) {
      const loaded: Draft = {
        id: map.id,
        version: map.version,
        zoningId: map.zoningId,
        title: map.title,
        type: map.type,
        unitSystem: map.unitSystem,
        status: map.status,
        inputs: map.inputs.map((i) => ({
          key: i.id,
          inputType: i.inputType,
          productId: i.productId,
          cropId: i.cropId,
          name: i.name,
          unit: i.unit,
          standardRate: i.standardRate,
          columnName: i.columnName === 'RATE' && map.type !== 'several' ? '' : i.columnName,
          columnTouched: map.type === 'several',
          rates: i.rates,
          germinationPct: i.germinationPct,
          strategy: i.strategy ?? 'manual',
          rateStep: null,
        })),
      }
      const other = initialZoningId && initialZoningId !== map.zoningId ? bases.find((b) => b.id === initialZoningId) : null
      if (!other) return { initial: loaded, saved: loaded }
      const moved: Draft = {
        ...loaded,
        zoningId: other.id,
        inputs: loaded.inputs.map((i) => {
          const next = { ...i, strategy: i.strategy === 'manual' ? ('proportional' as const) : i.strategy }
          return { ...next, rates: distribute(next, other.zones) }
        }),
      }
      return { initial: moved, saved: loaded }
    }
    const zoning = bases.find((z) => z.id === initialZoningId) ?? bases.find((z) => z.isDefault) ?? bases[0]
    return {
      initial: {
        id: null,
        version: null,
        zoningId: zoning.id,
        title: defaultTitle('fertilizing', field.name),
        type: 'fertilizing',
        unitSystem: 'metric',
        status: 'draft',
        inputs: [newInput('fertilizing', zoning.zones)],
      },
      saved: null,
    }
  })
  const [draft, setDraft] = useState(initial)
  /** Input whose rates are being suggested, and the explanation of the last suggestion per input. */
  const [suggestFor, setSuggestFor] = useState<string | null>(null)
  const [explanations, setExplanations] = useState<Record<string, string>>({})
  /** The payload last saved (or loaded), to tell unsaved changes from a map ready for download. */
  const [savedSnapshot, setSavedSnapshot] = useState(() => (saved ? snapshot(saved) : ''))
  const zones = zonesOf(draft.zoningId)
  const zoneCount = zones.length
  const base = bases.find((b) => b.id === draft.zoningId)
  const currentCropId = useMemo(() => crops.data?.find((c) => c.name === field.currentCrop?.cropName)?.id ?? null, [crops.data, field.currentCrop])

  const setInput = (key: string, patch: Partial<DraftInput>) => setDraft((d) => ({ ...d, inputs: d.inputs.map((i) => (i.key === key ? { ...i, ...patch } : i)) }))
  /** Changes an input and redistributes its rates when they follow a strategy. */
  const update = (input: DraftInput, patch: Partial<DraftInput>) => {
    const next = { ...input, ...patch }
    setInput(input.key, { ...patch, rates: next.strategy === 'manual' ? next.rates : distribute(next, zones) })
  }

  const setType = (type: VraMapType) =>
    setDraft((d) => {
      const title = d.title === defaultTitle(d.type, field.name) ? defaultTitle(type, field.name) : d.title
      if (type === 'several') {
        const inputs = d.inputs.length >= 2 ? d.inputs : [...d.inputs, newInput('fertilizing', zones)]
        return { ...d, type, title, inputs: inputs.map((i) => (i.columnName ? i : { ...i, columnName: columnNameFrom(i.name) })) }
      }
      const first = d.inputs[0]
      const input = first.inputType === type ? first : { ...newInput(type, zones, currentCropId), key: first.key }
      return { ...d, type, title, inputs: [input] }
    })

  /**
   * A new base redistributes the rates over its zones. An uploaded map brings its mean rate as
   * the standard rate when none is set (reference onUploaded: rate files set the rate, nutrient
   * targets go through the product's content).
   */
  const setZoning = (zoningId: string) => {
    const next = zonesOf(zoningId)
    const b = bases.find((z) => z.id === zoningId)
    setDraft((d) => ({
      ...d,
      zoningId,
      inputs: d.inputs.map((i, k) => {
        let standardRate = i.standardRate
        if (k === 0 && !standardRate && b?.source === 'upload' && b.params) {
          const mean = Number(b.params.meanTarget) || 0
          const key = String(b.params.targetKey ?? 'rate')
          if (key === 'rate' && (!b.params.unit || b.params.unit === i.unit)) standardRate = mean ? roundRate(mean, i.unit) : null
          else if (key !== 'rate') {
            const product = products.data?.find((p) => p.id === i.productId)
            const pct = product ? ({ target_n: product.nPct, target_p2o5: product.p2o5Pct, target_k2o: product.k2oPct, target_mgo: product.mgoPct } as Record<string, number | null>)[key] : null
            if (pct && i.unit === 'kg/ha') standardRate = roundRate((mean * 100) / pct, i.unit)
          }
        }
        const strategy = i.strategy === 'manual' ? 'proportional' : i.strategy
        const moved = { ...i, standardRate, strategy }
        return { ...moved, rates: standardRate ? distribute(moved, next) : Object.fromEntries(next.map((z) => [String(z.zoneNo), 0])) }
      }),
    }))
  }

  const switchNonce = switchTo?.nonce
  useEffect(() => {
    if (switchTo && bases.some((b) => b.id === switchTo.zoningId)) setZoning(switchTo.zoningId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [switchNonce])

  const payload = toPayload(draft)
  const check = VraMapInput.safeParse(payload)
  const issues = check.success ? [] : [...new Set(check.error.issues.map(issueText))]

  const save = useOrgMutation(
    (base, body: ReturnType<typeof toPayload>) =>
      draft.id ? api.put<VraMap>(`${base}/fields/${field.id}/vra-maps/${draft.id}`, body) : api.post<VraMap>(`${base}/fields/${field.id}/vra-maps`, body),
    {
      success: t('vra.saved'),
      onSuccess: (saved) => {
        setDraft((d) => ({ ...d, id: saved.id, version: saved.version }))
        setSavedSnapshot(snapshot(draft))
      },
    },
  )
  const dirty = !draft.id || snapshot(draft) !== savedSnapshot

  const productsFor = (type: VraInputType) => (products.data ?? []).filter((p) => p.category === PRODUCT_CATEGORY[type] && !p.archivedAt)
  const first = draft.inputs[0]
  const firstProduct = products.data?.find((p) => p.id === first.productId) ?? null

  return (
    <ModalDialog
      isOpen
      onOpenChange={(o) => !o && onClose()}
      isDismissable={false}
      size="xl"
      title={draft.id ? draft.title : t('vra.create')}
      description={t('vra.editor.description', { field: field.name, area: fmt.ha(field.areaHa), count: zoneCount })}
      footer={(close) => (
        <>
          <MenuTrigger>
            <Button isDisabled={!draft.id || dirty}>
              <Download /> {t('common.download')} <ChevronDown />
            </Button>
            <Menu onAction={(key) => draft.id && void exportMap(orgId, field.id, draft.id, key as VraExportFormat)}>
              {exportsList().map((e) => (
                <MenuItem key={e.id} id={e.id} textValue={e.label} aria-label={t('vra.downloadFormat', { format: e.label })}>
                  <span className="flex flex-col">
                    <span>{e.label}</span>
                    <span className="text-xs text-muted">{e.description}</span>
                  </span>
                </MenuItem>
              ))}
            </Menu>
          </MenuTrigger>
          <div className="flex-1" />
          <Button variant="ghost" onPress={close}>
            {t('common.close')}
          </Button>
          {!readOnly && (
            <Button variant="primary" isDisabled={issues.length > 0 || !dirty} isPending={save.isPending} onPress={() => save.mutate(payload)}>
              {t('common.save')}
            </Button>
          )}
        </>
      )}
    >
      <fieldset disabled={readOnly} className="space-y-5">
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 items-end">
          <TextField label={t('vra.editor.title')} value={draft.title} onChange={(title) => setDraft((d) => ({ ...d, title }))} className="lg:col-span-2" isReadOnly={readOnly} />
          <Select label={t('common.type')} items={MAP_TYPES.map((id) => ({ id, label: typeLabel(id) }))} value={draft.type} onChange={(v) => v && setType(v as VraMapType)} isDisabled={readOnly}>
            {(item) => <Option id={item.id}>{item.label}</Option>}
          </Select>
          <Select
            label={t('vra.editor.exportUnits')}
            items={[
              { id: 'metric', label: t('vra.editor.metric') },
              { id: 'imperial', label: t('vra.editor.imperial') },
            ]}
            value={draft.unitSystem}
            onChange={(v) => v && setDraft((d) => ({ ...d, unitSystem: v as VraUnitSystem }))}
            isDisabled={readOnly}
          >
            {(item) => <Option id={item.id}>{item.label}</Option>}
          </Select>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <Select label={t('vra.base.label')} items={options} value={draft.zoningId} onChange={(v) => v && setZoning(String(v))} isDisabled={readOnly} className="min-w-72 flex-1">
            {(item) => <Option id={item.id}>{item.label}</Option>}
          </Select>
          {onEditZones && !readOnly && (
            <Button onPress={() => onEditZones(draft.zoningId, zones)}>
              <Paintbrush /> {t('vra.brush.edit')}
            </Button>
          )}
          <Switch isSelected={draft.status === 'final'} onChange={(on) => setDraft((d) => ({ ...d, status: on ? 'final' : 'draft' }))} isDisabled={readOnly}>
            {t('vra.status.final')}
          </Switch>
        </div>
        {base && !base.current && <p className="text-xs text-warning">{t('vra.editor.earlierZoning')}</p>}

        <div className={draft.inputs.length > 1 ? 'grid md:grid-cols-2 gap-4' : ''}>
          {draft.inputs.map((input, index) => (
            <div key={input.key} className="rounded-xl border border-line p-4 space-y-3">
              {draft.type === 'several' && (
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium flex-1">{t('vra.editor.inputN', { number: index + 1 })}</span>
                  {draft.inputs.length > 2 && !readOnly && (
                    <Button size="icon-sm" variant="ghost" aria-label={t('vra.editor.removeInput', { number: index + 1 })} onPress={() => setDraft((d) => ({ ...d, inputs: d.inputs.filter((i) => i.key !== input.key) }))}>
                      <Trash2 />
                    </Button>
                  )}
                </div>
              )}
              <div className="grid sm:grid-cols-2 gap-3">
                {draft.type === 'several' && (
                  <Select
                    label={t('vra.editor.application')}
                    items={INPUT_TYPES.map((id) => ({ id, label: inputLabel(id) }))}
                    value={input.inputType}
                    onChange={(v) => {
                      if (!v || v === input.inputType) return
                      const type = v as VraInputType
                      setInput(input.key, { inputType: type, unit: VRA_UNITS_BY_TYPE[type][0], productId: null, cropId: type === 'sowing' ? currentCropId : null })
                    }}
                    isDisabled={readOnly}
                  >
                    {(item) => <Option id={item.id}>{item.label}</Option>}
                  </Select>
                )}
                {input.inputType === 'sowing' && (
                  <ComboBox label={t('vra.editor.crop')} items={crops.data ?? []} value={input.cropId} onChange={(v) => setInput(input.key, { cropId: (v as string | null) ?? null })} isDisabled={readOnly}>
                    {(c) => <Option id={c.id}>{c.name}</Option>}
                  </ComboBox>
                )}
                <ComboBox
                  label={input.inputType === 'sowing' ? t('vra.editor.seedFromInventory') : t('vra.editor.productFromInventory')}
                  placeholder={t('common.optional')}
                  items={productsFor(input.inputType)}
                  value={input.productId}
                  onChange={(v) => {
                    const product = products.data?.find((p) => p.id === v)
                    const previous = products.data?.find((p) => p.id === input.productId)
                    const name = product && (!input.name || input.name === previous?.name) ? product.name : input.name
                    setInput(input.key, { productId: (v as string | null) ?? null, name, columnName: input.columnTouched ? input.columnName : columnNameFrom(name) })
                  }}
                  isDisabled={readOnly}
                >
                  {(p) => <Option id={p.id}>{p.name}</Option>}
                </ComboBox>
                <TextField
                  label={input.inputType === 'sowing' ? t('vra.editor.seedName') : t('vra.editor.productName')}
                  value={input.name}
                  onChange={(name) => setInput(input.key, { name, columnName: input.columnTouched ? input.columnName : columnNameFrom(name) })}
                  isReadOnly={readOnly}
                />
                {draft.type === 'several' && (
                  <TextField
                    label={t('vra.editor.columnName')}
                    description={t('vra.editor.columnNameHint')}
                    value={input.columnName}
                    maxLength={6}
                    onChange={(v) => setInput(input.key, { columnName: v.replace(/[^a-zA-Z0-9]/g, '').toUpperCase(), columnTouched: true })}
                    isReadOnly={readOnly}
                  />
                )}
                <Select
                  label={t('vra.editor.unit')}
                  items={VRA_UNITS_BY_TYPE[input.inputType].map((u) => ({ id: u }))}
                  value={input.unit}
                  onChange={(v) => v && update(input, { unit: v as VraRateUnit })}
                  isDisabled={readOnly}
                >
                  {(item) => <Option id={item.id}>{unitLabel(item.id)}</Option>}
                </Select>
                <NumberField
                  label={input.unit === 'plants/ha' ? t('vra.editor.targetStand') : t('vra.standardRate')}
                  unit={unitLabel(input.unit)}
                  minValue={0}
                  value={input.standardRate ?? Number.NaN}
                  onChange={(v) => update(input, { standardRate: Number.isNaN(v) || v === 0 ? null : v, strategy: input.strategy === 'manual' ? 'proportional' : input.strategy })}
                  formatOptions={{ maximumFractionDigits: 2 }}
                  isReadOnly={readOnly}
                />
                {input.unit === 'plants/ha' && (
                  <NumberField
                    label={t('vra.editor.germination')}
                    description={
                      input.standardRate
                        ? t('vra.editor.sowingRate', {
                            plants: fmt.num(input.standardRate),
                            germination: fmt.num(input.germinationPct ?? DEFAULT_GERMINATION),
                            seeds: fmt.num(exportRate(input.standardRate, 'plants/ha', input.germinationPct ?? DEFAULT_GERMINATION).rate),
                          })
                        : t('vra.editor.germinationHint')
                    }
                    unit="%"
                    minValue={1}
                    maxValue={100}
                    value={input.germinationPct ?? DEFAULT_GERMINATION}
                    onChange={(v) => setInput(input.key, { germinationPct: Number.isNaN(v) ? null : v })}
                    isReadOnly={readOnly}
                  />
                )}
              </div>
              {!readOnly && (
                <div className="flex flex-wrap items-center gap-3">
                  <SegmentedControl
                    aria-label={t('vra.strategy.label')}
                    value={input.strategy}
                    onChange={(v) => update(input, { strategy: v as VraStrategy })}
                    isDisabled={!input.standardRate}
                    items={[
                      { id: 'proportional', label: t('vra.strategy.proportional') },
                      { id: 'inverse', label: t('vra.strategy.inverse') },
                      ...(input.strategy === 'manual' ? [{ id: 'manual' as const, label: t('vra.strategy.manual') }] : []),
                    ]}
                  />
                  {!isCountUnit(input.unit) && (
                    <Select
                      aria-label={t('vra.strategy.step')}
                      className="w-56"
                      items={[{ id: '0', label: `${t('vra.strategy.step')}: ${t('vra.strategy.stepOff')}` }, ...VRA_RATE_STEPS.map((s) => ({ id: String(s), label: `${t('vra.strategy.step')}: ${s}` }))]}
                      value={String(input.rateStep ?? 0)}
                      onChange={(v) => update(input, { rateStep: Number(v) || null, strategy: input.strategy === 'manual' ? 'proportional' : input.strategy })}
                    >
                      {(item) => <Option id={item.id}>{item.label}</Option>}
                    </Select>
                  )}
                  <Button size="sm" variant="quiet" onPress={() => setSuggestFor(input.key)}>
                    <Wand2 /> {t('vra.suggest.action')}
                  </Button>
                  <Explainer />
                  {explanations[input.key] && <span className="text-xs text-muted flex-1 min-w-48">{explanations[input.key]}</span>}
                </div>
              )}
            </div>
          ))}
        </div>
        {draft.type === 'several' && draft.inputs.length < 6 && !readOnly && (
          <Button size="sm" onPress={() => setDraft((d) => ({ ...d, inputs: [...d.inputs, newInput('fertilizing', zones)] }))}>
            <Plus /> {t('vra.editor.addInput')}
          </Button>
        )}

        <div className="grid lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-4 items-start">
          <RateTable
            zones={zones}
            inputs={draft.inputs}
            fieldAreaHa={field.areaHa}
            unitSystem={draft.unitSystem}
            readOnly={readOnly}
            product={draft.inputs.length === 1 ? firstProduct : null}
            onRate={(key, zoneNo, value) =>
              setDraft((d) => ({ ...d, inputs: d.inputs.map((i) => (i.key === key ? { ...i, strategy: 'manual', rates: { ...i.rates, [String(zoneNo)]: value } } : i)) }))
            }
          />
          {zones.some((z) => z.geometry) && (
            <SoilZoneMap
              boundary={field.geometry}
              className="h-80"
              zones={zones.flatMap((z) =>
                z.geometry
                  ? [
                      {
                        key: String(z.zoneNo),
                        geometry: z.geometry,
                        color: first.standardRate ? relativeColor((100 * (first.rates[String(z.zoneNo)] ?? 0)) / first.standardRate) : relativeColor(z.relativeProductivity),
                      },
                    ]
                  : [],
              )}
            />
          )}
        </div>

        {!readOnly && issues.length > 0 && (
          <Notice tone="warning">
            <ul className="list-disc pl-4">
              {issues.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          </Notice>
        )}
        {draft.id && dirty && !readOnly && <p className="text-xs text-muted">{t('vra.editor.saveToDownload')}</p>}
      </fieldset>
      {suggestFor && draft.inputs.some((i) => i.key === suggestFor) && (
        <SuggestRatesDialog
          field={field}
          zoningId={draft.zoningId}
          zones={zones}
          input={draft.inputs.find((i) => i.key === suggestFor)!}
          products={products.data ?? []}
          onApply={(patch, explanation) => {
            setInput(suggestFor, patch)
            setExplanations((e) => ({ ...e, [suggestFor]: explanation }))
            setSuggestFor(null)
          }}
          onClose={() => setSuggestFor(null)}
        />
      )}
    </ModalDialog>
  )
}

/** "Warum diese Verteilung?" (reference RateDistributionExplainer). */
function Explainer() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button size="sm" variant="quiet" onPress={() => setOpen(true)}>
        <Info /> {t('vra.explainer.open')}
      </Button>
      <ModalDialog isOpen={open} onOpenChange={setOpen} title={t('vra.explainer.title')} footer={(close) => <Button onPress={close}>{t('common.close')}</Button>}>
        <ol className="space-y-3 text-sm">
          {(['1', '2', '3', '4', '5'] as const).map((n) => (
            <li key={n}>
              <div className="font-medium">{t(`vra.explainer.step${n}.title`)}</div>
              <p className="text-fg-2">{t(`vra.explainer.step${n}.body`)}</p>
            </li>
          ))}
        </ol>
      </ModalDialog>
    </>
  )
}

const NUTRIENTS = [
  { key: 'nPct', label: 'N' },
  { key: 'p2o5Pct', label: 'P₂O₅' },
  { key: 'k2oPct', label: 'K₂O' },
  { key: 'mgoPct', label: 'MgO' },
  { key: 'caoPct', label: 'CaO' },
] as const

function RateTable({
  zones,
  inputs,
  fieldAreaHa,
  unitSystem,
  readOnly,
  product,
  onRate,
}: {
  zones: ZoneRow[]
  inputs: DraftInput[]
  fieldAreaHa: number
  unitSystem: VraUnitSystem
  readOnly: boolean
  /** Product of a single-input map: its nutrient content gives kg/ha per zone. */
  product: Product | null
  onRate: (key: string, zoneNo: number, value: number) => void
}) {
  const { t } = useTranslation()
  const label = (i: DraftInput, n: number) => (inputs.length > 1 ? i.columnName || i.name || t('vra.editor.inputN', { number: n + 1 }) : t('vra.rate'))
  const presetLabel = (p: number) => (p === 0 ? t('vra.preset.standard') : `${p > 0 ? '+' : ''}${p} %`)
  const single = inputs.length === 1 ? inputs[0] : null
  const nutrients = single?.unit === 'kg/ha' && product ? NUTRIENTS.filter((n) => (product[n.key] ?? 0) > 0) : []
  const seeds = single?.unit === 'plants/ha'
  const violations = inputs.reduce((s, i) => s + multiplierViolations(i.rates, i.standardRate), 0)
  return (
    <div className="space-y-2 min-w-0">
      <div className="rounded-xl border border-line overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-xs text-muted">
            <tr>
              <th className="text-left font-medium px-3 py-2">{t('zones.table.zone')}</th>
              <th className="text-right font-medium px-3 py-2">{t('zones.table.area')}</th>
              <th className="text-right font-medium px-3 py-2">{t('zones.table.share')}</th>
              <th className="text-right font-medium px-3 py-2">{t('vra.base.relative')}</th>
              {inputs.map((i, n) => (
                <th key={i.key} className="text-right font-medium px-3 py-2 whitespace-nowrap">
                  {label(i, n)}, {unitLabel(i.unit)}
                </th>
              ))}
              {seeds && <th className="text-right font-medium px-3 py-2 whitespace-nowrap">{t('vra.editor.seedsColumn')}</th>}
              {nutrients.map((n) => (
                <th key={n.key} className="text-right font-medium px-3 py-2 whitespace-nowrap">
                  {t('vra.editor.nutrientPerHa', { nutrient: n.label })}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {zones.map((z) => (
              <tr key={z.zoneNo} className="border-t border-line">
                <td className="px-3 py-1.5 whitespace-nowrap">
                  <span className="inline-flex items-center gap-2">
                    <span className="size-3 rounded-sm ring-1 ring-black/10" style={{ background: relativeColor(z.relativeProductivity) }} aria-hidden />
                    {z.zoneNo}
                    <span className="text-muted">{zoneLevel(z.zoneNo, zones.length)}</span>
                  </span>
                </td>
                <td className="px-3 py-1.5 text-right tabular whitespace-nowrap">{fmt.ha(z.areaHa)}</td>
                <td className="px-3 py-1.5 text-right tabular">{fmt.pct(z.sharePct)}</td>
                <td className="px-3 py-1.5 text-right tabular">{fmt.pct(z.relativeProductivity)}</td>
                {inputs.map((i, n) => (
                  <td key={i.key} className="px-2 py-1">
                    <div className="flex items-center justify-end gap-1">
                      <NumberField
                        aria-label={t('vra.rateInZone', { label: label(i, n), zone: z.zoneNo })}
                        className="w-32"
                        minValue={0}
                        value={i.rates[String(z.zoneNo)] ?? Number.NaN}
                        onChange={(v) => onRate(i.key, z.zoneNo, Number.isNaN(v) ? 0 : v)}
                        formatOptions={{ maximumFractionDigits: 2 }}
                        isReadOnly={readOnly}
                      />
                      {!readOnly && (
                        <MenuTrigger>
                          <AriaButton aria-label={t('vra.preset.label', { zone: z.zoneNo })} isDisabled={!i.standardRate} className={buttonClass('ghost', 'icon-sm')}>
                            <SlidersHorizontal className="size-4" />
                          </AriaButton>
                          <Menu onAction={(key) => i.standardRate && onRate(i.key, z.zoneNo, presetRate(i.standardRate, Number(key), i.unit))}>
                            {VRA_PRESETS.map((p) => (
                              <MenuItem
                                key={p}
                                id={String(p)}
                                textValue={`${p}%`}
                                aria-label={`${presetLabel(p)}: ${fmt.num(i.standardRate ? presetRate(i.standardRate, p, i.unit) : 0, 2)} ${unitLabel(i.unit)}`}
                              >
                                <span className="flex-1 tabular">{fmt.num(i.standardRate ? presetRate(i.standardRate, p, i.unit) : 0, 2)}</span>
                                <span className="text-xs text-muted tabular">{presetLabel(p)}</span>
                              </MenuItem>
                            ))}
                          </Menu>
                        </MenuTrigger>
                      )}
                    </div>
                  </td>
                ))}
                {seeds && single && (
                  <td className="px-3 py-1.5 text-right tabular">{fmt.num(exportRate(single.rates[String(z.zoneNo)] ?? 0, 'plants/ha', single.germinationPct ?? DEFAULT_GERMINATION).rate)}</td>
                )}
                {single &&
                  nutrients.map((n) => (
                    <td key={n.key} className="px-3 py-1.5 text-right tabular">
                      {fmt.num(((single.rates[String(z.zoneNo)] ?? 0) * (product![n.key] ?? 0)) / 100, 1)}
                    </td>
                  ))}
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t border-line bg-surface-2/60">
            {inputs.map((i, n) => {
              const totals = vraInputTotals(i, zones, fieldAreaHa)
              const amount = amountLabel(i.unit)
              const flat = `${fmt.num(i.standardRate, 2)} ${unitLabel(i.unit)}`
              const imperial = unitSystem === 'imperial' ? ` ${t('vra.totals.exportUnit', { unit: unitLabel(VRA_IMPERIAL[i.unit].unit) })}` : ''
              const zoneArea = zones.reduce((s, z) => s + z.areaHa, 0)
              const mean = zoneArea > 0 ? totals.total / zoneArea : null
              return (
                <tr key={i.key}>
                  <td colSpan={4 + inputs.length + (seeds ? 1 : 0) + nutrients.length} className="px-3 py-2 text-sm">
                    <span className="font-medium">{inputs.length > 1 ? `${label(i, n)}:` : t('vra.totals.total')} </span>
                    <span className="tabular">{fmt.qty(totals.total, amount)}</span>
                    {mean != null && <span className="text-muted tabular"> · {t('vra.totals.mean', { rate: `${fmt.num(mean, 1)} ${unitLabel(i.unit)}` })}</span>}
                    {totals.showSavings && totals.savings != null && (
                      <span className={totals.savings > 0 ? 'text-success' : 'text-warning'}>
                        {' · '}
                        {t(totals.savings > 0 ? 'vra.totals.saves' : 'vra.totals.usesMore', {
                          amount: fmt.qty(Math.abs(totals.savings), amount),
                          rate: flat,
                          flatTotal: fmt.qty(totals.flatTotal, amount),
                        })}
                      </span>
                    )}
                    {totals.flatTotal != null && !totals.showSavings && <span className="text-muted"> · {t('vra.totals.sameAsFlat', { rate: flat })}</span>}
                    <span className="text-muted">{imperial}</span>
                  </td>
                </tr>
              )
            })}
          </tfoot>
        </table>
      </div>
      {violations > 0 && <Notice tone="warning">{t('vra.strategy.violations', { count: violations })}</Notice>}
    </div>
  )
}

type SuggestMode = SuggestRatesInput['mode']
/** Which suggestion fits which input: seeding rates for sowing, the N need for fertilizing. */
const SUGGEST_MODES: Record<VraInputType, SuggestMode[]> = { sowing: ['seeding', 'scale'], fertilizing: ['nitrogen', 'scale'], spraying: ['scale'] }

/**
 * Suggests zone rates on the server (proportional to productivity, the N need of the crop, or a
 * seeding rate) and fills them into one input of the map.
 */
function SuggestRatesDialog({
  field,
  zoningId,
  zones,
  input,
  products,
  onApply,
  onClose,
}: {
  field: Field
  zoningId: string
  zones: ZoneRow[]
  input: DraftInput
  products: Product[]
  onApply: (patch: Partial<DraftInput>, explanation: string) => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const { orgId } = useOrg()
  const { seasonId } = useSeason()
  const cycles = useOrgQuery<CropCycle[]>('/crop-cycles', { fieldId: field.id })
  const mainCycles = (cycles.data ?? []).filter((c) => c.role === 'main').sort((a, b) => b.harvestYear - a.harvestYear)
  // A target stand is scaled only: seeding suggestions are in seeds.
  const modes = input.unit === 'plants/ha' ? (['scale'] as SuggestMode[]) : SUGGEST_MODES[input.inputType]
  const [mode, setMode] = useState<SuggestMode>(modes[0])
  const [standardRate, setStandardRate] = useState(input.standardRate ?? Number.NaN)
  const [cycleId, setCycleId] = useState<string | null>(null)
  const [nPct, setNPct] = useState(() => products.find((p) => p.id === input.productId)?.nPct ?? Number.NaN)
  const [passPct, setPassPct] = useState(100)
  const [plants, setPlants] = useState(Number.NaN)
  const [germination, setGermination] = useState(94)
  const [tgw, setTgw] = useState(Number.NaN)
  const [strategy, setStrategy] = useState<'yield_potential' | 'risk_mitigation'>('yield_potential')
  const [inverse, setInverse] = useState(false)
  const [variation, setVariation] = useState(20)
  const [minRate, setMinRate] = useState(Number.NaN)
  const [maxRate, setMaxRate] = useState(Number.NaN)
  // The season's main crop by default, else the latest one.
  const cycle = cycleId ?? mainCycles.find((c) => c.seasonId === seasonId)?.id ?? mainCycles[0]?.id ?? null

  const suggest = useMutation<SuggestedRates, Error, SuggestRatesInput>({
    mutationFn: (body) => api.post<SuggestedRates>(`/orgs/${orgId}/vra-suggestions`, body),
    onError: (e) => toast.error(t('vra.suggest.failed'), errorMessage(e)),
  })
  const reset = () => suggest.reset()

  // Seeding suggestions come in seeds/ha; an input in kg/ha needs the thousand-grain weight.
  const toKg = mode === 'seeding' && input.unit === 'kg/ha'
  const unitMismatch = mode === 'nitrogen' && input.unit !== 'kg/ha'
  const missing =
    (mode === 'scale' && !num(standardRate)) ||
    (mode === 'nitrogen' && (!cycle || !num(nPct))) ||
    (mode === 'seeding' && (!num(plants) || (toKg && !num(tgw))))
  const convert = (v: number) => roundRate(toKg ? (v * tgw) / 1e6 : v, input.unit)

  const request = (): SuggestRatesInput => ({
    zoningId,
    mode,
    standardRate: mode === 'scale' ? num(standardRate) : null,
    cropCycleId: mode === 'nitrogen' ? cycle : null,
    nPct: mode === 'nitrogen' ? num(nPct) : null,
    passShare: passPct / 100,
    inverse,
    plantsPerM2: mode === 'seeding' ? num(plants) : null,
    germinationPct: mode === 'seeding' ? num(germination) : null,
    thousandGrainWeightG: mode === 'seeding' ? num(tgw) : null,
    strategy,
    variationPct: num(variation) ?? 20,
    // Limits are entered in the input's unit; seeding limits in kg/ha are converted back to seeds.
    minRate: num(minRate) != null && toKg ? (minRate * 1e6) / tgw : num(minRate),
    maxRate: num(maxRate) != null && toKg ? (maxRate * 1e6) / tgw : num(maxRate),
  })

  const result = suggest.data
  const apply = () => {
    if (!result) return
    const rates = Object.fromEntries(zones.map((z) => [String(z.zoneNo), convert(result.rates[String(z.zoneNo)] ?? 0)]))
    const standard = mode === 'scale' ? num(standardRate) : convert(result.meanRate)
    onApply({ rates, standardRate: standard, strategy: 'manual' }, result.explanation)
  }
  const shownUnit = unitLabel(input.unit)

  return (
    <ModalDialog
      isOpen
      onOpenChange={(o) => !o && onClose()}
      title={t('vra.suggest.title')}
      description={t('vra.suggest.description', { input: input.name || inputLabel(input.inputType) })}
      footer={(close) => (
        <>
          <Button variant="ghost" onPress={close}>
            {t('common.cancel')}
          </Button>
          <Button isDisabled={missing || unitMismatch} isPending={suggest.isPending} onPress={() => suggest.mutate(request())}>
            {t('vra.suggest.calculate')}
          </Button>
          <Button variant="primary" isDisabled={!result || suggest.isPending} onPress={apply}>
            {t('vra.suggest.apply')}
          </Button>
        </>
      )}
    >
      <div className="space-y-4">
        <Select
          label={t('vra.suggest.mode')}
          items={modes.map((id) => ({ id, label: t(`vra.suggest.mode.${id}`) }))}
          value={mode}
          onChange={(v) => {
            if (!v) return
            setMode(v as SuggestMode)
            reset()
          }}
        >
          {(m) => <Option id={m.id}>{m.label}</Option>}
        </Select>

        <div className="grid sm:grid-cols-2 gap-4">
          {mode === 'scale' && (
            <NumberField label={t('vra.standardRate')} unit={shownUnit} minValue={0} formatOptions={{ maximumFractionDigits: 2 }} value={standardRate} onChange={(v) => { setStandardRate(v); reset() }} />
          )}
          {mode === 'nitrogen' && (
            <>
              <Select
                label={t('vra.suggest.cropCycle')}
                placeholder={t('vra.suggest.noCropCycle')}
                items={mainCycles.map((c) => ({ id: c.id, label: `${c.cropName} · ${c.seasonName}${c.fieldPartName ? ` · ${c.fieldPartName}` : ''}` }))}
                value={cycle}
                onChange={(v) => { setCycleId(v ? String(v) : null); reset() }}
              >
                {(c) => <Option id={c.id}>{c.label}</Option>}
              </Select>
              <NumberField label={t('vra.suggest.nPct')} unit="% N" minValue={0.1} maxValue={100} formatOptions={{ maximumFractionDigits: 1 }} value={nPct} onChange={(v) => { setNPct(v); reset() }} />
              <NumberField
                label={t('vra.suggest.passShare')}
                description={t('vra.suggest.passShareHint')}
                unit="%"
                minValue={1}
                maxValue={100}
                value={passPct}
                onChange={(v) => { setPassPct(Number.isNaN(v) ? 100 : v); reset() }}
              />
            </>
          )}
          {mode === 'seeding' && (
            <>
              <NumberField label={t('vra.suggest.plants')} unit={t('vra.suggest.plantsUnit')} minValue={1} maxValue={2000} value={plants} onChange={(v) => { setPlants(v); reset() }} />
              <NumberField label={t('vra.suggest.germination')} unit="%" minValue={1} maxValue={100} value={germination} onChange={(v) => { setGermination(v); reset() }} />
              <NumberField
                label={t('vra.suggest.tgw')}
                description={toKg ? t('vra.suggest.tgwRequired') : undefined}
                unit="g"
                minValue={1}
                maxValue={2000}
                formatOptions={{ maximumFractionDigits: 1 }}
                value={tgw}
                onChange={(v) => { setTgw(v); reset() }}
              />
              <Select
                label={t('vra.suggest.strategy')}
                items={(['yield_potential', 'risk_mitigation'] as const).map((id) => ({ id, label: t(`vra.suggest.strategy.${id}`) }))}
                value={strategy}
                onChange={(v) => { if (v) { setStrategy(v as typeof strategy); reset() } }}
              >
                {(s) => <Option id={s.id}>{s.label}</Option>}
              </Select>
            </>
          )}
          <NumberField
            label={t('vra.suggest.variation')}
            description={t('vra.suggest.variationHint')}
            unit="%"
            minValue={0}
            maxValue={100}
            value={variation}
            onChange={(v) => { setVariation(v); reset() }}
          />
          <div className="grid grid-cols-2 gap-3">
            <NumberField label={t('vra.suggest.min')} unit={shownUnit} minValue={0} formatOptions={{ maximumFractionDigits: 2 }} value={minRate} onChange={(v) => { setMinRate(v); reset() }} />
            <NumberField label={t('vra.suggest.max')} unit={shownUnit} minValue={0} formatOptions={{ maximumFractionDigits: 2 }} value={maxRate} onChange={(v) => { setMaxRate(v); reset() }} />
          </div>
        </div>
        {mode !== 'seeding' && (
          <Checkbox isSelected={inverse} onChange={(v) => { setInverse(v); reset() }}>
            {t('vra.suggest.inverse')}
          </Checkbox>
        )}
        {unitMismatch && <Notice tone="warning">{t('vra.suggest.unitMismatch')}</Notice>}
        {mode === 'nitrogen' && cycles.data && mainCycles.length === 0 && <Notice tone="warning">{t('vra.suggest.noCrops')}</Notice>}

        {result && (
          <div className="rounded-xl border border-line overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-surface-2 text-xs text-muted">
                <tr>
                  <th className="text-left font-medium px-3 py-2">{t('zones.table.zone')}</th>
                  <th className="text-right font-medium px-3 py-2">{t('zones.table.productivity')}</th>
                  <th className="text-right font-medium px-3 py-2">
                    {t('vra.rate')}, {shownUnit}
                  </th>
                </tr>
              </thead>
              <tbody>
                {zones.map((z) => (
                  <tr key={z.zoneNo} className="border-t border-line">
                    <td className="px-3 py-1.5">
                      <span className="inline-flex items-center gap-2">
                        <span className="size-3 rounded-sm ring-1 ring-black/10" style={{ background: relativeColor(z.relativeProductivity) }} aria-hidden />
                        {z.zoneNo} <span className="text-muted">{zoneLevel(z.zoneNo, zones.length)}</span>
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-right tabular">{fmt.pct(z.relativeProductivity)}</td>
                    <td className="px-3 py-1.5 text-right tabular font-medium">{fmt.num(convert(result.rates[String(z.zoneNo)] ?? 0), 2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="px-3 py-2 border-t border-line bg-surface-2/60 text-xs text-fg-2">
              {t('vra.suggest.mean', { value: fmt.num(convert(result.meanRate), 2), unit: shownUnit })} · {result.explanation}
            </p>
          </div>
        )}
      </div>
    </ModalDialog>
  )
}
