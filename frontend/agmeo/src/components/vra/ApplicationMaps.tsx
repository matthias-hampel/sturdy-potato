import {
  isOwnBase,
  MAX_SATELLITE_SCENES,
  SATELLITE_BASE_INDICES,
  SATELLITE_METHODS,
  SATELLITE_ZONE_COUNTS,
  type BaseZoning,
  type Field,
  type ImageryDate,
  type UploadBaseResult,
  type VraBases,
  type VraExportFormat,
  type VraMap,
  type VraMapSummary,
  type ZoningJob,
} from '@agmeo/contracts'
import { Download, FileUp, Layers, MoreHorizontal, Paintbrush, Pencil, Plus, Satellite, Shovel, Square, Star, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button as AriaButton, DropZone, FileTrigger } from 'react-aria-components'
import { useTranslation } from 'react-i18next'
import { api, errorMessage } from '#/lib/api'
import { fmt } from '#/lib/format'
import { useOrg } from '#/lib/org'
import { useOrgMutation, useOrgQuery } from '#/lib/queries'
import { Button, buttonClass } from '#/ui/Button'
import { Checkbox, Option, Select, TextField } from '#/ui/Field'
import { Badge, Card, Notice } from '#/ui/Layout'
import { Menu, MenuItem, MenuSeparator, MenuTrigger, ModalDialog } from '#/ui/Overlay'
import { Cell, Column, Row, Table, TableBody, TableHeader } from '#/ui/Table'
import { toast } from '#/ui/Toast'
import { cx } from '#/ui/utils'
import { baseLabel, EXPORT_FORMATS, exportMap, rateRange, sourceLabel, typeLabel } from './labels'
import { VraMapEditor } from './MapEditor'
import { ZoneBrushEditor, type BrushSource } from './ZoneBrushEditor'

const busy = (jobs: ZoningJob[] | undefined) => (jobs ?? []).some((j) => j.status === 'queued' || j.status === 'running')

/**
 * Application maps of a field (reference applicationMapsPage + SavedApplicationMapsAction):
 * the saved maps, and the base zonings they are made on — productivity, yield, soil, uploaded,
 * satellite, brush-edited and uniform — with a default ("Favorit") per field.
 */
