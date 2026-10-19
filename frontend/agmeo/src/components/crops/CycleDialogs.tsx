import {
  CROP_CYCLE_STATUSES,
  CROP_ROLES,
  CROP_USAGES,
  type ApplyTemplateResult,
  type Crop,
  type CropCycle,
  type CropCycleStatus,
  type CropRole,
  type CropUsage,
  type CultivationTemplate,
  type FieldPart,
  type RegisteredVariety,
  type Variety,
} from '@agmeo/contracts'
import { ListChecks } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Form } from 'react-aria-components'
import { useTranslation } from 'react-i18next'
import { CropTag, templateStepTiming } from '#/components/labels'
import { cropRoleLabel, operationTypeLabel } from '#/i18n/labels'
import { ApiRequestError, api, errorMessage } from '#/lib/api'
import { fmt } from '#/lib/format'
import { useOrg } from '#/lib/org'
import { useOrgMutation, useOrgQuery } from '#/lib/queries'
import { Button, Link } from '#/ui/Button'
import { ComboBox, DatePicker, NumberField, Option, Select, TextField, num } from '#/ui/Field'
import { Loading, Notice } from '#/ui/Layout'
import { ConfirmButton, ModalDialog } from '#/ui/Overlay'

export interface CycleForm {
  cropId: string | null
  varietyName: string
  status: CropCycleStatus
  role: CropRole
  sowingDate: string | null
  expectedHarvestDate: string | null
  expectedYieldTHa: number
  expectedPricePerT: number
  areaHa: number
  usage: CropUsage
  seedLot: string
  multiplicationGeneration: string
  notes: string
}

export const EMPTY_CYCLE_FORM: CycleForm = { cropId: null, varietyName: '', status: 'planned', role: 'main', sowingDate: null, expectedHarvestDate: null, expectedYieldTHa: NaN, expectedPricePerT: NaN, areaHa: NaN, usage: 'commercial', seedLot: '', multiplicationGeneration: '', notes: '' }

/** Usage and seed details of a cycle form, as the API takes them. */
export const seedPayload = (f: CycleForm) => ({
  usage: f.usage,
  seedLot: f.usage === 'seed_multiplication' ? f.seedLot.trim() || null : null,
  multiplicationGeneration: f.usage === 'seed_multiplication' ? f.multiplicationGeneration.trim() || null : null,
})

export function useVarietyResolver() {
  return async (orgPath: string, cropId: string, name: string) => {
    if (!name.trim()) return null
    const v = await api.post<Variety>(`${orgPath}/varieties`, { cropId, name: name.trim() })
    return v.id
  }
}

