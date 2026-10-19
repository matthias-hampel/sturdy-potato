import type { Crop, CropBenchmark, CropBenchmarkInput, CropMarketPrices, FarmProfitability } from '@agmeo/contracts'
import { BarChart3, Pencil, Plus, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Form } from 'react-aria-components'
import { useTranslation } from 'react-i18next'
import { ColumnChart } from '#/components/charts'
import { FormActions, textOrNull } from '#/components/resources/form'
import { api } from '#/lib/api'
import { fmt } from '#/lib/format'
import { useOrg } from '#/lib/org'
import { useOrgMutation, useOrgQuery } from '#/lib/queries'
import { Button } from '#/ui/Button'
import { NumberField, Option, Select, TextField, num } from '#/ui/Field'
import { Badge, Card, EmptyState, ErrorNotice, Loading } from '#/ui/Layout'
import { ModalDialog } from '#/ui/Overlay'
import { Cell, Column, Row, Table, TableBody, TableHeader } from '#/ui/Table'
import { cx } from '#/ui/utils'
import { aggregate } from './Profitability'

/** Several harvest years side by side: per crop and for the farm (reference MultiYearView). */
export function MultiYearTab({ harvestYear }: { harvestYear: number }) {
  const { t } = useTranslation()
  const [span, setSpan] = useState(5)
  const years = useOrgQuery<FarmProfitability[]>('/economics/profitability/years', { fromYear: harvestYear - span + 1, toYear: harvestYear })
  const [metric, setMetric] = useState<'db2' | 'db1' | 'farmResult' | 'yieldTHa' | 'revenue'>('db2')

  if (years.isLoading) return <Loading />
  if (years.error) return <ErrorNotice error={years.error} />
  const list = (years.data ?? []).filter((y) => y.fields.length)
  if (list.length === 0) return <Card><EmptyState icon={BarChart3} title={t('multiYear.empty')} /></Card>
  const currency = list[list.length - 1].currency
  const crops = [...new Map(list.flatMap((y) => y.fields.map((f) => [f.cropId, { id: f.cropId, name: f.cropName, color: f.cropColor }] as const))).values()]
  const cell = (y: FarmProfitability, cropId: string | null) => {
    const fields = y.fields.filter((f) => !cropId || f.cropId === cropId)
    if (!fields.length) return null
    const a = aggregate(cropId ?? 'farm', '', null, fields)
    return { value: metric === 'yieldTHa' ? a.yieldTHa : a[metric], area: a.areaHa }
  }
  const show = (v: number | null | undefined) => (v == null ? '—' : metric === 'yieldTHa' ? `${fmt.num(v, 1)} t/ha` : `${fmt.money(v, currency)}/ha`)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <Select label={t('multiYear.metric')} className="w-60" items={(['db2', 'db1', 'farmResult', 'revenue', 'yieldTHa'] as const).map((id) => ({ id, name: t(`multiYear.metrics.${id}`) }))} value={metric} onChange={(v) => v && setMetric(v as typeof metric)}>
          {(x) => <Option id={x.id}>{x.name}</Option>}
        </Select>
        <Select label={t('multiYear.span')} className="w-40" items={[3, 5, 8, 10].map((n) => ({ id: n, name: t('multiYear.years', { count: n }) }))} value={span} onChange={(v) => v && setSpan(Number(v))}>
          {(x) => <Option id={x.id}>{x.name}</Option>}
        </Select>
      </div>
      <Card title={t('multiYear.farm')}>
        <ColumnChart
          data={list.map((y) => ({ key: String(y.harvestYear), label: String(y.harvestYear), values: [cell(y, null)?.value ?? null] }))}
          series={[{ name: t(`multiYear.metrics.${metric}`), color: 'var(--color-series-1)' }]}
          format={(v) => (metric === 'yieldTHa' ? fmt.num(v, 1) : fmt.money(v, currency))}
          ariaLabel={t('multiYear.farm')}
        />
      </Card>
      <Card padded={false} title={t('multiYear.byCrop')}>
        <Table aria-label={t('multiYear.byCrop')}>
          <TableHeader>
            <Column isRowHeader>{t('profitability.level.crop')}</Column>
            {list.map((y) => (
              <Column key={y.harvestYear} align="end">
                {y.harvestYear}
              </Column>
            ))}
          </TableHeader>
          <TableBody items={[{ id: '__farm', name: t('profitability.farm'), color: null as string | null }, ...crops]}>
            {(c) => (
              <Row id={c.id}>
                <Cell className={cx(c.id === '__farm' && 'font-semibold')}>
                  <span className="inline-flex items-center gap-2">
                    {c.color && <span className="size-2.5 rounded-full" style={{ background: c.color }} aria-hidden />}
                    {c.name}
                  </span>
                </Cell>
                {list.map((y) => {
                  const v = cell(y, c.id === '__farm' ? null : c.id)
                  return (
                    <Cell key={y.harvestYear} align="end" className={cx('tabular whitespace-nowrap', v?.value != null && v.value < 0 && 'text-danger')}>
                      {show(v?.value)}
                      {v && <div className="text-xs text-muted">{fmt.ha(v.area)}</div>}
                    </Cell>
                  )
                })}
              </Row>
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  )
}

const BENCH_FIELDS = [
  ['yieldTHa', 'benchmarks.yield', 't/ha'],
  ['revenuePerHa', 'benchmarks.revenue', '€/ha'],
  ['directCostsPerHa', 'benchmarks.directCosts', '€/ha'],
  ['variableCostsPerHa', 'benchmarks.variableCosts', '€/ha'],
  ['db1PerHa', 'benchmarks.db1', '€/ha'],
  ['db2PerHa', 'benchmarks.db2', '€/ha'],
] as const
type BenchKey = (typeof BENCH_FIELDS)[number][0]

/** Own results per crop against the farm's benchmarks (reference BenchmarkPage). */
export function BenchmarksTab({ seasonId }: { seasonId: string }) {
  const { t } = useTranslation()
  const { can } = useOrg()
  const benchmarks = useOrgQuery<CropBenchmark[]>('/economics/benchmarks')
  const profit = useOrgQuery<FarmProfitability | null>('/economics/profitability', { seasonId })
  const [editing, setEditing] = useState<CropBenchmark | 'new' | null>(null)
  const remove = useOrgMutation((base, id: string) => api.delete(`${base}/economics/benchmarks/${id}`), { success: t('benchmarks.deleted') })

  const own = useMemo(() => {
    const map = new Map<string, ReturnType<typeof aggregate>>()
    const byCrop = new Map<string, NonNullable<typeof profit.data>['fields']>()
    for (const f of profit.data?.fields ?? []) byCrop.set(f.cropId, [...(byCrop.get(f.cropId) ?? []), f])
    for (const [id, list] of byCrop) map.set(id, aggregate(id, list[0].cropName, list[0].cropColor, list))
    return map
  }, [profit.data])

  if (benchmarks.isLoading || profit.isLoading) return <Loading />
  if (benchmarks.error) return <ErrorNotice error={benchmarks.error} />
  const currency = profit.data?.currency ?? 'EUR'
  const ownValue = (cropId: string, k: BenchKey): number | null => {
    const a = own.get(cropId)
    if (!a) return null
    return { yieldTHa: a.yieldTHa, revenuePerHa: a.revenue, directCostsPerHa: a.directCosts, variableCostsPerHa: a.directCosts + a.machineryCosts, db1PerHa: a.db1, db2PerHa: a.db2 }[k]
  }
  const list = benchmarks.data ?? []
  const add = can('finance.write') && (
    <Button variant="primary" onPress={() => setEditing('new')}>
      <Plus /> {t('benchmarks.add')}
    </Button>
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="text-sm text-muted max-w-2xl">{t('benchmarks.description')}</p>
        {list.length > 0 && add}
      </div>
      {list.length === 0 ? (
        <Card>
          <EmptyState icon={BarChart3} title={t('benchmarks.empty.title')} action={add}>
            {t('benchmarks.empty.text')}
          </EmptyState>
        </Card>
      ) : (
        list.map((b) => (
          <Card
            key={b.id}
            title={`${b.cropName} · ${b.name}`}
            description={b.source ?? undefined}
            actions={
              can('finance.write') && (
                <span className="flex gap-1">
                  <Button variant="ghost" size="icon-sm" aria-label={t('common.edit')} onPress={() => setEditing(b)}>
                    <Pencil />
                  </Button>
                  <Button variant="ghost" size="icon-sm" aria-label={t('common.delete')} onPress={() => remove.mutate(b.id)}>
                    <Trash2 />
                  </Button>
                </span>
              )
            }
          >
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
              {BENCH_FIELDS.map(([k, label, unit]) => {
                const bench = b[k]
                const mine = ownValue(b.cropId, k)
                const delta = bench != null && mine != null ? mine - bench : null
                const value = (v: number | null) => (v == null ? '—' : unit === 't/ha' ? `${fmt.num(v, 1)} t/ha` : `${fmt.money(v, currency)}/ha`)
                // Costs are better when lower.
                const good = delta == null ? null : k === 'directCostsPerHa' || k === 'variableCostsPerHa' ? delta <= 0 : delta >= 0
                return (
                  <div key={k} className="rounded-lg border border-line p-3">
                    <div className="text-xs text-muted">{t(label)}</div>
                    <div className="text-sm mt-1">
                      <span className="text-muted">{t('benchmarks.own')}</span> <span className="font-medium tabular">{value(mine)}</span>
                    </div>
                    <div className="text-sm">
                      <span className="text-muted">{t('benchmarks.benchmark')}</span> <span className="tabular">{value(bench)}</span>
                    </div>
                    {delta != null && (
                      <Badge tone={good ? 'success' : 'danger'} className="mt-1">
                        {delta > 0 ? '+' : ''}
                        {unit === 't/ha' ? fmt.num(delta, 1) : fmt.money(delta, currency)}
                      </Badge>
                    )}
                  </div>
                )
              })}
            </div>
          </Card>
        ))
      )}
      <ModalDialog isOpen={editing != null} onOpenChange={(open) => !open && setEditing(null)} title={editing && editing !== 'new' ? t('benchmarks.edit') : t('benchmarks.add')} size="lg">
        {(close) => <BenchmarkForm benchmark={editing && editing !== 'new' ? editing : undefined} close={close} />}
      </ModalDialog>
    </div>
  )
}

function BenchmarkForm({ benchmark: b, close }: { benchmark?: CropBenchmark; close: () => void }) {
  const { t } = useTranslation()
  const crops = useOrgQuery<Crop[]>('/crops')
  const [cropId, setCropId] = useState<string | null>(b?.cropId ?? null)
  const [name, setName] = useState(b?.name ?? '')
  const [source, setSource] = useState(b?.source ?? '')
  const [values, setValues] = useState<Record<BenchKey, number>>(() => Object.fromEntries(BENCH_FIELDS.map(([k]) => [k, b?.[k] ?? NaN])) as Record<BenchKey, number>)
  const save = useOrgMutation(
    (base, input: CropBenchmarkInput) => (b ? api.put<CropBenchmark>(`${base}/economics/benchmarks/${b.id}`, input) : api.post<CropBenchmark>(`${base}/economics/benchmarks`, input)),
    { success: t('benchmarks.saved'), onSuccess: close },
  )
  return (
    <Form
      className="grid sm:grid-cols-2 gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        if (!cropId) return
        save.mutate({ cropId, name: name.trim(), source: textOrNull(source), ...(Object.fromEntries(BENCH_FIELDS.map(([k]) => [k, num(values[k])])) as Record<BenchKey, number | null>) })
      }}
    >
      <Select label={t('profitability.level.crop')} isRequired items={(crops.data ?? []).map((c) => ({ id: c.id, name: c.name }))} value={cropId} onChange={(v) => setCropId(v ? String(v) : null)}>
        {(c) => <Option id={c.id}>{c.name}</Option>}
      </Select>
      <TextField label={t('benchmarks.name')} isRequired value={name} onChange={setName} placeholder={t('benchmarks.namePlaceholder')} />
      {BENCH_FIELDS.map(([k, label, unit]) => (
        <NumberField key={k} label={t(label)} unit={unit} value={values[k]} onChange={(v) => setValues((s) => ({ ...s, [k]: v }))} formatOptions={{ maximumFractionDigits: 2 }} />
      ))}
      <TextField label={t('benchmarks.source')} value={source} onChange={setSource} className="sm:col-span-2" placeholder={t('benchmarks.sourcePlaceholder')} />
      <div className="sm:col-span-2">
        <FormActions close={close} isPending={save.isPending} submitLabel={t('common.saveChanges')} />
      </div>
    </Form>
  )
}

