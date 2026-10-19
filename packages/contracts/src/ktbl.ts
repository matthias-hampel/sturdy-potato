import { z } from 'zod';
import { OPERATION_TYPES, type OperationType } from './operations.js';

/**
 * KTBL reference actions (Arbeitsgänge with machine variant) and their costs per hectare, after
 * AGVOLUTION/agmeo `src/lib/ktbl`. Labels come in German and English because there are ~700 of them.
 */

/** Crop groups the KTBL grid values are averaged over. */
export const KTBL_CROP_GROUPS = ['cereals', 'maize', 'roots', 'oilseeds', 'legumes', 'grasses', 'intercrops'] as const;
export type KtblCropGroup = (typeof KTBL_CROP_GROUPS)[number];

export const KtblActionQuery = z.object({
  operationType: z.enum(OPERATION_TYPES).optional(),
  /** Crop code or id: only actions the reference offers for this crop. */
  crop: z.string().trim().min(1).max(100).optional(),
  /** Words to find in the German or English action and group texts. */
  q: z.string().trim().max(200).optional(),
});
export type KtblActionQuery = z.input<typeof KtblActionQuery>;

export interface KtblText {
  de: string;
  en: string;
}

export interface KtblAction {
  /** KTBL action and machine variant, e.g. PLOWING__RP7_1000. */
  fqn: string;
  operationType: OperationType;
  /** Operation category of the reference (TILLAGE, PLANTING, HARVESTING, POSTHARVEST, …). */
  category: string;
  /** The action (e.g. Pflügen). */
  group: KtblText;
  /** The machine variant (e.g. Drehpflug (7 Körper, 2.45 m, gezogen), 83 kW). */
  label: KtblText;
  /** Crops the reference offers it for: ALL, ARABLES, SMALL_GRAINS, ROW_CROPS, HARVEST_GRAIN, HARVEST_WHOLE, ROOT_ARABLES, GRASSLAND. */
  appliesTo: string;
}

export const KtblEstimateQuery = z.object({
  fqn: z.string().trim().min(1).max(100),
  /** Crop code or id; its crop group selects the KTBL table values. */
  crop: z.string().trim().min(1).max(100).optional(),
  cropGroup: z.enum(KTBL_CROP_GROUPS).optional(),
  fieldSizeHa: z.coerce.number().positive().max(10000).default(10),
  distanceKm: z.coerce.number().min(0).max(500).default(5),
  /** Tractor power; rounded to the nearest KTBL power class (45, 67, 83, 102, 120, 200, 230 kW). */
  mechKw: z.coerce.number().min(1).max(2000).default(120),
});
export type KtblEstimateQuery = z.input<typeof KtblEstimateQuery>;

/** Per hectare and pass: hours (h/ha), diesel (l/ha) and the cost columns (€/ha). */
export interface KtblEstimate {
  fqn: string;
  cropGroup: KtblCropGroup | null;
  /** `grid`: KTBL table values of the crop group; `formula`: approximation fitted to them, without crop. */
  method: 'grid' | 'formula';
  fieldSizeHa: number;
  distanceKm: number;
  mechKw: number;
  hours: number;
  diesel: number;
  depreciation: number;
  interest: number;
  miscellaneous: number;
  repairs: number;
  materials: number;
  services: number;
}
