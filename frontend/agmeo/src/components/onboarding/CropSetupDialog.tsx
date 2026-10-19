import type { CropRotation, CultivationTemplate, ProductPriceRow, RotationInput } from '@agmeo/contracts'
import { CheckCircle2, ExternalLink, Pencil, PlusCircle, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CropTag } from '#/components/labels'
import { RotationDialog } from '#/components/rotations/RotationDialog'
import { baseUnitLabel, productCategoryLabel } from '#/i18n/labels'
import { api } from '#/lib/api'
import { useOrg } from '#/lib/org'
import { useOrgMutation, useOrgQuery } from '#/lib/queries'
import { Button, SegmentedControl } from '#/ui/Button'
import { NumberField, Option, Select } from '#/ui/Field'
import { EmptyState, Loading, Notice } from '#/ui/Layout'
import { ConfirmButton, ModalDialog } from '#/ui/Overlay'
import { cx } from '#/ui/utils'

type Step = 'crops' | 'technologies' | 'prices'
const STEPS: Step[] = ['crops', 'technologies', 'prices']

/** One crop of the rotations with the template and yield its entries share. */
interface CropRow {
  cropId: string
  cropName: string
  cropColor: string
  templateId: string | null
  expectedYieldTHa: number | null
}

const bodyOf = (r: CropRotation, patch?: (e: CropRotation['entries'][number]) => Partial<RotationInput['entries'][number]>): RotationInput => ({
  name: r.name,
  notes: r.notes,
  entries: r.entries.map((e) => ({ cropId: e.cropId, templateId: e.templateId, catchCropId: e.catchCropId, expectedYieldTHa: e.expectedYieldTHa, ...patch?.(e) })),
})

/**
 * Onboarding "crop setup" (reference: onboarding/crop-rotation): crop rotations, then a
 * cultivation template and expected yield per crop, then the prices of everything the templates
 * use. Each step saves as it goes; finishing with prices missing asks first.
 */
