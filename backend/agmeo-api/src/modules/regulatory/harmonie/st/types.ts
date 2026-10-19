/**
 * Sachsen-Anhalt Mitteilungspflicht (LLG, Stand 12/2025) — four tab-separated
 * TXT files per farm and Kalenderjahr: Anl5 (Nährstoffeinsatz Gesamtbetrieb),
 * Ertraege, DBE, Duengungen.
 *
 * Ported from agmeo `src/lib/federalExport/harmonie-export/st/types.ts`.
 */

export type StBewirtschaftung = 'k' | 'o';

export type StOrgMetadata = {
  betriebsname?: string;
  /** 12-digit EU-Betriebsnummer (Land 15 for a Betriebssitz in ST). */
  euBetriebsnummer?: string;
  sitzPlz?: string;
  sitzOrt?: string;
  sitzOrtsteil?: string;
  /** Anlage 3 Landkreis-Nummer (1–3, 81–91) */
  kreisNr?: number;
  bewirtschaftung?: StBewirtschaftung;
  /** Farms seated outside Sachsen-Anhalt deliver only DBE + Duengungen. */
  sitzInSt?: boolean;
  cropCodeOverrides?: Record<string, string>;
};

/** The farm columns every file starts with. */
export type StBetrieb = {
  betriebsname: string;
  euNummer: string;
  sitzPlz: string;
  sitzOrt: string;
  sitzOrtsteil: string;
  kreisNr: number;
  kreis: string;
  exportquelle: string;
  duengejahr: number;
};

export type StAnl5Row = StBetrieb & {
  ackerlandHa: number;
  gruenlandHa: number;
  betriebsgroesseHa: number;
  flaeche170Ha: number;
  bewirtschaftung: StBewirtschaftung;
  nBedarf: number;
  p2o5Bedarf: number;
  nMinDung: number;
  nTierDung: number;
  nVerfTierDung: number;
  nWeide: number;
  nSonstDung: number;
  nVerfSonstDung: number;
  nBodenHilf: number;
  nKulturSubstrat: number;
  nPflanzenHilf: number;
  nAbfall: number;
  nLegum: number;
  nSumme: number;
  nSummePerHa: number;
  nSummeVerf: number;
  p2o5MinDung: number;
  p2o5TierDung: number;
  p2o5Weide: number;
  p2o5SonstDung: number;
  p2o5BodenHilf: number;
  p2o5KulturSubstrat: number;
  p2o5PflanzenHilf: number;
  p2o5Abfall: number;
  p2o5Summe: number;
};

export type StErtragRow = StBetrieb & {
  bewirtschaftung: StBewirtschaftung;
  hf: string;
  hfNr: string;
  ertragFmBetrieb: number | null;
  ertragTmBetriebGl: number | null;
  ertragFmBetriebNg: number | null;
  ertragTmGlNg: number | null;
  andererErtrag: boolean;
  tatsErtrag: number | null;
};

export type StNutzung = 'AL' | 'GL' | 'so';

export type StSchlag = {
  datum: Date | null;
  feldblockId: string;
  parzelle: string;
  ng: boolean;
  phosphorgebiet: boolean;
  groesseHa: number;
  nutzung: StNutzung;
  bewirtschaftung: StBewirtschaftung;
  hf: string;
  hfNr: string;
};

export type StDbeRow = StBetrieb &
  StSchlag & {
    bg: number | null;
    az: number | null;
    vf: string;
    vfNr: string;
    zwfr: string;
    zwfrNr: string;
    nBedarfswertDuev: number | null;
    ertragFmDuev: number | null;
    ertragFmBetrieb: number | null;
    ertragFmDiff: number | null;
    ertragTmDuev: number | null;
    ertragTmBetrieb: number | null;
    ertragTmDiff: number | null;
    rpDuev: number | null;
    rpBetrieb: number | null;
    rpDiff: number | null;
    nminGesamt: number | null;
    nmin030: number | null;
    nmin3060: number | null;
    nmin6090: number | null;
    datenherkunftNmin060: 'U' | 'RW';
    datenherkunftNmin6090: 'U' | 'RW' | 'BER';
    zuAbNErtragDiff: number | null;
    zuAbNRpDiff: number | null;
    abNNachlBoden: number | null;
    abNNachlOd: number | null;
    abNNachlLeg: number | null;
    abNVf: number | null;
    abNZwfr: number | null;
    zuNAbdeckung: number | null;
    zuNNachtraeglich: number | null;
    bedarfNBerechnet: number | null;
    stickstoffnachlieferungWrwgh: number | null;
    p2o5Gehalt: number | null;
    pAnalyseDatum: Date | null;
    pMethode: 'CAL' | 'DL' | 'EUF' | '';
  };

export type StDuengungRow = StBetrieb &
  StSchlag & {
    zuordnung: string;
    kategorie: string;
    bezeichnung: string;
    /** t or m³ per ha */
    menge: number;
    mengeN: number;
    mengeNVerf: number;
    p2o5Menge: number;
    mengeNPerHa: number;
    mengeNVerfPerHa: number;
    p2o5MengePerHa: number;
    /** null = not an arable crop (column left empty) */
    istHerbstDuengung: boolean | null;
    weidetiere: number;
    weidetage: number;
  };

export type StExportModel = {
  /** null for farms seated outside Sachsen-Anhalt (Anl5 / Ertraege are not delivered). */
  anl5: StAnl5Row | null;
  ertraege: StErtragRow[] | null;
  dbe: StDbeRow[];
  duengungen: StDuengungRow[];
  betrieb: StBetrieb;
};
