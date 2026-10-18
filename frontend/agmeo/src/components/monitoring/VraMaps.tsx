import {
  columnNameFrom,
  defaultRates,
  presetRate,
  roundRate,
  VRA_IMPERIAL,
  VRA_PRESETS,
  VRA_UNITS_BY_TYPE,
  VraMapInput,
  vraInputTotals,
  zoneColor,
  ZONE_COUNTS,
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
  type VraMapSummary,
  type VraMapType,
  type VraRateUnit,
  type VraUnitSystem,
  type ZoneCount,
  type Zoning,
} from '@agmeo/contracts'
import { ChevronDown, Download, MoreHorizontal, Pencil, Plus, SlidersHorizontal, Trash2, Wand2 } from 'lucide-react'
import { useMutation } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Button as AriaButton } from 'react-aria-components'
import { useTranslation } from 'react-i18next'
import { t } from '#/i18n'
import { api, errorMessage } from '#/lib/api'
import { fmt } from '#/lib/format'
import { useOrg, useSeason } from '#/lib/org'
import { useOrgMutation, useOrgQuery } from '#/lib/queries'
import { Button, buttonClass, SegmentedControl } from '#/ui/Button'
import { Checkbox, ComboBox, NumberField, Option, Select, Switch, TextField, num } from '#/ui/Field'
import { Badge, Card, Notice } from '#/ui/Layout'
import { Menu, MenuItem, MenuSeparator, MenuTrigger, ModalDialog } from '#/ui/Overlay'
import { Cell, Column, Row, Table, TableBody, TableHeader } from '#/ui/Table'
import { toast } from '#/ui/Toast'
import { zoneName } from './ProductivityZones'

const MAP_TYPES: VraMapType[] = ['sowing', 'fertilizing', 'spraying', 'several']
const INPUT_TYPES: VraInputType[] = ['sowing', 'fertilizing', 'spraying']
const typeLabel = (type: VraMapType) => t(`vra.type.${type}`)
const inputLabel = (type: VraInputType) => t(`vra.type.${type}`)
/** Default title of a new map, e.g. "Düngung Schlag 1"; kept in step with the type while untouched. */
const defaultTitle = (type: VraMapType, fieldName: string) => t('vra.defaultTitle', { type: typeLabel(type), field: fieldName })
const PRODUCT_CATEGORY: Record<VraInputType, ProductCategory> = { sowing: 'seed', fertilizing: 'fertilizer', spraying: 'crop_protection' }
/** What a rate unit counts, for totals (shown translated: seeds → Körner). */
const AMOUNT: Record<VraRateUnit, string> = { 'seeds/ha': 'seeds', 'kg/ha': 'kg', 'l/ha': 'l' }
const amountLabel = (unit: VraRateUnit) => (AMOUNT[unit] === 'seeds' ? t('vra.unit.seeds') : AMOUNT[unit])
/** Display label of a rate unit; the unit value itself ('seeds/ha') is data and stays. */
const unitLabel = (unit: string) => (unit === 'seeds/ha' ? t('vra.unit.seedsPerHa') : unit === 'seeds/ac' ? t('vra.unit.seedsPerAc') : unit)
const EXPORT_FORMATS: { id: VraExportFormat; label: string }[] = [
  { id: 'shp', label: 'Shapefile' },
  { id: 'isoxml', label: 'ISO-XML' },
  { id: 'geojson', label: 'GeoJSON' },
]
const exportsList = () => EXPORT_FORMATS.map((e) => ({ ...e, description: t(`vra.export.${e.id}`) }))

/** Validation messages of `VraMapInput` (English in the contracts), translated where known. */
const ISSUE_KEYS: Record<string, string> = {
  'Up to six letters or digits': 'vra.issue.columnFormat',
  'Sowing needs a standard rate above 0': 'vra.issue.sowingRate',
  'Sowing needs a crop': 'vra.issue.sowingCrop',
  'Enter the product name': 'vra.issue.productName',
  'Each input needs a column name': 'vra.issue.columnMissing',
  'Column names must be unique': 'vra.issue.columnUnique',
  'A map with several inputs needs at least two': 'vra.issue.severalInputs',
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
  }
}

