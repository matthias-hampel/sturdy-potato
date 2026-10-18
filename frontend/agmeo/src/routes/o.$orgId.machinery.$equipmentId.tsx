import {
  type Equipment,
  type EquipmentUsage,
  type Farm,
  type MaintenanceInput,
  type MaintenanceRecord,
  type OperationStatus,
  type OperationType,
} from '@agmeo/contracts'
import { createFileRoute } from '@tanstack/react-router'
import { ArrowLeft, CalendarClock, ClipboardList, Clock, Gauge, Pencil, Plus, Wrench } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { Form } from 'react-aria-components'
import { useTranslation } from 'react-i18next'
import { OperationStatusBadge, OperationTypeLabel } from '#/components/labels'
import { EquipmentDialog, EquipmentIcon, EquipmentStatusBadge, NextMaintenance } from '#/components/resources/equipment'
import { FormActions } from '#/components/resources/form'
import { t } from '#/i18n'
import { equipmentKindLabel } from '#/i18n/labels'
import { api } from '#/lib/api'
import { fmt, today } from '#/lib/format'
import { useOrg } from '#/lib/org'
import { useOrgMutation, useOrgQuery } from '#/lib/queries'
import { Button, Link } from '#/ui/Button'
import { DatePicker, NumberField, TextField, num } from '#/ui/Field'
import { Card, DescriptionList, EmptyState, ErrorNotice, Loading, PageHeader, Stat } from '#/ui/Layout'
import { Dialog, DialogTrigger } from '#/ui/Overlay'
import { Cell, Column, Row, Table, TableBody, TableHeader } from '#/ui/Table'

export const Route = createFileRoute('/o/$orgId/machinery/$equipmentId')({ component: EquipmentPage })

function EquipmentPage() {
  const { t } = useTranslation()
  const { equipmentId } = Route.useParams()
  const { orgId, org, can } = useOrg()
  const canWrite = can('machinery.write')
  const equipment = useOrgQuery<Equipment>(`/equipment/${equipmentId}`)
  const farms = useOrgQuery<Farm[]>('/farms')

  const back = (
    <Link to="/o/$orgId/machinery" params={{ orgId }} className="inline-flex items-center gap-1 normal-case tracking-normal">
      <ArrowLeft className="size-3.5" aria-hidden /> {t('machinery.title')}
    </Link>
  )

  if (equipment.isLoading) return <Loading />
  if (equipment.error || !equipment.data)
    return (
      <>
        <PageHeader eyebrow={back} title={t('machinery.equipment')} />
        <ErrorNotice error={equipment.error ?? new Error(t('machinery.notFound'))} />
      </>
    )

  const e = equipment.data
  const subtitle = [equipmentKindLabel(e.kind), [e.manufacturer, e.model].filter(Boolean).join(' '), e.modelYear && String(e.modelYear)].filter(Boolean).join(' · ')
  const farm = farms.data?.find((f) => f.id === e.farmId)
  const next = e.nextMaintenance

  return (
    <>
      <PageHeader
        eyebrow={back}
        title={
          <span className="flex flex-wrap items-center gap-3">
            <EquipmentIcon kind={e.kind} className="size-9" />
            {e.name}
            <EquipmentStatusBadge status={e.status} />
          </span>
        }
        subtitle={subtitle}
        actions={
          canWrite && (
            <>
              <EquipmentDialog
                equipment={e}
                trigger={
                  <Button>
                    <Pencil /> {t('common.edit')}
                  </Button>
                }
              />
              <MaintenanceDialog
                equipment={e}
                trigger={
                  <Button variant="primary">
                    <Plus /> {t('machinery.logMaintenance')}
                  </Button>
                }
              />
            </>
          )
        }
      />

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
        <Stat icon={Gauge} label={t('machinery.field.hourMeter')} value={`${fmt.num(e.hourMeter)} h`} />
        <Stat
          icon={Clock}
          label={t('machinery.stats.hoursThisYear')}
          value={`${fmt.num(e.hoursThisYear, 1)} h`}
          hint={e.hourlyCost != null ? t('machinery.detail.machineCost', { amount: fmt.money(e.hoursThisYear * e.hourlyCost, org.currency) }) : t('machinery.detail.noHourlyCost')}
        />
        <Stat icon={Wrench} label={t('machinery.stats.maintenanceThisYear')} value={fmt.money(e.maintenanceCostThisYear, org.currency)} />
        <Stat
          icon={CalendarClock}
          label={t('machinery.nextService')}
          value={next?.dueOn ? fmt.date(next.dueOn) : next?.dueHours != null ? `${fmt.num(next.dueHours)} h` : '—'}
          hint={nextServiceHint(e)}
          tone={next?.overdue ? 'danger' : 'default'}
        />
      </div>

      <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-6 mb-6 items-start">
        <Card title={t('common.details')}>
          <DescriptionList
            items={[
              { label: t('machinery.field.kind'), value: equipmentKindLabel(e.kind) },
              { label: t('machinery.field.farm'), value: farm?.name ?? (e.farmId ? null : t('machinery.detail.notAssigned')) },
              { label: t('machinery.field.manufacturer'), value: e.manufacturer },
              { label: t('machinery.field.model'), value: e.model },
              { label: t('machinery.field.modelYear'), value: e.modelYear },
              { label: t('machinery.field.registration'), value: e.registration },
              { label: t('machinery.field.hourlyCost'), value: e.hourlyCost != null ? `${fmt.money(e.hourlyCost, org.currency, 2)} / h` : null },
              { label: t('machinery.field.fuelLPerH'), value: e.fuelLPerH != null ? `${fmt.num(e.fuelLPerH, 1)} l/h` : null },
              { label: t('machinery.nextService'), value: <NextMaintenance next={next} /> },
              { label: t('common.notes'), value: e.notes ? <span className="whitespace-pre-line">{e.notes}</span> : null },
            ]}
          />
        </Card>
        <MaintenanceLog equipment={e} canWrite={canWrite} currency={org.currency} />
      </div>

      <UsageCard equipment={e} orgId={orgId} currency={org.currency} />
    </>
  )
}

