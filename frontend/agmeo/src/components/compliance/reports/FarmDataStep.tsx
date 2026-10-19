import {
  BESYD_BERECHNUNGSGRUNDLAGEN,
  ENDO_NATURAL_REGIONS,
  ENNI_SOIL_CLIMATE_AREAS,
  type ExportPreflight,
  type FarmRegulatory,
  type FarmRegulatoryInput,
  type FederalExportFormat,
  type FederalState,
  FERTILIZER_YEAR_STARTS,
  type FertilizerYearStart,
  type RegulatoryCodeLists,
  ST_BEWIRTSCHAFTUNGEN,
} from '@agmeo/contracts'
import { ArrowRight, ChevronRight, Info, Save } from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '#/lib/api'
import { useOrg } from '#/lib/org'
import { useOrgMutation, useOrgQuery } from '#/lib/queries'
import { Button } from '#/ui/Button'
import { Checkbox, ComboBox, Option, Select, Switch, TextField } from '#/ui/Field'
import { Badge, Card, ErrorNotice, Loading, Notice } from '#/ui/Layout'
import { cx } from '#/ui/utils'
import { N170Tab } from '../N170'
import { monthLabel } from '../shared'
import { BETRIEBSNUMMER_EXAMPLES, formatShortName, isValidBetriebsnummer, type MissingCropMapping, regulatoryInput, splitPreflight } from './formats'

type XmlFormat = 'enni' | 'endo'
const isXml = (format: FederalExportFormat): format is XmlFormat => format === 'enni' || format === 'endo'

const CONTACT_KEYS = ['firma', 'vorname', 'nachname', 'strasse', 'plz', 'ort', 'telefonnummer', 'email'] as const
type ContactKey = (typeof CONTACT_KEYS)[number]
/** webBESyD takes the company and its postal address only. */
const BESYD_CONTACT_KEYS: ContactKey[] = ['firma', 'strasse', 'plz', 'ort', 'email']

/** ENNI allows a Düngejahr starting January to July; ENDO-SH, webBESyD and the LLG report the calendar year. */
const ENNI_YEAR_STARTS = FERTILIZER_YEAR_STARTS.slice(0, 7)

/** Betriebsnummer of the farm as the API stores it (the authority patterns are checked separately). */
const HOLDING_NUMBER = /^[0-9]{6,20}$/
const EU_HOLDING_NUMBER = /^[0-9]{12}$/

/** webBESyD Land key of a 12-digit Betriebsnummer. */
const LAND_BY_PREFIX: Record<string, FederalState> = { '12': 'BB', '14': 'SN', '15': 'ST', '16': 'TH' }

interface Form {
  holdingNumber: string
  euHoldingNumber: string
  fertilizerYearStart: FertilizerYearStart
  organicCertified: boolean
  otherFertilizersApplied: boolean
  compostApplied: boolean
  restrictions: boolean
  soilClimateArea: (typeof ENNI_SOIL_CLIMATE_AREAS)[number] | null
  nitrateZoneFlag: boolean
  naturalRegion: (typeof ENDO_NATURAL_REGIONS)[number] | null
  /** Null: derived from `organicCertified` by the export. */
  berechnungsgrundlage: (typeof BESYD_BERECHNUNGSGRUNDLAGEN)[number] | null
  bodenklimaraum: string
  amt: string
  sitzOrtsteil: string
  kreisNr: number | null
  /** Null: derived from `organicCertified` by the export. */
  bewirtschaftung: (typeof ST_BEWIRTSCHAFTUNGEN)[number] | null
  sitzInSt: boolean
  contact: Record<ContactKey, string>
  /** Crop code overrides of the selected format, by crop key. */
  cropCodes: Record<string, string>
}

const sectionOf = (format: FederalExportFormat, d: FarmRegulatory) => (format === 'enni' ? d.enni : format === 'endo' ? d.endo : format === 'besyd' ? d.besyd : d.st)