export function CropSetupDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation()
  const [step, setStep] = useState<Step>('crops')
  const [warn, setWarn] = useState(false)
  const rotations = useOrgQuery<CropRotation[]>('/rotations')
  const templates = useOrgQuery<CultivationTemplate[]>('/templates')
  const year = new Date().getFullYear()
  const prices = useOrgQuery<ProductPriceRow[]>('/prices', { year })

  const crops = useMemo<CropRow[]>(() => {
    const map = new Map<string, CropRow>()
    for (const r of rotations.data ?? [])
      for (const e of r.entries)
        if (!map.has(e.cropId)) map.set(e.cropId, { cropId: e.cropId, cropName: e.cropName, cropColor: e.cropColor, templateId: e.templateId, expectedYieldTHa: e.expectedYieldTHa })
    return [...map.values()].sort((a, b) => a.cropName.localeCompare(b.cropName))
  }, [rotations.data])

  // Products of the chosen templates, plus fuel (the reference's system articles diesel and labour).
  const priceable = useMemo(() => {
    const chosen = new Set(crops.map((c) => c.templateId).filter(Boolean))
    const ids = new Set<string>()
    for (const tpl of templates.data ?? []) if (chosen.has(tpl.id)) for (const s of tpl.steps) for (const i of s.inputs) ids.add(i.productId)
    return (prices.data ?? []).filter((p) => ids.has(p.productId) || p.category === 'fuel')
  }, [crops, templates.data, prices.data])
  const priced = (p: ProductPriceRow) => p.price != null || p.carriedOver != null
  const missing = priceable.filter((p) => !priced(p)).length

  const finish = () => (missing ? setWarn(true) : onDone())
  const index = STEPS.indexOf(step)

  return (
    <>
      <ModalDialog
        isOpen
        onOpenChange={(o) => !o && onClose()}
        title={t('onboarding.crops.title')}
        size="lg"
        footer={() => (
          <div className="flex w-full justify-between gap-2">
            {index > 0 ? <Button onPress={() => setStep(STEPS[index - 1])}>{t('common.back')}</Button> : <span />}
            {step === 'prices' ? (
              <Button variant="primary" onPress={finish}>{t('onboarding.crops.finish')}</Button>
            ) : (
              <Button variant="primary" isDisabled={step === 'crops' && !rotations.data?.length} onPress={() => setStep(STEPS[index + 1])}>
                {t('common.next')}
              </Button>
            )}
          </div>
        )}
      >
        <ol className="flex items-center gap-2 mb-5 text-sm" aria-label={t('onboarding.steps')}>
          {STEPS.map((s, i) => (
            <li key={s} className="flex items-center gap-2" aria-current={s === step ? 'step' : undefined}>
              <span className={cx('size-6 rounded-full flex items-center justify-center text-xs font-semibold border', i < index ? 'bg-primary border-primary text-primary-fg' : i === index ? 'border-primary text-primary bg-primary-soft' : 'border-line-strong text-muted')}>{i + 1}</span>
              <span className={cx(i === index ? 'text-fg font-medium' : 'text-muted')}>{t(`onboarding.crops.step.${s}`)}</span>
              {i < STEPS.length - 1 && <span className="w-6 h-px bg-line-strong" aria-hidden />}
            </li>
          ))}
        </ol>
        {rotations.isLoading || templates.isLoading ? (
          <Loading />
        ) : step === 'crops' ? (
          <RotationsStep rotations={rotations.data ?? []} />
        ) : step === 'technologies' ? (
          <TechnologiesStep crops={crops} rotations={rotations.data ?? []} templates={templates.data ?? []} />
        ) : (
          <PricesStep rows={priceable} year={year} loading={prices.isLoading} />
        )}
      </ModalDialog>
      {warn && (
        <ModalDialog
          isOpen
          onOpenChange={(o) => !o && setWarn(false)}
          title={t('onboarding.prices.warningTitle')}
          size="sm"
          footer={() => (
            <>
              <Button onPress={() => setWarn(false)}>{t('common.back')}</Button>
              <Button variant="primary" onPress={() => (setWarn(false), onDone())}>{t('onboarding.prices.continueAnyway')}</Button>
            </>
          )}
        >
          <p className="text-sm text-fg-2">{t('onboarding.prices.warning', { count: missing })}</p>
        </ModalDialog>
      )}
    </>
  )
}

