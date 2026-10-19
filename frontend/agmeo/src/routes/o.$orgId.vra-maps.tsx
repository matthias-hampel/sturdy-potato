import {
  BulkVraInput,
  VRA_INPUT_TYPES,
  VRA_RATE_STEPS,
  VRA_UNITS_BY_TYPE,
  type BulkVraResult,
  type Crop,
  type Field,
  type Product,
  type ProductCategory,
  type VraExportFormat,
  type VraInputType,
  type VraMapListItem,
  type VraRateUnit,
} from '@agmeo/contracts'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Download, Layers, Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { type Selection } from 'react-aria-components'
import { useTranslation } from 'react-i18next'
import { SelectionBar, selectedIds } from '#/components/table/tableTools'
import { EXPORT_FORMATS, inputLabel, rateRange, sourceLabel, typeLabel, unitLabel } from '#/components/vra/labels'
import { api, errorMessage } from '#/lib/api'
import { fmt } from '#/lib/format'
import { useOrg, useSeason } from '#/lib/org'
import { useOrgMutation, useOrgQuery } from '#/lib/queries'
import { Button } from '#/ui/Button'
import { Checkbox, ComboBox, NumberField, Option, SearchField, Select, TextField, num } from '#/ui/Field'
import { Badge, Card, EmptyState, ErrorNotice, Loading, Notice, PageHeader } from '#/ui/Layout'
import { Menu, MenuItem, MenuTrigger, ModalDialog } from '#/ui/Overlay'
import { Cell, Column, Row, Table, TableBody, TableHeader } from '#/ui/Table'
import { toast } from '#/ui/Toast'

export const Route = createFileRoute('/o/$orgId/vra-maps')({
  component: VraMapsPage,
})

/**
 * Application maps of the organization (reference application-maps page): every saved map
 * with its field and base, batch export of the selected maps, and maps for many fields at once.
 */
