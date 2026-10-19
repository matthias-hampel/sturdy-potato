import {
  ENDO_NATURAL_REGIONS,
  ENNI_SOIL_CLIMATE_AREAS,
  FEDERAL_STATE_NAMES,
  FEDERAL_STATES,
  FERTILIZER_YEAR_STARTS,
  type FarmRegulatory,
  type FarmRegulatoryInput,
  type FederalState,
  type FertilizerYearStart,
  type RegulatoryContact,
} from '@agmeo/contracts'
import { Info } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '#/lib/api'
import { useOrg } from '#/lib/org'
import { useOrgMutation, useOrgQuery } from '#/lib/queries'
import { Button } from '#/ui/Button'
import { Checkbox, Option, Select, TextField } from '#/ui/Field'
import { Card, ErrorNotice, Loading, Notice } from '#/ui/Layout'
import { monthLabel } from './shared'

const HOLDING_NUMBER = /^[0-9]{6,20}$/

type Form = Required<Pick<FarmRegulatoryInput, 'fertilizerYearStart' | 'organicCertified' | 'otherFertilizersApplied' | 'compostApplied' | 'restrictions'>> & {
  holdingNumber: string
  federalState: FederalState | null
  soilClimateArea: (typeof ENNI_SOIL_CLIMATE_AREAS)[number] | null
  nitrateZoneFlag: boolean
  naturalRegion: (typeof ENDO_NATURAL_REGIONS)[number] | null
  contact: Record<keyof RegulatoryContact, string>
}

const CONTACT_KEYS = ['firma', 'vorname', 'nachname', 'strasse', 'plz', 'ort', 'telefonnummer', 'email'] as const

function toForm(d: FarmRegulatory): Form {
  return {
    holdingNumber: d.holdingNumber ?? '',
    federalState: d.federalState ?? null,
    fertilizerYearStart: d.fertilizerYearStart,
    organicCertified: d.organicCertified,
    soilClimateArea: d.enni.soilClimateArea ?? null,
    nitrateZoneFlag: d.enni.nitrateZoneFlag,
    naturalRegion: d.endo.naturalRegion ?? null,
    contact: Object.fromEntries(CONTACT_KEYS.map((k) => [k, d.contact[k] ?? ''])) as Form['contact'],
    otherFertilizersApplied: d.otherFertilizersApplied,
    compostApplied: d.compostApplied,
    restrictions: d.restrictions,
  }
}

/** The form as a PUT body; the crop code overrides set in the report wizard are kept. */
function toInput(f: Form, d: FarmRegulatory): FarmRegulatoryInput {
  const blank = (v: string) => v.trim() || null
  return {
    holdingNumber: blank(f.holdingNumber),
    federalState: f.federalState,
    fertilizerYearStart: f.fertilizerYearStart,
    organicCertified: f.organicCertified,
    enni: { ...d.enni, soilClimateArea: f.soilClimateArea, nitrateZoneFlag: f.nitrateZoneFlag },
    endo: { ...d.endo, naturalRegion: f.naturalRegion },
    contact: Object.fromEntries(CONTACT_KEYS.map((k) => [k, blank(f.contact[k])])),
    otherFertilizersApplied: f.otherFertilizersApplied,
    compostApplied: f.compostApplied,
    restrictions: f.restrictions,
  }
}

/** Farm master data the authority exports need (Betriebsnummer, Bundesland, Düngejahr, contact). */
export function FarmRegulatoryTab({ farmId }: { farmId: string }) {
  const data = useOrgQuery<FarmRegulatory>(`/farms/${farmId}/regulatory`)
  if (data.isLoading) return <Loading />
  if (data.error) return <ErrorNotice error={data.error} />
  // Remount on another farm so the form starts from that farm's saved values.
  return data.data ? <FarmRegulatoryForm key={farmId} data={data.data} /> : null
}

