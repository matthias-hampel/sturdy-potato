import { z } from 'zod';
import { amount, id, isoDate, longText, name, positive, shortText } from './common.js';
import type { CropRole } from './crops.js';
import type { BaseUnit } from './inventory.js';
import { OPERATION_TYPES, type OperationStatus, type OperationType } from './operations.js';

// ---------------------------------------------------------------------------
// Cultivation templates
// ---------------------------------------------------------------------------

/** What a template step's date is counted from. */
export const TEMPLATE_ANCHORS = ['sowing', 'harvest', 'season_start'] as const;
export type TemplateAnchor = (typeof TEMPLATE_ANCHORS)[number];

export const TemplateStepInputInput = z.object({
  productId: id,
  /** In the product's base unit per hectare. */
  ratePerHa: positive,
});

export const TemplateStepInput = z.object({
  type: z.enum(OPERATION_TYPES),
  title: z.string().trim().min(1).max(200),
  anchor: z.enum(TEMPLATE_ANCHORS).default('sowing'),
  offsetDays: z.int().min(-400).max(400).default(0),
  bbchStage: shortText,
  notes: longText,
  inputs: z.array(TemplateStepInputInput).max(20).default([]),
});
export type TemplateStepInput = z.input<typeof TemplateStepInput>;

export const TemplateInput = z.object({
  cropId: id,
  name,
  notes: longText,
  steps: z.array(TemplateStepInput).max(100).default([]),
});
export type TemplateInput = z.input<typeof TemplateInput>;

export interface TemplateStep {
  id: string;
  position: number;
  type: OperationType;
  title: string;
  anchor: TemplateAnchor;
  offsetDays: number;
  bbchStage: string | null;
  notes: string | null;
  inputs: { productId: string; productName: string; baseUnit: BaseUnit; ratePerHa: number }[];
}

export interface CultivationTemplate {
  id: string;
  cropId: string;
  cropName: string;
  cropColor: string;
  name: string;
  notes: string | null;
  steps: TemplateStep[];
  /** Crop cycles the template has been applied to. */
  usedBy: number;
  updatedAt: string;
}

export const ApplyTemplateInput = z.object({
  templateId: id,
  /** Replace the planned operations of a template applied earlier (completed work is kept). */
  replace: z.boolean().default(false),
});
export type ApplyTemplateInput = z.input<typeof ApplyTemplateInput>;

export interface ApplyTemplateResult {
  cropCycleId: string;
  created: number;
  removed: number;
}

// ---------------------------------------------------------------------------
// Crop rotations
// ---------------------------------------------------------------------------

export const RotationEntryInput = z.object({
  cropId: id,
  templateId: id.nullish(),
  /** Catch crop sown after this crop's harvest. */
  catchCropId: id.nullish(),
  expectedYieldTHa: amount.nullish(),
});

export const RotationInput = z.object({
  name,
  notes: longText,
  entries: z.array(RotationEntryInput).min(1).max(12),
});
export type RotationInput = z.input<typeof RotationInput>;

export interface RotationEntry {
  position: number;
  cropId: string;
  cropName: string;
  cropColor: string;
  templateId: string | null;
  templateName: string | null;
  catchCropId: string | null;
  catchCropName: string | null;
  expectedYieldTHa: number | null;
}

export interface RotationField {
  id: string;
  fieldId: string;
  fieldName: string;
  startYear: number;
  endYear: number | null;
}

export interface CropRotation {
  id: string;
  name: string;
  notes: string | null;
  entries: RotationEntry[];
  fields: RotationField[];
}

export const AssignRotationInput = z
  .object({
    fieldIds: z.array(id).min(1).max(500),
    startYear: z.int().min(1990).max(2200),
    endYear: z.int().min(1990).max(2200).nullish(),
  })
  .refine((a) => a.endYear == null || a.endYear >= a.startYear, { message: 'End year must not be before the start year', path: ['endYear'] });
export type AssignRotationInput = z.input<typeof AssignRotationInput>;

export const RollOverInput = z.object({
  /** Season to plan; its fields get the next crop of their rotation. */
  targetSeasonId: id,
  /** Also apply each entry's template to the new crops. */
  applyTemplates: z.boolean().default(true),
});
export type RollOverInput = z.input<typeof RollOverInput>;

export interface RollOverResult {
  created: number;
  /** Fields that already had a crop in the target season. */
  skipped: number;
  /** Every field following a rotation in the target year and what happened to it. */
  fields: { fieldId: string; fieldName: string; cropName: string | null; outcome: 'created' | 'already_planned' | 'field_divided' }[];
}

// ---------------------------------------------------------------------------
// Crop calendar
// ---------------------------------------------------------------------------

/** Where a calendar date comes from: recorded work, the crop's planned date, or the crop default. */
export type CalendarDateSource = 'recorded' | 'planned' | 'default';

export interface CalendarOperation {
  id: string;
  type: OperationType;
  title: string;
  status: OperationStatus;
  date: string;
}

export interface CalendarRow {
  cropCycleId: string;
  fieldId: string;
  fieldName: string;
  fieldPartName: string | null;
  areaHa: number;
  cropName: string;
  cropColor: string;
  role: CropRole;
  sowing: { date: string; source: CalendarDateSource } | null;
  harvest: { date: string; source: CalendarDateSource } | null;
  operations: CalendarOperation[];
}

export interface CropCalendar {
  seasonId: string;
  from: string;
  to: string;
  rows: CalendarRow[];
}

export const CalendarQuery = z.object({ seasonId: id.optional(), from: isoDate.optional(), to: isoDate.optional() });
