import { z } from 'zod';
import { amount, id, isoDateTime, longText, name, shortText } from './common.js';

export const PRODUCT_CATEGORIES = ['seed', 'fertilizer', 'crop_protection', 'fuel', 'consumable', 'other'] as const;
export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];

export const PRODUCT_CATEGORY_LABELS: Record<ProductCategory, string> = {
  seed: 'Seed',
  fertilizer: 'Fertilizer',
  crop_protection: 'Crop protection',
  fuel: 'Fuel',
  consumable: 'Consumable',
  other: 'Other',
};

export const BASE_UNITS = ['kg', 't', 'l', 'm3', 'unit'] as const;
export type BaseUnit = (typeof BASE_UNITS)[number];

export const BASE_UNIT_LABELS: Record<BaseUnit, string> = {
  kg: 'kg',
  t: 't',
  l: 'l',
  m3: 'm³',
  unit: 'units',
};

const percent = z.number().min(0).max(100).nullish();

/**
 * Nitrogen form of a mineral fertilizer, or the kind of organic fertilizer. It decides the minimum
 * N efficiency (DüV Anlage 3), whether the 170 kg N limit applies and the emission factors.
 */
export const MINERAL_FERTILIZER_TYPES = ['can', 'urea', 'urea_inhibitor', 'uan', 'np', 'npk', 'pk', 'other_mineral'] as const;
export const ORGANIC_FERTILIZER_TYPES = [
  'cattle_slurry',
  'pig_slurry',
  'cattle_liquid_manure',
  'pig_liquid_manure',
  'cattle_solid_manure',
  'pig_solid_manure',
  'horse_sheep_manure',
  'poultry_manure',
  'laying_hen_dry_manure',
  'digestate_liquid',
  'digestate_solid',
  'compost',
  'sewage_sludge',
  'other_organic',
] as const;
export const FERTILIZER_TYPES = [...MINERAL_FERTILIZER_TYPES, ...ORGANIC_FERTILIZER_TYPES] as const;
export type FertilizerType = (typeof FERTILIZER_TYPES)[number];

export const FERTILIZER_TYPE_LABELS: Record<FertilizerType, string> = {
  can: 'Ammonium nitrate (CAN and other N)',
  urea: 'Urea',
  urea_inhibitor: 'Urea with urease inhibitor',
  uan: 'UAN solution',
  np: 'NP fertilizer',
  npk: 'NPK fertilizer',
  pk: 'Fertilizer without N (P, K, Mg, S)',
  other_mineral: 'Other mineral fertilizer',
  cattle_slurry: 'Cattle slurry',
  pig_slurry: 'Pig slurry',
  cattle_liquid_manure: 'Cattle liquid manure (Jauche)',
  pig_liquid_manure: 'Pig liquid manure (Jauche)',
  cattle_solid_manure: 'Cattle solid manure',
  pig_solid_manure: 'Pig solid manure',
  horse_sheep_manure: 'Horse or sheep manure',
  poultry_manure: 'Poultry manure (broilers, turkeys)',
  laying_hen_dry_manure: 'Laying hen dry manure',
  digestate_liquid: 'Digestate, liquid',
  digestate_solid: 'Digestate, solid',
  compost: 'Compost',
  sewage_sludge: 'Sewage sludge',
  other_organic: 'Other organic fertilizer',
};

export const isOrganicFertilizer = (type: FertilizerType | null | undefined) =>
  type != null && (ORGANIC_FERTILIZER_TYPES as readonly string[]).includes(type);

export const ProductInput = z.object({
  category: z.enum(PRODUCT_CATEGORIES),
  name,
  manufacturer: shortText,
  baseUnit: z.enum(BASE_UNITS),
  unitCost: amount.nullish(),
  registrationNumber: shortText,
  activeIngredients: shortText,
  nPct: percent,
  p2o5Pct: percent,
  k2oPct: percent,
  sPct: percent,
  nh4NPct: percent,
  mgoPct: percent,
  /** Lime value in kg CaO per 100 kg; negative for acidifying fertilizers. */
  caoPct: z.number().min(-100).max(100).nullish(),
  dryMatterPct: percent,
  /** t/m³ (= kg/l); converts volume rates to mass. */
  densityTM3: z.number().positive().max(5).nullish(),
  fertilizerType: z.enum(FERTILIZER_TYPES).nullish(),
  lowStockThreshold: amount.nullish(),
  notes: longText,
  archived: z.boolean().optional(),
});
export type ProductInput = z.input<typeof ProductInput>;