function nextServiceHint(e: Equipment) {
  const next = e.nextMaintenance
  if (!next || (!next.dueOn && next.dueHours == null)) return t('machinery.detail.nothingScheduled')
  if (next.overdue) return t('machinery.overdue')
  const hoursLeft = next.dueHours != null ? t('machinery.detail.hoursLeft', { hours: fmt.num(Math.max(0, next.dueHours - e.hourMeter)) }) : null
  if (next.dueOn) return hoursLeft ? t('machinery.detail.dueOrAtHours', { relative: fmt.relativeDays(next.dueOn), hours: fmt.num(next.dueHours) }) : fmt.relativeDays(next.dueOn)
  return hoursLeft
}

function MaintenanceLog({ equipment, canWrite, currency }: { equipment: Equipment; canWrite: boolean; currency: string }) {
  const { t } = useTranslation()
  const records = useOrgQuery<MaintenanceRecord[]>(`/equipment/${equipment.id}/maintenance`)
  const sorted = [...(records.data ?? [])].sort((a, b) => b.performedOn.localeCompare(a.performedOn) || b.createdAt.localeCompare(a.createdAt))
  const total = sorted.reduce((s, r) => s + (r.cost ?? 0), 0)

  return (
    <Card
      title={t('machinery.maintenance.title')}
      description={sorted.length ? t('machinery.maintenance.summary', { count: sorted.length, total: fmt.money(total, currency) }) : undefined}
      actions={
        canWrite &&
        sorted.length > 0 && (
          <MaintenanceDialog
            equipment={equipment}
            trigger={
              <Button size="sm" variant="quiet">
                <Plus /> {t('common.add')}
              </Button>
            }
          />
        )
      }
    >
      {records.isLoading ? (
        <Loading />
      ) : records.error ? (
        <ErrorNotice error={records.error} />
      ) : sorted.length === 0 ? (
        <EmptyState
          icon={Wrench}
          title={t('machinery.maintenance.empty.title')}
          action={
            canWrite && (
              <MaintenanceDialog
                equipment={equipment}
                trigger={
                  <Button>
                    <Plus /> {t('machinery.logMaintenance')}
                  </Button>
                }
              />
            )
          }
        >
          {t('machinery.maintenance.empty.text')}
        </EmptyState>
      ) : (
        <ol className="divide-y divide-line -my-2">
          {sorted.map((r) => (
            <li key={r.id} className="py-3 flex gap-3">
              <div className="w-20 shrink-0 text-xs text-muted tabular pt-0.5">{fmt.date(r.performedOn)}</div>
              <div className="min-w-0 flex-1">
                <p className="text-sm text-fg whitespace-pre-line break-words">{r.description}</p>
                <div className="text-xs text-muted mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                  {r.hourMeter != null && <span>{t('machinery.maintenance.atHours', { hours: fmt.num(r.hourMeter) })}</span>}
                  {(r.nextDueOn || r.nextDueHours != null) && (
                    <span>
                      {r.nextDueOn && r.nextDueHours != null
                        ? t('machinery.maintenance.nextDueBoth', { date: fmt.date(r.nextDueOn), hours: fmt.num(r.nextDueHours) })
                        : r.nextDueOn
                          ? t('machinery.maintenance.nextDueDate', { date: fmt.date(r.nextDueOn) })
                          : t('machinery.maintenance.nextDueHours', { hours: fmt.num(r.nextDueHours) })}
                    </span>
                  )}
                </div>
              </div>
              <div className="text-sm tabular font-medium text-fg whitespace-nowrap">{r.cost != null ? fmt.money(r.cost, currency, 2) : <span className="text-muted">—</span>}</div>
            </li>
          ))}
        </ol>
      )}
    </Card>
  )
}

