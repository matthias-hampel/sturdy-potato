import { z } from 'zod';
import { id, isoDate } from './common.js';

// ---------------------------------------------------------------------------
// Greenhouse-gas balance (BEK method, ported from AGVOLUTION/agmeo src/lib/co2calculator)
// ---------------------------------------------------------------------------

/**
 * Emission sources of the BEK calculator: pf* direct and indirect field emissions, pb* upstream
 * emissions of operating resources, pn* credits for by-products (negative).
 */
export const BEK_SOURCES = [
  'pf1', 'pf2', 'pf3', 'pf4', 'pf5a', 'pf5b', 'pf6', 'pf7', 'pf8a', 'pf8b', 'pf9', 'pf10', 'pf11a', 'pf12', 'pf13',
  'pb1a', 'pb1b', 'pb1c', 'pb1d', 'pb2a', 'pb2b', 'pb2c', 'pb3aa', 'pb3ab', 'pb3ac', 'pb3ba', 'pb3bb', 'pb3bc', 'pb4', 'pb5', 'pb6a', 'pb6b', 'pb7',
  'pn1a', 'pn1b', 'pn2a', 'pn2b', 'pn2c',
] as const;
export type BekSource = (typeof BEK_SOURCES)[number];
export type BekEmissions = Partial<Record<BekSource, number>>;

export const BEK_GROUPS = ['pf', 'pb', 'pn'] as const;
export type BekGroup = (typeof BEK_GROUPS)[number];
export const bekGroup = (source: BekSource): BekGroup => source.slice(0, 2) as BekGroup;

/** Coarser categories of the sources, as shown with the season's economics. */
export const EMISSION_CATEGORIES = [
  'diesel',
  'machinery',
  'n2o_direct',
  'n2o_indirect',
  'fertilizer_supply',
  'lime_urea_co2',
  'plant_protection',
  'seed',
  'crop_residues',
  'humus',
  'land_use_change',
  'credits',
] as const;
export type EmissionCategory = (typeof EMISSION_CATEGORIES)[number];

export const BEK_SOURCE_CATEGORY: Record<BekSource, EmissionCategory> = {
  pf1: 'n2o_indirect',
  pf2: 'n2o_indirect',
  pf3: 'n2o_direct',
  pf4: 'n2o_direct',
  pf5a: 'crop_residues',
  pf5b: 'crop_residues',
  pf6: 'n2o_direct',
  pf7: 'n2o_direct',
  pf8a: 'lime_urea_co2',
  pf8b: 'lime_urea_co2',
  pf9: 'humus',
  pf10: 'humus',
  pf11a: 'land_use_change',
  pf12: 'land_use_change',
  pf13: 'land_use_change',
  pb1a: 'fertilizer_supply',
  pb1b: 'fertilizer_supply',
  pb1c: 'fertilizer_supply',
  pb1d: 'fertilizer_supply',
  pb2a: 'fertilizer_supply',
  pb2b: 'fertilizer_supply',
  pb2c: 'fertilizer_supply',
  pb3aa: 'fertilizer_supply',
  pb3ab: 'fertilizer_supply',
  pb3ac: 'fertilizer_supply',
  pb3ba: 'fertilizer_supply',
  pb3bb: 'fertilizer_supply',
  pb3bc: 'fertilizer_supply',
  pb4: 'seed',
  pb5: 'plant_protection',
  pb6a: 'diesel',
  pb6b: 'diesel',
  pb7: 'machinery',
  pn1a: 'credits',
  pn1b: 'credits',
  pn2a: 'credits',
  pn2b: 'credits',
  pn2c: 'credits',
};

/**
 * Sources that bind carbon or credit by-products (they can be negative). "Without credits" leaves
 * them out, as the reference's "balance without credits" switch does.
 */
export const CREDIT_SOURCES: readonly BekSource[] = ['pn1a', 'pn1b', 'pn2a', 'pn2b', 'pn2c', 'pf9', 'pf11a'];

/**
 * GHG Protocol (Land Sector and Removals) view of the sources: land-use change, biogenic and
 * fossil land-management emissions and removals. Humus loss (pf9 > 0) is biogenic, humus build-up
 * (pf9 < 0) a removal.
 */
export const GHG_PROTOCOL_GROUPS = ['nonFlagPostFarm', 'landUseChange', 'landManagementBiogenic', 'landManagementFossil', 'removals'] as const;
export type GhgProtocolGroup = (typeof GHG_PROTOCOL_GROUPS)[number];

