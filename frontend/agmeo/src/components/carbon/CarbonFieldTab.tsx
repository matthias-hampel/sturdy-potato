import {
  type AveragedRothCResult,
  CARBON_SOIL_DEPTH_CM,
  type CarbonSoil,
  type CarbonSoilInput,
  type CropRotation,
  type RotationCarbon,
  type RothCInput,
  type RothCResult,
} from '@agmeo/contracts'
import { useMutation } from '@tanstack/react-query'
import { BarChart3, CheckCircle2, Download, FlaskConical, Info, type LucideIcon, Paperclip, Play, Repeat } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BandLineChart } from '#/components/charts'
import { t as i18nT } from '#/i18n'
import { uploadBatch } from '#/components/files/upload'
import { api, ApiRequestError, errorMessage, saveBlob } from '#/lib/api'
import { fmt } from '#/lib/format'
import { useOrg, useSeason } from '#/lib/org'
import { useOrgMutation, useOrgQuery } from '#/lib/queries'
import { downloadXlsx } from '#/lib/xlsx'
import { Button, Link, SegmentedControl } from '#/ui/Button'
import { NumberField, Option, Select } from '#/ui/Field'
import { Card, ErrorNotice, Loading, Notice } from '#/ui/Layout'
import { ConfirmButton, ModalDialog, Tooltip } from '#/ui/Overlay'
import { toast } from '#/ui/Toast'
import { cx } from '#/ui/utils'

/*
 * Soil carbon of a field under a crop rotation (agmeo fields/[year]/[fieldId]/[cultivationId]/carbon):
 * topsoil values → rotation (and an optional comparison) → Thünen RothC simulation over five
 * weather windows → yearly table with the rotation's CO2e and the soil-carbon change, and the
 * averaged SOC series with its min/max band.
 */

type Step = 'soil' | 'technology' | 'simulation' | 'results'
const STEPS: { id: Step; icon: LucideIcon }[] = [
  { id: 'soil', icon: FlaskConical },
  { id: 'technology', icon: Repeat },
  { id: 'simulation', icon: Play },
  { id: 'results', icon: BarChart3 },
]
const YEARS = 10
const CO2_PER_MG_C = 1000 * 3.67