function MaintenanceDialog({ equipment, trigger }: { equipment: Equipment; trigger: ReactNode }) {
  const { t } = useTranslation()
  return (
    <DialogTrigger>
      {trigger}
      <Dialog title={t('machinery.logMaintenance')} description={t('machinery.maintenance.dialogDescription', { name: equipment.name })} size="md">
        {(close) => <MaintenanceForm equipment={equipment} close={close} />}
      </Dialog>
    </DialogTrigger>
  )
}

function MaintenanceForm({ equipment, close }: { equipment: Equipment; close: () => void }) {
  const { t } = useTranslation()
  const { org } = useOrg()
  const [performedOn, setPerformedOn] = useState<string | null>(today())
  const [description, setDescription] = useState('')
  const [cost, setCost] = useState(NaN)
  const [hourMeter, setHourMeter] = useState<number>(equipment.hourMeter)
  const [nextDueOn, setNextDueOn] = useState<string | null>(null)
  const [nextDueHours, setNextDueHours] = useState(NaN)

  const save = useOrgMutation((base, input: MaintenanceInput) => api.post<MaintenanceRecord>(`${base}/equipment/${equipment.id}/maintenance`, input), {
    success: t('machinery.maintenance.recorded'),
    onSuccess: close,
  })

  const reading = num(hourMeter)
  const dueHours = num(nextDueHours)
  const dueHoursInvalid = dueHours != null && reading != null && dueHours <= reading

  return (
    <Form
      className="grid sm:grid-cols-2 gap-4"
      onSubmit={(ev) => {
        ev.preventDefault()
        if (!performedOn || dueHoursInvalid) return
        save.mutate({
          performedOn,
          description: description.trim(),
          cost: num(cost),
          hourMeter: reading,
          nextDueOn,
          nextDueHours: dueHours,
        })
      }}
    >
      <DatePicker label={t('common.date')} isRequired value={performedOn} onChange={setPerformedOn} maxValue={today()} />
      <NumberField label={t('machinery.maintenance.hourMeterReading')} unit="h" value={hourMeter} onChange={setHourMeter} minValue={0} formatOptions={{ maximumFractionDigits: 1 }} />
      <TextField
        label={t('machinery.maintenance.workDone')}
        isRequired
        autoFocus
        multiline
        value={description}
        onChange={setDescription}
        placeholder={t('machinery.maintenance.workDonePlaceholder')}
        className="sm:col-span-2"
      />
      <NumberField label={t('machinery.maintenance.cost')} unit={org.currency} value={cost} onChange={setCost} minValue={0} formatOptions={{ maximumFractionDigits: 2 }} className="sm:col-span-2" />
      <fieldset className="sm:col-span-2 grid sm:grid-cols-2 gap-4 rounded-lg border border-line p-3 pt-2">
        <legend className="px-1 text-xs font-medium text-muted">{t('machinery.maintenance.nextServiceOptional')}</legend>
        <DatePicker label={t('machinery.maintenance.dueOn')} value={nextDueOn} onChange={setNextDueOn} minValue={performedOn ?? undefined} />
        <NumberField
          label={t('machinery.maintenance.dueAt')}
          unit="h"
          value={nextDueHours}
          onChange={setNextDueHours}
          minValue={0}
          formatOptions={{ maximumFractionDigits: 1 }}
          isInvalid={dueHoursInvalid}
          errorMessage={t('machinery.maintenance.dueAtInvalid')}
        />
      </fieldset>
      <div className="sm:col-span-2">
        <FormActions close={close} isPending={save.isPending} submitLabel={t('machinery.maintenance.saveEntry')} />
      </div>
    </Form>
  )
}