function fromFarm(d: FarmRegulatory, format: FederalExportFormat): Form {
  return {
    holdingNumber: d.holdingNumber ?? '',
    euHoldingNumber: d.euHoldingNumber ?? '',
    fertilizerYearStart: d.fertilizerYearStart,
    organicCertified: d.organicCertified,
    otherFertilizersApplied: d.otherFertilizersApplied,
    compostApplied: d.compostApplied,
    restrictions: d.restrictions,
    soilClimateArea: d.enni.soilClimateArea ?? null,
    nitrateZoneFlag: d.enni.nitrateZoneFlag,
    naturalRegion: d.endo.naturalRegion ?? null,
    berechnungsgrundlage: d.besyd.berechnungsgrundlage ?? null,
    bodenklimaraum: d.besyd.bodenklimaraum ?? '',
    amt: d.besyd.amt ?? '',
    sitzOrtsteil: d.st.sitzOrtsteil ?? '',
    kreisNr: d.st.kreisNr ?? null,
    bewirtschaftung: d.st.bewirtschaftung ?? null,
    sitzInSt: d.st.sitzInSt,
    contact: Object.fromEntries(CONTACT_KEYS.map((k) => [k, d.contact[k] ?? ''])) as Form['contact'],
    cropCodes: { ...sectionOf(format, d).cropCodeOverrides },
  }
}

function toInput(f: Form, d: FarmRegulatory, format: FederalExportFormat): FarmRegulatoryInput {
  const blank = (v: string) => v.trim() || null
  const codes = Object.fromEntries(Object.entries(f.cropCodes).filter(([, v]) => v))
  const own = <T extends object>(section: FederalExportFormat, value: T) => (section === format ? { ...value, cropCodeOverrides: codes } : value)
  return {
    ...regulatoryInput(d),
    holdingNumber: blank(f.holdingNumber),
    euHoldingNumber: blank(f.euHoldingNumber),
    fertilizerYearStart: f.fertilizerYearStart,
    organicCertified: f.organicCertified,
    otherFertilizersApplied: f.otherFertilizersApplied,
    compostApplied: f.compostApplied,
    restrictions: f.restrictions,
    enni: own('enni', { ...d.enni, soilClimateArea: f.soilClimateArea, nitrateZoneFlag: f.nitrateZoneFlag }),
    endo: own('endo', { ...d.endo, naturalRegion: f.naturalRegion }),
    besyd: own('besyd', { ...d.besyd, berechnungsgrundlage: f.berechnungsgrundlage, bodenklimaraum: blank(f.bodenklimaraum), amt: blank(f.amt) }),
    st: own('st', { ...d.st, sitzOrtsteil: blank(f.sitzOrtsteil), kreisNr: f.kreisNr, bewirtschaftung: f.bewirtschaftung, sitzInSt: f.sitzInSt }),
    contact: Object.fromEntries(CONTACT_KEYS.map((k) => [k, blank(f.contact[k])])),
  }
}

/** Step 3: the farm data the selected format needs, its crop code overrides and (ENNI/ENDO) the 170 N data. */
export function FarmDataStep({
  farmId,
  year,
  format,
  federalState,
  focus,
  onContinue,
}: {
  farmId: string
  year: number
  format: FederalExportFormat
  federalState: FederalState | null
  focus: string | null
  onContinue: () => void
}) {
  const farm = useOrgQuery<FarmRegulatory>(`/farms/${farmId}/regulatory`)
  const preflight = useOrgQuery<ExportPreflight>('/regulatory/preflight', { format, farmId, year })
  const codeLists = useOrgQuery<RegulatoryCodeLists>('/regulatory/code-lists', { format }, { staleTime: Infinity })

  if (farm.isLoading || preflight.isLoading || codeLists.isLoading) return <Loading />
  const error = farm.error ?? preflight.error ?? codeLists.error
  if (error || !farm.data || !preflight.data || !codeLists.data) return <ErrorNotice error={error} />
  return (
    <FarmDataForm
      // A new farm or format starts from that farm's saved values.
      key={`${farmId}:${format}`}
      data={farm.data}
      farmId={farmId}
      year={year}
      format={format}
      federalState={federalState}
      codeLists={codeLists.data}
      missingCropMappings={splitPreflight(preflight.data).missingCropMappings}
      focus={focus}
      onContinue={onContinue}
    />
  )
}