export function CarbonFieldTab({ fieldId, fieldName }: { fieldId: string; fieldName: string }) {
  const { t } = useTranslation()
  const { orgId } = useOrg()
  const { season } = useSeason()
  const soil = useOrgQuery<CarbonSoil>(`/fields/${fieldId}/carbon/soil`)
  const rotations = useOrgQuery<CropRotation[]>('/rotations')
  const [step, setStep] = useState<Step>('soil')
  const year = season?.harvestYear ?? new Date().getFullYear()

  const assigned = (rotations.data ?? []).find((r) => r.fields.some((f) => f.fieldId === fieldId && f.startYear <= year && (f.endYear == null || f.endYear >= year))) ?? null
  const [primaryChoice, setPrimary] = useState<string | null>(null)
  const primaryId = primaryChoice ?? assigned?.id ?? null
  const primary = rotations.data?.find((r) => r.id === primaryId) ?? null
  const [compareId, setCompare] = useState<string | null>(null)
  const compare = rotations.data?.find((r) => r.id === compareId && r.id !== primaryId) ?? null
  const [startPrimary, setStartPrimary] = useState(0)
  const [startCompare, setStartCompare] = useState(0)

  const simulate = useMutation({
    mutationFn: async () => {
      const run = (input: RothCInput) => api.post<RothCResult>(`/orgs/${orgId}/fields/${fieldId}/carbon/rothc`, input)
      const [a, b] = await Promise.all([run({ rotationId: primaryId!, startPosition: startPrimary }), compare ? run({ rotationId: compare.id, startPosition: startCompare }) : Promise.resolve(null)])
      return { primary: a, compare: b }
    },
  })

  const soilDone = Boolean(soil.data?.saved)
  const techDone = Boolean(primary && primary.entries.length)
  const simDone = simulate.isSuccess
  const canAccess = (s: Step) => s === 'soil' || (s === 'technology' && soilDone) || (s === 'simulation' && soilDone && techDone) || (s === 'results' && simDone)
  const done = (s: Step) => (s === 'soil' ? soilDone : s === 'technology' ? techDone : simDone)
  const go = (s: Step) => {
    if (!canAccess(s)) return
    if (s === 'simulation' && !simulate.isPending) simulate.mutate()
    setStep(s)
  }

  if (soil.isLoading || rotations.isLoading) return <Loading />
  if (soil.error) return <ErrorNotice error={soil.error} />

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs uppercase tracking-wide text-muted">{t('carbonTab.kicker')}</p>
        <h2 className="text-lg font-semibold">{t('carbonTab.title')}</h2>
      </div>
      <ol className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {STEPS.map((s, i) => {
          const Icon = s.icon
          const active = step === s.id
          return (
            <li key={s.id}>
              <button
                type="button"
                disabled={!canAccess(s.id)}
                onClick={() => go(s.id)}
                className={cx(
                  'relative w-full flex flex-col items-center gap-2 rounded-xl border p-4 text-center transition-colors',
                  active ? 'border-primary bg-primary-soft' : 'border-line bg-surface hover:bg-surface-2',
                  !canAccess(s.id) && 'opacity-50 cursor-not-allowed',
                )}
              >
                <span className={cx('flex size-10 items-center justify-center rounded-full', active || done(s.id) ? 'bg-primary text-primary-fg' : 'bg-surface-2 text-muted')}>
                  <Icon className="size-5" />
                </span>
                <span className="text-xs text-muted">{i + 1}</span>
                <span className="text-sm font-medium">{t(`carbonTab.steps.${s.id}`)}</span>
                <span className="text-xs text-muted">{t(`carbonTab.steps.${s.id}Info`)}</span>
                {done(s.id) && <CheckCircle2 className="absolute right-2 top-2 size-4 text-success" aria-label={t('carbonTab.stepDone')} />}
              </button>
            </li>
          )
        })}
      </ol>

      {step === 'soil' && soil.data && <SoilStep soil={soil.data} fieldId={fieldId} year={year} onSaved={() => simulate.reset()} />}
      {step === 'technology' && (
        <Card title={t('carbonTab.rotation.title')} description={t('carbonTab.rotation.description')}>
          <TechnologyStep
            rotations={rotations.data ?? []}
            assigned={assigned}
            fieldId={fieldId}
            year={year}
            primary={primary}
            compare={compare}
            startPrimary={startPrimary}
            startCompare={startCompare}
            onPrimary={(id) => {
              setPrimary(id)
              setStartPrimary(0)
              simulate.reset()
            }}
            onCompare={(id) => {
              setCompare(id)
              setStartCompare(0)
              simulate.reset()
            }}
            onStartPrimary={setStartPrimary}
            onStartCompare={setStartCompare}
          />
        </Card>
      )}
      {step === 'simulation' && (
        <Card>
          <div className="flex flex-col items-center gap-4 py-8 text-center">
            {simulate.isPending ? (
              <>
                <span className="size-8 animate-spin rounded-full border-4 border-surface-3 border-t-primary" aria-hidden />
                <p className="text-sm text-fg-2">{t('carbonTab.simulation.running')}</p>
              </>
            ) : simulate.error ? (
              <>
                <p className="text-sm font-medium text-danger">{simulationError(simulate.error)}</p>
                <p className="max-w-md text-xs text-muted">{t('carbonTab.simulation.errorHint')}</p>
                <Button onPress={() => simulate.mutate()}>{t('common.retry')}</Button>
              </>
            ) : simulate.isSuccess ? (
              <>
                <p className="text-sm text-success">{t('carbonTab.simulation.complete')}</p>
                <Button variant="primary" onPress={() => setStep('results')}>
                  {t('carbonTab.steps.results')}
                </Button>
              </>
            ) : (
              <Button variant="primary" onPress={() => simulate.mutate()}>
                <Play /> {t('carbonTab.simulation.run')}
              </Button>
            )}
          </div>
        </Card>
      )}
      {step === 'results' && simulate.data && primary && (
        <ResultsStep fieldId={fieldId} fieldName={fieldName} primary={primary} compare={compare} startPrimary={startPrimary} startCompare={startCompare} result={simulate.data} />
      )}
    </div>
  )
}

