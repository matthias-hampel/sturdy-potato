import type { Crop, CropRotation } from '@agmeo/contracts'
import { Plus, X } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '#/lib/api'
import { useOrgMutation, useOrgQuery } from '#/lib/queries'
import { Button } from '#/ui/Button'
import { ComboBox, Option, Select, TextField } from '#/ui/Field'

const NONE = '__none'
const NEW = '__new'

/**
 * Crop rotation the imported fields follow, picked from the organization's rotations or created on
 * the spot (ported from the reference's InlineCreateNewCropRotation in the import dialog).
 */
export function RotationPicker({ value, onChange, crops }: { value: string | null; onChange: (rotationId: string | null) => void; crops: Crop[] }) {
  const { t } = useTranslation()
  const rotations = useOrgQuery<CropRotation[]>('/rotations')
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [entries, setEntries] = useState<(string | null)[]>([null, null])
  const create = useOrgMutation(
    (base, _: void) => api.post<CropRotation>(`${base}/rotations`, { name: name.trim(), entries: entries.filter(Boolean).map((cropId) => ({ cropId })) }),
    {
      success: t('import.rotation.created'),
      onSuccess: (r) => {
        onChange(r.id)
        setCreating(false)
        setName('')
        setEntries([null, null])
      },
    },
  )
  const items = [{ id: NONE, name: t('import.rotation.none') }, ...(rotations.data ?? []).map((r) => ({ id: r.id, name: r.name })), { id: NEW, name: t('import.rotation.new') }]
  const valid = name.trim() && entries.some(Boolean) && entries.every(Boolean)

  return (
    <div className="space-y-3">
      <Select
        label={t('import.rotation.label')}
        description={t('import.rotation.description')}
        items={items}
        value={creating ? NEW : (value ?? NONE)}
        onChange={(v) => {
          if (v === NEW) return setCreating(true)
          setCreating(false)
          onChange(v === NONE || v == null ? null : String(v))
        }}
      >
        {(o) => <Option id={o.id}>{o.name}</Option>}
      </Select>
      {creating && (
        <div className="rounded-lg border border-line p-3 space-y-3 bg-surface-2/40">
          <TextField label={t('import.rotation.name')} value={name} onChange={setName} />
          <ol className="space-y-2">
            {entries.map((cropId, i) => (
              <li key={i} className="flex items-end gap-2">
                <span className="text-xs text-muted w-5 pb-2.5 tabular">{i + 1}.</span>
                <ComboBox
                  aria-label={t('import.rotation.year', { number: i + 1 })}
                  className="flex-1"
                  placeholder={t('import.rotation.crop')}
                  items={crops}
                  value={cropId}
                  onChange={(v) => setEntries(entries.map((e, j) => (j === i ? (v ? String(v) : null) : e)))}
                >
                  {(c) => <Option id={c.id}>{c.name}</Option>}
                </ComboBox>
                <Button size="icon-sm" variant="ghost" aria-label={t('import.rotation.removeYear', { number: i + 1 })} isDisabled={entries.length <= 1} onPress={() => setEntries(entries.filter((_, j) => j !== i))}>
                  <X />
                </Button>
              </li>
            ))}
          </ol>
          <div className="flex justify-between gap-2">
            <Button size="sm" variant="ghost" isDisabled={entries.length >= 12} onPress={() => setEntries([...entries, null])}>
              <Plus /> {t('import.rotation.addYear')}
            </Button>
            <span className="flex gap-2">
              <Button size="sm" onPress={() => setCreating(false)}>{t('common.cancel')}</Button>
              <Button size="sm" variant="primary" isDisabled={!valid} isPending={create.isPending} onPress={() => create.mutate()}>
                {t('import.rotation.save')}
              </Button>
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
