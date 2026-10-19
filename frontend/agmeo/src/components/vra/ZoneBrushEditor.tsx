import { isOwnBase, relativeColor, type BaseZoning, type Field } from '@agmeo/contracts'
import type { MultiPolygon } from 'geojson'
import { Combine, Plus, Redo2, Scale, Undo2 } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '#/lib/api'
import { fmt } from '#/lib/format'
import { useOrgMutation } from '#/lib/queries'
import { Button, SegmentedControl } from '#/ui/Button'
import { Checkbox, NumberField, Option, Select, TextField } from '#/ui/Field'
import { Notice } from '#/ui/Layout'
import { ModalDialog } from '#/ui/Overlay'
import { cx } from '#/ui/utils'
import { SoilZoneMap, type LngLat, type MapTool } from '../soil/SoilZoneMap'
import { areaHa, brushSizesForArea, EMPTY, fillAt, History, nonEmpty, paint, strokeBrush, type EditZone } from '../soil/zoneEdit'

interface Zone extends EditZone {
  /** Relative yield, % of the field mean. */
  relative: number | null
}

export interface BrushSource {
  /** The zoning the zones come from (replaced on "update" when it is an own, unused zoning). */
  zoning: Pick<BaseZoning, 'id' | 'source' | 'name' | 'mapCount'> | null
  zones: { zoneNo: number; relativeProductivity: number | null; geometry?: MultiPolygon }[]
}

let seq = 0
const key = () => `z${++seq}`

/** Area-weighted mean of the relative yields set to 100 % (reference normalizeZoneYields). */
function normalize(zones: Zone[]): Zone[] {
  const rated = zones.filter((z) => z.relative != null)
  const area = rated.reduce((s, z) => s + areaHa(z.geometry), 0)
  const mean = area > 0 ? rated.reduce((s, z) => s + z.relative! * areaHa(z.geometry), 0) / area : 100
  return mean > 0 ? zones.map((z) => (z.relative == null ? z : { ...z, relative: Math.round((z.relative * 10_000) / mean) / 100 })) : zones
}

/**
 * Brush editor of application-map zones (reference AppMapsEdit): paint with a square brush,
 * fill a connected part, draw a polygon into the selected zone, merge zones, add zones, set
 * their relative yield, undo and redo. The result is saved as a new zoning ("manual") or
 * replaces an own zoning no map is made on.
 */
