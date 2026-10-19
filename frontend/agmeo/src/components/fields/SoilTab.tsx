import { PH_METHODS, soilClassOf, type Field, type FieldSoilSummary, type PhMethod, type SoilSample, type SoilSampleInput, type SoilTexture } from '@agmeo/contracts'
import { FlaskConical, Layers, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Form } from 'react-aria-components'
import { useTranslation } from 'react-i18next'
import { SoilValue } from '#/components/nutrients/badges'
import { FertilizerNeedDialog } from '#/components/nutrients/FertilizerNeedDialog'
import { soilTextureItems } from '#/i18n/labels.agronomy'
import { api } from '#/lib/api'
import { fmt, today } from '#/lib/format'
import { useOrg } from '#/lib/org'
import { useOrgMutation, useOrgQuery } from '#/lib/queries'
import { Button, Link, SegmentedControl, buttonClass } from '#/ui/Button'
import { DatePicker, NumberField, Option, Select, Switch, TextField, num } from '#/ui/Field'
import { Badge, Card, EmptyState, Loading } from '#/ui/Layout'
import { ConfirmButton, ModalDialog } from '#/ui/Overlay'
import { Cell, Column, Row, Table, TableBody, TableHeader } from '#/ui/Table'

const PH_METHOD_LABELS: Record<PhMethod, string> = { cacl2: 'CaCl₂', h2o: 'H₂O', kcl: 'KCl' }
const P_METHOD_LABELS = { cal: 'CAL', dl: 'DL' } as const

