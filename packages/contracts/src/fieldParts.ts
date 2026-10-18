import type { MultiPolygon } from 'geojson';
import { z } from 'zod';
import { id, longText, name } from './common.js';
import { FieldGeometry } from './farms.js';

// ---------------------------------------------------------------------------
// Part fields (Teilschläge): a field divided for one season
// ---------------------------------------------------------------------------

/**
 * What a part of a field is used for in a season. `cropped` carries the main crop; strips and
 * fallow are kept apart (e.g. for GLÖZ / eco-schemes); `leased_out` is farmed by someone else.
 */
export const FIELD_PART_USAGES = ['cropped', 'fallow', 'flower_strip', 'buffer_strip', 'landscape_element', 'leased_out', 'other'] as const;
export type FieldPartUsage = (typeof FIELD_PART_USAGES)[number];

export const FIELD_PART_USAGE_COLORS: Record<FieldPartUsage, string> = {
  cropped: '#d9a521',
  fallow: '#b5a58a',
  flower_strip: '#c86fc9',
  buffer_strip: '#4c9a52',
  landscape_element: '#2f6b3a',
  leased_out: '#7a8ba8',
  other: '#9aa392',
};

export const FieldPartInput = z.object({
  /** Keeps an existing part (and the crops and operations recorded on it). */
  id: id.optional(),
  name,
  usage: z.enum(FIELD_PART_USAGES).default('cropped'),
  /**
   * The drawn area, clipped to the field boundary; it may extend beyond the field. Omit it for
   * the remainder: whatever the drawn parts leave of the field (at most one part).
   */
  geometry: FieldGeometry.nullish(),
  notes: longText,
});
export type FieldPartInput = z.input<typeof FieldPartInput>;

/**
 * Replaces the parts of a field in one season. Drawn parts are applied in order: each takes only
 * the area of the field that earlier parts left. An empty list (or a single part) removes the
 * division: the field is used as a whole.
 */
export const SplitFieldInput = z.object({
  seasonId: id,
  parts: z
    .array(FieldPartInput)
    .max(50)
    .refine((parts) => parts.filter((p) => !p.geometry).length <= 1, { message: 'Only one part can be the remainder' })
    .refine((parts) => new Set(parts.map((p) => p.name.trim().toLowerCase())).size === parts.length, { message: 'Part names must be unique' }),
});
export type SplitFieldInput = z.input<typeof SplitFieldInput>;

export interface FieldPartCrop {
  cropCycleId: string;
  cropName: string;
  color: string;
  status: string;
}

export interface FieldPart {
  id: string;
  fieldId: string;
  fieldName: string;
  seasonId: string;
  name: string;
  usage: FieldPartUsage;
  isRemainder: boolean;
  areaHa: number;
  geometry: MultiPolygon;
  notes: string | null;
  /** The field boundary was changed after the split; the part may not match it any more. */
  outdated: boolean;
  crops: FieldPartCrop[];
}

/** Result of computing a split without saving it. */
export interface FieldSplitPreview {
  fieldAreaHa: number;
  parts: { index: number; name: string; usage: FieldPartUsage; isRemainder: boolean; areaHa: number; geometry: MultiPolygon }[];
}
