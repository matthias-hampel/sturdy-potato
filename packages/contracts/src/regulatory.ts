import { z } from 'zod';
import { amount, id, isoDate, shortText } from './common.js';

/** German federal states (Länder). */
export const FEDERAL_STATES = ['BW', 'BY', 'BE', 'BB', 'HB', 'HH', 'HE', 'MV', 'NI', 'NW', 'RP', 'SL', 'SN', 'ST', 'SH', 'TH'] as const;
export type FederalState = (typeof FEDERAL_STATES)[number];

export const FEDERAL_STATE_NAMES: Record<FederalState, string> = {
  BW: 'Baden-Württemberg',
  BY: 'Bayern',
  BE: 'Berlin',
  BB: 'Brandenburg',
  HB: 'Bremen',
  HH: 'Hamburg',
  HE: 'Hessen',
  MV: 'Mecklenburg-Vorpommern',
  NI: 'Niedersachsen',
  NW: 'Nordrhein-Westfalen',
  RP: 'Rheinland-Pfalz',
  SL: 'Saarland',
  SN: 'Sachsen',
  ST: 'Sachsen-Anhalt',
  SH: 'Schleswig-Holstein',
  TH: 'Thüringen',
};

/** First month of the fertilizer year (Düngejahr), as the authority formats name it. */
export const FERTILIZER_YEAR_STARTS = ['JANUAR', 'FEBRUAR', 'MAERZ', 'APRIL', 'MAI', 'JUNI', 'JULI', 'AUGUST', 'SEPTEMBER', 'OKTOBER', 'NOVEMBER', 'DEZEMBER'] as const;
export type FertilizerYearStart = (typeof FERTILIZER_YEAR_STARTS)[number];

/** Boden-Klima-Räume accepted by ENNI (Niedersachsen). */
export const ENNI_SOIL_CLIMATE_AREAS = ['BKR_9', 'BKR_11', 'BKR_34', 'BKR_45', 'BKR_46', 'BKR_47', 'BKR_48', 'BKR_50', 'BKR_51', 'BKR_52'] as const;
/** Naturräume of Schleswig-Holstein (ENDO). */
export const ENDO_NATURAL_REGIONS = ['Marsch', 'Geest', 'Hügelland'] as const;

const contact = z.object({
  firma: shortText,
  vorname: shortText,
  nachname: shortText,
  strasse: shortText,
  plz: z.string().trim().max(10).nullish(),
  ort: shortText,
  telefonnummer: shortText,
  email: z.string().trim().max(200).nullish(),
});
export type RegulatoryContact = z.input<typeof contact>;

export const FarmRegulatoryInput = z.object({
  holdingNumber: z
    .string()
    .trim()
    .regex(/^[0-9]{6,20}$/, 'Digits only')
    .nullish(),
  federalState: z.enum(FEDERAL_STATES).nullish(),
  fertilizerYearStart: z.enum(FERTILIZER_YEAR_STARTS).default('JANUAR'),
  organicCertified: z.boolean().default(false),
  /** Niedersachsen: Boden-Klima-Raum; file the Nitratkulisse flag of the fields. */
  enni: z.object({ soilClimateArea: z.enum(ENNI_SOIL_CLIMATE_AREAS).nullish(), nitrateZoneFlag: z.boolean().default(false) }).default({ nitrateZoneFlag: false }),
  /** Schleswig-Holstein: Naturraum. */
  endo: z.object({ naturalRegion: z.enum(ENDO_NATURAL_REGIONS).nullish() }).default({}),
  contact: contact.default({}),
  /** Fertilizers other than mineral and manure, compost, restrictions on fertilization or grazing. */
  otherFertilizersApplied: z.boolean().default(false),
  compostApplied: z.boolean().default(false),
  restrictions: z.boolean().default(false),
});
export type FarmRegulatoryInput = z.input<typeof FarmRegulatoryInput>;
export type FarmRegulatory = z.output<typeof FarmRegulatoryInput> & { farmId: string; farmName: string };

