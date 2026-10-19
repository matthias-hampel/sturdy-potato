import {
  DEFAULT_RESULT_COLS,
  GRID_DEFAULT_CELL_HA,
  soilZoneColor,
  type FieldSoilZonation,
  type SamplingPlanInput,
  type SamplingPlanMode,
  type SamplingPlanPreview,
  type SaveZonesInput,
  type SoilParameter,
  type SoilZone,
  type UpdateZoneInput,
} from '@agmeo/contracts'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { Brush, Download, Grid3x3, Hand, PaintBucket, Pencil, Plus, Redo2, Satellite, Trash2, Undo2 } from 'lucide-react'
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BatchZonationDialog, PlanSettings } from '#/components/soil/BatchZonationDialog'
import { ExportDialog } from '#/components/soil/ExportDialog'
import { type LngLat, type MapTool, type MapZone, SoilZoneMap } from '#/components/soil/SoilZoneMap'
import { methodLabel, NO_DATA_COLOR, paramLabel, paramValue, sourceLabel, STAGE_COLORS, statusText } from '#/components/soil/soilLabels'
import { areaHa, brushSizesForArea, type EditZone, EMPTY, fillAt, History, nonEmpty, paint, strokeBrush } from '#/components/soil/zoneEdit'
import { api } from '#/lib/api'
import { fmt, today } from '#/lib/format'
import { useOrg } from '#/lib/org'
import { useOrgMutation, useOrgQuery } from '#/lib/queries'
import { Button, Link, SegmentedControl } from '#/ui/Button'
import { DatePicker, NumberField, TextField, num } from '#/ui/Field'
import { Badge, Card, EmptyState, ErrorNotice, Loading, Notice, PageHeader } from '#/ui/Layout'
import { ConfirmButton, ModalDialog } from '#/ui/Overlay'
import { Cell, Column, Row, Table, TableBody, TableHeader } from '#/ui/Table'
import { cx } from '#/ui/utils'

export const Route = createFileRoute('/o/$orgId/soil/$fieldId')({
  component: SoilFieldPage,
})

type Mode = 'view' | 'plan' | 'edit'
type ColorBy = 'zones' | 'ph' | 'p' | 'k' | 'mg'

