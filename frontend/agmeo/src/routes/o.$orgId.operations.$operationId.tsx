import { NUTRIENT_KEYS, type ApplicationTechnique, type CostCategory, type Field, type NutrientRates, type Operation, type OperationChecks, type PsmFinding, type StockMovement, type StockShortage } from '@agmeo/contracts'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { AlertTriangle, Ban, CheckCircle2, Info, Pencil, RotateCcw, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Form } from 'react-aria-components'
import { useTranslation } from 'react-i18next'
import { Activity } from '#/components/Activity'
import { CropTag, OperationStatusBadge, OperationTypeLabel } from '#/components/labels'
import { FieldMap } from '#/components/map/FieldMap'
import { OperationForm, initialState, toPayload, type OperationFormState } from '#/components/operations/OperationForm'
import { t } from '#/i18n'
import { costCategoryLabel } from '#/i18n/labels'
import { NUTRIENT_LABELS, applicationTechniqueLabel } from '#/i18n/labels.fieldwork'
import { ApiRequestError, api, errorMessage } from '#/lib/api'
import { fmt, localToIso, today } from '#/lib/format'
import { useOrg } from '#/lib/org'
import { useOrgMutation, useOrgQuery } from '#/lib/queries'
import { Button, Link } from '#/ui/Button'
import { DatePicker, TextField } from '#/ui/Field'
import { Badge, Card, DescriptionList, ErrorNotice, Loading, Notice, PageHeader } from '#/ui/Layout'
import { ConfirmButton, ModalDialog } from '#/ui/Overlay'
import { Cell, Column, Row, Table, TableBody, TableHeader } from '#/ui/Table'

export const Route = createFileRoute('/o/$orgId/operations/$operationId')({ component: OperationPage })