function FarmDataForm({
  data,
  farmId,
  year,
  format,
  federalState,
  codeLists,
  missingCropMappings,
  focus,
  onContinue,
}: {
  data: FarmRegulatory
  farmId: string
  year: number
  format: FederalExportFormat
  federalState: FederalState | null
  codeLists: RegulatoryCodeLists
  missingCropMappings: MissingCropMapping[]
  focus: string | null
  onContinue: () => void
}) {
  const { t } = useTranslation()
  const { can } = useOrg()
  const editable = can('farm.write')
  // ENDO-SH is fixed to the calendar year: the form shows it, so saving stores it.
  const [form, setForm] = useState<Form>(() => {
    const saved = fromFarm(data, format)
    return format === 'endo' ? { ...saved, fertilizerYearStart: 'JANUAR' } : saved
  })
  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => ({ ...f, [key]: value }))
  const setContact = (key: ContactKey, value: string) => setForm((f) => ({ ...f, contact: { ...f.contact, [key]: value } }))
  const save = useOrgMutation((base, input: FarmRegulatoryInput) => api.put<FarmRegulatory>(`${base}/farms/${farmId}/regulatory`, input), { success: t('fertilizerReports.farmData.saved') })

  const input = toInput(form, data, format)
  const dirty = JSON.stringify(input) !== JSON.stringify(toInput(fromFarm(data, format), data, format))
  const invalid = (form.holdingNumber.trim() !== '' && !HOLDING_NUMBER.test(form.holdingNumber.trim())) || (form.euHoldingNumber.trim() !== '' && !EU_HOLDING_NUMBER.test(form.euHoldingNumber.trim()))

  useEffect(() => {
    if (focus === 'cropCodeOverrides') document.getElementById('crop-code-overrides')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [focus])

  const handleContinue = () => {
    if (dirty && editable) save.mutate(input, { onSuccess: onContinue })
    else onContinue()
  }

  const fields = { form, set, setContact, editable, focus }
  return (
    <div className="space-y-6">
      {!editable && (
        <Notice tone="info" icon={Info}>
          {t('regulatory.farm.readOnly')}
        </Notice>
      )}

      <Card title={t('fertilizerReports.farmData.title', { format: formatShortName(format) })} description={t('fertilizerReports.farmData.hint', { farm: data.farmName })}>
        {isXml(format) && <XmlFields {...fields} format={format} />}
        {format === 'besyd' && <BesydFields {...fields} codeLists={codeLists} federalState={federalState} />}
        {format === 'st' && <StFields {...fields} codeLists={codeLists} />}
      </Card>

      {missingCropMappings.length > 0 && (
        <CodeOverrides format={format} mappings={missingCropMappings} codeLists={codeLists} values={form.cropCodes} onChange={(key, code) => set('cropCodes', { ...form.cropCodes, [key]: code })} highlighted={focus === 'cropCodeOverrides'} editable={editable} />
      )}

      {isXml(format) && (
        <Disclosure title={t('fertilizerReports.farmData.n170Title')} description={t('fertilizerReports.farmData.n170Hint')}>
          <N170Tab farmId={farmId} year={year} />
        </Disclosure>
      )}

      <div className="sticky bottom-0 z-10 -mx-1 px-1 py-3 bg-canvas/95 backdrop-blur border-t border-line flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {editable && (
            <Button onPress={() => save.mutate(input)} isPending={save.isPending} isDisabled={!dirty || invalid}>
              {!save.isPending && <Save />} {t('fertilizerReports.farmData.save')}
            </Button>
          )}
          {dirty && editable && <Badge tone="warning">{t('fertilizerReports.farmData.unsaved')}</Badge>}
        </div>
        <Button variant="primary" onPress={handleContinue} isDisabled={save.isPending || (dirty && invalid)}>
          {t('fertilizerReports.readiness.continue')} <ArrowRight />
        </Button>
      </div>
    </div>
  )
}