export function ApplicationMaps({ field, openMapId, onOpened }: { field: Field; openMapId?: string; onOpened?: () => void }) {
  const { t } = useTranslation()
  const { orgId, can } = useOrg()
  const bases = useOrgQuery<VraBases>(`/fields/${field.id}/vra-bases`, undefined, { refetchInterval: (d) => (busy(d?.jobs) ? 5000 : false) })
  const maps = useOrgQuery<VraMapSummary[]>(`/fields/${field.id}/vra-maps`)
  const [editing, setEditing] = useState<{ map: VraMap | null; zoningId?: string | null; switchTo?: { zoningId: string; nonce: number } } | null>(null)
  /** Zonings saved from the brush editor for one map only (not listed as bases). */
  const [extra, setExtra] = useState<BaseZoning[]>([])
  const [brush, setBrush] = useState<BrushSource | null>(null)
  const [dialog, setDialog] = useState<'upload' | 'satellite' | null>(null)
  const [renaming, setRenaming] = useState<BaseZoning | null>(null)
  const write = can('field.write')
  const list = maps.data ?? []
  const zonings = bases.data?.zonings ?? []
  const path = `/fields/${field.id}/vra-bases`

  const removeMap = useOrgMutation((base, id: string) => api.delete(`${base}/fields/${field.id}/vra-maps/${id}`), { success: t('vra.deleted') })
  const fromSoil = useOrgMutation((base, _: void) => api.post<BaseZoning>(`${base}${path}/soil`, {}), { success: t('vra.base.created') })
  const uniform = useOrgMutation((base, _: void) => api.post<BaseZoning>(`${base}${path}/uniform`, {}), { success: t('vra.base.created') })
  const patch = useOrgMutation((base, v: { id: string; body: { name?: string | null; isDefault?: boolean } }) => api.patch<BaseZoning>(`${base}${path}/${v.id}`, v.body), {
    success: t('vra.base.updated'),
  })
  const removeBase = useOrgMutation((base, id: string) => api.delete(`${base}${path}/${id}`), { success: t('vra.base.deleted') })
  const removeJob = useOrgMutation((base, id: string) => api.delete(`${base}${path}/jobs/${id}`))

  const open = async (id: string) => {
    try {
      setEditing({ map: await api.get<VraMap>(`/orgs/${orgId}/fields/${field.id}/vra-maps/${id}`) })
    } catch {
      toast.error(t('vra.loadFailed'))
    }
  }
  useEffect(() => {
    if (!openMapId) return
    void open(openMapId)
    onOpened?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openMapId])
  const soil = bases.data?.soilZonation
  const canCreate = write && zonings.length > 0

  return (
    <div className="space-y-6">
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
          <p className="text-sm text-muted">{maps.isLoading ? t('common.loading') : zonings.length ? t('vra.empty') : t('vra.base.emptyHint')}</p>
        ) : (
          <Table aria-label={t('vra.tableLabel', { field: field.name })}>
            <TableHeader>
              <Column isRowHeader>{t('vra.columns.map')}</Column>
              <Column>{t('common.type')}</Column>
              <Column>{t('vra.base.label')}</Column>
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
                  <Cell align="end">
                    <MenuTrigger>
                      <AriaButton aria-label={t('vra.actionsFor', { title: m.title })} className={buttonClass('ghost', 'icon-sm')}>
                        <MoreHorizontal className="size-4" />
                      </AriaButton>
                      <Menu
                        onAction={(key) => {
                          if (key === 'edit') void open(m.id)
                          else if (key === 'delete') removeMap.mutate(m.id)
                          else void exportMap(orgId, field.id, m.id, key as VraExportFormat)
                        }}
                      >
                        <MenuItem id="edit">
                          <Pencil /> {write ? t('common.edit') : t('vra.view')}
                        </MenuItem>
                        <MenuSeparator />
                        {EXPORT_FORMATS.map((e) => (
                          <MenuItem key={e.id} id={e.id}>
                            <Download /> {t('vra.downloadFormat', { format: e.label })}
                          </MenuItem>
                        ))}
                        {write && (
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
      </Card>

      <Card
        title={t('vra.base.title')}
        description={t('vra.base.description')}
        padded={zonings.length === 0}
        actions={
          write && (
            <MenuTrigger>
              <Button size="sm">
                <Plus /> {t('vra.base.new')}
              </Button>
              <Menu
                onAction={(key) => {
                  if (key === 'soil') fromSoil.mutate()
                  else if (key === 'uniform') uniform.mutate()
                  else if (key === 'upload' || key === 'satellite') setDialog(key)
                  else if (key === 'draw') setBrush({ zoning: null, zones: [{ zoneNo: 1, relativeProductivity: 100, geometry: field.geometry }] })
                }}
              >
                <MenuItem id="soil" isDisabled={!soil || !!soil.copiedZoningId}>
                  <Shovel /> {soil ? t('vra.base.fromSoil', { count: soil.zoneCount }) : t('vra.base.noSoil')}
                </MenuItem>
                <MenuItem id="satellite">
                  <Satellite /> {t('vra.base.fromSatellite')}
                </MenuItem>
                <MenuItem id="upload">
                  <FileUp /> {t('vra.base.fromUpload')}
                </MenuItem>
                <MenuItem id="draw">
                  <Paintbrush /> {t('vra.base.draw')}
                </MenuItem>
                <MenuItem id="uniform">
                  <Square /> {t('vra.base.uniform')}
                </MenuItem>
              </Menu>
            </MenuTrigger>
          )
        }
      >
        {zonings.length === 0 ? (
          <div className="space-y-1">
            <p className="text-sm font-medium">{t('vra.base.emptyTitle')}</p>
            <p className="text-sm text-muted">{bases.isLoading ? t('common.loading') : t('vra.base.emptyBody')}</p>
          </div>
        ) : (
          <Table aria-label={t('vra.base.tableLabel', { field: field.name })}>
            <TableHeader>
              <Column isRowHeader>{t('vra.base.name')}</Column>
              <Column>{t('vra.base.source')}</Column>
              <Column align="end">{t('vra.columns.zones')}</Column>
              <Column align="end">{t('vra.base.maps')}</Column>
              <Column align="end">{t('vra.base.createdAt')}</Column>
              <Column align="end">
                <span className="sr-only">{t('common.actions')}</span>
              </Column>
            </TableHeader>
            <TableBody items={zonings}>
              {(z) => (
                <Row id={z.id}>
                  <Cell>
                    <span className="inline-flex items-center gap-1.5">
                      {z.isDefault && <Star className="size-3.5 fill-warning text-warning" aria-label={t('vra.base.isDefault')} />}
                      <span className="font-medium">{z.name ?? sourceLabel(z.source, z.params)}</span>
                    </span>
                    {!z.current && <span className="block text-xs text-warning">{t('vra.earlierBoundary')}</span>}
                  </Cell>
                  <Cell>{sourceLabel(z.source, z.params)}</Cell>
                  <Cell align="end">{z.zoneCount}</Cell>
                  <Cell align="end">{z.mapCount || '—'}</Cell>
                  <Cell align="end">{fmt.date(z.createdAt)}</Cell>
                  <Cell align="end">
                    <MenuTrigger>
                      <AriaButton aria-label={t('vra.base.actionsFor', { name: baseLabel(z) })} className={buttonClass('ghost', 'icon-sm')}>
                        <MoreHorizontal className="size-4" />
                      </AriaButton>
                      <Menu
                        onAction={(key) => {
                          if (key === 'map') setEditing({ map: null, zoningId: z.id })
                          else if (key === 'default') patch.mutate({ id: z.id, body: { isDefault: !z.isDefault } })
                          else if (key === 'rename') setRenaming(z)
                          else if (key === 'brush') setBrush({ zoning: z, zones: z.zones })
                          else if (key === 'delete') removeBase.mutate(z.id)
                        }}
                      >
                        {write && (
                          <MenuItem id="map">
                            <Layers /> {t('vra.base.newMap')}
                          </MenuItem>
                        )}
                        {write && (
                          <MenuItem id="default">
                            <Star /> {z.isDefault ? t('vra.base.unsetDefault') : t('vra.base.makeDefault')}
                          </MenuItem>
                        )}
                        {write && (
                          <MenuItem id="rename">
                            <Pencil /> {t('vra.base.rename')}
                          </MenuItem>
                        )}
                        {write && (
                          <MenuItem id="brush">
                            <Paintbrush /> {t('vra.brush.edit')}
                          </MenuItem>
                        )}
                        {write && isOwnBase(z.source) && (
                          <>
                            <MenuSeparator />
                            <MenuItem id="delete" danger isDisabled={z.mapCount > 0}>
                              <Trash2 /> {z.mapCount > 0 ? t('vra.base.inUse') : t('common.delete')}
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
        {(bases.data?.jobs.length ?? 0) > 0 && (
          <ul className="px-4 py-3 border-t border-line space-y-1.5 text-sm" aria-label={t('vra.base.jobs')}>
            {bases.data!.jobs.map((j) => (
              <li key={j.id} className="flex flex-wrap items-center gap-2">
                <Satellite className="size-4 text-muted" aria-hidden />
                <span>{j.name ?? sourceLabel('satellite', { index: j.indexType, sceneDates: j.sceneDates })}</span>
                <span className="text-muted">· {t('vra.base.zoneCount', { count: j.zoneCount })}</span>
                <Badge tone={j.status === 'ready' ? 'success' : j.status === 'failed' ? 'danger' : 'info'}>{t(`vra.job.${j.status}`)}</Badge>
                {j.status === 'failed' && j.statusCode && <span className="text-xs text-danger">{t(`vra.job.code.${j.statusCode}`, { defaultValue: j.statusCode })}</span>}
                {write && j.status !== 'running' && (
                  <Button size="icon-xs" variant="ghost" aria-label={t('vra.job.remove')} onPress={() => removeJob.mutate(j.id)}>
                    <Trash2 />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {editing && bases.data && (zonings.length > 0 || editing.map) && (
        <VraMapEditor
          field={field}
          bases={[...zonings, ...extra.filter((x) => !zonings.some((z) => z.id === x.id))]}
          map={editing.map}
          initialZoningId={editing.zoningId}
          switchTo={editing.switchTo}
          readOnly={!write}
          onClose={() => setEditing(null)}
          onEditZones={(zoningId, zones) => setBrush({ zoning: zonings.find((z) => z.id === zoningId) ?? null, zones })}
        />
      )}
      {brush && (
        <ZoneBrushEditor
          field={field}
          source={brush}
          onClose={() => setBrush(null)}
          onSaved={(zoning) => {
            setBrush(null)
            if (!zoning.listed) setExtra((e) => [...e, zoning])
            // Back in the map editor, the map now uses the edited zones.
            setEditing((e) => (e ? { ...e, switchTo: { zoningId: zoning.id, nonce: (e.switchTo?.nonce ?? 0) + 1 } } : e))
          }}
        />
      )}
      {dialog === 'upload' && <UploadBaseDialog fieldId={field.id} onClose={() => setDialog(null)} />}
      {dialog === 'satellite' && <SatelliteBaseDialog field={field} onClose={() => setDialog(null)} />}
      {renaming && (
        <RenameDialog
          zoning={renaming}
          onClose={() => setRenaming(null)}
          onSave={(name) => patch.mutate({ id: renaming.id, body: { name } }, { onSuccess: () => setRenaming(null) })}
        />
      )}
    </div>
  )
}

function RenameDialog({ zoning, onClose, onSave }: { zoning: BaseZoning; onClose: () => void; onSave: (name: string | null) => void }) {
  const { t } = useTranslation()
  const [name, setName] = useState(zoning.name ?? '')
  return (
    <ModalDialog
      isOpen
      onOpenChange={(o) => !o && onClose()}
      title={t('vra.base.rename')}
      footer={(close) => (
        <>
          <Button variant="ghost" onPress={close}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" onPress={() => onSave(name.trim() || null)}>
            {t('common.save')}
          </Button>
        </>
      )}
    >
      <TextField label={t('vra.base.name')} placeholder={sourceLabel(zoning.source, zoning.params)} value={name} onChange={setName} autoFocus />
    </ModalDialog>
  )
}

const ACCEPTED = ['.geojson', '.json', '.zip', 'application/geo+json', 'application/json', 'application/zip']

/** Uploads a zone file (reference UploadBaseZonationButton): GeoJSON, Shapefile ZIP or ISO-XML ZIP. */
function UploadBaseDialog({ fieldId, onClose }: { fieldId: string; onClose: () => void }) {
  const { t } = useTranslation()
  const { orgId } = useOrg()
  const [busyUpload, setBusy] = useState(false)
  const [result, setResult] = useState<UploadBaseResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const upload = useOrgMutation(async (_base, file: File) => {
    const form = new FormData()
    form.append('name', file.name)
    form.append('file', file)
    return api.upload<UploadBaseResult>(`/orgs/${orgId}/fields/${fieldId}/vra-bases/upload`, form)
  }, { silentError: true, onSuccess: setResult })
  const send = async (file: File) => {
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      await upload.mutateAsync(file)
    } catch (e) {
      setError(errorMessage(e))
    }
    setBusy(false)
  }
  return (
    <ModalDialog
      isOpen
      onOpenChange={(o) => !o && onClose()}
      title={t('vra.upload.title')}
      description={t('vra.upload.description')}
      footer={(close) => <Button onPress={close}>{result ? t('common.close') : t('common.cancel')}</Button>}
    >
      <div className="space-y-4">
        <DropZone
          className={({ isDropTarget }) => cx('rounded-xl border-2 border-dashed p-6 text-center', isDropTarget ? 'border-primary bg-primary/5' : 'border-line')}
          onDrop={async (e) => {
            const item = e.items.find((i) => i.kind === 'file')
            if (item && item.kind === 'file') void send(await item.getFile())
          }}
        >
          <FileUp className="size-7 text-muted mx-auto" aria-hidden />
          <p className="text-sm mt-2">{t('vra.upload.drop')}</p>
          <FileTrigger acceptedFileTypes={ACCEPTED} onSelect={(list) => list?.[0] && void send(list[0])}>
            <Button size="sm" className="mt-2" isPending={busyUpload}>
              {t('vra.upload.choose')}
            </Button>
          </FileTrigger>
          <p className="text-xs text-muted mt-3">{t('vra.upload.formats')}</p>
        </DropZone>
        {error && <Notice tone="danger">{error}</Notice>}
        {result && (
          <Notice tone={result.meanTarget === 0 || result.dropped > 0 ? 'warning' : 'success'}>
            {t('vra.upload.success', {
              count: result.zoning.zoneCount,
              target: result.targetKey === 'rate' ? (result.unit ?? t('vra.upload.rate')) : t(`vra.upload.target.${result.targetKey}`),
            })}
            {result.dropped > 0 && ` ${t('vra.upload.dropped', { count: result.dropped })}`}
            {result.meanTarget === 0 && ` ${t('vra.upload.allZero')}`}
            {result.meanTarget > 0 && ` ${t('vra.upload.mean', { value: fmt.num(result.meanTarget, 1), unit: result.unit ?? '' })}`}
          </Notice>
        )}
      </div>
    </ModalDialog>
  )
}

/**
 * Queues a satellite zoning (reference SatelliteSceneSelector + CreateBaseZonationModal): a
 * vegetation index, one scene or the median of up to five, the zone count and the method.
 */
function SatelliteBaseDialog({ field, onClose }: { field: Field; onClose: () => void }) {
  const { t } = useTranslation()
  const dates = useOrgQuery<ImageryDate[]>('/monitoring/imagery/dates', { fieldId: field.id })
  const [index, setIndex] = useState<(typeof SATELLITE_BASE_INDICES)[number]>('ndvi')
  const [picked, setPicked] = useState<string[]>([])
  const [zoneCount, setZoneCount] = useState(4)
  const [method, setMethod] = useState<(typeof SATELLITE_METHODS)[number]>('fcm')
  const [name, setName] = useState('')
  const clear = (dates.data ?? []).filter((d) => d.clearPct >= 50 && d.fieldIds.includes(field.id)).slice(0, 60)
  const queue = useOrgMutation(
    (base, _: void) => api.post<ZoningJob>(`${base}/fields/${field.id}/vra-bases/satellite`, { indexType: index, sceneDates: picked, zoneCount, method, name: name.trim() || null }),
    { success: t('vra.satellite.queued'), onSuccess: onClose },
  )
  const toggle = (date: string, on: boolean) => setPicked((p) => (on ? [...p, date].slice(0, MAX_SATELLITE_SCENES) : p.filter((d) => d !== date)))
  return (
    <ModalDialog
      isOpen
      onOpenChange={(o) => !o && onClose()}
      size="lg"
      title={t('vra.satellite.title')}
      description={t('vra.satellite.description', { field: field.name })}
      footer={(close) => (
        <>
          <Button variant="ghost" onPress={close}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" isDisabled={!picked.length} isPending={queue.isPending} onPress={() => queue.mutate()}>
            {t('vra.satellite.submit')}
          </Button>
        </>
      )}
    >
      <div className="space-y-4">
        <div className="grid sm:grid-cols-3 gap-3">
          <Select label={t('vra.satellite.index')} items={SATELLITE_BASE_INDICES.map((id) => ({ id, label: id.toUpperCase() }))} value={index} onChange={(v) => v && setIndex(v as typeof index)}>
            {(item) => <Option id={item.id}>{item.label}</Option>}
          </Select>
          <Select label={t('vra.satellite.zoneCount')} items={SATELLITE_ZONE_COUNTS.map((n) => ({ id: String(n), label: String(n) }))} value={String(zoneCount)} onChange={(v) => v && setZoneCount(Number(v))}>
            {(item) => <Option id={item.id}>{item.label}</Option>}
          </Select>
          <Select label={t('vra.satellite.method')} items={SATELLITE_METHODS.map((id) => ({ id, label: t(`vra.satellite.method.${id}`) }))} value={method} onChange={(v) => v && setMethod(v as typeof method)}>
            {(item) => <Option id={item.id}>{item.label}</Option>}
          </Select>
        </div>
        <div>
          <div className="flex items-baseline justify-between">
            <span className="text-sm font-medium">{t('vra.satellite.dates')}</span>
            <span className="text-xs text-muted">{t('vra.satellite.selected', { count: picked.length, max: MAX_SATELLITE_SCENES })}</span>
          </div>
          {dates.isLoading ? (
            <p className="text-sm text-muted">{t('common.loading')}</p>
          ) : clear.length === 0 ? (
            <Notice tone="info">{t('vra.satellite.noScenes')}</Notice>
          ) : (
            <ul className="mt-2 grid sm:grid-cols-2 gap-x-6 gap-y-1 max-h-64 overflow-y-auto">
              {clear.map((d) => (
                <li key={d.date}>
                  <Checkbox isSelected={picked.includes(d.date)} isDisabled={!picked.includes(d.date) && picked.length >= MAX_SATELLITE_SCENES} onChange={(on) => toggle(d.date, on)}>
                    <span className="tabular">{fmt.date(d.date)}</span>
                    <span className="text-muted tabular">
                      {' '}
                      · {fmt.pct(d.clearPct)} {t('vra.satellite.clear')}
                      {d.ndvi != null && ` · NDVI ${fmt.fixed(d.ndvi, 2)}`}
                    </span>
                  </Checkbox>
                </li>
              ))}
            </ul>
          )}
          {picked.length > 1 && <p className="text-xs text-muted mt-2">{t('vra.satellite.medianHint')}</p>}
        </div>
        <TextField label={t('vra.base.name')} placeholder={t('common.optional')} value={name} onChange={setName} />
        <p className="text-xs text-muted">{t('vra.satellite.hint')}</p>
      </div>
    </ModalDialog>
  )
}