function OperationPage() {
  const { t } = useTranslation()
  const { orgId, org, can } = useOrg()
  const { operationId } = Route.useParams()
  const navigate = useNavigate()
  const op = useOrgQuery<Operation>(`/operations/${operationId}`)
  const fields = useOrgQuery<Field[]>('/fields', { includeArchived: true })
  const movements = useOrgQuery<StockMovement[]>('/stock/movements', { operationId })
  const [editing, setEditing] = useState(false)
  const [completeOpen, setCompleteOpen] = useState(false)
  const [reopenOpen, setReopenOpen] = useState(false)

  const cancel = useOrgMutation((base, version: number) => api.post<Operation>(`${base}/operations/${operationId}/cancel`, { version }), { success: t('operations.toast.canceled') })
  const remove = useOrgMutation((base, _: void) => api.delete(`${base}/operations/${operationId}`), {
    success: t('operations.toast.deleted'),
    onSuccess: () => navigate({ to: '/o/$orgId/operations', params: { orgId } }),
  })

  if (op.isLoading || fields.isLoading) return <Loading />
  if (op.error) return <ErrorNotice error={op.error} />
  const o = op.data!
  const open = o.status === 'planned' || o.status === 'in_progress'
  const writable = can('operation.write')
  const opFields = (fields.data ?? []).filter((f) => o.fields.some((of) => of.fieldId === f.id))
  const totalCost = o.costs.reduce((s, c) => s + c.amount, 0)

  if (editing) return <EditOperation operation={o} fields={fields.data ?? []} onDone={() => setEditing(false)} />

  return (
    <>
      <PageHeader
        eyebrow={<Link to="/o/$orgId/operations" params={{ orgId }}>{t('operations.title')}</Link>}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {o.title}
            <OperationStatusBadge status={o.status} />
          </span>
        }
        subtitle={
          o.performedAt
            ? t('operations.detail.performedSubtitle', { date: fmt.dateTime(o.performedAt), area: fmt.ha(o.totalAreaHa) })
            : t('operations.detail.plannedSubtitle', { date: fmt.date(o.plannedOn), area: fmt.ha(o.totalAreaHa) })
        }
        actions={
          writable && (
            <>
              {open && (
                <>
                  <ConfirmButton
                    title={t('operations.detail.cancelTitle')}
                    message={t('operations.detail.cancelMessage')}
                    confirmLabel={t('operations.detail.cancelConfirm')}
                    onConfirm={() => cancel.mutateAsync(o.version)}
                    trigger={<Button variant="ghost"><Ban /> {t('operations.detail.cancel')}</Button>}
                  />
                  <Button onPress={() => setEditing(true)}><Pencil /> {t('common.edit')}</Button>
                  <Button variant="primary" onPress={() => setCompleteOpen(true)}><CheckCircle2 /> {t('operations.detail.complete')}</Button>
                </>
              )}
              {o.status === 'completed' && (
                <Button onPress={() => setReopenOpen(true)}><RotateCcw /> {t('operations.detail.correct')}</Button>
              )}
            </>
          )
        }
      />

      {o.status === 'completed' && o.completionSeq > 1 && (
        <Notice tone="info" className="mb-4">{t('operations.detail.corrected', { count: o.completionSeq - 1 })}</Notice>
      )}

      <div className="grid xl:grid-cols-[1.5fr_1fr] gap-6">
        <div className="space-y-6 min-w-0">
          <Card title={t('operations.fields')} padded={false}>
            <Table aria-label={t('operations.detail.treatedFields')}>
              <TableHeader>
                <Column isRowHeader>{t('operations.detail.field')}</Column>
                <Column>{t('operations.detail.crop')}</Column>
                <Column align="end">{t('operations.detail.treatedArea')}</Column>
              </TableHeader>
              <TableBody items={o.fields.map((f) => ({ id: `${f.fieldId}:${f.fieldPartId ?? ''}`, ...f }))}>
                {(f) => (
                  <Row id={f.id} href={`/o/${orgId}/fields/${f.fieldId}`}>
                    <Cell className="font-medium">
                      {f.fieldName}
                      {f.fieldPartName && <div className="text-xs text-muted font-normal">{f.fieldPartName}</div>}
                    </Cell>
                    <Cell>{f.cropName ? <CropTag name={f.cropName} /> : <span className="text-muted">{t('operations.detail.noCrop')}</span>}</Cell>
                    <Cell align="end">{fmt.ha(f.treatedAreaHa)}</Cell>
                  </Row>
                )}
              </TableBody>
            </Table>
          </Card>

          {o.inputs.length > 0 && (
            <Card title={t('operations.products')} padded={false} description={o.status === 'completed' ? t('operations.detail.deductedOnCompletion') : t('operations.detail.deductedWhenCompleted')}>
              <Table aria-label={t('operations.products')}>
                <TableHeader>
                  <Column isRowHeader>{t('operations.product')}</Column>
                  <Column align="end">{t('operations.rate')}</Column>
                  <Column align="end">{t('common.total')}</Column>
                  <Column align="end">{t('operations.detail.inStock')}</Column>
                  {can('finance.read') && <Column align="end">{t('operations.detail.value')}</Column>}
                </TableHeader>
                <TableBody items={o.inputs}>
                  {(i) => (
                    <Row id={i.id}>
                      <Cell className="font-medium">{i.productName}</Cell>
                      <Cell align="end">{fmt.qty(i.ratePerHa, i.baseUnit)}/ha</Cell>
                      <Cell align="end">{fmt.qty(i.totalQuantity, i.baseUnit)}</Cell>
                      <Cell align="end">
                        <span className={open && i.availableStock < i.totalQuantity ? 'text-warning font-medium' : undefined}>{fmt.qty(i.availableStock, i.baseUnit)}</span>
                      </Cell>
                      {can('finance.read') && <Cell align="end">{i.unitCost != null ? fmt.money(i.unitCost * i.totalQuantity, org.currency) : '—'}</Cell>}
                    </Row>
                  )}
                </TableBody>
              </Table>
            </Card>
          )}

          {o.nutrientTotals && <NutrientsCard operation={o} totals={o.nutrientTotals} />}

          {o.type === 'crop_protection' && <PsmChecksCard operation={o} />}

          {(movements.data?.length ?? 0) > 0 && (
            <Card title={t('operations.detail.stockMovements')} padded={false}>
              <Table aria-label={t('operations.detail.stockMovements')}>
                <TableHeader>
                  <Column isRowHeader>{t('operations.product')}</Column>
                  <Column>{t('operations.detail.kind')}</Column>
                  <Column>{t('operations.detail.when')}</Column>
                  <Column align="end">{t('operations.detail.quantity')}</Column>
                </TableHeader>
                <TableBody items={movements.data ?? []}>
                  {(m) => (
                    <Row id={m.id}>
                      <Cell>{m.productName}</Cell>
                      <Cell><Badge tone={m.kind === 'reversal' ? 'accent' : 'neutral'}>{m.kind === 'reversal' ? t('operations.detail.reversal') : t('operations.detail.consumption')}</Badge></Cell>
                      <Cell className="tabular">{fmt.dateTime(m.occurredAt)}</Cell>
                      <Cell align="end">{m.quantityDelta > 0 ? '+' : ''}{fmt.qty(m.quantityDelta, m.baseUnit)}</Cell>
                    </Row>
                  )}
                </TableBody>
              </Table>
            </Card>
          )}

          <Activity entityType="operation" entityId={o.id} />
        </div>

        <div className="space-y-6 min-w-0">
          <FieldMap fields={opFields} labels className="h-64" />
          <Card title={t('operations.detail.record')}>
            <DescriptionList
              items={[
                { label: t('common.type'), value: <OperationTypeLabel type={o.type} /> },
                { label: t('operations.farm'), value: o.farmName },
                { label: t('operations.detail.planned'), value: fmt.date(o.plannedOn) },
                { label: t('operations.detail.performed'), value: o.performedAt ? fmt.dateTime(o.performedAt) : null },
                { label: t('operations.responsible'), value: o.responsibleEmployee?.name },
                { label: t('operations.contractor'), value: o.contractorName },
                ...(o.type === 'crop_protection' ? [{ label: t('operations.detail.bbch'), value: o.bbchStage }, { label: t('operations.detail.target'), value: o.targetOrganism }] : []),
                { label: t('operations.detail.weather'), value: o.weatherConditions },
                ...Object.entries(o.details).map(([k, v]) => ({ label: t(`operations.form.detail.${k}`, { defaultValue: k.replace(/([A-Z])/g, ' $1').toLowerCase() }), value: detailValue(k, v) })),
                { label: t('common.notes'), value: o.notes },
              ]}
            />
          </Card>
          {(o.labor.length > 0 || o.equipment.length > 0) && (
            <Card title={t('operations.detail.work')}>
              <ul className="text-sm space-y-1.5">
                {o.labor.map((l) => (
                  <li key={l.employeeId} className="flex justify-between"><span>{l.employeeName}</span><span className="tabular text-fg-2">{fmt.fixed(l.hours, 2)} h</span></li>
                ))}
                {o.equipment.map((e) => (
                  <li key={e.equipmentId} className="flex justify-between"><span>{e.equipmentName}</span><span className="tabular text-fg-2">{fmt.fixed(e.hours, 2)} h</span></li>
                ))}
              </ul>
            </Card>
          )}
          {can('finance.read') && o.status === 'completed' && (
            <Card title={t('operations.detail.directCosts')} description={t('operations.detail.directCostsDescription')}>
              {o.costs.length === 0 ? (
                <p className="text-sm text-muted">{t('operations.detail.noCosts')}</p>
              ) : (
                <ul className="text-sm space-y-1.5">
                  {o.costs.map((c) => (
                    <li key={c.category} className="flex justify-between"><span>{costCategoryLabel(c.category as CostCategory)}</span><span className="tabular">{fmt.money(c.amount, org.currency, 2)}</span></li>
                  ))}
                  <li className="flex justify-between border-t border-line pt-1.5 font-medium"><span>{t('common.total')}</span><span className="tabular">{fmt.money(totalCost, org.currency, 2)} · {fmt.money(o.totalAreaHa ? totalCost / o.totalAreaHa : 0, org.currency, 2)}/ha</span></li>
                </ul>
              )}
            </Card>
          )}
          {writable && o.completionSeq === 0 && o.status !== 'completed' && (
            <div className="flex justify-end">
              <ConfirmButton
                title={t('operations.detail.deleteTitle')}
                message={t('operations.detail.deleteMessage')}
                confirmLabel={t('common.delete')}
                onConfirm={() => remove.mutateAsync()}
                trigger={<Button variant="ghost" className="text-danger"><Trash2 /> {t('common.delete')}</Button>}
              />
            </div>
          )}
        </div>
      </div>

      {completeOpen && <CompleteDialog operation={o} onClose={() => setCompleteOpen(false)} />}
      {reopenOpen && <ReopenDialog operation={o} onClose={() => setReopenOpen(false)} />}
    </>
  )
}

