import type { MultiPolygon } from 'geojson';
import { z } from 'zod';
import { LatLng, countryCode, id, isoDate, isoDateTime, longText, name, shortText } from './common.js';

export const FarmInput = z.object({
  name,
  address: shortText,
  country: countryCode.default('DE'),
  timezone: z.string().min(1).max(64).default('Europe/Berlin'),
  location: LatLng.nullish(),
  /** Zoom of the farm's default map view, centred on `location`. */
  mapZoom: z.number().min(0).max(22).nullish(),
  notes: longText,
});
export type FarmInput = z.input<typeof FarmInput>;

export interface Farm {
  id: string;
  name: string;
  address: string | null;
  country: string;
  timezone: string;
  location: LatLng | null;
  mapZoom: number | null;
  notes: string | null;
  archivedAt: string | null;
  fieldCount: number;
  totalAreaHa: number;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Fields
// ---------------------------------------------------------------------------

export const TENURES = ['owned', 'leased', 'other'] as const;
export type Tenure = (typeof TENURES)[number];

const position = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]).rest(z.number());
const ring = z
  .array(position)
  .min(4)
  .refine((r) => r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1], 'Polygon rings must be closed');
const polygonCoords = z.array(ring).min(1);

export const PolygonGeometry = z.object({ type: z.literal('Polygon'), coordinates: polygonCoords });
export const MultiPolygonGeometry = z.object({
  type: z.literal('MultiPolygon'),
  coordinates: z.array(polygonCoords).min(1),
});
/** Field boundaries in WGS 84 (EPSG:4326), as GeoJSON. */
export const FieldGeometry = z.discriminatedUnion('type', [PolygonGeometry, MultiPolygonGeometry]);
export type FieldGeometry = z.infer<typeof FieldGeometry>;

export const CreateFieldInput = z.object({
  farmId: id,
  name,
  identifier: shortText,
  tenure: z.enum(TENURES).default('owned'),
  soilType: shortText,
  notes: longText,
  geometry: FieldGeometry,
});
export type CreateFieldInput = z.input<typeof CreateFieldInput>;

export const UpdateFieldInput = z.object({
  farmId: id.optional(),
  name: name.optional(),
  identifier: shortText,
  parcelNumber: shortText,
  tenure: z.enum(TENURES).optional(),
  soilType: shortText,
  notes: longText,
  status: z.enum(['active', 'archived']).optional(),
});
export type UpdateFieldInput = z.input<typeof UpdateFieldInput>;

export const UpdateFieldGeometryInput = z.object({
  geometry: FieldGeometry,
  /** When the new boundary takes effect; defaults to now. */
  validFrom: isoDateTime.optional(),
  reason: z.string().trim().max(500).optional(),
});
export type UpdateFieldGeometryInput = z.input<typeof UpdateFieldGeometryInput>;

export const ValidateGeometryInput = z.object({
  geometry: FieldGeometry,
  excludeFieldId: id.optional(),
});
export type ValidateGeometryInput = z.input<typeof ValidateGeometryInput>;

export interface FieldOverlap {
  fieldId: string;
  fieldName: string;
  overlapHa: number;
}

export interface GeometryValidation {
  valid: boolean;
  reason: string | null;
  areaHa: number | null;
  overlaps: FieldOverlap[];
}

export const ImportFieldsInput = z.object({
  farmId: id,
  features: z
    .array(
      z.object({
        name,
        identifier: shortText,
        geometry: FieldGeometry,
      }),
    )
    .min(1)
    .max(2000),
});
export type ImportFieldsInput = z.input<typeof ImportFieldsInput>;

export interface ImportFieldsResult {
  created: { id: string; name: string; areaHa: number }[];
  errors: { index: number; name: string; message: string }[];
  overlaps: { name: string; overlaps: FieldOverlap[] }[];
}

export interface FieldCurrentCrop {
  cropCycleId: string;
  cropName: string;
  color: string;
  seasonName: string;
  status: string;
}

