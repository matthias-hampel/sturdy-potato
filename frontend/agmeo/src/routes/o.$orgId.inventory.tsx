import {
  ASSUMED_ORGANIC_DENSITY,
  BASE_UNITS,
  MINERAL_FERTILIZER_TYPES,
  ORGANIC_FERTILIZER_TYPES,
  PRODUCT_CATEGORIES,
  contentToPct,
  isOrganicFertilizer,
  type BaseUnit,
  type Farm,
  type FertilizerCatalogueEntry,
  type FertilizerType,
  type FileItem,
  type FromCatalogueInput,
  type FromPsmInput,
  type Product,
  type ProductCategory,
  type ProductInput,
  type PsmProductSummary,
  type StockMovement,
  type StockMovementInput,
  type StockBalance,
  type StockMovementKind,
  type StocktakeInput,
  type StorageLocation,
  type StorageLocationInput,
} from '@agmeo/contracts'
import { createFileRoute } from '@tanstack/react-router'
import { Archive, ArchiveRestore, BookOpen, CalendarClock, ClipboardCheck, Coins, Ellipsis, FileDown, FileText, History, Package, PackageMinus, PackagePlus, Pencil, Plus, Scale, ShieldCheck, TriangleAlert, Undo2, Upload, Warehouse, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Form, Header, ListBoxSection } from 'react-aria-components'
import { useTranslation } from 'react-i18next'
import { FormActions, NONE, enumItems, keyOrNull, textOrNull } from '#/components/resources/form'
import { t } from '#/i18n'
import { baseUnitLabel, productCategoryLabel } from '#/i18n/labels'
import { fertilizerTypeLabel } from '#/i18n/labels.fieldwork'
import { api } from '#/lib/api'
import { fmt, localToIso, today } from '#/lib/format'
import { useOrg } from '#/lib/org'
import { useOrgMutation, useOrgQuery } from '#/lib/queries'
import { Button, Link, SegmentedControl } from '#/ui/Button'
import { DatePicker, NumberField, Option, SearchField, Select, Switch, TextField, num } from '#/ui/Field'
import { Badge, type BadgeTone, Card, EmptyState, ErrorNotice, Loading, Notice, PageHeader, Stat, Tab, TabList, TabPanel, Tabs } from '#/ui/Layout'
import { Menu, MenuItem, MenuSeparator, MenuTrigger, ModalDialog } from '#/ui/Overlay'
import { Cell, Column, Row, Table, TableBody, TableHeader } from '#/ui/Table'
import { cx } from '#/ui/utils'

export const Route = createFileRoute('/o/$orgId/inventory')({ component: InventoryPage })

const ALL = '__all'
const categoryItems = () => enumItems(PRODUCT_CATEGORIES, productCategoryLabel.all())
const unitItems = () => enumItems(BASE_UNITS, baseUnitLabel.all())

/** Sensible base unit for a new product of each category. */
const DEFAULT_UNIT: Record<ProductCategory, BaseUnit> = {
  seed: 'kg',
  fertilizer: 'kg',
  crop_protection: 'l',
  fuel: 'l',
  consumable: 'unit',
  harvest: 't',
  other: 'unit',
}

const KIND_TONES: Record<StockMovementKind, BadgeTone> = {
  receipt: 'success',
  issue: 'warning',
  adjustment: 'info',
  consumption: 'accent',
  reversal: 'warning',
  void: 'neutral',
}

const movementKindLabel = (kind: StockMovementKind) => t(`inventory.movementKind.${kind}`)

type MovementDialog = 'receive' | 'issue' | 'adjust' | 'stocktake'
type DialogState = { kind: 'product'; product?: Product } | { kind: MovementDialog; product?: Product } | { kind: 'location' } | { kind: 'catalogue' } | { kind: 'psm' } | null

const unitLabel = (u: BaseUnit) => baseUnitLabel(u)

/** Products whose stock expires within this many days are flagged. */
const EXPIRY_WARNING_DAYS = 60
const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)

function InventoryPage() {
  const { t } = useTranslation()
  const { can } = useOrg()
  const canWrite = can('inventory.write')
  const [dialog, setDialog] = useState<DialogState>(null)
  const product = dialog && 'product' in dialog ? dialog.product : undefined
  const onOpenChange = (open: boolean) => !open && setDialog(null)

  return (
    <>
      <PageHeader
        title={t('inventory.title')}
        subtitle={t('inventory.subtitle')}
        actions={
          canWrite && (
            <>
              <Button onPress={() => setDialog({ kind: 'receive' })}>
                <PackagePlus /> {t('inventory.receiveStock')}
              </Button>
              <Button onPress={() => setDialog({ kind: 'psm' })}>
                <ShieldCheck /> {t('inventory.psm.search')}
              </Button>
              <Button onPress={() => setDialog({ kind: 'catalogue' })}>
                <BookOpen /> {t('inventory.catalogue.open')}
              </Button>
              <Button variant="primary" onPress={() => setDialog({ kind: 'product' })}>
                <Plus /> {t('inventory.newProduct')}
              </Button>
            </>
          )
        }
      />

      <Tabs>
        <TabList aria-label={t('inventory.title')}>
          <Tab id="products">{t('inventory.tabs.products')}</Tab>
          <Tab id="movements">{t('inventory.tabs.movements')}</Tab>
          <Tab id="locations">{t('inventory.tabs.locations')}</Tab>
        </TabList>
        <TabPanel id="products">
          <ProductsTab canWrite={canWrite} onAction={setDialog} />
        </TabPanel>
        <TabPanel id="movements">
          <MovementsTab />
        </TabPanel>
        <TabPanel id="locations">
          <LocationsTab canWrite={canWrite} onAdd={() => setDialog({ kind: 'location' })} />
        </TabPanel>
      </Tabs>

      <ModalDialog isOpen={dialog?.kind === 'product'} onOpenChange={onOpenChange} title={product ? t('inventory.editTitle', { name: product.name }) : t('inventory.newProduct')} size="lg">
        {(close) => <ProductForm product={product} close={close} />}
      </ModalDialog>
      <ModalDialog
        isOpen={dialog?.kind === 'receive'}
        onOpenChange={onOpenChange}
        title={t('inventory.receiveStock')}
        description={t('inventory.receiveDescription')}
        size="md"
      >
        {(close) => <MovementForm kind="receipt" product={product} close={close} />}
      </ModalDialog>
      <ModalDialog isOpen={dialog?.kind === 'issue'} onOpenChange={onOpenChange} title={t('inventory.issueStock')} description={t('inventory.issueDescription')} size="md">
        {(close) => <MovementForm kind="issue" product={product} close={close} />}
      </ModalDialog>
      <ModalDialog
        isOpen={dialog?.kind === 'adjust'}
        onOpenChange={onOpenChange}
        title={t('inventory.adjustStock')}
        description={t('inventory.adjustDescription')}
        size="md"
      >
        {(close) => <MovementForm kind="adjustment" product={product} close={close} />}
      </ModalDialog>
      <ModalDialog isOpen={dialog?.kind === 'stocktake'} onOpenChange={onOpenChange} title={t('inventory.stocktake.title')} description={t('inventory.stocktake.description')} size="md">
        {(close) => <StocktakeForm product={product} close={close} />}
      </ModalDialog>
      <ModalDialog isOpen={dialog?.kind === 'location'} onOpenChange={onOpenChange} title={t('inventory.locations.addTitle')} size="sm">
        {(close) => <LocationForm close={close} />}
      </ModalDialog>
      <ModalDialog isOpen={dialog?.kind === 'catalogue'} onOpenChange={onOpenChange} title={t('inventory.catalogue.title')} description={t('inventory.catalogue.description')} size="xl">
        {(close) => <CatalogueDialog close={close} />}
      </ModalDialog>
      <ModalDialog isOpen={dialog?.kind === 'psm'} onOpenChange={onOpenChange} title={t('inventory.psm.title')} description={t('inventory.psm.description')} size="xl">
        {(close) => <PsmSearchDialog close={close} />}
      </ModalDialog>
    </>
  )
}

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

function toInput(p: Product): ProductInput {
  return {
    category: p.category,
    name: p.name,
    manufacturer: p.manufacturer,
    baseUnit: p.baseUnit,
    unitCost: p.unitCost,
    registrationNumber: p.registrationNumber,
    activeIngredients: p.activeIngredients,
    nPct: p.nPct,
    p2o5Pct: p.p2o5Pct,
    k2oPct: p.k2oPct,
    sPct: p.sPct,
    nh4NPct: p.nh4NPct,
    mgoPct: p.mgoPct,
    caoPct: p.caoPct,
    dryMatterPct: p.dryMatterPct,
    densityTM3: p.densityTM3,
    fertilizerType: p.fertilizerType,
    lowStockThreshold: p.lowStockThreshold,
    humusCKgPerT: p.humusCKgPerT,
    nEffectivenessPct: p.nEffectivenessPct,
    website: p.website,
    datasheetFileId: p.datasheetFileId,
    notes: p.notes,
  }
}

