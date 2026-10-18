import { TENURES, type Farm, type Tenure } from '@agmeo/contracts'
import { useTranslation } from 'react-i18next'
import { Option, Select, TextField } from '#/ui/Field'

export interface FieldDetails {
  farmId: string | null
  name: string
  identifier: string
  tenure: Tenure
  soilType: string
  notes: string
}

export const emptyDetails = (farmId: string | null = null): FieldDetails => ({ farmId, name: '', identifier: '', tenure: 'owned', soilType: '', notes: '' })

export function FieldDetailsForm({ value, onChange, farms }: { value: FieldDetails; onChange: (v: FieldDetails) => void; farms: Farm[] }) {
  const { t } = useTranslation()
  const tenureLabels: Record<Tenure, string> = { owned: t('fields.tenure.owned'), leased: t('fields.tenure.leased'), other: t('fields.tenure.other') }
  const set = <K extends keyof FieldDetails>(k: K, v: FieldDetails[K]) => onChange({ ...value, [k]: v })
  return (
    <div className="grid sm:grid-cols-2 gap-4">
      <TextField label={t('fields.form.name')} isRequired value={value.name} onChange={(v) => set('name', v)} className="sm:col-span-2" />
      {farms.length > 1 && (
        <Select label={t('fields.farm')} isRequired items={farms} value={value.farmId} onChange={(v) => set('farmId', v ? String(v) : null)} className="sm:col-span-2">
          {(f) => <Option id={f.id}>{f.name}</Option>}
        </Select>
      )}
      <TextField label={t('fields.identifier')} description={t('fields.form.identifierHint')} value={value.identifier} onChange={(v) => set('identifier', v)} />
      <Select label={t('fields.tenure.label')} items={TENURES.map((id) => ({ id, name: tenureLabels[id] }))} value={value.tenure} onChange={(v) => v && set('tenure', v as Tenure)}>
        {(item) => <Option id={item.id}>{item.name}</Option>}
      </Select>
      <TextField label={t('fields.soilType')} value={value.soilType} onChange={(v) => set('soilType', v)} className="sm:col-span-2" placeholder={t('fields.form.soilTypePlaceholder')} />
      <TextField label={t('common.notes')} multiline value={value.notes} onChange={(v) => set('notes', v)} className="sm:col-span-2" />
    </div>
  )
}

export function detailsPayload(d: FieldDetails) {
  return {
    name: d.name.trim(),
    identifier: d.identifier.trim() || null,
    tenure: d.tenure,
    soilType: d.soilType.trim() || null,
    notes: d.notes.trim() || null,
  }
}
