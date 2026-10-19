import {
  ACQUISITION_TYPES,
  DEPRECIATION_METHODS,
  EQUIPMENT_STATUSES,
  FINANCING_TYPES,
  IMPLEMENT_TYPES,
  IRRIGATION_TYPES,
  MACHINE_CATEGORIES,
  MOUNT_TYPES,
  type AcquisitionType,
  type CatalogueImplement,
  type CatalogueMachine,
  type DepreciationMethod,
  type Employee,
  type Equipment,
  type EquipmentCategory,
  type EquipmentClass,
  type EquipmentInput,
  type EquipmentKind,
  type EquipmentStatus,
  type Farm,
  type FinancingType,
  type IrrigationType,
  type MountType,
  type TyreSpec,
} from '@agmeo/contracts'
import { Car, Container, Cog, Forklift, Gauge, Shovel, SprayCan, Sprout, Tractor, Truck, Wheat, type LucideIcon } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { Form } from 'react-aria-components'
import { useTranslation } from 'react-i18next'
import { t } from '#/i18n'
import { api } from '#/lib/api'
import { fmt } from '#/lib/format'
import { useOrg } from '#/lib/org'
import { useOrgMutation, useOrgQuery } from '#/lib/queries'
import { SegmentedControl } from '#/ui/Button'
import { ComboBox, DatePicker, NumberField, Option, Select, TextField, num } from '#/ui/Field'
import { Badge, type BadgeTone, Tab, TabList, TabPanel, Tabs } from '#/ui/Layout'
import { Dialog, DialogTrigger } from '#/ui/Overlay'
import { cx } from '#/ui/utils'
import { FormActions, NONE, keyOrNull, textOrNull } from './form'

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

/** Translated label of an enum value (`machinery.<group>.<value>`); `.items()` for a select. */
function enumLabel<T extends string>(group: string, values: readonly T[]) {
  return Object.assign((value: T) => t(`machinery.${group}.${value}`), {
    items: () => values.map((id) => ({ id, name: t(`machinery.${group}.${id}`) })),
  })
}

export const equipmentStatusLabel = enumLabel('status', EQUIPMENT_STATUSES)
export const machineCategoryLabel = enumLabel('category', MACHINE_CATEGORIES)
export const implementTypeLabel = enumLabel('implementType', IMPLEMENT_TYPES)
export const mountTypeLabel = enumLabel('mountType', MOUNT_TYPES)
const acquisitionLabel = enumLabel('acquisition', ACQUISITION_TYPES)
const depreciationLabel = enumLabel('depreciation', DEPRECIATION_METHODS)
const financingLabel = enumLabel('financing', FINANCING_TYPES)
export const irrigationTypeLabel = enumLabel('irrigation', IRRIGATION_TYPES)

/** Category of a machine or type of an implement. */
export const equipmentCategoryLabel = (e: { class: EquipmentClass; category: EquipmentCategory }) =>
  e.class === 'machine' ? machineCategoryLabel(e.category as (typeof MACHINE_CATEGORIES)[number]) : implementTypeLabel(e.category as (typeof IMPLEMENT_TYPES)[number])

const STATUS_TONES: Record<EquipmentStatus, BadgeTone> = {
  active: 'success',
  in_repair: 'warning',
  loaned_out: 'info',
  sold: 'neutral',
  scrapped: 'neutral',
  decommissioned: 'neutral',
}

export function EquipmentStatusBadge({ status }: { status: EquipmentStatus }) {
  return <Badge tone={STATUS_TONES[status]}>{equipmentStatusLabel(status)}</Badge>
}

