import { z } from 'zod';
import { amount, id, isoDate, longText, name, shortText } from './common.js';

export const EmployeeInput = z.object({
  name,
  userId: id.nullish(),
  jobTitle: shortText,
  email: z.email().max(320).nullish().or(z.literal('').transform(() => null)),
  phone: shortText,
  hourlyRate: amount.nullish(),
  active: z.boolean().default(true),
});
export type EmployeeInput = z.input<typeof EmployeeInput>;

export interface Employee {
  id: string;
  userId: string | null;
  name: string;
  jobTitle: string | null;
  email: string | null;
  phone: string | null;
  hourlyRate: number | null;
  active: boolean;
  hoursThisYear: number;
}

// ---------------------------------------------------------------------------
// Machinery
// ---------------------------------------------------------------------------

export const EQUIPMENT_KINDS = ['tractor', 'combine', 'sprayer', 'spreader', 'seeder', 'tillage', 'trailer', 'loader', 'vehicle', 'other'] as const;
export type EquipmentKind = (typeof EQUIPMENT_KINDS)[number];

export const EQUIPMENT_KIND_LABELS: Record<EquipmentKind, string> = {
  tractor: 'Tractor',
  combine: 'Combine harvester',
  sprayer: 'Sprayer',
  spreader: 'Fertilizer spreader',
  seeder: 'Seed drill / planter',
  tillage: 'Tillage implement',
  trailer: 'Trailer',
  loader: 'Loader',
  vehicle: 'Vehicle',
  other: 'Other',
};

export const EQUIPMENT_STATUSES = ['active', 'maintenance', 'retired'] as const;
export type EquipmentStatus = (typeof EQUIPMENT_STATUSES)[number];

export const EquipmentInput = z.object({
  name,
  farmId: id.nullish(),
  kind: z.enum(EQUIPMENT_KINDS),
  manufacturer: shortText,
  model: shortText,
  modelYear: z.int().min(1900).max(2100).nullish(),
  registration: shortText,
  hourMeter: amount.default(0),
  hourlyCost: amount.nullish(),
  /** Diesel per operating hour; used for emissions when an operation records no fuel. */
  fuelLPerH: amount.max(500).nullish(),
  status: z.enum(EQUIPMENT_STATUSES).default('active'),
  notes: longText,
});
export type EquipmentInput = z.input<typeof EquipmentInput>;

export interface Equipment {
  id: string;
  farmId: string | null;
  name: string;
  kind: EquipmentKind;
  manufacturer: string | null;
  model: string | null;
  modelYear: number | null;
  registration: string | null;
  hourMeter: number;
  hourlyCost: number | null;
  fuelLPerH: number | null;
  status: EquipmentStatus;
  notes: string | null;
  hoursThisYear: number;
  maintenanceCostThisYear: number;
  nextMaintenance: { dueOn: string | null; dueHours: number | null; overdue: boolean } | null;
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
