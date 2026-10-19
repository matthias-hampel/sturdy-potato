import type { CalendarRow, Crop, CropCalendarYears, CropCycle, CultivationTemplate } from '@agmeo/contracts'
import { useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, Palette, Plus, Save, Undo2 } from 'lucide-react'
import { type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CycleFields, EMPTY_CYCLE_FORM, EditCycleDialog, seedPayload, useVarietyResolver, type CycleForm } from '#/components/crops/CycleDialogs'
import { LOCALE } from '#/i18n'
import { api, errorMessage } from '#/lib/api'
import { fmt } from '#/lib/format'
import { useOrg } from '#/lib/org'
import { useOrgMutation, useOrgQuery } from '#/lib/queries'
import { Button } from '#/ui/Button'
import { Option, Select, num } from '#/ui/Field'
import { EmptyState, ErrorNotice, Loading } from '#/ui/Layout'
import { ModalDialog } from '#/ui/Overlay'
import { toast } from '#/ui/Toast'
import { cx } from '#/ui/utils'

const PX_PER_MONTH = 44
const LANE_PX = 30
const LABEL_PX = 200
const DAY = 86_400_000
const PX_PER_DAY = (PX_PER_MONTH * 12) / 365.25
const MIN_BAR_PX = 20

const utc = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10))
const isoOf = (ms: number) => new Date(ms).toISOString().slice(0, 10)
const addDaysIso = (iso: string, n: number) => isoOf(utc(iso) + n * DAY)

interface Bar {
  row: CalendarRow
  start: string
  end: string
  lane: number
}

type Edit = { sowingDate: string; expectedHarvestDate: string }

/** Bars of one field placed in lanes so overlapping crops (catch crops, undersown) stack. */
function laneOut(rows: CalendarRow[], edits: Record<string, Edit>): Bar[] {
  const bars = rows
    .map((row) => {
      const e = edits[row.cropCycleId]
      let start = e?.sowingDate ?? row.sowing?.date ?? null
      let end = e?.expectedHarvestDate ?? row.harvest?.date ?? null
      if (!start && !end) return null
      if (!start) start = addDaysIso(end!, -120)
      if (!end) end = addDaysIso(start, 120)
      if (end < start) end = start
      return { row, start, end, lane: 0 }
    })
    .filter((b): b is Bar => !!b)
    .sort((a, b) => a.start.localeCompare(b.start))
  const laneEnds: string[] = []
  for (const b of bars) {
    const lane = laneEnds.findIndex((e) => e < b.start)
    b.lane = lane === -1 ? laneEnds.length : lane
    laneEnds[b.lane] = b.end
  }
  return bars
}

/** Dates a crop of harvest year H may have (as in the reference app). */
function bounds(harvestYear: number) {
  return { sowMin: `${harvestYear - 1}-07-01`, sowMax: `${harvestYear}-12-31`, harvMin: `${harvestYear}-01-01`, harvMax: `${harvestYear}-12-31` }
}