function detailValue(key: string, v: string | number | boolean | null) {
  if (v == null) return null
  if (key === 'applicationTechnique' && typeof v === 'string') return applicationTechniqueLabel(v as ApplicationTechnique)
  if (typeof v === 'boolean') return v ? t('common.yes') : t('common.no')
  if (typeof v === 'number') return fmt.num(v, 2)
  return v
}

/** kg nutrients per hectare of each fertilizer line and in total; only nutrients with values get a column. */
function NutrientsCard({ operation: o, totals }: { operation: Operation; totals: NutrientRates }) {
  const { t } = useTranslation()
  const keys = NUTRIENT_KEYS.filter((k) => totals[k] != null)
  const lines = o.inputs.filter((i) => i.nutrients)
  const assumed = lines.some((i) => i.densityAssumed)
  const rows = [
    ...lines.map((i) => ({ id: i.id, name: i.densityAssumed ? `${i.productName} *` : i.productName, rates: i.nutrients!, total: false })),
    ...(lines.length > 1 ? [{ id: '__total', name: t('common.total'), rates: totals, total: true }] : []),
  ]
  return (
    <Card title={t('operations.detail.nutrients.title')} description={t('operations.detail.nutrients.description')} padded={false}>
      <Table aria-label={t('operations.detail.nutrients.title')}>
        <TableHeader>
          <Column isRowHeader>{t('operations.product')}</Column>
          {keys.map((k) => (
            <Column key={k} id={k} align="end">{NUTRIENT_LABELS[k]}</Column>
          ))}
        </TableHeader>
        <TableBody items={rows} dependencies={[keys.join()]}>
          {(r) => (
            <Row id={r.id} className={r.total ? 'font-medium bg-surface-2/50' : undefined}>
              <Cell className={r.total ? undefined : 'font-medium'}>{r.name}</Cell>
              {keys.map((k) => (
                <Cell key={k} align="end">{fmt.num(r.rates[k], 1)}</Cell>
              ))}
            </Row>
          )}
        </TableBody>
      </Table>
      {assumed && <p className="text-xs text-muted px-4 py-3 border-t border-line">* {t('operations.detail.nutrients.densityAssumed')}</p>}
    </Card>
  )
}