function FarmRegulatoryForm({ data }: { data: FarmRegulatory }) {
  const { t } = useTranslation()
  const { can } = useOrg()
  const editable = can('farm.write')
  const [form, setForm] = useState(() => toForm(data))
  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => ({ ...f, [key]: value }))
  const setContact = (key: keyof Form['contact'], value: string) => setForm((f) => ({ ...f, contact: { ...f.contact, [key]: value } }))
  const save = useOrgMutation((base, input: FarmRegulatoryInput) => api.put<FarmRegulatory>(`${base}/farms/${data.farmId}/regulatory`, input), {
    success: t('regulatory.farm.saved', { farm: data.farmName }),
  })

  const holdingInvalid = form.holdingNumber.trim() !== '' && !HOLDING_NUMBER.test(form.holdingNumber.trim())
  const showEnni = form.federalState == null || form.federalState === 'NI'
  const showEndo = form.federalState == null || form.federalState === 'SH'
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!holdingInvalid) save.mutate(toInput(form, data))
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      {!editable && (
        <Notice tone="info" icon={Info}>
          {t('regulatory.farm.readOnly')}
        </Notice>
      )}

      <Card title={t('regulatory.farm.title', { farm: data.farmName })} description={t('regulatory.farm.description')}>
        <div className="grid sm:grid-cols-2 gap-4">
          <TextField
            label={t('regulatory.farm.holdingNumber')}
            description={t('regulatory.farm.holdingNumberHint')}
            inputMode="numeric"
            value={form.holdingNumber}
            onChange={(v) => set('holdingNumber', v.replace(/\s/g, ''))}
            isInvalid={holdingInvalid}
            errorMessage={t('regulatory.farm.holdingNumberInvalid')}
            isReadOnly={!editable}
          />
          <Select
            label={t('regulatory.farm.federalState')}
            placeholder={t('regulatory.farm.federalStatePlaceholder')}
            items={FEDERAL_STATES.map((id) => ({ id, name: FEDERAL_STATE_NAMES[id] }))}
            value={form.federalState}
            onChange={(v) => set('federalState', (v as FederalState | null) ?? null)}
            isDisabled={!editable}
          >
            {(s) => <Option id={s.id}>{s.name}</Option>}
          </Select>
          <Select
            label={t('regulatory.farm.fertilizerYearStart')}
            description={t('regulatory.farm.fertilizerYearStartHint')}
            items={FERTILIZER_YEAR_STARTS.map((id, i) => ({ id, name: monthLabel(i) }))}
            value={form.fertilizerYearStart}
            onChange={(v) => v && set('fertilizerYearStart', v as FertilizerYearStart)}
            isDisabled={!editable}
          >
            {(m) => <Option id={m.id}>{m.name}</Option>}
          </Select>
          <div className="flex items-end pb-2">
            <Checkbox isSelected={form.organicCertified} onChange={(v) => set('organicCertified', v)} isDisabled={!editable}>
              {t('regulatory.farm.organicCertified')}
            </Checkbox>
          </div>
        </div>
      </Card>

      {(showEnni || showEndo) && (
        <div className="grid lg:grid-cols-2 gap-6 items-start">
          {showEnni && (
            <Card title={t('regulatory.farm.enni.title')} description={t('regulatory.farm.enni.description')}>
              <div className="space-y-4">
                <Select
                  label={t('regulatory.farm.enni.soilClimateArea')}
                  placeholder={t('regulatory.farm.choose')}
                  items={ENNI_SOIL_CLIMATE_AREAS.map((id) => ({ id, name: id.replace('_', ' ') }))}
                  value={form.soilClimateArea}
                  onChange={(v) => set('soilClimateArea', (v as Form['soilClimateArea']) ?? null)}
                  isDisabled={!editable}
                >
                  {(a) => <Option id={a.id}>{a.name}</Option>}
                </Select>
                <Checkbox isSelected={form.nitrateZoneFlag} onChange={(v) => set('nitrateZoneFlag', v)} isDisabled={!editable}>
                  {t('regulatory.farm.enni.nitrateZoneFlag')}
                </Checkbox>
              </div>
            </Card>
          )}
          {showEndo && (
            <Card title={t('regulatory.farm.endo.title')} description={t('regulatory.farm.endo.description')}>
              <Select
                label={t('regulatory.farm.endo.naturalRegion')}
                placeholder={t('regulatory.farm.choose')}
                items={ENDO_NATURAL_REGIONS.map((id) => ({ id, name: id }))}
                value={form.naturalRegion}
                onChange={(v) => set('naturalRegion', (v as Form['naturalRegion']) ?? null)}
                isDisabled={!editable}
              >
                {(r) => <Option id={r.id}>{r.name}</Option>}
              </Select>
            </Card>
          )}
        </div>
      )}

      <Card title={t('regulatory.farm.contact.title')} description={t('regulatory.farm.contact.description')}>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {CONTACT_KEYS.map((k) => (
            <TextField
              key={k}
              label={t(`regulatory.farm.contact.${k}`)}
              type={k === 'email' ? 'email' : k === 'telefonnummer' ? 'tel' : 'text'}
              value={form.contact[k]}
              onChange={(v) => setContact(k, v)}
              isReadOnly={!editable}
              className={k === 'firma' || k === 'strasse' ? 'lg:col-span-2' : undefined}
            />
          ))}
        </div>
      </Card>

      <Card title={t('regulatory.farm.declarations.title')} description={t('regulatory.farm.declarations.description')}>
        <div className="flex flex-col gap-3">
          <Checkbox isSelected={form.otherFertilizersApplied} onChange={(v) => set('otherFertilizersApplied', v)} isDisabled={!editable}>
            {t('regulatory.farm.declarations.otherFertilizers')}
          </Checkbox>
          <Checkbox isSelected={form.compostApplied} onChange={(v) => set('compostApplied', v)} isDisabled={!editable}>
            {t('regulatory.farm.declarations.compost')}
          </Checkbox>
          <Checkbox isSelected={form.restrictions} onChange={(v) => set('restrictions', v)} isDisabled={!editable}>
            {t('regulatory.farm.declarations.restrictions')}
          </Checkbox>
        </div>
      </Card>

      {editable && (
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onPress={() => setForm(toForm(data))}>
            {t('common.reset')}
          </Button>
          <Button type="submit" variant="primary" isPending={save.isPending} isDisabled={holdingInvalid}>
            {t('common.saveChanges')}
          </Button>
        </div>
      )}
    </form>
  )
}