interface FieldsProps {
  form: Form
  set: <K extends keyof Form>(key: K, value: Form[K]) => void
  setContact: (key: ContactKey, value: string) => void
  editable: boolean
  focus: string | null
}

function BetriebsnummerField({ format, value, onChange, editable, autoFocus, label }: { format: FederalExportFormat; value: string; onChange: (v: string) => void; editable: boolean; autoFocus: boolean; label?: string }) {
  const { t } = useTranslation()
  const invalid = value.trim() !== '' && !isValidBetriebsnummer(format, value)
  return (
    <TextField
      label={`${label ?? t('fertilizerReports.farmData.betriebsnummer')} *`}
      description={t(`fertilizerReports.formats.${format}.farmNumberHint`)}
      placeholder={t('fertilizerReports.farmData.farmNumberExample', { example: BETRIEBSNUMMER_EXAMPLES[format] })}
      inputMode="numeric"
      value={value}
      onChange={(v) => onChange(v.replace(/\s/g, ''))}
      isInvalid={invalid}
      errorMessage={t('fertilizerReports.farmData.farmNumberInvalid')}
      isReadOnly={!editable}
      autoFocus={autoFocus}
      className="max-w-md"
    />
  )
}

/** Heading of a group of controls or of a fixed value, styled like a field label. */
function GroupLabel({ children }: { children: ReactNode }) {
  return <div className="text-sm font-medium text-fg-2">{children}</div>
}

/** A fixed Düngejahr (ENDO-SH, webBESyD, Sachsen-Anhalt). */
function FixedYearStart() {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col gap-1.5">
      <GroupLabel>{t('fertilizerReports.farmData.fertilizationYearStart')}</GroupLabel>
      <p className="text-sm text-fg-2 py-2">{t('fertilizerReports.farmData.fertilizationYearFixed')}</p>
    </div>
  )
}

/** ENNI and ENDO-SH: Betriebsnummer, Düngejahr, Boden-Klima-Raum or Naturraum, the declarations and the address. */
function XmlFields({ form, set, setContact, editable, focus, format }: FieldsProps & { format: XmlFormat }) {
  const { t } = useTranslation()
  return (
    <div className="space-y-6">
      <BetriebsnummerField format={format} value={form.holdingNumber} onChange={(v) => set('holdingNumber', v)} editable={editable} autoFocus={focus === 'betriebsnummer'} />

      <div className="grid sm:grid-cols-2 gap-4">
        {format === 'enni' ? (
          <Select
            label={t('fertilizerReports.farmData.fertilizationYearStart')}
            description={t('fertilizerReports.farmData.fertilizationYearHint')}
            items={ENNI_YEAR_STARTS.map((id) => ({ id, name: monthLabel(FERTILIZER_YEAR_STARTS.indexOf(id)) }))}
            value={(ENNI_YEAR_STARTS as readonly string[]).includes(form.fertilizerYearStart) ? form.fertilizerYearStart : null}
            placeholder={t('regulatory.farm.choose')}
            onChange={(v) => v && set('fertilizerYearStart', v as FertilizerYearStart)}
            isDisabled={!editable}
          >
            {(m) => <Option id={m.id}>{m.name}</Option>}
          </Select>
        ) : (
          <FixedYearStart />
        )}
        {format === 'enni' ? (
          <Select
            label={`${t('fertilizerReports.farmData.bodenklimaraum')} *`}
            placeholder={t('regulatory.farm.choose')}
            items={ENNI_SOIL_CLIMATE_AREAS.map((id) => ({ id, name: id.replace('_', ' ') }))}
            value={form.soilClimateArea}
            onChange={(v) => set('soilClimateArea', (v as Form['soilClimateArea']) ?? null)}
            isDisabled={!editable}
            autoFocus={focus === 'bodenklimaraum'}
          >
            {(a) => <Option id={a.id}>{a.name}</Option>}
          </Select>
        ) : (
          <Select
            label={`${t('fertilizerReports.farmData.naturalRegion')} *`}
            placeholder={t('regulatory.farm.choose')}
            items={ENDO_NATURAL_REGIONS.map((id) => ({ id, name: id }))}
            value={form.naturalRegion}
            onChange={(v) => set('naturalRegion', (v as Form['naturalRegion']) ?? null)}
            isDisabled={!editable}
            autoFocus={focus === 'naturraum'}
          >
            {(r) => <Option id={r.id}>{r.name}</Option>}
          </Select>
        )}
      </div>

      <div className="space-y-2">
        <GroupLabel>{t('fertilizerReports.farmData.declarations')}</GroupLabel>
        <div className="flex flex-col gap-2.5">
          <Checkbox isSelected={form.otherFertilizersApplied} onChange={(v) => set('otherFertilizersApplied', v)} isDisabled={!editable}>
            {t('regulatory.farm.declarations.otherFertilizers')}
          </Checkbox>
          <Checkbox isSelected={form.compostApplied} onChange={(v) => set('compostApplied', v)} isDisabled={!editable}>
            {t('regulatory.farm.declarations.compost')}
          </Checkbox>
          <Checkbox isSelected={form.restrictions} onChange={(v) => set('restrictions', v)} isDisabled={!editable}>
            {t('regulatory.farm.declarations.restrictions')}
          </Checkbox>
          <Checkbox isSelected={form.organicCertified} onChange={(v) => set('organicCertified', v)} isDisabled={!editable}>
            {t('regulatory.farm.organicCertified')}
          </Checkbox>
          {format === 'enni' && (
            <Checkbox isSelected={form.nitrateZoneFlag} onChange={(v) => set('nitrateZoneFlag', v)} isDisabled={!editable}>
              {t('regulatory.farm.enni.nitrateZoneFlag')}
            </Checkbox>
          )}
        </div>
      </div>

      <AddressFields keys={CONTACT_KEYS} form={form} setContact={setContact} editable={editable} hint={t('fertilizerReports.farmData.addressHint')} />
    </div>
  )
}