export function ghgProtocolSplit(e: BekEmissions): Record<GhgProtocolGroup, number> {
  const v = (k: BekSource) => e[k] ?? 0;
  const fossil: BekSource[] = ['pf1', 'pf2', 'pf3', 'pf4', 'pf5a', 'pf5b', 'pf6', 'pf7', 'pf10', 'pb1a', 'pb1b', 'pb1c', 'pb1d', 'pb2a', 'pb2b', 'pb2c', 'pb3aa', 'pb3ab', 'pb3ac', 'pb3ba', 'pb3bb', 'pb3bc', 'pb4', 'pb5', 'pb6a', 'pb6b', 'pb7'];
  return {
    nonFlagPostFarm: 0,
    landUseChange: v('pf11a') + v('pf12') + v('pf13'),
    landManagementBiogenic: v('pf8a') + v('pf8b') + Math.max(v('pf9'), 0),
    landManagementFossil: fossil.reduce((s, k) => s + v(k), 0),
    removals: v('pn1a') + v('pn1b') + v('pn2a') + v('pn2b') + v('pn2c') + Math.min(v('pf9'), 0),
  };
}

/** Aggregation levels of the CO2 analysis: crop, cultivation template (management) or field. */
export const CARBON_LEVELS = ['crop', 'template', 'field'] as const;
export type CarbonLevel = (typeof CARBON_LEVELS)[number];

/** What emissions are related to: total, per hectare, per tonne fresh mass or per tonne dry matter. */
export const CARBON_EVALUATIONS = ['total', 'perArea', 'perYield', 'perYieldDm'] as const;
export type CarbonEvaluation = (typeof CARBON_EVALUATIONS)[number];

export interface CarbonReportRow {
  /** Unique within the analysis: level entity and harvest year. */
  key: string;
  year: number;
  entityId: string;
  entityName: string;
  cropId: string;
  cropCode: string;
  cropName: string;
  cropColor: string;
  /** Crop key of the calculator, null when the crop has no carbon crop. */
  carbonCrop: string | null;
  /** False when the calculator has no parameters for the crop (no seed, humus or residue terms). */
  hasModelData: boolean;
  templateName: string | null;
  cyclesCount: number;
  areaHa: number;
  /** Fresh mass harvested (or expected, before harvest), t. */
  yieldT: number;
  /** Dry matter of the yield with the calculator's dry-matter content, t; 0 without model data. */
  yieldTDm: number;
  /** kg CO2e. */
  total: number;
  pf: number;
  pb: number;
  pn: number;
  bySource: BekEmissions;
  /** kg CO2e by operation type; crop-cycle terms (humus, residues) count with the harvest. */
  byOperationType: Partial<Record<string, number>>;
}

export interface CarbonAnalysis {
  factorSet: string;
  level: CarbonLevel;
  /** Harvest years that have seasons. */
  years: number[];
  rows: CarbonReportRow[];
  /** Emissions on fields without a crop in the season, kg CO2e by harvest year. */
  unallocatedKg: Record<string, number>;
  nuts2Code: string | null;
  /** Regional reference emissions in kg CO2e per t dry matter by crop code (EU 2024/2666). */
  regionalReference: Record<string, number>;
  /** Scope 2 of the farm by harvest year; not part of the crop rows, as in the reference. */
  scope2: Scope2Year[];
}

export interface CarbonComparisonRow extends CarbonReportRow {
  orgId: string;
  orgName: string;
}

export interface CarbonComparison {
  organizations: { id: string; name: string }[];
  rows: CarbonComparisonRow[];
  scope2: (Scope2Year & { orgId: string; orgName: string })[];
}

export interface CarbonSettings {
  nuts2Code: string | null;
  /** Derived from the farms' federal state where the state is a single NUTS 2 region. */
  suggestedNuts2Code: string | null;
  regions: { code: string; name: string }[];
}

export const CarbonSettingsInput = z.object({ nuts2Code: z.string().regex(/^DE[0-9A-G][0-9]$/).nullable() });
export type CarbonSettingsInput = z.input<typeof CarbonSettingsInput>;

// ---------------------------------------------------------------------------
// Soil carbon (RothC via the Thünen AgriGHG tool)
// ---------------------------------------------------------------------------

/** Sampling depth the Thünen humus model expects for the topsoil, cm. */
export const CARBON_SOIL_DEPTH_CM = 30;

