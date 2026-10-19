import { z } from 'zod';
import { amount, id, isoDate, isoDateTime, longText, positive, shortText, type Ref } from './common.js';
import type { BaseUnit, ProductCategory } from './inventory.js';
import type { NutrientRates } from './nutrients.js';
import { PSM_USAGE_TYPES } from './psmRecord.js';

export const OPERATION_TYPES = ['tillage', 'sowing', 'fertilization', 'crop_protection', 'irrigation', 'harvest', 'inspection', 'other'] as const;
export type OperationType = (typeof OPERATION_TYPES)[number];

export const OPERATION_TYPE_LABELS: Record<OperationType, string> = {
  tillage: 'Soil cultivation',
  sowing: 'Sowing / planting',
  fertilization: 'Fertilization',
  crop_protection: 'Crop protection',
  irrigation: 'Irrigation',
  harvest: 'Harvest',
  inspection: 'Field inspection',
  other: 'Other work',
};

export const OPERATION_STATUSES = ['planned', 'in_progress', 'completed', 'canceled'] as const;
export type OperationStatus = (typeof OPERATION_STATUSES)[number];

export const OperationFieldInput = z.object({
  fieldId: id,
  /**
   * A single part field (Teilschlag). Without it, a field that is divided in the season of the
   * operation date is treated on its `cropped` parts, one line per part.
   */
  fieldPartId: id.nullish(),
  /** Defaults to the field's (or part's) crop cycle in the season of the operation date. */
  cropCycleId: id.nullish(),
  /** Defaults to the full current field area, or the area of the treated parts; split across parts by area. */
  treatedAreaHa: positive.nullish(),
});

export const OperationInputLineInput = z
  .object({
    productId: id,
    storageLocationId: id.nullish(),
    ratePerHa: amount.nullish(),
    totalQuantity: positive.nullish(),
    unitCost: amount.nullish(),
  })
  .refine((l) => l.ratePerHa != null || l.totalQuantity != null, {
    message: 'Enter a rate per hectare or a total quantity',
    path: ['ratePerHa'],
  });

export const OperationLaborInput = z.object({
  employeeId: id,
  hours: positive,
  hourlyRate: amount.nullish(),
});

export const OperationEquipmentInput = z.object({
  equipmentId: id,
  hours: positive,
  hourlyCost: amount.nullish(),
});

const optNum = (max: number) => z.number().finite().min(0).max(max).nullish();

/**
 * Type-specific attributes kept in `details`. Unknown keys are allowed (and kept), the known ones
 * are checked.
 */
export const OPERATION_DETAILS = {
  tillage: z.looseObject({ depthCm: optNum(100), tool: z.string().max(100).nullish() }),
  sowing: z.looseObject({
    seedsPerM2: optNum(5000),
    rowSpacingCm: optNum(200),
    sowingDepthCm: optNum(30),
    thousandGrainWeightG: optNum(2000),
    germinationPct: optNum(100),
  }),
  fertilization: z.looseObject({
    /** Hours from application to incorporation into the soil, for organic fertilizers on bare land. */
    incorporationHours: optNum(1000),
    applicationTechnique: z.enum(['broadcast', 'trailing_hose', 'trailing_shoe', 'injection', 'other']).nullish(),
  }),
  crop_protection: z.looseObject({ waterLHa: optNum(5000), psmUseId: z.string().max(40).nullish(), usageType: z.enum(PSM_USAGE_TYPES).nullish() }),
  irrigation: z.looseObject({ waterMm: optNum(500), method: z.enum(['sprinkler', 'drip', 'pivot']).nullish() }),
  harvest: z.looseObject({ strawRemoved: z.boolean().nullish() }),
  inspection: z.looseObject({}),
  other: z.looseObject({}),
} satisfies Record<OperationType, z.ZodType>;

export const APPLICATION_TECHNIQUES = ['broadcast', 'trailing_hose', 'trailing_shoe', 'injection', 'other'] as const;
export type ApplicationTechnique = (typeof APPLICATION_TECHNIQUES)[number];

