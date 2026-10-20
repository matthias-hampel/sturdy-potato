import { type CadastralParcel, type Field, type LeaseAnalytics, type LeaseFieldSummary, leaseBucket, type ParcelSyncResult } from '@agmeo/contracts'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import type { FeatureCollection, Geometry } from 'geojson'
import { AlertTriangle, ArrowLeft, Download, Landmark, Pencil, RefreshCw, Save } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button as AriaButton } from 'react-aria-components'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'
import { BUCKET_COLOR, LeaseBadge, LeaseDialog, rentText } from '#/components/cadastral/leases'
import { parcelTitle } from '#/components/cadastral/ParcelPicker'
import { FieldMap } from '#/components/map/FieldMap'
import { DataTable } from '#/components/table/DataTable'
import { type ColumnDef, useTableView } from '#/components/table/tableTools'
import { api, saveBlob } from '#/lib/api'
import { fmt } from '#/lib/format'
import { useOrg } from '#/lib/org'
import { useOrgMutation, useOrgQuery } from '#/lib/queries'
import { Button, Link, SegmentedControl } from '#/ui/Button'
import { NumberField } from '#/ui/Field'
import { Card, EmptyState, ErrorNotice, Loading, Notice, PageHeader, Stat, Tab, TabList, TabPanel, Tabs } from '#/ui/Layout'
import { Cell, Column, Row, Table, TableBody, TableHeader } from '#/ui/Table'

const TABS = ['parcels', 'analytics'] as const

export const Route = createFileRoute('/o/$orgId/fields/leases')({
  validateSearch: z.object({ tab: z.enum(TABS).optional().catch(undefined) }),
  component: LeasesPage,
})

/** Cadastral parcels of the fields with their leases (Pachtverwaltung), and the lease analytics. */
function LeasesPage() {
  const { t } = useTranslation()
  const { orgId, can } = useOrg()
  const { tab = 'parcels' } = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const parcels = useOrgQuery<CadastralParcel[]>('/cadastral/parcels')
  const fields = useOrgQuery<Field[]>('/fields')
  const [syncResult, setSyncResult] = useState<ParcelSyncResult | null>(null)
  const sync = useOrgMutation((base, fieldIds: string[] | undefined) => api.post<ParcelSyncResult>(`${base}/cadastral/sync`, fieldIds ? { fieldIds } : {}), {
    success: (r) => t('cadastral.sync.done', { inserted: r.inserted, skipped: r.skipped, count: r.fields.length }),
    onSuccess: setSyncResult,
  })
  const writable = can('field.write')
  const withParcels = new Set((parcels.data ?? []).map((p) => p.fieldId))
  const missing = (fields.data ?? []).filter((f) => !withParcels.has(f.id))

  const exportGeoJson = () => {
    const fc: FeatureCollection = {
      type: 'FeatureCollection',
      features: (parcels.data ?? []).map((p) => ({
        type: 'Feature',
        geometry: p.geometry,
        properties: {
          officialId: p.officialId,
          label: p.label,
          district: p.district,
          sector: p.sector,
          numerator: p.numerator,
          denominator: p.denominator,
          areaM2: p.areaM2,
          source: p.source,
          sourceState: p.sourceState,
          fieldId: p.fieldId,
          fieldName: p.fieldName,
          fieldAreaM2: p.fieldAreaM2,
          leaseType: p.lease?.leaseType ?? null,
          ownerName: p.lease?.ownerName ?? null,
          ownerAddress: p.lease?.ownerAddress ?? null,
          leaseholderName: p.lease?.leaseholderName ?? null,
          rentAmount: p.lease?.rentAmount ?? null,
          rentBasis: p.lease?.rentBasis ?? null,
          rentPerYear: p.rentPerYear,
          startsOn: p.lease?.startsOn ?? null,
          endsOn: p.lease?.endsOn ?? null,
          landRegisterVolume: p.lease?.landRegisterVolume ?? null,
          landRegisterSheet: p.lease?.landRegisterSheet ?? null,
          landRegisterNumber: p.lease?.landRegisterNumber ?? null,
          notes: p.lease?.notes ?? null,
        },
      })),
    }
    saveBlob(new Blob([JSON.stringify(fc, null, 2)], { type: 'application/geo+json' }), 'parcels-leases.geojson')
  }

  return (
    <>
      <PageHeader
        eyebrow={<Link to="/o/$orgId/fields" params={{ orgId }} variant="quiet" size="sm"><ArrowLeft /> {t('fields.title')}</Link>}
        title={t('cadastral.leases.title')}
        subtitle={t('cadastral.leases.subtitle')}
        actions={
          <>
            <Button onPress={exportGeoJson} isDisabled={!parcels.data?.length}><Download /> {t('cadastral.leases.export')}</Button>
            {writable && (
              <>
                <Button onPress={() => sync.mutate(undefined)} isPending={sync.isPending}><RefreshCw /> {t('cadastral.sync.all')}</Button>
                <Link to="/o/$orgId/fields/new" params={{ orgId }} search={{ mode: 'parcels' }} variant="primary"><Landmark /> {t('cadastral.leases.pickParcels')}</Link>
              </>
            )}
          </>
        }
      />
      {syncResult && <SyncReport result={syncResult} onClose={() => setSyncResult(null)} />}
      <Tabs selectedKey={tab} onSelectionChange={(k) => navigate({ search: { tab: k as (typeof TABS)[number] }, replace: true })}>
        <TabList aria-label={t('cadastral.leases.title')}>
          <Tab id="parcels">{t('cadastral.leases.tab.parcels')}</Tab>
          <Tab id="analytics">{t('cadastral.leases.tab.analytics')}</Tab>
        </TabList>
        <TabPanel id="parcels">
          {parcels.error ? <ErrorNotice error={parcels.error} /> : !parcels.data || !fields.data ? <Loading /> : (
            <>
              {writable && missing.length > 0 && parcels.data.length > 0 && (
                <Notice tone="info" className="mb-4">
                  <span className="flex flex-wrap items-center gap-3">
                    {t('cadastral.leases.missing', { count: missing.length })}
                    <Button size="sm" isPending={sync.isPending} onPress={() => sync.mutate(missing.map((f) => f.id))}><RefreshCw /> {t('cadastral.sync.missing')}</Button>
                  </span>
                </Notice>
              )}
              {parcels.data.length === 0 ? (
                <EmptyState
                  icon={Landmark}
                  title={t('cadastral.leases.empty.title')}
                  action={writable && <Button variant="primary" isPending={sync.isPending} onPress={() => sync.mutate(undefined)}><RefreshCw /> {t('cadastral.sync.all')}</Button>}
                >
                  {t('cadastral.leases.empty.description')}
                </EmptyState>
              ) : (
                <ParcelsView parcels={parcels.data} fields={fields.data} writable={writable} />
              )}
            </>
          )}
        </TabPanel>
        <TabPanel id="analytics">
          <AnalyticsView writable={writable} />
        </TabPanel>
      </Tabs>
    </>
  )
}