export interface Field {
  id: string;
  farmId: string;
  farmName: string;
  name: string;
  identifier: string | null;
  tenure: Tenure;
  soilType: string | null;
  /** Soil texture class used by the fertilization tables (set on the Soil tab). */
  soilTexture: string | null;
  /** Nitrate-polluted area (rotes Gebiet, DüV §13a). */
  nitrateSensitiveZone: boolean;
  phosphateSensitiveZone: boolean;
  notes: string | null;
  status: 'active' | 'archived';
  /** The farm's own field number (Schlagnummer). */
  parcelNumber: string | null;
  /** First day an archived field is no longer farmed. */
  archivedFrom: string | null;
  /** The field this one was merged into. */
  mergedIntoId: string | null;
  groups: FieldGroupRef[];
  areaHa: number;
  geometry: MultiPolygon;
  centroid: LatLng;
  geometryVersionId: string;
  currentCrop: FieldCurrentCrop | null;
  /** Number of part fields (Teilschläge) in the requested season; 0 when the field is used as a whole. */
  partCount: number;
  /** Area of the parts used for the main crop (usage `cropped`); the field area when it is not divided. */
  croppedAreaHa: number;
  createdAt: string;
  updatedAt: string;
}

export interface FieldGeometryVersion {
  id: string;
  areaHa: number;
  validFrom: string;
  validTo: string | null;
  source: 'drawn' | 'import' | 'edit' | 'merge' | 'restore';
  reason: string | null;
  geometry: MultiPolygon;
}

// ---------------------------------------------------------------------------
// Field management
// ---------------------------------------------------------------------------

const fieldIds = z.array(id).min(1).max(5000);

export const ArchiveFieldsInput = z.object({
  fieldIds,
  /** First day the fields are no longer farmed; defaults to today. */
  archivedFrom: isoDate.optional(),
});
export type ArchiveFieldsInput = z.input<typeof ArchiveFieldsInput>;

export const FieldIdsInput = z.object({ fieldIds });
export type FieldIdsInput = z.input<typeof FieldIdsInput>;

export interface BulkFieldResult {
  done: string[];
  failed: { fieldId: string; fieldName: string; code: string; message: string }[];
}

/** Numbers the fields 1, 2, 3 … in the given order (or a custom start). */
export const RenumberFieldsInput = z.object({ fieldIds, start: z.int().min(0).max(1_000_000).default(1) });
export type RenumberFieldsInput = z.input<typeof RenumberFieldsInput>;

export const MergeFieldsInput = z.object({
  /** The field that keeps its name, history and crops. */
  survivorId: id,
  /** The field merged into the survivor; it is archived and points at the survivor. */
  otherId: id,
  /** When the merged boundary takes effect; defaults to now. */
  validFrom: isoDateTime.optional(),
  reason: z.string().trim().max(500).optional(),
});
export type MergeFieldsInput = z.input<typeof MergeFieldsInput>;

export interface MergePreview {
  geometry: MultiPolygon;
  areaHa: number;
  /** More than one part means the fields do not touch (gaps up to 2 m are closed). */
  parts: number;
  /** Crops of the merged-away field from the merge date on; they are removed by the merge. */
  removedCropCycles: number;
  /** Crops that block the merge (completed operations on the merged-away field after the date). */
  blockers: string[];
}

export const RestoreFieldGeometryInput = z.object({
  versionId: id,
  validFrom: isoDateTime.optional(),
  reason: z.string().trim().max(500).optional(),
});
export type RestoreFieldGeometryInput = z.input<typeof RestoreFieldGeometryInput>;

export interface FieldGroupRef {
  id: string;
  name: string;
  color: string;
}

export interface FieldGroup extends FieldGroupRef {
  fieldCount: number;
}

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const FieldGroupInput = z.object({ name, color: hexColor.optional() });
export type FieldGroupInput = z.input<typeof FieldGroupInput>;

export const FieldGroupMembersInput = z.object({
  fieldIds,
  /** Group to add to or remove from; `groupName` creates the group when it does not exist. */
  groupId: id.optional(),
  groupName: name.optional(),
});
export type FieldGroupMembersInput = z.input<typeof FieldGroupMembersInput>;
