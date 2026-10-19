/**
 * Shared types for the export modules (ENNI Niedersachsen, ENDO Schleswig-Holstein,
 * webBESyD Brandenburg / Sachsen / Sachsen-Anhalt / Thüringen, Sachsen-Anhalt
 * Mitteilungspflicht).
 *
 * Ported from agmeo `src/lib/federalExport/harmonie-export/types.ts`. `ExportData`
 * and its member types are kept identical to agmeo (only the crop type differs)
 * so the DB adapter can be written against the agmeo contract.
 */

import type { BesydOrgMetadata } from './besyd/types.js';
import type { EndoOrgMetadata } from './endo/types.js';
import type { EnniOrgMetadata } from './enni/types.js';
import type { N170Betriebsdaten } from './shared/n170Types.js';
import type { StOrgMetadata } from './st/types.js';

/**
 * agmeo crop key (co2calculator `SupportedCrops`, e.g. `winterWheat`,
 * `winterBarleyFodder`, `mustardIntercrop`). It is the crop vocabulary of the
 * Fruchtart catalogues; map system crop codes with `CROP_KEY_BY_CODE`
 * (cropKeys.ts) before building `ExportData`.
 */
export type AgmeoCropKey = string;

export type NaehrstofftraegerartType =
  'MINERALDUENGER' | 'WIRTSCHAFTSDUENGER' | 'SONSTIGE';

/** Dube2.5 `einheit-naehrstofftraeger` — the physical unit a fertilizer is documented in. */
export type CarrierUnit = 'kg / cbm' | 'kg / t' | 'kg / dt' | 'kg / hl';

export type FederalExportFormat = 'enni' | 'endo' | 'besyd' | 'st';

export type DuengejahrbeginnType =
  | 'JANUAR'
  | 'FEBRUAR'
  | 'MAERZ'
  | 'APRIL'
  | 'MAI'
  | 'JUNI'
  | 'JULI'
  | 'AUGUST'
  | 'SEPTEMBER'
  | 'OKTOBER'
  | 'NOVEMBER'
  | 'DEZEMBER';

export type Adresse = {
  vorname?: string;
  nachname?: string;
  firma?: string;
  strasse?: string;
  plz?: string;
  ort?: string;
  telefonnummer?: string;
  mobilnummer?: string;
  faxnummer?: string;
  email?: string;
};

export type Ansprechpartner = {
  adresse?: Adresse;
};

export type Betriebsstaette = {
  adresse?: Adresse;
};

export type Betrieb = {
  betriebsnummer: string;
  ansprechpartner?: Ansprechpartner;
  betriebsstaette?: Betriebsstaette;
};

export type Betriebsdaten = {
  'andere-duenger-ausgebracht': boolean;
  'kompost-ausgebracht': boolean;
  'duengungs-oder-beweidungseinschraenkungen': boolean;
  'oekologisch-zertifiziert'?: boolean;
};

export type Duengung = {
  aufbringdatum: string;
  'duenger-bezeichnung'?: string;
  'duenger-bezeichnung-betrieb': string;
  naehrstofftraegerart: NaehrstofftraegerartType;
  'menge-in-einheit-naehrstofftraeger-pro-ha': string;
  mistduengung?: boolean;
};

/** Dube2.5 `bodenuntersuchung` (both dialects; `gehalt-p` is mandatory in ENNI, `gehalt-p2o5` in ENDO). */
export type Bodenuntersuchung = {
  analysedatum: string;
  analysenr: string;
  bodenartgruppe: string;
  humusklasse: HumusklasseType;
  'gehalt-p'?: string;
  'gehalt-p2o5'?: string;
  'gehalt-k'?: string;
  'gehalt-k2o'?: string;
  'gehalt-mg'?: string;
  'gehalt-mgo'?: string;
  humusgehalt?: string;
  'ph-wert'?: string;
  labor?: string;
};

export type HumusklasseType =
  | 'HUMUSARM'
  | 'STARK_HUMOS'
  | 'SEHR_STARK_HUMOS'
  | 'ANMOORIG'
  | 'HOCHMOOR'
  | 'NIEDERMOOR';