export interface Product {
  id: string;
  category: ProductCategory;
  name: string;
  manufacturer: string | null;
  baseUnit: BaseUnit;
  unitCost: number | null;
  registrationNumber: string | null;
  activeIngredients: string | null;
  nPct: number | null;
  p2o5Pct: number | null;
  k2oPct: number | null;
  sPct: number | null;
  nh4NPct: number | null;
  mgoPct: number | null;
  caoPct: number | null;
  dryMatterPct: number | null;
  densityTM3: number | null;
  fertilizerType: FertilizerType | null;
  /** Catalogue entry the product was created from. */
  catalogueEntryId: string | null;
  /** The plant-protection register entry matching the registration number, if any. */
  psm: { kennr: string; approvalEndsOn: string | null; useUpUntil: string | null; usable: boolean } | null;
  lowStockThreshold: number | null;
  notes: string | null;
  archivedAt: string | null;
  /** Current stock across all storage locations, in the base unit. */
  stock: number;
  lowStock: boolean;
}

export const StorageLocationInput = z.object({ name, farmId: id.nullish() });
export type StorageLocationInput = z.input<typeof StorageLocationInput>;

export interface StorageLocation {
  id: string;
  name: string;
  farmId: string | null;
}

export const STOCK_MOVEMENT_KINDS = ['receipt', 'adjustment', 'consumption', 'reversal'] as const;
export type StockMovementKind = (typeof STOCK_MOVEMENT_KINDS)[number];

export const StockMovementInput = z
  .object({
    productId: id,
    storageLocationId: id.nullish(),
    kind: z.enum(['receipt', 'adjustment']),
    quantityDelta: z.number().finite().refine((v) => v !== 0, 'Quantity must not be zero'),
    unitCost: amount.nullish(),
    occurredAt: isoDateTime.optional(),
    note: shortText,
  })
  .refine((m) => m.kind !== 'receipt' || m.quantityDelta > 0, {
    message: 'Receipts must be positive',
    path: ['quantityDelta'],
  });
export type StockMovementInput = z.input<typeof StockMovementInput>;

export interface StockMovement {
  id: string;
  productId: string;
  productName: string;
  baseUnit: BaseUnit;
  storageLocationId: string | null;
  storageLocationName: string | null;
  kind: StockMovementKind;
  quantityDelta: number;
  unitCost: number | null;
  occurredAt: string;
  operationId: string | null;
  operationTitle: string | null;
  note: string | null;
  createdByName: string | null;
}

export interface StockBalance {
  productId: string;
  storageLocationId: string | null;
  storageLocationName: string | null;
  quantity: number;
}

// ---------------------------------------------------------------------------
// Catalogues
// ---------------------------------------------------------------------------

export interface FertilizerCatalogueEntry {
  id: string;
  name: string;
  fertilizerType: FertilizerType;
  state: 'solid' | 'liquid';
  suggestedUnit: BaseUnit;
  nPct: number | null;
  nh4NPct: number | null;
  p2o5Pct: number | null;
  k2oPct: number | null;
  mgoPct: number | null;
  caoPct: number | null;
  dryMatterPct: number | null;
  densityTM3: number | null;
  indicativePrice: number | null;
}

export const FromCatalogueInput = z.object({
  catalogueEntryId: id,
  name: name.optional(),
  unitCost: amount.nullish(),
});
export type FromCatalogueInput = z.input<typeof FromCatalogueInput>;

export interface PsmProductSummary {
  kennr: string;
  name: string;
  formulation: string | null;
  approvalEndsOn: string | null;
  useUpUntil: string | null;
  /** Approved, or within its use-up period, today. */
  usable: boolean;
  activeIngredients: { name: string; content: number | null; unit: string | null }[];
}

export interface PsmUse {
  awgId: string;
  /** Approved for the crop asked about (directly or through a crop group). */
  matchesCrop: boolean;
  cropNames: string[];
  targets: string[];
  bbchFrom: number | null;
  bbchTo: number | null;
  maxApplications: number | null;
  minIntervalDays: number | null;
  doseMax: number | null;
  /** Dose unit as text, e.g. "l/ha". */
  doseUnit: string | null;
  waterMinLHa: number | null;
  waterMaxLHa: number | null;
  /** Pre-harvest interval for the crop asked about; null when covered by the application window or unknown. */
  waitingDays: number | null;
}

export const FromPsmInput = z.object({ kennr: z.string().trim().min(3).max(20), unitCost: amount.nullish() });
export type FromPsmInput = z.input<typeof FromPsmInput>;