function nutrientSummary(p: Product) {
  const parts: [string, number | null][] = [
    ['N', p.nPct],
    ['P₂O₅', p.p2o5Pct],
    ['K₂O', p.k2oPct],
    ['MgO', p.mgoPct],
    ['S', p.sPct],
  ]
  return parts
    .filter(([, v]) => v != null && v > 0)
    .map(([k, v]) => `${k} ${fmt.num(v, 1)} %`)
    .join(' · ')
}

function productDetail(p: Product) {
  if (p.category === 'fertilizer') return [p.fertilizerType && fertilizerTypeLabel(p.fertilizerType), nutrientSummary(p)].filter(Boolean).join(' · ')
  if (p.category === 'crop_protection') return [p.activeIngredients, p.registrationNumber && t('inventory.registrationShort', { number: p.registrationNumber })].filter(Boolean).join(' · ')
  return ''
}

function ProductsTab({ canWrite, onAction }: { canWrite: boolean; onAction: (d: DialogState) => void }) {
  const { t } = useTranslation()
  const { org } = useOrg()
  const [category, setCategory] = useState<string>(ALL)
  const [search, setSearch] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const products = useOrgQuery<Product[]>('/products', { includeArchived: showArchived || undefined })

  const archive = useOrgMutation((base, p: Product) => api.put<Product>(`${base}/products/${p.id}`, { ...toInput(p), archived: !p.archivedAt }), {
    success: (p) => (p.archivedAt ? t('inventory.productArchived', { name: p.name }) : t('inventory.productRestored', { name: p.name })),
  })

  const all = products.data ?? []
  const active = all.filter((p) => !p.archivedAt)
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return all
      .filter((p) => category === ALL || p.category === category)
      .filter((p) => !q || [p.name, p.manufacturer, p.activeIngredients, p.registrationNumber].some((s) => s?.toLowerCase().includes(q)))
  }, [all, category, search])

  const stockValue = active.reduce((s, p) => s + (p.stockValue ?? 0), 0)
  const lowStock = active.filter((p) => p.lowStock || p.stock < 0)
  const expiring = active.filter((p) => p.nextExpiry != null && p.nextExpiry <= addDays(today(), EXPIRY_WARNING_DAYS)).sort((a, b) => a.nextExpiry!.localeCompare(b.nextExpiry!))
  const byCategory = PRODUCT_CATEGORIES.map((c) => {
    const items = active.filter((p) => p.category === c)
    return { category: c, count: items.length, value: items.reduce((s, p) => s + (p.stockValue ?? 0), 0) }
  }).filter((c) => c.count > 0)

  if (products.isLoading) return <Loading />
  if (products.error) return <ErrorNotice error={products.error} />

  if (all.length === 0 && !showArchived)
    return (
      <Card>
        <EmptyState
          icon={Package}
          title={t('inventory.empty.title')}
          action={
            canWrite && (
              <Button variant="primary" onPress={() => onAction({ kind: 'product' })}>
                <Plus /> {t('inventory.empty.action')}
              </Button>
            )
          }
        >
          {t('inventory.empty.text')}
        </EmptyState>
      </Card>
    )

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat icon={Package} label={t('inventory.tabs.products')} value={fmt.num(active.length)} />
        <Stat icon={Coins} label={t('inventory.stats.stockValue')} value={fmt.money(stockValue, org.currency)} hint={t('inventory.stats.stockValueHint')} />
        <Stat
          icon={TriangleAlert}
          label={t('inventory.lowStock')}
          value={fmt.num(lowStock.length)}
          hint={lowStock.length ? lowStock.slice(0, 3).map((p) => p.name).join(', ') + (lowStock.length > 3 ? '…' : '') : t('inventory.stats.allAboveThreshold')}
          tone={lowStock.length ? 'warning' : 'success'}
        />
        <Stat
          icon={CalendarClock}
          label={t('inventory.stats.expiring')}
          value={fmt.num(expiring.length)}
          hint={expiring.length ? expiring.slice(0, 3).map((p) => `${p.name} (${fmt.date(p.nextExpiry!)})`).join(', ') + (expiring.length > 3 ? '…' : '') : t('inventory.stats.expiringNone', { days: EXPIRY_WARNING_DAYS })}
          tone={expiring.length ? 'warning' : 'success'}
        />
      </div>

      {byCategory.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {byCategory.map((c) => (
            <button
              key={c.category}
              type="button"
              onClick={() => setCategory(category === c.category ? ALL : c.category)}
              className={cx('rounded-lg border px-3 py-2 text-left text-sm transition-colors', category === c.category ? 'border-primary bg-primary-soft' : 'border-line bg-surface hover:bg-surface-2')}
            >
              <div className="font-medium">{productCategoryLabel(c.category)}</div>
              <div className="text-xs text-muted">
                {t('inventory.stats.categorySummary', { count: c.count, value: fmt.money(c.value, org.currency) })}
              </div>
            </button>
          ))}
        </div>
      )}

      <Card padded={false}>
        <div className="p-3 flex flex-wrap items-center gap-3 border-b border-line">
          <SearchField placeholder={t('inventory.searchProducts')} value={search} onChange={setSearch} className="flex-1 min-w-48" />
          <Select
            aria-label={t('inventory.category')}
            className="w-48"
            items={[{ id: ALL, name: t('inventory.allCategories') }, ...categoryItems()]}
            value={category}
            onChange={(v) => setCategory(String(v ?? ALL))}
          >
            {(c) => <Option id={c.id}>{c.name}</Option>}
          </Select>
          <Switch isSelected={showArchived} onChange={setShowArchived}>
            {t('inventory.showArchived')}
          </Switch>
          <Button size="sm" onPress={() => void api.download(`/orgs/${org.id}/stock/balances.csv`, undefined, 'stock.csv')}>
            <FileDown /> {t('inventory.exportCsv')}
          </Button>
        </div>
        <Table aria-label={t('inventory.tabs.products')}>
          <TableHeader>
            <Column isRowHeader>{t('inventory.product')}</Column>
            <Column>{t('inventory.category')}</Column>
            <Column>{t('inventory.manufacturer')}</Column>
            <Column align="end">{t('inventory.stock')}</Column>
            <Column align="end">{t('inventory.price')}</Column>
            <Column align="end">{t('inventory.value')}</Column>
            <Column>{t('common.status')}</Column>
            {canWrite && (
              <Column>
                <span className="sr-only">{t('inventory.actions')}</span>
              </Column>
            )}
          </TableHeader>
          <TableBody items={visible} dependencies={[canWrite, org.currency]} renderEmptyState={() => <p className="text-sm text-muted text-center py-8">{t('inventory.noMatches')}</p>}>
            {(p) => {
              const detail = productDetail(p)
              return (
                <Row id={p.id} className={p.archivedAt ? 'text-muted' : undefined}>
                  <Cell>
                    <div className="font-medium min-w-40">{p.name}</div>
                    {detail && <div className="text-xs text-muted mt-0.5">{detail}</div>}
                    {p.category === 'crop_protection' && <PsmBadge product={p} className="mt-1" />}
                  </Cell>
                  <Cell className="whitespace-nowrap">{productCategoryLabel(p.category)}</Cell>
                  <Cell className="whitespace-nowrap">{p.manufacturer ?? <span className="text-muted">—</span>}</Cell>
                  <Cell align="end">
                    <div className={cx('font-medium', p.stock < 0 && 'text-danger')}>{fmt.qty(p.stock, p.baseUnit)}</div>
                    {p.lowStockThreshold != null && <div className="text-xs text-muted">{t('inventory.minStock', { qty: fmt.qty(p.lowStockThreshold, p.baseUnit) })}</div>}
                  </Cell>
                  <Cell align="end">
                    {p.currentPrice ? (
                      <>
                        <div>{`${fmt.money(p.currentPrice.price, org.currency, 2)} / ${unitLabel(p.baseUnit)}`}</div>
                        <div className="text-xs text-muted">{t(`inventory.priceSource.${p.currentPrice.source}`, { year: p.currentPrice.year })}</div>
                      </>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </Cell>
                  <Cell align="end">{p.stockValue != null ? fmt.money(p.stockValue, org.currency) : <span className="text-muted">—</span>}</Cell>
                  <Cell>
                    <ProductStatus product={p} />
                  </Cell>
                  {canWrite && (
                    <Cell className="w-0">
                      <MenuTrigger>
                        <Button variant="ghost" size="icon-sm" aria-label={t('inventory.actionsFor', { name: p.name })}>
                          <Ellipsis />
                        </Button>
                        <Menu
                          onAction={(key) => {
                            if (key === 'archive') archive.mutate(p)
                            else onAction({ kind: key as 'product' | MovementDialog, product: p })
                          }}
                        >
                          <MenuItem id="product" textValue={t('common.edit')}>
                            <Pencil /> {t('common.edit')}
                          </MenuItem>
                          {!p.archivedAt && (
                            <MenuItem id="receive" textValue={t('inventory.receiveStock')}>
                              <PackagePlus /> {t('inventory.receiveStock')}
                            </MenuItem>
                          )}
                          {!p.archivedAt && (
                            <MenuItem id="issue" textValue={t('inventory.issueStock')}>
                              <PackageMinus /> {t('inventory.issueStock')}
                            </MenuItem>
                          )}
                          {!p.archivedAt && (
                            <MenuItem id="stocktake" textValue={t('inventory.stocktake.title')}>
                              <ClipboardCheck /> {t('inventory.stocktake.title')}
                            </MenuItem>
                          )}
                          {!p.archivedAt && (
                            <MenuItem id="adjust" textValue={t('inventory.adjustStock')}>
                              <Scale /> {t('inventory.adjustStock')}
                            </MenuItem>
                          )}
                          <MenuSeparator />
                          <MenuItem id="archive" textValue={p.archivedAt ? t('inventory.restore') : t('common.archive')}>{p.archivedAt ? <><ArchiveRestore /> {t('inventory.restore')}</> : <><Archive /> {t('common.archive')}</>}</MenuItem>
                        </Menu>
                      </MenuTrigger>
                    </Cell>
                  )}
                </Row>
              )
            }}
          </TableBody>
        </Table>
      </Card>
    </div>
  )
}