const exportMap = (orgId: string, fieldId: string, mapId: string, format: VraExportFormat) =>
  api.download(`/orgs/${orgId}/fields/${fieldId}/vra-maps/${mapId}/export`, { format }).catch(() => toast.error(t('apiError.download_failed')))

function rateRange(map: VraMapSummary) {
  return map.inputs
    .map((i) => {
      const values = Object.values(i.rates)
      const [lo, hi] = [Math.min(...values), Math.max(...values)]
      const label = i.name || i.cropName || inputLabel(i.inputType)
      return `${label} ${lo === hi ? fmt.num(lo, 2) : `${fmt.num(lo, 2)}–${fmt.num(hi, 2)}`} ${unitLabel(i.unit)}`
    })
    .join(' · ')
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
    })),
  }
}

/** The saved content of a draft, ignoring its version. */
const snapshot = (draft: Draft) => JSON.stringify({ ...toPayload(draft), version: undefined })

/** Variable-rate maps of a field, made from its productivity zonings. */
export function VraMaps({ field, zonings, zoneCount }: { field: Field; zonings: Zoning[]; zoneCount: ZoneCount }) {
  const { t } = useTranslation()
  const { orgId, can } = useOrg()
  const maps = useOrgQuery<VraMapSummary[]>(`/fields/${field.id}/vra-maps`)
  const [editing, setEditing] = useState<{ map: VraMap | null } | null>(null)
  const remove = useOrgMutation((base, id: string) => api.delete(`${base}/fields/${field.id}/vra-maps/${id}`), { success: t('vra.deleted') })
  const open = async (id: string) => {
    try {
      setEditing({ map: await api.get<VraMap>(`/orgs/${orgId}/fields/${field.id}/vra-maps/${id}`) })
    } catch {
      toast.error(t('vra.loadFailed'))
    }
  }
  const list = maps.data ?? []
  const canCreate = can('field.write') && zonings.length > 0

  return (
    <Card
      title={t('vra.title')}
      description={t('vra.description')}
      padded={list.length === 0}
      actions={
        canCreate && (
          <Button variant="primary" size="sm" onPress={() => setEditing({ map: null })}>
            <Plus /> {t('vra.create')}
          </Button>
        )
      }
    >
      {list.length === 0 ? (
        <p className="text-sm text-muted">{maps.isLoading ? t('common.loading') : t('vra.empty')}</p>
      ) : (
        <Table aria-label={t('vra.tableLabel', { field: field.name })}>
          <TableHeader>
            <Column isRowHeader>{t('vra.columns.map')}</Column>
            <Column>{t('common.type')}</Column>
            <Column align="end">{t('vra.columns.zones')}</Column>
            <Column>{t('vra.columns.rates')}</Column>
            <Column>{t('common.status')}</Column>
            <Column align="end">{t('vra.columns.updated')}</Column>
            <Column align="end">
              <span className="sr-only">{t('common.actions')}</span>
            </Column>
          </TableHeader>
          <TableBody items={list}>
            {(m) => (
              <Row id={m.id}>
                <Cell>
                  <span className="font-medium">{m.title}</span>
                  {!m.current && <span className="block text-xs text-warning">{t('vra.earlierBoundary')}</span>}
                </Cell>
                <Cell>{typeLabel(m.type)}</Cell>
                <Cell align="end">{m.zoneCount}</Cell>
                <Cell>
                  <span className="text-sm text-fg-2 tabular">{rateRange(m)}</span>
                </Cell>
                <Cell>
                  <Badge tone={m.status === 'final' ? 'success' : 'neutral'}>{m.status === 'final' ? t('vra.status.final') : t('vra.status.draft')}</Badge>
                </Cell>
                <Cell align="end">{fmt.date(m.updatedAt)}</Cell>
                <Cell align="end">
                  <MenuTrigger>
                    <AriaButton aria-label={t('vra.actionsFor', { title: m.title })} className={buttonClass('ghost', 'icon-sm')}>
                      <MoreHorizontal className="size-4" />
                    </AriaButton>
                    <Menu
                      onAction={(key) => {
                        if (key === 'edit') void open(m.id)
                        else if (key === 'delete') remove.mutate(m.id)
                        else void exportMap(orgId, field.id, m.id, key as VraExportFormat)
                      }}
                    >
                      <MenuItem id="edit">
                        <Pencil /> {can('field.write') ? t('common.edit') : t('vra.view')}
                      </MenuItem>
                      <MenuSeparator />
                      {EXPORT_FORMATS.map((e) => (
                        <MenuItem key={e.id} id={e.id}>
                          <Download /> {t('vra.downloadFormat', { format: e.label })}
                        </MenuItem>
                      ))}
                      {can('field.write') && (
                        <>
                          <MenuSeparator />
                          <MenuItem id="delete" danger>
                            <Trash2 /> {t('common.delete')}
                          </MenuItem>
                        </>
                      )}
                    </Menu>
                  </MenuTrigger>
                </Cell>
              </Row>
            )}
          </TableBody>
        </Table>
      )}
      {editing && (
        <VraMapEditor
          field={field}
          zonings={zonings}
          initialCount={zoneCount}
          map={editing.map}
          readOnly={!can('field.write')}
          onClose={() => setEditing(null)}
        />
      )}
    </Card>
  )
}

