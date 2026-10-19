import type { MultiPolygon } from 'geojson';
import { z } from 'zod';
import { LatLng, countryCode, id, isoDateTime, longText, name, shortText } from './common.js';

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
  tenure: z.enum(TENURES).optional(),
  soilType: shortText,
  notes: longText,
  status: z.enum(['active', 'archived']).optional(),
});
export type UpdateFieldInput = z.input<typeof UpdateFieldInput>;

export const UpdateFieldGeometryInput = z.object({
  geometry: FieldGeometry,
  /** When the new boundary takes effect; defaults to now. A future date plans the change. */
  validFrom: isoDateTime.optional(),
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
  /** Season the imported crops are planned in; required when any feature carries a crop. */
  seasonId: id.nullish(),
  features: z
    .array(
      z.object({
        name,
        identifier: shortText,
        geometry: FieldGeometry,
        /** Main crop of the field in `seasonId`, e.g. resolved from the land-use code of a subsidy application. */
        cropId: id.nullish(),
        /** Land-use code (Nutzungscode) from the source; kept on the crop when it differs from the crop's default. */
        landUseCode: z.string().trim().max(5).nullish(),
      }),
    )
    .min(1)
    .max(2000),
});
export type ImportFieldsInput = z.input<typeof ImportFieldsInput>;

export interface ImportFieldsResult {
  created: { id: string; name: string; areaHa: number }[];
  /** Number of imported fields that got a crop in the season. */
  cropsAssigned: number;
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
  areaHa: number;
  geometry: MultiPolygon;
  centroid: LatLng;
  geometryVersionId: string;
  /** Next boundary change that has not taken effect yet. */
  plannedGeometry: { id: string; validFrom: string; areaHa: number } | null;
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
  /** `planned` versions take effect in the future and can still be cancelled. */
  status: 'past' | 'current' | 'planned';
  source: 'drawn' | 'import' | 'edit';
  geometry: MultiPolygon;
}