export const CarbonSoilInput = z
  .object({
    bulkDensity: z.number().min(0.5).max(2),
    clayPct: z.number().min(0).max(100),
    socPct: z.number().min(0.1).max(10),
    sandPct: z.number().min(0).max(100),
    sampledOn: isoDate.nullish(),
    fileId: id.nullish(),
  })
  .refine((v) => v.clayPct + v.sandPct <= 100, { message: 'Clay and sand together exceed 100 %', path: ['sandPct'] });
export type CarbonSoilInput = z.input<typeof CarbonSoilInput>;

export interface CarbonSoilValues {
  depthCm: number;
  bulkDensity: number;
  clayPct: number;
  socPct: number;
  sandPct: number;
}

export interface CarbonSoil {
  fieldId: string;
  /** The saved sample, or null: then `values` are prefilled. */
  saved: (CarbonSoilValues & { sampledOn: string | null; fileId: string | null; fileName: string | null; updatedAt: string }) | null;
  /** Saved values, else derived from the latest soil sample (humus → SOC) or defaults. */
  values: CarbonSoilValues;
  prefillSource: 'saved' | 'soil_sample' | 'default';
}

export interface RotationCarbonEntry {
  position: number;
  cropName: string;
  /** kg CO2e/ha of the entry's template and crop with its expected yield; null without model data. */
  co2eKgPerHa: number | null;
  hasModelData: boolean;
}

export interface RotationCarbon {
  rotationId: string;
  entries: RotationCarbonEntry[];
}

export const RothCInput = z.object({
  rotationId: id,
  /** Rotation position the simulation starts with (0-based); the order wraps around. */
  startPosition: z.int().min(0).max(20).default(0),
});
export type RothCInput = z.input<typeof RothCInput>;

export interface RothCResultItem {
  Time_ISO_8601: string;
  SOC_stock_Mg_C_ha_1: number;
  SOC_content_percent_C_ha_1: number;
}

/** Month of the 10-year series averaged over the five shifted simulation windows. */
export interface AveragedRothCResult extends RothCResultItem {
  monthIndex: number;
  monthLabel: string;
  year: number;
  month: number;
  lower_SOC_stock_Mg_C_ha_1: number;
  upper_SOC_stock_Mg_C_ha_1: number;
  lower_SOC_content_percent_C_ha_1: number;
  upper_SOC_content_percent_C_ha_1: number;
}

export interface RothCResult {
  rotationId: string;
  startPosition: number;
  /** Request and monthly output of every simulation window, keyed "start-end". */
  intervals: Record<string, { input: unknown; output: RothCResultItem[] }>;
  averaged: AveragedRothCResult[];
}

// ---------------------------------------------------------------------------
// Scope 2: purchased electricity and heat per harvest year
// ---------------------------------------------------------------------------

export const SCOPE2_ELECTRICITY_KINDS = ['electricityGrid', 'electricityRenewable'] as const;
export const SCOPE2_HEATING_KINDS = [
  'heatingHeizoelDiesel',
  'heatingErdgas',
  'heatingFluessiggas',
  'heatingBiogas',
  'heatingPellets',
  'heatingBiomasseHolz',
  'heatingNahFernwaerme',
] as const;
export const SCOPE2_KINDS = [...SCOPE2_ELECTRICITY_KINDS, ...SCOPE2_HEATING_KINDS] as const;
export type Scope2Kind = (typeof SCOPE2_KINDS)[number];

export interface Scope2Parameter {
  id: string;
  name: string;
  /** kg CO2e per kWh. */
  value: number;
  unit: string;
  source: string;
}

export interface Scope2Year {
  harvestYear: number;
  entries: { kind: Scope2Kind; kwh: number; kgCo2e: number }[];
  /** kg CO2e of electricity only, and of electricity and heat. */
  electricityKg: number;
  totalKg: number;
}

export interface Scope2 extends Scope2Year {
  parameters: Record<Scope2Kind, Scope2Parameter>;
}

export const Scope2Input = z.object({
  harvestYear: z.int().min(1990).max(2200),
  entries: z
    .array(z.object({ kind: z.enum(SCOPE2_KINDS), kwh: z.number().min(0).max(1e9) }))
    .max(SCOPE2_KINDS.length)
    .refine((rows) => new Set(rows.map((r) => r.kind)).size === rows.length, { message: 'Each kind once' }),
});
export type Scope2Input = z.input<typeof Scope2Input>;