/** Soil of a field: site properties for the fertilization tables, lab results, fertilizer need. */
export function SoilTab({ field }: { field: Field }) {
  const { t } = useTranslation()
  const { can, orgId } = useOrg()
  const samples = useOrgQuery<SoilSample[]>('/soil-samples', { fieldId: field.id })
  const [adding, setAdding] = useState(false)
  const [needOpen, setNeedOpen] = useState(false)
  const remove = useOrgMutation((base, id: string) => api.delete(`${base}/soil-samples/${id}`), { success: t('soil.sample.deleted') })
  const editable = can('field.write')
  const cycleId = field.currentCrop?.cropCycleId

  return (
    <div className="space-y-6">
      <div className="grid lg:grid-cols-[1fr_1.4fr] gap-6 items-start">
        <SiteCard field={field} editable={editable} />
        <Card title={t('fertilizerNeed.title')} description={t('soil.need.description')}>
          {cycleId ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-fg-2">
                {t('soil.need.current', { crop: field.currentCrop!.cropName, season: field.currentCrop!.seasonName })}
              </p>
              <Button variant="primary" onPress={() => setNeedOpen(true)}>
                <FlaskConical /> {t('soil.need.open')}
              </Button>
            </div>
          ) : (
            <p className="text-sm text-muted">{t('soil.need.noCrop')}</p>
          )}
        </Card>
      </div>

      <Card
        title={t('soil.samples.title')}
        description={t('soil.samples.description')}
        padded={false}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link to="/o/$orgId/soil/$fieldId" params={{ orgId, fieldId: field.id }} className={buttonClass('secondary', 'sm')}>
              <Layers /> {t('soil.field.openPlanner')}
            </Link>
            {editable && (
              <Button size="sm" onPress={() => setAdding(true)}>
                <Plus /> {t('soil.sample.add')}
              </Button>
            )}
          </div>
        }
      >
        {samples.isLoading ? (
          <div className="p-4">
            <Loading />
          </div>
        ) : (
          <Table aria-label={t('soil.samples.title')}>
            <TableHeader>
              <Column isRowHeader>{t('common.date')}</Column>
              <Column>{t('common.type')}</Column>
              <Column>{t('soil.sample.lab')}</Column>
              <Column align="end">pH</Column>
              <Column align="end">P₂O₅</Column>
              <Column align="end">K₂O</Column>
              <Column align="end">MgO</Column>
              <Column align="end">{t('soil.humus')}</Column>
              <Column align="end">{t('soil.sample.nmin')}</Column>
              <Column>
                <span className="sr-only">{t('common.actions')}</span>
              </Column>
            </TableHeader>
            <TableBody
              items={samples.data ?? []}
              renderEmptyState={() => (
                <EmptyState icon={Layers} title={t('soil.samples.empty.title')}>
                  {t('soil.samples.empty.body')}
                </EmptyState>
              )}
            >
              {(s) => (
                <Row id={s.id}>
                  <Cell className="tabular whitespace-nowrap">
                    {fmt.date(s.sampledOn)}
                    {s.fieldPartName && <div className="text-xs text-muted">{s.fieldPartName}</div>}
                  </Cell>
                  <Cell>
                    <Badge tone={s.kind === 'basic' ? 'primary' : 'info'}>{s.kind === 'basic' ? t('soil.basicSample') : t('soil.nminSample')}</Badge>
                    {s.depthCm != null && <div className="text-xs text-muted mt-0.5">{t('soil.sample.depthValue', { value: s.depthCm })}</div>}
                  </Cell>
                  <Cell className="text-fg-2">
                    {s.lab ?? '—'}
                    {s.sampleNumber && <div className="text-xs text-muted">{s.sampleNumber}</div>}
                  </Cell>
                  <Cell align="end">
                    <SoilValue value={s.ph} cls={s.classes.ph} />
                    {s.phMethod && <div className="text-xs text-muted">{PH_METHOD_LABELS[s.phMethod]}</div>}
                  </Cell>
                  <Cell align="end">
                    <SoilValue value={s.p2o5Mg100g} cls={s.classes.p} />
                    {s.pMethod && <div className="text-xs text-muted">{P_METHOD_LABELS[s.pMethod]}</div>}
                  </Cell>
                  <Cell align="end"><SoilValue value={s.k2oMg100g} cls={s.classes.k} /></Cell>
                  <Cell align="end"><SoilValue value={s.mgoMg100g} cls={s.classes.mg} /></Cell>
                  <Cell align="end">{s.humusPct != null ? fmt.pct(s.humusPct, 1) : '—'}</Cell>
                  <Cell align="end">
                    {s.kind === 'nmin' ? (
                      <>
                        <span className="tabular font-medium">{fmt.num(s.nminTotal, 1)} kg N/ha</span>
                        <div className="text-xs text-muted tabular">{[s.nmin0to30, s.nmin30to60, s.nmin60to90].map((v) => fmt.num(v, 1)).join(' / ')}</div>
                      </>
                    ) : (
                      '—'
                    )}
                  </Cell>
                  <Cell>
                    {editable && (
                      <ConfirmButton
                        title={t('soil.sample.deleteTitle')}
                        message={t('soil.sample.deleteMessage', { date: fmt.date(s.sampledOn) })}
                        confirmLabel={t('common.delete')}
                        onConfirm={() => remove.mutateAsync(s.id)}
                        trigger={
                          <Button variant="ghost" size="icon-sm" aria-label={t('soil.sample.deleteLabel', { date: fmt.date(s.sampledOn) })}>
                            <Trash2 />
                          </Button>
                        }
                      />
                    )}
                  </Cell>
                </Row>
              )}
            </TableBody>
          </Table>
        )}
        <p className="px-4 py-3 border-t border-line text-xs text-muted">{t('soil.samples.units')}</p>
      </Card>

      {adding && <SampleDialog field={field} onClose={() => setAdding(false)} />}
      {needOpen && cycleId && <FertilizerNeedDialog cropCycleId={cycleId} onClose={() => setNeedOpen(false)} />}
    </div>
  )
}

