import { z } from 'zod';
import { isoDate } from './common.js';
import { PolygonGeometry } from './farms.js';
import { IMAGERY_LAYERS } from './insights.js';

/** Drawing tools for notes on a satellite scene (agmeo SpatialAnnotations). */
export const ANNOTATION_KINDS = ['marker', 'freehand', 'polygon', 'rectangle'] as const;
export type AnnotationKind = (typeof ANNOTATION_KINDS)[number];

/** The reference's palette: red, blue, yellow, green, white. */
export const ANNOTATION_COLORS = ['#ef4444', '#3b82f6', '#eab308', '#22c55e', '#ffffff'] as const;

const position = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);
const PointGeometry = z.object({ type: z.literal('Point'), coordinates: position });
const LineGeometry = z.object({ type: z.literal('LineString'), coordinates: z.array(position).min(2).max(5000) });
export const AnnotationGeometry = z.discriminatedUnion('type', [PointGeometry, LineGeometry, PolygonGeometry]);
export type AnnotationGeometry = z.infer<typeof AnnotationGeometry>;

const GEOMETRY_OF: Record<AnnotationKind, AnnotationGeometry['type']> = {
  marker: 'Point',
  freehand: 'LineString',
  polygon: 'Polygon',
  rectangle: 'Polygon',
};

const note = z.string().trim().max(500);

export const AnnotationInput = z
  .object({
    date: isoDate,
    layer: z.enum(IMAGERY_LAYERS).nullish(),
    kind: z.enum(ANNOTATION_KINDS),
    color: z.enum(ANNOTATION_COLORS),
    note: note.nullish(),
    geometry: AnnotationGeometry,
  })
  .refine((v) => GEOMETRY_OF[v.kind] === v.geometry.type, { message: 'Geometry does not match the tool', path: ['geometry'] });
export type AnnotationInput = z.input<typeof AnnotationInput>;

export const AnnotationPatch = z.object({ note: note.nullable() });
export type AnnotationPatch = z.input<typeof AnnotationPatch>;

export interface SatelliteAnnotation {
  id: string;
  fieldId: string;
  date: string;
  layer: string | null;
  kind: AnnotationKind;
  color: string;
  note: string | null;
  geometry: AnnotationGeometry;
  createdAt: string;
  createdBy: string | null;
}
