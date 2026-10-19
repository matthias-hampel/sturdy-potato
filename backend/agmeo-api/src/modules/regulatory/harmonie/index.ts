/**
 * harmonie — pure DüV export library (ENNI Niedersachsen, ENDO Schleswig-Holstein,
 * webBESyD BB/SN/ST/TH, Sachsen-Anhalt Mitteilungspflicht).
 *
 * Ported from agmeo `src/lib/federalExport/harmonie-export` (the PDF report is
 * not part of this port). No database access, no Nest providers, no async:
 * give it `ExportData`, get XML / TXT files back.
 *
 *   ExportData → buildEnniFromExportData() → EnniExportModel → serializeEnniXml() → XML
 *   ExportData → buildEndoFromExportData() → EndoExportModel → serializeEndoXml() → XML
 *   ExportData → buildBesydExportModel() → BesydExportModel → serializeBesydModel() → IMP*.TXT
 *   ExportData + DBE → buildStExportModel() → StExportModel → serializeStModel() → TXT
 *
 * `buildEnniXml` / `buildEndoXml` / `buildBesydFiles` / `buildStFiles` /
 * `runPreflight` are the one-call entry points.
 */

import {
  buildBesydExportModel,
  derivedSowingDate,
  generateBesydFilename,
  serializeBesydModel,
} from './besyd/builder.js';
import type { BesydOrgMetadata } from './besyd/types.js';
import {
  buildEndoFromExportData,
  generateEndoFilename,
  serializeEndoXml,
} from './endo/builder.js';
import type { EndoOrgMetadata } from './endo/types.js';
import {
  buildEnniFromExportData,
  generateEnniFilename,
  serializeEnniXml,
} from './enni/builder.js';
import type { EnniOrgMetadata } from './enni/types.js';
import type { DuevDbeResult } from './shared/dbeResult.js';
import {
  runBesydPreflightRules,
  runEndoPreflightRules,
  runEnniPreflightRules,
} from './shared/preflight/index.js';
import {
  buildStExportModel,
  generateStFilename,
  serializeStModel,
} from './st/builder.js';
import { runStPreflightRules } from './st/preflight.js';
import type { StOrgMetadata } from './st/types.js';
import type {
  ExportData,
  FederalExportFormat,
  PreflightResult,
} from './types.js';

export * from './types.js';
export * from './utils.js';
export * from './cropKeys.js';

// ENNI
export type {
  EnniAnbau,
  EnniBodenklimaraum,
  EnniDuengebedarf,
  EnniDuengung,
  EnniExportModel,
  EnniOrgMetadata,
  EnniSchlag,
  ErnterueckstandType,
  FruchtklasseType,
  NutzungsartType,
} from './enni/types.js';
export { ENNI_BODENKLIMARAUM_CODES } from './enni/types.js';
export {
  BODENKLIMARAUM_OPTIONS,
  DEFAULT_BODENKLIMARAUM,
  ENNI_DATENHERKUNFT,
  ENNI_SOFTWARE_HERSTELLER,
  getEffectiveEnniMetadata,
} from './enni/defaults.js';
export { buildEnniFromExportData, generateEnniFilename, serializeEnniXml };

// ENDO
export type {
  EndoAnbau,
  EndoDuengebedarf,
  EndoExportModel,
  EndoFruchtklasseType,
  EndoNaturraumType,
  EndoNutzungsartType,
  EndoOrgMetadata,
  EndoSchlag,
} from './endo/types.js';
export {
  DEFAULT_NATURRAUM,
  NATURRAUM_OPTIONS,
  getEffectiveEndoMetadata,
} from './endo/defaults.js';
export { N_KULISSE_LAST_YEAR } from './endo/builder.js';
export { buildEndoFromExportData, generateEndoFilename, serializeEndoXml };
export type { FruchtartInfoSh } from './endo/fruchtartCodesSh.js';
export {
  FRUCHTART_CATALOGUE_SH,
  getFruchtartSh,
  isFruchtartInStammdatenSh,
  searchFruchtartCatalogueSh,
} from './endo/fruchtartCodesSh.js';