function SiteCard({ field, editable }: { field: Field; editable: boolean }) {
  const { t } = useTranslation()
  const update = useOrgMutation((base, patch: { soilTexture?: SoilTexture | null; nitrateSensitiveZone?: boolean; phosphateSensitiveZone?: boolean }) =>
    api.patch<FieldSoilSummary>(`${base}/fields/${field.id}/site`, patch),
    { success: t('soil.site.saved') },
  )
  const texture = field.soilTexture as SoilTexture | null
  const soilClass = soilClassOf(texture)
  return (
    <Card title={t('soil.site.title')} description={t('soil.site.description')}>
      <div className="space-y-4">
        <Select
          label={t('soil.texture')}
          placeholder={t('soil.textureUnknown')}
          description={texture ? t(`soil.class.${soilClass}`) : t('soil.site.textureHint')}
          items={soilTextureItems()}
          value={texture}
          onChange={(v) => v !== texture && update.mutate({ soilTexture: (v as SoilTexture | null) ?? null })}
          isDisabled={!editable || update.isPending}
        >
          {(s) => <Option id={s.id}>{s.name}</Option>}
        </Select>
        <div className="flex flex-col gap-3">
          <Switch isSelected={field.nitrateSensitiveZone} onChange={(v) => update.mutate({ nitrateSensitiveZone: v })} isDisabled={!editable || update.isPending}>
            {t('soil.site.redZone')}
          </Switch>
          <Switch isSelected={field.phosphateSensitiveZone} onChange={(v) => update.mutate({ phosphateSensitiveZone: v })} isDisabled={!editable || update.isPending}>
            {t('soil.site.yellowZone')}
          </Switch>
        </div>
        {field.nitrateSensitiveZone && <p className="text-xs text-muted">{t('soil.site.redZoneHint')}</p>}
      </div>
    </Card>
  )
}

interface SampleForm {
  kind: 'basic' | 'nmin'
  sampledOn: string | null
  lab: string
  sampleNumber: string
  depthCm: number
  ph: number
  phMethod: PhMethod
  p2o5Mg100g: number
  pMethod: 'cal' | 'dl'
  k2oMg100g: number
  mgoMg100g: number
  humusPct: number
  soilTexture: SoilTexture | null
  nmin0to30: number
  nmin30to60: number
  nmin60to90: number
  notes: string
}

