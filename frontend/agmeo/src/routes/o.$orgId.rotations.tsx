import {
  type CarryForwardResult,
  type Crop,
  type CropCycle,
  type CropRotation,
  type CultivationTemplate,
  type Field,
  type RollOverResult,
  type RotationInput,
  type Season,
} from '@agmeo/contracts'
import { createFileRoute } from '@tanstack/react-router'
import { ArrowRight, ChevronDown, ChevronUp, CopyPlus, MapPin, Pencil, Plus, Repeat, Trash2, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button as AriaButton, Form } from 'react-aria-components'
import { useTranslation } from 'react-i18next'
import { CropTag } from '#/components/labels'
import { api } from '#/lib/api'
import { fmt, today } from '#/lib/format'
import { useOrg, useSeason } from '#/lib/org'
import { useOrgMutation, useOrgQuery } from '#/lib/queries'
import { Button } from '#/ui/Button'
import { Checkbox, ComboBox, NumberField, Option, Select, Switch, TextField, num } from '#/ui/Field'
import { Badge, type BadgeTone, Card, Loading, Notice, PageHeader } from '#/ui/Layout'
import { ConfirmButton, ModalDialog } from '#/ui/Overlay'
import { cx, focusRing } from '#/ui/utils'

export const Route = createFileRoute('/o/$orgId/rotations')({ component: RotationsPage })

/** Crop rotations: planned sequences of crops that fields follow year by year, and planning a season from them. */
function RotationsPage() {
  const { t } = useTranslation()
  const { can } = useOrg()
  const { seasons, season, seasonId } = useSeason()
  const fields = useOrgQuery<Field[]>('/fields', { seasonId })
  const allCycles = useOrgQuery<CropCycle[]>('/crop-cycles')
  const [carry, setCarry] = useState(false)
  return (
    <>
      <PageHeader
        title={t('rotations.title')}
        subtitle={t('rotations.description')}
        actions={can('crop.write') && season && <Button onPress={() => setCarry(true)}><CopyPlus /> {t('rotations.carry.button')}</Button>}
      />
      <div className="grid xl:grid-cols-[1.2fr_1fr] gap-6 items-start">
        <RotationsCard season={season} fields={fields.data ?? []} />
        <RotationHistoryCard fields={fields.data ?? []} cycles={allCycles.data ?? []} seasons={seasons} />
      </div>
      {carry && season && <CarryForwardDialog season={season} onClose={() => setCarry(false)} />}
    </>
  )
}

const CARRY_TONE: Record<CarryForwardResult['fields'][number]['outcome'], BadgeTone> = { created: 'success', already_planned: 'neutral', field_divided: 'warning', no_previous: 'neutral' }

/** Repeats last season's crops on fields that have none yet in the season. */
function CarryForwardDialog({ season, onClose }: { season: Season; onClose: () => void }) {
  const { t } = useTranslation()
  const { can } = useOrg()
  const [applyTemplates, setApplyTemplates] = useState(false)
  const [result, setResult] = useState<CarryForwardResult | null>(null)
  const run = useOrgMutation((base, _: void) => api.post<CarryForwardResult>(`${base}/crop-cycles/carry-forward`, { targetSeasonId: season.id, applyTemplates }), {
    success: (r) => t('rotations.carry.success', { count: r.created }),
    onSuccess: setResult,
  })
  return (
    <ModalDialog isOpen onOpenChange={(o) => !o && onClose()} title={t('rotations.carry.title', { season: season.name })} size="md"
      footer={(close) => result ? <Button variant="primary" onPress={close}>{t('common.close')}</Button> : (
        <>
          <Button onPress={close}>{t('common.cancel')}</Button>
          <Button variant="primary" isPending={run.isPending} onPress={() => run.mutate()}><CopyPlus /> {t('rotations.carry.submit')}</Button>
        </>
      )}
    >
      {result ? (
        <ul className="divide-y divide-line border border-line rounded-lg max-h-[50vh] overflow-y-auto">
          {result.fields.map((f) => (
            <li key={f.fieldId} className="flex items-center gap-3 px-3 py-2 text-sm">
              <span className="flex-1 truncate">{f.fieldName}</span>
              {f.cropName && <span className="text-muted truncate">{f.cropName}</span>}
              <Badge tone={CARRY_TONE[f.outcome]}>{t(`rotations.carry.outcome.${f.outcome}`)}</Badge>
            </li>
          ))}
        </ul>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-fg-2">{t('rotations.carry.body', { season: season.name, previous: season.harvestYear - 1 })}</p>
          {can('operation.write') && <Switch isSelected={applyTemplates} onChange={setApplyTemplates}>{t('rotations.rollOver.applyTemplates')}</Switch>}
        </div>
      )}
    </ModalDialog>
  )
}