/** Whether the soil compaction index can be computed for a machine (tyres, mass, axle share). */
export function SciBadge({ equipment: e }: { equipment: Equipment }) {
  const { t } = useTranslation()
  if (e.class !== 'machine') return null
  return (
    <span title={e.sciReady ? t('machinery.sci.readyHint') : t('machinery.sci.missingHint')}>
      <Badge tone={e.sciReady ? 'success' : 'neutral'}>
        <Gauge className="size-3" aria-hidden /> {e.sciReady ? t('machinery.sci.ready') : t('machinery.sci.missing')}
      </Badge>
    </span>
  )
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

/** Add-or-edit dialog for a machine or implement, opened by `trigger` (a Button). */
export function EquipmentDialog({ equipment, defaultClass = 'machine', trigger }: { equipment?: Equipment; defaultClass?: EquipmentClass; trigger: ReactNode }) {
  const { t } = useTranslation()
  const cls = equipment?.class ?? defaultClass
  return (
    <DialogTrigger>
      {trigger}
      <Dialog
        title={equipment ? t('machinery.editTitle', { name: equipment.name }) : cls === 'machine' ? t('machinery.addMachine') : t('machinery.addImplement')}
        description={equipment ? undefined : t('machinery.dialogDescription')}
        size="xl"
      >
        {(close) => <EquipmentForm equipment={equipment} defaultClass={cls} close={close} />}
      </Dialog>
    </DialogTrigger>
  )
}

type TyreState = { size: string; widthM: number; diameterM: number; recommendedPressureKpa: number }
const tyreState = (t?: TyreSpec | null): TyreState => ({
  size: t?.size ?? '',
  widthM: t?.widthM ?? NaN,
  diameterM: t?.diameterM ?? NaN,
  recommendedPressureKpa: t?.recommendedPressureKpa ?? NaN,
})
/** Keeps catalogue-only tyre values (profile, rim, flex) unless the size changed. */
const tyreSpec = (s: TyreState, original?: TyreSpec | null): TyreSpec | null =>
  s.size.trim()
    ? {
        ...(original && original.size === s.size.trim() ? original : {}),
        size: s.size.trim(),
        widthM: num(s.widthM),
        diameterM: num(s.diameterM),
        recommendedPressureKpa: num(s.recommendedPressureKpa),
      }
    : null

const isIrrigation = (category: string) => category === 'irrigation_pump' || category.startsWith('irrigation_')

function EquipmentForm({ equipment: e, defaultClass, close }: { equipment?: Equipment; defaultClass: EquipmentClass; close: () => void }) {
  const { t } = useTranslation()
  const { org } = useOrg()
  const farms = useOrgQuery<Farm[]>('/farms')
  const employees = useOrgQuery<Employee[]>('/employees')
  const [cls, setCls] = useState<EquipmentClass>(e?.class ?? defaultClass)
  const [category, setCategory] = useState<string>(e?.category ?? (defaultClass === 'machine' ? 'tractor_medium' : 'cultivator'))
  const [name, setName] = useState(e?.name ?? '')
  // undefined = not chosen yet; a single farm is preselected for new equipment.
  const [farmId, setFarmId] = useState<string | undefined>(e ? (e.farmId ?? NONE) : undefined)
  const [manufacturer, setManufacturer] = useState(e?.manufacturer ?? '')
  const [model, setModel] = useState(e?.model ?? '')
  const [catalogueId, setCatalogueId] = useState<string | null>(e?.catalogueId ?? null)
  const [modelYear, setModelYear] = useState(e?.modelYear ?? NaN)
  const [registration, setRegistration] = useState(e?.registration ?? '')
  const [serialNumber, setSerialNumber] = useState(e?.serialNumber ?? '')
  const [inventoryNumber, setInventoryNumber] = useState(e?.inventoryNumber ?? '')
  const [status, setStatus] = useState<EquipmentStatus>(e?.status ?? 'active')
  const [defaultEmployeeId, setDefaultEmployeeId] = useState<string>(e?.defaultEmployeeId ?? NONE)
  const [mountType, setMountType] = useState<string>(e?.mountType ?? NONE)
  const [powerKw, setPowerKw] = useState(e?.powerKw ?? NaN)
  const [emptyMassKg, setEmptyMassKg] = useState(e?.emptyMassKg ?? NaN)
  const [operatingMassKg, setOperatingMassKg] = useState(e?.operatingMassKg ?? NaN)
  const [frontAxlePct, setFrontAxlePct] = useState(e?.frontAxleFraction != null ? Math.round(e.frontAxleFraction * 1000) / 10 : NaN)
  const [tankCapacityL, setTankCapacityL] = useState(e?.tankCapacityL ?? NaN)
  const [frontTyre, setFrontTyre] = useState(tyreState(e?.frontTyre))
  const [rearTyre, setRearTyre] = useState(tyreState(e?.rearTyre))
  const [catalogueTyres, setCatalogueTyres] = useState<{ front: TyreSpec | null; rear: TyreSpec | null }>({ front: e?.frontTyre ?? null, rear: e?.rearTyre ?? null })
  const [maxFillMassKg, setMaxFillMassKg] = useState(e?.maxFillMassKg ?? NaN)
  const [workingWidthM, setWorkingWidthM] = useState(e?.workingWidthM ?? NaN)
  const [hourMeter, setHourMeter] = useState(e?.hourMeter ?? 0)
  const [hourlyCost, setHourlyCost] = useState(e?.hourlyCost ?? NaN)
  const [fuelLPerH, setFuelLPerH] = useState(e?.fuelLPerH ?? NaN)
  const [purchaseDate, setPurchaseDate] = useState<string | null>(e?.purchaseDate ?? null)
  const [purchasePriceNet, setPurchasePriceNet] = useState(e?.purchasePriceNet ?? NaN)
  const [acquisitionType, setAcquisitionType] = useState<string>(e?.acquisitionType ?? NONE)
  const [depreciationMethod, setDepreciationMethod] = useState<string>(e?.depreciationMethod ?? NONE)
  const [usefulLifeYears, setUsefulLifeYears] = useState(e?.usefulLifeYears ?? NaN)
  const [residualValue, setResidualValue] = useState(e?.residualValue ?? NaN)
  const [insuranceAnnual, setInsuranceAnnual] = useState(e?.insuranceAnnual ?? NaN)
  const [financingType, setFinancingType] = useState<string>(e?.financingType ?? NONE)
  const [financingMonthlyPayment, setFinancingMonthlyPayment] = useState(e?.financingMonthlyPayment ?? NaN)
  const [financingEndDate, setFinancingEndDate] = useState<string | null>(e?.financingEndDate ?? null)
  const [leaseEndDate, setLeaseEndDate] = useState<string | null>(e?.leaseEndDate ?? null)
  const [machineRingMemberNumber, setMachineRingMemberNumber] = useState(e?.machineRingMemberNumber ?? '')
  const [inspectionUntil, setInspectionUntil] = useState<string | null>(e?.inspectionUntil ?? null)
  const [insuranceUntil, setInsuranceUntil] = useState<string | null>(e?.insuranceUntil ?? null)
  const [irrigationType, setIrrigationType] = useState<string>(e?.irrigationType ?? NONE)
  const [irrigationFlowLPerMin, setIrrigationFlowLPerMin] = useState(e?.irrigationFlowLPerMin ?? NaN)
  const [irrigationCoverageHa, setIrrigationCoverageHa] = useState(e?.irrigationCoverageHa ?? NaN)
  const [irrigationPressureBar, setIrrigationPressureBar] = useState(e?.irrigationPressureBar ?? NaN)
  const [notes, setNotes] = useState(e?.notes ?? '')

  const isMachine = cls === 'machine'
  const farmItems = [{ id: NONE, name: t('machinery.field.noFarm') }, ...(farms.data ?? []).filter((f) => !f.archivedAt || f.id === e?.farmId)]
  const farmValue = farmId ?? (farms.data?.length === 1 ? farms.data[0].id : NONE)
  const categoryItems: { id: string; name: string }[] = isMachine ? machineCategoryLabel.items() : implementTypeLabel.items()
  const none = (label = t('machinery.field.notSet')) => ({ id: NONE, name: label })
  const employeeItems = [none(t('machinery.field.noOperator')), ...(employees.data ?? []).filter((x) => x.active || x.id === e?.defaultEmployeeId)]

  const switchClass = (next: EquipmentClass) => {
    setCls(next)
    setCategory(next === 'machine' ? 'tractor_medium' : 'cultivator')
    setCatalogueId(null)
  }

  const applyMachine = (m: CatalogueMachine) => {
    setCatalogueId(m.id)
    setManufacturer(m.manufacturer)
    setModel(m.model)
    setCategory(m.category)
    if (!name.trim()) setName(`${m.manufacturer} ${m.model}`)
    setPowerKw(m.powerKw ?? NaN)
    setEmptyMassKg(m.emptyMassKg ?? NaN)
    setOperatingMassKg(m.operatingMassKg ?? NaN)
    setFrontAxlePct(m.frontAxleFraction != null ? Math.round(m.frontAxleFraction * 1000) / 10 : NaN)
    setTankCapacityL(m.tankCapacityL ?? NaN)
    setFrontTyre(tyreState(m.frontTyre))
    setRearTyre(tyreState(m.rearTyre))
    setCatalogueTyres({ front: m.frontTyre, rear: m.rearTyre })
  }
  const applyImplement = (i: CatalogueImplement) => {
    setCatalogueId(i.id)
    setManufacturer(i.manufacturer)
    setModel(i.model)
    setCategory(i.type)
    if (!name.trim()) setName(`${i.manufacturer} ${i.model}`)
    setMountType(i.mountType ?? NONE)
    setEmptyMassKg(i.emptyMassKg ?? NaN)
    setMaxFillMassKg(i.maxFillMassKg ?? NaN)
    setWorkingWidthM(i.workingWidthM ?? NaN)
  }

  const save = useOrgMutation(
    (base, input: EquipmentInput) => (e ? api.put<Equipment>(`${base}/equipment/${e.id}`, input) : api.post<Equipment>(`${base}/equipment`, input)),
    { success: e ? t('machinery.updated') : t('machinery.added'), onSuccess: close },
  )

  const tyreFields = (label: string, value: TyreState, set: (v: TyreState) => void) => (
    <fieldset className="rounded-lg border border-line p-3 pt-2 grid grid-cols-2 gap-3">
      <legend className="px-1 text-xs font-medium text-muted">{label}</legend>
      <TextField label={t('machinery.tyre.size')} value={value.size} onChange={(size) => set({ ...value, size })} placeholder="540/65R34" className="col-span-2" />
      <NumberField label={t('machinery.tyre.width')} unit="m" value={value.widthM} onChange={(widthM) => set({ ...value, widthM })} minValue={0} maxValue={3} formatOptions={{ maximumFractionDigits: 3 }} />
      <NumberField label={t('machinery.tyre.diameter')} unit="m" value={value.diameterM} onChange={(diameterM) => set({ ...value, diameterM })} minValue={0} maxValue={4} formatOptions={{ maximumFractionDigits: 3 }} />
      <NumberField
        label={t('machinery.tyre.pressure')}
        unit="kPa"
        value={value.recommendedPressureKpa}
        onChange={(recommendedPressureKpa) => set({ ...value, recommendedPressureKpa })}
        minValue={0}
        maxValue={1000}
        className="col-span-2"
      />
    </fieldset>
  )

  return (
    <Form
      onSubmit={(ev) => {
        ev.preventDefault()
        save.mutate({
          name: name.trim(),
          class: cls,
          category,
          farmId: keyOrNull(farmValue),
          mountType: isMachine ? null : (keyOrNull(mountType) as MountType | null),
          manufacturer: textOrNull(manufacturer),
          model: textOrNull(model),
          catalogueId,
          modelYear: num(modelYear),
          registration: textOrNull(registration),
          serialNumber: textOrNull(serialNumber),
          inventoryNumber: textOrNull(inventoryNumber),
          powerKw: isMachine ? num(powerKw) : null,
          emptyMassKg: num(emptyMassKg),
          operatingMassKg: isMachine ? num(operatingMassKg) : null,
          frontAxleFraction: isMachine && num(frontAxlePct) != null ? Math.round(frontAxlePct * 10) / 1000 : null,
          tankCapacityL: num(tankCapacityL),
          frontTyre: isMachine ? tyreSpec(frontTyre, catalogueTyres.front) : null,
          rearTyre: isMachine ? tyreSpec(rearTyre, catalogueTyres.rear) : null,
          maxFillMassKg: isMachine ? null : num(maxFillMassKg),
          workingWidthM: isMachine ? null : num(workingWidthM),
          hourMeter: num(hourMeter) ?? 0,
          hourlyCost: num(hourlyCost),
          fuelLPerH: num(fuelLPerH),
          purchaseDate,
          purchasePriceNet: num(purchasePriceNet),
          acquisitionType: keyOrNull(acquisitionType) as AcquisitionType | null,
          depreciationMethod: keyOrNull(depreciationMethod) as DepreciationMethod | null,
          usefulLifeYears: num(usefulLifeYears),
          residualValue: num(residualValue),
          insuranceAnnual: num(insuranceAnnual),
          financingType: keyOrNull(financingType) as FinancingType | null,
          financingMonthlyPayment: num(financingMonthlyPayment),
          financingEndDate,
          leaseEndDate,
          machineRingMemberNumber: textOrNull(machineRingMemberNumber),
          inspectionUntil,
          insuranceUntil,
          irrigationType: isIrrigation(category) ? (keyOrNull(irrigationType) as IrrigationType | null) : null,
          irrigationFlowLPerMin: isIrrigation(category) ? num(irrigationFlowLPerMin) : null,
          irrigationCoverageHa: isIrrigation(category) ? num(irrigationCoverageHa) : null,
          irrigationPressureBar: isIrrigation(category) ? num(irrigationPressureBar) : null,
          defaultEmployeeId: isMachine ? keyOrNull(defaultEmployeeId) : null,
          status,
          notes: textOrNull(notes),
        })
      }}
    >
      <Tabs>
        <TabList aria-label={t('machinery.form.sections')}>
          <Tab id="general">{t('machinery.form.general')}</Tab>
          <Tab id="technical">{isMachine ? t('machinery.form.technicalMachine') : t('machinery.form.technicalImplement')}</Tab>
          <Tab id="economics">{t('machinery.form.economics')}</Tab>
          {isIrrigation(category) && <Tab id="irrigation">{t('machinery.form.irrigation')}</Tab>}
        </TabList>

        <TabPanel id="general" shouldForceMount className="grid sm:grid-cols-2 gap-4 data-[inert]:hidden">
          {!e && (
            <div className="sm:col-span-2">
              <SegmentedControl<EquipmentClass>
                aria-label={t('machinery.form.class')}
                value={cls}
                onChange={switchClass}
                items={[
                  { id: 'machine', label: t('machinery.class.machine') },
                  { id: 'implement', label: t('machinery.class.implement') },
                ]}
              />
            </div>
          )}
          <CatalogueLookup cls={cls} onMachine={applyMachine} onImplement={applyImplement} linked={catalogueId} />
          <TextField label={t('common.name')} isRequired autoFocus value={name} onChange={setName} placeholder={t('machinery.field.namePlaceholder')} className="sm:col-span-2" />
          <Select label={isMachine ? t('machinery.field.category') : t('machinery.field.implementType')} items={categoryItems} value={category} onChange={(v) => v && setCategory(String(v))}>
            {(k) => <Option id={k.id}>{k.name}</Option>}
          </Select>
          {isMachine ? (
            <Select label={t('machinery.field.defaultOperator')} items={employeeItems} value={defaultEmployeeId} onChange={(v) => setDefaultEmployeeId(String(v ?? NONE))}>
              {(x) => <Option id={x.id}>{x.name}</Option>}
            </Select>
          ) : (
            <Select label={t('machinery.field.mountType')} items={[none(), ...mountTypeLabel.items()]} value={mountType} onChange={(v) => setMountType(String(v ?? NONE))}>
              {(x) => <Option id={x.id}>{x.name}</Option>}
            </Select>
          )}
          <TextField label={t('machinery.field.manufacturer')} value={manufacturer} onChange={setManufacturer} />
          <TextField label={t('machinery.field.model')} value={model} onChange={setModel} />
          <NumberField label={t('machinery.field.modelYear')} value={modelYear} onChange={setModelYear} minValue={1900} maxValue={2100} formatOptions={{ useGrouping: false }} />
          <Select label={t('machinery.field.farm')} items={farmItems} value={farmValue} onChange={(v) => setFarmId(String(v ?? NONE))}>
            {(f) => <Option id={f.id}>{f.name}</Option>}
          </Select>
          <TextField label={t('machinery.field.registration')} value={registration} onChange={setRegistration} placeholder={t('machinery.field.registrationPlaceholder')} />
          <TextField label={t('machinery.field.serialNumber')} value={serialNumber} onChange={setSerialNumber} />
          <TextField label={t('machinery.field.inventoryNumber')} value={inventoryNumber} onChange={setInventoryNumber} />
          <Select label={t('common.status')} items={equipmentStatusLabel.items()} value={status} onChange={(v) => v && setStatus(v as EquipmentStatus)}>
            {(s) => <Option id={s.id}>{s.name}</Option>}
          </Select>
          <TextField label={t('common.notes')} multiline value={notes} onChange={setNotes} className="sm:col-span-2" />
        </TabPanel>

        <TabPanel id="technical" shouldForceMount className="grid sm:grid-cols-2 gap-4 data-[inert]:hidden">
          {isMachine ? (
            <>
              <p className="sm:col-span-2 text-sm text-muted">{t('machinery.sci.formHint')}</p>
              <NumberField label={t('machinery.field.power')} unit="kW" value={powerKw} onChange={setPowerKw} minValue={0} maxValue={2000} />
              <NumberField label={t('machinery.field.tankCapacity')} unit="l" value={tankCapacityL} onChange={setTankCapacityL} minValue={0} />
              <NumberField label={t('machinery.field.emptyMass')} unit="kg" value={emptyMassKg} onChange={setEmptyMassKg} minValue={0} />
              <NumberField label={t('machinery.field.operatingMass')} unit="kg" value={operatingMassKg} onChange={setOperatingMassKg} minValue={0} description={t('machinery.field.operatingMassHint')} />
              <NumberField
                label={t('machinery.field.frontAxleShare')}
                unit="%"
                value={frontAxlePct}
                onChange={setFrontAxlePct}
                minValue={0}
                maxValue={100}
                formatOptions={{ maximumFractionDigits: 1 }}
                description={t('machinery.field.frontAxleShareHint')}
              />
              <div className="hidden sm:block" />
              {tyreFields(t('machinery.tyre.front'), frontTyre, setFrontTyre)}
              {tyreFields(t('machinery.tyre.rear'), rearTyre, setRearTyre)}
            </>
          ) : (
            <>
              <NumberField label={t('machinery.field.workingWidth')} unit="m" value={workingWidthM} onChange={setWorkingWidthM} minValue={0} maxValue={100} formatOptions={{ maximumFractionDigits: 2 }} />
              <NumberField label={t('machinery.field.emptyMass')} unit="kg" value={emptyMassKg} onChange={setEmptyMassKg} minValue={0} />
              <NumberField label={t('machinery.field.maxFillMass')} unit="kg" value={maxFillMassKg} onChange={setMaxFillMassKg} minValue={0} />
              <NumberField label={t('machinery.field.tankCapacity')} unit="l" value={tankCapacityL} onChange={setTankCapacityL} minValue={0} />
            </>
          )}
        </TabPanel>

        <TabPanel id="economics" shouldForceMount className="grid sm:grid-cols-2 gap-4 data-[inert]:hidden">
          <NumberField
            label={t('machinery.field.hourMeter')}
            unit="h"
            value={hourMeter}
            onChange={setHourMeter}
            minValue={0}
            formatOptions={{ maximumFractionDigits: 1 }}
            description={e ? t('machinery.field.hourMeterEditHint') : t('machinery.field.hourMeterNewHint')}
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
          {isMachine && (
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
          )}
          <Select label={t('machinery.field.acquisition')} items={[none(), ...acquisitionLabel.items()]} value={acquisitionType} onChange={(v) => setAcquisitionType(String(v ?? NONE))}>
            {(x) => <Option id={x.id}>{x.name}</Option>}
          </Select>
          <DatePicker label={t('machinery.field.purchaseDate')} value={purchaseDate} onChange={setPurchaseDate} />
          <NumberField label={t('machinery.field.purchasePrice')} unit={org.currency} value={purchasePriceNet} onChange={setPurchasePriceNet} minValue={0} formatOptions={{ maximumFractionDigits: 2 }} />
          <Select label={t('machinery.field.depreciation')} items={[none(), ...depreciationLabel.items()]} value={depreciationMethod} onChange={(v) => setDepreciationMethod(String(v ?? NONE))}>
            {(x) => <Option id={x.id}>{x.name}</Option>}
          </Select>
          <NumberField label={t('machinery.field.usefulLife')} unit={t('machinery.unit.years')} value={usefulLifeYears} onChange={setUsefulLifeYears} minValue={1} maxValue={100} />
          <NumberField label={t('machinery.field.residualValue')} unit={org.currency} value={residualValue} onChange={setResidualValue} minValue={0} formatOptions={{ maximumFractionDigits: 2 }} />
          <NumberField label={t('machinery.field.insuranceAnnual')} unit={`${org.currency}/${t('machinery.unit.year')}`} value={insuranceAnnual} onChange={setInsuranceAnnual} minValue={0} formatOptions={{ maximumFractionDigits: 2 }} />
          <Select label={t('machinery.field.financing')} items={[none(), ...financingLabel.items()]} value={financingType} onChange={(v) => setFinancingType(String(v ?? NONE))}>
            {(x) => <Option id={x.id}>{x.name}</Option>}
          </Select>
          <NumberField label={t('machinery.field.monthlyPayment')} unit={org.currency} value={financingMonthlyPayment} onChange={setFinancingMonthlyPayment} minValue={0} formatOptions={{ maximumFractionDigits: 2 }} />
          <DatePicker label={t('machinery.field.financingEnd')} value={financingEndDate} onChange={setFinancingEndDate} />
          <DatePicker label={t('machinery.field.leaseEnd')} value={leaseEndDate} onChange={setLeaseEndDate} />
          <TextField label={t('machinery.field.machineRing')} value={machineRingMemberNumber} onChange={setMachineRingMemberNumber} />
          <DatePicker label={t('machinery.field.inspectionUntil')} value={inspectionUntil} onChange={setInspectionUntil} />
          <DatePicker label={t('machinery.field.insuranceUntil')} value={insuranceUntil} onChange={setInsuranceUntil} />
        </TabPanel>

        {isIrrigation(category) && (
          <TabPanel id="irrigation" shouldForceMount className="grid sm:grid-cols-2 gap-4 data-[inert]:hidden">
            <Select label={t('machinery.field.irrigationType')} items={[none(), ...irrigationTypeLabel.items()]} value={irrigationType} onChange={(v) => setIrrigationType(String(v ?? NONE))}>
              {(x) => <Option id={x.id}>{x.name}</Option>}
            </Select>
            <NumberField label={t('machinery.field.irrigationFlow')} unit="l/min" value={irrigationFlowLPerMin} onChange={setIrrigationFlowLPerMin} minValue={0} />
            <NumberField label={t('machinery.field.irrigationCoverage')} unit="ha" value={irrigationCoverageHa} onChange={setIrrigationCoverageHa} minValue={0} formatOptions={{ maximumFractionDigits: 2 }} />
            <NumberField label={t('machinery.field.irrigationPressure')} unit="bar" value={irrigationPressureBar} onChange={setIrrigationPressureBar} minValue={0} maxValue={100} formatOptions={{ maximumFractionDigits: 1 }} />
          </TabPanel>
        )}
      </Tabs>
      <div className="mt-5">
        <FormActions close={close} isPending={save.isPending} submitLabel={e ? t('common.saveChanges') : isMachine ? t('machinery.addMachine') : t('machinery.addImplement')} />
      </div>
    </Form>
  )
}

/** Pick make and model from the machinery catalogue to fill in masses, tyres and widths. */
function CatalogueLookup({
  cls,
  linked,
  onMachine,
  onImplement,
}: {
  cls: EquipmentClass
  linked: string | null
  onMachine: (m: CatalogueMachine) => void
  onImplement: (i: CatalogueImplement) => void
}) {
  const { t } = useTranslation()
  const [maker, setMaker] = useState<string | null>(null)
  const makers = useOrgQuery<string[]>('/machinery-catalogue/manufacturers', { class: cls }, { staleTime: Infinity })
  const models = useOrgQuery<(CatalogueMachine | CatalogueImplement)[]>(maker ? '/machinery-catalogue' : null, { class: cls, manufacturer: maker ?? undefined }, { staleTime: Infinity })
  const describe = (m: CatalogueMachine | CatalogueImplement) =>
    'category' in m
      ? [m.yearRange, m.powerKw != null && `${m.powerKw} kW`, m.operatingMassKg != null && `${fmt.num(m.operatingMassKg)} kg`].filter(Boolean).join(' · ')
      : [implementTypeLabel(m.type), m.workingWidthM != null && `${fmt.num(m.workingWidthM, 1)} m`].filter(Boolean).join(' · ')
  return (
    <fieldset className="sm:col-span-2 rounded-lg border border-line bg-surface-2/50 p-3 pt-2 grid sm:grid-cols-2 gap-3">
      <legend className="px-1 text-xs font-medium text-muted">{t('machinery.catalogue.title')}</legend>
      <ComboBox
        label={t('machinery.field.manufacturer')}
        items={(makers.data ?? []).map((id) => ({ id, name: id }))}
        value={maker}
        onChange={(v) => setMaker(v == null ? null : String(v))}
        placeholder={makers.isLoading ? t('common.loading') : t('machinery.catalogue.chooseMaker')}
        menuTrigger="focus"
      >
        {(x) => <Option id={x.id}>{x.name}</Option>}
      </ComboBox>
      <ComboBox
        label={t('machinery.field.model')}
        items={(models.data ?? []).map((m) => ({ id: m.id, name: m.model, entry: m }))}
        value={null}
        isDisabled={!maker}
        onChange={(v) => {
          const m = models.data?.find((x) => x.id === v)
          if (!m) return
          if ('category' in m) onMachine(m)
          else onImplement(m)
        }}
        placeholder={maker ? t('machinery.catalogue.chooseModel') : t('machinery.catalogue.makerFirst')}
        menuTrigger="focus"
      >
        {(x) => (
          <Option id={x.id} textValue={x.name} description={describe(x.entry)}>
            {x.name}
          </Option>
        )}
      </ComboBox>
      <p className="sm:col-span-2 text-xs text-muted">{linked ? t('machinery.catalogue.linked') : t('machinery.catalogue.hint', { kind: cls === 'machine' ? t('machinery.class.machine') : t('machinery.class.implement') })}</p>
    </fieldset>
  )
}