/** webBESyD: 12-digit Betriebsnummer, Berechnungsgrundlage, Boden-Klima-Raum of the Land, Amt (Sachsen), address. */
function BesydFields({ form, set, setContact, editable, focus, codeLists, federalState }: FieldsProps & { codeLists: RegulatoryCodeLists; federalState: FederalState | null }) {
  const { t } = useTranslation()
  const land = LAND_BY_PREFIX[form.euHoldingNumber.slice(0, 2)] ?? federalState
  const bkr = codeLists.bodenklimaraum.filter((b) => !land || b.states.includes(land) || b.code === form.bodenklimaraum)
  const derived = form.organicCertified ? 'ÖL' : 'DV'
  return (
    <div className="space-y-6">
      <BetriebsnummerField format="besyd" value={form.euHoldingNumber} onChange={(v) => set('euHoldingNumber', v)} editable={editable} autoFocus={focus === 'betriebsnummer'} />
      <div className="grid sm:grid-cols-2 gap-4">
        <Select
          label={t('fertilizerReports.farmData.berechnungsgrundlage')}
          items={BESYD_BERECHNUNGSGRUNDLAGEN.map((id) => ({ id, name: t(id === 'DV' ? 'fertilizerReports.farmData.berechnungsgrundlageConventional' : 'fertilizerReports.farmData.berechnungsgrundlageOrganic') }))}
          value={form.berechnungsgrundlage ?? derived}
          onChange={(v) => v && set('berechnungsgrundlage', v as Form['berechnungsgrundlage'])}
          isDisabled={!editable}
          autoFocus={focus === 'berechnungsgrundlage'}
        >
          {(o) => <Option id={o.id}>{o.name}</Option>}
        </Select>
        <Select
          label={`${t('fertilizerReports.farmData.bodenklimaraum')} *`}
          placeholder={t('regulatory.farm.choose')}
          items={bkr.map((b) => ({ id: b.code, name: `${b.code} – ${b.name}` }))}
          value={form.bodenklimaraum || null}
          onChange={(v) => set('bodenklimaraum', v == null ? '' : String(v))}
          isDisabled={!editable}
          autoFocus={focus === 'bodenklimaraum'}
        >
          {(o) => <Option id={o.id}>{o.name}</Option>}
        </Select>
        {land === 'SN' && (
          <Select
            label={t('fertilizerReports.farmData.amt')}
            placeholder={t('regulatory.farm.choose')}
            items={codeLists.amt.map((a) => ({ id: a.code, name: `${a.code} – ${a.name}` }))}
            value={form.amt || null}
            onChange={(v) => set('amt', v == null ? '' : String(v))}
            isDisabled={!editable}
          >
            {(o) => <Option id={o.id}>{o.name}</Option>}
          </Select>
        )}
        <FixedYearStart />
      </div>
      <AddressFields keys={BESYD_CONTACT_KEYS} form={form} setContact={setContact} editable={editable} hint={t('fertilizerReports.farmData.addressHint')} />
    </div>
  )
}