function VraMapsPage() {
  const { t } = useTranslation()
  const { orgId, can } = useOrg()
  const navigate = useNavigate()
  const maps = useOrgQuery<VraMapListItem[]>('/vra-maps')
  const [search, setSearch] = useState('')
  const [selection, setSelection] = useState<Selection>(new Set())
  const [bulkOpen, setBulkOpen] = useState(false)
  const [exporting, setExporting] = useState(false)

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (maps.data ?? []).filter((m) => !q || `${m.title} ${m.fieldName} ${m.farmName}`.toLowerCase().includes(q))
  }, [maps.data, search])
  const selected = [...selectedIds(selection, shown)]

  const exportSelected = async (format: VraExportFormat) => {
    setExporting(true)
    try {
      const res = await api.downloadPost(`/orgs/${orgId}/vra-maps/export`, { mapIds: selected, format }, 'application-maps.zip')
      toast.success(t('vra.org.exported', { count: selected.length }), res)
    } catch (e) {
      toast.error(t('apiError.download_failed'), errorMessage(e))
    }
    setExporting(false)
  }

  return (
    <>
      <PageHeader
        title={t('vra.org.title')}
        subtitle={t('vra.org.subtitle')}
        actions={
          can('field.write') && (
            <Button variant="primary" onPress={() => setBulkOpen(true)}>
              <Plus /> {t('vra.bulk.open')}
            </Button>
          )
        }
      />
      {maps.isLoading ? (
        <Loading />
      ) : maps.error ? (
        <ErrorNotice error={maps.error} />
      ) : (maps.data ?? []).length === 0 ? (
        <EmptyState icon={Layers} title={t('vra.org.emptyTitle')}>
          {t('vra.org.emptyBody')}
        </EmptyState>
      ) : (
        <Card padded={false} title={t('vra.org.list')} actions={<SearchField aria-label={t('vra.org.search')} placeholder={t('vra.org.search')} value={search} onChange={setSearch} className="w-64" />}>
          <Table
            aria-label={t('vra.org.list')}
            selectionMode="multiple"
            selectedKeys={selection}
            onSelectionChange={setSelection}
            onRowAction={(key) => {
              const m = shown.find((x) => x.id === key)
              if (m) void navigate({ to: '/o/$orgId/fields/$fieldId', params: { orgId, fieldId: m.fieldId }, search: { tab: 'maps' } })
            }}
          >
            <TableHeader>
              <Column className="w-10">
                <Checkbox slot="selection" />
              </Column>
              <Column isRowHeader>{t('vra.org.field')}</Column>
              <Column>{t('vra.columns.map')}</Column>
              <Column>{t('common.type')}</Column>
              <Column>{t('vra.base.label')}</Column>
              <Column>{t('vra.columns.rates')}</Column>
              <Column>{t('common.status')}</Column>
              <Column align="end">{t('vra.columns.updated')}</Column>
            </TableHeader>
            <TableBody items={shown}>
              {(m) => (
                <Row id={m.id}>
                  <Cell>
                    <Checkbox slot="selection" />
                  </Cell>
                  <Cell>
                    <span className="font-medium">{m.fieldName}</span>
                    <span className="block text-xs text-muted">
                      {m.farmName} · {fmt.ha(m.fieldAreaHa)}
                    </span>
                  </Cell>
                  <Cell>
                    {m.title}
                    {!m.current && <span className="block text-xs text-warning">{t('vra.earlierBoundary')}</span>}
                  </Cell>
                  <Cell>{typeLabel(m.type)}</Cell>
                  <Cell>
                    <span className="text-sm">{m.zoningName ?? sourceLabel(m.zoningSource)}</span>
                    <span className="block text-xs text-muted">{t('vra.base.zoneCount', { count: m.zoneCount })}</span>
                  </Cell>
                  <Cell>
                    <span className="text-sm text-fg-2 tabular">{rateRange(m)}</span>
                  </Cell>
                  <Cell>
                    <Badge tone={m.status === 'final' ? 'success' : 'neutral'}>{m.status === 'final' ? t('vra.status.final') : t('vra.status.draft')}</Badge>
                  </Cell>
                  <Cell align="end">{fmt.date(m.updatedAt)}</Cell>
                </Row>
              )}
            </TableBody>
          </Table>
        </Card>
      )}
      <SelectionBar count={selected.length} onClear={() => setSelection(new Set())}>
        <MenuTrigger>
          <Button size="sm" isPending={exporting}>
            <Download /> {t('vra.org.export')}
          </Button>
          <Menu onAction={(key) => void exportSelected(key as VraExportFormat)}>
            {EXPORT_FORMATS.map((e) => (
              <MenuItem key={e.id} id={e.id} textValue={e.label}>
                <span className="flex flex-col">
                  <span>{e.label}</span>
                  <span className="text-xs text-muted">{t(`vra.org.exportFormat.${e.id}`)}</span>
                </span>
              </MenuItem>
            ))}
          </Menu>
        </MenuTrigger>
      </SelectionBar>
      {bulkOpen && (
        <BulkDialog
          onClose={() => setBulkOpen(false)}
          onCreated={(result) => {
            setSelection(new Set(result.created.map((m) => m.id)))
          }}
        />
      )}
    </>
  )
}

const PRODUCT_CATEGORY: Record<VraInputType, ProductCategory> = { sowing: 'seed', fertilizing: 'fertilizer', spraying: 'crop_protection' }
const BASES = ['default', 'productivity', 'yield', 'soil', 'uniform'] as const
const FALLBACKS = ['productivity', 'uniform', 'skip'] as const

/**
 * Maps for many fields at once (reference bulk setup dialog): pick the fields, the input, the
 * standard rate (per field if needed), the base — each field's default, productivity, yield,
 * soil or uniform, with a fallback — and the rate strategy.
 */
function BulkDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (r: BulkVraResult) => void }) {
  const { t } = useTranslation()
  const { seasonId } = useSeason()
  const fields = useOrgQuery<Field[]>('/fields', { seasonId })
  const products = useOrgQuery<Product[]>('/products')
  const crops = useOrgQuery<Crop[]>('/crops')
  const [step, setStep] = useState<'fields' | 'setup' | 'done'>('fields')
  const [search, setSearch] = useState('')
  const [cropFilter, setCropFilter] = useState('all')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [type, setType] = useState<VraInputType>('fertilizing')
  const [productId, setProductId] = useState<string | null>(null)
  const [cropId, setCropId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [unit, setUnit] = useState<VraRateUnit>('kg/ha')
  const [standardRate, setStandardRate] = useState(Number.NaN)
  const [germination, setGermination] = useState(94)
  const [base, setBase] = useState<(typeof BASES)[number]>('default')
  const [fallback, setFallback] = useState<(typeof FALLBACKS)[number]>('productivity')
  const [zoneCount, setZoneCount] = useState(5)
  const [strategy, setStrategy] = useState<'proportional' | 'inverse'>('proportional')
  const [rateStep, setRateStep] = useState(0)
  const [title, setTitle] = useState(() => t('vra.bulk.defaultTitle'))
  const [overrides, setOverrides] = useState<Record<string, number>>({})
  const [result, setResult] = useState<BulkVraResult | null>(null)

  const active = (fields.data ?? []).filter((f) => f.status === 'active')
  const cropNames = [...new Set(active.map((f) => f.currentCrop?.cropName).filter((c): c is string => !!c))].sort()
  const q = search.trim().toLowerCase()
  const listed = active.filter((f) => (!q || f.name.toLowerCase().includes(q)) && (cropFilter === 'all' || f.currentCrop?.cropName === cropFilter))
  const chosen = active.filter((f) => picked.has(f.id))
  const area = chosen.reduce((s, f) => s + f.areaHa, 0)
  const pickedCrops = [...new Set(chosen.map((f) => f.currentCrop?.cropName).filter(Boolean))]
  const product = products.data?.find((p) => p.id === productId)

  const payload = {
    type,
    title,
    base,
    fallback,
    zoneCount,
    strategy,
    rateStep: rateStep || null,
    input: {
      productId,
      cropId: type === 'sowing' ? cropId : null,
      name: name || product?.name || '',
      unit,
      standardRate: num(standardRate) ?? 0,
      germinationPct: unit === 'plants/ha' ? germination : null,
    },
    fields: chosen.map((f) => ({ fieldId: f.id, standardRate: overrides[f.id] ?? null })),
  }
  const valid = BulkVraInput.safeParse(payload).success && (type !== 'sowing' || !!cropId) && (type === 'sowing' || !!payload.input.name)
  const create = useOrgMutation((orgBase, body: typeof payload) => api.post<BulkVraResult>(`${orgBase}/vra-maps/bulk`, body), {
    onSuccess: (r) => {
      setResult(r)
      setStep('done')
      onCreated(r)
      toast.success(t('vra.bulk.created', { count: r.created.length }))
    },
  })

  return (
    <ModalDialog
      isOpen
      onOpenChange={(o) => !o && onClose()}
      isDismissable={false}
      size="xl"
      title={t('vra.bulk.title')}
      description={step === 'fields' ? t('vra.bulk.stepFields') : step === 'setup' ? t('vra.bulk.stepSetup', { count: chosen.length, area: fmt.ha(area) }) : undefined}
      footer={(close) =>
        step === 'done' ? (
          <Button variant="primary" onPress={close}>
            {t('common.close')}
          </Button>
        ) : (
          <>
            <Button variant="ghost" onPress={close}>
              {t('common.cancel')}
            </Button>
            <div className="flex-1" />
            {step === 'setup' && <Button onPress={() => setStep('fields')}>{t('vra.bulk.back')}</Button>}
            {step === 'fields' ? (
              <Button variant="primary" isDisabled={!chosen.length} onPress={() => setStep('setup')}>
                {t('vra.bulk.next', { count: chosen.length })}
              </Button>
            ) : (
              <Button variant="primary" isDisabled={!valid} isPending={create.isPending} onPress={() => create.mutate(payload)}>
                {t('vra.bulk.create', { count: chosen.length })}
              </Button>
            )}
          </>
        )
      }
    >
      {step === 'fields' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <SearchField aria-label={t('vra.bulk.searchFields')} placeholder={t('vra.bulk.searchFields')} value={search} onChange={setSearch} className="w-64" />
            {cropNames.length > 0 && (
              <Select aria-label={t('vra.editor.crop')} className="w-56" items={[{ id: 'all', label: t('vra.bulk.allCrops') }, ...cropNames.map((c) => ({ id: c, label: c }))]} value={cropFilter} onChange={(v) => v && setCropFilter(String(v))}>
                {(item) => <Option id={item.id}>{item.label}</Option>}
              </Select>
            )}
            <div className="flex-1" />
            <Checkbox
              isSelected={listed.length > 0 && listed.every((f) => picked.has(f.id))}
              onChange={(on) => setPicked((p) => new Set(on ? [...p, ...listed.map((f) => f.id)] : [...p].filter((id) => !listed.some((f) => f.id === id))))}
            >
              {t('vra.bulk.selectAll')}
            </Checkbox>
          </div>
          {fields.isLoading ? (
            <Loading />
          ) : (
            <ul className="grid sm:grid-cols-2 gap-x-6 gap-y-1 max-h-96 overflow-y-auto">
              {listed.map((f) => (
                <li key={f.id}>
                  <Checkbox isSelected={picked.has(f.id)} onChange={(on) => setPicked((p) => { const next = new Set(p); if (on) next.add(f.id); else next.delete(f.id); return next })}>
                    <span className="font-medium">{f.name}</span>
                    <span className="text-muted"> · {fmt.ha(f.areaHa)}{f.currentCrop ? ` · ${f.currentCrop.cropName}` : ''}</span>
                  </Checkbox>
                </li>
              ))}
            </ul>
          )}
          {chosen.length > 0 && <p className="text-sm text-fg-2">{t('vra.bulk.selected', { count: chosen.length, area: fmt.ha(area) })}</p>}
        </div>
      )}

      {step === 'setup' && (
        <div className="space-y-5">
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <Select
              label={t('common.type')}
              items={VRA_INPUT_TYPES.map((id) => ({ id, label: inputLabel(id) }))}
              value={type}
              onChange={(v) => {
                if (!v) return
                setType(v as VraInputType)
                setUnit(VRA_UNITS_BY_TYPE[v as VraInputType][0])
                setProductId(null)
              }}
            >
              {(item) => <Option id={item.id}>{item.label}</Option>}
            </Select>
            {type === 'sowing' && (
              <ComboBox label={t('vra.editor.crop')} items={crops.data ?? []} value={cropId} onChange={(v) => setCropId((v as string | null) ?? null)}>
                {(c) => <Option id={c.id}>{c.name}</Option>}
              </ComboBox>
            )}
            <ComboBox
              label={type === 'sowing' ? t('vra.editor.seedFromInventory') : t('vra.editor.productFromInventory')}
              placeholder={t('common.optional')}
              items={(products.data ?? []).filter((p) => p.category === PRODUCT_CATEGORY[type] && !p.archivedAt)}
              value={productId}
              onChange={(v) => setProductId((v as string | null) ?? null)}
            >
              {(p) => <Option id={p.id}>{p.name}</Option>}
            </ComboBox>
            <TextField label={type === 'sowing' ? t('vra.editor.seedName') : t('vra.editor.productName')} placeholder={product?.name} value={name} onChange={setName} />
            <Select label={t('vra.editor.unit')} items={VRA_UNITS_BY_TYPE[type].map((u) => ({ id: u, label: unitLabel(u) }))} value={unit} onChange={(v) => v && setUnit(v as VraRateUnit)}>
              {(item) => <Option id={item.id}>{item.label}</Option>}
            </Select>
            <NumberField label={unit === 'plants/ha' ? t('vra.editor.targetStand') : t('vra.standardRate')} unit={unitLabel(unit)} minValue={0} value={standardRate} onChange={setStandardRate} formatOptions={{ maximumFractionDigits: 2 }} />
            {unit === 'plants/ha' && <NumberField label={t('vra.editor.germination')} unit="%" minValue={1} maxValue={100} value={germination} onChange={(v) => setGermination(Number.isNaN(v) ? 94 : v)} />}
          </div>
          {type === 'sowing' && pickedCrops.length > 1 && <Notice tone="warning">{t('vra.bulk.mixedCrops', { crops: pickedCrops.join(', ') })}</Notice>}

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Select label={t('vra.bulk.base')} items={BASES.map((id) => ({ id, label: t(`vra.bulk.base.${id}`) }))} value={base} onChange={(v) => v && setBase(v as typeof base)}>
              {(item) => <Option id={item.id}>{item.label}</Option>}
            </Select>
            <Select label={t('vra.bulk.fallback')} items={FALLBACKS.map((id) => ({ id, label: t(`vra.bulk.fallback.${id}`) }))} value={fallback} onChange={(v) => v && setFallback(v as typeof fallback)}>
              {(item) => <Option id={item.id}>{item.label}</Option>}
            </Select>
            <Select label={t('vra.bulk.zoneCount')} items={[3, 5, 7].map((n) => ({ id: String(n), label: String(n) }))} value={String(zoneCount)} onChange={(v) => v && setZoneCount(Number(v))}>
              {(item) => <Option id={item.id}>{item.label}</Option>}
            </Select>
            <Select
              label={t('vra.strategy.label')}
              items={[
                { id: 'proportional', label: t('vra.strategy.proportional') },
                { id: 'inverse', label: t('vra.strategy.inverse') },
              ]}
              value={strategy}
              onChange={(v) => v && setStrategy(v as typeof strategy)}
            >
              {(item) => <Option id={item.id}>{item.label}</Option>}
            </Select>
            {unit !== 'seeds/ha' && unit !== 'plants/ha' && (
              <Select label={t('vra.strategy.step')} items={[{ id: '0', label: t('vra.strategy.stepOff') }, ...VRA_RATE_STEPS.map((s) => ({ id: String(s), label: String(s) }))]} value={String(rateStep)} onChange={(v) => setRateStep(Number(v) || 0)}>
                {(item) => <Option id={item.id}>{item.label}</Option>}
              </Select>
            )}
            <TextField label={t('vra.bulk.titleLabel')} description={t('vra.bulk.titleHint')} value={title} onChange={setTitle} className="lg:col-span-2" />
          </div>
          <p className="text-xs text-muted">{t('vra.bulk.baseHint')}</p>

          <div className="rounded-xl border border-line overflow-hidden">
            <div className="px-3 py-2 text-xs text-muted bg-surface-2">{t('vra.bulk.perField')}</div>
            <ul className="max-h-64 overflow-y-auto divide-y divide-line">
              {chosen.map((f) => (
                <li key={f.id} className="flex items-center gap-3 px-3 py-1.5 text-sm">
                  <span className="flex-1 min-w-0 truncate">
                    <span className="font-medium">{f.name}</span>
                    <span className="text-muted"> · {fmt.ha(f.areaHa)}</span>
                  </span>
                  <NumberField
                    aria-label={t('vra.bulk.rateFor', { field: f.name })}
                    className="w-36"
                    minValue={0}
                    placeholder={Number.isNaN(standardRate) ? '' : fmt.num(standardRate, 2)}
                    value={overrides[f.id] ?? Number.NaN}
                    onChange={(v) => setOverrides((o) => { const next = { ...o }; if (Number.isNaN(v) || !v) delete next[f.id]; else next[f.id] = v; return next })}
                    formatOptions={{ maximumFractionDigits: 2 }}
                  />
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {step === 'done' && result && (
        <div className="space-y-3">
          <Notice tone={result.failed.length ? 'warning' : 'success'}>{t('vra.bulk.result', { count: result.created.length })}</Notice>
          {result.failed.length > 0 && (
            <>
              <p className="text-sm">{t('vra.bulk.failedIntro', { count: result.failed.length })}</p>
              <ul className="list-disc pl-5 text-sm">
                {result.failed.map((f) => (
                  <li key={f.fieldId}>
                    {f.fieldName ?? f.fieldId} — {t(`vra.bulk.failed.${f.code}`, { defaultValue: f.code })}
                  </li>
                ))}
              </ul>
            </>
          )}
          <p className="text-sm text-muted">{t('vra.bulk.resultHint')}</p>
        </div>
      )}
    </ModalDialog>
  )
}
