import { z } from 'zod';
import { amount, id, isoDate, isoDateTime, longText, name, shortText } from './common.js';

export const PRODUCT_CATEGORIES = ['seed', 'fertilizer', 'crop_protection', 'fuel', 'consumable', 'harvest', 'other'] as const;
export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];

export const PRODUCT_CATEGORY_LABELS: Record<ProductCategory, string> = {
  seed: 'Seed',
  fertilizer: 'Fertilizer',
  crop_protection: 'Crop protection',
  fuel: 'Fuel',
  consumable: 'Consumable',
  harvest: 'Harvested goods',
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
  /** kg humus-C per t (or m³) of fresh mass (VDLUFA humus balance). */
  humusCKgPerT: z.number().min(-1000).max(1000).nullish(),
  /** Nitrogen effectiveness in the year of application, % of total N. */
  nEffectivenessPct: percent,
  website: z.url().max(500).nullish(),
  datasheetFileId: id.nullish(),
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
  humusCKgPerT: number | null;
  nEffectivenessPct: number | null;
  website: string | null;
  datasheetFileId: string | null;
  notes: string | null;
  archivedAt: string | null;
  /** Current stock across all storage locations, in the base unit. */
  stock: number;
  lowStock: boolean;
  /** Stock value at the current year's price (or the last receipt price). */
  stockValue: number | null;
  /** Earliest expiry date of lots still in stock. */
  nextExpiry: string | null;
  /** The price used for this year's valuation, and where it comes from. */
  currentPrice: { price: number; year: number; source: 'manual' | 'warehouse' | 'default' } | null;
}

export const StorageLocationInput = z.object({ name, farmId: id.nullish() });
export type StorageLocationInput = z.input<typeof StorageLocationInput>;

export interface StorageLocation {
  id: string;
  name: string;
  farmId: string | null;
}

export const STOCK_MOVEMENT_KINDS = ['receipt', 'issue', 'adjustment', 'consumption', 'reversal', 'void'] as const;
export type StockMovementKind = (typeof STOCK_MOVEMENT_KINDS)[number];

export const StockMovementInput = z
  .object({
    productId: id,
    storageLocationId: id.nullish(),
    /** Receipt (in), issue (out, e.g. a sale) or a signed adjustment. */
    kind: z.enum(['receipt', 'issue', 'adjustment']),
    quantityDelta: z.number().finite().refine((v) => v !== 0, 'Quantity must not be zero'),
    unitCost: amount.nullish(),
    totalPrice: amount.nullish(),
    vatRate: z.number().min(0).max(100).nullish(),
    lotNumber: z.string().trim().max(100).nullish(),
    expiryDate: isoDate.nullish(),
    /** Supplier of a receipt, buyer of an issue. */
    counterparty: z.string().trim().max(200).nullish(),
    invoiceNumber: z.string().trim().max(100).nullish(),
    occurredAt: isoDateTime.optional(),
    note: shortText,
  })
  .refine((m) => m.kind !== 'receipt' || m.quantityDelta > 0, { message: 'Receipts must be positive', path: ['quantityDelta'] })
  .refine((m) => m.kind !== 'issue' || m.quantityDelta < 0, { message: 'Issues must be negative', path: ['quantityDelta'] });
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
  totalPrice: number | null;
  vatRate: number | null;
  lotNumber: string | null;
  expiryDate: string | null;
  counterparty: string | null;
  invoiceNumber: string | null;
  /** The booking this void cancels, or the void that cancelled this booking. */
  voidsMovementId: string | null;
  voidedBy: string | null;
  note: string | null;
  createdByName: string | null;
}

/** Counted stock of a product (at a location); the difference to the recorded stock is booked. */
export const StocktakeInput = z.object({
  productId: id,
  storageLocationId: id.nullish(),
  counted: z.number().min(0),
  occurredAt: isoDateTime.optional(),
  note: shortText,
});
export type StocktakeInput = z.input<typeof StocktakeInput>;

export const VoidMovementInput = z.object({ reason: z.string().trim().min(3).max(500) });
export type VoidMovementInput = z.input<typeof VoidMovementInput>;

// ---------------------------------------------------------------------------
// Prices per year
// ---------------------------------------------------------------------------

export interface ProductPriceRow {
  productId: string;
  productName: string;
  category: ProductCategory;
  baseUnit: BaseUnit;
  /** Price set or derived for the year. */
  price: number | null;
  source: 'manual' | 'warehouse' | null;
  /** Latest price of an earlier year, used when the year has none. */
  carriedOver: { price: number; year: number } | null;
  /** The product's default price. */
  defaultPrice: number | null;
}

export const ProductPriceInput = z.object({
  year: z.int().min(1990).max(2200),
  prices: z.array(z.object({ productId: id, price: amount.nullable() })).min(1).max(1000),
});
export type ProductPriceInput = z.input<typeof ProductPriceInput>;

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

// ---------------------------------------------------------------------------
// Calculation parameters (read-only emission factors)
// ---------------------------------------------------------------------------

export const CALCULATION_PARAMETER_GROUPS = ['general', 'fuel', 'nitrous_oxide', 'ammonia', 'fertilizer_supply', 'plant_protection', 'seed'] as const;

export interface CalculationParameter {
  group: (typeof CALCULATION_PARAMETER_GROUPS)[number];
  key: string;
  /** Fertilizer type or application technique the value applies to. */
  variant: string | null;
  value: number;
  unit: string;
}

export interface CalculationParameters {
  factorSet: string;
  parameters: CalculationParameter[];
}