export const OperationInput = z.object({
  farmId: id,
  type: z.enum(OPERATION_TYPES),
  title: z.string().trim().min(1).max(200),
  status: z.enum(['planned', 'in_progress']).default('planned'),
  plannedOn: isoDate.nullish(),
  performedAt: isoDateTime.nullish(),
  responsibleEmployeeId: id.nullish(),
  contractorName: shortText,
  contractorCost: amount.nullish(),
  /** The catalogue action the operation was planned from. */
  actionId: id.nullish(),
  /** Diesel per treated hectare; without it, diesel is estimated from machine hours. */
  dieselLPerHa: z.number().min(0).max(1000).nullish(),
  /** Electricity per treated hectare (electric machines, irrigation pumps). */
  electricityKWhPerHa: z.number().min(0).max(10000).nullish(),
  bbchStage: shortText,
  targetOrganism: shortText,
  weatherConditions: shortText,
  details: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}),
  notes: longText,
  fields: z.array(OperationFieldInput).min(1).max(500),
  inputs: z.array(OperationInputLineInput).max(50).default([]),
  labor: z.array(OperationLaborInput).max(50).default([]),
  equipment: z.array(OperationEquipmentInput).max(50).default([]),
  /** Optimistic concurrency token; required when updating. */
  version: z.int().positive().optional(),
}).superRefine((op, ctx) => {
  const result = OPERATION_DETAILS[op.type].safeParse(op.details);
  if (!result.success) {
    for (const issue of result.error.issues) ctx.addIssue({ code: 'custom', message: issue.message, path: ['details', ...issue.path] });
  }
});
export type OperationInput = z.input<typeof OperationInput>;

export const CompleteOperationInput = z.object({
  version: z.int().positive(),
  performedAt: isoDateTime.optional(),
  /** Managers may complete despite insufficient recorded stock (an authorized correction). */
  allowNegativeStock: z.boolean().default(false),
});
export type CompleteOperationInput = z.input<typeof CompleteOperationInput>;

export const ReopenOperationInput = z.object({
  version: z.int().positive(),
  reason: z.string().trim().min(3).max(1000),
});
export type ReopenOperationInput = z.input<typeof ReopenOperationInput>;

export const CancelOperationInput = z.object({ version: z.int().positive() });
export type CancelOperationInput = z.input<typeof CancelOperationInput>;

export interface OperationField {
  fieldId: string;
  fieldName: string;
  fieldPartId: string | null;
  fieldPartName: string | null;
  cropCycleId: string | null;
  cropName: string | null;
  treatedAreaHa: number;
}

export interface OperationInputLine {
  id: string;
  productId: string;
  productName: string;
  category: ProductCategory;
  baseUnit: BaseUnit;
  storageLocationId: string | null;
  ratePerHa: number | null;
  totalQuantity: number;
  unitCost: number | null;
  /** Current stock of the product, across storage locations. */
  availableStock: number;
  /** kg nutrients per hectare applied with this line (fertilizers with recorded contents). */
  nutrients: NutrientRates | null;
  /** The product's volume was converted with an assumed density of 1 t/m³. */
  densityAssumed: boolean;
}

export interface OperationLabor {
  employeeId: string;
  employeeName: string;
  hours: number;
  hourlyRate: number | null;
}

export interface OperationEquipment {
  equipmentId: string;
  equipmentName: string;
  /** Machine (tractor, self-propelled) or implement. */
  equipmentClass: 'machine' | 'implement';
  hours: number;
  hourlyCost: number | null;
}

export interface CostLine {
  category: string;
  amount: number;
}