export function CycleFields({ value, onChange, crops, showArea }: { value: CycleForm; onChange: (v: CycleForm) => void; crops: Crop[]; showArea?: boolean }) {
  const { t } = useTranslation()
  const statusLabels: Record<CropCycleStatus, string> = {
    planned: t('crops.status.planned'),
    active: t('crops.status.active'),
    harvested: t('crops.status.harvested'),
    closed: t('crops.status.closed'),
  }
  const set = <K extends keyof CycleForm>(k: K, v: CycleForm[K]) => onChange({ ...value, [k]: v })
  const varieties = useOrgQuery<Variety[]>('/varieties', { cropId: value.cropId ?? undefined }, { enabled: !!value.cropId })
  const registered = useOrgQuery<RegisteredVariety[]>(value.cropId ? `/crops/${value.cropId}/registered-varieties` : null, undefined, { staleTime: 3_600_000 })
  // The organization's own varieties first, then the rest of the Bundessortenamt register.
  const varietyOptions = useMemo(() => {
    const byRegisteredId = new Map((registered.data ?? []).map((r) => [r.id, r]))
    const used = (varieties.data ?? []).map((v) => ({ key: `org:${v.id}`, name: v.name, registered: v.registeredVarietyId ? byRegisteredId.get(v.registeredVarietyId) : undefined, used: true }))
    const usedNames = new Set(used.map((v) => v.name.toLowerCase()))
    const rest = (registered.data ?? []).filter((r) => !usedNames.has(r.name.toLowerCase())).map((r) => ({ key: `bsa:${r.id}`, name: r.name, registered: r, used: false }))
    return [...used, ...rest]
  }, [varieties.data, registered.data])
  const describeVariety = (o: (typeof varietyOptions)[number]) => {
    const r = o.registered
    const bsa = !r
      ? null
      : r.marketableUntil
        ? t('crops.form.varietyPhasingOut', { number: r.registrationNumber, date: fmt.date(r.marketableUntil) })
        : r.conservationRegion
          ? t('crops.form.varietyConservation', { number: r.registrationNumber, region: r.conservationRegion })
          : t('crops.form.varietyApproved', { number: r.registrationNumber, date: fmt.date(r.approvedOn) })
    return [o.used ? t('crops.form.varietyUsed') : null, bsa].filter(Boolean).join(' · ') || undefined
  }
  return (
    <div className="grid sm:grid-cols-2 gap-4">
      <ComboBox label={t('crops.form.crop')} isRequired items={crops} value={value.cropId} onChange={(v) => onChange({ ...value, cropId: v ? String(v) : null, varietyName: '' })} placeholder={t('crops.form.searchCrops')}>
        {(c) => (
          <Option id={c.id} textValue={c.name}>
            <CropTag name={c.name} color={c.color} />
          </Option>
        )}
      </ComboBox>
      <Select label={t('crops.form.role')} description={value.role !== 'main' ? t('crops.form.roleHint') : undefined} items={CROP_ROLES.map((r) => ({ id: r, name: cropRoleLabel(r) }))} value={value.role} onChange={(v) => v && set('role', v as CropRole)}>
        {(r) => <Option id={r.id}>{r.name}</Option>}
      </Select>
      <ComboBox
        label={t('crops.form.variety')}
        allowsCustomValue
        items={varietyOptions}
        inputValue={value.varietyName}
        onInputChange={(v) => set('varietyName', v)}
        isDisabled={!value.cropId}
        placeholder={t('crops.form.varietyPlaceholder')}
      >
        {(o) => (
          <Option id={o.key} textValue={o.name} description={describeVariety(o)}>
            {o.name}
          </Option>
        )}
      </ComboBox>
      <Select label={t('common.status')} items={CROP_CYCLE_STATUSES.map((s) => ({ id: s, name: statusLabels[s] }))} value={value.status} onChange={(v) => v && set('status', v as CropCycleStatus)}>
        {(s) => <Option id={s.id}>{s.name}</Option>}
      </Select>
      <DatePicker label={t('crops.form.sowingDate')} value={value.sowingDate} onChange={(v) => set('sowingDate', v)} />
      <DatePicker label={t('crops.form.expectedHarvest')} value={value.expectedHarvestDate} onChange={(v) => set('expectedHarvestDate', v)} />
      <NumberField label={t('crops.form.expectedYield')} unit="t/ha" minValue={0} step={0.1} formatOptions={{ maximumFractionDigits: 2 }} value={value.expectedYieldTHa} onChange={(v) => set('expectedYieldTHa', v)} />
      <NumberField label={t('crops.form.expectedPrice')} unit="€/t" minValue={0} value={value.expectedPricePerT} onChange={(v) => set('expectedPricePerT', v)} />
      <Select label={t('crops.form.usage')} items={CROP_USAGES.map((u) => ({ id: u, name: t(`crops.usage.${u}`) }))} value={value.usage} onChange={(v) => v && set('usage', v as CropUsage)}>
        {(u) => <Option id={u.id}>{u.name}</Option>}
      </Select>
      {value.usage === 'seed_multiplication' ? (
        <div className="grid grid-cols-2 gap-3">
          <TextField label={t('crops.form.seedLot')} value={value.seedLot} onChange={(v) => set('seedLot', v)} />
          <TextField label={t('crops.form.generation')} placeholder="Z1" value={value.multiplicationGeneration} onChange={(v) => set('multiplicationGeneration', v)} />
        </div>
      ) : <div />}
      {showArea && <NumberField label={t('crops.form.plantedArea')} unit="ha" minValue={0} step={0.01} description={t('crops.form.plantedAreaHint')} value={value.areaHa} onChange={(v) => set('areaHa', v)} />}
      <TextField label={t('common.notes')} multiline rows={2} value={value.notes} onChange={(v) => set('notes', v)} className="sm:col-span-2" />
    </div>
  )
}

