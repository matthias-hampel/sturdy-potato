import { CALCULATION_PARAMETER_GROUPS, PRODUCT_CATEGORIES, type CalculationParameter, type CalculationParameters, type ProductPriceInput, type ProductPriceRow } from '@agmeo/contracts'
import { createFileRoute } from '@tanstack/react-router'
import { Coins } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { t } from '#/i18n'
import { baseUnitLabel, productCategoryLabel } from '#/i18n/labels'
import { api } from '#/lib/api'
import { fmt } from '#/lib/format'
import { useOrg } from '#/lib/org'
import { useOrgMutation, useOrgQuery } from '#/lib/queries'
import { Button } from '#/ui/Button'
import { NumberField, Option, SearchField, Select } from '#/ui/Field'
import { Badge, Card, EmptyState, ErrorNotice, Loading, PageHeader, Tab, TabList, TabPanel, Tabs } from '#/ui/Layout'
import { Cell, Column, Row, Table, TableBody, TableHeader } from '#/ui/Table'
import { cx } from '#/ui/utils'

export const Route = createFileRoute('/o/$orgId/prices')({ component: PricesPage })

const ALL = '__all'

function PricesPage() {
  const { t } = useTranslation()
  return (
    <>
      <PageHeader title={t('prices.title')} subtitle={t('prices.subtitle')} />
      <Tabs>
        <TabList aria-label={t('prices.title')}>
          <Tab id="prices">{t('prices.tabs.prices')}</Tab>
          <Tab id="parameters">{t('prices.tabs.parameters')}</Tab>
        </TabList>
        <TabPanel id="prices">
          <PricesTab />
        </TabPanel>
        <TabPanel id="parameters">
          <ParametersTab />
        </TabPanel>
      </Tabs>
    </>
  )
}

