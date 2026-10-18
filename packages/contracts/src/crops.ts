import { z } from 'zod';
import { id, isoDate, longText, name, positive, amount } from './common.js';

export const CROP_CATEGORIES = ['cereal', 'oilseed', 'legume', 'maize', 'root', 'grassland', 'cover', 'vegetable', 'other'] as const;
export type CropCategory = (typeof CROP_CATEGORIES)[number];

export interface Crop {
  id: string;
  code: string;
  /** Display name: the German catalogue name where there is one, else the stored name (custom crops keep theirs). */
  name: string;
  /** English catalogue name; null for custom crops. */
  nameEn: string | null;
  category: CropCategory;
  isWinterCrop: boolean;
  color: string;
  custom: boolean;
  /** Bundessortenamt species code ("Kennbuchstabe") whose registered varieties apply to this crop. */
  bsaSpeciesCode: string | null;
  isLegume: boolean;
  isPerennial: boolean;
  /** Typical sowing and harvest day ('MM-DD'); winter and catch crops are sown in the year before harvest. */
  defaultSowingMd: string | null;
  defaultHarvestMd: string | null;
  eppoCode: string | null;
}

export const CreateCropInput = z.object({
  name,
  category: z.enum(CROP_CATEGORIES),
  isWinterCrop: z.boolean().default(false),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#7c8f3a'),
});
export type CreateCropInput = z.input<typeof CreateCropInput>;

export interface Variety {
  id: string;
  cropId: string;
  name: string;
  /** Set when the variety is in the Bundessortenamt register. */
  registeredVarietyId: string | null;
}

/** A variety from the Bundessortenamt register that may currently be sown in Germany. */
export interface RegisteredVariety {
  id: string;
  name: string;
  speciesCode: string;
  /** BSA "Kennnummer". */
  registrationNumber: number;
  approvedOn: string | null;
  /** Set when the approval has ended and certified seed may only be sold until this date. */
  marketableUntil: string | null;
  /** Region of origin of a conservation variety ("Erhaltungssorte"). */
  conservationRegion: string | null;
}

export const CreateVarietyInput = z.object({ cropId: id, name });
export type CreateVarietyInput = z.input<typeof CreateVarietyInput>;

export interface Season {
  id: string;
  name: string;
  harvestYear: number;
  startDate: string;
  endDate: string;
  cropCycleCount: number;
}

export const SeasonInput = z
  .object({
    name: name.optional(),
    harvestYear: z.int().min(1990).max(2200),
    startDate: isoDate,
    endDate: isoDate,
  })
  .refine((s) => s.endDate > s.startDate, { message: 'End date must be after start date', path: ['endDate'] });
export type SeasonInput = z.input<typeof SeasonInput>;

/** Main crop of the season, or a catch / undersown crop sown in the season ahead of next season's main crop. */
export const CROP_ROLES = ['main', 'catch_crop', 'undersown'] as const;
export type CropRole = (typeof CROP_ROLES)[number];

export const CROP_CYCLE_STATUSES = ['planned', 'active', 'harvested', 'closed'] as const;
export type CropCycleStatus = (typeof CROP_CYCLE_STATUSES)[number];

export interface CropCycle {
  id: string;
  fieldId: string;
  fieldName: string;
  farmId: string;
  seasonId: string;
  seasonName: string;
  harvestYear: number;
  cropId: string;
  cropName: string;
  cropColor: string;
  varietyId: string | null;
  varietyName: string | null;
  status: CropCycleStatus;
  role: CropRole;
  /** Cultivation template whose steps were applied as planned operations. */
  templateId: string | null;
  templateName: string | null;
  /** Land-use code of the subsidy application: the cycle's own, else the crop's default. */
  landUseCode: string | null;
  landUseCodeIsDefault: boolean;
  /** The part field (Teilschlag) the crop grows on; null for the whole field. */
  fieldPartId: string | null;
  fieldPartName: string | null;
  /** Effective area: the planted area if set, otherwise the part's area, otherwise the current field area. */
  areaHa: number;
  sowingDate: string | null;
  expectedHarvestDate: string | null;
  expectedYieldTHa: number | null;
  expectedPricePerT: number | null;
  notes: string | null;
}

const cropCycleFields = {
  cropId: id,
  varietyId: id.nullish(),
  status: z.enum(CROP_CYCLE_STATUSES).default('planned'),
  role: z.enum(CROP_ROLES).default('main'),
  areaHa: positive.nullish(),
  sowingDate: isoDate.nullish(),
  expectedHarvestDate: isoDate.nullish(),
  expectedYieldTHa: amount.nullish(),
  expectedPricePerT: amount.nullish(),
  notes: longText,
};

/**
 * Assign the same crop to fields and/or part fields in a season. A field that is divided into
 * parts in the season takes crops only on its parts.
 */
export const CreateCropCyclesInput = z
  .object({
    seasonId: id,
    fieldIds: z.array(id).max(500).default([]),
    fieldPartIds: z.array(id).max(500).default([]),
    ...cropCycleFields,
  })
  .refine((c) => c.fieldIds.length + c.fieldPartIds.length > 0, { message: 'Select at least one field', path: ['fieldIds'] });
export type CreateCropCyclesInput = z.input<typeof CreateCropCyclesInput>;

export const UpdateCropCycleInput = z.object({
  cropId: id.optional(),
  varietyId: id.nullish(),
  status: z.enum(CROP_CYCLE_STATUSES).optional(),
  role: z.enum(CROP_ROLES).optional(),
  /** Moves the crop to another part of the same field and season. */
  fieldPartId: id.optional(),
  areaHa: positive.nullish(),
  sowingDate: isoDate.nullish(),
  expectedHarvestDate: isoDate.nullish(),
  expectedYieldTHa: amount.nullish(),
  expectedPricePerT: amount.nullish(),
  notes: longText,
});
export type UpdateCropCycleInput = z.input<typeof UpdateCropCycleInput>;