/** Date params of PSM findings are ISO dates; numbers are shown in the locale (`count` stays a number for plurals). */
const DATE_PARAMS = new Set(['date', 'limit', 'harvestDate', 'earliest', 'previous'])

function findingMessage(f: PsmFinding) {
  const params = Object.fromEntries(Object.entries(f.params).map(([k, v]) => [k, k === 'count' ? v : typeof v === 'number' ? fmt.num(v, 3) : DATE_PARAMS.has(k) ? fmt.date(v) : v]))
  const key = f.code === 'unknown_registration' && !f.params.kennr ? 'psm.finding.unknown_registration_none' : `psm.finding.${f.code}`
  return t(key, { ...params, defaultValue: f.message })
}

/** Compares the application with the approvals in agmeo's copy of the BVL register. */
function PsmChecksCard({ operation: o }: { operation: Operation }) {
  const { t } = useTranslation()
  const checks = useOrgQuery<OperationChecks>(`/operations/${o.id}/checks`)
  const where = (cropCycleId: string) =>
    o.fields
      .filter((f) => f.cropCycleId === cropCycleId)
      .map((f) => [f.fieldName, f.fieldPartName].filter(Boolean).join(' – ') + (f.cropName ? ` (${f.cropName})` : ''))
      .join(', ')

  return (
    <Card title={t('operations.checks.title')} description={t('operations.checks.description')}>
      {checks.isLoading ? (
        <Loading />
      ) : checks.error ? (
        <ErrorNotice error={checks.error} />
      ) : (
        <div className="space-y-4">
          {checks.data!.psm.length === 0 ? (
            <p className="text-sm text-success flex items-center gap-1.5">
              <CheckCircle2 className="size-4" /> {t('operations.checks.none')}
            </p>
          ) : (
            <ul className="divide-y divide-line -my-2">
              {checks.data!.psm.map((f, i) => (
                <li key={`${f.code}:${f.productId}:${i}`} className="py-2.5 text-sm space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={f.severity === 'deviation' ? 'danger' : 'warning'}>{t(`operations.checks.severity.${f.severity}`)}</Badge>
                    <span className="font-medium">{f.productName}</span>
                    {(f.fieldName || f.cropName) && <span className="text-muted">{[f.fieldName, f.cropName].filter(Boolean).join(' · ')}</span>}
                  </div>
                  <p className="text-fg-2">{findingMessage(f)}</p>
                  {f.awgId && <p className="text-xs text-muted">{t('operations.checks.measuredAgainst', { awgId: f.awgId })}</p>}
                </li>
              ))}
            </ul>
          )}
          {checks.data!.earliestHarvest.length > 0 && (
            <ul className="text-sm space-y-1 border-t border-line pt-3">
              {checks.data!.earliestHarvest.map((h) => (
                <li key={h.cropCycleId}>{t('operations.checks.earliestHarvest', { date: fmt.date(h.date), where: where(h.cropCycleId) || '—' })}</li>
              ))}
            </ul>
          )}
          <p className="text-xs text-muted flex gap-1.5">
            <Info className="size-3.5 shrink-0 mt-px" aria-hidden /> {t('operations.checks.disclaimer')}
          </p>
        </div>
      )}
    </Card>
  )
}

