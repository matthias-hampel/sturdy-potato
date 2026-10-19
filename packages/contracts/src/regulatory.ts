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

/** Authority codes per crop or fertilizer key; an empty value is ignored. */
const codeOverrides = z.record(z.string().trim().min(1).max(120), z.string().trim().max(20));

/** webBESyD (Brandenburg, Sachsen, Sachsen-Anhalt, Thüringen): Berechnungsgrundlage. */
export const BESYD_BERECHNUNGSGRUNDLAGEN = ['DV', 'ÖL'] as const;
/** Sachsen-Anhalt Mitteilungspflicht: konventionell / ökologisch. */
export const ST_BEWIRTSCHAFTUNGEN = ['k', 'o'] as const;

/**
 * webBESyD farm data. The Betriebsnummer is `euHoldingNumber`, the address comes from `contact`.
 * `cropCodeOverrides` is keyed by the crop key a `missing_crop_mapping` finding names
 * (`params.cropKey`), the fertilizer overrides by the article key of the application
 * (`ORGANIC__SLURRY_CATTLE`, `MINERAL__CAN`, …).
 */
export const BesydFarmData = z.object({
  /** DV konventionell, ÖL ökologisch; unset → derived from `organicCertified`. */
  berechnungsgrundlage: z.enum(BESYD_BERECHNUNGSGRUNDLAGEN).nullish(),
  /** BESyD Tabelle 4 Boden-Klima-Raum code of the farm's Bundesland (see the code lists). */
  bodenklimaraum: z.string().trim().regex(/^[0-9]{3}$/, 'Three digits').nullish(),
  /** Tabelle 2 Amt (Sachsen only; 99 = Amt allgemein). */
  amt: z.string().trim().regex(/^[0-9]{1,2}$/, 'Digits only').nullish(),
  cropCodeOverrides: codeOverrides.optional(),
  organicFertilizerCodeOverrides: codeOverrides.optional(),
  mineralFertilizerCodeOverrides: codeOverrides.optional(),
});
export type BesydFarmData = z.input<typeof BesydFarmData>;

/**
 * Sachsen-Anhalt Mitteilungspflicht farm data. The EU-Betriebsnummer is `euHoldingNumber`;
 * Betriebsname, PLZ and Ort of the Betriebssitz come from `contact` (firma, plz, ort).
 */
export const StFarmData = z.object({
  sitzOrtsteil: shortText,
  /** Anlage 3 Landkreis number (1–3, 81–91, see the code lists). */
  kreisNr: z.int().min(1).max(99).nullish(),
  /** k konventionell, o ökologisch; unset → derived from `organicCertified`. */
  bewirtschaftung: z.enum(ST_BEWIRTSCHAFTUNGEN).nullish(),
  /** Farms seated outside Sachsen-Anhalt deliver only the DBE and Duengungen files. */
  sitzInSt: z.boolean().default(true),
  cropCodeOverrides: codeOverrides.optional(),
});
export type StFarmData = z.input<typeof StFarmData>;

export const FarmRegulatoryInput = z.object({
  holdingNumber: z
    .string()
    .trim()
    .regex(/^[0-9]{6,20}$/, 'Digits only')
    .nullish(),
  /**
   * The 12-digit Betriebsnummer of webBESyD and the Sachsen-Anhalt Mitteilung (Land key 12 BB,
   * 14 SN, 15 ST, 16 TH + 10 digits); `holdingNumber` stays the 15-digit 276… number of ENNI/ENDO.
   * Left out → unchanged, null → removed.
   */
  euHoldingNumber: z
    .string()
    .trim()
    .regex(/^[0-9]{12}$/, 'Twelve digits')
    .nullish(),
  federalState: z.enum(FEDERAL_STATES).nullish(),
  fertilizerYearStart: z.enum(FERTILIZER_YEAR_STARTS).default('JANUAR'),
  organicCertified: z.boolean().default(false),
  /** Niedersachsen: Boden-Klima-Raum; file the Nitratkulisse flag of the fields. */
  enni: z
    .object({ soilClimateArea: z.enum(ENNI_SOIL_CLIMATE_AREAS).nullish(), nitrateZoneFlag: z.boolean().default(false), cropCodeOverrides: codeOverrides.optional() })
    .default({ nitrateZoneFlag: false }),
  /** Schleswig-Holstein: Naturraum. */
  endo: z.object({ naturalRegion: z.enum(ENDO_NATURAL_REGIONS).nullish(), cropCodeOverrides: codeOverrides.optional() }).default({}),
  /** webBESyD (BB, SN, ST, TH). Left out → unchanged. */
  besyd: BesydFarmData.optional(),
  /** Sachsen-Anhalt Mitteilungspflicht. Left out → unchanged. */
  st: StFarmData.optional(),
  contact: contact.default({}),
  /** Fertilizers other than mineral and manure, compost, restrictions on fertilization or grazing. */
  otherFertilizersApplied: z.boolean().default(false),
  compostApplied: z.boolean().default(false),
  restrictions: z.boolean().default(false),
});
export type FarmRegulatoryInput = z.input<typeof FarmRegulatoryInput>;
export type FarmRegulatory = Omit<z.output<typeof FarmRegulatoryInput>, 'euHoldingNumber' | 'besyd' | 'st'> & {
  farmId: string;
  farmName: string;
  euHoldingNumber: string | null;
  besyd: z.output<typeof BesydFarmData>;
  st: z.output<typeof StFarmData>;
};

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