function ProductStatus({ product: p }: { product: Product }) {
  const { t } = useTranslation()
  if (p.archivedAt) return <Badge>{t('inventory.status.archived')}</Badge>
  if (p.stock <= 0) return <Badge tone="danger">{p.stock < 0 ? t('inventory.status.negative') : t('inventory.status.outOfStock')}</Badge>
  if (p.nextExpiry && p.nextExpiry < today()) return <Badge tone="danger">{t('inventory.status.expired')}</Badge>
  if (p.lowStock) return <Badge tone="warning">{t('inventory.lowStock')}</Badge>
  if (p.nextExpiry && p.nextExpiry <= addDays(today(), EXPIRY_WARNING_DAYS)) return <Badge tone="warning">{t('inventory.status.expiresOn', { date: fmt.date(p.nextExpiry) })}</Badge>
  return <Badge tone="success">{t('inventory.status.inStock')}</Badge>
}

/** Approval state of a plant-protection product in the BVL register, as a badge. */
function psmStatus(psm: { approvalEndsOn: string | null; useUpUntil: string | null; usable: boolean }): { tone: BadgeTone; label: string } {
  if (!psm.usable) return { tone: 'danger', label: t('inventory.psm.expired') }
  if (psm.approvalEndsOn && psm.approvalEndsOn < today() && psm.useUpUntil) return { tone: 'warning', label: t('inventory.psm.useUpUntil', { date: fmt.date(psm.useUpUntil) }) }
  return { tone: 'success', label: psm.approvalEndsOn ? t('inventory.psm.approvedUntil', { date: fmt.date(psm.approvalEndsOn) }) : t('inventory.psm.approved') }
}

function PsmBadge({ product: p, className }: { product: Product; className?: string }) {
  const { t } = useTranslation()
  if (!p.psm) return p.registrationNumber ? <Badge tone="warning" className={className}>{t('inventory.psm.notInRegister')}</Badge> : null
  const { tone, label } = psmStatus(p.psm)
  return <Badge tone={tone} className={className}>{label}</Badge>
}

const sectionHeaderClass = 'px-2.5 pt-2 pb-1 text-xs font-medium text-muted'

/** Fertilizer types as Select options, mineral first, then organic; `first` is a leading "none"/"all" option. */
function fertilizerTypeOptions(first: { id: string; name: string }) {
  return (
    <>
      <Option id={first.id}>{first.name}</Option>
      <ListBoxSection>
        <Header className={sectionHeaderClass}>{t('inventory.fertilizerType.mineral')}</Header>
        {MINERAL_FERTILIZER_TYPES.map((ty) => <Option key={ty} id={ty}>{fertilizerTypeLabel(ty)}</Option>)}
      </ListBoxSection>
      <ListBoxSection>
        <Header className={sectionHeaderClass}>{t('inventory.fertilizerType.organic')}</Header>
        {ORGANIC_FERTILIZER_TYPES.map((ty) => <Option key={ty} id={ty}>{fertilizerTypeLabel(ty)}</Option>)}
      </ListBoxSection>
    </>
  )
}

const CONTENT_KEYS = ['nPct', 'nh4NPct', 'p2o5Pct', 'k2oPct', 'mgoPct', 'sPct', 'caoPct'] as const
type ContentKey = (typeof CONTENT_KEYS)[number]
const CONTENT_LABELS: Record<ContentKey, string> = { nPct: 'N', nh4NPct: 'NH₄-N', p2o5Pct: 'P₂O₅', k2oPct: 'K₂O', mgoPct: 'MgO', sPct: 'S', caoPct: 'CaO' }
/** Organic fertilizer analyses come in % of fresh mass, kg per tonne or kg per m³; stored as %. */
type ContentUnit = 'pct' | 'kg_t' | 'kg_m3'

const round4 = (v: number) => Math.round(v * 1e4) / 1e4
const pctToUnit = (pct: number, unit: ContentUnit, density: number) => (unit === 'pct' ? pct : unit === 'kg_t' ? pct * 10 : pct * 10 * density)