/** Market quotes of the EU Agri-food Data Portal against the farm's own prices (reference MarketPricesModal). */
export function MarketPricesCard({ harvestYear }: { harvestYear: number }) {
  const { t } = useTranslation()
  const data = useOrgQuery<CropMarketPrices[]>('/economics/market-prices', { harvestYear }, { staleTime: 60 * 60_000 })
  if (data.isLoading) return <Loading />
  if (data.error) return <ErrorNotice error={data.error} />
  const rows = (data.data ?? []).filter((r) => r.commodities.length)
  return (
    <Card title={t('market.title')} description={t('market.description')} padded={false}>
      {rows.length === 0 ? (
        <p className="p-4 text-sm text-muted">{t('market.noCrops')}</p>
      ) : (
        <Table aria-label={t('market.title')}>
          <TableHeader>
            <Column isRowHeader>{t('profitability.level.crop')}</Column>
            <Column>{t('market.quality')}</Column>
            <Column align="end">{t('market.quote')}</Column>
            <Column>{t('market.week')}</Column>
            <Column align="end">{t('market.own')}</Column>
          </TableHeader>
          <TableBody items={rows.flatMap((r) => (r.latest.length ? r.latest : [null]).map((q, i) => ({ id: `${r.cropId}:${i}`, r, q, first: i === 0 })))}>
            {({ r, q, first }) => (
              <Row>
                <Cell className="font-medium">{first ? r.cropName : ''}</Cell>
                <Cell>{q ? t(`market.commodity.${q.commodity}`) : <span className="text-muted">{t('market.noQuote')}</span>}</Cell>
                <Cell align="end" className="tabular">{q ? `${fmt.money(q.price, 'EUR', 2)}/t` : '—'}</Cell>
                <Cell className="text-muted">{q ? `${fmt.date(q.quoteDate)} · ${q.country}` : ''}</Cell>
                <Cell align="end" className="tabular">{first && r.ownPricePerT != null ? `${fmt.money(r.ownPricePerT, 'EUR', 2)}/t` : first ? '—' : ''}</Cell>
              </Row>
            )}
          </TableBody>
        </Table>
      )}
      <p className="px-4 py-2 text-xs text-muted border-t border-line">{t('market.source')}</p>
    </Card>
  )
}
