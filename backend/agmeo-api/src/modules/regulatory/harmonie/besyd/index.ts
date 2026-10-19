/**
 * BeSyD format library — pure, zero app dependencies
 *
 * Ported from agmeo `src/lib/federalExport/harmonie-export/besyd/index.ts`.
 */

export { BESYD_FIELD_SEPARATOR, BESYD_TEXT_DELIMITER } from './types.js';
export type {
  BesydBundesland,
  Berechnungsgrundlage,
  BesydOrgMetadata,
  BesydExportModel,
  BesydExportRequest,
  BesydExportResponse,
  BesydPreflightResult,
  BesydMissingField,
  BesydMissingCropMapping,
  ImpBetrRow,
  ImpAnbauRow,
  ImpOrgRow,
  ImpMindRow,
  ImpNminRow,
  ImpMakroRow,
  ImpNlegumRow,
  ImpNlegumBetriebRow,
  ImpWeideRow,
  ImpWeideBetriebRow,
  ImpErnteRow,
} from './types.js';
export { BESYD_BUNDESLAND_NAMES } from './types.js';

export type {
  BesydCell,
  BesydColumn,
  BesydColumnFormat,
} from './formatters.js';
export {
  formatBesydText,
  formatBesydNumber,
  formatBesydDateShort,
  formatBesydBoolean,
  formatBesydCell,
  serializeBesydRow,
  serializeBesydTable,
} from './formatters.js';

export {
  DEFAULT_BERECHNUNGSGRUNDLAGE,
  DEFAULT_AMT,
  DEFAULT_BODENKLIMARAUM,
  detectBundeslandFromBnr,
  validateBetriebsnummer,
  getEffectiveBesydMetadata,
} from './defaults.js';

export type { BesydFruchtartInfo } from './fruchtartCodes.js';
export {
  DEFAULT_CROP_TO_BESYD,
  BESYD_FRUCHTART_CATALOGUE,
  getBesydFruchtart,
  searchBesydFruchtartCatalogue,
  getBesydFruchtartByCategory,
  getBesydFruchtartCategories,
} from './fruchtartCodes.js';

export type {
  BodenKlimaRaum,
  OrganicFertilizerCode,
  LegumeCode,
  MineralFertilizerCode,
} from './referenzCodes.js';
export {
  BUNDESLAND_CODES,
  AMT_CODES,
  BERECHNUNGSGRUNDLAGE_CODES,
  BODEN_KLIMA_RAUM_CODES,
  getBodenKlimaRaumByBundesland,
  BODENART_CODES,
  ENTSTEHUNG_CODES,
  WASSERSCHUTZGEBIET_CODES,
  HUMUS_EINSTUFUNG_CODES,
  NEBENPRODUKT_CODES,
  VERWENDUNG_CODES,
  BEREGNUNG_CODES,
  BESTELLUNG_CODES,
  ORGANIC_FERTILIZER_CODES,
  getOrganicFertilizerByCode,
  METHODE_PK_CODES,
  MINERAL_FERTILIZER_GROUP_CODES,
  VERSORGUNGSSTUFE_CODES,
  VSZIEL_CODES,
  LEGUME_CODES,
  MINERAL_FERTILIZER_CODES,
  getMineralFertilizerById,
  mineralReferenceIdForName,
  searchMineralFertilizers,
} from './referenzCodes.js';

export {
  runBesydPreflight,
  getBkrOptionsForBnr,
  getCropCodeOptions,
} from './preflight.js';

export {
  buildBesydExportModel,
  derivedSowingDate,
  serializeBesydModel,
  generateBesydFilename,
} from './builder.js';
export type {
  FieldData,
  CultivationData,
  OrganicFertilizationData,
  MineralFertilizationData,
  NminData,
  MacroNutrientData,
  LegumeData,
  GrazingData,
  HarvestData,
  FieldIdentifiers,
  CropCodeInfo,
  ImpAnbauBuildContext,
  ImpOrgBuildContext,
  ImpMindBuildContext,
  ImpNminBuildContext,
  ImpMakroBuildContext,
  ImpNlegumBuildContext,
  ImpWeideBuildContext,
  ImpErnteBuildContext,
} from './builders/index.js';
export {
  getFieldIdentifiers,
  IMPBETR_COLUMNS,
  buildImpBetr,
  serializeImpBetrRow,
  IMPANBAU_COLUMNS,
  buildImpAnbau,
  serializeImpAnbauRow,
  IMPORG_COLUMNS,
  buildImpOrg,
  serializeImpOrgRow,
  IMPMIND_COLUMNS,
  buildImpMind,
  serializeImpMindRow,
  IMPNMIN_COLUMNS,
  buildImpNmin,
  serializeImpNminRow,
  IMPMAKRO_COLUMNS,
  buildImpMakro,
  serializeImpMakroRow,
  IMPNLEGUM_COLUMNS,
  buildImpNlegum,
  serializeImpNlegumRow,
  getLegumeCode,
  IMPNLEGUMBETRIEB_COLUMNS,
  buildImpNlegumBetrieb,
  serializeImpNlegumBetriebRow,
  IMPWEIDE_COLUMNS,
  IMPWEIDEBETRIEB_COLUMNS,
  buildImpWeide,
  buildImpWeideBetrieb,
  serializeImpWeideRow,
  serializeImpWeideBetriebRow,
  IMPERNTE_COLUMNS,
  buildImpErnte,
  serializeImpErnteRow,
} from './builders/index.js';