/** Dube2.5 `duenger` — one entry of the farm fertilizer catalogue (`dokumentation-der-duengung`). */
export type Duenger = {
  'duenger-bezeichnung': string;
  'duenger-bezeichnung-betrieb'?: string;
  naehrstofftraegerart: NaehrstofftraegerartType;
  dunggruppe?: string;
  mineralduengergruppe?: string;
  'art-der-werte': 'STANDARD' | 'ANALYSE';
  einheit: CarrierUnit;
  'gehalt-P2O5': string;
  'gehalt-NH4'?: string;
  'gehalt-N-gesamt': string;
  /** kg N per carrier unit available in the year of application (DüV Anlage 3 Mindestwirksamkeit). */
  'verfuegbar-N'?: string;
  'anteil-trockensubstanz'?: string;
};

export type MissingField = {
  key: string;
  label: string;
  type: 'text' | 'select' | 'boolean';
  options?: { value: string; label: string }[];
  defaultValue?: string | boolean;
};

export type MissingCropMapping = {
  cropName: string;
  cultivationCount: number;
};

export type PreflightSeverity = 'blocking' | 'warning' | 'info';

export type PreflightStage =
  'xsd' | 'pflichtfelder' | 'stammdaten' | 'eingaberoutinen' | 'plausibilitaet';

/**
 * One finding of the export preflight. `code` is stable and translated at the
 * UI boundary (`exportValidation.<code>`); `params` carries the values the
 * message interpolates.
 */
export type PreflightIssue = {
  code: string;
  severity: PreflightSeverity;
  stage: PreflightStage;
  scope: 'betrieb' | 'field' | 'cultivation' | 'fertilization';
  fieldId?: string;
  fieldName?: string;
  cultivationId?: string;
  value?: string;
  params?: Record<string, string | number>;
};

export type PreflightResult = {
  isValid: boolean;
  missingFields: MissingField[];
  missingCropMappings: MissingCropMapping[];
  issues: PreflightIssue[];
};

export type IntegrationsMetadata = {
  enni?: EnniOrgMetadata;
  endo?: EndoOrgMetadata;
  besyd?: BesydOrgMetadata;
  /** Sachsen-Anhalt Mitteilungspflicht (LLG). */
  st?: StOrgMetadata;
  /** Organic-N (170 N) farm data per Düngejahr — shared by ENNI and ENDO. */
  n170?: Record<string, N170Betriebsdaten>;
};

export type DuengejahrWindow = {
  year: number;
  beginn: DuengejahrbeginnType;
  start: Date;
  end: Date;
};

export type ExportData = {
  orgId: string;
  year: number;
  duengejahr: DuengejahrWindow;
  /** Two-letter German federal state (NI, SH, BB, …) resolved from the fields' FLIKs; null when unknown. */
  federalState: string | null;
  integrations: IntegrationsMetadata;
  fields: ExportField[];
};

export type ExportField = {
  id: string;
  name: string;
  areaInHa: number;
  parcelId: string | null;
  flik: string | null;
  soilTypeLufa: string | null;
  nitrateSensitiveZone: boolean;
  /** Topsoil lab/user samples, newest first. */
  soilSamples: ExportSoilSample[];
  cultivations: ExportCultivation[];
};

export type ExportSoilSample = {
  date: Date;
  layerFrom: number;
  layerTo: number;
  method: string | null;
  ph: number | null;
  /** mg P2O5 / 100 g */
  p2o5: number | null;
  /** mg K2O / 100 g */
  k2o: number | null;
  /** mg MgO / 100 g */
  mgo: number | null;
  /** % */
  humus: number | null;
  /** % */
  nt: number | null;
  /** % */
  soc: number | null;
};

export type ExportCropRole = 'MAIN' | 'INTERCROP' | 'UNDERSOW';

export type ExportHarvest = {
  date: Date;
  yieldDtPerHa: number;
  proteinPercent: number | null;
};

export type ExportNmin = {
  date: Date | null;
  kgPerHa: number;
  layers: { from: number; to: number; value: number }[];
  source: 'lab' | 'planning';
};