/** Crop plan over several harvest years: drag bars to change dates, click to add, open to edit. */
export function MultiYearCalendar() {
  const { t } = useTranslation()
  const { orgId, can } = useOrg()
  const qc = useQueryClient()
  const current = new Date().getFullYear()
  const [toYear, setToYear] = useState(current + 1)
  const fromYear = toYear - 3
  const data = useOrgQuery<CropCalendarYears>('/crop-calendar/years', { fromYear, toYear }, { keepPrevious: true })
  const [edits, setEdits] = useState<Record<string, Edit>>({})
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState<CalendarRow | null>(null)
  const [adding, setAdding] = useState<{ fieldId: string; sowingDate: string; expectedHarvestDate: string } | null>(null)
  const [colors, setColors] = useState(false)
  const writable = can('crop.write')
  const scroller = useRef<HTMLDivElement>(null)
  const scrolled = useRef(false)

  // Calendar years from the year before the first harvest year to the last harvest year.
  const windowStart = `${fromYear - 1}-01-01`
  const windowEnd = `${toYear}-12-31`
  const width = Math.round(((utc(windowEnd) - utc(windowStart)) / DAY + 1) * PX_PER_DAY)
  const x = (iso: string) => ((utc(iso) - utc(windowStart)) / DAY) * PX_PER_DAY
  const dateAt = (px: number) => isoOf(utc(windowStart) + Math.round(px / PX_PER_DAY) * DAY)

  // Open at today, with some months before it in view.
  useEffect(() => {
    if (scrolled.current || !scroller.current || !data.data) return
    scrolled.current = true
    scroller.current.scrollLeft = Math.max(0, x(isoOf(Date.now())) - 6 * PX_PER_MONTH)
  })

  const dirty = Object.keys(edits)
  const saveAll = async () => {
    setSaving(true)
    const results = await Promise.allSettled(dirty.map((id) => api.patch(`/orgs/${orgId}/crop-cycles/${id}`, edits[id])))
    const failed = dirty.filter((_, i) => results[i].status === 'rejected')
    setEdits((e) => Object.fromEntries(Object.entries(e).filter(([id]) => failed.includes(id))))
    setSaving(false)
    await qc.invalidateQueries({ queryKey: ['org', orgId] })
    if (failed.length) toast.error(t('calendarPlan.saveFailed', { count: failed.length }), errorMessage((results.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason))
    else toast.success(t('calendarPlan.saved', { count: dirty.length }))
  }

  if (data.error) return <ErrorNotice error={data.error} />
  if (!data.data) return <Loading />
  const { fields, rows, seasons } = data.data
  if (!fields.length) return <EmptyState title={t('calendarPlan.noFields')} />

  const years = Array.from({ length: toYear - fromYear + 2 }, (_, i) => fromYear - 1 + i)
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="icon-sm" variant="ghost" aria-label={t('calendarPlan.earlier')} onPress={() => setToYear((y) => y - 1)}><ChevronLeft /></Button>
        <span className="text-sm font-medium tabular">{t('calendarPlan.range', { from: fromYear, to: toYear })}</span>
        <Button size="icon-sm" variant="ghost" aria-label={t('calendarPlan.later')} onPress={() => setToYear((y) => y + 1)}><ChevronRight /></Button>
        <span className="flex-1" />
        {writable && <Button size="sm" onPress={() => setColors(true)}><Palette /> {t('calendarPlan.colors')}</Button>}
      </div>
      <div ref={scroller} className="overflow-x-auto rounded-xl border border-line bg-surface">
        <div style={{ width: LABEL_PX + width }} className="relative">
          {/* Year and month header with each harvest year's crop distribution. */}
          <div className="flex sticky top-0 z-10 bg-surface border-b border-line">
            <div style={{ width: LABEL_PX }} className="shrink-0 sticky left-0 bg-surface z-10 px-3 py-2 text-xs text-muted border-r border-line">{t('calendarPlan.field')}</div>
            {years.map((y) => (
              <div key={y} style={{ width: x(`${y + 1}-01-01`) - x(`${y}-01-01`) }} className="shrink-0 border-r border-line">
                <div className="px-2 pt-1 text-xs font-semibold">{y}</div>
                <Distribution rows={rows.filter((r) => r.harvestYear === y && r.role === 'main')} />
                <div className="flex text-[10px] text-muted">
                  {Array.from({ length: 12 }, (_, m) => (
                    <div key={m} style={{ width: PX_PER_MONTH }} className="text-center py-0.5">{new Date(Date.UTC(2001, m, 15)).toLocaleDateString(LOCALE, { month: 'narrow', timeZone: 'UTC' })}</div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          {fields.map((f) => {
            const bars = laneOut(rows.filter((r) => r.fieldId === f.id), edits)
            const lanes = Math.max(1, ...bars.map((b) => b.lane + 1))
            return (
              <div key={f.id} className="flex border-b border-line/60 last:border-0 group">
                <div style={{ width: LABEL_PX }} className="shrink-0 sticky left-0 z-[5] bg-surface border-r border-line px-3 py-1.5 flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate">{f.name}</div>
                    <div className="text-xs text-muted tabular">{fmt.ha(f.areaHa)}</div>
                  </div>
                  {writable && (
                    <Button size="icon-sm" variant="ghost" aria-label={t('calendarPlan.addTo', { name: f.name })} onPress={() => setAdding({ fieldId: f.id, sowingDate: `${current - 1}-10-01`, expectedHarvestDate: `${current}-07-31` })}>
                      <Plus />
                    </Button>
                  )}
                </div>
                <div
                  className="relative"
                  style={{ width, height: lanes * LANE_PX + 8 }}
                  onClick={(e) => {
                    if (!writable || e.target !== e.currentTarget) return
                    const px = e.clientX - e.currentTarget.getBoundingClientRect().left
                    const at = dateAt(px)
                    setAdding({ fieldId: f.id, sowingDate: addDaysIso(at, -108), expectedHarvestDate: addDaysIso(at, 12) })
                  }}
                >
                  {years.map((y) => <div key={y} className="absolute top-0 bottom-0 border-r border-line/50 pointer-events-none" style={{ left: x(`${y + 1}-01-01`) - 1 }} />)}
                  <div className="absolute top-0 bottom-0 w-px bg-danger/60 pointer-events-none" style={{ left: x(isoOf(Date.now())) }} aria-hidden />
                  {bars.map((b) => (
                    <CalendarBar
                      key={b.row.cropCycleId}
                      bar={b}
                      x={x}
                      edited={!!edits[b.row.cropCycleId]}
                      writable={writable}
                      onOpen={() => setEditing(b.row)}
                      onChange={(start, end) => setEdits((e) => ({ ...e, [b.row.cropCycleId]: { sowingDate: start, expectedHarvestDate: end } }))}
                    />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {dirty.length > 0 && (
        <div className="sticky bottom-4 z-20 flex justify-center">
          <div className="flex items-center gap-3 rounded-xl border border-warning bg-surface px-4 py-2 shadow-[var(--shadow-overlay)]">
            <span className="text-sm font-medium">{t('calendarPlan.unsaved', { count: dirty.length })}</span>
            <Button size="sm" variant="ghost" onPress={() => setEdits({})}><Undo2 /> {t('fieldsManage.discard')}</Button>
            <Button size="sm" variant="primary" isPending={saving} onPress={() => void saveAll()}><Save /> {t('common.save')}</Button>
          </div>
        </div>
      )}

      {editing && <EditFromCalendar row={editing} onClose={() => setEditing(null)} />}
      {adding && <AddFromCalendar {...adding} fieldName={fields.find((f) => f.id === adding.fieldId)?.name ?? ''} seasons={seasons} onClose={() => setAdding(null)} />}
      {colors && <CropColorsDialog rows={rows} onClose={() => setColors(false)} />}
    </div>
  )
}

/** Share of the area per main crop in one harvest year. */
function Distribution({ rows }: { rows: CalendarRow[] }) {
  const { t } = useTranslation()
  const total = rows.reduce((s, r) => s + r.areaHa, 0)
  const byCrop = new Map<string, { color: string; area: number }>()
  for (const r of rows) byCrop.set(r.cropName, { color: r.cropColor, area: (byCrop.get(r.cropName)?.area ?? 0) + r.areaHa })
  const parts = [...byCrop].sort((a, b) => b[1].area - a[1].area)
  return (
    <div className="mx-2 my-1 h-2 rounded-full overflow-hidden flex bg-surface-2" role="img" aria-label={t('calendarPlan.distribution')}>
      {total > 0 && parts.map(([name, p]) => <div key={name} style={{ width: `${(p.area / total) * 100}%`, background: p.color }} title={`${name}: ${fmt.num((p.area / total) * 100, 1)} % (${fmt.ha(p.area, 1)})`} />)}
    </div>
  )
}

const pxToDays = (px: number) => Math.round(px / PX_PER_DAY)

function CalendarBar({
  bar,
  x,
  edited,
  writable,
  onOpen,
  onChange,
}: {
  bar: Bar
  /** Timeline position of a date. */
  x: (iso: string) => number
  edited: boolean
  writable: boolean
  onOpen: () => void
  onChange: (start: string, end: string) => void
}) {
  const { t } = useTranslation()
  const { row } = bar
  const lim = bounds(row.harvestYear)
  const sowFixed = row.sowing?.source === 'recorded'
  const harvFixed = row.harvest?.source === 'recorded'
  const drag = useRef<{ mode: 'move' | 'start' | 'end'; x0: number; moved: boolean } | null>(null)
  const [preview, setPreview] = useState<{ start: string; end: string } | null>(null)
  const start = preview?.start ?? bar.start
  const end = preview?.end ?? bar.end

  const clampAll = (s: string, e: string) => {
    const s2 = s < lim.sowMin ? lim.sowMin : s > lim.sowMax ? lim.sowMax : s
    let e2 = e < lim.harvMin ? lim.harvMin : e > lim.harvMax ? lim.harvMax : e
    if (e2 <= addDaysIso(s2, 14)) e2 = addDaysIso(s2, 15)
    return [s2, e2] as const
  }

  const onDown = (mode: 'move' | 'start' | 'end') => (e: ReactPointerEvent) => {
    if (!writable || (mode === 'move' && (sowFixed || harvFixed)) || (mode === 'start' && sowFixed) || (mode === 'end' && harvFixed)) return
    e.stopPropagation()
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    drag.current = { mode, x0: e.clientX, moved: false }
  }
  const onMove = (e: ReactPointerEvent) => {
    const d = drag.current
    if (!d) return
    const days = pxToDays(e.clientX - d.x0)
    if (Math.abs(e.clientX - d.x0) > 3) d.moved = true
    if (!d.moved) return
    const [s, en] =
      d.mode === 'move' ? clampAll(addDaysIso(bar.start, days), addDaysIso(bar.end, days)) : d.mode === 'start' ? clampAll(addDaysIso(bar.start, days), bar.end) : clampAll(bar.start, addDaysIso(bar.end, days))
    setPreview({ start: s, end: en })
  }
  const onUp = () => {
    const d = drag.current
    drag.current = null
    if (!d) return
    if (!d.moved) {
      if (d.mode === 'move') onOpen()
      return
    }
    if (preview) onChange(preview.start, preview.end)
    setPreview(null)
  }

  const left = x(start)
  const widthPx = Math.max(MIN_BAR_PX, x(end) + PX_PER_DAY - left)
  const secondary = row.role !== 'main'
  const label = `${row.cropName}${row.fieldPartName ? ` · ${row.fieldPartName}` : ''}`
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={t('calendarPlan.barLabel', { crop: label, from: fmt.date(start), to: fmt.date(end) })}
      title={`${label}\n${fmt.date(start)} – ${fmt.date(end)}${row.varietyName ? `\n${row.varietyName}` : ''}${row.usage === 'seed_multiplication' ? `\n${t('crops.usage.seed_multiplication')}${row.seedLot ? ` · ${row.seedLot}` : ''}` : ''}`}
      onKeyDown={(e) => e.key === 'Enter' && onOpen()}
      onPointerDown={onDown('move')}
      onPointerMove={onMove}
      onPointerUp={onUp}
      style={{
        left,
        width: widthPx,
        top: 4 + bar.lane * LANE_PX,
        height: LANE_PX - 6,
        background: row.cropColor,
        opacity: secondary ? 0.75 : 1,
      }}
      className={cx(
        'absolute rounded-md text-[11px] font-medium text-white px-2 flex items-center overflow-hidden whitespace-nowrap select-none shadow-sm',
        secondary && 'border-2 border-dashed border-white/80',
        edited && 'ring-2 ring-info ring-offset-1',
        writable && !(sowFixed || harvFixed) ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer',
      )}
    >
      {writable && !sowFixed && <span onPointerDown={onDown('start')} onPointerMove={onMove} onPointerUp={onUp} className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize" aria-hidden />}
      <span className="truncate drop-shadow-[0_1px_1px_rgba(0,0,0,.4)]">{label}</span>
      {writable && !harvFixed && <span onPointerDown={onDown('end')} onPointerMove={onMove} onPointerUp={onUp} className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize" aria-hidden />}
    </div>
  )
}

function EditFromCalendar({ row, onClose }: { row: CalendarRow; onClose: () => void }) {
  const cycles = useOrgQuery<CropCycle[]>('/crop-cycles', { fieldId: row.fieldId })
  const remove = useOrgMutation((base, _: void) => api.delete(`${base}/crop-cycles/${row.cropCycleId}`))
  const cycle = cycles.data?.find((c) => c.id === row.cropCycleId)
  if (!cycle) return null
  return <EditCycleDialog cycle={cycle} onClose={onClose} onDelete={() => remove.mutateAsync()} />
}

function AddFromCalendar({ fieldId, fieldName, sowingDate, expectedHarvestDate, seasons, onClose }: { fieldId: string; fieldName: string; sowingDate: string; expectedHarvestDate: string; seasons: CropCalendarYears['seasons']; onClose: () => void }) {
  const { t } = useTranslation()
  const crops = useOrgQuery<Crop[]>('/crops')
  const resolveVariety = useVarietyResolver()
  const [form, setForm] = useState<CycleForm>({ ...EMPTY_CYCLE_FORM, sowingDate, expectedHarvestDate })
  const templates = useOrgQuery<CultivationTemplate[]>('/templates')
  const [templateId, setTemplateId] = useState<string | null>(null)
  const harvestYear = Number((form.expectedHarvestDate ?? sowingDate).slice(0, 4))
  const season = seasons.find((s) => s.harvestYear === harvestYear) ?? null
  const options = (templates.data ?? []).filter((tp) => tp.cropId === form.cropId)
  useEffect(() => setTemplateId(null), [form.cropId])
  const save = useOrgMutation(
    async (base, _: void) => {
      const varietyId = form.cropId ? await resolveVariety(base, form.cropId, form.varietyName) : null
      const [created] = await api.post<CropCycle[]>(`${base}/crop-cycles`, {
        seasonId: season!.id,
        fieldIds: [fieldId],
        cropId: form.cropId,
        varietyId,
        status: form.status,
        role: form.role,
        sowingDate: form.sowingDate,
        expectedHarvestDate: form.expectedHarvestDate,
        expectedYieldTHa: num(form.expectedYieldTHa),
        expectedPricePerT: num(form.expectedPricePerT),
        ...seedPayload(form),
        notes: form.notes || null,
      })
      if (templateId) await api.post(`${base}/crop-cycles/${created.id}/apply-template`, { templateId })
      return created
    },
    { success: t('crops.assign.success', { count: 1 }), onSuccess: onClose },
  )
  return (
    <ModalDialog isOpen onOpenChange={(o) => !o && onClose()} title={t('calendarPlan.addTitle', { name: fieldName })} description={season ? t('calendarPlan.inSeason', { season: season.name }) : undefined} size="md"
      footer={(close) => (
        <>
          <Button onPress={close}>{t('common.cancel')}</Button>
          <Button variant="primary" isDisabled={!form.cropId || !season} isPending={save.isPending} onPress={() => save.mutate()}>{t('calendarPlan.add')}</Button>
        </>
      )}
    >
      <div className="space-y-4">
        {!season && <p className="text-sm text-danger">{t('calendarPlan.noSeason', { year: harvestYear })}</p>}
        <CycleFields value={form} onChange={setForm} crops={crops.data ?? []} />
        <Select label={t('crops.plan.template')} isDisabled={!options.length} items={[{ id: 'none', name: t('rotations.entries.noTemplate') }, ...options.map((tp) => ({ id: tp.id, name: tp.name }))]} value={templateId ?? 'none'} onChange={(v) => setTemplateId(v && v !== 'none' ? String(v) : null)}>
          {(o) => <Option id={o.id}>{o.name}</Option>}
        </Select>
      </div>
    </ModalDialog>
  )
}

/** The organization's own colour per crop; reset returns to the catalogue colour. */
function CropColorsDialog({ rows, onClose }: { rows: CalendarRow[]; onClose: () => void }) {
  const { t } = useTranslation()
  const crops = useOrgQuery<Crop[]>('/crops')
  const own = useOrgQuery<Record<string, string>>('/crop-colors')
  const used = new Set(rows.map((r) => r.cropId))
  const [changes, setChanges] = useState<Record<string, string | null>>({})
  const list = (crops.data ?? []).filter((c) => used.has(c.id) || own.data?.[c.id])
  const save = useOrgMutation((base, _: void) => api.put(`${base}/crop-colors`, { colors: changes }), { success: t('calendarPlan.colorsSaved'), onSuccess: onClose })
  return (
    <ModalDialog isOpen onOpenChange={(o) => !o && onClose()} title={t('calendarPlan.colorsTitle')} description={t('calendarPlan.colorsHint')} size="sm"
      footer={(close) => (
        <>
          <Button variant="quiet" onPress={() => setChanges(Object.fromEntries(Object.keys(own.data ?? {}).map((id) => [id, null])))}>{t('calendarPlan.resetAll')}</Button>
          <div className="flex-1" />
          <Button onPress={close}>{t('common.cancel')}</Button>
          <Button variant="primary" isDisabled={!Object.keys(changes).length} isPending={save.isPending} onPress={() => save.mutate()}>{t('common.save')}</Button>
        </>
      )}
    >
      {!crops.data || !own.data ? <Loading /> : (
        <ul className="divide-y divide-line">
          {list.map((c) => {
            const value = changes[c.id] === null ? null : changes[c.id] ?? c.color
            const shown = value ?? '#9aa392'
            return (
              <li key={c.id} className="flex items-center gap-3 py-2">
                <input type="color" aria-label={t('calendarPlan.colorOf', { crop: c.name })} value={shown} onChange={(e) => setChanges((ch) => ({ ...ch, [c.id]: e.target.value }))} className="size-8 rounded cursor-pointer border border-line p-0.5 bg-transparent" />
                <span className="flex-1 text-sm">{c.name}</span>
                {(own.data[c.id] || changes[c.id]) && changes[c.id] !== null && <Button size="sm" variant="quiet" onPress={() => setChanges((ch) => ({ ...ch, [c.id]: null }))}>{t('calendarPlan.reset')}</Button>}
              </li>
            )
          })}
        </ul>
      )}
    </ModalDialog>
  )
}