export interface Operation {
  id: string;
  farmId: string;
  farmName: string;
  type: OperationType;
  title: string;
  status: OperationStatus;
  plannedOn: string | null;
  performedAt: string | null;
  priority: TaskPriority;
  dueOn: string | null;
  responsibleEmployee: Ref | null;
  contractorName: string | null;
  contractorCost: number | null;
  actionId: string | null;
  dieselLPerHa: number | null;
  electricityKWhPerHa: number | null;
  bbchStage: string | null;
  targetOrganism: string | null;
  weatherConditions: string | null;
  details: Record<string, string | number | boolean | null>;
  notes: string | null;
  version: number;
  completionSeq: number;
  completedAt: string | null;
  totalAreaHa: number;
  fields: OperationField[];
  inputs: OperationInputLine[];
  labor: OperationLabor[];
  equipment: OperationEquipment[];
  /** Net recorded costs of this operation by category (completed operations only). */
  costs: CostLine[];
  /** kg nutrients per hectare of all fertilizer lines; null when no line carries nutrient data. */
  nutrientTotals: NutrientRates | null;
  /** Cultivation template step the operation was planned from. */
  templateStepId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StockShortage {
  productId: string;
  productName: string;
  baseUnit: BaseUnit;
  required: number;
  available: number;
}

// ---------------------------------------------------------------------------
// Task board: operations as cards in planned / in progress / completed
// ---------------------------------------------------------------------------

export const TASK_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

/** Completed operations stay on the board this many days. */
export const BOARD_DONE_DAYS = 14;

export const OperationBoardQuery = z.object({
  seasonId: id.optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  type: z.enum(OPERATION_TYPES).optional(),
  cropId: id.optional(),
  fieldId: id.optional(),
  assigneeEmployeeId: id.optional(),
  unassigned: z.coerce.boolean().optional(),
});
export type OperationBoardQuery = z.input<typeof OperationBoardQuery>;

export interface BoardCard {
  id: string;
  type: OperationType;
  title: string;
  status: OperationStatus;
  plannedOn: string | null;
  performedAt: string | null;
  completedAt: string | null;
  priority: TaskPriority;
  dueOn: string | null;
  assignee: Ref | null;
  crops: { name: string; color: string }[];
  fields: Ref[];
  inputs: string[];
  equipment: string[];
  totalAreaHa: number;
  commentCount: number;
  version: number;
}

export interface OperationBoard {
  planned: BoardCard[];
  in_progress: BoardCard[];
  completed: BoardCard[];
}

/** Board metadata: editable in any status without touching the operation's version. */
export const OperationMetaInput = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  dueOn: isoDate.nullish(),
  responsibleEmployeeId: id.nullish(),
});
export type OperationMetaInput = z.input<typeof OperationMetaInput>;

export const BulkOperationMetaInput = OperationMetaInput.omit({ title: true }).extend({ operationIds: z.array(id).min(1).max(500) });
export type BulkOperationMetaInput = z.input<typeof BulkOperationMetaInput>;

/** Moves an open operation between planned and in progress (completion has its own endpoint). */
export const SetOperationStatusInput = z.object({ status: z.enum(['planned', 'in_progress']), version: z.int().positive() });
export type SetOperationStatusInput = z.input<typeof SetOperationStatusInput>;

export const OperationListQuery = z.object({
  status: z.enum(OPERATION_STATUSES).optional(),
  type: z.enum(OPERATION_TYPES).optional(),
  farmId: id.optional(),
  fieldId: id.optional(),
  seasonId: id.optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});
export type OperationListQuery = z.input<typeof OperationListQuery>;

// ---------------------------------------------------------------------------
// Plant-protection checks
// ---------------------------------------------------------------------------

export const PSM_FINDING_CODES = [
  'unknown_registration',
  'no_approved_use',
  'approval_expired',
  'hobby_only',
  'dose_above_max',
  'bbch_outside_window',
  'too_many_applications',
  'interval_too_short',
  'harvest_before_waiting_period',
] as const;
export type PsmFindingCode = (typeof PSM_FINDING_CODES)[number];

/**
 * A deviation of a plant-protection application from the BVL approval as recorded in agmeo's copy
 * of the register. It is not a legal assessment: the label the farmer bought is what counts, and
 * several approved uses may fit an application.
 */
export interface PsmFinding {
  operationId: string;
  code: PsmFindingCode;
  /** `deviation` departs from the approval; `notice` could not be checked or needs a look. */
  severity: 'deviation' | 'notice';
  productId: string;
  productName: string;
  kennr: string | null;
  fieldId: string;
  fieldName: string | null;
  cropCycleId: string | null;
  cropName: string | null;
  /** Approved use the application was measured against. */
  awgId: string | null;
  /** Values for the message, e.g. {dose: 1.2, max: 1.0, unit: 'l/ha'}. */
  params: Record<string, string | number>;
  message: string;
}

export interface OperationChecks {
  operationId: string;
  psm: PsmFinding[];
  /** Earliest harvest date after the waiting periods of this application, per crop cycle. */
  earliestHarvest: { cropCycleId: string; date: string }[];
}
