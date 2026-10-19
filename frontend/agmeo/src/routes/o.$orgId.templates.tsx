import { OPERATION_TYPES, TEMPLATE_ANCHORS, type Crop, type CultivationTemplate, type OperationType, type Product, type TemplateAnchor, type TemplateInput } from '@agmeo/contracts'
import { createFileRoute } from '@tanstack/react-router'
import { ChevronDown, ChevronUp, ListChecks, Pencil, Plus, Trash2, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Form } from 'react-aria-components'
import { useTranslation } from 'react-i18next'
import { CropTag, templateStepTiming } from '#/components/labels'
import { DataTable } from '#/components/table/DataTable'
import { useTableView, type ColumnDef } from '#/components/table/tableTools'
import { baseUnitLabel, operationTypeLabel, productCategoryLabel, templateAnchorLabel } from '#/i18n/labels'
import { api } from '#/lib/api'
import { fmt } from '#/lib/format'
import { useOrg } from '#/lib/org'
import { useOrgMutation, useOrgQuery } from '#/lib/queries'
import { Button } from '#/ui/Button'
import { ComboBox, NumberField, Option, Select, TextField } from '#/ui/Field'
import { Card, EmptyState, ErrorNotice, Loading, Notice, PageHeader } from '#/ui/Layout'
import { ConfirmButton, ModalDialog } from '#/ui/Overlay'

export const Route = createFileRoute('/o/$orgId/templates')({ component: TemplatesPage })