export function ZoneBrushEditor({ field, source, onSaved, onClose }: { field: Field; source: BrushSource; onSaved: (zoning: BaseZoning) => void; onClose: () => void }) {
  const { t } = useTranslation()
  const boundary = field.geometry
  const [zones, setZones] = useState<Zone[]>(() =>
    source.zones.map((z) => ({ key: key(), id: null, label: `Zone ${z.zoneNo}`, color: '', geometry: z.geometry ?? EMPTY, relative: z.relativeProductivity })),
  )
  const [selected, setSelected] = useState<string | null>(zones[0]?.key ?? null)
  const [tool, setTool] = useState<MapTool>('brush')
  const { sizes, defaultSize } = useMemo(() => brushSizesForArea(field.areaHa), [field.areaHa])
  const [brush, setBrush] = useState(defaultSize)
  const [name, setName] = useState(source.zoning?.name ?? '')
  const [listed, setListed] = useState(true)
  const history = useRef(new History<Zone[]>())
  const [, bump] = useState(0)

  const commit = (next: Zone[]) => {
    history.current.push(zones)
    setZones(next)
    bump((n) => n + 1)
  }
  const step = (dir: 'undo' | 'redo') => {
    const prev = dir === 'undo' ? history.current.undo(zones) : history.current.redo(zones)
    if (prev) setZones(prev)
    bump((n) => n + 1)
  }

  const onBrush = (from: LngLat, to: LngLat, start: boolean) => {
    if (!selected) return
    if (start) {
      history.current.push(zones)
      bump((n) => n + 1)
    }
    setZones((current) => strokeBrush(from, to, brush).reduce((acc, square) => paint(acc, selected, square, boundary) as Zone[], current))
  }
  const onFill = (at: LngLat) => selected && commit(fillAt(zones, selected, at) as Zone[])
  const onPolygon = (polygon: import('geojson').Polygon) => selected && commit(paint(zones, selected, polygon, boundary) as Zone[])

  const merge = (from: string) => {
    if (!selected || from === selected) return
    const zone = zones.find((z) => z.key === from)
    if (!zone) return
    const painted = zone.geometry.coordinates.length ? (paint(zones, selected, zone.geometry, boundary) as Zone[]) : zones
    commit(painted.filter((z) => z.key !== from))
  }
  const addZone = () => {
    const z: Zone = { key: key(), id: null, label: '', color: '', geometry: EMPTY, relative: 100 }
    commit([...zones, z])
    setSelected(z.key)
    if (tool === 'select' || tool === 'fill') setTool('brush')
  }

  const kept = nonEmpty(zones) as Zone[]
  const canReplace = !!source.zoning && isOwnBase(source.zoning.source) && source.zoning.mapCount === 0
  const save = useOrgMutation(
    (base, replace: boolean) =>
      api.post<BaseZoning>(`${base}/fields/${field.id}/vra-bases/manual`, {
        name: name.trim() || null,
        listed,
        baseZoningId: source.zoning?.id ?? null,
        replaceId: replace ? source.zoning!.id : null,
        zones: kept.map((z) => ({ geometry: z.geometry, relativeProductivity: z.relative })),
      }),
    { success: t('vra.brush.saved'), onSuccess: onSaved },
  )

  const mapZones = zones.map((z) => ({ key: z.key, geometry: z.geometry, color: relativeColor(z.relative), label: undefined }))

  return (
    <ModalDialog
      isOpen
      onOpenChange={(o) => !o && onClose()}
      isDismissable={false}
      size="xl"
      title={t('vra.brush.title')}
      description={t('vra.brush.description', { field: field.name })}
      footer={(close) => (
        <>
          <Button variant="ghost" onPress={close}>
            {t('common.cancel')}
          </Button>
          <div className="flex-1" />
          {canReplace && (
            <Button isDisabled={!kept.length} isPending={save.isPending && save.variables} onPress={() => save.mutate(true)}>
              {t('vra.brush.update')}
            </Button>
          )}
          <Button variant="primary" isDisabled={!kept.length} isPending={save.isPending && !save.variables} onPress={() => save.mutate(false)}>
            {canReplace ? t('vra.brush.saveAsNew') : t('vra.brush.save')}
          </Button>
        </>
      )}
    >
      <div className="grid lg:grid-cols-[20rem_minmax(0,1fr)] gap-4">
        <div className="space-y-3 min-w-0">
          <SegmentedControl
            aria-label={t('vra.brush.tools')}
            value={tool}
            onChange={(v) => setTool(v as MapTool)}
            items={[
              { id: 'brush', label: t('vra.brush.tool.brush') },
              { id: 'fill', label: t('vra.brush.tool.fill') },
              { id: 'pencil', label: t('vra.brush.tool.pencil') },
              { id: 'select', label: t('vra.brush.tool.select') },
            ]}
          />
          <div className="flex items-end gap-2">
            <Select label={t('vra.brush.size')} items={sizes.map((s) => ({ id: String(s), label: `${s} m` }))} value={String(brush)} onChange={(v) => v && setBrush(Number(v))} className="flex-1">
              {(item) => <Option id={item.id}>{item.label}</Option>}
            </Select>
            <Button size="icon" aria-label={t('vra.brush.undo')} isDisabled={!history.current.canUndo} onPress={() => step('undo')}>
              <Undo2 />
            </Button>
            <Button size="icon" aria-label={t('vra.brush.redo')} isDisabled={!history.current.canRedo} onPress={() => step('redo')}>
              <Redo2 />
            </Button>
          </div>
          <p className="text-xs text-muted">{t(`vra.brush.hint.${tool === 'axis' || tool === 'points' ? 'select' : tool}`)}</p>
          <ul className="space-y-1.5 max-h-80 overflow-y-auto pr-1" aria-label={t('vra.brush.zones')}>
            {zones.map((z, i) => (
              <li
                key={z.key}
                className={cx('flex items-center gap-2 rounded-lg border px-2 py-1.5', z.key === selected ? 'border-primary bg-primary/5' : 'border-line')}
              >
                <button type="button" className="flex items-center gap-2 flex-1 min-w-0 text-left text-sm" onClick={() => setSelected(z.key)} aria-pressed={z.key === selected}>
                  <span className="size-3.5 rounded-sm ring-1 ring-black/10 shrink-0" style={{ background: relativeColor(z.relative) }} aria-hidden />
                  <span className="font-medium">{t('vra.brush.zoneN', { number: i + 1 })}</span>
                  <span className="text-muted tabular truncate">{fmt.ha(areaHa(z.geometry))}</span>
                </button>
                <NumberField
                  aria-label={t('vra.brush.relativeOf', { number: i + 1 })}
                  className="w-24"
                  unit="%"
                  minValue={1}
                  maxValue={1000}
                  value={z.relative ?? Number.NaN}
                  onChange={(v) => setZones((all) => all.map((x) => (x.key === z.key ? { ...x, relative: Number.isNaN(v) ? null : v } : x)))}
                />
                <Button size="icon-sm" variant="ghost" aria-label={t('vra.brush.mergeInto', { number: i + 1 })} isDisabled={!selected || z.key === selected} onPress={() => merge(z.key)}>
                  <Combine />
                </Button>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onPress={addZone} isDisabled={zones.length >= 50}>
              <Plus /> {t('vra.brush.addZone')}
            </Button>
            <Button size="sm" onPress={() => commit(normalize(zones))}>
              <Scale /> {t('vra.brush.normalize')}
            </Button>
          </div>
          <p className="text-xs text-muted">{t('vra.brush.normalizeHint')}</p>
          <TextField label={t('vra.brush.name')} placeholder={t('vra.brush.namePlaceholder')} value={name} onChange={setName} />
          <Checkbox isSelected={listed} onChange={setListed}>
            {t('vra.brush.listed')}
          </Checkbox>
          {zones.length > kept.length && <Notice tone="info">{t('vra.brush.emptyDropped', { count: zones.length - kept.length })}</Notice>}
        </div>
        <SoilZoneMap
          boundary={boundary}
          zones={mapZones}
          selectedKey={selected}
          tool={tool}
          brushSizeM={brush}
          onSelect={(k) => k && setSelected(k)}
          onBrush={onBrush}
          onFill={onFill}
          onPolygon={onPolygon}
          className="h-[28rem]"
        />
      </div>
    </ModalDialog>
  )
}
