/**
 * Anbau / Schlag content shared by the ENNI and ENDO builders: the Dube2.5
 * element values derived from one ExportCultivation / ExportField. The two
 * dialects differ only in enum names and one mandatory soil element, which
 * the callers handle.
 */

import type {
  Bodenuntersuchung,
  ExportCultivation,
  ExportField,
  ExportSoilSample,
} from '../types.js';
import { formatExportDate, formatExportDecimal } from '../utils.js';
import {
  bodenartgruppeFromLufa,
  humusklasseFromPercent,
  k2oToK,
  mgoToMg,
  p2o5ToP,
} from './soil.js';

const FOUR_WEEKS_MS = 28 * 86400000;

/** Optional anbau values every dialect emits identically. */
export type SharedAnbauValues = {
  'n-min'?: string;
  'nmin-probenahmetiefe'?: string;
  'n-min-vor-mehr-als-4-wochen'?: string;
  ertrag?: string;
  'rp-gehalt-prozent'?: string;
  anbauflaeche?: string;
  folie?: boolean;
};

export function sharedAnbauValues(
  cult: ExportCultivation,
  field: ExportField,
): SharedAnbauValues {
  const values: SharedAnbauValues = {};

  if (cult.nmin) {
    values['n-min'] = formatExportDecimal(cult.nmin.kgPerHa);
    const depth = Math.max(0, ...cult.nmin.layers.map((l) => l.to));
    if ([15, 30, 60, 90].includes(depth))
      values['nmin-probenahmetiefe'] = String(depth);
    if (
      cult.nmin.date &&
      cult.sowingDate &&
      cult.sowingDate.getTime() - cult.nmin.date.getTime() > FOUR_WEEKS_MS
    ) {
      values['n-min-vor-mehr-als-4-wochen'] = formatExportDecimal(
        cult.nmin.kgPerHa,
      );
    }
  }

  if (cult.harvest) {
    values.ertrag = formatExportDecimal(cult.harvest.yieldDtPerHa);
    const rp = cult.harvest.proteinPercent;
    if (rp !== null && rp >= 0 && rp <= 100)
      values['rp-gehalt-prozent'] = formatExportDecimal(rp, 3);
  }

  if (cult.areaInHa > 0 && cult.areaInHa < field.areaInHa - 0.005) {
    values.anbauflaeche = formatExportDecimal(cult.areaInHa, 4);
  }

  if (cult.filmOrFleece) values.folie = true;

  return values;
}

/**
 * Dube2.5 `bodenuntersuchung` rows for a field. `analysenr`, `bodenartgruppe`,
 * `humusklasse` and the P value are mandatory in both XSDs: samples without a
 * P value or on a field without a known soil type cannot be filed and are
 * skipped. A standard P/K/Mg/pH analysis carries no humus value — it is filed
 * as HUMUSARM (DüV Anlage 4, the < 4 % class of mineral soils) without
 * `humusgehalt`, as the farmers' previous tools do.
 */
export function buildBodenuntersuchungen(
  field: ExportField,
): Bodenuntersuchung[] {
  const bodenartgruppe = bodenartgruppeFromLufa(field.soilTypeLufa);
  if (!bodenartgruppe) return [];

  // Both dialects require a phosphorus value and both gehalt-p/gehalt-p2o5 are
  // always emitted together, so there is nothing dialect-specific to switch on.
  return field.soilSamples.flatMap((sample) =>
    sample.p2o5 === null
      ? []
      : [toBodenuntersuchung(field, sample, bodenartgruppe)],
  );
}

/** Stable per field and sampling date, so a re-export keeps the authority's reference. */
const analysenr = (field: ExportField, analysedatum: string) =>
  `${field.id.slice(0, 8)}-${analysedatum}`;

function toBodenuntersuchung(
  field: ExportField,
  sample: ExportSoilSample,
  bodenartgruppe: string,
): Bodenuntersuchung {
  const analysedatum = formatExportDate(sample.date);
  const result: Bodenuntersuchung = {
    analysedatum,
    analysenr: analysenr(field, analysedatum),
    bodenartgruppe,
    humusklasse: humusklasseFromPercent(sample.humus ?? 0),
  };
  if (sample.humus !== null)
    result.humusgehalt = formatExportDecimal(sample.humus, 3);
  if (sample.p2o5 !== null) {
    result['gehalt-p'] = formatExportDecimal(p2o5ToP(sample.p2o5));
    result['gehalt-p2o5'] = formatExportDecimal(sample.p2o5);
  }
  if (sample.k2o !== null) {
    result['gehalt-k'] = formatExportDecimal(k2oToK(sample.k2o));
    result['gehalt-k2o'] = formatExportDecimal(sample.k2o);
  }
  if (sample.mgo !== null) {
    result['gehalt-mg'] = formatExportDecimal(mgoToMg(sample.mgo));
    result['gehalt-mgo'] = formatExportDecimal(sample.mgo);
  }
  if (sample.ph !== null) result['ph-wert'] = formatExportDecimal(sample.ph, 2);
  return result;
}
