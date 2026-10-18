import { z } from 'zod';
import { amount, id, isoDate, longText, positive, shortText } from './common.js';

export const HarvestInput = z.object({
  cropCycleId: id,
  harvestDate: isoDate,
  /** Defaults to the crop cycle area. */
  harvestedAreaHa: positive.nullish(),
  quantityT: amount,
  moisturePct: z.number().min(0).max(100).nullish(),
  quality: shortText,
  pricePerT: amount.nullish(),
  priceBasis: z.enum(['actual', 'expected']).default('expected'),
  notes: longText,
});
export type HarvestInput = z.input<typeof HarvestInput>;

export interface Harvest {
  id: string;
  cropCycleId: string;
  fieldName: string;
  cropName: string;
  harvestDate: string;
  harvestedAreaHa: number;
  quantityT: number;
  yieldTHa: number;
  moisturePct: number | null;
  quality: string | null;
  pricePerT: number | null;
  priceBasis: 'actual' | 'expected';
  revenue: number | null;
  notes: string | null;
}

export const COST_CATEGORIES = ['seed', 'fertilizer', 'crop_protection', 'fuel', 'other_input', 'labor', 'machinery', 'contractor', 'land', 'insurance', 'other'] as const;
export type CostCategory = (typeof COST_CATEGORIES)[number];

export const COST_CATEGORY_LABELS: Record<CostCategory, string> = {
  seed: 'Seed',
  fertilizer: 'Fertilizer',
  crop_protection: 'Crop protection',
  fuel: 'Fuel',
  other_input: 'Other inputs',
  labor: 'Labor',
  machinery: 'Machinery',
  contractor: 'Contractors',
  land: 'Land rent',
  insurance: 'Insurance',
  other: 'Other',
};

export const CostEntryInput = z.object({
  seasonId: id.nullish(),
  cropCycleId: id.nullish(),
  fieldId: id.nullish(),
  category: z.enum(COST_CATEGORIES),
  amount: z.number().finite().min(-1e10).max(1e10),
  basis: z.enum(['actual', 'estimated']).default('actual'),
  description: shortText,
  incurredOn: isoDate,
});
export type CostEntryInput = z.input<typeof CostEntryInput>;

export interface CostEntry {
  id: string;
  seasonId: string | null;
  cropCycleId: string | null;
  fieldId: string | null;
  fieldName: string | null;
  operationId: string | null;
  operationTitle: string | null;
  category: CostCategory;
  amount: number;
  currency: string;
  basis: 'actual' | 'estimated';
  source: 'operation' | 'reversal' | 'manual';
  description: string | null;
  incurredOn: string;
}

export type RevenueBasis = 'actual' | 'expected' | 'planned' | 'none';

export interface CropCycleEconomics {
  cropCycleId: string;
  fieldId: string;
  fieldName: string;
  cropId: string;
  cropName: string;
  cropColor: string;
  status: string;
  areaHa: number;
  harvestedQuantityT: number | null;
  yieldTHa: number | null;
  expectedYieldTHa: number | null;
  revenue: number;
  /**
   * actual: harvest sold at an actual price; expected: harvested quantity at an expected
   * price; planned: expected yield × expected price before harvest; none: no estimate.
   */
  revenueBasis: RevenueBasis;
  costs: Partial<Record<CostCategory, number>>;
  actualCosts: number;
  estimatedCosts: number;
  totalCosts: number;
  costPerHa: number;
  /** Revenue minus recorded direct costs. A contribution margin, not farm profit. */
  margin: number;
  marginPerHa: number;
  /** Seed, fertilizer, crop protection and other inputs. */
  directCosts: number;
  /** Direktkostenfreie Leistung: revenue minus direct costs. */
  dfl: number;
  /** Fuel, machinery and contractor costs. */
  machineryCosts: number;
  /** Deckungsbeitrag I: DfL minus machinery costs. */
  db1: number;
  laborCosts: number;
  /** Deckungsbeitrag II: DB I minus labor. */
  db2: number;
  db2PerHa: number;
  /** Land rent, insurance and other entries on the crop. */
  otherCosts: number;
  /** Valued from the crop's planned operations and expected yield; null without plan data. */
  planned: { revenue: number; directCosts: number; machineryCosts: number; laborCosts: number; db2: number } | null;
  /** Greenhouse-gas emissions of completed operations, kg CO2e. */
  co2eKg: number;
  co2ePerHa: number;
  /** kg CO2e per tonne harvested (or expected); null without a yield. */
  co2ePerT: number | null;
}

export interface CropEconomics {
  cropId: string;
  cropName: string;
  cropColor: string;
  areaHa: number;
  yieldTHa: number | null;
  revenue: number;
  totalCosts: number;
  margin: number;
  marginPerHa: number;
  costPerHa: number;
  dfl: number;
  db1: number;
  db2: number;
  db2PerHa: number;
  co2eKg: number;
  co2ePerHa: number;
  co2ePerT: number | null;
}

/** From contribution margins to an indicative farm result (all amounts for the season). */
export interface FarmResult {
  db2: number;
  overheads: { lease: number; landTax: number; insurance: number; buildings: number; accounting: number; other: number; total: number };
  /** Season costs entered without a crop (manual entries). */
  unallocatedCosts: number;
  resultBeforePayments: number;
  payments: { basic: number; redistributive: number; ecoSchemes: number; other: number; total: number };
  result: number;
  resultPerHa: number;
}

export interface EconomicsSummary {
  seasonId: string;
  seasonName: string;
  currency: string;
  cycles: CropCycleEconomics[];
  byCrop: CropEconomics[];
  totals: {
    areaHa: number;
    revenue: number;
    totalCosts: number;
    margin: number;
    marginPerHa: number;
    costsByCategory: Partial<Record<CostCategory, number>>;
  };
  /** Season costs not attributed to any crop cycle (e.g. general overhead entries). */
  unallocatedCosts: number;
  /** Null until overheads and payments are entered for the season. */
  farmResult: FarmResult | null;
  carbon: { totalKg: number; perHa: number; bySource: Record<string, number>; factorSet: string };
}

export const FarmOverheadsInput = z.object({
  seasonId: id,
  leasePerHa: amount.default(0),
  landTaxPerHa: amount.default(0),
  insurancePerHa: amount.default(0),
  buildingsPerHa: amount.default(0),
  accountingPerHa: amount.default(0),
  otherPerHa: amount.default(0),
  basicPaymentPerHa: amount.default(0),
  redistributive1PerHa: amount.default(0),
  redistributive2PerHa: amount.default(0),
  ecoSchemesPerHa: amount.default(0),
  otherPaymentsPerHa: amount.default(0),
});
export type FarmOverheadsInput = z.input<typeof FarmOverheadsInput>;
export type FarmOverheads = Omit<z.output<typeof FarmOverheadsInput>, never>;

export interface CropPrice {
  cropId: string;
  cropName: string;
  harvestYear: number;
  pricePerT: number;
  notes: string | null;
}

export const CropPricesInput = z.object({
  harvestYear: z.int().min(1990).max(2200),
  prices: z.array(z.object({ cropId: id, pricePerT: amount.nullable(), notes: shortText })).max(200),
});
export type CropPricesInput = z.input<typeof CropPricesInput>;