// Shared
export type { FruchtartInfo } from './shared/fruchtartCodes.js';
export {
  FRUCHTART_CATALOGUE,
  getFruchtart,
  isFruchtartInStammdaten,
  searchFruchtartCatalogue,
} from './shared/fruchtartCodes.js';
export {
  DEFAULT_BETRIEBSDATEN,
  DEFAULT_DUENGEJAHRBEGINN,
  DUENGEJAHRBEGINN_OPTIONS,
  ENNI_ENDO_VERSION,
} from './shared/defaults.js';
export {
  BETRIEBSNUMMER_EXAMPLES,
  INVEKOS_BETRIEBSNUMMER_PATTERN,
  isValidBetriebsnummer,
} from './shared/betriebsnummer.js';
export type { CarrierArticle, ResolvedCarrier } from './shared/carrier.js';
export { CarrierResolutionError, resolveCarrier } from './shared/carrier.js';
export type { DuevDbeResult } from './shared/dbeResult.js';
export type {
  Jahressumme,
  JahressummeCounters,
  NutrientSource,
  NutrientSums,
  SchlagSumme,
} from './shared/jahressumme.js';
export {
  buildJahressumme,
  legalNFertilizerNeed,
  nutzungOfField,
  sumOverSources,
  verfuegbarerNAnteil,
} from './shared/jahressumme.js';
export type { N170Model } from './shared/n170Builder.js';
export { buildN170, getN170Betriebsdaten } from './shared/n170Builder.js';
export type {
  N170Betriebsdaten,
  N170Tierhaltung,
  N170Transfer,
} from './shared/n170Types.js';
export { assignSchlagnummern } from './shared/xmlHelpers.js';
export {
  GRASSLAND_CROPS,
  LEGUME_CROPS,
  isGrasslandCrop,
} from './shared/fruchtklasse.js';
export {
  runBesydPreflightRules,
  runEndoPreflightRules,
  runEnniPreflightRules,
  runStPreflightRules,
};
export { FORMAT_STATES } from './shared/preflight/rules/common.js';

// BESyD (webBESyD Brandenburg, Sachsen, Sachsen-Anhalt, Thüringen)
export type {
  Berechnungsgrundlage,
  BesydBundesland,
  BesydExportModel,
  BesydOrgMetadata,
} from './besyd/types.js';
export {
  BESYD_BUNDESLAND_NAMES,
  BESYD_FIELD_SEPARATOR,
  BESYD_TEXT_DELIMITER,
} from './besyd/types.js';
export {
  DEFAULT_AMT,
  DEFAULT_BERECHNUNGSGRUNDLAGE,
  detectBundeslandFromBnr,
  getEffectiveBesydMetadata,
  validateBetriebsnummer,
} from './besyd/defaults.js';
export type { BesydFruchtartInfo } from './besyd/fruchtartCodes.js';
export {
  BESYD_FRUCHTART_CATALOGUE,
  DEFAULT_CROP_TO_BESYD,
  getBesydFruchtart,
} from './besyd/fruchtartCodes.js';
export type { BodenKlimaRaum } from './besyd/referenzCodes.js';
export {
  AMT_CODES,
  BODEN_KLIMA_RAUM_CODES,
  getBodenKlimaRaumByBundesland,
  MINERAL_FERTILIZER_GROUP_CODES,
  ORGANIC_FERTILIZER_CODES,
} from './besyd/referenzCodes.js';
export { getBkrOptionsForBnr, getCropCodeOptions } from './besyd/preflight.js';
export {
  buildBesydExportModel,
  derivedSowingDate,
  generateBesydFilename,
  serializeBesydModel,
};

// Sachsen-Anhalt Mitteilungspflicht (LLG)
export type {
  StBewirtschaftung,
  StExportModel,
  StOrgMetadata,
} from './st/types.js';
export { ST_KREISE, stKreisName } from './st/codes/kreise.js';
export type { StKultur } from './st/codes/kulturen.js';
export { ST_KULTUREN, getStKultur } from './st/codes/kulturen.js';
export {
  buildStExportModel,
  generateStFilename,
  getEffectiveStMetadata,
  serializeStModel,
  ST_EXPORTQUELLE,
  stFileName,
} from './st/builder.js';

