/**
 * TypeScript types for BESyD export
 * Based on webBESyD import interface documentation
 *
 * Ported from agmeo `src/lib/federalExport/harmonie-export/besyd/types.ts`.
 */

import type {
  MissingCropMapping,
  MissingField,
  PreflightResult,
} from '../types.js';

export const BESYD_FIELD_SEPARATOR = ';';
export const BESYD_TEXT_DELIMITER = '\u201E'; // German opening quote „

export type BesydBundesland = '12' | '14' | '15' | '16';

export const BESYD_BUNDESLAND_NAMES: Record<BesydBundesland, string> = {
  '12': 'Brandenburg',
  '14': 'Sachsen',
  '15': 'Sachsen-Anhalt',
  '16': 'Thüringen',
};

export type Berechnungsgrundlage = 'DV' | 'ÖL';

// === Row types for each table ===

export type ImpBetrRow = {
  BNR: string;
  BNAME?: string;
  PLZ?: string;
  ORT?: string;
  STR?: string;
  AMTCODEN?: string;
  BFCODE: Berechnungsgrundlage;
  BKR_NR?: string;
  EMAIL?: string;
};

export type ImpAnbauRow = {
  BNR: string;
  FSTNR: string;
  SNR: string;
  EJAHR: number;
  SNAME?: string;
  FLHA?: number;
  FELDBLOCK?: string;
  AZ?: number;
  BCODE?: string;
  ECODE?: string;
  BOTI?: number;
  HNN?: number;
  STK?: number;
  WSGCODE?: string;
  BKR_NR?: string;
  HUMUS_EINST?: string;
  DATUMVF: string;
  VFRUCHT: string;
  VKZBRACHE?: 'j' | 'n';
  ERTRAGHP?: number;
  NP?: string;
  DATUMF: string;
  FRUCHT: string;
  KZBRACHE?: 'j' | 'n';
  ERTZIEL?: number;
  ERTZIEL_TM?: number;
  ROHPROT_TM?: number;
  SCHNITTE?: number;
  WEIDEANT?: number;
  LEGUMANT?: number;
  FOLIE?: 'j' | 'n';
  VWCODE?: string;
  BERECODE?: string;
  STABINDG?: 'j' | 'n';
  AACODE?: string;
  EC?: number;
  PDICHTE?: string;
  VEGBEGIN?: string;
  BLATTVERL?: 'j' | 'n';
  SPROSS_FM?: number;
  NITRATGEB1?: 'j' | 'n';
  ZWEITFRUCHT?: 'j' | 'n';
  STABINDG100?: 'j' | 'n';
  NP2?: string;
  ZW_ABGEFR?: number;
};

export type ImpOrgRow = {
  BNR: string;
  FSTNR: string;
  SNR: string;
  EJAHR: number;
  DATUMF: string;
  FRUCHT: string;
  AADATUM?: string;
  MICODE?: string;
  MIBEZ?: string;
  FAORGNP?: string;
  MENGE?: number;
  MITS?: number;
  MI_N?: number;
  MI_NH4?: number;
  MI_P?: number;
  MI_K?: number;
  MI_MG?: number;
  MI_S?: number;
  ZW_ABGEFR?: 'j' | 'n';
  MI_P2O5?: number;
  PARKOR?: string;
  MINDESTWIRKSAMKEIT?: number;
  MENGEGESAMT?: number;
  ZUFUHR?: number;
};

export type ImpMindRow = {
  BNR: string;
  FSTNR: string;
  SNR: string;
  EJAHR: number;
  DATUMF: string;
  FRUCHT: string;
  AADATUM?: string;
  MICODE?: string;
  MIBEZ?: string;
  MENGE?: number;
  MI_N?: number;
  MI_P?: number;
  MI_K?: number;
  MI_MG?: number;
  MI_CAO?: number;
  MI_S?: number;
  MI_P2O5?: number;
  PARKOR?: string;
  MENGEGESAMT?: number;
  REFERENCE_ID?: number;
};

export type ImpNminRow = {
  BNR: string;
  FSTNR: string;
  SNR: string;
  EJAHR: number;
  DATUMF: string;
  FRUCHT: string;
  AADATUM?: string;
  PROBE?: string;
  LABOR15?: string;
  NH415?: number;
  NO315?: number;
  LABOR16?: string;
  NH416?: number;
  NO316?: number;
  LABOR30?: string;
  NH430?: number;
  NO330?: number;
  LABOR60?: string;
  NH460?: number;
  NO360?: number;
  LABOR90?: string;
  NH490?: number;
  NO390?: number;
  NMIN_RW?: 'j' | 'n';
  NMIN15?: number;
  NMIN16?: number;
  NMIN30?: number;
  NMIN60?: number;
  NMIN90?: number;
  NMIN_AS?: 'j' | 'n';
  NMIN_AS_L?: 'j' | 'n';
};