function UsageCard({ equipment, orgId, currency }: { equipment: Equipment; orgId: string; currency: string }) {
  const { t } = useTranslation()
  const usage = useOrgQuery<EquipmentUsage[]>(`/equipment/${equipment.id}/usage`)
  const rows = usage.data ?? []
  const totalHours = rows.filter((u) => u.status === 'completed').reduce((s, u) => s + u.hours, 0)
  const rate = equipment.hourlyCost

  return (
    <Card
      title={t('machinery.usage.title')}
      description={rows.length ? t('machinery.usage.summary', { count: rows.length, hours: fmt.num(totalHours, 1) }) : t('machinery.usage.description')}
      padded={false}
    >
      {usage.isLoading ? (
        <div className="p-4">
          <Loading />
        </div>
      ) : usage.error ? (
        <div className="p-4">
          <ErrorNotice error={usage.error} />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState icon={ClipboardList} title={t('machinery.usage.empty.title')}>
          {t('machinery.usage.empty.text')}
        </EmptyState>
      ) : (
        <Table aria-label={t('machinery.usage.tableLabel')}>
          <TableHeader>
            <Column isRowHeader>{t('machinery.usage.operation')}</Column>
            <Column>{t('common.type')}</Column>
            <Column>{t('common.date')}</Column>
            <Column>{t('common.status')}</Column>
            <Column align="end">{t('machinery.usage.hours')}</Column>
            {rate != null && <Column align="end">{t('machinery.usage.machineCost')}</Column>}
          </TableHeader>
          <TableBody items={rows} dependencies={[rate, orgId]}>
            {(u) => (
              <Row id={u.operationId}>
                <Cell>
                  <Link to="/o/$orgId/operations/$operationId" params={{ orgId, operationId: u.operationId }} className="font-medium">
                    {u.title}
                  </Link>
                </Cell>
                <Cell>
                  <OperationTypeLabel type={u.type as OperationType} />
                </Cell>
                <Cell className="whitespace-nowrap tabular">{fmt.date(u.performedAt)}</Cell>
                <Cell>
                  <OperationStatusBadge status={u.status as OperationStatus} />
                </Cell>
                <Cell align="end">{fmt.num(u.hours, 1)} h</Cell>
                {rate != null && <Cell align="end">{fmt.money(u.hours * rate, currency)}</Cell>}
              </Row>
            )}
          </TableBody>
        </Table>
      )}
    </Card>
  )
}