export function EditCycleDialog({ cycle, onClose, onDelete }: { cycle: CropCycle; onClose: () => void; onDelete?: () => Promise<unknown> }) {
  const { t } = useTranslation()
  const crops = useOrgQuery<Crop[]>('/crops')
  const resolveVariety = useVarietyResolver()
  // A crop on a field divided in its season can move to another part (not to a leased-out one).
  const parts = useOrgQuery<FieldPart[]>(`/fields/${cycle.fieldId}/parts`, { seasonId: cycle.seasonId })
  const [fieldPartId, setFieldPartId] = useState(cycle.fieldPartId)
  const [form, setForm] = useState<CycleForm>({
    cropId: cycle.cropId,
    varietyName: cycle.varietyName ?? '',
    status: cycle.status,
    role: cycle.role,
    sowingDate: cycle.sowingDate,
    expectedHarvestDate: cycle.expectedHarvestDate,
    expectedYieldTHa: cycle.expectedYieldTHa ?? NaN,
    expectedPricePerT: cycle.expectedPricePerT ?? NaN,
    areaHa: NaN,
    usage: cycle.usage,
    seedLot: cycle.seedLot ?? '',
    multiplicationGeneration: cycle.multiplicationGeneration ?? '',
    notes: cycle.notes ?? '',
  })
  const save = useOrgMutation(
    async (base, _: void) => {
      const varietyId = form.cropId ? await resolveVariety(base, form.cropId, form.varietyName) : null
      return api.patch<CropCycle>(`${base}/crop-cycles/${cycle.id}`, {
        cropId: form.cropId,
        varietyId,
        status: form.status,
        role: form.role,
        sowingDate: form.sowingDate,
        expectedHarvestDate: form.expectedHarvestDate,
        expectedYieldTHa: num(form.expectedYieldTHa),
        expectedPricePerT: num(form.expectedPricePerT),
        ...(Number.isNaN(form.areaHa) ? {} : { areaHa: form.areaHa }),
        ...(fieldPartId && fieldPartId !== cycle.fieldPartId ? { fieldPartId } : {}),
        ...seedPayload(form),
        notes: form.notes || null,
      })
    },
    { success: t('crops.updated'), onSuccess: onClose },
  )
  return (
    <ModalDialog isOpen onOpenChange={(o) => !o && onClose()} title={`${cycle.fieldName} · ${cycle.seasonName}`} size="md">
      <Form onSubmit={(e) => { e.preventDefault(); save.mutate() }} className="space-y-4">
        {(parts.data?.length ?? 0) > 0 && (
          <Select
            label={t('crops.part')}
            description={t('crops.partDescription')}
            items={parts.data ?? []}
            value={fieldPartId}
            onChange={(v) => setFieldPartId(v ? String(v) : cycle.fieldPartId)}
            disabledKeys={(parts.data ?? []).filter((p) => p.usage === 'leased_out' && p.id !== cycle.fieldPartId).map((p) => p.id)}
          >
            {(p) => (
              <Option
                id={p.id}
                textValue={p.name}
                description={[
                  fmt.ha(p.areaHa, 1),
                  t(`fieldParts.usage.${p.usage}`),
                  ...p.crops.filter((c) => c.cropCycleId !== cycle.id).map((c) => c.cropName),
                ].join(' · ')}
              >
                {p.name}
              </Option>
            )}
          </Select>
        )}
        <CycleFields value={form} onChange={setForm} crops={crops.data ?? []} showArea />
        <div className="flex justify-end gap-2">
          {onDelete && (
            <>
              <ConfirmButton title={t('crops.removeTitle', { name: cycle.cropName })} message={t('crops.removeMessage')} confirmLabel={t('crops.remove')} onConfirm={async () => { await onDelete(); onClose() }} trigger={<Button variant="danger">{t('crops.remove')}</Button>} />
              <div className="flex-1" />
            </>
          )}
          <Button onPress={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" variant="primary" isDisabled={!form.cropId || parts.isLoading} isPending={save.isPending}>{t('common.save')}</Button>
        </div>
      </Form>
    </ModalDialog>
  )
}

export function ApplyTemplateDialog({ cycle, onClose }: { cycle: CropCycle; onClose: () => void }) {
  const { t } = useTranslation()
  const { orgId } = useOrg()
  const templates = useOrgQuery<CultivationTemplate[]>('/templates')
  const options = (templates.data ?? []).filter((x) => x.cropId === cycle.cropId)
  const [picked, setPicked] = useState<string | null>(cycle.templateId)
  const selected = options.find((x) => x.id === picked) ?? options[0]
  const apply = useOrgMutation(
    (base, replace: boolean) => api.post<ApplyTemplateResult>(`${base}/crop-cycles/${cycle.id}/apply-template`, { templateId: selected?.id, replace }),
    {
      success: (r) => (r.removed ? t('templates.apply.replaced', { count: r.created, removed: r.removed }) : t('templates.apply.success', { count: r.created })),
      onSuccess: onClose,
      silentError: true,
    },
  )
  // Applied before: the API keeps completed work and only swaps the planned operations, on request.
  const alreadyApplied = (apply.error instanceof ApiRequestError && apply.error.code === 'template_applied') || (apply.isPending && apply.variables === true)
  return (
    <ModalDialog isOpen onOpenChange={(o) => !o && onClose()} title={t('templates.apply.title')} description={`${cycle.fieldName}${cycle.fieldPartName ? ` · ${cycle.fieldPartName}` : ''} · ${cycle.cropName} · ${cycle.seasonName}`} size="md">
      {templates.isLoading ? (
        <Loading />
      ) : !options.length ? (
        <div className="space-y-4">
          <Notice tone="info">{t('templates.apply.none', { crop: cycle.cropName })}</Notice>
          <div className="flex justify-end gap-2">
            <Button onPress={onClose}>{t('common.close')}</Button>
            <Link to="/o/$orgId/templates" params={{ orgId }} variant="primary"><ListChecks /> {t('nav.templates')}</Link>
          </div>
        </div>
      ) : (
        <Form onSubmit={(e) => { e.preventDefault(); apply.mutate(alreadyApplied) }} className="space-y-4">
          <Select
            label={t('templates.apply.template')}
            items={options}
            value={selected?.id ?? null}
            onChange={(v) => { setPicked(v ? String(v) : null); apply.reset() }}
          >
            {(x) => <Option id={x.id} textValue={x.name} description={t('templates.stepCount', { count: x.steps.length })}>{x.name}</Option>}
          </Select>
          {cycle.templateName && <p className="text-xs text-muted">{t('templates.apply.current', { name: cycle.templateName })}</p>}
          {selected && selected.steps.length > 0 && (
            <ol className="rounded-lg border border-line divide-y divide-line max-h-64 overflow-y-auto text-sm">
              {selected.steps.map((s) => (
                <li key={s.id} className="px-3 py-2 flex items-baseline justify-between gap-3">
                  <span className="min-w-0">
                    <span className="block truncate text-fg">{s.title}</span>
                    <span className="block text-xs text-muted">{operationTypeLabel(s.type)}{s.bbchStage ? ` · BBCH ${s.bbchStage}` : ''}</span>
                  </span>
                  <span className="text-xs text-muted whitespace-nowrap">{templateStepTiming(s.anchor, s.offsetDays)}</span>
                </li>
              ))}
            </ol>
          )}
          <p className="text-xs text-muted">{t('templates.apply.hint')}</p>
          {alreadyApplied ? (
            <Notice tone="warning">{t('templates.apply.alreadyApplied')}</Notice>
          ) : (
            apply.error && <Notice tone="danger">{errorMessage(apply.error)}</Notice>
          )}
          <div className="flex justify-end gap-2">
            <Button onPress={onClose}>{t('common.cancel')}</Button>
            <Button type="submit" variant="primary" isDisabled={!selected} isPending={apply.isPending}>
              {alreadyApplied ? t('templates.apply.replace') : t('templates.apply.submit')}
            </Button>
          </div>
        </Form>
      )}
    </ModalDialog>
  )
}
