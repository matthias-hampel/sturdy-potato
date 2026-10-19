import { z } from 'zod';
import { amount, id, isoDate, longText, name, shortText } from './common.js';

export const EMPLOYEE_ROLES = ['machine_operator', 'field_worker', 'manager', 'other'] as const;
export type EmployeeRole = (typeof EMPLOYEE_ROLES)[number];

export const EmployeeInput = z.object({
  name,
  userId: id.nullish(),
  role: z.enum(EMPLOYEE_ROLES).default('field_worker'),
  staffNumber: z.string().trim().max(50).nullish(),
  jobTitle: shortText,
  email: z.email().max(320).nullish().or(z.literal('').transform(() => null)),
  phone: shortText,
  hourlyRate: amount.nullish(),
  notes: longText,
  active: z.boolean().default(true),
});
export type EmployeeInput = z.input<typeof EmployeeInput>;

export interface Employee {
  id: string;
  userId: string | null;
  name: string;
  role: EmployeeRole;
  staffNumber: string | null;
  jobTitle: string | null;
  email: string | null;
  phone: string | null;
  hourlyRate: number | null;
  notes: string | null;
  active: boolean;
  hoursThisYear: number;
}

// ---------------------------------------------------------------------------
// Machinery
// ---------------------------------------------------------------------------

/** Coarse group of a machine or implement, derived from its category (icons, filters). */
export const EQUIPMENT_KINDS = ['tractor', 'combine', 'sprayer', 'spreader', 'seeder', 'tillage', 'trailer', 'loader', 'vehicle', 'other'] as const;
export type EquipmentKind = (typeof EQUIPMENT_KINDS)[number];

export const EQUIPMENT_KIND_LABELS: Record<EquipmentKind, string> = {
  tractor: 'Tractor',
  combine: 'Harvester',
  sprayer: 'Sprayer',
  spreader: 'Spreader',
  seeder: 'Seed drill / planter',
  tillage: 'Tillage implement',
  trailer: 'Trailer',
  loader: 'Loader',
  vehicle: 'Vehicle',
  other: 'Other',
};

/** Machines drive (tractors, self-propelled machines); implements are attached or stationary. */
export const EQUIPMENT_CLASSES = ['machine', 'implement'] as const;
export type EquipmentClass = (typeof EQUIPMENT_CLASSES)[number];

export const MACHINE_CATEGORIES = [
  'tractor_small', 'tractor_medium', 'tractor_large', 'tractor_xlarge', 'combine', 'self_propelled_sprayer',
  'self_propelled_forage_harvester', 'self_propelled_root_harvester', 'track_tractor', 'telehandler', 'front_loader',
  'transporter', 'irrigation_pump', 'other',
] as const;
export type MachineCategory = (typeof MACHINE_CATEGORIES)[number];

export const IMPLEMENT_TYPES = [
  'plow', 'cultivator', 'harrow', 'disc_harrow', 'power_harrow', 'rotary_harrow', 'drill', 'seeder', 'combination_drill',
  'precision_drill', 'fertilizer_spreader', 'manure_spreader', 'mower', 'tedder', 'rake', 'baler_round', 'baler_square',
  'baler_variable', 'trailer', 'slurry_tanker', 'water_tanker', 'overload_wagon', 'tine_harrow_weeder', 'row_crop_cultivator',
  'roller', 'cultipacker', 'mulcher', 'stone_picker', 'potato_planter', 'potato_harvester', 'sugar_beet_harvester', 'sprayer',
  'grassland_overseeder', 'grassland_combo', 'meadow_harrow', 'grassland_mulcher', 'slurry_carrier_vehicle',
  'irrigation_drip_line', 'irrigation_sprinkler', 'irrigation_hose_reel', 'irrigation_pivot', 'other',
] as const;
export type ImplementType = (typeof IMPLEMENT_TYPES)[number];
export type EquipmentCategory = MachineCategory | ImplementType;

export const MOUNT_TYPES = ['three_point', 'trailed', 'semi_mounted', 'self_propelled', 'stationary'] as const;
export type MountType = (typeof MOUNT_TYPES)[number];
export const ACQUISITION_TYPES = ['owned', 'leased', 'rented', 'shared_machine_ring', 'contractor_owned', 'on_demonstration'] as const;
export type AcquisitionType = (typeof ACQUISITION_TYPES)[number];
export const DEPRECIATION_METHODS = ['linear', 'declining_balance', 'performance_based', 'not_depreciating'] as const;
export type DepreciationMethod = (typeof DEPRECIATION_METHODS)[number];
export const FINANCING_TYPES = ['cash', 'loan', 'leasing', 'operating_lease', 'manufacturer_financing'] as const;
export type FinancingType = (typeof FINANCING_TYPES)[number];
export const IRRIGATION_TYPES = ['drip', 'sprinkler', 'pivot', 'hose_reel', 'sub_irrigation', 'flood', 'micro_sprinkler'] as const;
export type IrrigationType = (typeof IRRIGATION_TYPES)[number];