/** ENNI (Niedersachsen) Dube2.5 XML for one Düngejahr. `metadata` overrides `data.integrations.enni`. */
export function buildEnniXml(
  data: ExportData,
  metadata: EnniOrgMetadata,
): string {
  return serializeEnniXml(buildEnniFromExportData(data, metadata));
}

/** ENDO (Schleswig-Holstein) Dube2.5 XML for one Düngejahr. `metadata` overrides `data.integrations.endo`. */
export function buildEndoXml(
  data: ExportData,
  metadata: EndoOrgMetadata,
): string {
  return serializeEndoXml(buildEndoFromExportData(data, metadata));
}

/** The eleven webBESyD IMP*.TXT files (name → content) for one Erntejahr. */
export function buildBesydFiles(
  data: ExportData,
  metadata: BesydOrgMetadata,
): Record<string, string> {
  return serializeBesydModel(buildBesydExportModel(data, metadata));
}

/** The Sachsen-Anhalt TXT files (DBE, Duengungen, and Anl5 / Ertraege for a seat in ST). */
export function buildStFiles(
  data: ExportData,
  metadata: StOrgMetadata,
  dbeResults: Record<string, DuevDbeResult>,
): Record<string, string> {
  return serializeStModel(buildStExportModel(data, metadata, dbeResults));
}

/** Export file name (`ENNI_<bnr>_<year>.xml`, `ENDO_…`, `BESyD_<bnr>_<year>.zip`, `ST_…`) for a format. */
export function generateExportFileName(
  format: FederalExportFormat,
  betriebsnummer: string,
  year: number,
): string {
  switch (format) {
    case 'enni':
      return generateEnniFilename(betriebsnummer, year);
    case 'endo':
      return generateEndoFilename(betriebsnummer, year);
    case 'besyd':
      return generateBesydFilename(betriebsnummer, year);
    case 'st':
      return generateStFilename(betriebsnummer, year);
  }
}

/**
 * Run the format's preflight rule set (XSD → Pflichtfelder → Stammdaten →
 * Eingaberoutinen → Plausibilität). As in agmeo, the rules read `metadata`
 * only — pass the effective org metadata, not just overrides. For ST,
 * `cultivationIdsWithDbe` adds the `st_dbe_missing` check.
 */
export function runPreflight(
  format: 'enni',
  data: ExportData,
  metadata?: EnniOrgMetadata,
): PreflightResult;
export function runPreflight(
  format: 'endo',
  data: ExportData,
  metadata?: EndoOrgMetadata,
): PreflightResult;
export function runPreflight(
  format: 'besyd',
  data: ExportData,
  metadata?: BesydOrgMetadata,
): PreflightResult;
export function runPreflight(
  format: 'st',
  data: ExportData,
  metadata?: StOrgMetadata,
  cultivationIdsWithDbe?: ReadonlySet<string>,
): PreflightResult;
export function runPreflight(
  format: FederalExportFormat,
  data: ExportData,
  metadata?: PreflightMetadata,
  cultivationIdsWithDbe?: ReadonlySet<string>,
): PreflightResult;
export function runPreflight(
  format: FederalExportFormat,
  data: ExportData,
  metadata?: PreflightMetadata,
  cultivationIdsWithDbe?: ReadonlySet<string>,
): PreflightResult {
  switch (format) {
    case 'enni':
      return runEnniPreflightRules(data, metadata as EnniOrgMetadata);
    case 'endo':
      return runEndoPreflightRules(data, metadata as EndoOrgMetadata);
    case 'besyd':
      return runBesydPreflightRules(data, metadata as BesydOrgMetadata);
    case 'st':
      return runStPreflightRules(
        data,
        metadata as StOrgMetadata,
        cultivationIdsWithDbe,
      );
  }
}

type PreflightMetadata =
  EnniOrgMetadata | EndoOrgMetadata | BesydOrgMetadata | StOrgMetadata;
