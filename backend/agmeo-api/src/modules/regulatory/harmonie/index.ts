/**
 * harmonie — pure DüV export library (ENNI Niedersachsen, ENDO Schleswig-Holstein).
 *
 * Ported from agmeo `src/lib/federalExport/harmonie-export` (BESyD, ST and the
 * PDF report are not part of this port). No database access, no Nest
 * providers, no async: give it `ExportData`, get XML back.
 *
 *   ExportData → buildEnniFromExportData() → EnniExportModel → serializeEnniXml() → XML
 *   ExportData → buildEndoFromExportData() → EndoExportModel → serializeEndoXml() → XML
 *
 * `buildEnniXml` / `buildEndoXml` / `runPreflight` are the one-call entry points.
 */

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
import {
  runEndoPreflightRules,
  runEnniPreflightRules,
} from './shared/preflight/index.js';
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
export { GRASSLAND_CROPS, isGrasslandCrop } from './shared/fruchtklasse.js';
export { runEndoPreflightRules, runEnniPreflightRules };

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

/** Export file name (`ENNI_<bnr>_<year>.xml` / `ENDO_…`) for a format. */
export function generateExportFileName(
  format: FederalExportFormat,
  betriebsnummer: string,
  year: number,
): string {
  return format === 'enni'
    ? generateEnniFilename(betriebsnummer, year)
    : generateEndoFilename(betriebsnummer, year);
}

/**
 * Run the format's preflight rule set (XSD → Pflichtfelder → Stammdaten →
 * Eingaberoutinen → Plausibilität). As in agmeo, the rules read `metadata`
 * only — pass the effective org metadata, not just overrides.
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
  format: FederalExportFormat,
  data: ExportData,
  metadata?: EnniOrgMetadata | EndoOrgMetadata,
): PreflightResult;
export function runPreflight(
  format: FederalExportFormat,
  data: ExportData,
  metadata?: EnniOrgMetadata | EndoOrgMetadata,
): PreflightResult {
  return format === 'enni'
    ? runEnniPreflightRules(data, metadata as EnniOrgMetadata | undefined)
    : runEndoPreflightRules(data, metadata as EndoOrgMetadata | undefined);
}