function VraMapEditor({
  field,
  zonings,
  initialCount,
  map,
  readOnly,
  onClose,
}: {
  field: Field
  zonings: Zoning[]
  initialCount: ZoneCount
  map: VraMap | null
  readOnly: boolean
  onClose: () => void
}) {
  const { t } = useTranslation()
  const { orgId } = useOrg()
  const products = useOrgQuery<Product[]>('/products')
  const crops = useOrgQuery<Crop[]>('/crops')
  const standard = zonings.filter((z) => !z.isCustom)

  /** Zones of a zoning: the current analysis, or the edited map's own (possibly older) zoning. */
  const zonesOf = (zoningId: string): ZoneRow[] =>
    standard.find((z) => z.id === zoningId)?.zones ?? (map && map.zoningId === zoningId ? map.zones : [])

  const [initial] = useState<Draft>(() => {
    if (map)
      return {
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
        })),
      }
    const zoning = standard.find((z) => z.zoneCount === initialCount) ?? standard[0]
    return {
      id: null,
      version: null,
      zoningId: zoning.id,
      title: defaultTitle('fertilizing', field.name),
      type: 'fertilizing',
      unitSystem: 'metric',
      status: 'draft',
      inputs: [newInput('fertilizing', zoning.zones)],
    }
  })
  const [draft, setDraft] = useState(initial)
  /** Input whose rates are being suggested, and the explanation of the last suggestion per input. */
  const [suggestFor, setSuggestFor] = useState<string | null>(null)
  const [explanations, setExplanations] = useState<Record<string, string>>({})
  /** The payload last saved (or loaded), to tell unsaved changes from a map ready for download. */
  const [savedSnapshot, setSavedSnapshot] = useState(() => (map ? snapshot(initial) : ''))
  const zones = zonesOf(draft.zoningId)
  const zoneCount = zones.length
  const currentCropId = useMemo(
    () => crops.data?.find((c) => c.name === field.currentCrop?.cropName)?.id ?? null,
    [crops.data, field.currentCrop],
  )

  const setInput = (key: string, patch: Partial<DraftInput>) =>
    setDraft((d) => ({ ...d, inputs: d.inputs.map((i) => (i.key === key ? { ...i, ...patch } : i)) }))

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

  /** A new standard rate resets the zone rates to it, scaled by each zone's productivity. */
  const setStandard = (input: DraftInput, value: number | null) =>
    setInput(input.key, { standardRate: value, rates: value ? defaultRates(value, zones, input.unit) : input.rates })

  const setZoneCount = (count: ZoneCount) => {
    const zoning = standard.find((z) => z.zoneCount === count)
    if (!zoning) return
    setDraft((d) => ({
      ...d,
      zoningId: zoning.id,
      inputs: d.inputs.map((i) => ({
        ...i,
        rates: i.standardRate ? defaultRates(i.standardRate, zoning.zones, i.unit) : Object.fromEntries(zoning.zones.map((z) => [String(z.zoneNo), 0])),
      })),
    }))
  }

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
            <Button
              variant="primary"
              isDisabled={issues.length > 0 || !dirty}
              isPending={save.isPending}
              onPress={() => save.mutate(payload)}
            >
              {t('common.save')}
            </Button>
          )}
        </>
      )}
    >
      <fieldset disabled={readOnly} className="space-y-5">
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 items-end">
          <TextField label={t('vra.editor.title')} value={draft.title} onChange={(title) => setDraft((d) => ({ ...d, title }))} className="lg:col-span-2" isReadOnly={readOnly} />
          <Select
            label={t('common.type')}
            items={MAP_TYPES.map((id) => ({ id, label: typeLabel(id) }))}
            value={draft.type}
            onChange={(v) => v && setType(v as VraMapType)}
            isDisabled={readOnly}
          >
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

        <div className="flex flex-wrap items-center gap-3">
          <SegmentedControl
            aria-label={t('zones.numberOfZones')}
            value={String(zoneCount) as `${ZoneCount}`}
            onChange={(v) => setZoneCount(Number(v) as ZoneCount)}
            isDisabled={readOnly}
            items={ZONE_COUNTS.filter((n) => standard.some((z) => z.zoneCount === n) || n === zoneCount).map((n) => ({
              id: String(n) as `${ZoneCount}`,
              label: t('zones.count', { count: n }),
            }))}
          />
          {draft.zoningId !== standard.find((z) => z.zoneCount === zoneCount)?.id && (
            <span className="text-xs text-warning">{t('vra.editor.earlierZoning')}</span>
          )}
          <div className="flex-1" />
          <Switch isSelected={draft.status === 'final'} onChange={(on) => setDraft((d) => ({ ...d, status: on ? 'final' : 'draft' }))} isDisabled={readOnly}>
            {t('vra.status.final')}
          </Switch>
        </div>

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
                  <ComboBox
                    label={t('vra.editor.crop')}
                    items={crops.data ?? []}
                    value={input.cropId}
                    onChange={(v) => setInput(input.key, { cropId: (v as string | null) ?? null })}
                    isDisabled={readOnly}
                  >
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
                  onChange={(v) => {
                    if (!v) return
                    const unit = v as VraRateUnit
                    setInput(input.key, { unit, rates: input.standardRate ? defaultRates(input.standardRate, zones, unit) : input.rates })
                  }}
                  isDisabled={readOnly}
                >
                  {(item) => <Option id={item.id}>{unitLabel(item.id)}</Option>}
                </Select>
                <NumberField
                  label={t('vra.standardRate')}
                  unit={unitLabel(input.unit)}
                  minValue={0}
                  value={input.standardRate ?? Number.NaN}
                  onChange={(v) => setStandard(input, Number.isNaN(v) || v === 0 ? null : v)}
                  formatOptions={{ maximumFractionDigits: 2 }}
                  isReadOnly={readOnly}
                />
              </div>
              {!readOnly && (
                <div className="flex flex-wrap items-center gap-3">
                  <Button size="sm" variant="quiet" onPress={() => setSuggestFor(input.key)}>
                    <Wand2 /> {t('vra.suggest.action')}
                  </Button>
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

        <RateTable
          zones={zones}
          inputs={draft.inputs}
          fieldAreaHa={field.areaHa}
          unitSystem={draft.unitSystem}
          readOnly={readOnly}
          onRate={(key, zoneNo, value) =>
            setDraft((d) => ({ ...d, inputs: d.inputs.map((i) => (i.key === key ? { ...i, rates: { ...i.rates, [String(zoneNo)]: value } } : i)) }))
          }
        />

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

function RateTable({
  zones,
  inputs,
  fieldAreaHa,
  unitSystem,
  readOnly,
  onRate,
}: {
  zones: ZoneRow[]
  inputs: DraftInput[]
  fieldAreaHa: number
  unitSystem: VraUnitSystem
  readOnly: boolean
  onRate: (key: string, zoneNo: number, value: number) => void
}) {
  const { t } = useTranslation()
  const label = (i: DraftInput, n: number) => (inputs.length > 1 ? i.columnName || i.name || t('vra.editor.inputN', { number: n + 1 }) : t('vra.rate'))
  const presetLabel = (p: number) => (p === 0 ? t('vra.preset.standard') : `${p > 0 ? '+' : ''}${p} %`)
  return (
    <div className="rounded-xl border border-line overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-surface-2 text-xs text-muted">
          <tr>
            <th className="text-left font-medium px-3 py-2">{t('zones.table.zone')}</th>
            <th className="text-right font-medium px-3 py-2">{t('zones.table.area')}</th>
            <th className="text-right font-medium px-3 py-2">{t('zones.table.share')}</th>
            <th className="text-right font-medium px-3 py-2">{t('zones.table.productivity')}</th>
            {inputs.map((i, n) => (
              <th key={i.key} className="text-right font-medium px-3 py-2 whitespace-nowrap">
                {label(i, n)}, {unitLabel(i.unit)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {zones.map((z) => (
            <tr key={z.zoneNo} className="border-t border-line">
              <td className="px-3 py-1.5 whitespace-nowrap">
                <span className="inline-flex items-center gap-2">
                  <span className="size-3 rounded-sm ring-1 ring-black/10" style={{ background: zoneColor(z.zoneNo, zones.length) }} aria-hidden />
                  {z.zoneNo}
                  <span className="text-muted">{zoneName(z.zoneNo, zones.length)}</span>
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
                        <AriaButton
                          aria-label={t('vra.preset.label', { zone: z.zoneNo })}
                          isDisabled={!i.standardRate}
                          className={buttonClass('ghost', 'icon-sm')}
                        >
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
            </tr>
          ))}
        </tbody>
        <tfoot className="border-t border-line bg-surface-2/60">
          {inputs.map((i, n) => {
            const totals = vraInputTotals(i, zones, fieldAreaHa)
            const amount = amountLabel(i.unit)
            const flat = `${fmt.num(i.standardRate, 2)} ${unitLabel(i.unit)}`
            const imperial = unitSystem === 'imperial' ? ` ${t('vra.totals.exportUnit', { unit: unitLabel(VRA_IMPERIAL[i.unit].unit) })}` : ''
            return (
              <tr key={i.key}>
                <td colSpan={4 + inputs.length} className="px-3 py-2 text-sm">
                  <span className="font-medium">{inputs.length > 1 ? `${label(i, n)}:` : t('vra.totals.total')} </span>
                  <span className="tabular">{fmt.qty(totals.total, amount)}</span>
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
  const modes = SUGGEST_MODES[input.inputType]
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
    onApply({ rates, standardRate: standard }, result.explanation)
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
                        <span className="size-3 rounded-sm ring-1 ring-black/10" style={{ background: zoneColor(z.zoneNo, zones.length) }} aria-hidden />
                        {z.zoneNo} <span className="text-muted">{zoneName(z.zoneNo, zones.length)}</span>
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