export type ExportCultivation = {
  cultivationId: string;
  cultivationGroupId: string;
  crop: AgmeoCropKey;
  areaInHa: number;
  cropRole: ExportCropRole;
  /**
   * Next year's cultivation on this field, present only for its applications
   * dated inside this Düngejahr (autumn fertilization of a winter crop booked
   * on the following cultivation). Filed as Fruchtklasse HERBSTANSAAT of the
   * export year; carries no harvest, Nmin or DBE of its own.
   */
  herbstansaat?: true;
  sowingDate: Date | null;
  harvest: ExportHarvest | null;
  previousCrop: AgmeoCropKey | null;
  previousCropSowingDate: Date | null;
  previousCropYieldDtPerHa: number | null;
  nmin: ExportNmin | null;
  filmOrFleece: boolean;
  /** Fertilizations that exist but fall outside the Düngejahr window. */
  droppedFertilizationCount: number;
  /** Dates of those fertilizations, oldest first — the preflight says which Düngejahr they belong to. */
  droppedFertilizationDates: Date[];
  fertilizations: ExportFertilization[];
  /** Fertilizations whose nutrient amounts could not be derived (unknown unit / density). */
  failedFertilizations: ExportFertilizationFailure[];
  /** Grassland use — agmeo records neither yet; filled once a data source exists. */
  cuts?: number;
  grazingSharePercent?: number;
  grazing?: ExportGrazing[];
};

/** Grazing on a cultivation (BESyD IMPWEIDE, DüV Anlage 5 Weidehaltung). */
export type ExportGrazing = {
  /** BESyD Tabelle 22: 1 Rind, 2 Schwein, 4 Geflügel, 9 Sonstige */
  animalGroup: '1' | '2' | '4' | '9';
  /** BESyD Tabelle 23 Tierart code; null when unknown */
  animalCode: string | null;
  animalName: string;
  animals: number;
  days: number;
  nKgPerAnimalDay: number | null;
  p2o5KgPerAnimalDay: number | null;
  endDate: Date | null;
};

export type ExportFertilizationFailure = {
  articleFqn: string;
  fertilizerName: string;
  quantity: number;
  unit: string;
  reason: string;
};

export type ExportFertilization = {
  date: Date;
  articleId: string;
  articleFqn: string;
  fertilizerName: string;
  /** Application rate as recorded on the transaction (averaged over the cultivation area). */
  quantity: number;
  unit: string;
  fqnPrefix: string;
  articleCategory: string | null;
  isCustomArticle: boolean;
  naehrstofftraegerart: NaehrstofftraegerartType;
  isMistDuengung: boolean;
  /** Nutrients applied per cultivation hectare; nh4/p2o5/k2o are null when the article carries no value. */
  nKgPerHa: number;
  nh4KgPerHa: number | null;
  p2o5KgPerHa: number | null;
  k2oKgPerHa: number | null;
  /**
   * Raw article contents: % (mass percent = kg per dt) for mineral products,
   * kg/m³ for organic ones. This contract is shared with agmeo — do not change
   * the units here; the carrier resolution (shared/carrier.ts) relies on it.
   */
  n: number | null;
  nh4: number | null;
  p2o5: number | null;
  k: number | null;
  k2o: number | null;
  mgo: number | null;
  dryMatterContent: number | null;
  /**
   * Article.convTtoCbm — m³ per t of the product (the INVERSE density: 1 t of
   * slurry at 1.05 t/m³ occupies 0.952 m³), NOT t/m³. null when unknown.
   */
  density: number | null;
  /**
   * Unit the product is documented in (Dube2.5 `einheit`), the application
   * amount in that unit per ha, and the contents per one such unit (kg).
   */
  carrierUnit: CarrierUnit;
  carrierAmountPerHa: number;
  nPerCarrierUnit: number | null;
  nh4PerCarrierUnit: number | null;
  p2o5PerCarrierUnit: number | null;
  k2oPerCarrierUnit: number | null;
  mgoPerCarrierUnit: number | null;
};