function ProductForm({ product, close }: { product?: Product; close: () => void }) {
  const { t } = useTranslation()
  const { org } = useOrg()
  const [category, setCategory] = useState<ProductCategory>(product?.category ?? 'fertilizer')
  const [name, setName] = useState(product?.name ?? '')
  const [manufacturer, setManufacturer] = useState(product?.manufacturer ?? '')
  const [baseUnit, setBaseUnit] = useState<BaseUnit>(product?.baseUnit ?? DEFAULT_UNIT.fertilizer)
  const [unitTouched, setUnitTouched] = useState(false)
  const [unitCost, setUnitCost] = useState(product?.unitCost ?? NaN)
  const [registrationNumber, setRegistrationNumber] = useState(product?.registrationNumber ?? '')
  const [activeIngredients, setActiveIngredients] = useState(product?.activeIngredients ?? '')
  const [fertilizerType, setFertilizerType] = useState<FertilizerType | null>(product?.fertilizerType ?? null)
  const [contents, setContents] = useState<Record<ContentKey, number>>(() => Object.fromEntries(CONTENT_KEYS.map((k) => [k, product?.[k] ?? NaN])) as Record<ContentKey, number>)
  const [contentUnit, setContentUnit] = useState<ContentUnit>('pct')
  const [dryMatterPct, setDryMatterPct] = useState(product?.dryMatterPct ?? NaN)
  const [densityTM3, setDensityTM3] = useState(product?.densityTM3 ?? NaN)
  const [lowStockThreshold, setLowStockThreshold] = useState(product?.lowStockThreshold ?? NaN)
  const [humusCKgPerT, setHumusCKgPerT] = useState(product?.humusCKgPerT ?? NaN)
  const [nEffectivenessPct, setNEffectivenessPct] = useState(product?.nEffectivenessPct ?? NaN)
  const [website, setWebsite] = useState(product?.website ?? '')
  const [datasheetFileId, setDatasheetFileId] = useState<string | null>(product?.datasheetFileId ?? null)
  const [notes, setNotes] = useState(product?.notes ?? '')

  const save = useOrgMutation((base, input: ProductInput) => (product ? api.put<Product>(`${base}/products/${product.id}`, input) : api.post<Product>(`${base}/products`, input)), {
    success: product ? t('inventory.productUpdated') : t('inventory.productCreated'),
    onSuccess: close,
  })

  const isFertilizer = category === 'fertilizer'
  const isCropProtection = category === 'crop_protection'
  const organic = isOrganicFertilizer(fertilizerType)
  const byVolume = baseUnit === 'l' || baseUnit === 'm3'
  const density = num(densityTM3) ?? ASSUMED_ORGANIC_DENSITY
  const unit = unitLabel(baseUnit)
  const pct = { minValue: 0, maxValue: 100, unit: '%', formatOptions: { maximumFractionDigits: 2 } }
  const contentUnitLabel = { pct: '%', kg_t: 'kg/t', kg_m3: 'kg/m³' }[contentUnit]

  /** Converts the entered contents when switching between %, kg/t and kg/m³. */
  const changeContentUnit = (next: ContentUnit) => {
    setContents((c) =>
      Object.fromEntries(
        CONTENT_KEYS.map((k) => {
          const asPct = Number.isNaN(c[k]) ? null : contentToPct(c[k], contentUnit, density)
          return [k, asPct == null ? NaN : round4(pctToUnit(asPct, next, density))]
        }),
      ) as Record<ContentKey, number>,
    )
    setContentUnit(next)
  }

  const contentPct = (k: ContentKey) => {
    const v = num(contents[k])
    const asPct = v == null ? null : contentToPct(v, contentUnit, density)
    return isFertilizer && asPct != null ? round4(asPct) : null
  }

  return (
    <Form
      className="grid sm:grid-cols-2 gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        save.mutate({
          category,
          name: name.trim(),
          manufacturer: textOrNull(manufacturer),
          baseUnit,
          unitCost: num(unitCost),
          registrationNumber: isCropProtection ? textOrNull(registrationNumber) : null,
          activeIngredients: isCropProtection ? textOrNull(activeIngredients) : null,
          nPct: contentPct('nPct'),
          nh4NPct: contentPct('nh4NPct'),
          p2o5Pct: contentPct('p2o5Pct'),
          k2oPct: contentPct('k2oPct'),
          mgoPct: contentPct('mgoPct'),
          sPct: contentPct('sPct'),
          caoPct: contentPct('caoPct'),
          dryMatterPct: isFertilizer ? num(dryMatterPct) : null,
          densityTM3: isFertilizer ? num(densityTM3) : null,
          fertilizerType: isFertilizer ? fertilizerType : null,
          lowStockThreshold: num(lowStockThreshold),
          humusCKgPerT: isFertilizer && organic ? num(humusCKgPerT) : null,
          nEffectivenessPct: isFertilizer ? num(nEffectivenessPct) : null,
          website: textOrNull(website),
          datasheetFileId,
          notes: textOrNull(notes),
        })
      }}
    >
      <TextField label={t('common.name')} isRequired autoFocus value={name} onChange={setName} placeholder={t('inventory.form.namePlaceholder')} className="sm:col-span-2" />
      <Select
        label={t('inventory.category')}
        items={categoryItems()}
        value={category}
        onChange={(v) => {
          if (!v) return
          const next = v as ProductCategory
          setCategory(next)
          if (!product && !unitTouched) setBaseUnit(DEFAULT_UNIT[next])
        }}
      >
        {(c) => <Option id={c.id}>{c.name}</Option>}
      </Select>
      <Select
        label={t('inventory.form.baseUnit')}
        items={unitItems()}
        value={baseUnit}
        isDisabled={!!product}
        description={product ? t('inventory.form.baseUnitFixed') : t('inventory.form.baseUnitHint')}
        onChange={(v) => {
          if (!v) return
          setBaseUnit(v as BaseUnit)
          setUnitTouched(true)
        }}
      >
        {(u) => <Option id={u.id}>{u.name}</Option>}
      </Select>
      <TextField label={t('inventory.manufacturer')} value={manufacturer} onChange={setManufacturer} />
      <NumberField
        label={t('inventory.unitCost')}
        unit={`${org.currency} / ${unit}`}
        value={unitCost}
        onChange={setUnitCost}
        minValue={0}
        formatOptions={{ maximumFractionDigits: 4 }}
        description={t('inventory.form.unitCostHint')}
      />

      {isFertilizer && (
        <fieldset className="sm:col-span-2 rounded-lg border border-line p-3 pt-2 space-y-3">
          <legend className="px-1 text-xs font-medium text-muted">{organic ? t('inventory.form.contents') : t('inventory.form.nutrients')}</legend>
          <div className="flex flex-wrap items-end gap-3">
            {/* Static sections: the items are given as children. */}
            <Select
              label={t('inventory.form.fertilizerType')}
              className="flex-1 min-w-56"
              items={[] as { id: string }[]}
              value={fertilizerType ?? NONE}
              onChange={(v) => {
                const next = keyOrNull(v == null ? null : String(v)) as FertilizerType | null
                if (!isOrganicFertilizer(next) && contentUnit !== 'pct') changeContentUnit('pct')
                setFertilizerType(next)
              }}
              description={t('inventory.form.fertilizerTypeHint')}
            >
              {fertilizerTypeOptions({ id: NONE, name: t('inventory.form.fertilizerTypeNone') })}
            </Select>
            {organic && (
              <div className="space-y-1.5 pb-6">
                <span className="block text-sm font-medium text-fg-2">{t('inventory.form.contentUnit')}</span>
                <SegmentedControl
                  aria-label={t('inventory.form.contentUnit')}
                  items={[
                    { id: 'pct', label: t('inventory.form.contentUnit.pct') },
                    { id: 'kg_t', label: 'kg/t' },
                    { id: 'kg_m3', label: 'kg/m³' },
                  ]}
                  value={contentUnit}
                  onChange={changeContentUnit}
                />
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {CONTENT_KEYS.map((k) => (
              <NumberField
                key={k}
                label={CONTENT_LABELS[k]}
                value={contents[k]}
                onChange={(v) => setContents((c) => ({ ...c, [k]: v }))}
                unit={contentUnitLabel}
                // Lime value: negative for acidifying fertilizers.
                minValue={k === 'caoPct' ? (contentUnit === 'pct' ? -100 : undefined) : 0}
                maxValue={contentUnit === 'pct' ? 100 : undefined}
                formatOptions={{ maximumFractionDigits: 2 }}
                description={k === 'caoPct' ? t('inventory.form.caoHint') : undefined}
              />
            ))}
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <NumberField label={t('inventory.form.dryMatter')} value={dryMatterPct} onChange={setDryMatterPct} {...pct} />
            <NumberField
              label={t('inventory.form.nEffectiveness')}
              value={nEffectivenessPct}
              onChange={setNEffectivenessPct}
              description={t('inventory.form.nEffectivenessHint')}
              {...pct}
            />
            {organic && (
              <NumberField
                label={t('inventory.form.humusC')}
                unit={byVolume ? 'kg/m³' : 'kg/t'}
                value={humusCKgPerT}
                onChange={setHumusCKgPerT}
                minValue={-1000}
                maxValue={1000}
                formatOptions={{ maximumFractionDigits: 1 }}
                description={t('inventory.form.humusCHint')}
              />
            )}
            <NumberField
              label={t('inventory.form.density')}
              unit="t/m³"
              value={densityTM3}
              onChange={setDensityTM3}
              minValue={0}
              maxValue={5}
              step={0.01}
              formatOptions={{ maximumFractionDigits: 3 }}
              description={organic ? t('inventory.form.densityAssumed') : byVolume ? t('inventory.form.densityRequired') : t('inventory.form.densityHint')}
            />
          </div>
          <p className="text-xs text-muted">{contentUnit === 'pct' ? t('inventory.form.nutrientsHint') : t('inventory.form.contentUnitHint')}</p>
        </fieldset>
      )}

      {isCropProtection && (
        <>
          <TextField
            label={t('inventory.form.registrationNumber')}
            value={registrationNumber}
            onChange={setRegistrationNumber}
            placeholder={t('inventory.form.registrationNumberPlaceholder')}
            description={product && product.registrationNumber === registrationNumber.trim() ? <PsmBadge product={product} /> : undefined}
          />
          <TextField label={t('inventory.form.activeIngredients')} value={activeIngredients} onChange={setActiveIngredients} />
        </>
      )}

      <NumberField
        label={t('inventory.form.lowStockThreshold')}
        unit={unit}
        value={lowStockThreshold}
        onChange={setLowStockThreshold}
        minValue={0}
        formatOptions={{ maximumFractionDigits: 3 }}
        description={t('inventory.form.lowStockThresholdHint')}
      />
      <TextField label={t('inventory.form.website')} type="url" value={website} onChange={setWebsite} placeholder="https://" />
      <DatasheetField fileId={datasheetFileId} onChange={setDatasheetFileId} />
      <TextField label={t('common.notes')} multiline rows={2} value={notes} onChange={setNotes} className="sm:col-span-2" />
      <div className="sm:col-span-2">
        <FormActions close={close} isPending={save.isPending} submitLabel={product ? t('common.saveChanges') : t('inventory.form.create')} />
      </div>
    </Form>
  )
}

