import type { Crop, CultivationTemplate, Product, ProductCategory, TemplateInput } from '@agmeo/contracts'
import { Check, Plus, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '#/lib/api'
import { fmt } from '#/lib/format'
import { useOrgMutation, useOrgQuery } from '#/lib/queries'
import { Button, SegmentedControl } from '#/ui/Button'
import { Checkbox, ComboBox, NumberField, Option, TextField } from '#/ui/Field'
import { Notice } from '#/ui/Layout'
import { ModalDialog } from '#/ui/Overlay'
import { cx } from '#/ui/utils'

/**
 * Survey-based template builder (reference template-builder): a season plan from questions about
 * the crop and its management, created as a template with dated steps. Dates are counted from
 * sowing (harvest steps from the harvest); the defaults follow the reference's typical timing for
 * winter and spring crops and can be changed per step.
 */

const SECTIONS = ['crop', 'tillage', 'seeding', 'mineralFertilizing', 'organicFertilizing', 'liming', 'protection', 'harvesting', 'review'] as const
type Section = (typeof SECTIONS)[number]
type Technology = 'plough' | 'mulch' | 'direct'

interface Pass {
  key: number
  title: string
  offsetDays: number
}
interface Dose {
  key: number
  productId: string | null
  ratePerHa: number
  offsetDays: number
  bbch: string
}

let seq = 0
const key = () => ++seq

/** Tillage before sowing by technology (reference NP/PL/NT): plough, mulch seeding, direct seeding. */
const TILLAGE: Record<Technology, { title: string; offsetDays: number }[]> = {
  plough: [
    { title: 'templateBuilder.default.stubble', offsetDays: -35 },
    { title: 'templateBuilder.default.plough', offsetDays: -14 },
    { title: 'templateBuilder.default.seedbed', offsetDays: -1 },
  ],
  mulch: [
    { title: 'templateBuilder.default.stubble', offsetDays: -35 },
    { title: 'templateBuilder.default.cultivator', offsetDays: -14 },
    { title: 'templateBuilder.default.seedbed', offsetDays: -1 },
  ],
  direct: [],
}
/** Mineral N doses after sowing: winter crops in spring, spring crops at and after sowing. */
const N_DOSES = { winter: [160, 195, 225], spring: [0, 45, 75] }

export function TemplateBuilder({ onClose, onCreated }: { onClose: () => void; onCreated: (t: CultivationTemplate) => void }) {
  const { t } = useTranslation()
  const crops = useOrgQuery<Crop[]>('/crops')
  const products = useOrgQuery<Product[]>('/products')
  const [section, setSection] = useState<Section>('crop')
  const [cropId, setCropId] = useState<string | null>(null)
  const [technology, setTechnology] = useState<Technology>('mulch')
  const [tillage, setTillage] = useState<Pass[]>(() => TILLAGE.mulch.map((p) => ({ key: key(), title: t(p.title), offsetDays: p.offsetDays })))
  const [seed, setSeed] = useState<Dose>({ key: key(), productId: null, ratePerHa: NaN, offsetDays: 0, bbch: '' })
  const [mineral, setMineral] = useState<Dose[]>([])
  const [skipMineral, setSkipMineral] = useState(false)
  const [organic, setOrganic] = useState<Dose[]>([])
  const [liming, setLiming] = useState<Dose[]>([])
  const [protection, setProtection] = useState<Dose[]>([])
  const [strawRemoval, setStrawRemoval] = useState(false)
  const [name, setName] = useState('')
  const crop = crops.data?.find((c) => c.id === cropId)
  const byCategory = (c: ProductCategory) => (products.data ?? []).filter((p) => p.category === c && !p.archivedAt)
  const productOf = (id: string | null) => products.data?.find((p) => p.id === id)

  const chooseCrop = (id: string | null) => {
    setCropId(id)
    const c = crops.data?.find((x) => x.id === id)
    if (!c) return
    setName((n) => n || t('templateBuilder.defaultName', { crop: c.name }))
    setMineral((m) => (m.length ? m : (c.isWinterCrop ? N_DOSES.winter : N_DOSES.spring).slice(0, 2).map((offsetDays) => ({ key: key(), productId: null, ratePerHa: NaN, offsetDays, bbch: '' }))))
  }
  const chooseTechnology = (tech: Technology) => {
    setTechnology(tech)
    setTillage(TILLAGE[tech].map((p) => ({ key: key(), title: t(p.title), offsetDays: p.offsetDays })))
  }

  const doses = (list: Dose[]) => list.filter((d) => d.productId && !Number.isNaN(d.ratePerHa) && d.ratePerHa > 0)
  const steps: TemplateInput['steps'] = useMemo(() => {
    const out: NonNullable<TemplateInput['steps']> = []
    for (const p of tillage) out.push({ type: 'tillage', title: p.title, anchor: 'sowing', offsetDays: p.offsetDays })
    for (const d of doses(organic)) out.push({ type: 'fertilization', title: t('templateBuilder.default.organic'), anchor: 'sowing', offsetDays: d.offsetDays, inputs: [{ productId: d.productId!, ratePerHa: d.ratePerHa }] })
    out.push({ type: 'sowing', title: t('templateBuilder.default.sowing'), anchor: 'sowing', offsetDays: 0, inputs: seed.productId && seed.ratePerHa > 0 ? [{ productId: seed.productId, ratePerHa: seed.ratePerHa }] : [] })
    if (!skipMineral) doses(mineral).forEach((d, i) => out.push({ type: 'fertilization', title: t('templateBuilder.default.nDose', { n: i + 1 }), anchor: 'sowing', offsetDays: d.offsetDays, bbchStage: d.bbch || null, inputs: [{ productId: d.productId!, ratePerHa: d.ratePerHa }] }))
    for (const d of doses(liming)) out.push({ type: 'fertilization', title: t('templateBuilder.default.liming'), anchor: 'harvest', offsetDays: d.offsetDays, inputs: [{ productId: d.productId!, ratePerHa: d.ratePerHa }] })
    for (const d of doses(protection)) out.push({ type: 'crop_protection', title: productOf(d.productId)?.name ?? t('templateBuilder.default.protection'), anchor: 'sowing', offsetDays: d.offsetDays, bbchStage: d.bbch || null, inputs: [{ productId: d.productId!, ratePerHa: d.ratePerHa }] })
    out.push({ type: 'harvest', title: t('templateBuilder.default.harvest'), anchor: 'harvest', offsetDays: 0 })
    if (strawRemoval) out.push({ type: 'other', title: t('templateBuilder.default.straw'), anchor: 'harvest', offsetDays: 2 })
    return out.sort((a, b) => (a.anchor === b.anchor ? (a.offsetDays ?? 0) - (b.offsetDays ?? 0) : a.anchor === 'harvest' ? 1 : -1))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tillage, organic, seed, mineral, skipMineral, liming, protection, strawRemoval, products.data, t])

  // Nutrient totals per hectare (products' contents in % of fresh mass; liquids at their density, else 1 t/m³).
  const totals = useMemo(() => {
    const sum = { n: 0, p2o5: 0, k2o: 0, mgo: 0 }
    for (const s of steps ?? []) {
      if (s.type !== 'fertilization') continue
      for (const i of s.inputs ?? []) {
        const p = productOf(i.productId)
        if (!p) continue
        const kg = p.baseUnit === 't' ? i.ratePerHa * 1000 : p.baseUnit === 'm3' ? i.ratePerHa * 1000 * (p.densityTM3 ?? 1) : p.baseUnit === 'l' ? i.ratePerHa * (p.densityTM3 ?? 1) : i.ratePerHa
        sum.n += (kg * (p.nPct ?? 0)) / 100
        sum.p2o5 += (kg * (p.p2o5Pct ?? 0)) / 100
        sum.k2o += (kg * (p.k2oPct ?? 0)) / 100
        sum.mgo += (kg * (p.mgoPct ?? 0)) / 100
      }
    }
    return sum
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [steps, products.data])
  const checks = [
    { key: 'nTotal', ok: totals.n <= 300, params: { value: fmt.num(totals.n) } },
    { key: 'seed', ok: !!seed.productId, params: {} },
    { key: 'protection', ok: doses(protection).reduce((s, d) => s + d.ratePerHa, 0) <= 25, params: {} },
  ]

  const create = useOrgMutation((base, _: void) => api.post<CultivationTemplate>(`${base}/templates`, { cropId, name: name.trim(), notes: t('templateBuilder.createdNote'), steps }), {
    success: t('templateBuilder.created'),
    onSuccess: (tpl: CultivationTemplate) => onCreated(tpl),
  })
  const idx = SECTIONS.indexOf(section)

  const doseList = (list: Dose[], set: (d: Dose[]) => void, category: ProductCategory, opts: { bbch?: boolean; offsetLabel: string; defaultOffset: number }) => (
    <div className="space-y-3">
      {list.map((d, i) => (
        <div key={d.key} className="grid sm:grid-cols-[1fr_8rem_8rem_6rem_auto] gap-2 items-end">
          <ProductPick label={t('templateBuilder.product')} items={byCategory(category)} value={d.productId} onChange={(productId) => set(list.map((x, j) => (j === i ? { ...x, productId } : x)))} />
          <NumberField label={t('templateBuilder.amount')} unit={`${productOf(d.productId)?.baseUnit ?? ''}/ha`} minValue={0} formatOptions={{ maximumFractionDigits: 3 }} value={d.ratePerHa} onChange={(ratePerHa) => set(list.map((x, j) => (j === i ? { ...x, ratePerHa } : x)))} />
          <NumberField label={opts.offsetLabel} unit={t('templateBuilder.days')} minValue={-400} maxValue={400} value={d.offsetDays} onChange={(offsetDays) => set(list.map((x, j) => (j === i ? { ...x, offsetDays: Number.isNaN(offsetDays) ? 0 : offsetDays } : x)))} />
          {opts.bbch ? <TextField label="BBCH" value={d.bbch} onChange={(bbch) => set(list.map((x, j) => (j === i ? { ...x, bbch } : x)))} /> : <span />}
          <Button size="icon-sm" variant="ghost" aria-label={t('templateBuilder.remove')} onPress={() => set(list.filter((_, j) => j !== i))}>
            <Trash2 />
          </Button>
        </div>
      ))}
      <Button size="sm" onPress={() => set([...list, { key: key(), productId: null, ratePerHa: NaN, offsetDays: opts.defaultOffset, bbch: '' }])}>
        <Plus /> {t('templateBuilder.addApplication')}
      </Button>
    </div>
  )

  return (
    <ModalDialog isOpen onOpenChange={(o) => !o && onClose()} title={t('templateBuilder.title')} size="xl">
      <div className="grid md:grid-cols-[12rem_1fr] gap-6">
        <nav aria-label={t('templateBuilder.sections')} className="flex gap-1 overflow-x-auto md:block md:space-y-1">
          {SECTIONS.map((s, i) => (
            <button
              key={s}
              type="button"
              disabled={!cropId && s !== 'crop'}
              onClick={() => setSection(s)}
              className={cx('flex shrink-0 md:w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm whitespace-nowrap disabled:opacity-50', s === section ? 'bg-primary-soft text-primary font-medium' : 'hover:bg-surface-2')}
            >
              {i < idx ? <Check className="size-3.5 text-success" aria-hidden /> : <span className="w-3.5 text-center text-xs text-muted">{i + 1}</span>}
              {t(`templateBuilder.section.${s}`)}
            </button>
          ))}
        </nav>
        <div className="min-w-0 space-y-4">
          <p className="text-sm text-fg-2">{t(`templateBuilder.description.${section}`)}</p>
          {section === 'crop' && (
            <div className="space-y-4">
              <ComboBox label={t('templateBuilder.crop')} items={(crops.data ?? []).filter((c) => c.category !== 'cover')} value={cropId} onChange={(v) => chooseCrop(v ? String(v) : null)}>
                {(c) => <Option id={c.id}>{c.name}</Option>}
              </ComboBox>
              <div className="space-y-1.5">
                <p className="text-sm font-medium text-fg-2">{t('templateBuilder.technology')}</p>
                <SegmentedControl
                  aria-label={t('templateBuilder.technology')}
                  value={technology}
                  onChange={chooseTechnology}
                  items={(['plough', 'mulch', 'direct'] as const).map((id) => ({ id, label: t(`templateBuilder.technology.${id}`) }))}
                />
              </div>
            </div>
          )}
          {section === 'tillage' && (
            <div className="space-y-3">
              {tillage.length === 0 && <p className="text-sm text-muted">{t('templateBuilder.noTillage')}</p>}
              {tillage.map((p, i) => (
                <div key={p.key} className="grid sm:grid-cols-[1fr_9rem_auto] gap-2 items-end">
                  <TextField label={t('templateBuilder.pass')} value={p.title} onChange={(title) => setTillage(tillage.map((x, j) => (j === i ? { ...x, title } : x)))} />
                  <NumberField label={t('templateBuilder.daysFromSowing')} unit={t('templateBuilder.days')} minValue={-400} maxValue={400} value={p.offsetDays} onChange={(offsetDays) => setTillage(tillage.map((x, j) => (j === i ? { ...x, offsetDays: Number.isNaN(offsetDays) ? 0 : offsetDays } : x)))} />
                  <Button size="icon-sm" variant="ghost" aria-label={t('templateBuilder.remove')} onPress={() => setTillage(tillage.filter((_, j) => j !== i))}>
                    <Trash2 />
                  </Button>
                </div>
              ))}
              <Button size="sm" onPress={() => setTillage([...tillage, { key: key(), title: t('templateBuilder.default.cultivator'), offsetDays: -7 }])}>
                <Plus /> {t('templateBuilder.addTillageStep')}
              </Button>
            </div>
          )}
          {section === 'seeding' && (
            <div className="grid sm:grid-cols-[1fr_10rem] gap-2 items-end">
              <ProductPick label={t('templateBuilder.seed')} items={byCategory('seed')} value={seed.productId} onChange={(productId) => setSeed({ ...seed, productId })} />
              <NumberField label={t('templateBuilder.seedingAmount')} unit={`${productOf(seed.productId)?.baseUnit ?? ''}/ha`} minValue={0} formatOptions={{ maximumFractionDigits: 3 }} value={seed.ratePerHa} onChange={(ratePerHa) => setSeed({ ...seed, ratePerHa })} />
            </div>
          )}
          {section === 'mineralFertilizing' && (
            <div className="space-y-3">
              <Checkbox isSelected={skipMineral} onChange={setSkipMineral}>
                {t('templateBuilder.skipMineralFertilizing')}
              </Checkbox>
              {!skipMineral && doseList(mineral, setMineral, 'fertilizer', { bbch: true, offsetLabel: t('templateBuilder.daysFromSowing'), defaultOffset: crop?.isWinterCrop ? N_DOSES.winter[mineral.length] ?? 230 : N_DOSES.spring[mineral.length] ?? 80 })}
            </div>
          )}
          {section === 'organicFertilizing' && doseList(organic, setOrganic, 'fertilizer', { offsetLabel: t('templateBuilder.daysFromSowing'), defaultOffset: -10 })}
          {section === 'liming' && doseList(liming, setLiming, 'fertilizer', { offsetLabel: t('templateBuilder.daysFromHarvest'), defaultOffset: 14 })}
          {section === 'protection' && doseList(protection, setProtection, 'crop_protection', { bbch: true, offsetLabel: t('templateBuilder.daysFromSowing'), defaultOffset: crop?.isWinterCrop ? 30 : 40 })}
          {section === 'harvesting' && (
            <Checkbox isSelected={strawRemoval} onChange={setStrawRemoval}>
              {t('templateBuilder.strawRemoval')}
            </Checkbox>
          )}
          {section === 'review' && (
            <div className="space-y-4">
              <TextField label={t('templateBuilder.templateName')} value={name} onChange={setName} isRequired />
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-sm">
                <Summary label={t('templateBuilder.summary.steps')} value={fmt.num(steps?.length ?? 0)} />
                <Summary label="N" value={`${fmt.num(totals.n)} kg`} />
                <Summary label="P₂O₅" value={`${fmt.num(totals.p2o5)} kg`} />
                <Summary label="K₂O" value={`${fmt.num(totals.k2o)} kg`} />
                <Summary label="MgO" value={`${fmt.num(totals.mgo)} kg`} />
              </div>
              <div>
                <p className="text-sm font-semibold text-fg mb-1">{t('templateBuilder.checks.title')}</p>
                <ul className="space-y-1 text-sm">
                  {checks.map((c) => (
                    <li key={c.key} className={c.ok ? 'text-success' : 'text-warning'}>
                      {c.ok ? '✓' : '!'} {t(`templateBuilder.check.${c.key}`, c.params)} · {c.ok ? t('templateBuilder.checks.passed') : t('templateBuilder.checks.warning')}
                    </li>
                  ))}
                </ul>
              </div>
              <ol className="max-h-56 overflow-y-auto rounded-md border border-line divide-y divide-line text-sm">
                {(steps ?? []).map((s, i) => (
                  <li key={i} className="flex justify-between gap-3 px-3 py-1.5">
                    <span>{s.title}</span>
                    <span className="text-muted tabular whitespace-nowrap">{t(`templateBuilder.timing.${s.anchor}`, { days: `${(s.offsetDays ?? 0) >= 0 ? '+' : ''}${s.offsetDays ?? 0}` })}</span>
                  </li>
                ))}
              </ol>
              {create.error && <Notice tone="danger">{t('templateBuilder.createFailed')}</Notice>}
            </div>
          )}
          <div className="flex justify-between gap-2 border-t border-line pt-4">
            <Button onPress={onClose}>{t('common.cancel')}</Button>
            <div className="flex gap-2">
              {idx > 0 && <Button onPress={() => setSection(SECTIONS[idx - 1])}>{t('templateBuilder.back')}</Button>}
              {section === 'review' ? (
                <Button variant="primary" isDisabled={!cropId || !name.trim()} isPending={create.isPending} onPress={() => create.mutate()}>
                  {t('templateBuilder.createTemplate')}
                </Button>
              ) : (
                <Button variant="primary" isDisabled={!cropId} onPress={() => setSection(SECTIONS[idx + 1])}>
                  {t('templateBuilder.next')}
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </ModalDialog>
  )
}

function ProductPick({ label, items, value, onChange }: { label: string; items: Product[]; value: string | null; onChange: (id: string | null) => void }) {
  return (
    <ComboBox label={label} items={items} value={value} onChange={(v) => onChange(v ? String(v) : null)}>
      {(p) => <Option id={p.id}>{p.name}</Option>}
    </ComboBox>
  )
}

const Summary = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-md border border-line p-2">
    <p className="text-xs text-muted">{label}</p>
    <p className="font-semibold tabular">{value}</p>
  </div>
)