/** What each field actually grew in the last seasons (main crops only). */
function RotationHistoryCard({ fields, cycles, seasons }: { fields: Field[]; cycles: CropCycle[]; seasons: Season[] }) {
  const { t } = useTranslation()
  const recent = [...seasons].sort((a, b) => a.harvestYear - b.harvestYear).slice(-6)
  if (recent.length < 2) return null
  const lookup = new Map(cycles.filter((c) => c.role === 'main').map((c) => [`${c.fieldId}:${c.seasonId}`, c]))
  return (
    <Card title={t('rotations.history.title')} description={t('crops.rotation.description')} padded={false}>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-muted">
              <th className="text-left font-medium px-3 py-2">{t('crops.plan.field')}</th>
              {recent.map((s) => (
                <th key={s.id} className="text-left font-medium px-2 py-2 whitespace-nowrap">{s.harvestYear}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {fields.map((f) => (
              <tr key={f.id} className="border-t border-line">
                <td className="px-3 py-1.5 font-medium text-fg truncate max-w-28">{f.name}</td>
                {recent.map((s) => {
                  const c = lookup.get(`${f.id}:${s.id}`)
                  return (
                    <td key={s.id} className="px-2 py-1.5">
                      {c ? (
                        <span className="inline-flex items-center gap-1 max-w-24" title={c.cropName}>
                          <span className="size-2 rounded-full shrink-0" style={{ background: c.cropColor }} aria-hidden />
                          <span className="truncate text-fg-2">{c.cropName}</span>
                        </span>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
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

// ---------------------------------------------------------------------------
// Crop rotations
// ---------------------------------------------------------------------------

function RotationsCard({ season, fields }: { season: Season | null; fields: Field[] }) {
  const { t } = useTranslation()
  const { can } = useOrg()
  const rotations = useOrgQuery<CropRotation[]>('/rotations')
  const [editing, setEditing] = useState<CropRotation | 'new' | null>(null)
  const [assigning, setAssigning] = useState<CropRotation | null>(null)
  const [rollOver, setRollOver] = useState(false)
  const remove = useOrgMutation((base, id: string) => api.delete(`${base}/rotations/${id}`), { success: t('rotations.toast.deleted') })
  const unassign = useOrgMutation((base, id: string) => api.delete(`${base}/rotation-assignments/${id}`), { success: t('rotations.toast.unassigned') })
  const writable = can('crop.write')
  const list = rotations.data ?? []
  return (
    <Card
      title={t('rotations.listTitle')}
      description={t('rotations.entries.description')}
      padded={false}
      actions={writable && <Button size="icon-sm" variant="ghost" aria-label={t('rotations.new')} onPress={() => setEditing('new')}><Plus /></Button>}
    >
      {rotations.isLoading ? (
        <div className="p-4"><Loading /></div>
      ) : !list.length ? (
        <div className="p-4 space-y-3">
          <p className="text-sm text-muted">{t('rotations.empty')}</p>
          {writable && <Button size="sm" onPress={() => setEditing('new')}><Plus /> {t('rotations.new')}</Button>}
        </div>
      ) : (
        <ul className="divide-y divide-line">
          {list.map((rot) => (
            <li key={rot.id} className="px-4 py-3 space-y-2">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-fg truncate">{rot.name}</div>
                  <div className="text-xs text-muted">{t('rotations.fieldCount', { count: rot.fields.length })}</div>
                </div>
                {writable && (
                  <div className="flex -mr-1.5 -mt-1">
                    <Button size="icon-sm" variant="ghost" aria-label={t('rotations.assign.titleNamed', { name: rot.name })} onPress={() => setAssigning(rot)}><MapPin /></Button>
                    <Button size="icon-sm" variant="ghost" aria-label={t('rotations.editNamed', { name: rot.name })} onPress={() => setEditing(rot)}><Pencil /></Button>
                    <ConfirmButton
                      title={t('rotations.delete.title', { name: rot.name })}
                      message={t('rotations.delete.message')}
                      confirmLabel={t('common.delete')}
                      onConfirm={() => remove.mutateAsync(rot.id)}
                      trigger={<Button size="icon-sm" variant="ghost" aria-label={t('rotations.deleteNamed', { name: rot.name })}><Trash2 /></Button>}
                    />
                  </div>
                )}
              </div>
              <ol className="flex flex-wrap items-start gap-x-1 gap-y-1.5" aria-label={t('rotations.sequence')}>
                {rot.entries.map((e, i) => (
                  <li key={e.position} className="flex items-start gap-1">
                    {i > 0 && <ArrowRight className="size-3 text-muted mt-1.5 shrink-0" aria-hidden />}
                    <span className="flex flex-col">
                      <CropTag name={e.cropName} color={e.cropColor} />
                      {e.catchCropName && <span className="text-[11px] text-muted pl-4">+ {e.catchCropName}</span>}
                    </span>
                  </li>
                ))}
              </ol>
              {rot.fields.length > 0 && (
                <ul className="flex flex-wrap gap-1.5">
                  {rot.fields.map((f) => (
                    <li key={f.id} className="inline-flex items-center gap-1 rounded-full border border-line bg-surface-2 pl-2 pr-0.5 py-0.5 text-xs text-fg-2 max-w-full">
                      <span className="truncate">{f.fieldName}</span>
                      <span className="text-muted tabular whitespace-nowrap">{f.endYear ? `${f.startYear}–${f.endYear}` : t('rotations.since', { year: f.startYear })}</span>
                      {writable ? (
                        <AriaButton aria-label={t('rotations.unassign', { field: f.fieldName })} onPress={() => unassign.mutate(f.id)} className={cx('size-5 rounded-full flex items-center justify-center text-muted hover:bg-surface-3 hover:text-fg cursor-pointer', focusRing)}>
                          <X className="size-3" />
                        </AriaButton>
                      ) : (
                        <span className="pr-1.5" />
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
      {writable && season && list.some((r) => r.fields.length > 0) && (
        <div className="p-4 border-t border-line">
          <Button variant="primary" className="w-full" onPress={() => setRollOver(true)}>
            <Repeat /> {t('rotations.rollOver.button')}
          </Button>
          <p className="text-xs text-muted mt-1.5">{t('rotations.rollOver.hint', { season: season.name })}</p>
        </div>
      )}
      {editing && <RotationDialog rotation={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {assigning && <AssignRotationDialog rotation={assigning} rotations={list} fields={fields} defaultYear={season?.harvestYear ?? Number(today().slice(0, 4))} onClose={() => setAssigning(null)} />}
      {rollOver && season && <RollOverDialog season={season} onClose={() => setRollOver(false)} />}
    </Card>
  )
}

interface EntryForm {
  key: number
  cropId: string | null
  templateId: string | null
  catchCropId: string | null
  expectedYieldTHa: number
}

let entryKeySeq = 0
const newEntry = (): EntryForm => ({ key: entryKeySeq++, cropId: null, templateId: null, catchCropId: null, expectedYieldTHa: NaN })

function RotationDialog({ rotation, onClose }: { rotation: CropRotation | null; onClose: () => void }) {
  const { t } = useTranslation()
  const crops = useOrgQuery<Crop[]>('/crops')
  const templates = useOrgQuery<CultivationTemplate[]>('/templates')
  const coverCrops = (crops.data ?? []).filter((c) => c.category === 'cover')
  const [name, setName] = useState(rotation?.name ?? '')
  const [notes, setNotes] = useState(rotation?.notes ?? '')
  const [entries, setEntries] = useState<EntryForm[]>(() =>
    rotation
      ? rotation.entries.map((e) => ({ key: entryKeySeq++, cropId: e.cropId, templateId: e.templateId, catchCropId: e.catchCropId, expectedYieldTHa: e.expectedYieldTHa ?? NaN }))
      : [newEntry(), newEntry(), newEntry()],
  )
  const update = (key: number, patch: Partial<EntryForm>) => setEntries((list) => list.map((e) => (e.key === key ? { ...e, ...patch } : e)))
  const move = (index: number, by: -1 | 1) =>
    setEntries((list) => {
      const next = [...list]
      ;[next[index], next[index + by]] = [next[index + by], next[index]]
      return next
    })
  const valid = !!name.trim() && entries.length > 0 && entries.every((e) => e.cropId)
  const body: RotationInput = {
    name,
    notes: notes || null,
    entries: entries.map((e) => ({ cropId: e.cropId ?? '', templateId: e.templateId, catchCropId: e.catchCropId, expectedYieldTHa: num(e.expectedYieldTHa) })),
  }
  const save = useOrgMutation((base, _: void) => (rotation ? api.put<CropRotation>(`${base}/rotations/${rotation.id}`, body) : api.post<CropRotation>(`${base}/rotations`, body)), {
    success: rotation ? t('rotations.toast.updated') : t('rotations.toast.created'),
    onSuccess: onClose,
  })
  return (
    <ModalDialog isOpen onOpenChange={(o) => !o && onClose()} title={rotation ? t('rotations.dialog.editTitle') : t('rotations.new')} size="lg">
      <Form onSubmit={(e) => { e.preventDefault(); if (valid) save.mutate() }} className="space-y-5">
        <div className="grid sm:grid-cols-2 gap-4">
          <TextField label={t('common.name')} isRequired autoFocus value={name} onChange={setName} placeholder={t('rotations.dialog.namePlaceholder')} />
          <TextField label={t('common.notes')} value={notes} onChange={setNotes} />
        </div>
        <section className="space-y-3">
          <div className="flex items-end justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-fg">{t('rotations.entries.title')}</h3>
              <p className="text-xs text-muted mt-0.5">{t('rotations.entries.description')}</p>
            </div>
            <Button size="sm" isDisabled={entries.length >= 12} onPress={() => setEntries((list) => [...list, newEntry()])}>
              <Plus /> {t('rotations.entries.add')}
            </Button>
          </div>
          <ol className="space-y-3">
            {entries.map((e, i) => {
              const cropTemplates = (templates.data ?? []).filter((x) => x.cropId === e.cropId)
              return (
                <li key={e.key} className="rounded-lg border border-line p-3 space-y-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-muted uppercase tracking-wider flex-1">{t('rotations.entries.year', { n: i + 1 })}</span>
                    <Button size="icon-sm" variant="ghost" aria-label={t('templates.steps.moveUp')} isDisabled={i === 0} onPress={() => move(i, -1)}><ChevronUp /></Button>
                    <Button size="icon-sm" variant="ghost" aria-label={t('templates.steps.moveDown')} isDisabled={i === entries.length - 1} onPress={() => move(i, 1)}><ChevronDown /></Button>
                    <Button size="icon-sm" variant="ghost" aria-label={t('rotations.entries.remove')} isDisabled={entries.length === 1} onPress={() => setEntries((list) => list.filter((x) => x.key !== e.key))}><Trash2 /></Button>
                  </div>
                  <div className="grid sm:grid-cols-2 gap-3">
                    <ComboBox
                      label={t('crops.form.crop')}
                      isRequired
                      items={crops.data ?? []}
                      value={e.cropId}
                      // A template belongs to one crop; drop it when the crop changes.
                      onChange={(v) => update(e.key, { cropId: v ? String(v) : null, templateId: null })}
                      placeholder={t('crops.form.searchCrops')}
                    >
                      {(c) => (
                        <Option id={c.id} textValue={c.name}>
                          <CropTag name={c.name} color={c.color} />
                        </Option>
                      )}
                    </ComboBox>
                    <Select
                      label={t('rotations.entries.template')}
                      isDisabled={!e.cropId}
                      items={[{ id: '__none', name: t('rotations.entries.noTemplate') }, ...cropTemplates]}
                      value={e.templateId ?? '__none'}
                      onChange={(v) => update(e.key, { templateId: v && v !== '__none' ? String(v) : null })}
                    >
                      {(x) => <Option id={x.id}>{x.name}</Option>}
                    </Select>
                    <Select
                      label={t('rotations.entries.catchCrop')}
                      description={t('rotations.entries.catchCropHint')}
                      items={[{ id: '__none', name: t('common.none') }, ...coverCrops]}
                      value={e.catchCropId ?? '__none'}
                      onChange={(v) => update(e.key, { catchCropId: v && v !== '__none' ? String(v) : null })}
                    >
                      {(c) => <Option id={c.id} textValue={c.name}>{'color' in c ? <CropTag name={c.name} color={c.color} /> : c.name}</Option>}
                    </Select>
                    <NumberField label={t('crops.form.expectedYield')} unit="t/ha" minValue={0} step={0.1} formatOptions={{ maximumFractionDigits: 2 }} value={e.expectedYieldTHa} onChange={(v) => update(e.key, { expectedYieldTHa: v })} />
                  </div>
                </li>
              )
            })}
          </ol>
        </section>
        <div className="flex justify-end gap-2">
          <Button onPress={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" variant="primary" isDisabled={!valid} isPending={save.isPending}>{rotation ? t('common.save') : t('common.create')}</Button>
        </div>
      </Form>
    </ModalDialog>
  )
}

function AssignRotationDialog({ rotation, rotations, fields, defaultYear, onClose }: { rotation: CropRotation; rotations: CropRotation[]; fields: Field[]; defaultYear: number; onClose: () => void }) {
  const { t } = useTranslation()
  const [fieldIds, setFieldIds] = useState<string[]>([])
  const [startYear, setStartYear] = useState(defaultYear)
  const [endYear, setEndYear] = useState(NaN)
  // Shown next to each field so a second rotation is assigned knowingly.
  const followed = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const r of rotations) for (const f of r.fields) m.set(f.fieldId, [...(m.get(f.fieldId) ?? []), r.name])
    return m
  }, [rotations])
  const area = fields.filter((f) => fieldIds.includes(f.id)).reduce((s, f) => s + f.areaHa, 0)
  const save = useOrgMutation((base, _: void) => api.post(`${base}/rotations/${rotation.id}/fields`, { fieldIds, startYear, endYear: num(endYear) }), {
    success: t('rotations.assign.success', { count: fieldIds.length }),
    onSuccess: onClose,
  })
  return (
    <ModalDialog isOpen onOpenChange={(o) => !o && onClose()} title={t('rotations.assign.title')} description={rotation.name} size="md">
      <Form onSubmit={(e) => { e.preventDefault(); save.mutate() }} className="space-y-4">
        <div>
          <div className="text-sm font-medium text-fg-2 mb-2">{t('crops.assign.fields')} <span className="text-muted font-normal">· {t('crops.assign.selected', { count: fieldIds.length, area: fmt.ha(area, 1) })}</span></div>
          <div className="border border-line rounded-lg max-h-72 overflow-y-auto divide-y divide-line">
            {fields.map((f) => (
              <div key={f.id} className={cx('px-3 py-2', fieldIds.includes(f.id) && 'bg-primary-soft/50')}>
                <Checkbox isSelected={fieldIds.includes(f.id)} onChange={(sel) => setFieldIds((ids) => (sel ? [...ids, f.id] : ids.filter((i) => i !== f.id)))}>
                  <span className="flex-1 min-w-0">
                    <span className="block truncate">{f.name}</span>
                    <span className="block text-xs text-muted truncate">{[fmt.ha(f.areaHa, 1), ...(followed.get(f.id) ?? [])].join(' · ')}</span>
                  </span>
                </Checkbox>
              </div>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <NumberField label={t('rotations.assign.startYear')} description={t('rotations.assign.startYearHint')} isRequired value={startYear} formatOptions={{ useGrouping: false }} minValue={1990} maxValue={2200} onChange={setStartYear} />
          <NumberField label={t('rotations.assign.endYear')} value={endYear} formatOptions={{ useGrouping: false }} minValue={Number.isNaN(startYear) ? 1990 : startYear} maxValue={2200} onChange={setEndYear} placeholder={t('common.optional')} />
        </div>
        <div className="flex justify-end gap-2">
          <Button onPress={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" variant="primary" isDisabled={!fieldIds.length || Number.isNaN(startYear)} isPending={save.isPending}>
            <MapPin /> {t('rotations.assign.submit', { count: fieldIds.length })}
          </Button>
        </div>
      </Form>
    </ModalDialog>
  )
}

const OUTCOME_TONE: Record<RollOverResult['fields'][number]['outcome'], BadgeTone> = { created: 'success', already_planned: 'neutral', field_divided: 'warning' }

function RollOverDialog({ season, onClose }: { season: Season; onClose: () => void }) {
  const { t } = useTranslation()
  const [applyTemplates, setApplyTemplates] = useState(true)
  const [result, setResult] = useState<RollOverResult | null>(null)
  const run = useOrgMutation((base, _: void) => api.post<RollOverResult>(`${base}/rotations/roll-over`, { targetSeasonId: season.id, applyTemplates }), {
    success: (r) => t('rotations.rollOver.success', { count: r.created }),
    onSuccess: setResult,
  })
  return (
    <ModalDialog isOpen onOpenChange={(o) => !o && onClose()} title={t('rotations.rollOver.title', { season: season.name })} size="md">
      {result ? (
        <div className="space-y-4">
          <Notice tone={result.created ? 'success' : 'info'}>
            {result.fields.length ? t('rotations.rollOver.summary', { count: result.created, skipped: result.skipped }) : t('rotations.rollOver.nothing', { year: season.harvestYear })}
          </Notice>
          {result.fields.length > 0 && (
            <ul className="rounded-lg border border-line divide-y divide-line max-h-80 overflow-y-auto">
              {result.fields.map((f) => (
                <li key={f.fieldId} className="px-3 py-2 flex items-center justify-between gap-3 text-sm">
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{f.fieldName}</span>
                    {f.cropName && <span className="block text-xs text-muted truncate">{f.cropName}</span>}
                  </span>
                  <Badge tone={OUTCOME_TONE[f.outcome]}>{t(`rotations.outcome.${f.outcome}`)}</Badge>
                </li>
              ))}
            </ul>
          )}
          {result.fields.some((f) => f.outcome === 'field_divided') && <p className="text-xs text-muted">{t('rotations.rollOver.dividedHint')}</p>}
          <div className="flex justify-end">
            <Button variant="primary" onPress={onClose}>{t('common.close')}</Button>
          </div>
        </div>
      ) : (
        <Form onSubmit={(e) => { e.preventDefault(); run.mutate() }} className="space-y-4">
          <p className="text-sm text-fg-2">{t('rotations.rollOver.body', { season: season.name, year: season.harvestYear })}</p>
          <Checkbox isSelected={applyTemplates} onChange={setApplyTemplates}>{t('rotations.rollOver.applyTemplates')}</Checkbox>
          <p className="text-xs text-muted -mt-2 pl-6">{t('rotations.rollOver.applyTemplatesHint')}</p>
          <div className="flex justify-end gap-2">
            <Button onPress={onClose}>{t('common.cancel')}</Button>
            <Button type="submit" variant="primary" isPending={run.isPending}><Repeat /> {t('rotations.rollOver.submit')}</Button>
          </div>
        </Form>
      )}
    </ModalDialog>
  )
}

