import { IMAGERY_LAYERS, type CostEntry, type CropCycle, type Farm, type Field, type FieldGeometryVersion, type ImageryLayer, type ImageryStretch, type Operation } from '@agmeo/contracts'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Archive, ArchiveRestore, CalendarClock, MoreHorizontal, Pencil, Plus, Shapes, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { z } from 'zod'
import { Button as AriaButton, Form } from 'react-aria-components'
import { FieldPartsTab } from '#/components/fields/FieldParts'
import { SoilTab } from '#/components/fields/SoilTab'
import { FieldDetailsForm, detailsPayload, type FieldDetails } from '#/components/fields/FieldDetailsForm'
import { useGeometryCheck } from '#/components/fields/useGeometryCheck'
import { Activity } from '#/components/Activity'
import { CropCycleStatusBadge, CropTag } from '#/components/labels'
import { DrawField, type DrawnGeometry } from '#/components/map/DrawField'
import { FieldMap } from '#/components/map/FieldMap'
import { AcquisitionTimeline, ImageryProgress, IndexLegend, LayerPicker, OpacityPicker, StretchPicker } from '#/components/monitoring/MapControls'
import { INDEX_INFO, type ShownIndex } from '#/components/monitoring/indices'
import { ObservationsChart } from '#/components/monitoring/ObservationsChart'
import { ProductivityZones } from '#/components/monitoring/ProductivityZones'
import { useSatelliteLayer } from '#/components/monitoring/useSatelliteLayer'
import { OperationsTable } from '#/components/operations/OperationsTable'
import { RecommendationsCard } from '#/components/recommendations/RecommendationsCard'
import { api } from '#/lib/api'
import { fmt, today } from '#/lib/format'
import { useOrg } from '#/lib/org'
import { useOrgMutation, useOrgQuery } from '#/lib/queries'
import { costCategoryLabel } from '#/i18n/labels'
import { Button, Link, buttonClass } from '#/ui/Button'
import { DatePicker } from '#/ui/Field'
import { Badge, Card, DescriptionList, ErrorNotice, Loading, Notice, PageHeader, Stat, Tab, TabList, TabPanel, Tabs } from '#/ui/Layout'
import { ConfirmButton, Menu, MenuItem, MenuTrigger, ModalDialog } from '#/ui/Overlay'
import { Cell, Column, Row, Table, TableBody, TableHeader } from '#/ui/Table'

const TABS = ['overview', 'parts', 'crops', 'soil', 'operations', 'satellite', 'zones', 'boundary', 'costs', 'activity'] as const