function RotationsStep({ rotations }: { rotations: CropRotation[] }) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState<CropRotation | 'new' | null>(null)
  const remove = useOrgMutation((base, id: string) => api.delete(`${base}/rotations/${id}`), { success: t('rotations.toast.deleted') })
  return (
    <div className="space-y-4">
      <p className="text-sm text-fg-2">{t('onboarding.crops.rotationsIntro')}</p>
      <button
        type="button"
        onClick={() => setEditing('new')}
        className="w-full flex items-center justify-center gap-2 rounded-lg border border-dashed border-line-strong p-3 text-sm text-fg-2 hover:border-primary hover:bg-primary-soft hover:text-primary"
      >
        <PlusCircle className="size-5" aria-hidden /> {t('onboarding.crops.addRotation')}
      </button>
      {rotations.map((r) => (
        <div key={r.id} className="rounded-lg border border-line p-3 space-y-2">
          <div className="flex items-center gap-2">
            <span className="font-medium flex-1 truncate">{r.name}</span>
            <Button size="icon-sm" variant="ghost" aria-label={t('settings.editNamed', { name: r.name })} onPress={() => setEditing(r)}>
              <Pencil />
            </Button>
            <ConfirmButton
              title={t('settings.deleteNamed', { name: r.name })}
              message={t('onboarding.crops.deleteRotation')}
              confirmLabel={t('common.delete')}
              onConfirm={() => remove.mutateAsync(r.id)}
              trigger={
                <Button size="icon-sm" variant="ghost" aria-label={t('settings.deleteNamedLabel', { name: r.name })}>
                  <Trash2 />
                </Button>
              }
            />
          </div>
          <ol className="flex flex-wrap gap-1.5">
            {r.entries.map((e) => (
              <li key={e.position}>
                <CropTag name={e.cropName} color={e.cropColor} />
              </li>
            ))}
          </ol>
        </div>
      ))}
      {editing && <RotationDialog rotation={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

function TechnologiesStep({ crops, rotations, templates }: { crops: CropRow[]; rotations: CropRotation[]; templates: CultivationTemplate[] }) {
  const { t } = useTranslation()
  const { orgId } = useOrg()
  // Writes the choice into every rotation entry of the crop.
  const apply = useOrgMutation(
    async (base, v: { cropId: string; patch: { templateId?: string | null; expectedYieldTHa?: number | null } }) => {
      for (const r of rotations.filter((x) => x.entries.some((e) => e.cropId === v.cropId)))
        await api.put(`${base}/rotations/${r.id}`, bodyOf(r, (e) => (e.cropId === v.cropId ? v.patch : {})))
    },
    { success: t('onboarding.crops.saved') },
  )
  if (!crops.length) return <EmptyState title={t('onboarding.crops.noCrops')} />
  return (
    <div className="space-y-3">
      <Notice>
        <span className="font-medium">{t('onboarding.crops.optional')}</span> {t('onboarding.crops.templatesIntro')}
      </Notice>
      <p className="text-xs text-muted">{t('onboarding.crops.yieldHint')}</p>
      {crops.map((c) => (
        <TechnologyRow key={`${c.cropId}:${c.templateId}:${c.expectedYieldTHa}`} crop={c} templates={templates.filter((x) => x.cropId === c.cropId)} pending={apply.isPending} onChange={(patch) => apply.mutate({ cropId: c.cropId, patch })} />
      ))}
      <a href={`/o/${orgId}/templates`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
        {t('onboarding.crops.createTemplate')} <ExternalLink className="size-3.5" aria-hidden />
      </a>
    </div>
  )
}

function TechnologyRow({ crop, templates, pending, onChange }: { crop: CropRow; templates: CultivationTemplate[]; pending: boolean; onChange: (patch: { templateId?: string | null; expectedYieldTHa?: number | null }) => void }) {
  const { t } = useTranslation()
  const [custom, setCustom] = useState(crop.expectedYieldTHa != null)
  const [value, setValue] = useState(crop.expectedYieldTHa ?? NaN)
  return (
    <div className={cx('rounded-lg border p-3 space-y-3', crop.templateId ? 'border-primary/40 bg-primary-soft/40' : 'border-line')}>
      <div className="flex flex-wrap items-center gap-3">
        <span className="min-w-36 flex items-center gap-2">
          <CropTag name={crop.cropName} color={crop.cropColor} />
          {crop.templateId && <CheckCircle2 className="size-4 text-primary" aria-label={t('onboarding.crops.templateChosen')} />}
        </span>
        <Select
          aria-label={t('onboarding.crops.templateFor', { crop: crop.cropName })}
          className="flex-1 min-w-56"
          isDisabled={pending}
          items={[{ id: '__none', name: t('rotations.entries.noTemplate') }, ...templates.map((x) => ({ id: x.id, name: x.name }))]}
          value={crop.templateId ?? '__none'}
          onChange={(v) => v && onChange({ templateId: v === '__none' ? null : String(v) })}
        >
          {(x) => <Option id={x.id}>{x.name}</Option>}
        </Select>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <SegmentedControl
          aria-label={t('onboarding.crops.yieldMode')}
          value={custom ? 'custom' : 'regional'}
          onChange={(m) => {
            setCustom(m === 'custom')
            if (m === 'regional' && crop.expectedYieldTHa != null) onChange({ expectedYieldTHa: null })
          }}
          items={[
            { id: 'regional', label: t('onboarding.crops.yieldRegional') },
            { id: 'custom', label: t('onboarding.crops.yieldCustom') },
          ]}
        />
        {custom && (
          <NumberField
            aria-label={t('crops.form.expectedYield')}
            className="w-40"
            unit="t/ha"
            minValue={0}
            step={0.1}
            formatOptions={{ maximumFractionDigits: 2 }}
            value={value}
            // React Aria commits the number on blur or Enter; save the committed value.
            onChange={(v) => {
              setValue(v)
              if (!Number.isNaN(v) && v !== crop.expectedYieldTHa) onChange({ expectedYieldTHa: v })
            }}
          />
        )}
      </div>
    </div>
  )
}

const DONUT_R = 54
const DONUT_C = 2 * Math.PI * DONUT_R

function PricesStep({ rows, year, loading }: { rows: ProductPriceRow[]; year: number; loading: boolean }) {
  const { t } = useTranslation()
  const { org } = useOrg()
  const save = useOrgMutation((base, v: { productId: string; price: number | null }) => api.put(`${base}/prices`, { year, prices: [v] }), { success: t('prices.saved') })
  if (loading) return <Loading />
  const set = rows.filter((r) => r.price != null || r.carriedOver != null).length
  return (
    <div className="space-y-3">
      <p className="text-sm text-fg-2">{t('onboarding.prices.instruction', { year })}</p>
      <p className="text-xs text-muted">{t('onboarding.prices.hint')}</p>
      <div className="grid sm:grid-cols-[1fr_9rem] gap-6 items-start">
        {rows.length ? (
          <ul className="divide-y divide-line border border-line rounded-lg">
            {rows.map((r) => (
              <PriceRow key={`${r.productId}:${r.price}`} row={r} currency={org.currency} onSave={(price) => save.mutate({ productId: r.productId, price })} />
            ))}
          </ul>
        ) : (
          <EmptyState title={t('onboarding.prices.none')} />
        )}
        <div className="flex flex-col items-center gap-1 sm:sticky sm:top-0">
          <svg viewBox="0 0 140 140" className="size-32" role="img" aria-label={t('onboarding.prices.progressLabel', { set, total: rows.length })}>
            <circle cx={70} cy={70} r={DONUT_R} fill="none" className="stroke-line" strokeWidth={10} />
            <circle cx={70} cy={70} r={DONUT_R} fill="none" className="stroke-primary transition-all duration-500" strokeWidth={10} strokeDasharray={DONUT_C} strokeDashoffset={DONUT_C * (1 - set / (rows.length || 1))} strokeLinecap="round" transform="rotate(-90 70 70)" />
            <text x={70} y={68} textAnchor="middle" className="fill-fg text-2xl font-bold">{set}</text>
            <text x={70} y={86} textAnchor="middle" className="fill-muted text-xs">/ {rows.length}</text>
          </svg>
          <span className="text-xs text-muted text-center">{t('onboarding.prices.progress')}</span>
        </div>
      </div>
    </div>
  )
}

function PriceRow({ row, currency, onSave }: { row: ProductPriceRow; currency: string; onSave: (price: number | null) => void }) {
  const { t } = useTranslation()
  const current = row.price ?? row.carriedOver?.price ?? null
  const [value, setValue] = useState(row.source === 'manual' && row.price != null ? row.price : NaN)
  return (
    <li className="flex flex-wrap items-center gap-3 px-3 py-2">
      <div className="flex-1 min-w-40">
        <div className="text-sm font-medium">{row.productName}</div>
        <div className="text-xs text-muted">
          {productCategoryLabel(row.category)}
          {current != null && row.source !== 'manual' && ` · ${t('onboarding.prices.known', { price: current })}`}
          {current == null && row.defaultPrice != null && ` · ${t('onboarding.prices.default', { price: row.defaultPrice })}`}
        </div>
      </div>
      <NumberField
        aria-label={t('prices.ownPrice', { year: '' })}
        className="w-48"
        unit={`${currency} / ${baseUnitLabel(row.baseUnit)}`}
        minValue={0}
        formatOptions={{ maximumFractionDigits: 4 }}
        value={value}
        onChange={(v) => {
          setValue(v)
          const next = Number.isNaN(v) ? null : v
          if (next !== (row.source === 'manual' ? row.price : null)) onSave(next)
        }}
      />
    </li>
  )
}