function simulationError(error: unknown): string {
  if (error instanceof ApiRequestError) {
    if (error.code === 'carbon_model_unavailable') return i18nT('carbonTab.error.unavailable')
    if (error.code === 'carbon_model_failed' || [502, 503, 504].includes(error.status)) return i18nT('carbonTab.error.externalService')
  }
  return errorMessage(error)
}

// ---------------------------------------------------------------------------
// Step 1: topsoil values
// ---------------------------------------------------------------------------

const SOIL_FIELDS = [
  { key: 'bulkDensity', unit: 'g/cm³', min: 0.5, max: 2, step: 0.01 },
  { key: 'clayPct', unit: '%', min: 0, max: 100, step: 0.1 },
  { key: 'socPct', unit: '%', min: 0.1, max: 10, step: 0.1 },
  { key: 'sandPct', unit: '%', min: 0, max: 100, step: 0.1 },
] as const

function SoilStep({ soil, fieldId, year, onSaved }: { soil: CarbonSoil; fieldId: string; year: number; onSaved: () => void }) {
  const { t } = useTranslation()
  const { can, orgId } = useOrg()
  const [open, setOpen] = useState(false)
  const v = soil.values
  const remove = useOrgMutation((base) => api.delete(`${base}/fields/${fieldId}/carbon/soil`), { success: t('carbonTab.soil.deleted'), onSuccess: onSaved })
  return (
    <Card
      title={t('carbonTab.soil.title')}
      description={soil.saved ? t('carbonTab.soil.saved', { date: fmt.dateTime(soil.saved.updatedAt) }) : t(`carbonTab.soil.prefilled.${soil.prefillSource}`)}
      actions={
        can('field.write') && (
          <>
            {soil.saved && (
              <ConfirmButton
                title={t('carbonTab.soil.delete')}
                message={t('carbonTab.soil.deleteConfirm')}
                confirmLabel={t('common.delete')}
                onConfirm={() => remove.mutateAsync(undefined)}
                trigger={<Button variant="ghost">{t('common.delete')}</Button>}
              />
            )}
            <Button variant={soil.saved ? 'secondary' : 'primary'} onPress={() => setOpen(true)}>
              {soil.saved ? t('carbonTab.soil.edit') : t('carbonTab.soil.add')}
            </Button>
          </>
        )
      }
    >
      {!soil.saved && <Notice tone="warning" className="mb-4">{t('carbonTab.soil.requiredToRun')}</Notice>}
      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="rounded-lg border border-line p-3">
          <dt className="text-xs uppercase tracking-wide text-muted">{t('carbonTab.soil.depth')}</dt>
          <dd className="mt-1 text-lg font-semibold tabular">{v.depthCm} cm</dd>
        </div>
        {SOIL_FIELDS.map((f) => (
          <div key={f.key} className="rounded-lg border border-line p-3">
            <dt className="text-xs uppercase tracking-wide text-muted">{t(`carbonTab.soil.${f.key}`)}</dt>
            <dd className="mt-1 text-lg font-semibold tabular">
              {fmt.num(v[f.key], 2)} <span className="text-sm font-normal text-muted">{f.unit}</span>
            </dd>
          </div>
        ))}
      </dl>
      {soil.saved?.fileId ? (
        <Button variant="quiet" size="sm" className="mt-3" onPress={() => api.download(`/orgs/${orgId}/files/${soil.saved!.fileId}/content`, undefined, soil.saved!.fileName ?? 'attachment')}>
          <Paperclip /> {soil.saved.fileName ?? t('carbonTab.soil.attachment')}
        </Button>
      ) : (
        <p className="mt-3 text-xs text-muted">{t('carbonTab.soil.attachmentOptional')}</p>
      )}
      {open && <SoilDialog soil={soil} fieldId={fieldId} year={year} onClose={() => setOpen(false)} onSaved={onSaved} />}
    </Card>
  )
}