function SoilFieldPage() {
  const { t } = useTranslation()
  const { orgId, can } = useOrg()
  const { fieldId } = Route.useParams()
  const data = useOrgQuery<FieldSoilZonation>(`/fields/${fieldId}/soil`, undefined, {
    refetchInterval: (d) => (d?.pending.some((p) => p.status === 'queued' || p.status === 'running') ? 3_000 : false),
  })
  const [mode, setMode] = useState<Mode>('view')
  const [zonationOpen, setZonationOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const remove = useOrgMutation((base, _: void) => api.delete(`${base}/fields/${fieldId}/soil/zonation`), { success: t('soil.batch.deleted') })

  if (data.isLoading) return <Loading />
  if (data.error) return <ErrorNotice error={data.error} />
  const d = data.data!
  const writable = can('field.write')
  const pending = d.pending[0]

  return (
    <>
      <PageHeader
        eyebrow={
          <Link to="/o/$orgId/soil" params={{ orgId }}>
            {t('soil.page.title')}
          </Link>
        }
        title={d.field.name}
        subtitle={
          d.zonation
            ? `${fmt.ha(d.field.areaHa)} · ${methodLabel(d.zonation.method)} · ${sourceLabel(d.zonation.source)} · ${t('soil.batch.successZones', { count: d.zonation.zones.length })}`
            : fmt.ha(d.field.areaHa)
        }
        actions={
          writable &&
          mode === 'view' && (
            <div className="flex flex-wrap gap-2">
              <Button onPress={() => setZonationOpen(true)}>
                <Satellite /> {t('soil.field.computeZones')}
              </Button>
              <Button onPress={() => setMode('plan')}>
                <Grid3x3 /> {t('soil.field.plan')}
              </Button>
              <Button onPress={() => setMode('edit')}>
                <Brush /> {t('soil.field.editZones')}
              </Button>
              {d.zonation && (
                <Button onPress={() => setExportOpen(true)}>
                  <Download /> {t('soil.export.run')}
                </Button>
              )}
              {d.zonation && (
                <ConfirmButton
                  title={t('soil.field.removeTitle')}
                  message={t('soil.field.removeMessage')}
                  confirmLabel={t('common.delete')}
                  onConfirm={() => remove.mutateAsync()}
                  trigger={
                    <Button variant="ghost" aria-label={t('soil.field.remove')}>
                      <Trash2 />
                    </Button>
                  }
                />
              )}
            </div>
          )
        }
      />
      {pending && (
        <Notice tone={pending.status === 'failed' ? 'danger' : 'info'} className="mb-4">
          {pending.status === 'failed'
            ? t('soil.field.runFailed', { reason: statusText(pending.statusCode) })
            : t('soil.field.running', { method: methodLabel(pending.method), source: sourceLabel(pending.source) })}
        </Notice>
      )}
      {mode === 'view' && <ViewMode data={d} writable={writable} />}
      {mode === 'plan' && <PlanMode data={d} onDone={() => setMode('view')} />}
      {mode === 'edit' && <EditMode data={d} onDone={() => setMode('view')} />}
      <ExportDialog isOpen={exportOpen} onOpenChange={setExportOpen} fieldIds={[d.field.id]} />
      <BatchZonationDialog
        isOpen={zonationOpen}
        onOpenChange={setZonationOpen}
        fields={[{ fieldId: d.field.id, fieldName: d.field.name, areaHa: d.field.areaHa, hasZonation: !!d.zonation }]}
      />
    </>
  )
}

const zoneLabel = (z: SoilZone) => (z.probeNr != null ? String(z.probeNr) : z.label)

function classColor(z: SoilZone, by: ColorBy) {
  if (by === 'zones') return z.color
  const cls = z.classes[by]
  return cls ? STAGE_COLORS[cls] : NO_DATA_COLOR
}

function Layout({ map, side }: { map: ReactNode; side: ReactNode }) {
  return (
    <div className="grid lg:grid-cols-[minmax(0,1.6fr)_minmax(320px,1fr)] gap-4 items-start">
      {map}
      <div className="space-y-4 min-w-0">{side}</div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// View: zones, values and probe numbers
// ---------------------------------------------------------------------------

function ViewMode({ data, writable }: { data: FieldSoilZonation; writable: boolean }) {
  const { t } = useTranslation()
  const [selected, setSelected] = useState<string | null>(null)
  const [colorBy, setColorBy] = useState<ColorBy>('zones')
  const [editing, setEditing] = useState<SoilZone | null>(null)
  const zones = data.zonation?.zones ?? []
  const mapZones = useMemo<MapZone[]>(
    () => zones.map((z) => ({ key: z.id, geometry: z.geometry, color: classColor(z, colorBy), label: zoneLabel(z), point: z.samplePoint })),
    [zones, colorBy],
  )
  const params = DEFAULT_RESULT_COLS.filter((p) => zones.some((z) => z.values[p] != null))

  return (
    <Layout
      map={
        <div className="space-y-2">
          <SoilZoneMap boundary={data.field.geometry} zones={mapZones} selectedKey={selected} onSelect={setSelected} className="h-[560px]" />
          <div className="flex flex-wrap items-center gap-3">
            <SegmentedControl
              aria-label={t('soil.share.page.colouring')}
              value={colorBy}
              onChange={setColorBy}
              items={[
                { id: 'zones', label: t('soil.field.colorZones') },
                { id: 'ph', label: paramLabel('ph') },
                { id: 'p', label: 'P' },
                { id: 'k', label: 'K' },
                { id: 'mg', label: 'Mg' },
              ]}
            />
            {colorBy !== 'zones' && (
              <div className="flex items-center gap-2 text-xs text-muted">
                {Object.entries(STAGE_COLORS).map(([stage, color]) => (
                  <span key={stage} className="inline-flex items-center gap-1">
                    <span className="size-3 rounded-sm" style={{ background: color }} /> {stage}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      }
      side={
        zones.length ? (
          <Card title={t('soil.field.zones')} padded={false}>
            <Table aria-label={t('soil.field.zones')} selectionMode="single" selectedKeys={selected ? [selected] : []} onSelectionChange={(keys) => setSelected(keys === 'all' ? null : (([...keys][0] as string) ?? null))} onRowAction={writable ? (key) => setEditing(zones.find((z) => z.id === key) ?? null) : undefined}>
              <TableHeader>
                <Column isRowHeader>{t('soil.field.zone')}</Column>
                <Column align="end">{t('soil.export.zonationPdf.probe')}</Column>
                <Column align="end">{t('soil.batch.fields.area')}</Column>
                {params.map((p) => (
                  <Column key={p} align="end">
                    {paramLabel(p)}
                  </Column>
                ))}
              </TableHeader>
              <TableBody items={zones}>
                {(z) => (
                  <Row id={z.id}>
                    <Cell>
                      <span className="inline-flex items-center gap-2">
                        <span className="size-3 rounded-sm shrink-0" style={{ background: z.color }} />
                        {z.label}
                      </span>
                    </Cell>
                    <Cell align="end">{z.probeNr ?? '—'}</Cell>
                    <Cell align="end">{fmt.ha(z.areaHa)}</Cell>
                    {params.map((p) => (
                      <Cell key={p} align="end">
                        {paramValue(p, z.values[p])}
                      </Cell>
                    ))}
                  </Row>
                )}
              </TableBody>
            </Table>
            {writable && <p className="px-4 py-2 text-xs text-muted">{t('soil.field.editHint')}</p>}
            <ZoneDialog zone={editing} onClose={() => setEditing(null)} />
          </Card>
        ) : (
          <Card>
            <EmptyState title={t('soil.field.empty.title')}>{t('soil.field.empty.body')}</EmptyState>
          </Card>
        )
      }
    />
  )
}

const EDITABLE_PARAMS: SoilParameter[] = ['ph', 'p2o5', 'k2o', 'mgo', 'humus', 'nmin']

function ZoneDialog({ zone, onClose }: { zone: SoilZone | null; onClose: () => void }) {
  const { t } = useTranslation()
  const [label, setLabel] = useState('')
  const [probeNr, setProbeNr] = useState<number | null>(null)
  const [values, setValues] = useState<Partial<Record<SoilParameter, number | null>>>({})
  const [sampledOn, setSampledOn] = useState(today())
  useEffect(() => {
    if (!zone) return
    setLabel(zone.label)
    setProbeNr(zone.probeNr)
    setValues(Object.fromEntries(EDITABLE_PARAMS.map((p) => [p, zone.values[p] ?? null])))
    setSampledOn(Object.values(zone.dates)[0] ?? today())
  }, [zone])
  const save = useOrgMutation((base, input: UpdateZoneInput) => api.patch(`${base}/soil/zones/${zone!.id}`, input), { success: t('soil.field.zoneSaved'), onSuccess: onClose })
  const changed = Object.fromEntries(Object.entries(values).filter(([p, v]) => (zone?.values[p as SoilParameter] ?? null) !== v))
  return (
    <ModalDialog
      isOpen={!!zone}
      onOpenChange={(open) => !open && onClose()}
      title={zone?.label ?? ''}
      footer={(close) => (
        <>
          <Button onPress={close}>{t('common.cancel')}</Button>
          <Button variant="primary" isPending={save.isPending} onPress={() => save.mutate({ label, probeNr, values: Object.keys(changed).length ? changed : undefined, sampledOn })}>
            {t('common.save')}
          </Button>
        </>
      )}
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <TextField label={t('soil.field.zoneLabel')} value={label} onChange={setLabel} />
          <NumberField label={t('soil.export.zonationPdf.probe')} minValue={1} value={probeNr ?? NaN} onChange={(v) => setProbeNr(num(v))} formatOptions={{ useGrouping: false }} />
        </div>
        <DatePicker label={t('soil.editModal.date')} value={sampledOn} onChange={(v) => v && setSampledOn(v)} />
        <div className="grid grid-cols-3 gap-3">
          {EDITABLE_PARAMS.map((p) => (
            <NumberField
              key={p}
              label={paramLabel(p)}
              minValue={0}
              formatOptions={{ maximumFractionDigits: 2 }}
              value={values[p] ?? NaN}
              onChange={(v) => setValues((s) => ({ ...s, [p]: num(v) }))}
            />
          ))}
        </div>
      </div>
    </ModalDialog>
  )
}

// ---------------------------------------------------------------------------
// Plan: grid, Voronoi or productivity zones
// ---------------------------------------------------------------------------

function PlanMode({ data, onDone }: { data: FieldSoilZonation; onDone: () => void }) {
  const { t } = useTranslation()
  const { orgId } = useOrg()
  const [mode, setMode] = useState<SamplingPlanMode>('grid')
  const [cellHa, setCellHa] = useState(GRID_DEFAULT_CELL_HA)
  const [axis, setAxis] = useState<[LngLat, LngLat] | null>(null)
  const [axisDraft, setAxisDraft] = useState<LngLat | null>(null)
  const [arming, setArming] = useState(false)
  const [points, setPoints] = useState<LngLat[] | null>(null)
  const [editPoints, setEditPoints] = useState(false)
  const input: SamplingPlanInput = { mode, cellHa, axis, points: mode === 'voronoi' ? points : null }
  const preview = useQuery({
    queryKey: ['org', orgId, 'soil-plan-preview', data.field.id, input],
    queryFn: () => api.post<SamplingPlanPreview>(`/orgs/${orgId}/fields/${data.field.id}/soil/plan/preview`, input),
    placeholderData: (prev) => prev,
    staleTime: 60_000,
  })
  const create = useOrgMutation((base, _: void) => api.post(`${base}/fields/${data.field.id}/soil/plan`, input), { success: t('soil.plan.created'), onSuccess: onDone })
  const p = preview.data
  const zones = useMemo<MapZone[]>(
    () => (p?.zones ?? []).map((z, i) => ({ key: String(i), geometry: z.geometry, color: soilZoneColor(i), label: String(i + 1), point: z.samplePoint })),
    [p],
  )
  const tool: MapTool = arming ? 'axis' : editPoints && mode === 'voronoi' ? 'points' : 'select'

  return (
    <Layout
      map={
        <SoilZoneMap
          boundary={data.field.geometry}
          zones={[]}
          preview={zones}
          lines={p?.lines}
          axis={axis ?? (axisDraft ? [axisDraft, axisDraft] : null)}
          points={mode === 'voronoi' && editPoints ? (points ?? p?.points ?? []) : undefined}
          tool={tool}
          onAxisPoint={(at) => {
            if (!axisDraft) setAxisDraft(at)
            else {
              setAxis([axisDraft, at])
              setAxisDraft(null)
              setArming(false)
            }
          }}
          onPointsChange={setPoints}
          className="h-[560px]"
        />
      }
      side={
        <Card title={t('soil.field.plan')}>
          <div className="space-y-4">
            <PlanSettings mode={mode} onMode={setMode} cellHa={cellHa} onCellHa={(v) => (setCellHa(v), setPoints(null))} />
            {mode !== 'zones' && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-fg mr-auto">{t('soil.plan.axis')}</span>
                <Button size="sm" variant={arming ? 'primary' : 'secondary'} onPress={() => (setArming((a) => !a), setAxisDraft(null))}>
                  {t('soil.plan.axisSet')}
                </Button>
                <Button size="sm" isDisabled={!axis} onPress={() => setAxis(null)}>
                  {t('soil.plan.axisReset')}
                </Button>
              </div>
            )}
            {arming && <p className="text-xs text-muted">{t('soil.plan.axisHint')}</p>}
            {mode === 'voronoi' && (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-fg mr-auto">{t('soil.plan.points', { count: (points ?? p?.points ?? []).length })}</span>
                  <Button size="sm" variant={editPoints ? 'primary' : 'secondary'} onPress={() => setEditPoints((e) => !e)}>
                    {t('soil.plan.pointsEdit')}
                  </Button>
                  <Button size="sm" isDisabled={!points} onPress={() => setPoints(null)}>
                    {t('soil.plan.pointsReset')}
                  </Button>
                </div>
                {editPoints && <p className="text-xs text-muted">{t('soil.plan.pointsHint')}</p>}
              </div>
            )}
            {p?.tooMany && <Notice tone="warning">{t('soil.plan.tooMany')}</Notice>}
            {preview.error && <ErrorNotice error={preview.error} />}
            {data.zonation && <Notice tone="warning">{t('soil.plan.replaceHint')}</Notice>}
            <div className="flex justify-end gap-2">
              <Button onPress={onDone}>{t('common.cancel')}</Button>
              <Button variant="primary" isDisabled={!zones.length} isPending={create.isPending} onPress={() => create.mutate()}>
                {t('soil.plan.createZones', { count: zones.length })}
              </Button>
            </div>
          </div>
        </Card>
      }
    />
  )
}

// ---------------------------------------------------------------------------
// Edit: brush, fill, pencil, undo
// ---------------------------------------------------------------------------

type EditTool = 'select' | 'brush' | 'fill' | 'pencil'

function EditMode({ data, onDone }: { data: FieldSoilZonation; onDone: () => void }) {
  const { t } = useTranslation()
  const initial = useMemo<EditZone[]>(
    () => (data.zonation?.zones ?? []).map((z) => ({ key: z.id, id: z.id, label: z.label, color: z.color, geometry: z.geometry })),
    [data.zonation],
  )
  const [zones, setZones] = useState<EditZone[]>(() =>
    initial.length ? initial : [{ key: 'new:1', id: null, label: 'Zone 1', color: soilZoneColor(0), geometry: data.field.geometry }],
  )
  const [selected, setSelected] = useState<string | null>(zones[0]?.key ?? null)
  const [tool, setTool] = useState<EditTool>('brush')
  const { sizes, defaultSize } = useMemo(() => brushSizesForArea(data.field.areaHa), [data.field.areaHa])
  const [brush, setBrush] = useState(defaultSize)
  const history = useRef(new History<EditZone[]>())
  const [, rerender] = useState(0)
  const zonesRef = useRef(zones)
  zonesRef.current = zones

  const commit = (next: EditZone[], snapshot = true) => {
    if (snapshot) history.current.push(zonesRef.current)
    setZones(next)
    rerender((n) => n + 1)
  }
  const save = useOrgMutation((base, input: SaveZonesInput) => api.put(`${base}/fields/${data.field.id}/soil/zones`, input), { success: t('soil.editor.saved'), onSuccess: onDone })

  const mapZones = useMemo<MapZone[]>(() => zones.map((z) => ({ key: z.key, geometry: z.geometry, color: z.color, label: z.label })), [zones])
  const addZone = () => {
    const n = zones.length + 1
    const key = `new:${Date.now()}`
    commit([...zones, { key, id: null, label: `Zone ${n}`, color: soilZoneColor(n - 1), geometry: EMPTY }])
    setSelected(key)
  }
  const undo = () => {
    const prev = history.current.undo(zones)
    if (prev) (setZones(prev), rerender((n) => n + 1))
  }
  const redo = () => {
    const next = history.current.redo(zones)
    if (next) (setZones(next), rerender((n) => n + 1))
  }
  const toolButtons: { id: EditTool; icon: ReactNode; label: string }[] = [
    { id: 'select', icon: <Hand />, label: t('soil.editor.tool.select') },
    { id: 'brush', icon: <Brush />, label: t('soil.editor.tool.brush') },
    { id: 'fill', icon: <PaintBucket />, label: t('soil.editor.tool.fill') },
    { id: 'pencil', icon: <Pencil />, label: t('soil.editor.tool.pencil') },
  ]

  return (
    <Layout
      map={
        <SoilZoneMap
          boundary={data.field.geometry}
          zones={mapZones}
          selectedKey={selected}
          tool={tool}
          brushSizeM={brush}
          fillOpacity={0.7}
          onSelect={setSelected}
          onBrush={(from, to, start) => {
            if (!selected) return
            const base = zonesRef.current
            const next = strokeBrush(from, to, brush).reduce((acc, square) => paint(acc, selected, square, data.field.geometry), base)
            commit(next, start)
          }}
          onFill={(at) => selected && commit(fillAt(zonesRef.current, selected, at))}
          onPolygon={(polygon) => selected && commit(paint(zonesRef.current, selected, polygon, data.field.geometry))}
          className="h-[560px]"
        />
      }
      side={
        <Card title={t('soil.field.editZones')}>
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-1">
              {toolButtons.map((b) => (
                <Button key={b.id} size="sm" variant={tool === b.id ? 'primary' : 'secondary'} onPress={() => setTool(b.id)} aria-label={b.label}>
                  {b.icon} {b.label}
                </Button>
              ))}
            </div>
            {tool === 'brush' && (
              <div className="flex flex-wrap items-center gap-1">
                <span className="text-xs text-muted mr-1">{t('soil.editor.brushSize')}</span>
                {sizes.map((s) => (
                  <Button key={s} size="sm" variant={brush === s ? 'primary' : 'quiet'} onPress={() => setBrush(s)}>
                    {s} m
                  </Button>
                ))}
              </div>
            )}
            <p className="text-xs text-muted">{t(`soil.editor.hint.${tool}`)}</p>
            <ul className="space-y-1">
              {zones.map((z) => (
                <li key={z.key}>
                  <div
                    className={cx('flex items-center gap-2 rounded-lg border px-2 py-1.5', z.key === selected ? 'border-primary bg-primary-soft' : 'border-line')}
                    onClick={() => setSelected(z.key)}
                  >
                    <span className="size-4 rounded-sm shrink-0" style={{ background: z.color }} />
                    <TextField aria-label={t('soil.field.zoneLabel')} className="flex-1" value={z.label} onChange={(v) => setZones((all) => all.map((x) => (x.key === z.key ? { ...x, label: v } : x)))} />
                    <span className="text-xs text-muted tabular w-16 text-right">{fmt.ha(areaHa(z.geometry))}</span>
                  </div>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onPress={addZone}>
                <Plus /> {t('soil.editor.addZone')}
              </Button>
              <Button size="sm" isDisabled={!history.current.canUndo} onPress={undo} aria-label={t('soil.editor.undo')}>
                <Undo2 /> {t('soil.editor.undo')}
              </Button>
              <Button size="sm" isDisabled={!history.current.canRedo} onPress={redo} aria-label={t('soil.editor.redo')}>
                <Redo2 /> {t('soil.editor.redo')}
              </Button>
            </div>
            {zones.length !== nonEmpty(zones).length && <Notice tone="info">{t('soil.editor.emptyDropped')}</Notice>}
            <div className="flex justify-end gap-2">
              <Button onPress={onDone}>{t('common.cancel')}</Button>
              <Button
                variant="primary"
                isDisabled={!nonEmpty(zones).length}
                isPending={save.isPending}
                onPress={() => save.mutate({ zones: nonEmpty(zones).map((z) => ({ id: z.id, label: z.label, color: z.color, geometry: z.geometry as SaveZonesInput['zones'][number]['geometry'] })) })}
              >
                {t('common.save')}
              </Button>
            </div>
            <Badge tone="neutral">{t('soil.editor.zoneCount', { count: nonEmpty(zones).length })}</Badge>
          </div>
        </Card>
      }
    />
  )
}