/** A product datasheet: uploaded into the organization's files and linked to the product. */
function DatasheetField({ fileId, onChange }: { fileId: string | null; onChange: (id: string | null) => void }) {
  const { t } = useTranslation()
  const { org } = useOrg()
  const file = useOrgQuery<FileItem>(fileId ? `/files/${fileId}` : null)
  const upload = useOrgMutation(
    (base, f: File) => {
      const form = new FormData()
      form.append('names', JSON.stringify([f.name]))
      form.append('files', f, 'upload')
      return api.upload<FileItem[]>(`${base}/files/upload`, form)
    },
    { onSuccess: (files) => onChange(files[0]?.id ?? null) },
  )
  return (
    <div className="space-y-1.5">
      <span className="block text-sm font-medium text-fg-2">{t('inventory.form.datasheet')}</span>
      {fileId ? (
        <div className="flex items-center gap-2 text-sm">
          <FileText className="size-4 text-muted shrink-0" />
          <span className="truncate flex-1">{file.data?.name ?? '…'}</span>
          {file.data && (
            <Button size="icon-sm" variant="ghost" aria-label={t('common.download')} onPress={() => void api.download(`/orgs/${org.id}/files/${fileId}/content`, undefined, file.data!.name)}>
              <FileDown />
            </Button>
          )}
          <Button size="icon-sm" variant="ghost" aria-label={t('common.remove')} onPress={() => onChange(null)}>
            <X />
          </Button>
        </div>
      ) : (
        <label className={cx('inline-flex items-center gap-2 rounded-md border border-line px-3 py-1.5 text-sm cursor-pointer hover:bg-surface-2', upload.isPending && 'opacity-60 pointer-events-none')}>
          <Upload className="size-4" /> {upload.isPending ? t('inventory.form.datasheetUploading') : t('inventory.form.datasheetUpload')}
          <input
            type="file"
            className="sr-only"
            accept=".pdf,image/*"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) upload.mutate(f)
              e.target.value = ''
            }}
          />
        </label>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Catalogues
// ---------------------------------------------------------------------------

function useDebounced<T>(value: T, ms: number) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(id)
  }, [value, ms])
  return debounced
}

const nutrientCell = (v: number | null) => (v != null ? fmt.num(v, 1) : <span className="text-muted">—</span>)

function CatalogueDialog({ close }: { close: () => void }) {
  const { t } = useTranslation()
  const [search, setSearch] = useState('')
  const [type, setType] = useState<string>(ALL)
  const [picked, setPicked] = useState<FertilizerCatalogueEntry | null>(null)
  const q = useDebounced(search.trim(), 250)
  const entries = useOrgQuery<FertilizerCatalogueEntry[]>('/catalogue/fertilizers', { q: q || undefined, type: type === ALL ? undefined : type }, { staleTime: 5 * 60_000 })

  if (picked) return <CatalogueProductForm entry={picked} back={() => setPicked(null)} close={close} />

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <SearchField autoFocus placeholder={t('inventory.catalogue.searchPlaceholder')} value={search} onChange={setSearch} className="flex-1 min-w-48" />
        {/* Static sections: the items are given as children. */}
        <Select aria-label={t('inventory.form.fertilizerType')} className="w-64" items={[] as { id: string }[]} value={type} onChange={(v) => setType(String(v ?? ALL))}>
          {fertilizerTypeOptions({ id: ALL, name: t('inventory.catalogue.allTypes') })}
        </Select>
      </div>
      {entries.isLoading ? (
        <Loading />
      ) : entries.error ? (
        <ErrorNotice error={entries.error} />
      ) : (
        <div className="max-h-[55vh] overflow-auto rounded-lg border border-line">
          <Table aria-label={t('inventory.catalogue.title')}>
            <TableHeader>
              <Column isRowHeader>{t('inventory.product')}</Column>
              <Column>{t('inventory.form.fertilizerType')}</Column>
              <Column align="end">N</Column>
              <Column align="end">P₂O₅</Column>
              <Column align="end">K₂O</Column>
              <Column>{t('inventory.catalogue.unit')}</Column>
            </TableHeader>
            <TableBody items={entries.data ?? []} renderEmptyState={() => <p className="text-sm text-muted text-center py-8">{t('inventory.catalogue.empty')}</p>}>
              {(e) => (
                <Row id={e.id} onAction={() => setPicked(e)}>
                  <Cell className="font-medium">{e.name}</Cell>
                  <Cell className="text-fg-2">{fertilizerTypeLabel(e.fertilizerType)}</Cell>
                  <Cell align="end">{nutrientCell(e.nPct)}</Cell>
                  <Cell align="end">{nutrientCell(e.p2o5Pct)}</Cell>
                  <Cell align="end">{nutrientCell(e.k2oPct)}</Cell>
                  <Cell className="whitespace-nowrap">{unitLabel(e.suggestedUnit)}</Cell>
                </Row>
              )}
            </TableBody>
          </Table>
        </div>
      )}
      <p className="text-xs text-muted">{t('inventory.catalogue.hint')}</p>
    </div>
  )
}

function CatalogueProductForm({ entry, back, close }: { entry: FertilizerCatalogueEntry; back: () => void; close: () => void }) {
  const { t } = useTranslation()
  const { org } = useOrg()
  const [name, setName] = useState(entry.name)
  const [unitCost, setUnitCost] = useState(entry.indicativePrice ?? NaN)
  const save = useOrgMutation((base, input: FromCatalogueInput) => api.post<Product>(`${base}/products/from-catalogue`, input), {
    success: (p) => t('inventory.catalogue.created', { name: p.name }),
    onSuccess: close,
  })
  // The catalogue carries no sulphur content.
  const content = (k: ContentKey) => (k === 'sPct' ? null : entry[k])
  const contents = CONTENT_KEYS.filter((k) => content(k) != null).map((k) => `${CONTENT_LABELS[k]} ${fmt.num(content(k), 2)} %`)

  return (
    <Form
      className="grid sm:grid-cols-2 gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        save.mutate({ catalogueEntryId: entry.id, name: name.trim() || undefined, unitCost: num(unitCost) })
      }}
    >
      <div className="sm:col-span-2 rounded-lg bg-surface-2 px-3 py-2.5 text-sm space-y-0.5">
        <div className="font-medium">{entry.name}</div>
        <div className="text-muted">
          {[fertilizerTypeLabel(entry.fertilizerType), contents.join(' · '), entry.densityTM3 != null && `${fmt.num(entry.densityTM3, 2)} t/m³`].filter(Boolean).join(' · ')}
        </div>
      </div>
      <TextField label={t('common.name')} isRequired value={name} onChange={setName} className="sm:col-span-2" />
      <NumberField
        label={t('inventory.unitCost')}
        unit={`${org.currency} / ${unitLabel(entry.suggestedUnit)}`}
        value={unitCost}
        onChange={setUnitCost}
        minValue={0}
        formatOptions={{ maximumFractionDigits: 4 }}
        description={entry.indicativePrice != null ? t('inventory.catalogue.indicativePrice') : undefined}
      />
      <div className="text-sm self-center text-muted">{t('inventory.catalogue.baseUnit', { unit: unitLabel(entry.suggestedUnit) })}</div>
      <div className="sm:col-span-2 flex justify-between gap-2 pt-2">
        <Button variant="ghost" onPress={back}>{t('inventory.catalogue.back')}</Button>
        <div className="flex gap-2">
          <Button onPress={close}>{t('common.cancel')}</Button>
          <Button type="submit" variant="primary" isPending={save.isPending}>{t('inventory.form.create')}</Button>
        </div>
      </div>
    </Form>
  )
}

