import { CALCULATION_PARAMETER_GROUPS, PRODUCT_CATEGORIES, type CalculationParameters, type ProductPriceInput, type ProductPriceRow } from '@agmeo/contracts'
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

function ParametersTab() {
  const { t } = useTranslation()
  const params = useOrgQuery<CalculationParameters>('/calculation-parameters', undefined, { staleTime: Infinity })
  if (params.isLoading) return <Loading />
  if (params.error) return <ErrorNotice error={params.error} />
  const all = params.data?.parameters ?? []
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">{t('prices.parameters.intro', { set: params.data?.factorSet })}</p>
      {CALCULATION_PARAMETER_GROUPS.map((g) => {
        const items = all.filter((p) => p.group === g).map((p) => ({ ...p, id: `${p.key}:${p.variant ?? ''}` }))
        if (!items.length) return null
        return (
          <Card key={g} padded={false}>
            <h2 className="px-4 pt-3 pb-2 text-sm font-semibold">{t(`prices.parameters.group.${g}`)}</h2>
            <Table aria-label={t(`prices.parameters.group.${g}`)}>
              <TableHeader>
                <Column isRowHeader>{t('prices.parameters.parameter')}</Column>
                <Column align="end">{t('prices.parameters.value')}</Column>
                <Column>{t('prices.parameters.unit')}</Column>
              </TableHeader>
              <TableBody items={items}>
                {(p) => (
                  <Row id={p.id}>
                    <Cell>
                      {t(`prices.parameters.key.${p.key}`)}
                      {p.variant && <span className="text-muted"> · {t(`prices.parameters.variant.${p.variant}`, { defaultValue: p.variant })}</span>}
                    </Cell>
                    <Cell align="end" className="tabular">
                      {fmt.num(p.value, 5)}
                    </Cell>
                    <Cell className="text-muted whitespace-nowrap">{p.unit}</Cell>
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
