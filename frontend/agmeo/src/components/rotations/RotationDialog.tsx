import type { Crop, CropRotation, CultivationTemplate, RotationInput } from '@agmeo/contracts'
import { ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Form } from 'react-aria-components'
import { useTranslation } from 'react-i18next'
import { CropTag } from '#/components/labels'
import { api } from '#/lib/api'
import { useOrgMutation, useOrgQuery } from '#/lib/queries'
import { Button } from '#/ui/Button'
import { ComboBox, NumberField, Option, Select, TextField, num } from '#/ui/Field'
import { ModalDialog } from '#/ui/Overlay'

interface EntryForm {
  key: number
  cropId: string | null
  templateId: string | null
  catchCropId: string | null
  expectedYieldTHa: number
}

let entryKeySeq = 0
const newEntry = (): EntryForm => ({ key: entryKeySeq++, cropId: null, templateId: null, catchCropId: null, expectedYieldTHa: NaN })

/** Creates or edits a crop rotation: its years with crop, cultivation template, catch crop and expected yield. */
export function RotationDialog({ rotation, onClose }: { rotation: CropRotation | null; onClose: (saved?: CropRotation) => void }) {
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
    onSuccess: (r) => onClose(r),
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
          <Button onPress={() => onClose()}>{t('common.cancel')}</Button>
          <Button type="submit" variant="primary" isDisabled={!valid} isPending={save.isPending}>{rotation ? t('common.save') : t('common.create')}</Button>
        </div>
      </Form>
    </ModalDialog>
  )
}