function SyncReport({ result, onClose }: { result: ParcelSyncResult; onClose: () => void }) {
  const { t } = useTranslation()
  const problems = result.fields.filter((f) => f.status !== 'ok' && f.status !== 'ok_slow')
  if (!problems.length) return null
  return (
    <Notice tone="warning" icon={AlertTriangle} className="mb-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <strong>{t('cadastral.sync.problems', { count: problems.length })}</strong>
          <ul className="mt-1 list-disc pl-4">
            {problems.slice(0, 20).map((f) => (
              <li key={f.fieldId}>
                {f.fieldName}: {t(`cadastral.status.${f.status}`, { state: f.state ?? '' })}
              </li>
            ))}
          </ul>
        </div>
        <Button size="sm" variant="ghost" onPress={onClose}>{t('common.close')}</Button>
      </div>
    </Notice>
  )
}

function ParcelsView({ parcels, fields, writable }: { parcels: CadastralParcel[]; fields: Field[]; writable: boolean }) {
  const { t } = useTranslation()
  const { org } = useOrg()
  const [colorMode, setColorMode] = useState<'lease' | 'cadastre'>('lease')
  const [editing, setEditing] = useState<CadastralParcel | null>(null)
  const [focus, setFocus] = useState<Geometry | null>(null)
  const sources = new Set(parcels.map((p) => p.sourceState).filter(Boolean))

  const overlay = useMemo<FeatureCollection>(
    () => ({
      type: 'FeatureCollection',
      features: parcels.map((p) => ({ type: 'Feature', geometry: p.geometry, properties: { id: p.id, color: colorMode === 'lease' ? BUCKET_COLOR[leaseBucket(p.lease?.leaseType)] : '#cbd5e1' } })),
    }),
    [parcels, colorMode],
  )

  const columns = useMemo<ColumnDef<CadastralParcel>[]>(
    () => [
      { id: 'field', label: t('cadastral.col.field'), filter: 'select', value: (p) => p.fieldName, render: (p) => <span className="font-medium">{p.fieldName}</span> },
      {
        id: 'parcel',
        label: t('cadastral.col.parcel'),
        isRowHeader: true,
        value: (p) => parcelTitle(p),
        text: (p) => `${parcelTitle(p)} ${p.officialId ?? ''}`,
        render: (p) => (
          <AriaButton className="text-left cursor-pointer hover:underline underline-offset-2 outline-none focus-visible:underline" onPress={() => setFocus({ ...p.geometry })}>
            <span className="block">{parcelTitle(p)}</span>
            {p.officialId && <span className="block text-xs text-muted tabular">{p.officialId}</span>}
          </AriaButton>
        ),
      },
      { id: 'area', label: t('cadastral.col.area'), align: 'end', filter: 'number', value: (p) => p.areaM2 / 10_000, render: (p) => <span className="tabular">{fmt.ha(p.areaM2 / 10_000, 4)}</span> },
      {
        id: 'inField',
        label: t('cadastral.col.inField'),
        align: 'end',
        filter: 'number',
        value: (p) => (p.fieldAreaM2 == null ? null : p.fieldAreaM2 / 10_000),
        render: (p) => (
          <span className="tabular" title={t('cadastral.col.inFieldHint')}>
            {fmt.ha(p.fieldAreaM2 == null ? null : p.fieldAreaM2 / 10_000, 4)}
            {p.fieldShare != null && p.fieldShare < 0.995 && <span className="block text-xs text-muted">{fmt.pct(p.fieldShare * 100)}</span>}
          </span>
        ),
      },
      { id: 'owner', label: t('cadastral.col.owner'), value: (p) => p.lease?.ownerName, render: (p) => p.lease?.ownerName ?? <span className="text-muted">—</span> },
      { id: 'status', label: t('cadastral.col.status'), filter: 'select', value: (p) => (p.lease ? t(`cadastral.leaseType.${p.lease.leaseType}`) : t('cadastral.bucket.unknown')), render: (p) => <LeaseBadge type={p.lease?.leaseType} /> },
      { id: 'leaseholder', label: t('cadastral.col.leaseholder'), value: (p) => p.lease?.leaseholderName, render: (p) => p.lease?.leaseholderName ?? <span className="text-muted">—</span> },
      { id: 'rent', label: t('cadastral.col.rent'), align: 'end', filter: 'number', value: (p) => p.rentPerYear, render: (p) => <span className="tabular whitespace-nowrap">{rentText(p, org.currency)}</span> },
      { id: 'fieldRent', label: t('cadastral.col.fieldRent'), align: 'end', filter: 'number', value: (p) => p.fieldRentPerYear, render: (p) => <span className="tabular whitespace-nowrap" title={t('cadastral.col.fieldRentHint')}>{fmt.money(p.fieldRentPerYear, org.currency)}</span> },
      { id: 'endsOn', label: t('cadastral.col.endsOn'), filter: 'date', value: (p) => p.lease?.endsOn, render: (p) => <span className="whitespace-nowrap">{fmt.date(p.lease?.endsOn)}</span> },
      { id: 'source', label: t('cadastral.col.source'), filter: 'select', value: (p) => t(`cadastral.source.${p.source}`), render: (p) => <span className="text-muted text-xs">{t(`cadastral.source.${p.source}`)}{p.sourceState ? ` · ${p.sourceState}` : ''}</span> },
    ],
    [t, org.currency],
  )
  const view = useTableView(columns, parcels)
  const fieldRent = view.shown.reduce((s, p) => s + (p.fieldRentPerYear ?? 0), 0)

  return (
    <div className="space-y-4">
      <FieldMap fields={fields} labels overlay={overlay} overlayOpacity={0.6} fillOpacity={0.05} focus={focus} className="h-[45vh] min-h-72">
        <div className="absolute top-14 left-3 z-10">
          <SegmentedControl
            aria-label={t('cadastral.leases.mapColor')}
            value={colorMode}
            onChange={setColorMode}
            items={[
              { id: 'lease', label: t('cadastral.leases.mapLease') },
              { id: 'cadastre', label: t('cadastral.leases.mapCadastre') },
            ]}
          />
        </div>
      </FieldMap>
      {colorMode === 'lease' && (
        <div className="flex flex-wrap gap-3 text-xs text-muted">
          {(Object.keys(BUCKET_COLOR) as (keyof typeof BUCKET_COLOR)[]).map((b) => (
            <span key={b} className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-full" style={{ background: BUCKET_COLOR[b] }} aria-hidden />{t(`cadastral.bucket.${b}`)}</span>
          ))}
        </div>
      )}
      <Card
        padded={false}
        title={t('cadastral.leases.tableTitle')}
        description={t('cadastral.leases.tableSummary', { count: view.shown.length, rent: fmt.money(fieldRent, org.currency) })}
      >
        <DataTable
          aria-label={t('cadastral.leases.tableTitle')}
          view={view}
          actions={(p) => writable && (
            <Button size="icon-sm" variant="ghost" aria-label={t('cadastral.lease.edit', { parcel: parcelTitle(p) })} onPress={() => setEditing(p)}>
              <Pencil />
            </Button>
          )}
        />
      </Card>
      <p className="text-xs text-muted">{t('cadastral.leases.source', { states: [...sources].join(', ') || '—' })}</p>
      {editing && <LeaseDialog parcel={editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

function AnalyticsView({ writable }: { writable: boolean }) {
  const { t } = useTranslation()
  const { org } = useOrg()
  const [months, setMonths] = useState(12)
  const data = useOrgQuery<LeaseAnalytics>('/cadastral/leases/analytics', { months })
  if (data.error) return <ErrorNotice error={data.error} />
  if (!data.data) return <Loading />
  const a = data.data
  if (a.parcelCount === 0) return <EmptyState icon={Landmark} title={t('cadastral.analytics.empty')} />
  const money = (v: number | null) => fmt.money(v, org.currency)
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label={t('cadastral.analytics.totalArea')} value={fmt.ha(a.areaHa, 2)} hint={t('cadastral.analytics.parcels', { count: a.parcelCount })} />
        <Stat label={t('cadastral.analytics.owned')} value={fmt.ha(a.ownedHa, 2)} tone="success" />
        <Stat label={t('cadastral.analytics.leased')} value={fmt.ha(a.leasedHa, 2)} hint={t('cadastral.analytics.parcels', { count: a.leasedParcels })} tone="warning" />
        <Stat
          label={t('cadastral.analytics.rent')}
          value={money(a.rentPerYear)}
          hint={a.rentPerLeasedHa != null ? t('cadastral.analytics.rentPerHa', { amount: money(a.rentPerLeasedHa) }) : undefined}
        />
      </div>
      {a.leasedParcels > a.leasedParcelsWithRent && (
        <Notice tone="info">{t('cadastral.analytics.coverage', { covered: a.leasedParcelsWithRent, total: a.leasedParcels })}</Notice>
      )}

      <Card title={t('cadastral.analytics.breakdown')}>
        <div className="flex h-3 w-full overflow-hidden rounded-full bg-surface-3" role="img" aria-label={t('cadastral.analytics.breakdown')}>
          {a.byBucket.map((b) => (a.areaHa > 0 && b.areaHa > 0 ? <span key={b.bucket} style={{ width: `${(b.areaHa / a.areaHa) * 100}%`, background: BUCKET_COLOR[b.bucket] }} /> : null))}
        </div>
        <ul className="mt-3 space-y-1 text-sm">
          {a.byBucket.map((b) => (
            <li key={b.bucket} className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2"><span className="size-2.5 rounded-full" style={{ background: BUCKET_COLOR[b.bucket] }} aria-hidden />{t(`cadastral.bucket.${b.bucket}`)}</span>
              <span className="text-muted tabular">
                {fmt.ha(b.areaHa, 2)} · {t('cadastral.analytics.parcels', { count: b.parcelCount })}
                {b.rentPerYear > 0 && ` · ${t('cadastral.analytics.perYear', { amount: money(b.rentPerYear) })}`}
              </span>
            </li>
          ))}
        </ul>
      </Card>

      <Card title={t('cadastral.analytics.byField')} description={t('cadastral.analytics.byFieldHint')} padded={false}>
        <Table aria-label={t('cadastral.analytics.byField')}>
          <TableHeader>
            <Column isRowHeader>{t('cadastral.col.field')}</Column>
            <Column align="end">{t('cadastral.analytics.col.area')}</Column>
            <Column align="end">{t('cadastral.analytics.col.owned')}</Column>
            <Column align="end">{t('cadastral.analytics.col.leased')}</Column>
            <Column align="end">{t('cadastral.analytics.col.uncovered')}</Column>
            <Column align="end">{t('cadastral.analytics.col.rent')}</Column>
            <Column align="end">{t('cadastral.analytics.col.rentPerLeasedHa')}</Column>
            <Column align="end">{t('cadastral.analytics.col.derived')}</Column>
            <Column align="end">{t('cadastral.analytics.col.own')}</Column>
          </TableHeader>
          <TableBody items={a.fields.map((f) => ({ ...f, id: f.fieldId }))}>
            {(f) => (
              <Row id={f.fieldId}>
                <Cell>{f.fieldName}</Cell>
                <Cell align="end">{fmt.ha(f.fieldAreaHa, 2)}</Cell>
                <Cell align="end">{f.ownedHa > 0 ? fmt.ha(f.ownedHa, 2) : '—'}</Cell>
                <Cell align="end">{f.leasedHa > 0 ? fmt.ha(f.leasedHa, 2) : '—'}</Cell>
                <Cell align="end">{f.uncoveredHa >= 0.01 ? fmt.ha(f.uncoveredHa, 2) : '—'}</Cell>
                <Cell align="end">{f.rentPerYear > 0 ? money(f.rentPerYear) : '—'}</Cell>
                <Cell align="end">{money(f.rentPerLeasedHa)}</Cell>
                <Cell align="end">{money(f.derivedLeasePerHa)}</Cell>
                <Cell align="end">{writable ? <OwnLease field={f} /> : money(f.leasePerHa)}</Cell>
              </Row>
            )}
          </TableBody>
        </Table>
      </Card>

      <Card
        title={t('cadastral.analytics.expiring')}
        actions={
          <SegmentedControl
            aria-label={t('cadastral.analytics.horizon')}
            value={String(months)}
            onChange={(v) => setMonths(Number(v))}
            items={['6', '12', '24'].map((m) => ({ id: m, label: t('cadastral.analytics.months', { count: Number(m) }) }))}
          />
        }
        padded={false}
      >
        {a.expiring.length === 0 ? (
          <p className="p-5 text-sm text-muted">{t('cadastral.analytics.noneExpiring', { count: months })}</p>
        ) : (
          <Table aria-label={t('cadastral.analytics.expiring')}>
            <TableHeader>
              <Column isRowHeader>{t('cadastral.col.parcel')}</Column>
              <Column>{t('cadastral.col.field')}</Column>
              <Column>{t('cadastral.col.owner')}</Column>
              <Column>{t('cadastral.col.endsOn')}</Column>
              <Column align="end">{t('cadastral.col.rent')}</Column>
            </TableHeader>
            <TableBody items={a.expiring.map((e) => ({ ...e, id: e.parcelId }))}>
              {(e) => (
                <Row id={e.parcelId}>
                  <Cell>{e.label ?? '—'}</Cell>
                  <Cell>{e.fieldName}</Cell>
                  <Cell>{e.ownerName ?? '—'}</Cell>
                  <Cell>
                    <span className={e.daysLeft < 0 ? 'text-danger' : e.daysLeft < 90 ? 'text-warning' : undefined}>
                      {fmt.date(e.endsOn)} · {e.daysLeft < 0 ? t('cadastral.analytics.ended') : fmt.relativeDays(e.endsOn)}
                    </span>
                  </Cell>
                  <Cell align="end">{money(e.rentPerYear)}</Cell>
                </Row>
              )}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  )
}

/** The field's own lease per ha, which economics prefers over the one derived from the parcels. */
function OwnLease({ field }: { field: LeaseFieldSummary }) {
  const { t } = useTranslation()
  const { org } = useOrg()
  const [value, setValue] = useState(field.leasePerHa ?? NaN)
  const save = useOrgMutation((base, _: void) => api.patch(`${base}/fields/${field.fieldId}`, { leasePerHa: Number.isNaN(value) ? null : value }), { success: t('cadastral.analytics.ownSaved') })
  const dirty = (Number.isNaN(value) ? null : value) !== field.leasePerHa
  return (
    <span className="inline-flex items-center gap-1 justify-end">
      <NumberField
        aria-label={t('cadastral.analytics.ownFor', { field: field.fieldName })}
        className="w-28"
        value={value}
        minValue={0}
        placeholder={field.derivedLeasePerHa != null ? fmt.num(field.derivedLeasePerHa) : undefined}
        formatOptions={{ style: 'currency', currency: org.currency, maximumFractionDigits: 0 }}
        onChange={setValue}
      />
      <Button size="icon-sm" variant="ghost" aria-label={t('common.save')} isDisabled={!dirty} isPending={save.isPending} onPress={() => save.mutate()}>
        <Save />
      </Button>
    </span>
  )
}
