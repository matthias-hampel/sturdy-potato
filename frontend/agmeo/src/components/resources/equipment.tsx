import {
  EQUIPMENT_KINDS,
  EQUIPMENT_STATUSES,
  type Equipment,
  type EquipmentInput,
  type EquipmentKind,
  type EquipmentStatus,
  type Farm,
} from '@agmeo/contracts'
import { Car, Container, Cog, Forklift, Shovel, SprayCan, Sprout, Tractor, Truck, Wheat, type LucideIcon } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { Form } from 'react-aria-components'
import { useTranslation } from 'react-i18next'
import { t } from '#/i18n'
import { equipmentKindLabel } from '#/i18n/labels'
import { api } from '#/lib/api'
import { fmt } from '#/lib/format'
import { useOrg } from '#/lib/org'
import { useOrgMutation, useOrgQuery } from '#/lib/queries'
import { NumberField, Option, Select, TextField, num } from '#/ui/Field'
import { Badge, type BadgeTone } from '#/ui/Layout'
import { Dialog, DialogTrigger } from '#/ui/Overlay'
import { cx } from '#/ui/utils'
import { FormActions, NONE, enumItems, keyOrNull, textOrNull } from './form'

export const EQUIPMENT_ICONS: Record<EquipmentKind, LucideIcon> = {
  tractor: Tractor,
  combine: Wheat,
  sprayer: SprayCan,
  spreader: Container,
  seeder: Sprout,
  tillage: Shovel,
  trailer: Truck,
  loader: Forklift,
  vehicle: Car,
  other: Cog,
}

export function EquipmentIcon({ kind, className }: { kind: EquipmentKind; className?: string }) {
  const Icon = EQUIPMENT_ICONS[kind]
  return (
    <span className={cx('size-10 rounded-lg bg-primary-soft text-primary flex items-center justify-center shrink-0', className)} aria-hidden>
      <Icon className="size-5" />
    </span>
  )
}

/** Translated equipment status (`machinery.status.<value>`); `.all()` for a select's items. */
export const equipmentStatusLabel = Object.assign((status: EquipmentStatus) => t(`machinery.status.${status}`), {
  all: () => Object.fromEntries(EQUIPMENT_STATUSES.map((s) => [s, t(`machinery.status.${s}`)])) as Record<EquipmentStatus, string>,
})

const STATUS_TONES: Record<EquipmentStatus, BadgeTone> = { active: 'success', maintenance: 'warning', retired: 'neutral' }

export function EquipmentStatusBadge({ status }: { status: EquipmentStatus }) {
  return <Badge tone={STATUS_TONES[status]}>{equipmentStatusLabel(status)}</Badge>
}

/** "due 15 Oct 2026 · at 3,000 h" with an overdue badge, or a quiet placeholder. */
export function NextMaintenance({ next, className }: { next: Equipment['nextMaintenance']; className?: string }) {
  const { t } = useTranslation()
  if (!next || (next.dueOn == null && next.dueHours == null)) return <span className={cx('text-muted', className)}>{t('machinery.noServiceScheduled')}</span>
  const parts = [next.dueOn && fmt.date(next.dueOn), next.dueHours != null && t('machinery.atHours', { hours: fmt.num(next.dueHours) })].filter(Boolean)
  return (
    <span className={cx('inline-flex flex-wrap items-center gap-x-2 gap-y-1', className)}>
      <span className={next.overdue ? 'text-danger font-medium' : 'text-fg'}>{parts.join(' · ')}</span>
      {next.overdue && <Badge tone="danger">{t('machinery.overdue')}</Badge>}
    </span>
  )
}

/** Add-or-edit equipment dialog opened by `trigger` (a Button). */
export function EquipmentDialog({ equipment, trigger }: { equipment?: Equipment; trigger: ReactNode }) {
  const { t } = useTranslation()
  return (
    <DialogTrigger>
      {trigger}
      <Dialog
        title={equipment ? t('machinery.editTitle', { name: equipment.name }) : t('machinery.addEquipment')}
        description={equipment ? undefined : t('machinery.dialogDescription')}
        size="lg"
      >
        {(close) => <EquipmentForm equipment={equipment} close={close} />}
      </Dialog>
    </DialogTrigger>
  )
}