// ---------------------------------------------------------------------------
// Annual totals (DüV Anlage 5) and 170 kg N
// ---------------------------------------------------------------------------

/** Organic fertilizers of animal origin vs. other organic (digestate of plant origin, compost, sludge). */
export type NutrientGroup = 'mineral' | 'manure' | 'other_organic';

export interface NutrientGroupTotals {
  /** kg total N */
  n: number;
  /** kg N available in the year of application (DüV Anlage 3). */
  availableN: number;
  /** kg P2O5 */
  p2o5: number;
}

export interface FieldAnnualTotals {
  fieldId: string;
  fieldName: string;
  areaHa: number;
  grassland: boolean;
  /** kg per hectare by group. */
  perHa: Record<NutrientGroup, NutrientGroupTotals>;
  total: NutrientGroupTotals;
  /** N need of the fertilizer-need records of the year's crops, kg N/ha (area-weighted). */
  nNeed: number | null;
}

export interface AnnualTotals {
  farmId: string;
  year: number;
  window: { from: string; to: string };
  fields: FieldAnnualTotals[];
  /** Farm totals in kg. */
  farm: Record<NutrientGroup, NutrientGroupTotals> & { total: NutrientGroupTotals; areaHa: number };
  /** Applications without nutrient data (no contents or no density), counted, not guessed. */
  unknownApplications: number;
}

export const N170Input = z.object({
  farmId: id,
  year: z.int().min(1990).max(2200),
  livestock: z
    .array(z.object({ name: z.string().trim().min(1).max(120), animals: amount, nPerAnimalYear: amount, grazingDays: z.int().min(0).max(366).nullish() }))
    .max(50)
    .default([]),
  intake: z.array(z.object({ name: z.string().trim().min(1).max(120), date: isoDate, from: shortText, quantity: amount, nPerUnit: amount, p2o5PerUnit: amount.nullish() })).max(200).default([]),
  delivery: z.array(z.object({ name: z.string().trim().min(1).max(120), date: isoDate, to: shortText, quantity: amount, nPerUnit: amount, p2o5PerUnit: amount.nullish() })).max(200).default([]),
  onFarmBiogasPlant: z.boolean().default(false),
});
export type N170Input = z.input<typeof N170Input>;
export type N170Data = z.output<typeof N170Input>;

export interface N170Balance {
  farmId: string;
  year: number;
  data: N170Data;
  /** Area the limit refers to (agricultural area of the farm), ha. */
  areaHa: number;
  /** kg N from organic and organic-mineral fertilizers applied, from the records. */
  appliedOrganicN: number;
  /** kg N excreted by the farm's livestock (entered). */
  livestockN: number;
  intakeN: number;
  deliveryN: number;
  /** kg N/ha organic N on the farm's area: applied, or excreted + intake − delivery when higher. */
  perHa: number;
  limit: 170;
  exceeded: boolean;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export const EXPORT_FORMATS = ['enni', 'endo', 'agrarantrag'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export interface PreflightIssue {
  code: string;
  severity: 'blocking' | 'warning' | 'info';
  scope: 'farm' | 'field' | 'crop' | 'fertilization';
  fieldName?: string;
  params?: Record<string, string | number>;
  message: string;
}

export interface ExportPreflight {
  format: ExportFormat;
  farmId: string;
  year: number;
  /** No blocking issue. */
  ready: boolean;
  issues: PreflightIssue[];
  fileName: string;
}

/** Subsidy application (Agrarantrag) portals: column names and reference system per state. */
export const AGRARANTRAG_PRESETS = ['NI', 'NW', 'BW', 'BY', 'SN', 'MV', 'TH'] as const;
export type AgrarantragPreset = (typeof AGRARANTRAG_PRESETS)[number];

export const LandUseCodeInput = z.object({ landUseCode: z.string().trim().max(5).nullable() });

export interface LandUseCode {
  code: string;
  name: string;
  productive: boolean;
}