export const EQUIPMENT_STATUSES = ['active', 'in_repair', 'loaned_out', 'sold', 'scrapped', 'decommissioned'] as const;
export type EquipmentStatus = (typeof EQUIPMENT_STATUSES)[number];
/** Statuses of machinery that is no longer on the farm. */
export const EQUIPMENT_GONE_STATUSES: readonly EquipmentStatus[] = ['sold', 'scrapped', 'decommissioned'];

/** A tyre as the soil compaction index needs it. */
export const TyreSpec = z.object({
  size: z.string().trim().min(1).max(50),
  widthM: z.number().positive().max(3).nullish(),
  diameterM: z.number().positive().max(4).nullish(),
  profilePct: z.number().positive().max(150).nullish(),
  rimDiameterInches: z.number().positive().max(60).nullish(),
  recommendedPressureKpa: z.number().positive().max(1000).nullish(),
  isFlexTyre: z.boolean().nullish(),
});
export type TyreSpec = z.infer<typeof TyreSpec>;

const count = (max: number) => z.int().min(0).max(max).nullish();

export const EquipmentInput = z
  .object({
    name,
    farmId: id.nullish(),
    class: z.enum(EQUIPMENT_CLASSES).default('machine'),
    category: z.string().min(1).max(50),
    mountType: z.enum(MOUNT_TYPES).nullish(),
    manufacturer: shortText,
    model: shortText,
    modelYear: z.int().min(1900).max(2100).nullish(),
    registration: shortText,
    serialNumber: z.string().trim().max(100).nullish(),
    inventoryNumber: z.string().trim().max(100).nullish(),
    catalogueId: z.string().max(200).nullish(),
    powerKw: count(2000),
    emptyMassKg: count(100_000),
    operatingMassKg: count(100_000),
    frontAxleFraction: z.number().min(0).max(1).nullish(),
    tankCapacityL: count(100_000),
    frontTyre: TyreSpec.nullish(),
    rearTyre: TyreSpec.nullish(),
    maxFillMassKg: count(100_000),
    workingWidthM: z.number().min(0).max(100).nullish(),
    hourMeter: amount.default(0),
    hourlyCost: amount.nullish(),
    /** Diesel per operating hour; used for emissions when an operation records no fuel. */
    fuelLPerH: amount.max(500).nullish(),
    purchaseDate: isoDate.nullish(),
    purchasePriceNet: amount.nullish(),
    acquisitionType: z.enum(ACQUISITION_TYPES).nullish(),
    depreciationMethod: z.enum(DEPRECIATION_METHODS).nullish(),
    usefulLifeYears: z.int().min(1).max(100).nullish(),
    residualValue: amount.nullish(),
    insuranceAnnual: amount.nullish(),
    financingType: z.enum(FINANCING_TYPES).nullish(),
    financingMonthlyPayment: amount.nullish(),
    financingEndDate: isoDate.nullish(),
    leaseEndDate: isoDate.nullish(),
    machineRingMemberNumber: z.string().trim().max(100).nullish(),
    /** Next statutory inspection (TÜV) due. */
    inspectionUntil: isoDate.nullish(),
    insuranceUntil: isoDate.nullish(),
    irrigationType: z.enum(IRRIGATION_TYPES).nullish(),
    irrigationFlowLPerMin: count(1_000_000),
    irrigationCoverageHa: z.number().min(0).max(100_000).nullish(),
    irrigationPressureBar: z.number().min(0).max(100).nullish(),
    defaultEmployeeId: id.nullish(),
    status: z.enum(EQUIPMENT_STATUSES).default('active'),
    notes: longText,
    archived: z.boolean().optional(),
  })
  .refine((e) => (e.class === 'machine' ? (MACHINE_CATEGORIES as readonly string[]) : (IMPLEMENT_TYPES as readonly string[])).includes(e.category), {
    message: 'Category does not fit machine or implement',
    path: ['category'],
  });
export type EquipmentInput = z.input<typeof EquipmentInput>;