/** Fertilization reports to the authorities, in the order a farm is offered them. */
export const FEDERAL_EXPORT_FORMATS = ['enni', 'endo', 'st', 'besyd'] as const;
/** enni Niedersachsen, endo Schleswig-Holstein, st Sachsen-Anhalt Mitteilungspflicht, besyd webBESyD (BB, SN, ST, TH). */
export type FederalExportFormat = (typeof FEDERAL_EXPORT_FORMATS)[number];

export const EXPORT_FORMATS = ['enni', 'endo', 'besyd', 'st', 'agrarantrag'] as const;
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

/** Where a format's file goes and who answers questions (agmeo formatCatalog). */
export interface ExportUploadGuide {
  fileType: 'xml' | 'zip';
  /** Authority portal the file is uploaded to; absent when the files are e-mailed. */
  portalUrl?: string;
  /** Mailbox the files are sent to (Sachsen-Anhalt). */
  email?: string;
  hotline?: string;
  contactEmail?: string;
}

export interface RegulatoryFormatOffer {
  format: FederalExportFormat;
  /** End of the reporting deadline (Europe/Berlin 23:59:59) for the report year, ISO; null without a Meldepflicht (webBESyD). */
  deadline: string | null;
  upload: ExportUploadGuide;
}

/** GET regulatory/region: the Bundesland a farm reports in and the formats offered there. */
export interface RegulatoryRegion {
  farmId: string;
  year: number;
  /** Null when neither the farm nor its fields' FLIKs name a state. */
  federalState: FederalState | null;
  /** farm: stored on the farm; flik: majority of the active fields' FLIK prefixes. */
  source: 'farm' | 'flik' | null;
  /** Share of the farm's active fields whose FLIK names a state (0–1); the FLIK majority counts from 0.5. */
  flikCoverage: number;
  formats: RegulatoryFormatOffer[];
}

/** One archived export in the organization's Files (system folder "exports"); download via files/:id/content. */
export interface RegulatoryExportFile {
  id: string;
  name: string;
  format: ExportFormat | null;
  sizeBytes: number;
  createdAt: string;
}

export interface RegulatoryCodeOption {
  code: string;
  name: string;
}

/** GET regulatory/code-lists: the authority code lists the farm-data forms and overrides choose from (ENNI/ENDO: crops only). */
export interface RegulatoryCodeLists {
  format: FederalExportFormat;
  /** BESyD Tabelle 4, filtered by `state` when given. */
  bodenklimaraum: (RegulatoryCodeOption & { states: FederalState[] })[];
  /** BESyD Tabelle 2 (Sachsen). */
  amt: RegulatoryCodeOption[];
  /** Sachsen-Anhalt Anlage 3. */
  kreise: { nr: number; name: string }[];
  /** Fruchtart catalogue of the format (crop code overrides). */
  crops: (RegulatoryCodeOption & { category: string })[];
  /** BESyD Tabelle 15 organic fertilizer codes (organic fertilizer overrides). */
  organicFertilizers: RegulatoryCodeOption[];
  /** BESyD mineral fertilizer group codes (mineral fertilizer overrides). */
  mineralFertilizerGroups: RegulatoryCodeOption[];
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