/** Prices per year: the farm's own price wins; else the year's warehouse average; else the latest earlier year; else the default. */
function PricesTab() {
  const { t } = useTranslation()
  const { org, can } = useOrg()
  const canWrite = can('inventory.write')
  const thisYear = new Date().getFullYear()
  const [year, setYear] = useState(thisYear)
  const [category, setCategory] = useState<string>(ALL)
  const [search, setSearch] = useState('')
  const prices = useOrgQuery<ProductPriceRow[]>('/prices', { year })
  // Edited manual prices by product: a number sets it, null clears it.
  const [edits, setEdits] = useState<Record<string, number | null>>({})
  useEffect(() => setEdits({}), [year])

  const save = useOrgMutation((base, input: ProductPriceInput) => api.put<ProductPriceRow[]>(`${base}/prices`, input), {
    success: t('prices.saved'),
    onSuccess: () => setEdits({}),
  })

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (prices.data ?? []).filter((r) => (category === ALL || r.category === category) && (!q || r.productName.toLowerCase().includes(q)))
  }, [prices.data, category, search])
  const changed = Object.keys(edits).length
  const years = Array.from({ length: 8 }, (_, i) => thisYear + 1 - i)

  return (
    <Card padded={false}>
      <div className="p-3 flex flex-wrap items-center gap-3 border-b border-line">
        <Select aria-label={t('prices.year')} className="w-28" items={years.map((y) => ({ id: y, name: String(y) }))} value={year} onChange={(v) => v != null && setYear(Number(v))}>
          {(y) => <Option id={y.id}>{y.name}</Option>}
        </Select>
        <SearchField placeholder={t('inventory.searchProducts')} value={search} onChange={setSearch} className="flex-1 min-w-48" />
        <Select
          aria-label={t('inventory.category')}
          className="w-48"
          items={[{ id: ALL, name: t('inventory.allCategories') }, ...PRODUCT_CATEGORIES.map((c) => ({ id: c, name: productCategoryLabel(c) }))]}
          value={category}
          onChange={(v) => setCategory(String(v ?? ALL))}
        >
          {(c) => <Option id={c.id}>{c.name}</Option>}
        </Select>
        {canWrite && (
          <Button
            variant="primary"
            isDisabled={!changed}
            isPending={save.isPending}
            onPress={() => save.mutate({ year, prices: Object.entries(edits).map(([productId, price]) => ({ productId, price })) })}
          >
            {changed ? t('prices.saveCount', { count: changed }) : t('common.saveChanges')}
          </Button>
        )}
      </div>
      {prices.isLoading ? (
        <div className="p-4">
          <Loading />
        </div>
      ) : prices.error ? (
        <div className="p-4">
          <ErrorNotice error={prices.error} />
        </div>
      ) : (
        <Table aria-label={t('prices.tabs.prices')}>
          <TableHeader>
            <Column isRowHeader>{t('inventory.product')}</Column>
            <Column>{t('inventory.category')}</Column>
            <Column align="end">{t('prices.effective')}</Column>
            <Column align="end">{t('prices.ownPrice', { year })}</Column>
          </TableHeader>
          <TableBody
            items={rows}
            dependencies={[edits, canWrite, org.currency, year]}
            renderEmptyState={() => (
              <EmptyState icon={Coins} title={t('prices.empty.title')}>
                {t('prices.empty.text')}
              </EmptyState>
            )}
          >
            {(r) => {
              const unit = `${org.currency} / ${baseUnitLabel(r.baseUnit)}`
              const manual = r.productId in edits ? edits[r.productId] : r.source === 'manual' ? r.price : null
              const effective = effectivePrice(r)
              return (
                <Row id={r.productId}>
                  <Cell className="font-medium">{r.productName}</Cell>
                  <Cell className="whitespace-nowrap">{productCategoryLabel(r.category)}</Cell>
                  <Cell align="end">
                    {effective ? (
                      <>
                        <div className="tabular">{`${fmt.money(effective.price, org.currency, 2)} / ${baseUnitLabel(r.baseUnit)}`}</div>
                        <Badge tone={effective.tone} className="mt-0.5">
                          {effective.label}
                        </Badge>
                      </>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </Cell>
                  <Cell align="end" className="w-56">
                    {canWrite ? (
                      <NumberField
                        aria-label={t('prices.ownPrice', { year })}
                        unit={unit}
                        value={manual ?? NaN}
                        minValue={0}
                        formatOptions={{ maximumFractionDigits: 4 }}
                        onChange={(v) => setEdits((e) => ({ ...e, [r.productId]: Number.isNaN(v) ? null : v }))}
                      />
                    ) : manual != null ? (
                      fmt.money(manual, org.currency, 2)
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </Cell>
                </Row>
              )
            }}
          </TableBody>
        </Table>
      )}
      <p className="p-3 text-xs text-muted border-t border-line">{t('prices.hint')}</p>
    </Card>
  )
}

function effectivePrice(r: ProductPriceRow): { price: number; label: string; tone: 'primary' | 'success' | 'neutral' | 'info' } | null {
  if (r.price != null && r.source === 'manual') return { price: r.price, label: t('prices.source.manual'), tone: 'primary' }
  if (r.price != null) return { price: r.price, label: t('prices.source.warehouse'), tone: 'success' }
  if (r.carriedOver) return { price: r.carriedOver.price, label: t('prices.source.carriedOver', { year: r.carriedOver.year }), tone: 'info' }
  if (r.defaultPrice != null) return { price: r.defaultPrice, label: t('prices.source.default'), tone: 'neutral' }
  return null
}

const CROP_FIELDS = ['dryMatterContent', 'dryMatterContentByproduct', 'MPBR', 'rootProportion', 'nContentRoot', 'nByproductFm', 'p2o5ByproductFm', 'k2oByproductFm', 'restsHumusBuildingPotential', 'humusMain', 'supplySeed', 'thousandGrainWeight', 'piecesToKg'] as const

/** The factors of the BEK calculator with their sources (agmeo method/parametersSources.ts). */
function ParametersTab() {
  const { t } = useTranslation()
  const params = useOrgQuery<CalculationParameters>('/calculation-parameters', undefined, { staleTime: Infinity })
  if (params.isLoading) return <Loading />
  if (params.error) return <ErrorNotice error={params.error} />
  const all = params.data?.parameters ?? []
  const label = (p: CalculationParameter) => {
    if (p.group === 'organic_fertilizer' && p.variant) {
      const [category, time] = p.variant.split('.')
      return `${t(`calcParam.organic.${category}`, { defaultValue: category })} · ${t(`calcParam.incorporation.${time}`, { defaultValue: time })}`
    }
    return t(`calcParam.${p.id}`, { defaultValue: p.description ?? p.name ?? p.id })
  }
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">{t('prices.parameters.intro', { set: params.data?.factorSet })}</p>
      {CALCULATION_PARAMETER_GROUPS.map((g) => {
        if (g === 'crop') return <CropParameters key={g} params={all.filter((p) => p.group === 'crop')} />
        const items = all.filter((p) => p.group === g)
        if (!items.length) return null
        return (
          <Card key={g} padded={false}>
            <h2 className="px-4 pt-3 pb-2 text-sm font-semibold">{t(`prices.parameters.group.${g}`)}</h2>
            <Table aria-label={t(`prices.parameters.group.${g}`)}>
              <TableHeader>
                <Column isRowHeader>{t('prices.parameters.parameter')}</Column>
                <Column align="end">{t('prices.parameters.value')}</Column>
                <Column>{t('prices.parameters.unit')}</Column>
                <Column>{t('prices.parameters.source')}</Column>
              </TableHeader>
              <TableBody items={items}>
                {(p) => (
                  <Row id={p.id}>
                    <Cell>
                      <div>{label(p)}</div>
                      <div className="text-xs text-muted">
                        {p.name && p.name !== label(p) ? `${p.name} · ` : ''}
                        <code>{p.id}</code>
                      </div>
                    </Cell>
                    <Cell align="end" className="tabular">
                      {fmt.num(p.value, 5)}
                    </Cell>
                    <Cell className="text-muted whitespace-nowrap">{p.unit}</Cell>
                    <Cell className="text-xs text-fg-2 max-w-80">
                      {p.source ? (
                        <span title={p.citation ?? undefined}>{p.source}</span>
                      ) : (
                        <span className="text-muted">{t('prices.parameters.methodValue')}</span>
                      )}
                    </Cell>
                  </Row>
                )}
              </TableBody>
            </Table>
          </Card>
        )
      })}
    </div>
  )
}

/** Crop parameters as a matrix: crops × parameters, with the source of each value on hover. */
function CropParameters({ params }: { params: CalculationParameter[] }) {
  const { t } = useTranslation()
  const crops = [...new Set(params.map((p) => p.variant!))].sort((a, b) => t(`calcParam.crop.${a}`, { defaultValue: a }).localeCompare(t(`calcParam.crop.${b}`, { defaultValue: b })))
  const byKey = new Map(params.map((p) => [`${p.variant}.${p.key}`, p]))
  const fields = CROP_FIELDS.filter((f) => params.some((p) => p.key === f))
  return (
    <Card padded={false}>
      <h2 className="px-4 pt-3 pb-1 text-sm font-semibold">{t('prices.parameters.group.crop')}</h2>
      <p className="px-4 pb-2 text-xs text-muted">{t('prices.parameters.cropHint')}</p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-separate border-spacing-0">
          <thead>
            <tr>
              <th className="sticky left-0 bg-surface px-3 py-2 text-left text-xs font-semibold text-muted border-b border-line">{t('prices.parameters.crop')}</th>
              {fields.map((f) => (
                <th key={f} className="px-3 py-2 text-right text-xs font-semibold text-muted border-b border-line whitespace-nowrap" title={byKey.get(`${crops[0]}.${f}`)?.unit}>
                  {t(`calcParam.cropField.${f}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {crops.map((c) => (
              <tr key={c}>
                <td className="sticky left-0 bg-surface px-3 py-1.5 border-b border-line/60 whitespace-nowrap">{t(`calcParam.crop.${c}`, { defaultValue: c })}</td>
                {fields.map((f) => {
                  const p = byKey.get(`${c}.${f}`)
                  return (
                    <td key={f} className={cx('px-3 py-1.5 border-b border-line/60 text-right tabular', !p?.source && 'text-fg-2')} title={p ? [p.unit, p.source ?? t('prices.parameters.methodValue')].filter(Boolean).join(' · ') : undefined}>
                      {p ? fmt.num(p.value, 4) : '—'}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}