function PsmSearchDialog({ close }: { close: () => void }) {
  const { t } = useTranslation()
  const [search, setSearch] = useState('')
  const q = useDebounced(search.trim(), 300)
  const results = useOrgQuery<PsmProductSummary[]>(q.length >= 2 ? '/catalogue/psm' : null, { q }, { staleTime: 5 * 60_000 })
  const products = useOrgQuery<Product[]>('/products')
  const existing = new Set((products.data ?? []).map((p) => p.registrationNumber).filter(Boolean))
  const add = useOrgMutation((base, input: FromPsmInput) => api.post<Product>(`${base}/products/from-psm`, input), {
    success: (p) => t('inventory.psm.added', { name: p.name }),
  })

  return (
    <div className="space-y-3">
      <SearchField autoFocus placeholder={t('inventory.psm.searchPlaceholder')} value={search} onChange={setSearch} />
      {q.length < 2 ? (
        <p className="text-sm text-muted py-6 text-center">{t('inventory.psm.minChars')}</p>
      ) : results.isLoading ? (
        <Loading />
      ) : results.error ? (
        <ErrorNotice error={results.error} />
      ) : !results.data?.length ? (
        <p className="text-sm text-muted py-6 text-center">{t('inventory.psm.noResults')}</p>
      ) : (
        <ul className="max-h-[55vh] overflow-auto rounded-lg border border-line divide-y divide-line">
          {results.data.map((r) => {
            const status = psmStatus(r)
            const added = existing.has(r.kennr)
            return (
              <li key={r.kennr} className="px-3 py-2.5 flex items-start gap-3">
                <div className="flex-1 min-w-0 text-sm space-y-0.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{r.name}</span>
                    <Badge tone={status.tone}>{status.label}</Badge>
                  </div>
                  <div className="text-xs text-muted">
                    {[t('inventory.registrationShort', { number: r.kennr }), r.formulation].filter(Boolean).join(' · ')}
                  </div>
                  {r.activeIngredients.length > 0 && (
                    <div className="text-xs text-fg-2">{r.activeIngredients.map((a) => (a.content != null ? `${a.name} ${fmt.num(a.content, 2)} ${a.unit ?? ''}`.trim() : a.name)).join(', ')}</div>
                  )}
                  <div className="text-xs text-muted">
                    {[r.approvalEndsOn && t('inventory.psm.approvalEnds', { date: fmt.date(r.approvalEndsOn) }), r.useUpUntil && t('inventory.psm.useUpPeriod', { date: fmt.date(r.useUpUntil) })].filter(Boolean).join(' · ')}
                  </div>
                </div>
                {added ? (
                  <Badge>{t('inventory.psm.alreadyAdded')}</Badge>
                ) : (
                  <Button size="sm" isPending={add.isPending && add.variables?.kennr === r.kennr} onPress={() => add.mutate({ kennr: r.kennr })}>
                    <Plus /> {t('common.add')}
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
      )}
      <div className="flex justify-between items-center gap-2 pt-1">
        <p className="text-xs text-muted">{t('inventory.psm.registerHint')}</p>
        <Button onPress={close}>{t('common.close')}</Button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Receipts and adjustments
// ---------------------------------------------------------------------------

function MovementForm({ kind, product: initial, close }: { kind: 'receipt' | 'issue' | 'adjustment'; product?: Product; close: () => void }) {
  const { t } = useTranslation()
  const { org } = useOrg()
  const products = useOrgQuery<Product[]>('/products')
  const locations = useOrgQuery<StorageLocation[]>('/storage-locations')
  const [productId, setProductId] = useState<string | null>(initial?.id ?? null)
  const [locationId, setLocationId] = useState<string>(NONE)
  const [quantity, setQuantity] = useState(NaN)
  const [unitCost, setUnitCost] = useState(initial?.currentPrice?.price ?? NaN)
  const [totalPrice, setTotalPrice] = useState(NaN)
  const [vatRate, setVatRate] = useState(NaN)
  const [lotNumber, setLotNumber] = useState('')
  const [expiryDate, setExpiryDate] = useState<string | null>(null)
  const [counterparty, setCounterparty] = useState('')
  const [invoiceNumber, setInvoiceNumber] = useState('')
  const [date, setDate] = useState<string | null>(today())
  const [note, setNote] = useState('')

  const isReceipt = kind === 'receipt'
  const isIssue = kind === 'issue'
  const priced = isReceipt || isIssue
  const options = products.data ?? (initial ? [initial] : [])
  const product = options.find((p) => p.id === productId) ?? null
  const unit = product ? unitLabel(product.baseUnit) : undefined
  const qty = num(quantity)
  // Issues are entered as a positive quantity and booked as an outflow.
  const delta = qty == null ? null : isIssue ? -Math.abs(qty) : qty
  const total = num(totalPrice) ?? (qty != null && num(unitCost) != null ? Math.abs(qty) * unitCost : null)

  const save = useOrgMutation((base, input: StockMovementInput) => api.post<Product>(`${base}/stock/movements`, input), {
    success: (p) =>
      isReceipt
        ? t('inventory.movement.received', { qty: fmt.qty(qty ?? 0, p.baseUnit), name: p.name })
        : isIssue
          ? t('inventory.movement.issued', { qty: fmt.qty(qty ?? 0, p.baseUnit), name: p.name })
          : t('inventory.movement.adjusted', { name: p.name }),
    onSuccess: close,
  })

  return (
    <Form
      className="grid sm:grid-cols-2 gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        if (!productId || delta == null || delta === 0 || !date) return
        save.mutate({
          productId,
          storageLocationId: keyOrNull(locationId),
          kind,
          quantityDelta: delta,
          unitCost: priced && num(totalPrice) == null ? num(unitCost) : null,
          totalPrice: priced ? num(totalPrice) : null,
          vatRate: priced ? num(vatRate) : null,
          lotNumber: isReceipt ? textOrNull(lotNumber) : null,
          expiryDate: isReceipt ? expiryDate : null,
          counterparty: priced ? textOrNull(counterparty) : null,
          invoiceNumber: priced ? textOrNull(invoiceNumber) : null,
          // Today keeps the actual time so the ledger order matches entry order.
          occurredAt: date === today() ? new Date().toISOString() : localToIso(date, '12:00'),
          note: textOrNull(note),
        })
      }}
    >
      <Select
        label={t('inventory.product')}
        isRequired
        items={options}
        value={productId}
        placeholder={products.isLoading ? t('common.loading') : t('inventory.movement.chooseProduct')}
        className="sm:col-span-2"
        onChange={(v) => {
          const id = v == null ? null : String(v)
          setProductId(id)
          const p = options.find((o) => o.id === id)
          if (p) setUnitCost(p.currentPrice?.price ?? NaN)
        }}
      >
        {(p) => (
          <Option id={p.id} textValue={p.name} description={t('inventory.movement.productOption', { category: productCategoryLabel(p.category), qty: fmt.qty(p.stock, p.baseUnit) })}>
            {p.name}
          </Option>
        )}
      </Select>
      <NumberField
        label={isReceipt ? t('inventory.movement.quantityReceived') : isIssue ? t('inventory.movement.quantityIssued') : t('inventory.movement.quantityChange')}
        isRequired
        autoFocus={!!initial}
        unit={unit}
        value={quantity}
        onChange={setQuantity}
        minValue={priced ? 0 : undefined}
        formatOptions={{ maximumFractionDigits: 3, signDisplay: priced ? 'auto' : 'exceptZero' }}
        validate={(v) => (Number.isNaN(v) ? null : v === 0 ? t('inventory.movement.notZero') : priced && v < 0 ? t('inventory.movement.aboveZero') : null)}
        description={!priced ? t('inventory.movement.quantityChangeHint') : undefined}
      />
      <DatePicker label={t('common.date')} isRequired value={date} onChange={setDate} maxValue={today()} />
      {priced && (
        <>
          <NumberField
            label={t('inventory.unitCost')}
            unit={unit ? `${org.currency} / ${unit}` : org.currency}
            value={num(totalPrice) != null && qty ? totalPrice / Math.abs(qty) : unitCost}
            isDisabled={num(totalPrice) != null}
            onChange={setUnitCost}
            minValue={0}
            formatOptions={{ maximumFractionDigits: 4 }}
            description={isReceipt ? t('inventory.movement.unitCostHint') : undefined}
          />
          <NumberField
            label={t('inventory.movement.totalPrice')}
            unit={org.currency}
            value={totalPrice}
            onChange={setTotalPrice}
            minValue={0}
            formatOptions={{ maximumFractionDigits: 2 }}
            description={num(totalPrice) == null && total != null ? t('inventory.movement.total', { amount: fmt.money(total, org.currency, 2) }) : t('inventory.movement.totalPriceHint')}
          />
          <NumberField label={t('inventory.movement.vatRate')} unit="%" value={vatRate} onChange={setVatRate} minValue={0} maxValue={100} formatOptions={{ maximumFractionDigits: 2 }} />
          <TextField label={isReceipt ? t('inventory.movement.supplier') : t('inventory.movement.buyer')} value={counterparty} onChange={setCounterparty} />
          <TextField label={t('inventory.movement.invoiceNumber')} value={invoiceNumber} onChange={setInvoiceNumber} />
        </>
      )}
      {isReceipt && (
        <>
          <TextField label={t('inventory.movement.lotNumber')} value={lotNumber} onChange={setLotNumber} />
          <DatePicker label={t('inventory.movement.expiryDate')} value={expiryDate} onChange={setExpiryDate} />
        </>
      )}
      <Select
        label={t('inventory.storageLocation')}
        items={[{ id: NONE, name: t('inventory.movement.noLocation') }, ...(locations.data ?? [])]}
        value={locationId}
        onChange={(v) => setLocationId(String(v ?? NONE))}
      >
        {(l) => <Option id={l.id}>{l.name}</Option>}
      </Select>
      <TextField
        label={t('inventory.note')}
        value={note}
        onChange={setNote}
        placeholder={isReceipt ? t('inventory.movement.notePlaceholderReceipt') : isIssue ? t('inventory.movement.notePlaceholderIssue') : t('inventory.movement.notePlaceholderAdjustment')}
        className="sm:col-span-2"
      />

      {product && (
        <div className="sm:col-span-2 rounded-lg bg-surface-2 px-3 py-2.5 text-sm flex flex-wrap justify-between gap-x-4 gap-y-1 tabular">
          <span className="text-muted">
            {t('inventory.movement.currentStock')} <span className="text-fg font-medium">{fmt.qty(product.stock, product.baseUnit)}</span>
          </span>
          {delta != null && delta !== 0 && (
            <span className="text-muted">
              {isReceipt ? t('inventory.movement.afterReceipt') : t('inventory.movement.afterAdjustment')}{' '}
              <span className={cx('font-medium', product.stock + delta < 0 ? 'text-danger' : 'text-fg')}>{fmt.qty(product.stock + delta, product.baseUnit)}</span>
            </span>
          )}
        </div>
      )}

      <div className="sm:col-span-2">
        <FormActions
          close={close}
          isPending={save.isPending}
          submitLabel={isReceipt ? t('inventory.movement.recordReceipt') : isIssue ? t('inventory.movement.recordIssue') : t('inventory.movement.recordAdjustment')}
          isDisabled={!productId}
        />
      </div>
    </Form>
  )
}

/** Stocktake: enter the counted quantity; the difference to the recorded stock is booked. */
function StocktakeForm({ product: initial, close }: { product?: Product; close: () => void }) {
  const { t } = useTranslation()
  const products = useOrgQuery<Product[]>('/products')
  const locations = useOrgQuery<StorageLocation[]>('/storage-locations')
  const [productId, setProductId] = useState<string | null>(initial?.id ?? null)
  const [locationId, setLocationId] = useState<string>(NONE)
  const [counted, setCounted] = useState(NaN)
  const [date, setDate] = useState<string | null>(today())
  const [note, setNote] = useState('')
  const balances = useOrgQuery<StockBalance[]>(productId ? '/stock/balances' : null, { productId: productId ?? undefined })

  const options = products.data ?? (initial ? [initial] : [])
  const product = options.find((p) => p.id === productId) ?? null
  const recorded = (balances.data ?? []).filter((b) => (b.storageLocationId ?? NONE) === locationId).reduce((s, b) => s + b.quantity, 0)
  const diff = num(counted) == null ? null : Math.round((counted - recorded) * 1e6) / 1e6

  const save = useOrgMutation((base, input: StocktakeInput) => api.post<Product>(`${base}/stock/stocktake`, input), {
    success: (p) => t('inventory.stocktake.saved', { name: p.name }),
    onSuccess: close,
  })

  return (
    <Form
      className="grid sm:grid-cols-2 gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        if (!productId || num(counted) == null || !date) return
        save.mutate({
          productId,
          storageLocationId: keyOrNull(locationId),
          counted,
          occurredAt: date === today() ? new Date().toISOString() : localToIso(date, '12:00'),
          note: textOrNull(note) ?? t('inventory.stocktake.defaultNote'),
        })
      }}
    >
      <Select label={t('inventory.product')} isRequired items={options} value={productId} className="sm:col-span-2" onChange={(v) => setProductId(v == null ? null : String(v))}>
        {(p) => (
          <Option id={p.id} textValue={p.name}>
            {p.name}
          </Option>
        )}
      </Select>
      <Select
        label={t('inventory.storageLocation')}
        items={[{ id: NONE, name: t('inventory.movement.noLocation') }, ...(locations.data ?? [])]}
        value={locationId}
        onChange={(v) => setLocationId(String(v ?? NONE))}
      >
        {(l) => <Option id={l.id}>{l.name}</Option>}
      </Select>
      <DatePicker label={t('common.date')} isRequired value={date} onChange={setDate} maxValue={today()} />
      <NumberField
        label={t('inventory.stocktake.counted')}
        isRequired
        autoFocus={!!initial}
        unit={product ? unitLabel(product.baseUnit) : undefined}
        value={counted}
        onChange={setCounted}
        minValue={0}
        formatOptions={{ maximumFractionDigits: 3 }}
      />
      <TextField label={t('inventory.note')} value={note} onChange={setNote} placeholder={t('inventory.stocktake.defaultNote')} />
      {product && (
        <div className="sm:col-span-2 rounded-lg bg-surface-2 px-3 py-2.5 text-sm flex flex-wrap justify-between gap-x-4 gap-y-1 tabular">
          <span className="text-muted">
            {t('inventory.stocktake.recorded')} <span className="text-fg font-medium">{fmt.qty(recorded, product.baseUnit)}</span>
          </span>
          {diff != null && (
            <span className="text-muted">
              {t('inventory.stocktake.difference')}{' '}
              <span className={cx('font-medium', diff < 0 ? 'text-danger' : diff > 0 ? 'text-success' : 'text-fg')}>
                {diff === 0 ? t('inventory.stocktake.noDifference') : `${diff > 0 ? '+' : ''}${fmt.qty(diff, product.baseUnit)}`}
              </span>
            </span>
          )}
        </div>
      )}
      <div className="sm:col-span-2">
        <FormActions close={close} isPending={save.isPending} submitLabel={t('inventory.stocktake.save')} isDisabled={!productId} />
      </div>
    </Form>
  )
}

// ---------------------------------------------------------------------------
// Ledger
// ---------------------------------------------------------------------------

function MovementsTab() {
  const { t } = useTranslation()
  const { orgId, org, can } = useOrg()
  const canWrite = can('inventory.write')
  const [productId, setProductId] = useState<string>(ALL)
  const [kind, setKind] = useState<string>(ALL)
  const [from, setFrom] = useState<string | null>(null)
  const [to, setTo] = useState<string | null>(null)
  const [voiding, setVoiding] = useState<StockMovement | null>(null)
  const products = useOrgQuery<Product[]>('/products', { includeArchived: true })
  const range = { productId: productId === ALL ? undefined : productId, from: from ?? undefined, to: to ?? undefined }
  const movements = useOrgQuery<StockMovement[]>('/stock/movements', range)

  const visible = useMemo(() => (movements.data ?? []).filter((m) => kind === ALL || m.kind === kind), [movements.data, kind])

  return (
    <Card padded={false}>
      <div className="p-3 flex flex-wrap items-center gap-3 border-b border-line">
        <Select
          aria-label={t('inventory.product')}
          className="w-64 max-w-full"
          items={[{ id: ALL, name: t('inventory.movements.allProducts') }, ...(products.data ?? [])]}
          value={productId}
          onChange={(v) => setProductId(String(v ?? ALL))}
        >
          {(p) => <Option id={p.id}>{p.name}</Option>}
        </Select>
        <Select
          aria-label={t('inventory.movements.kind')}
          className="w-44"
          items={[{ id: ALL, name: t('inventory.movements.allKinds') }, ...(Object.keys(KIND_TONES) as StockMovementKind[]).map((id) => ({ id, name: movementKindLabel(id) }))]}
          value={kind}
          onChange={(v) => setKind(String(v ?? ALL))}
        >
          {(k) => <Option id={k.id}>{k.name}</Option>}
        </Select>
        <DatePicker aria-label={t('inventory.movements.from')} value={from} onChange={setFrom} maxValue={to ?? undefined} />
        <DatePicker aria-label={t('inventory.movements.to')} value={to} onChange={setTo} minValue={from ?? undefined} />
        <span className="text-sm text-muted ml-auto">{movements.data ? t('inventory.movements.count', { count: visible.length }) : null}</span>
        <Button size="sm" onPress={() => void api.download(`/orgs/${orgId}/stock/movements.csv`, range, 'stock-movements.csv')}>
          <FileDown /> {t('inventory.exportCsv')}
        </Button>
      </div>
      {movements.isLoading ? (
        <div className="p-4">
          <Loading />
        </div>
      ) : movements.error ? (
        <div className="p-4">
          <ErrorNotice error={movements.error} />
        </div>
      ) : (
        <Table aria-label={t('inventory.tabs.movements')}>
          <TableHeader>
            <Column isRowHeader>{t('common.date')}</Column>
            <Column>{t('inventory.product')}</Column>
            <Column>{t('inventory.movements.kind')}</Column>
            <Column align="end">{t('inventory.movements.quantity')}</Column>
            <Column align="end">{t('inventory.unitCost')}</Column>
            <Column>{t('inventory.storageLocation')}</Column>
            <Column>{t('inventory.movements.details')}</Column>
            <Column>{t('inventory.movements.operation')}</Column>
            <Column>{t('inventory.note')}</Column>
            <Column>{t('inventory.movements.by')}</Column>
            {canWrite && (
              <Column>
                <span className="sr-only">{t('inventory.actions')}</span>
              </Column>
            )}
          </TableHeader>
          <TableBody
            items={visible}
            dependencies={[orgId, org.currency, canWrite]}
            renderEmptyState={() => (
              <EmptyState icon={History} title={t('inventory.movements.empty.title')}>
                {t('inventory.movements.empty.text')}
              </EmptyState>
            )}
          >
            {(m) => {
              const label = movementKindLabel(m.kind)
              const tone = KIND_TONES[m.kind]
              const details = [
                m.counterparty,
                m.invoiceNumber && t('inventory.movements.invoice', { number: m.invoiceNumber }),
                m.lotNumber && t('inventory.movements.lot', { lot: m.lotNumber }),
                m.expiryDate && t('inventory.movements.expires', { date: fmt.date(m.expiryDate) }),
                m.totalPrice != null && `${fmt.money(m.totalPrice, org.currency, 2)}${m.vatRate != null ? ` + ${fmt.num(m.vatRate, 0)} % ${t('inventory.movements.vat')}` : ''}`,
              ].filter(Boolean)
              const voidable = canWrite && !m.voidedBy && ['receipt', 'issue', 'adjustment'].includes(m.kind)
              return (
                <Row id={m.id} className={m.voidedBy ? 'text-muted line-through decoration-muted' : undefined}>
                  <Cell className="whitespace-nowrap tabular">{fmt.date(m.occurredAt)}</Cell>
                  <Cell className="font-medium">{m.productName}</Cell>
                  <Cell>
                    <Badge tone={tone}>{label}</Badge>
                  </Cell>
                  <Cell align="end" className={cx('font-medium', m.quantityDelta > 0 ? 'text-success' : 'text-fg')}>
                    {m.quantityDelta > 0 ? '+' : ''}
                    {fmt.qty(m.quantityDelta, m.baseUnit)}
                  </Cell>
                  <Cell align="end">{m.unitCost != null ? fmt.money(m.unitCost, org.currency, 2) : <span className="text-muted">—</span>}</Cell>
                  <Cell className="whitespace-nowrap">{m.storageLocationName ?? <span className="text-muted">—</span>}</Cell>
                  <Cell className="text-xs text-fg-2 max-w-64">{details.length ? details.join(' · ') : <span className="text-muted">—</span>}</Cell>
                  <Cell>
                    {m.operationId ? (
                      <Link to="/o/$orgId/operations/$operationId" params={{ orgId, operationId: m.operationId }} className="whitespace-nowrap">
                        {m.operationTitle ?? t('inventory.movements.operation')}
                      </Link>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </Cell>
                  <Cell className="text-fg-2 max-w-64">{m.note ?? <span className="text-muted">—</span>}</Cell>
                  <Cell className="whitespace-nowrap text-fg-2">{m.createdByName ?? <span className="text-muted">—</span>}</Cell>
                  {canWrite && (
                    <Cell className="w-0">
                      {voidable && (
                        <Button variant="ghost" size="icon-sm" aria-label={t('inventory.void.action')} onPress={() => setVoiding(m)}>
                          <Undo2 />
                        </Button>
                      )}
                    </Cell>
                  )}
                </Row>
              )
            }}
          </TableBody>
        </Table>
      )}
      <ModalDialog isOpen={!!voiding} onOpenChange={(open) => !open && setVoiding(null)} title={t('inventory.void.title')} description={t('inventory.void.description')} size="sm">
        {(close) => voiding && <VoidForm movement={voiding} close={close} />}
      </ModalDialog>
    </Card>
  )
}

function VoidForm({ movement: m, close }: { movement: StockMovement; close: () => void }) {
  const { t } = useTranslation()
  const [reason, setReason] = useState('')
  const save = useOrgMutation((base, r: string) => api.post<Product>(`${base}/stock/movements/${m.id}/void`, { reason: r }), {
    success: t('inventory.void.done'),
    onSuccess: close,
  })
  return (
    <Form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault()
        if (reason.trim().length >= 3) save.mutate(reason.trim())
      }}
    >
      <p className="text-sm">
        {t('inventory.void.summary', { date: fmt.date(m.occurredAt), product: m.productName, qty: fmt.qty(m.quantityDelta, m.baseUnit) })}
      </p>
      <TextField label={t('inventory.void.reason')} isRequired autoFocus minLength={3} value={reason} onChange={setReason} />
      <FormActions close={close} isPending={save.isPending} submitLabel={t('inventory.void.submit')} />
    </Form>
  )
}

// ---------------------------------------------------------------------------
// Storage locations
// ---------------------------------------------------------------------------

function LocationsTab({ canWrite, onAdd }: { canWrite: boolean; onAdd: () => void }) {
  const { t } = useTranslation()
  const locations = useOrgQuery<StorageLocation[]>('/storage-locations')
  const farms = useOrgQuery<Farm[]>('/farms')
  const farmName = (id: string | null) => (id ? (farms.data?.find((f) => f.id === id)?.name ?? '—') : t('inventory.locations.allFarms'))
  const addButton = canWrite && (
    <Button size="sm" variant="quiet" onPress={onAdd}>
      <Plus /> {t('inventory.locations.add')}
    </Button>
  )

  return (
    <div className="space-y-4">
      <Notice icon={Warehouse}>{t('inventory.locations.notice')}</Notice>
      <Card title={t('inventory.tabs.locations')} actions={(locations.data?.length ?? 0) > 0 && addButton} padded={false}>
        {locations.isLoading ? (
          <div className="p-4">
            <Loading />
          </div>
        ) : locations.error ? (
          <div className="p-4">
            <ErrorNotice error={locations.error} />
          </div>
        ) : !locations.data?.length ? (
          <EmptyState
            icon={Warehouse}
            title={t('inventory.locations.empty.title')}
            action={
              canWrite && (
                <Button variant="primary" onPress={onAdd}>
                  <Plus /> {t('inventory.locations.add')}
                </Button>
              )
            }
          >
            {t('inventory.locations.empty.text')}
          </EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {[...locations.data]
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((l) => (
                <li key={l.id} className="px-4 py-3 flex items-center gap-3">
                  <span className="size-8 rounded-lg bg-primary-soft text-primary flex items-center justify-center shrink-0" aria-hidden>
                    <Warehouse className="size-4" />
                  </span>
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-fg truncate">{l.name}</div>
                    <div className="text-xs text-muted truncate">{farmName(l.farmId)}</div>
                  </div>
                </li>
              ))}
          </ul>
        )}
      </Card>
    </div>
  )
}

function LocationForm({ close }: { close: () => void }) {
  const { t } = useTranslation()
  const farms = useOrgQuery<Farm[]>('/farms')
  const [name, setName] = useState('')
  const [farmId, setFarmId] = useState<string | undefined>(undefined)
  const farmItems = [{ id: NONE, name: t('inventory.locations.noFarm') }, ...(farms.data ?? []).filter((f) => !f.archivedAt)]
  const farmValue = farmId ?? (farms.data?.length === 1 ? farms.data[0].id : NONE)

  const save = useOrgMutation((base, input: StorageLocationInput) => api.post<StorageLocation>(`${base}/storage-locations`, input), {
    success: (l) => t('inventory.locations.added', { name: l.name }),
    onSuccess: close,
  })

  return (
    <Form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault()
        save.mutate({ name: name.trim(), farmId: keyOrNull(farmValue) })
      }}
    >
      <TextField label={t('common.name')} isRequired autoFocus value={name} onChange={setName} placeholder={t('inventory.locations.namePlaceholder')} />
      <Select label={t('inventory.locations.farm')} items={farmItems} value={farmValue} onChange={(v) => setFarmId(String(v ?? NONE))}>
        {(f) => <Option id={f.id}>{f.name}</Option>}
      </Select>
      <FormActions close={close} isPending={save.isPending} submitLabel={t('inventory.locations.add')} />
    </Form>
  )
}