/** Sachsen-Anhalt Mitteilung: Betriebsname and Betriebssitz (from the contact), EU-Betriebsnummer, Landkreis, Bewirtschaftung. */
function StFields({ form, set, setContact, editable, focus, codeLists }: FieldsProps & { codeLists: RegulatoryCodeLists }) {
  const { t } = useTranslation()
  const derived = form.organicCertified ? 'o' : 'k'
  return (
    <div className="space-y-6">
      <div className="grid sm:grid-cols-2 gap-4 items-start">
        <TextField label={`${t('fertilizerReports.farmData.st.betriebsname')} *`} value={form.contact.firma} onChange={(v) => setContact('firma', v)} isReadOnly={!editable} autoFocus={focus === 'betriebsname'} />
        <BetriebsnummerField
          format="st"
          label={t('fertilizerReports.farmData.st.euBetriebsnummer')}
          value={form.euHoldingNumber}
          onChange={(v) => set('euHoldingNumber', v)}
          editable={editable}
          autoFocus={focus === 'euBetriebsnummer'}
        />
      </div>
      <div className="grid sm:grid-cols-3 gap-4">
        <TextField label={`${t('fertilizerReports.farmData.st.sitzPlz')} *`} value={form.contact.plz} onChange={(v) => setContact('plz', v)} isReadOnly={!editable} autoFocus={focus === 'sitzPlz'} />
        <TextField label={`${t('fertilizerReports.farmData.st.sitzOrt')} *`} value={form.contact.ort} onChange={(v) => setContact('ort', v)} isReadOnly={!editable} autoFocus={focus === 'sitzOrt'} />
        <TextField label={t('fertilizerReports.farmData.st.sitzOrtsteil')} value={form.sitzOrtsteil} onChange={(v) => set('sitzOrtsteil', v)} isReadOnly={!editable} />
      </div>
      <div className="grid sm:grid-cols-2 gap-4">
        <Select
          label={`${t('fertilizerReports.farmData.st.kreisNr')} *`}
          placeholder={t('regulatory.farm.choose')}
          items={codeLists.kreise.map((k) => ({ id: k.nr, name: k.name }))}
          value={form.kreisNr}
          onChange={(v) => set('kreisNr', v == null ? null : Number(v))}
          isDisabled={!editable}
          autoFocus={focus === 'kreisNr'}
        >
          {(k) => <Option id={k.id}>{k.name}</Option>}
        </Select>
        <Select
          label={t('fertilizerReports.farmData.st.bewirtschaftung')}
          items={ST_BEWIRTSCHAFTUNGEN.map((id) => ({ id, name: t(id === 'k' ? 'fertilizerReports.farmData.st.bewirtschaftungConventional' : 'fertilizerReports.farmData.st.bewirtschaftungOrganic') }))}
          value={form.bewirtschaftung ?? derived}
          onChange={(v) => v && set('bewirtschaftung', v as Form['bewirtschaftung'])}
          isDisabled={!editable}
          autoFocus={focus === 'bewirtschaftung'}
        >
          {(o) => <Option id={o.id}>{o.name}</Option>}
        </Select>
      </div>
      <div>
        <Switch isSelected={form.sitzInSt} onChange={(v) => set('sitzInSt', v)} isDisabled={!editable}>
          {t('fertilizerReports.farmData.st.sitzInSt')}
        </Switch>
        <p className="text-xs text-muted mt-1.5">{t('fertilizerReports.farmData.st.sitzInStHint')}</p>
      </div>
      <FixedYearStart />
    </div>
  )
}

