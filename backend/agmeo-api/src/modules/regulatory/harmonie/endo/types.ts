import type { N170Model } from '../shared/n170Builder.js';
import type {
  Ansprechpartner,
  Betrieb,
  Betriebsdaten,
  Betriebsstaette,
  Bodenuntersuchung,
  DuengejahrbeginnType,
  Duenger,
  Duengung,
  PreflightResult,
} from '../types.js';

// ENDO uses ERSTEFRUCHT/ZWEITEFRUCHT instead of HAUPTFRUCHT/ZWEITFRUCHT
export type EndoFruchtklasseType =
  | 'VORFRUCHT-ACKERBAU'
  | 'VORFRUCHT-GARTENBAU'
  | 'VORFRUCHT-GRUENLAND'
  | 'VORFRUCHT-KA'
  | 'HERBSTANSAAT'
  | 'ERSTEFRUCHT'
  | 'ZWEITEFRUCHT'
  | 'GRUENLAND'
  | 'GARTENBAU'
  | 'GARTENBAU-VORFRUCHT-ACKERBAU'
  | 'GARTENBAU-VORFRUCHT-GRUENLAND'
  | 'GARTENBAU-VORFRUCHT-GARTENBAU'
  | 'GARTENBAU-VORFRUCHT-KA';

export type EndoErnterueckstandType =
  | 'VERBLEIBT'
  | 'ABGEFAHREN'
  | 'ABGEFROREN'
  | 'NICHT_ABGEFROREN_EINARBEITUNG_FRUEHJAHR'
  | 'NICHT_ABGEFROREN_EINARBEITUNG_HERBST';

export type EndoAnbau = {
  aussaattermin?: string;
  'anbau-im-fremdbetrieb'?: boolean;
  'lfd-nr'?: number;
  fruchtart?: string;
  'fruchtart-bezeichnung'?: string;
  fruchtklasse?: EndoFruchtklasseType;
  vorfruchtart?: string;
  kulturfolge?: number;
  anbauflaeche?: string;
  bezugszeitraum?: string;
  'n-min'?: string;
  'nmin-probenahmetiefe'?: string;
  ernterueckstand?: EndoErnterueckstandType;
  ertrag?: string;
  'rp-gehalt-prozent'?: string;
  folie?: boolean;
  duengungen?: Duengung[];
};

export type EndoDuengejahrbeginnType = DuengejahrbeginnType;

// Extended nutzungsart options per ENDO XSD
export type EndoNutzungsartType =
  | 'ACKER'
  | 'GRUENLAND'
  | 'GARTENBAU'
  | 'ACKER-GARTENBAU'
  | 'ACKER-GRUENLAND'
  | 'GRUENLAND-GARTENBAU'
  | 'KEINE-AUFZEICHNUNGSPFLICHT';

// Schleswig-Holstein natural regions (umlaut per XSD)
export type EndoNaturraumType = 'Marsch' | 'Geest' | 'Hügelland';

// ENDO Schlag — uses naturraum instead of bodenklimaraum, no kulisse-alt fields
export type EndoSchlag = {
  schlagnummer: string;
  schlagname: string;
  naturraum?: EndoNaturraumType;
  flaeche: string;
  flik?: string;
  nutzungsart: EndoNutzungsartType;
  'n-kulisse'?: boolean;
  'p-kulisse'?: boolean;
  bodenuntersuchungen?: Bodenuntersuchung[];
  /** Absent for a Schlag without cultivation in the Düngejahr (`KEINE-AUFZEICHNUNGSPFLICHT`). */
  anbauten?: EndoAnbau[];
};

export type EndoDuengebedarf = {
  bezugsjahr: string;
  duengejahrbeginn: EndoDuengejahrbeginnType;
  betriebsdaten: Betriebsdaten;
  schlaege: EndoSchlag[];
};

// ENDO root has no softwarehersteller/datenherkunft
export type EndoExportModel = {
  betrieb: Betrieb;
  duengebedarf: EndoDuengebedarf;
  dokumentationDerDuengung: Duenger[];
  n170: N170Model;
};

export type EndoOrgMetadata = {
  betriebsnummer?: string;
  duengejahrbeginn?: EndoDuengejahrbeginnType;
  naturraum?: EndoNaturraumType;
  betriebsdatenOverrides?: Partial<Betriebsdaten>;
  cropCodeOverrides?: Record<string, string>;
  ansprechpartner?: Ansprechpartner;
  betriebsstaette?: Betriebsstaette;
};

export type EndoPreflightResult = PreflightResult;

export type EndoExportRequest = {
  year: number;
  userInputs?: {
    betriebsnummer?: string;
    duengejahrbeginn?: EndoDuengejahrbeginnType;
    naturraum?: EndoNaturraumType;
    betriebsdaten?: Partial<Betriebsdaten>;
    cropCodeOverrides?: Record<string, string>;
    ansprechpartner?: Ansprechpartner;
    betriebsstaette?: Betriebsstaette;
  };
};

export type EndoExportResponse =
  | { success: true; xml: string; filename: string }
  | { success: false; preflight: EndoPreflightResult };