function SampleDialog({ field, onClose }: { field: Field; onClose: () => void }) {
  const { t } = useTranslation()
  const [form, setForm] = useState<SampleForm>({
    kind: 'basic',
    sampledOn: today(),
    lab: '',
    sampleNumber: '',
    depthCm: NaN,
    ph: NaN,
    phMethod: 'cacl2',
    p2o5Mg100g: NaN,
    pMethod: 'cal',
    k2oMg100g: NaN,
    mgoMg100g: NaN,
    humusPct: NaN,
    soilTexture: (field.soilTexture as SoilTexture | null) ?? null,
    nmin0to30: NaN,
    nmin30to60: NaN,
    nmin60to90: NaN,
    notes: '',
  })
  const set = <K extends keyof SampleForm>(k: K, v: SampleForm[K]) => setForm((f) => ({ ...f, [k]: v }))
  const basic = form.kind === 'basic'
  const payload = (): SoilSampleInput => ({
    fieldId: field.id,
    kind: form.kind,
    sampledOn: form.sampledOn ?? today(),
    lab: form.lab.trim() || null,
    sampleNumber: form.sampleNumber.trim() || null,
    depthCm: num(form.depthCm),
    notes: form.notes.trim() || null,
    ...(basic
      ? {
          ph: num(form.ph),
          phMethod: Number.isNaN(form.ph) ? null : form.phMethod,
          p2o5Mg100g: num(form.p2o5Mg100g),
          pMethod: Number.isNaN(form.p2o5Mg100g) ? null : form.pMethod,
          k2oMg100g: num(form.k2oMg100g),
          mgoMg100g: num(form.mgoMg100g),
          humusPct: num(form.humusPct),
          soilTexture: form.soilTexture,
        }
      : { nmin0to30: num(form.nmin0to30), nmin30to60: num(form.nmin30to60), nmin60to90: num(form.nmin60to90) }),
  })
  const save = useOrgMutation((base, _: void) => api.post<SoilSample>(`${base}/soil-samples`, payload()), { success: t('soil.sample.saved'), onSuccess: onClose })
  const nminEmpty = !basic && [form.nmin0to30, form.nmin30to60, form.nmin60to90].every(Number.isNaN)
  const mg = (key: 'p2o5Mg100g' | 'k2oMg100g' | 'mgoMg100g', label: string) => (
    <NumberField label={label} unit="mg/100 g" minValue={0} formatOptions={{ maximumFractionDigits: 1 }} value={form[key]} onChange={(v) => set(key, v)} />
  )
  const layer = (key: 'nmin0to30' | 'nmin30to60' | 'nmin60to90', label: string) => (
    <NumberField label={label} unit="kg N/ha" minValue={0} formatOptions={{ maximumFractionDigits: 1 }} value={form[key]} onChange={(v) => set(key, v)} />
  )

  return (
    <ModalDialog isOpen onOpenChange={(o) => !o && onClose()} title={t('soil.sample.addTitle', { field: field.name })}>
      <Form onSubmit={(e) => { e.preventDefault(); save.mutate() }} className="space-y-5">
        <SegmentedControl
          aria-label={t('common.type')}
          value={form.kind}
          onChange={(kind) => setForm((f) => ({ ...f, kind, depthCm: Number.isNaN(f.depthCm) && kind === 'nmin' ? 90 : f.depthCm }))}
          items={[
            { id: 'basic', label: t('soil.basicSample') },
            { id: 'nmin', label: t('soil.nminSample') },
          ]}
        />
        <div className="grid sm:grid-cols-2 gap-4">
          <DatePicker label={t('soil.sample.sampledOn')} value={form.sampledOn} onChange={(v) => set('sampledOn', v)} maxValue={today()} isRequired />
          <NumberField label={t('soil.sample.depth')} unit="cm" minValue={1} maxValue={200} value={form.depthCm} onChange={(v) => set('depthCm', v)} />
          <TextField label={t('soil.sample.lab')} value={form.lab} onChange={(v) => set('lab', v)} />
          <TextField label={t('soil.sample.number')} value={form.sampleNumber} onChange={(v) => set('sampleNumber', v)} />
        </div>
        {basic ? (
          <div className="grid sm:grid-cols-2 gap-4">
            <NumberField label="pH" minValue={2} maxValue={11} step={0.1} formatOptions={{ maximumFractionDigits: 2 }} value={form.ph} onChange={(v) => set('ph', v)} />
            <Select label={t('soil.sample.phMethod')} items={PH_METHODS.map((id) => ({ id, name: PH_METHOD_LABELS[id] }))} value={form.phMethod} onChange={(v) => v && set('phMethod', v as PhMethod)}>
              {(m) => <Option id={m.id}>{m.name}</Option>}
            </Select>
            {mg('p2o5Mg100g', 'P₂O₅')}
            <Select label={t('soil.sample.pMethod')} items={(['cal', 'dl'] as const).map((id) => ({ id, name: P_METHOD_LABELS[id] }))} value={form.pMethod} onChange={(v) => v && set('pMethod', v as 'cal' | 'dl')}>
              {(m) => <Option id={m.id}>{m.name}</Option>}
            </Select>
            {mg('k2oMg100g', 'K₂O')}
            {mg('mgoMg100g', 'MgO')}
            <NumberField label={t('soil.humus')} unit="%" minValue={0} maxValue={100} step={0.1} formatOptions={{ maximumFractionDigits: 2 }} value={form.humusPct} onChange={(v) => set('humusPct', v)} />
            <Select label={t('soil.texture')} placeholder={t('soil.textureUnknown')} items={soilTextureItems()} value={form.soilTexture} onChange={(v) => set('soilTexture', (v as SoilTexture | null) ?? null)}>
              {(s) => <Option id={s.id}>{s.name}</Option>}
            </Select>
          </div>
        ) : (
          <div className="grid sm:grid-cols-3 gap-4">
            {layer('nmin0to30', t('soil.sample.layer', { from: 0, to: 30 }))}
            {layer('nmin30to60', t('soil.sample.layer', { from: 30, to: 60 }))}
            {layer('nmin60to90', t('soil.sample.layer', { from: 60, to: 90 }))}
          </div>
        )}
        <TextField label={t('common.notes')} multiline rows={2} value={form.notes} onChange={(v) => set('notes', v)} />
        <div className="flex justify-end gap-2">
          <Button onPress={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" variant="primary" isPending={save.isPending} isDisabled={!form.sampledOn || nminEmpty}>
            {t('common.save')}
          </Button>
        </div>
      </Form>
    </ModalDialog>
  )
}