export interface Equipment {
  id: string;
  farmId: string | null;
  name: string;
  class: EquipmentClass;
  category: EquipmentCategory;
  kind: EquipmentKind;
  mountType: MountType | null;
  manufacturer: string | null;
  model: string | null;
  modelYear: number | null;
  registration: string | null;
  serialNumber: string | null;
  inventoryNumber: string | null;
  catalogueId: string | null;
  powerKw: number | null;
  emptyMassKg: number | null;
  operatingMassKg: number | null;
  frontAxleFraction: number | null;
  tankCapacityL: number | null;
  frontTyre: TyreSpec | null;
  rearTyre: TyreSpec | null;
  maxFillMassKg: number | null;
  workingWidthM: number | null;
  hourMeter: number;
  hourlyCost: number | null;
  fuelLPerH: number | null;
  purchaseDate: string | null;
  purchasePriceNet: number | null;
  acquisitionType: AcquisitionType | null;
  depreciationMethod: DepreciationMethod | null;
  usefulLifeYears: number | null;
  residualValue: number | null;
  insuranceAnnual: number | null;
  financingType: FinancingType | null;
  financingMonthlyPayment: number | null;
  financingEndDate: string | null;
  leaseEndDate: string | null;
  machineRingMemberNumber: string | null;
  inspectionUntil: string | null;
  insuranceUntil: string | null;
  irrigationType: IrrigationType | null;
  irrigationFlowLPerMin: number | null;
  irrigationCoverageHa: number | null;
  irrigationPressureBar: number | null;
  defaultEmployeeId: string | null;
  defaultEmployeeName: string | null;
  status: EquipmentStatus;
  notes: string | null;
  archivedAt: string | null;
  /** Both tyres, operating mass and axle load share are known: the soil compaction index can be computed. */
  sciReady: boolean;
  hoursThisYear: number;
  maintenanceCostThisYear: number;
  nextMaintenance: { dueOn: string | null; dueHours: number | null; overdue: boolean } | null;
}

/** An entry of the machinery catalogue (EU farm machinery data, partly estimated). */
export interface CatalogueMachine {
  id: string;
  manufacturer: string;
  model: string;
  yearRange: string | null;
  category: MachineCategory;
  powerKw: number | null;
  emptyMassKg: number | null;
  operatingMassKg: number | null;
  frontAxleFraction: number | null;
  tankCapacityL: number | null;
  frontTyre: TyreSpec | null;
  rearTyre: TyreSpec | null;
}

export interface CatalogueImplement {
  id: string;
  manufacturer: string;
  model: string;
  type: ImplementType;
  mountType: MountType | null;
  emptyMassKg: number | null;
  maxFillMassKg: number | null;
  workingWidthM: number | null;
}

// ---------------------------------------------------------------------------
// Action catalogue (Maßnahmenkatalog)
// ---------------------------------------------------------------------------

export const OperationActionInput = z.object({
  name: z.string().trim().min(1).max(200),
  operationType: z.enum(['tillage', 'sowing', 'fertilization', 'crop_protection', 'irrigation', 'harvest', 'inspection', 'other']),
  dieselLPerHa: z.number().min(0).max(1000).nullish(),
  hoursPerHa: z.number().min(0).max(100).nullish(),
  machineId: id.nullish(),
  implementId: id.nullish(),
  employeeId: id.nullish(),
  notes: longText,
  archived: z.boolean().optional(),
});
export type OperationActionInput = z.input<typeof OperationActionInput>;

export interface OperationAction {
  id: string;
  name: string;
  operationType: OperationActionInput['operationType'];
  dieselLPerHa: number | null;
  hoursPerHa: number | null;
  machineId: string | null;
  machineName: string | null;
  implementId: string | null;
  implementName: string | null;
  employeeId: string | null;
  employeeName: string | null;
  notes: string | null;
  archivedAt: string | null;
  /** Operations planned from this action. */
  usageCount: number;
}

export const MaintenanceInput = z.object({
  performedOn: isoDate,
  description: z.string().trim().min(1).max(2000),
  cost: amount.nullish(),
  hourMeter: amount.nullish(),
  nextDueOn: isoDate.nullish(),
  nextDueHours: amount.nullish(),
});
export type MaintenanceInput = z.input<typeof MaintenanceInput>;

export interface MaintenanceRecord {
  id: string;
  equipmentId: string;
  performedOn: string;
  description: string;
  cost: number | null;
  hourMeter: number | null;
  nextDueOn: string | null;
  nextDueHours: number | null;
  createdAt: string;
}

export interface EquipmentUsage {
  operationId: string;
  title: string;
  type: string;
  performedAt: string | null;
  status: string;
  hours: number;
}