function TemplatesPage() {
  const { t } = useTranslation()
  const { can } = useOrg()
  const templates = useOrgQuery<CultivationTemplate[]>('/templates')
  const [editing, setEditing] = useState<CultivationTemplate | 'new' | null>(null)
  const remove = useOrgMutation((base, id: string) => api.delete(`${base}/templates/${id}`), { success: t('templates.toast.deleted') })
  const sorted = useMemo(() => [...(templates.data ?? [])].sort((a, b) => a.cropName.localeCompare(b.cropName) || a.name.localeCompare(b.name)), [templates.data])
  const writable = can('crop.write')
  const columns = useMemo<ColumnDef<CultivationTemplate>[]>(
    () => [
      { id: 'crop', label: t('crops.plan.crop'), filter: 'select', value: (tpl) => tpl.cropName, render: (tpl) => <CropTag name={tpl.cropName} color={tpl.cropColor} /> },
      {
        id: 'name',
        label: t('templates.column.name'),
        isRowHeader: true,
        value: (tpl) => tpl.name,
        text: (tpl) => [tpl.name, tpl.notes].filter(Boolean).join(' '),
        render: (tpl) => (
          <>
            <div className="font-medium">{tpl.name}</div>
            {tpl.notes && <div className="text-xs text-muted line-clamp-1">{tpl.notes}</div>}
          </>
        ),
      },
      { id: 'steps', label: t('templates.column.steps'), align: 'end', filter: 'number', value: (tpl) => tpl.steps.length, render: (tpl) => fmt.num(tpl.steps.length) },
      {
        id: 'usedBy',
        label: t('templates.column.usedBy'),
        align: 'end',
        filter: 'number',
        value: (tpl) => tpl.usedBy,
        render: (tpl) => (tpl.usedBy ? t('templates.usedBy', { count: tpl.usedBy }) : <span className="text-muted">—</span>),
      },
    ],
    [t],
  )
  const view = useTableView(columns, sorted)

  return (
    <>
      <PageHeader
        title={t('templates.title')}
        subtitle={t('templates.subtitle')}
        actions={writable && <Button variant="primary" onPress={() => setEditing('new')}><Plus /> {t('templates.new')}</Button>}
      />
      {templates.isLoading ? (
        <Loading />
      ) : templates.error ? (
        <ErrorNotice error={templates.error} />
      ) : !sorted.length ? (
        <Card>
          <EmptyState icon={ListChecks} title={t('templates.empty.title')} action={writable && <Button variant="primary" onPress={() => setEditing('new')}><Plus /> {t('templates.new')}</Button>}>
            {t('templates.empty.description')}
          </EmptyState>
        </Card>
      ) : (
        <Card padded={false}>
          <DataTable
            aria-label={t('templates.title')}
            view={view}
            actions={
              writable
                ? (tpl) => (
                    <div className="flex justify-end gap-1">
                      <Button size="icon-sm" variant="ghost" aria-label={t('templates.editNamed', { name: tpl.name })} onPress={() => setEditing(tpl)}><Pencil /></Button>
                      <ConfirmButton
                        title={t('templates.delete.title', { name: tpl.name })}
                        message={t('templates.delete.message')}
                        confirmLabel={t('common.delete')}
                        onConfirm={() => remove.mutateAsync(tpl.id)}
                        trigger={<Button size="icon-sm" variant="ghost" aria-label={t('templates.deleteNamed', { name: tpl.name })}><Trash2 /></Button>}
                      />
                    </div>
                  )
                : undefined
            }
          />
        </Card>
      )}
      {editing && <TemplateDialog template={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  )
}

interface InputLine {
  key: number
  productId: string | null
  ratePerHa: number
}

interface StepForm {
  key: number
  type: OperationType
  title: string
  anchor: TemplateAnchor
  offsetDays: number
  bbchStage: string
  /** Not edited here; kept so saving does not drop notes set elsewhere. */
  notes: string | null
  inputs: InputLine[]
}

let keySeq = 0
const nextKey = () => keySeq++

const newStep = (): StepForm => ({ key: nextKey(), type: 'fertilization', title: operationTypeLabel('fertilization'), anchor: 'sowing', offsetDays: 0, bbchStage: '', notes: null, inputs: [] })

function TemplateDialog({ template, onClose }: { template: CultivationTemplate | null; onClose: () => void }) {
  const { t } = useTranslation()
  const crops = useOrgQuery<Crop[]>('/crops')
  const products = useOrgQuery<Product[]>('/products')
  const [cropId, setCropId] = useState<string | null>(template?.cropId ?? null)
  const [name, setName] = useState(template?.name ?? '')
  const [notes, setNotes] = useState(template?.notes ?? '')
  const [steps, setSteps] = useState<StepForm[]>(() =>
    template
      ? template.steps.map((s) => ({
          key: nextKey(),
          type: s.type,
          title: s.title,
          anchor: s.anchor,
          offsetDays: s.offsetDays,
          bbchStage: s.bbchStage ?? '',
          notes: s.notes,
          inputs: s.inputs.map((i) => ({ key: nextKey(), productId: i.productId, ratePerHa: i.ratePerHa })),
        }))
      : [newStep()],
  )
  const productById = useMemo(() => new Map((products.data ?? []).map((p) => [p.id, p])), [products.data])
  const usedProducts = new Set(steps.flatMap((s) => s.inputs.map((i) => i.productId)))
  // Archived products stay selectable only where a step already uses them.
  const productItems = (products.data ?? []).filter((p) => !p.archivedAt || usedProducts.has(p.id))

  const update = (key: number, patch: Partial<StepForm>) => setSteps((list) => list.map((s) => (s.key === key ? { ...s, ...patch } : s)))
  const move = (index: number, by: -1 | 1) =>
    setSteps((list) => {
      const next = [...list]
      ;[next[index], next[index + by]] = [next[index + by], next[index]]
      return next
    })

  const valid = !!cropId && !!name.trim() && steps.every((s) => s.title.trim() && s.inputs.every((i) => i.productId && i.ratePerHa > 0))
  const body: TemplateInput = {
    cropId: cropId ?? '',
    name,
    notes: notes || null,
    steps: steps.map((s) => ({
      type: s.type,
      title: s.title,
      anchor: s.anchor,
      offsetDays: Number.isNaN(s.offsetDays) ? 0 : Math.round(s.offsetDays),
      bbchStage: s.bbchStage.trim() || null,
      notes: s.notes,
      inputs: s.inputs.map((i) => ({ productId: i.productId!, ratePerHa: i.ratePerHa })),
    })),
  }
  const save = useOrgMutation((base, _: void) => (template ? api.put<CultivationTemplate>(`${base}/templates/${template.id}`, body) : api.post<CultivationTemplate>(`${base}/templates`, body)), {
    success: template ? t('templates.toast.updated') : t('templates.toast.created'),
    onSuccess: onClose,
  })

  return (
    <ModalDialog isOpen onOpenChange={(o) => !o && onClose()} title={template ? t('templates.dialog.editTitle') : t('templates.new')} size="xl">
      <Form onSubmit={(e) => { e.preventDefault(); if (valid) save.mutate() }} className="space-y-5">
        <div className="grid sm:grid-cols-2 gap-4">
          <ComboBox label={t('crops.form.crop')} isRequired items={crops.data ?? []} value={cropId} onChange={(v) => setCropId(v ? String(v) : null)} placeholder={t('crops.form.searchCrops')}>
            {(c) => (
              <Option id={c.id} textValue={c.name}>
                <CropTag name={c.name} color={c.color} />
              </Option>
            )}
          </ComboBox>
          <TextField label={t('templates.column.name')} isRequired value={name} onChange={setName} placeholder={t('templates.dialog.namePlaceholder')} />
          <TextField label={t('common.notes')} multiline rows={2} value={notes} onChange={setNotes} className="sm:col-span-2" />
        </div>
        {!!template?.usedBy && <Notice tone="info">{t('templates.dialog.usedNotice', { count: template.usedBy })}</Notice>}

        <section className="space-y-3">
          <div className="flex items-end justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-fg">{t('templates.steps.title')}</h3>
              <p className="text-xs text-muted mt-0.5">{t('templates.steps.description')}</p>
            </div>
            <Button size="sm" onPress={() => setSteps((list) => [...list, newStep()])} isDisabled={steps.length >= 100}>
              <Plus /> {t('templates.steps.add')}
            </Button>
          </div>
          {steps.length === 0 && <p className="text-sm text-muted">{t('templates.steps.empty')}</p>}
          <ol className="space-y-3">
            {steps.map((s, i) => (
              <li key={s.key} className="rounded-lg border border-line p-3 space-y-3">
                <div className="flex items-center gap-2">
                  <span className="size-6 rounded-full bg-primary-soft text-primary text-xs font-semibold flex items-center justify-center shrink-0">{i + 1}</span>
                  <span className="text-sm font-medium text-fg truncate flex-1">{s.title || operationTypeLabel(s.type)}</span>
                  <Button size="icon-sm" variant="ghost" aria-label={t('templates.steps.moveUp')} isDisabled={i === 0} onPress={() => move(i, -1)}><ChevronUp /></Button>
                  <Button size="icon-sm" variant="ghost" aria-label={t('templates.steps.moveDown')} isDisabled={i === steps.length - 1} onPress={() => move(i, 1)}><ChevronDown /></Button>
                  <Button size="icon-sm" variant="ghost" aria-label={t('templates.steps.remove')} onPress={() => setSteps((list) => list.filter((x) => x.key !== s.key))}><Trash2 /></Button>
                </div>
                <div className="grid sm:grid-cols-2 lg:grid-cols-[12rem_1fr_10rem_9rem_6rem] gap-3 items-start">
                  <Select
                    label={t('operations.typeLabel')}
                    items={OPERATION_TYPES.map((ty) => ({ id: ty, name: operationTypeLabel(ty) }))}
                    value={s.type}
                    onChange={(v) => {
                      if (!v) return
                      const type = v as OperationType
                      // Follow the type with the title until the user has written their own.
                      update(s.key, { type, ...(!s.title.trim() || s.title === operationTypeLabel(s.type) ? { title: operationTypeLabel(type) } : {}) })
                    }}
                  >
                    {(item) => <Option id={item.id}>{item.name}</Option>}
                  </Select>
                  <TextField label={t('templates.step.title')} isRequired value={s.title} onChange={(title) => update(s.key, { title })} />
                  <Select label={t('templates.step.anchor')} items={TEMPLATE_ANCHORS.map((a) => ({ id: a, name: templateAnchorLabel(a) }))} value={s.anchor} onChange={(v) => v && update(s.key, { anchor: v as TemplateAnchor })}>
                    {(item) => <Option id={item.id}>{item.name}</Option>}
                  </Select>
                  <NumberField
                    label={t('templates.step.offset')}
                    unit={t('templates.step.days')}
                    minValue={-400}
                    maxValue={400}
                    step={1}
                    formatOptions={{ maximumFractionDigits: 0 }}
                    value={s.offsetDays}
                    onChange={(offsetDays) => update(s.key, { offsetDays })}
                    description={templateStepTiming(s.anchor, Number.isNaN(s.offsetDays) ? 0 : s.offsetDays)}
                  />
                  <TextField label={t('templates.step.bbch')} value={s.bbchStage} onChange={(bbchStage) => update(s.key, { bbchStage })} placeholder={t('templates.step.bbchPlaceholder')} maxLength={200} />
                </div>
                {s.inputs.length > 0 && (
                  <div className="space-y-2">
                    {s.inputs.map((line) => {
                      const p = line.productId ? productById.get(line.productId) : undefined
                      const unit = p ? baseUnitLabel(p.baseUnit) : ''
                      const setLine = (patch: Partial<InputLine>) => update(s.key, { inputs: s.inputs.map((l) => (l.key === line.key ? { ...l, ...patch } : l)) })
                      return (
                        <div key={line.key} className="grid grid-cols-[1fr_auto] sm:grid-cols-[1fr_11rem_auto] gap-3 items-end">
                          <ComboBox label={t('operations.product')} items={productItems} value={line.productId} onChange={(v) => setLine({ productId: v ? String(v) : null })} placeholder={t('operations.form.searchProducts')} className="col-span-2 sm:col-span-1">
                            {(item) => <Option id={item.id} textValue={item.name} description={`${productCategoryLabel(item.category)} · ${baseUnitLabel(item.baseUnit)}`}>{item.name}</Option>}
                          </ComboBox>
                          <NumberField label={t('operations.rate')} unit={unit ? `${unit}/ha` : '/ha'} minValue={0} formatOptions={{ maximumFractionDigits: 4 }} value={line.ratePerHa} onChange={(ratePerHa) => setLine({ ratePerHa })} isRequired />
                          <Button variant="ghost" size="icon" aria-label={t('operations.form.removeProduct')} onPress={() => update(s.key, { inputs: s.inputs.filter((l) => l.key !== line.key) })}>
                            <X />
                          </Button>
                        </div>
                      )
                    })}
                  </div>
                )}
                <Button size="sm" variant="quiet" isDisabled={s.inputs.length >= 20} onPress={() => update(s.key, { inputs: [...s.inputs, { key: nextKey(), productId: null, ratePerHa: NaN }] })}>
                  <Plus /> {t('operations.form.addProduct')}
                </Button>
              </li>
            ))}
          </ol>
        </section>

        <div className="flex justify-end gap-2">
          <Button onPress={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" variant="primary" isDisabled={!valid} isPending={save.isPending}>{template ? t('common.save') : t('common.create')}</Button>
        </div>
      </Form>
    </ModalDialog>
  )
}