function SoilDialog({ soil, fieldId, year, onClose, onSaved }: { soil: CarbonSoil; fieldId: string; year: number; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation()
  const { orgId, can } = useOrg()
  const [values, setValues] = useState({ bulkDensity: soil.values.bulkDensity, clayPct: soil.values.clayPct, socPct: soil.values.socPct, sandPct: soil.values.sandPct })
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const save = useOrgMutation((base, input: CarbonSoilInput) => api.put<CarbonSoil>(`${base}/fields/${fieldId}/carbon/soil`, input), {
    success: t('carbonTab.soil.savedToast'),
    onSuccess: () => {
      onSaved()
      onClose()
    },
  })
  const errors: Partial<Record<keyof typeof values, string>> = {}
  for (const f of SOIL_FIELDS) {
    const x = values[f.key]
    if (Number.isNaN(x)) errors[f.key] = t('carbonTab.soil.validation.number')
    else if (x < f.min || x > f.max) errors[f.key] = t('carbonTab.soil.validation.range', { min: f.min, max: f.max })
  }
  if (!errors.sandPct && values.clayPct + values.sandPct > 100) errors.sandPct = t('carbonTab.soil.validation.claySand')
  const invalid = Object.keys(errors).length > 0
  const submit = async () => {
    let fileId = soil.saved?.fileId ?? null
    if (file) {
      setUploading(true)
      try {
        const [stored] = await uploadBatch(orgId, null, year, [file], () => undefined, new AbortController().signal)
        fileId = stored?.id ?? fileId
      } catch (e) {
        toast.error(t('carbonTab.soil.uploadFailed'), errorMessage(e))
        setUploading(false)
        return
      }
      setUploading(false)
    }
    save.mutate({ ...values, fileId, sampledOn: soil.saved?.sampledOn ?? null })
  }
  return (
    <ModalDialog
      isOpen
      onOpenChange={(o) => !o && onClose()}
      title={soil.saved ? t('carbonTab.soil.edit') : t('carbonTab.soil.add')}
      description={t('carbonTab.soil.dialogDescription', { depth: CARBON_SOIL_DEPTH_CM })}
      footer={(close) => (
        <>
          <Button onPress={close}>{t('common.cancel')}</Button>
          <Button variant="primary" isDisabled={invalid || !can('field.write')} isPending={uploading || save.isPending} onPress={submit}>
            {t('carbonTab.soil.save')}
          </Button>
        </>
      )}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <NumberField label={t('carbonTab.soil.depth')} unit="cm" value={CARBON_SOIL_DEPTH_CM} isReadOnly description={t('carbonTab.soil.depthLocked')} />
        {SOIL_FIELDS.map((f) => (
          <NumberField
            key={f.key}
            label={t(`carbonTab.soil.${f.key}`)}
            unit={f.unit}
            step={f.step}
            minValue={f.min}
            maxValue={f.max}
            value={values[f.key]}
            onChange={(x) => setValues((v) => ({ ...v, [f.key]: x }))}
            isInvalid={Boolean(errors[f.key])}
            errorMessage={errors[f.key]}
            formatOptions={{ maximumFractionDigits: 2 }}
          />
        ))}
      </div>
      <div className="mt-5 space-y-2">
        <h3 className="text-sm font-semibold">{t('carbonTab.soil.attachments')}</h3>
        <p className="text-xs text-muted">{t('carbonTab.soil.attachmentsDescription')}</p>
        {soil.saved?.fileName && !file && (
          <p className="text-sm">
            <Paperclip className="inline size-4 mr-1" aria-hidden />
            {soil.saved.fileName}
          </p>
        )}
        <label className="inline-flex items-center gap-2 text-sm">
          <input type="file" className="text-sm" onChange={(e) => setFile(e.target.files?.[0] ?? null)} aria-label={t('carbonTab.soil.upload')} />
        </label>
      </div>
    </ModalDialog>
  )
}

// ---------------------------------------------------------------------------
// Step 2: rotation
// ---------------------------------------------------------------------------

function TechnologyStep(props: {
  rotations: CropRotation[]
  assigned: CropRotation | null
  fieldId: string
  year: number
  primary: CropRotation | null
  compare: CropRotation | null
  startPrimary: number
  startCompare: number
  onPrimary: (id: string | null) => void
  onCompare: (id: string | null) => void
  onStartPrimary: (p: number) => void
  onStartCompare: (p: number) => void
}) {
  const { t } = useTranslation()
  const { orgId, can } = useOrg()
  const { rotations, assigned, primary, compare } = props
  const saveAssignment = useOrgMutation((base, rotationId: string) => api.post<CropRotation>(`${base}/rotations/${rotationId}/fields`, { fieldIds: [props.fieldId], startYear: props.year }), {
    success: t('carbonTab.rotation.savedToast'),
  })
  const rotationItems = rotations.map((r) => ({ id: r.id, name: r.id === assigned?.id ? `${r.name} (${t('carbonTab.rotation.current')})` : r.name }))
  const entryItems = (r: CropRotation | null) => (r?.entries ?? []).map((e, i) => ({ id: e.position, name: `${i + 1}. ${e.cropName}${e.templateName ? ` (${e.templateName})` : ''}${e.catchCropName ? ` + ${e.catchCropName}` : ''}` }))
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-fg-2">{t('carbonTab.rotation.savedLabel', { name: assigned?.name ?? t('carbonTab.rotation.noneSaved') })}</span>
        <Link to="/o/$orgId/rotations" params={{ orgId }} variant="quiet" size="sm" className="ml-auto">
          {t('carbonTab.rotation.manage')}
        </Link>
        {can('crop.write') && (
          <Button variant="primary" isDisabled={!primary || primary.id === assigned?.id} isPending={saveAssignment.isPending} onPress={() => primary && saveAssignment.mutate(primary.id)}>
            {t('carbonTab.rotation.saveSelection')}
          </Button>
        )}
      </div>
      {!rotations.length && <Notice tone="info">{t('carbonTab.rotation.noneAvailable')}</Notice>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Select label={t('carbonTab.rotation.label')} placeholder={t('carbonTab.rotation.selectPlaceholder')} items={rotationItems} value={primary?.id ?? null} onChange={(v) => props.onPrimary(v ? String(v) : null)}>
          {(r) => <Option id={r.id}>{r.name}</Option>}
        </Select>
        <Select label={t('carbonTab.entry.label')} description={t('carbonTab.entry.helper')} items={entryItems(primary)} isDisabled={!primary?.entries.length} value={props.startPrimary} onChange={(v) => v != null && props.onStartPrimary(Number(v))}>
          {(e) => <Option id={e.id}>{e.name}</Option>}
        </Select>
      </div>
      {primary && !primary.entries.length && <Notice tone="warning">{t('carbonTab.rotation.noEntries')}</Notice>}
      <div className="space-y-3 rounded-lg border border-dashed border-line p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-sm font-medium">{t('carbonTab.compare.title')}</p>
            <p className="text-xs text-muted">{t('carbonTab.compare.description')}</p>
          </div>
          {compare && <Button onPress={() => props.onCompare(null)}>{t('carbonTab.compare.clear')}</Button>}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label={t('carbonTab.rotation.label')} placeholder={t('carbonTab.compare.selectPlaceholder')} items={rotationItems.filter((r) => r.id !== primary?.id)} value={compare?.id ?? null} onChange={(v) => props.onCompare(v ? String(v) : null)}>
            {(r) => <Option id={r.id}>{r.name}</Option>}
          </Select>
          <Select label={t('carbonTab.entry.label')} items={entryItems(compare)} isDisabled={!compare?.entries.length} value={props.startCompare} onChange={(v) => v != null && props.onStartCompare(Number(v))}>
            {(e) => <Option id={e.id}>{e.name}</Option>}
          </Select>
        </div>
      </div>
      {primary && (
        <div className="space-y-2 border-t border-line pt-4">
          <p className="text-sm font-medium">{t('carbonTab.preview.title')}</p>
          <p className="text-xs text-muted">{t('carbonTab.preview.helper')}</p>
          <RotationTable primary={primary} compare={compare} startPrimary={props.startPrimary} startCompare={props.startCompare} />
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Yearly table (preview and results)
// ---------------------------------------------------------------------------

/** Rotation entries laid over ten years from the start position. */
function ordered(r: CropRotation, start: number) {
  const sorted = [...r.entries].sort((a, b) => a.position - b.position)
  const idx = Math.max(0, sorted.findIndex((e) => e.position === start))
  const list = [...sorted.slice(idx), ...sorted.slice(0, idx)]
  return Array.from({ length: YEARS }, (_, i) => list[i % list.length])
}

/** Yearly change of the SOC stock as CO2e (kg/ha): loss positive, sequestration negative. */
function rothcYearly(results: AveragedRothCResult[] | null | undefined): (number | null)[] {
  return Array.from({ length: YEARS }, (_, y) => {
    const months = results?.slice(y * 12, y * 12 + 12) ?? []
    if (!months.length) return null
    return (months[months.length - 1].SOC_stock_Mg_C_ha_1 - months[0].SOC_stock_Mg_C_ha_1) * CO2_PER_MG_C * -1
  })
}

function RotationTable({
  primary,
  compare,
  startPrimary,
  startCompare,
  results,
  exportName,
}: {
  primary: CropRotation
  compare: CropRotation | null
  startPrimary: number
  startCompare: number
  results?: { primary: AveragedRothCResult[]; compare: AveragedRothCResult[] | null }
  exportName?: string
}) {
  const { t } = useTranslation()
  const co2a = useOrgQuery<RotationCarbon>(`/carbon/rotations/${primary.id}`)
  const co2b = useOrgQuery<RotationCarbon>(compare ? `/carbon/rotations/${compare.id}` : null)
  if (!primary.entries.length) return null
  const sides = [
    { r: primary, start: startPrimary, co2: co2a.data, rothc: rothcYearly(results?.primary) },
    ...(compare && compare.entries.length ? [{ r: compare, start: startCompare, co2: co2b.data, rothc: rothcYearly(results?.compare) }] : []),
  ]
  const hasResults = Boolean(results)
  const cols = [
    { id: 'crop', label: t('carbonTab.table.crop') },
    { id: 'template', label: t('carbonTab.table.template') },
    { id: 'yield', label: t('carbonTab.table.yield') },
    { id: 'catch', label: t('carbonTab.table.catchCrop') },
    { id: 'co2e', label: t('carbonTab.table.co2e'), title: t('carbonTab.table.co2eTooltip') },
    ...(hasResults
      ? [
          { id: 'rothc', label: t('carbonTab.table.rothcCo2e'), title: t('carbonTab.table.rothcCo2eTooltip') },
          { id: 'sum', label: t('carbonTab.table.yearlyTotal'), title: t('carbonTab.table.yearlyTotalTooltip') },
        ]
      : []),
  ]
  const num = (v: number | null | undefined) => (v == null ? '/' : fmt.num(Math.round(v)))
  const signed = (v: number | null | undefined) => (v == null ? '/' : `${v > 0 ? '+' : ''}${fmt.num(Math.round(v))}`)
  const cell = (side: (typeof sides)[number], y: number, col: string): string => {
    const e = ordered(side.r, side.start)[y]
    const co2 = side.co2?.entries.find((x) => x.position === e.position)?.co2eKgPerHa ?? null
    const rothc = side.rothc[y]
    switch (col) {
      case 'crop':
        return e.cropName
      case 'template':
        return e.templateName ?? '—'
      case 'yield':
        return e.expectedYieldTHa != null ? fmt.num(e.expectedYieldTHa, 1) : '/'
      case 'catch':
        return e.catchCropName ?? t('common.no')
      case 'co2e':
        return num(co2)
      case 'rothc':
        return signed(rothc)
      default:
        return co2 != null && rothc != null ? signed(co2 + rothc) : '/'
    }
  }
  const totals = sides.map((s) => {
    const sum = (f: (y: number) => number | null) => {
      const vals = Array.from({ length: YEARS }, (_, y) => f(y)).filter((v): v is number => v != null)
      return vals.length ? vals.reduce((a, b) => a + b, 0) : null
    }
    const co2 = (y: number) => s.co2?.entries.find((x) => x.position === ordered(s.r, s.start)[y].position)?.co2eKgPerHa ?? null
    return { co2e: sum(co2), rothc: sum((y) => s.rothc[y]), sum: sum((y) => (co2(y) != null && s.rothc[y] != null ? co2(y)! + s.rothc[y]! : null)) }
  })
  const header = [t('carbonTab.table.year'), ...cols.flatMap((c) => sides.map((s) => (sides.length > 1 ? `${c.label} (${s.r.name})` : c.label)))]
  const rows = Array.from({ length: YEARS }, (_, y) => [t('carbonTab.table.yearN', { year: y + 1 }), ...cols.flatMap((c) => sides.map((s) => cell(s, y, c.id)))])
  const totalRow = [t('carbonTab.table.total'), ...cols.flatMap((c) => sides.map((_, i) => (c.id === 'co2e' ? num(totals[i].co2e) : c.id === 'rothc' ? signed(totals[i].rothc) : c.id === 'sum' ? signed(totals[i].sum) : '')))]
  const exportCsv = () => {
    const csv = [header, ...rows, totalRow].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n')
    saveBlob(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }), `${exportName ?? 'fruchtfolge'}.csv`)
  }
  return (
    <div className="space-y-2">
      <div className="flex justify-end gap-2">
        <Button size="sm" onPress={exportCsv}>
          <Download /> CSV
        </Button>
        <Button size="sm" onPress={() => downloadXlsx(exportName ?? 'fruchtfolge', [{ name: t('carbonTab.table.sheet'), header, rows: [...rows, totalRow] }])}>
          <Download /> Excel
        </Button>
      </div>
      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full text-sm border-separate border-spacing-0">
          <thead>
            <tr>
              <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-muted border-b border-line">{t('carbonTab.table.year')}</th>
              {cols.map((c) => (
                <th key={c.id} colSpan={sides.length} className="px-3 py-2 text-left text-xs font-semibold uppercase text-muted border-b border-line whitespace-nowrap">
                  {c.title ? (
                    <Tooltip content={c.title}>
                      <Button variant="quiet" size="sm" className="uppercase text-xs">
                        {c.label} <Info />
                      </Button>
                    </Tooltip>
                  ) : (
                    c.label
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, y) => (
              <tr key={y}>
                <td className="px-3 py-1.5 border-b border-line/60 text-muted whitespace-nowrap">{r[0]}</td>
                {cols.map((c) =>
                  sides.map((s, i) => {
                    const v = cell(s, y, c.id)
                    const differs = i > 0 && v !== cell(sides[0], y, c.id)
                    return (
                      <td key={`${c.id}-${i}`} className={cx('px-3 py-1.5 border-b border-line/60 whitespace-nowrap', ['co2e', 'rothc', 'sum', 'yield'].includes(c.id) && 'text-right tabular', i > 0 && (differs ? 'text-success font-medium' : 'text-muted'))}>
                        {i > 0 && !differs ? '–' : v}
                      </td>
                    )
                  }),
                )}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-semibold">
              {totalRow.map((v, i) => (
                <td key={i} className={cx('px-3 py-1.5 border-t-2 border-line-strong', i > 0 && 'text-right tabular')}>
                  {v}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
      {sides.length > 1 && <p className="text-xs text-muted">{t('carbonTab.preview.diffHint', { name: sides[0].r.name })}</p>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Step 4: results
// ---------------------------------------------------------------------------

type Parameter = 'socStock' | 'co2eStock' | 'socContent'

function ResultsStep({
  fieldId,
  fieldName,
  primary,
  compare,
  startPrimary,
  startCompare,
  result,
}: {
  fieldId: string
  fieldName: string
  primary: CropRotation
  compare: CropRotation | null
  startPrimary: number
  startCompare: number
  result: { primary: RothCResult; compare: RothCResult | null }
}) {
  const { t } = useTranslation()
  const [parameter, setParameter] = useState<Parameter>('socStock')
  const toSeries = (data: AveragedRothCResult[]) => {
    const first = data[0]
    return data.map((m) => {
      if (parameter === 'socContent') return { x: m.monthIndex, y: m.SOC_content_percent_C_ha_1, lower: m.lower_SOC_content_percent_C_ha_1, upper: m.upper_SOC_content_percent_C_ha_1 }
      if (parameter === 'socStock') return { x: m.monthIndex, y: m.SOC_stock_Mg_C_ha_1, lower: m.lower_SOC_stock_Mg_C_ha_1, upper: m.upper_SOC_stock_Mg_C_ha_1 }
      // Change of the CO2e stock since the first month, kg CO2e/ha.
      const d = (v: number, v0: number) => (v - v0) * CO2_PER_MG_C
      return { x: m.monthIndex, y: d(m.SOC_stock_Mg_C_ha_1, first.SOC_stock_Mg_C_ha_1), lower: d(m.lower_SOC_stock_Mg_C_ha_1, first.lower_SOC_stock_Mg_C_ha_1), upper: d(m.upper_SOC_stock_Mg_C_ha_1, first.upper_SOC_stock_Mg_C_ha_1) }
    })
  }
  const series = [
    { name: t('carbonTab.chart.baseline', { name: primary.name }), color: 'var(--color-series-1)', points: toSeries(result.primary.averaged) },
    ...(result.compare && compare ? [{ name: t('carbonTab.chart.compare', { name: compare.name }), color: 'var(--color-series-2)', points: toSeries(result.compare.averaged) }] : []),
  ]
  const digits = parameter === 'co2eStock' ? 0 : 2
  const unit = t(`carbonTab.chart.unit.${parameter}`)
  const download = (data: RothCResult, name: string) => saveBlob(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), name)
  return (
    <div className="space-y-5">
      <Card title={t('carbonTab.table.resultsTitle')}>
        <RotationTable
          primary={primary}
          compare={compare}
          startPrimary={startPrimary}
          startCompare={startCompare}
          results={{ primary: result.primary.averaged, compare: result.compare?.averaged ?? null }}
          exportName={`results_rothC_${fieldName.replace(/[^\p{L}\p{N}_-]+/gu, '_') || fieldId}`}
        />
      </Card>
      <Card
        title={t('carbonTab.chart.title')}
        description={t('carbonTab.chart.description')}
        actions={
          <SegmentedControl
            aria-label={t('carbonTab.chart.parameter')}
            items={(['socStock', 'co2eStock', 'socContent'] as const).map((p) => ({ id: p, label: t(`carbonTab.chart.parameters.${p}`) }))}
            value={parameter}
            onChange={setParameter}
          />
        }
      >
        <BandLineChart
          series={series}
          format={(v) => `${fmt.num(v, digits)}`}
          formatX={(m) => t('carbonTab.chart.yearN', { year: Math.floor((m - 1) / 12) + 1 })}
          ariaLabel={t('carbonTab.chart.title')}
        />
        <p className="mt-2 text-xs text-muted">{unit}</p>
      </Card>
      <details className="rounded-lg border border-line bg-surface-2/50 p-3 text-sm">
        <summary className="cursor-pointer font-semibold">{t('carbonTab.output.rawTitle')}</summary>
        <p className="mt-2 text-xs text-muted">{t('carbonTab.output.rawDataTooltip')}</p>
        <div className="mt-2 flex gap-2">
          <Button size="sm" onPress={() => download(result.primary, 'rothc-data.json')}>
            <Download /> {t('carbonTab.output.downloadJson')}
          </Button>
          {result.compare && (
            <Button size="sm" onPress={() => download(result.compare!, 'rothc-data-compare.json')}>
              <Download /> {t('carbonTab.output.downloadJsonCompare')}
            </Button>
          )}
        </div>
        <pre className="mt-2 max-h-96 overflow-auto text-xs">{JSON.stringify(result.primary.averaged.slice(0, 24), null, 2)}</pre>
      </details>
    </div>
  )
}