export const Route = createFileRoute('/o/$orgId/fields/$fieldId')({
  validateSearch: z.object({
    tab: z.enum(TABS).optional(),
    index: z.enum(IMAGERY_LAYERS).optional(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  }),
  component: FieldPage,
})

function FieldPage() {
  const { t } = useTranslation()
  const { orgId, can } = useOrg()
  const { fieldId } = Route.useParams()
  const search = Route.useSearch()
  const navigateTab = useNavigate({ from: Route.fullPath })
  const navigate = useNavigate()
  const field = useOrgQuery<Field>(`/fields/${fieldId}`)
  const cycles = useOrgQuery<CropCycle[]>('/crop-cycles', { fieldId })
  const operations = useOrgQuery<Operation[]>('/operations', { fieldId })
  const [editOpen, setEditOpen] = useState(false)
  const [boundaryOpen, setBoundaryOpen] = useState(false)

  const setStatus = useOrgMutation((base, status: 'active' | 'archived') => api.patch<Field>(`${base}/fields/${fieldId}`, { status }), {
    success: (f) => (f.status === 'archived' ? t('fieldPage.archived') : t('fieldPage.restored')),
  })
  const remove = useOrgMutation((base, _: void) => api.delete(`${base}/fields/${fieldId}`), {
    success: t('fieldPage.deleted'),
    onSuccess: () => navigate({ to: '/o/$orgId/fields', params: { orgId } }),
  })

  if (field.isLoading) return <Loading />
  if (field.error) return <ErrorNotice error={field.error} />
  const f = field.data!
  const completed = (operations.data ?? []).filter((o) => o.status === 'completed')

  return (
    <>
      <PageHeader
        eyebrow={<Link to="/o/$orgId/fields" params={{ orgId }}>{t('fields.list')}</Link>}
        title={
          <span className="flex items-center gap-3">
            {f.name}
            {f.status === 'archived' && <Badge>{t('fieldPage.archivedBadge')}</Badge>}
          </span>
        }
        subtitle={`${f.farmName} · ${fmt.ha(f.areaHa)}${f.identifier ? ` · ${f.identifier}` : ''}`}
        actions={
          can('field.write') && (
            <>
              <Button onPress={() => setBoundaryOpen(true)}>
                <Shapes /> {t('fieldPage.editBoundary')}
              </Button>
              <Button onPress={() => setEditOpen(true)}>
                <Pencil /> {t('fieldPage.editDetails')}
              </Button>
              <MenuTrigger>
                <AriaButton aria-label={t('fieldPage.moreActions')} className={buttonClass('secondary', 'icon')}>
                  <MoreHorizontal className="size-4" />
                </AriaButton>
                <Menu onAction={(key) => key === 'archive' && setStatus.mutate(f.status === 'archived' ? 'active' : 'archived')}>
                  <MenuItem id="archive">{f.status === 'archived' ? <><ArchiveRestore /> {t('fieldPage.restore')}</> : <><Archive /> {t('fieldPage.archive')}</>}</MenuItem>
                </Menu>
              </MenuTrigger>
            </>
          )
        }
      />

      {f.plannedGeometry && (
        <Notice tone="info" icon={CalendarClock} className="mb-6">
          <Trans
            i18nKey="fieldPage.boundary.plannedNotice"
            values={{ date: fmt.date(f.plannedGeometry.validFrom), area: fmt.ha(f.plannedGeometry.areaHa) }}
            components={{ b: <strong className="tabular" /> }}
          />{' '}
          <AriaButton className="underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-primary/50 rounded-sm" onPress={() => navigateTab({ search: (prev) => ({ ...prev, tab: 'boundary' }), replace: true })}>
            {t('fieldPage.boundary.showPlanned')}
          </AriaButton>
        </Notice>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <Stat label={t('fieldPage.area')} value={fmt.ha(f.areaHa)} hint={t('fieldPage.areaHint')} />
        <Stat label={t('fieldPage.cropThisSeason')} value={<CropTag name={f.currentCrop?.cropName} color={f.currentCrop?.color} />} hint={f.currentCrop?.seasonName} />
        <Stat label={t('fieldPage.completedOperations')} value={fmt.num(completed.length)} />
        <Stat label={t('fields.tenure.label')} value={f.tenure === 'owned' ? t('fields.tenure.owned') : f.tenure === 'leased' ? t('fields.tenure.leased') : t('fields.tenure.other')} />
      </div>

      <Tabs
        selectedKey={search.tab ?? 'overview'}
        onSelectionChange={(key) => navigateTab({ search: (prev) => ({ ...prev, tab: key === 'overview' ? undefined : (key as (typeof TABS)[number]) }), replace: true })}
      >
        <TabList aria-label={t('fieldPage.tabs.label')}>
          <Tab id="overview">{t('fieldPage.tabs.overview')}</Tab>
          <Tab id="parts">{t('fieldParts.tab')}</Tab>
          <Tab id="crops">{t('fieldPage.tabs.crops')}</Tab>
          <Tab id="soil">{t('fieldPage.tabs.soil')}</Tab>
          <Tab id="operations">{t('fieldPage.tabs.operations')}</Tab>
          <Tab id="satellite">{t('fieldPage.tabs.satellite')}</Tab>
          <Tab id="zones">{t('fieldPage.tabs.zones')}</Tab>
          <Tab id="boundary">{t('fieldPage.tabs.boundary')}</Tab>
          {can('finance.read') && <Tab id="costs">{t('fieldPage.tabs.costs')}</Tab>}
          <Tab id="activity">{t('fieldPage.tabs.activity')}</Tab>
        </TabList>
        <TabPanel id="overview">
          <div className="grid lg:grid-cols-[1.4fr_1fr] gap-6">
            <FieldMap fields={[f]} selectedId={f.id} className="h-96" />
            <Card title={t('common.details')}>
              <DescriptionList
                items={[
                  { label: t('fields.farm'), value: f.farmName },
                  { label: t('fields.identifier'), value: f.identifier },
                  { label: t('fieldPage.area'), value: fmt.ha(f.areaHa, 4) },
                  { label: t('fields.soilType'), value: f.soilType },
                  { label: t('fieldPage.centre'), value: <span className="tabular">{f.centroid.lat.toFixed(5)}, {f.centroid.lng.toFixed(5)}</span> },
                  { label: t('common.notes'), value: f.notes },
                  { label: t('fieldPage.created'), value: fmt.date(f.createdAt) },
                ]}
              />
            </Card>
          </div>
          <RecommendationsCard fieldId={f.id} className="mt-6" />
        </TabPanel>
        <TabPanel id="parts">
          <FieldPartsTab field={f} />
        </TabPanel>
        <TabPanel id="crops">
          <Card
            title={t('fieldPage.crops.title')}
            padded={false}
            actions={can('crop.write') && <Link to="/o/$orgId/crops" params={{ orgId }} variant="secondary" size="sm"><Plus /> {t('fieldPage.crops.plan')}</Link>}
          >
            <Table aria-label={t('fieldPage.tabs.crops')}>
              <TableHeader>
                <Column isRowHeader>{t('fieldPage.crops.season')}</Column>
                <Column>{t('fieldPage.crops.crop')}</Column>
                <Column>{t('fieldPage.crops.variety')}</Column>
                <Column>{t('fieldPage.crops.sown')}</Column>
                <Column align="end">{t('fieldPage.crops.expectedYield')}</Column>
                <Column>{t('common.status')}</Column>
              </TableHeader>
              <TableBody items={cycles.data ?? []} renderEmptyState={() => <div className="py-8 text-center text-sm text-muted">{t('fieldPage.crops.empty')}</div>}>
                {(c) => (
                  <Row id={c.id}>
                    <Cell>{c.seasonName}</Cell>
                    <Cell>
                      <CropTag name={c.cropName} color={c.cropColor} />
                      {c.fieldPartName && <div className="text-xs text-muted pl-4">{c.fieldPartName}</div>}
                    </Cell>
                    <Cell>{c.varietyName ?? <span className="text-muted">—</span>}</Cell>
                    <Cell className="tabular">{fmt.date(c.sowingDate)}</Cell>
                    <Cell align="end">{c.expectedYieldTHa != null ? `${fmt.fixed(c.expectedYieldTHa, 1)} t/ha` : '—'}</Cell>
                    <Cell><CropCycleStatusBadge status={c.status} /></Cell>
                  </Row>
                )}
              </TableBody>
            </Table>
          </Card>
        </TabPanel>
        <TabPanel id="soil">
          <SoilTab field={f} />
        </TabPanel>
        <TabPanel id="operations">
          <Card
            padded={false}
            title={t('fieldPage.operations.title')}
            description={t('fieldPage.operations.description')}
            actions={can('operation.write') && <Link to="/o/$orgId/operations/new" params={{ orgId }} search={{ fieldId }} variant="secondary" size="sm"><Plus /> {t('fieldPage.operations.record')}</Link>}
          >
            {operations.isLoading ? <div className="p-4"><Loading /></div> : <OperationsTable operations={operations.data ?? []} showFields={false} emptyText={t('fieldPage.operations.empty')} />}
          </Card>
        </TabPanel>
        <TabPanel id="satellite">
          <SatelliteTab
            field={f}
            layer={search.index ?? 'ndvi'}
            onLayer={(i) => navigateTab({ search: (prev) => ({ ...prev, index: i === 'ndvi' ? undefined : i }), replace: true })}
            date={search.date ?? null}
            onDate={(d) => navigateTab({ search: (prev) => ({ ...prev, date: d }), replace: true })}
          />
        </TabPanel>
        <TabPanel id="zones">
          <ProductivityZones field={f} />
        </TabPanel>
        <TabPanel id="boundary">
          <BoundaryHistory fieldId={fieldId} canEdit={can('field.write')} onAdd={() => setBoundaryOpen(true)} />
        </TabPanel>
        {can('finance.read') && (
          <TabPanel id="costs">
            <FieldCosts fieldId={fieldId} />
          </TabPanel>
        )}
        <TabPanel id="activity">
          <Activity entityType="field" entityId={fieldId} />
        </TabPanel>
      </Tabs>

      <EditDetailsDialog field={f} isOpen={editOpen} onOpenChange={setEditOpen} />
      {boundaryOpen && <EditBoundaryDialog field={f} onClose={() => setBoundaryOpen(false)} />}
      {can('field.write') && completed.length === 0 && (cycles.data?.length ?? 0) === 0 && (
        <div className="mt-8 flex justify-end">
          <ConfirmButton
            title={t('fieldPage.delete.title', { name: f.name })}
            message={t('fieldPage.delete.message')}
            confirmLabel={t('fieldPage.delete.confirm')}
            onConfirm={() => remove.mutateAsync()}
            trigger={<Button variant="ghost" className="text-danger"><Trash2 /> {t('fieldPage.delete.confirm')}</Button>}
          />
        </div>
      )}
    </>
  )
}

function EditDetailsDialog({ field, isOpen, onOpenChange }: { field: Field; isOpen: boolean; onOpenChange: (v: boolean) => void }) {
  const { t } = useTranslation()
  const farms = useOrgQuery<Farm[]>('/farms')
  const [details, setDetails] = useState<FieldDetails>({
    farmId: field.farmId,
    name: field.name,
    identifier: field.identifier ?? '',
    tenure: field.tenure,
    soilType: field.soilType ?? '',
    notes: field.notes ?? '',
  })
  const save = useOrgMutation((base, _: void) => api.patch<Field>(`${base}/fields/${field.id}`, { farmId: details.farmId, ...detailsPayload(details) }), {
    success: t('fieldPage.updated'),
    onSuccess: () => onOpenChange(false),
  })
  return (
    <ModalDialog isOpen={isOpen} onOpenChange={onOpenChange} title={t('fieldPage.editDetailsTitle')}>
      <Form onSubmit={(e) => { e.preventDefault(); save.mutate() }} className="space-y-5">
        <FieldDetailsForm value={details} onChange={setDetails} farms={farms.data ?? []} />
        <div className="flex justify-end gap-2">
          <Button onPress={() => onOpenChange(false)}>{t('common.cancel')}</Button>
          <Button type="submit" variant="primary" isPending={save.isPending}>{t('common.save')}</Button>
        </div>
      </Form>
    </ModalDialog>
  )
}

function EditBoundaryDialog({ field, onClose }: { field: Field; onClose: () => void }) {
  const { t } = useTranslation()
  const [geometry, setGeometry] = useState<DrawnGeometry | null>(field.geometry)
  const [validFrom, setValidFrom] = useState<string | null>(today())
  const { result } = useGeometryCheck(geometry, field.id)
  const planned = !!validFrom && validFrom > today()
  const save = useOrgMutation(
    (base, _: void) => api.put<Field>(`${base}/fields/${field.id}/geometry`, { geometry, validFrom: validFrom === today() ? undefined : new Date(`${validFrom}T00:00:00`).toISOString() }),
    {
      success: (f) =>
        planned ? t('fieldPage.boundary.planned', { date: fmt.date(validFrom), area: fmt.ha(result?.areaHa ?? 0) }) : t('fieldPage.boundary.updated', { area: fmt.ha(f.areaHa) }),
      onSuccess: onClose,
    },
  )
  return (
    <ModalDialog isOpen onOpenChange={(o) => !o && onClose()} title={t('fieldPage.boundary.title', { name: field.name })} description={t('fieldPage.boundary.description')} size="xl">
      <div className="space-y-4">
        <DrawField initial={field.geometry} onChange={setGeometry} className="h-[55vh] min-h-80" />
        <div className="flex flex-wrap items-end gap-4">
          <DatePicker
            label={t('fieldPage.boundary.validFrom')}
            value={validFrom}
            onChange={setValidFrom}
            description={planned ? t('fieldPage.boundary.validFromPlanned') : undefined}
          />
          <div className="flex-1 min-w-60 text-sm">
            {result && !result.valid && <Notice tone="danger">{result.reason}</Notice>}
            {result?.valid && (
              <p>
                <Trans i18nKey="fieldPage.boundary.newArea" values={{ area: fmt.ha(result.areaHa), previous: fmt.ha(field.areaHa) }} components={{ b: <strong className="tabular" /> }} />
                {result.overlaps.length > 0 && <span className="text-warning"> · {t('fieldPage.boundary.overlaps', { names: result.overlaps.map((o) => o.fieldName).join(', ') })}</span>}
              </p>
            )}
          </div>
          <Button onPress={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" isDisabled={!geometry || !result?.valid || !validFrom} isPending={save.isPending} onPress={() => save.mutate()}>
            {planned ? t('fieldPage.boundary.savePlanned') : t('fieldPage.boundary.save')}
          </Button>
        </div>
      </div>
    </ModalDialog>
  )
}

function BoundaryHistory({ fieldId, canEdit, onAdd }: { fieldId: string; canEdit: boolean; onAdd: () => void }) {
  const { t } = useTranslation()
  const history = useOrgQuery<FieldGeometryVersion[]>(`/fields/${fieldId}/geometry-history`)
  const [selected, setSelected] = useState<string | null>(null)
  const cancel = useOrgMutation((base, versionId: string) => api.delete<Field>(`${base}/fields/${fieldId}/geometry/${versionId}`), {
    success: t('fieldPage.boundary.cancelled'),
    onSuccess: () => setSelected(null),
  })
  if (history.isLoading) return <Loading />
  const versions = history.data ?? []
  const shown = versions.find((v) => v.id === selected) ?? versions.find((v) => v.status === 'current') ?? versions[0]
  return (
    <div className="grid lg:grid-cols-[1fr_1.3fr] gap-6">
      <Card
        title={t('fieldPage.boundary.versions')}
        padded={false}
        actions={canEdit && <Button size="sm" onPress={onAdd}><Plus /> {t('fieldPage.boundary.add')}</Button>}
      >
        <ul className="divide-y divide-line">
          {versions.map((v) => (
            <li key={v.id} className={`flex items-center gap-2 pr-3 ${shown?.id === v.id ? 'bg-primary-soft' : ''}`}>
              <button type="button" onClick={() => setSelected(v.id)} className="flex-1 min-w-0 text-left px-4 py-3 hover:bg-surface-2 outline-none focus-visible:bg-primary-soft">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium tabular">
                    {v.status === 'planned' && !v.validTo
                      ? t('fieldPage.boundary.from', { date: fmt.date(v.validFrom) })
                      : `${fmt.date(v.validFrom)} – ${v.validTo ? fmt.date(v.validTo) : t('fieldPage.boundary.today')}`}
                  </span>
                  {v.status === 'current' && <Badge tone="success">{t('fieldPage.boundary.current')}</Badge>}
                  {v.status === 'planned' && <Badge tone="info">{t('fieldPage.boundary.plannedBadge')}</Badge>}
                </div>
                <div className="text-xs text-muted mt-0.5">{fmt.ha(v.areaHa)} · {v.source === 'import' ? t('fieldPage.boundary.source.import') : v.source === 'edit' ? t('fieldPage.boundary.source.edit') : t('fieldPage.boundary.source.drawn')}</div>
              </button>
              {canEdit && v.status === 'planned' && (
                <ConfirmButton
                  title={t('fieldPage.boundary.cancelTitle')}
                  message={t('fieldPage.boundary.cancelMessage', { date: fmt.date(v.validFrom) })}
                  confirmLabel={t('fieldPage.boundary.cancel')}
                  onConfirm={() => cancel.mutateAsync(v.id)}
                  trigger={<Button variant="ghost" size="icon-sm" aria-label={t('fieldPage.boundary.cancel')}><X /></Button>}
                />
              )}
            </li>
          ))}
        </ul>
      </Card>
      {shown && (
        <FieldMap
          fields={[]}
          highlight={shown.geometry}
          labels={false}
          className="h-96"
        />
      )}
    </div>
  )
}

function FieldCosts({ fieldId }: { fieldId: string }) {
  const { t } = useTranslation()
  const { org } = useOrg()
  const costs = useOrgQuery<CostEntry[]>('/cost-entries', { fieldId })
  const total = (costs.data ?? []).reduce((s, c) => s + c.amount, 0)
  return (
    <Card title={t('fieldPage.costs.title')} description={t('fieldPage.costs.total', { amount: fmt.money(total, org.currency) })} padded={false}>
      <Table aria-label={t('fieldPage.costs.tableLabel')}>
        <TableHeader>
          <Column isRowHeader>{t('common.date')}</Column>
          <Column>{t('fieldPage.costs.category')}</Column>
          <Column>{t('fieldPage.costs.source')}</Column>
          <Column align="end">{t('fieldPage.costs.amount')}</Column>
        </TableHeader>
        <TableBody items={costs.data ?? []} renderEmptyState={() => <div className="py-8 text-center text-sm text-muted">{t('fieldPage.costs.empty')}</div>}>
          {(c) => (
            <Row id={c.id}>
              <Cell className="tabular">{fmt.date(c.incurredOn)}</Cell>
              <Cell>{costCategoryLabel(c.category)}</Cell>
              <Cell className="text-fg-2">{c.operationTitle ?? c.description ?? (c.source === 'manual' ? t('fieldPage.costs.manual') : '—')}{c.source === 'reversal' && <Badge className="ml-2">{t('fieldPage.costs.reversal')}</Badge>}</Cell>
              <Cell align="end">{fmt.money(c.amount, c.currency, 2)}</Cell>
            </Row>
          )}
        </TableBody>
      </Table>
    </Card>
  )
}

function SatelliteTab({
  field,
  layer,
  onLayer,
  date,
  onDate,
}: {
  field: Field
  layer: ImageryLayer
  onLayer: (l: ImageryLayer) => void
  date: string | null
  onDate: (d: string) => void
}) {
  const { t } = useTranslation()
  const [stretch, setStretch] = useState<ImageryStretch>('absolute')
  const satellite = useSatelliteLayer({ enabled: true, layer, stretch, fieldId: field.id, fields: [field], date, onDate })
  const shown = satellite.date
  const index: ShownIndex = layer === 'rgb' ? 'ndvi' : layer
  const select = satellite.setDate
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <LayerPicker value={layer} onChange={onLayer} />
        <StretchPicker value={stretch} onChange={setStretch} isDisabled={layer === 'rgb'} />
        <OpacityPicker value={satellite.opacity} onChange={satellite.setOpacity} />
      </div>
      <ImageryProgress status={satellite.status} />
      {!satellite.isLoading && satellite.dates.length === 0 && satellite.status?.state !== 'running' && satellite.status?.state !== 'queued' && (
        <Notice>{t('fieldPage.satellite.none')}</Notice>
      )}
      <div className="grid xl:grid-cols-[1fr_1.2fr] gap-6 items-start">
        <div className="space-y-2">
          <FieldMap fields={[field]} fillOpacity={0} raster={satellite.raster} labels={false} className="h-96 xl:h-[28rem]">
            <IndexLegend index={layer} stretch={stretch} />
          </FieldMap>
          {satellite.dates.length > 0 && <AcquisitionTimeline dates={satellite.dates} date={shown} onDate={select} single />}
          {shown && layer === 'rgb' && !shown.hasRgb && <p className="text-xs text-muted">{t('fieldPage.satellite.noRgb')}</p>}
        </div>
        <Card title={t('fieldPage.satellite.overTime', { index: INDEX_INFO[index].label })} description={INDEX_INFO[index].description}>
          <ObservationsChart fieldId={field.id} fieldName={field.name} index={index} selectedDate={shown?.date} onSelect={select} />
        </Card>
      </div>
      <p className="text-xs text-muted">{t('fieldPage.satellite.method', { year: satellite.status?.historyFrom?.slice(0, 4) ?? '2018' })}</p>
    </div>
  )
}