/** The farm's contact address, collapsed while empty. */
function AddressFields({ keys, form, setContact, editable, hint }: { keys: readonly ContactKey[]; form: Form; setContact: (key: ContactKey, value: string) => void; editable: boolean; hint: string }) {
  const { t } = useTranslation()
  const filled = keys.some((k) => form.contact[k].trim())
  return (
    <Disclosure title={t('fertilizerReports.farmData.addressData')} description={hint} defaultOpen={filled} nested>
      <div className="grid sm:grid-cols-2 gap-4">
        {keys.map((k) => (
          <TextField
            key={k}
            label={t(`regulatory.farm.contact.${k}`)}
            type={k === 'email' ? 'email' : k === 'telefonnummer' ? 'tel' : 'text'}
            value={form.contact[k]}
            onChange={(v) => setContact(k, v)}
            isReadOnly={!editable}
            className={k === 'strasse' || k === 'email' ? 'sm:col-span-2' : undefined}
          />
        ))}
      </div>
    </Disclosure>
  )
}

/** Crop → authority code for the crops the default catalogue does not know. */
function CodeOverrides({
  format,
  mappings,
  codeLists,
  values,
  onChange,
  highlighted,
  editable,
}: {
  format: FederalExportFormat
  mappings: MissingCropMapping[]
  codeLists: RegulatoryCodeLists
  values: Record<string, string>
  onChange: (cropKey: string, code: string) => void
  highlighted: boolean
  editable: boolean
}) {
  const { t } = useTranslation()
  const items = codeLists.crops.map((c) => ({ id: c.code, name: `${c.code} – ${c.name}` }))
  return (
    <div id="crop-code-overrides" className={cx('scroll-mt-4 rounded-xl', highlighted && 'ring-2 ring-primary/60')}>
      <Card title={`${t('fertilizerReports.farmData.cropMappings')} *`} description={t(`fertilizerReports.formats.${format}.missingCropMappingsHint`)} padded={false}>
        <ul className="divide-y divide-line">
          {mappings.map((m) => (
            <li key={m.cropKey} className="flex flex-col sm:flex-row sm:items-center gap-3 px-4 py-3">
              <div className="sm:w-1/3 min-w-0">
                <div className="font-medium text-sm text-fg truncate">{m.cropName}</div>
                <div className="text-xs text-muted">{t('fertilizerReports.farmData.cultivationsThisYear', { count: m.count })}</div>
              </div>
              <ComboBox
                aria-label={t('fertilizerReports.farmData.cropCodeFor', { crop: m.cropName })}
                placeholder={t('fertilizerReports.farmData.selectCropType')}
                items={items}
                value={values[m.cropKey] || null}
                onChange={(v) => onChange(m.cropKey, v == null ? '' : String(v))}
                isDisabled={!editable}
                menuTrigger="focus"
                className="flex-1"
              >
                {(i) => (
                  <Option id={i.id} textValue={i.name}>
                    {i.name}
                  </Option>
                )}
              </ComboBox>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  )
}

/** A collapsible section; `nested` sits inside a card, otherwise it is a card of its own. */
function Disclosure({ title, description, children, defaultOpen, nested }: { title: string; description?: string; children: ReactNode; defaultOpen?: boolean; nested?: boolean }) {
  return (
    <details open={defaultOpen} className={cx('group rounded-xl border border-line', nested ? 'bg-surface-2/40' : 'bg-surface shadow-xs')}>
      <summary className="flex items-start gap-2 cursor-pointer select-none list-none px-4 py-3 [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-4 mt-0.5 text-muted shrink-0 transition-transform group-open:rotate-90" aria-hidden />
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-fg">{title}</span>
          {description && <span className="block text-xs text-muted mt-0.5">{description}</span>}
        </span>
      </summary>
      <div className="px-4 pb-4 pt-1">{children}</div>
    </details>
  )
}