function EquipmentForm({ equipment, close }: { equipment?: Equipment; close: () => void }) {
  const { t } = useTranslation()
  const { org } = useOrg()
  const kindItems = enumItems(EQUIPMENT_KINDS, equipmentKindLabel.all())
  const statusItems = enumItems(EQUIPMENT_STATUSES, equipmentStatusLabel.all())
  const farms = useOrgQuery<Farm[]>('/farms')
  const [name, setName] = useState(equipment?.name ?? '')
  const [kind, setKind] = useState<EquipmentKind>(equipment?.kind ?? 'tractor')
  // undefined = not chosen yet; a single farm is preselected for new equipment.
  const [farmId, setFarmId] = useState<string | undefined>(equipment ? (equipment.farmId ?? NONE) : undefined)
  const [manufacturer, setManufacturer] = useState(equipment?.manufacturer ?? '')
  const [model, setModel] = useState(equipment?.model ?? '')
  const [modelYear, setModelYear] = useState(equipment?.modelYear ?? NaN)
  const [registration, setRegistration] = useState(equipment?.registration ?? '')
  const [hourMeter, setHourMeter] = useState(equipment?.hourMeter ?? 0)
  const [hourlyCost, setHourlyCost] = useState(equipment?.hourlyCost ?? NaN)
  const [fuelLPerH, setFuelLPerH] = useState(equipment?.fuelLPerH ?? NaN)
  const [status, setStatus] = useState<EquipmentStatus>(equipment?.status ?? 'active')
  const [notes, setNotes] = useState(equipment?.notes ?? '')

  const farmItems = [{ id: NONE, name: t('machinery.field.noFarm') }, ...(farms.data ?? []).filter((f) => !f.archivedAt || f.id === equipment?.farmId)]
  const farmValue = farmId ?? (farms.data?.length === 1 ? farms.data[0].id : NONE)

  const save = useOrgMutation(
    (base, input: EquipmentInput) => (equipment ? api.put<Equipment>(`${base}/equipment/${equipment.id}`, input) : api.post<Equipment>(`${base}/equipment`, input)),
    { success: equipment ? t('machinery.updated') : t('machinery.added'), onSuccess: close },
  )

  return (
    <Form
      className="grid sm:grid-cols-2 gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        save.mutate({
          name: name.trim(),
          kind,
          farmId: keyOrNull(farmValue),
          manufacturer: textOrNull(manufacturer),
          model: textOrNull(model),
          modelYear: num(modelYear),
          registration: textOrNull(registration),
          hourMeter: num(hourMeter) ?? 0,
          hourlyCost: num(hourlyCost),
          fuelLPerH: num(fuelLPerH),
          status,
          notes: textOrNull(notes),
        })
      }}
    >
      <TextField label={t('common.name')} isRequired autoFocus value={name} onChange={setName} placeholder={t('machinery.field.namePlaceholder')} className="sm:col-span-2" />
      <Select label={t('machinery.field.kind')} items={kindItems} value={kind} onChange={(v) => v && setKind(v as EquipmentKind)}>
        {(k) => <Option id={k.id}>{k.name}</Option>}
      </Select>
      <Select label={t('machinery.field.farm')} items={farmItems} value={farmValue} onChange={(v) => setFarmId(String(v ?? NONE))}>
        {(f) => <Option id={f.id}>{f.name}</Option>}
      </Select>
      <TextField label={t('machinery.field.manufacturer')} value={manufacturer} onChange={setManufacturer} />
      <TextField label={t('machinery.field.model')} value={model} onChange={setModel} />
      <NumberField label={t('machinery.field.modelYear')} value={modelYear} onChange={setModelYear} minValue={1900} maxValue={2100} formatOptions={{ useGrouping: false }} />
      <TextField label={t('machinery.field.registration')} value={registration} onChange={setRegistration} placeholder={t('machinery.field.registrationPlaceholder')} />
      <NumberField
        label={t('machinery.field.hourMeter')}
        unit="h"
        value={hourMeter}
        onChange={setHourMeter}
        minValue={0}
        formatOptions={{ maximumFractionDigits: 1 }}
        description={equipment ? t('machinery.field.hourMeterEditHint') : t('machinery.field.hourMeterNewHint')}
      />
      <NumberField
        label={t('machinery.field.hourlyCost')}
        unit={`${org.currency}/h`}
        value={hourlyCost}
        onChange={setHourlyCost}
        minValue={0}
        formatOptions={{ maximumFractionDigits: 2 }}
        description={t('machinery.field.hourlyCostHint')}
      />
      <NumberField
        label={t('machinery.field.fuelLPerH')}
        unit="l/h"
        value={fuelLPerH}
        onChange={setFuelLPerH}
        minValue={0}
        maxValue={500}
        formatOptions={{ maximumFractionDigits: 1 }}
        description={t('machinery.field.fuelLPerHHint')}
      />
      <Select label={t('common.status')} items={statusItems} value={status} onChange={(v) => v && setStatus(v as EquipmentStatus)}>
        {(s) => <Option id={s.id}>{s.name}</Option>}
      </Select>
      <TextField label={t('common.notes')} multiline value={notes} onChange={setNotes} className="sm:col-span-2" />
      <div className="sm:col-span-2">
        <FormActions close={close} isPending={save.isPending} submitLabel={equipment ? t('common.saveChanges') : t('machinery.addEquipment')} />
      </div>
    </Form>
  )
}
