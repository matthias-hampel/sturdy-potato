/**
 * ENNI-specific types for XML export (Lower Saxony)
 * Based on ENNI 2025 XSD Schema (Dube2.5)
 */

import type { N170Model } from '../shared/n170Builder.js';
import type {
  Ansprechpartner,
  Betrieb,
  Betriebsdaten,
  Betriebsstaette,
  Bodenuntersuchung,
  DuengejahrbeginnType,
  Duenger,
  NaehrstofftraegerartType,
  PreflightResult,
} from '../types.js';

export type { DuengejahrbeginnType };

export type NutzungsartType =
  | 'ACKER'
  | 'GRUENLAND'
  | 'GARTENBAU'
  | 'ACKER-GARTENBAU'
  | 'KEINE-AUFZEICHNUNGSPFLICHT';

export type FruchtklasseType =
  | 'VORFRUCHT-ACKERBAU'
  | 'VORFRUCHT-GARTENBAU'
  | 'VORFRUCHT-GRUENLAND'
  | 'VORFRUCHT-KA'
  | 'HERBSTANSAAT'
  | 'HAUPTFRUCHT'
  | 'ZWEITFRUCHT'
  | 'GRUENLAND'
  | 'GARTENBAU'
  | 'GARTENBAU-VORFRUCHT-ACKERBAU'
  | 'GARTENBAU-VORFRUCHT-GRUENLAND'
  | 'GARTENBAU-VORFRUCHT-GARTENBAU'
  | 'GARTENBAU-VORFRUCHT-KA';

export type ErnterueckstandType =
  | 'VERBLEIBT'
  | 'ABGEFAHREN'
  | 'ABGEFROREN'
  | 'NICHT_ABGEFROREN_EINARBEITUNG_FRUEHJAHR'
  | 'NICHT_ABGEFROREN_EINARBEITUNG_HERBST';

/** Lower Saxony Boden-Klima-Räume accepted by the ENNI XSD. */
export const ENNI_BODENKLIMARAUM_CODES = [
  'BKR_9',
  'BKR_11',
  'BKR_34',
  'BKR_45',
  'BKR_46',
  'BKR_47',
  'BKR_48',
  'BKR_50',
  'BKR_51',
  'BKR_52',
] as const;
export type EnniBodenklimaraum = (typeof ENNI_BODENKLIMARAUM_CODES)[number];

export type EnniDuengung = {
  aufbringdatum: string;
  'duenger-bezeichnung': string;
  'duenger-bezeichnung-betrieb': string;
  naehrstofftraegerart: NaehrstofftraegerartType;
  'menge-in-einheit-naehrstofftraeger-pro-ha': string;
  mistduengung: boolean;
};

export type EnniAnbau = {
  fruchtklasse: FruchtklasseType;
  'lfd-nr': number;
  fruchtart?: string;
  'fruchtart-bezeichnung'?: string;
  bezugszeitraum: string;
  aussaattermin?: string;
  vorfruchtart?: string;
  kulturfolge?: number;
  anbauflaeche?: string;
  'n-min'?: string;
  'nmin-probenahmetiefe'?: string;
  'n-min-vor-mehr-als-4-wochen'?: string;
  ertrag?: string;
  'rp-gehalt-prozent'?: string;
  ernterueckstand?: ErnterueckstandType;
  folie?: boolean;
  'anbau-im-fremdbetrieb'?: boolean;
  duengungen?: EnniDuengung[];
};

export type EnniSchlag = {
  schlagnummer: string;
  schlagname: string;
  bodenklimaraum?: string;
  flaeche: string;
  flik?: string;
  nutzungsart: NutzungsartType;
  'n-kulisse'?: boolean;
  'n-kulisse-alt'?: boolean;
  'p-kulisse'?: boolean;
  'p-kulisse-alt'?: boolean;
  bodenuntersuchungen?: Bodenuntersuchung[];
  /** Absent for a Schlag without cultivation in the Düngejahr (`KEINE-AUFZEICHNUNGSPFLICHT`). */
  anbauten?: EnniAnbau[];
};

export type EnniDuengebedarf = {
  bezugsjahr: string;
  duengejahrbeginn: DuengejahrbeginnType;
  betriebsdaten: Betriebsdaten;
  schlaege: EnniSchlag[];
};

export type EnniExportModel = {
  softwarehersteller: string;
  datenherkunft: string;
  betrieb: Betrieb;
  duengebedarf: EnniDuengebedarf;
  dokumentationDerDuengung: Duenger[];
  n170: N170Model;
};

export type EnniOrgMetadata = {
  betriebsnummer?: string;
  duengejahrbeginn?: DuengejahrbeginnType;
  bodenklimaraum?: EnniBodenklimaraum;
  /** File the fields' Nitratkulisse flag (`n-kulisse`); off by default while §13a is unenforced. */
  nKulisse?: boolean;
  betriebsdatenOverrides?: Partial<Betriebsdaten>;
  cropCodeOverrides?: Record<string, string>;
  ansprechpartner?: Ansprechpartner;
  betriebsstaette?: Betriebsstaette;
};

export type EnniExportRequest = {
  year: number;
  userInputs?: {
    betriebsnummer?: string;
    duengejahrbeginn?: DuengejahrbeginnType;
    bodenklimaraum?: EnniBodenklimaraum;
    nKulisse?: boolean;
    betriebsdaten?: Partial<Betriebsdaten>;
    cropCodeOverrides?: Record<string, string>;
    ansprechpartner?: Ansprechpartner;
    betriebsstaette?: Betriebsstaette;
  };
};

export type EnniPreflightResult = PreflightResult;

export type EnniExportResponse =
  | { success: true; xml: string; filename: string }
  | { success: false; preflight: EnniPreflightResult };