export type ImpMakroRow = {
  BNR: string;
  FSTNR: string;
  SNR: string;
  EJAHR: number;
  DATUMF: string;
  FRUCHT: string;
  LABOR20?: string;
  HUMUS?: number;
  PH?: number;
  P?: number;
  K?: number;
  MG?: number;
  METHODPK?: 'C' | 'D';
  FAT?: number;
  CORG?: number;
  NT?: number;
  VSZIEL?: string;
};

export type ImpNlegumRow = {
  BNR: string;
  FSTNR: string;
  SNR: string;
  EJAHR: number;
  DATUMF: string;
  FRUCHT: string;
  AADATUM?: string;
  MICODE?: string;
  MIBEZ?: string;
  MENGE?: number;
  MENGEGESAMT?: number;
  MI_NBINDUNG?: number;
  PARKOR?: string;
};

export type ImpNlegumBetriebRow = {
  BNR: string;
  EJAHR: number;
  AADATUM?: string;
  MICODE?: string;
  MIBEZ?: string;
  MENGE?: number;
  MI_NBINDUNG?: number;
  PARKOR?: string;
};

export type ImpWeideRow = {
  BNR: string;
  FSTNR: string;
  SNR: string;
  EJAHR: number;
  DATUMF: string;
  FRUCHT: string;
  AADATUM?: string;
  MIGRUPPE?: string;
  MICODE?: string;
  MIBEZ?: string;
  TIERZAHL?: number;
  WEIDET?: number;
  MI_N?: number;
  MI_P?: number;
  MI_P2O5?: number;
  NANRECHNUNG?: number;
  PARKOR?: string;
};

export type ImpWeideBetriebRow = Omit<
  ImpWeideRow,
  'FSTNR' | 'SNR' | 'DATUMF' | 'FRUCHT'
>;

export type ImpErnteRow = {
  BNR: string;
  FSTNR: string;
  SNR: string;
  EJAHR: number;
  DATUMF: string;
  FRUCHT: string;
  ERNTEDAT: string;
  MIBEZ?: string;
  ERTRAGHP: number;
  VERWENHP?: string;
  ERTWEIDE?: number;
  ERTRAGNP?: number;
  VERWENNP?: string;
  ANTLEG?: number;
  FAN?: number;
  FAN_NP?: number;
  FAP?: number;
  FAP_NP?: number;
  FAK?: number;
  FAK_NP?: number;
  FAMG?: number;
  FAMG_NP?: number;
  FAS?: number;
  FAS_NP?: number;
  GEWI_NP?: number;
  FAN_HP?: number;
  FAP_HP?: number;
  FAK_HP?: number;
  FAMG_HP?: number;
  FAS_HP?: number;
  RP?: number;
  TSHP?: number;
  TSNP?: number;
  PARKOR?: string;
};

// === Metadata types ===

export type BesydOrgMetadata = {
  betriebsnummer?: string;
  berechnungsgrundlage?: Berechnungsgrundlage;
  bodenklimaraum?: string;
  amt?: string;
  email?: string;
  firma?: string;
  plz?: string;
  ort?: string;
  strasse?: string;
  cropCodeOverrides?: Record<string, string>;
  organicFertilizerCodeOverrides?: Record<string, string>;
  mineralFertilizerCodeOverrides?: Record<string, string>;
};

export type BesydExportModel = {
  impbetr: ImpBetrRow[];
  impanbau: ImpAnbauRow[];
  imporg: ImpOrgRow[];
  impmind: ImpMindRow[];
  impnmin: ImpNminRow[];
  impmakro: ImpMakroRow[];
  impnlegum: ImpNlegumRow[];
  impnlegumbetrieb: ImpNlegumBetriebRow[];
  impweide: ImpWeideRow[];
  impweidebetrieb: ImpWeideBetriebRow[];
  impernte: ImpErnteRow[];
};

export type BesydPreflightResult = PreflightResult;

export type BesydMissingField = MissingField;

export type BesydMissingCropMapping = MissingCropMapping;

export type BesydExportRequest = {
  year: number;
  userInputs?: {
    betriebsnummer?: string;
    berechnungsgrundlage?: Berechnungsgrundlage;
    bodenklimaraum?: string;
    amt?: string;
    cropCodeOverrides?: Record<string, string>;
    organicFertilizerCodeOverrides?: Record<string, string>;
    mineralFertilizerCodeOverrides?: Record<string, string>;
    email?: string;
    firma?: string;
    plz?: string;
    ort?: string;
    strasse?: string;
  };
};

export type BesydExportResponse =
  | {
      success: true;
      model: BesydExportModel;
      metadata: { betriebsnummer: string; year: number };
    }
  | { success: false; preflight: BesydPreflightResult };