function CompleteDialog({ operation, onClose }: { operation: Operation; onClose: () => void }) {
  const { t } = useTranslation()
  const { can } = useOrg()
  const performed = operation.performedAt ? new Date(operation.performedAt) : null
  const [date, setDate] = useState<string | null>(performed ? performed.toLocaleDateString('sv-SE') : (operation.plannedOn && operation.plannedOn <= today() ? operation.plannedOn : today()))
  const [time, setTime] = useState(performed ? performed.toTimeString().slice(0, 5) : new Date().toTimeString().slice(0, 5))
  const complete = useOrgMutation(
    (base, allowNegativeStock: boolean) =>
      api.post<Operation>(`${base}/operations/${operation.id}/complete`, { version: operation.version, performedAt: date ? localToIso(date, time) : undefined, allowNegativeStock }),
    { success: t('operations.toast.completed'), onSuccess: onClose, silentError: true },
  )
  const shortages = complete.error instanceof ApiRequestError && complete.error.code === 'insufficient_stock' ? (complete.error.details as StockShortage[]) : null
  return (
    <ModalDialog isOpen onOpenChange={(o) => !o && onClose()} title={t('operations.complete.title')} description={t('operations.complete.description')} size="sm">
      <Form onSubmit={(e) => { e.preventDefault(); complete.mutate(false) }} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <DatePicker label={t('operations.performedOn')} value={date} onChange={setDate} maxValue={today()} isRequired />
          <TextField label={t('operations.time')} type="time" value={time} onChange={setTime} />
        </div>
        {shortages && (
          <Notice tone="warning" icon={AlertTriangle}>
            <strong>{t('operations.complete.shortageTitle')}</strong>
            <ul className="list-disc pl-4 mt-1">
              {shortages.map((s) => <li key={s.productId}>{t('operations.complete.shortageLine', { product: s.productName, required: fmt.qty(s.required, s.baseUnit), available: fmt.qty(s.available, s.baseUnit) })}</li>)}
            </ul>
          </Notice>
        )}
        {complete.error && !shortages && <Notice tone="danger">{errorMessage(complete.error)}</Notice>}
        <div className="flex justify-end gap-2">
          <Button onPress={onClose}>{t('common.cancel')}</Button>
          {shortages && can('inventory.write') && <Button variant="secondary" isPending={complete.isPending} onPress={() => complete.mutate(true)}>{t('operations.completeAnyway')}</Button>}
          <Button type="submit" variant="primary" isPending={complete.isPending && !shortages}>{t('operations.detail.complete')}</Button>
        </div>
      </Form>
    </ModalDialog>
  )
}

function ReopenDialog({ operation, onClose }: { operation: Operation; onClose: () => void }) {
  const { t } = useTranslation()
  const [reason, setReason] = useState('')
  const reopen = useOrgMutation((base, _: void) => api.post<Operation>(`${base}/operations/${operation.id}/reopen`, { version: operation.version, reason }), {
    success: t('operations.toast.reopened'),
    onSuccess: onClose,
  })
  return (
    <ModalDialog isOpen onOpenChange={(o) => !o && onClose()} title={t('operations.reopen.title')} size="sm">
      <Form onSubmit={(e) => { e.preventDefault(); reopen.mutate() }} className="space-y-4">
        <p className="text-sm text-fg-2">{t('operations.reopen.body')}</p>
        <TextField label={t('operations.reopen.reason')} isRequired minLength={3} multiline rows={2} value={reason} onChange={setReason} />
        <div className="flex justify-end gap-2">
          <Button onPress={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" variant="primary" isPending={reopen.isPending}>{t('operations.reopen.submit')}</Button>
        </div>
      </Form>
    </ModalDialog>
  )
}

function EditOperation({ operation, fields, onDone }: { operation: Operation; fields: Field[]; onDone: () => void }) {
  const { t } = useTranslation()
  const { orgId } = useOrg()
  const [state, setState] = useState<OperationFormState>(() => initialState({ farmId: operation.farmId, fields, operation }))
  const save = useOrgMutation((base, _: void) => api.put<Operation>(`${base}/operations/${operation.id}`, toPayload(state, fields, operation.version)), {
    success: t('operations.toast.updated'),
    onSuccess: onDone,
    silentError: true,
  })
  return (
    <>
      <PageHeader eyebrow={<Link to="/o/$orgId/operations/$operationId" params={{ orgId, operationId: operation.id }}>{operation.title}</Link>} title={t('operations.edit.title')} />
      <OperationForm
        value={state}
        onChange={setState}
        onSubmit={() => save.mutate()}
        isPending={save.isPending}
        error={save.error}
        submitLabel={t('common.saveChanges')}
        extraActions={<Button onPress={onDone}>{t('operations.edit.discard')}</Button>}
      />
    </>
  )
}
