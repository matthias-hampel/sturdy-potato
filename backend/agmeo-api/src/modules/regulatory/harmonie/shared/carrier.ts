/**
 * Carrier-unit resolution — the ONE place that turns a recorded application
 * (rate + transaction unit + article contents) into what the exports file:
 *
 * - the Dube2.5 `einheit` the product is documented in (kg / dt, kg / cbm,
 *   kg / t, kg / hl),
 * - the application amount per ha in that unit
 *   (`menge-in-einheit-naehrstofftraeger-pro-ha`),
 * - the nutrient contents per one carrier unit and the resulting kg/ha.
 *
 * Article columns are NOT uniform: MINERAL__ (and every other non-organic)
 * article stores mass percent (= kg per dt), ORGANIC__ articles store kg per m³.
 * `convTtoCbm` is m³ per t of product — the INVERSE density (1.05 t/m³ slurry
 * → 0.952 m³/t). kg/m³ → kg/t therefore MULTIPLIES by convTtoCbm.
 *
 * Unknown density is substituted by 1 t/m³ (the same fallback the app's
 * `calculateN` applies); the preflight surfaces it as `organic_density_unknown`.
 *
 * Known divergence: the app (`calculateN`, `nutrientPerProductUnit`) reads
 * organic `n` as kg per tonne and `convTtoCbm` as the density in t/m³ — the
 * opposite of the reading above. For organic articles with a density other than
 * 1 t/m³ the exports and the app therefore disagree. Which reading the exports
 * should follow is an open team decision (see #2662), since changing it changes
 * DüV-documented values.
 */

import type { CarrierUnit, NaehrstofftraegerartType } from '../types.js';

export type CarrierArticle = {
  n: number | null;
  nh4: number | null;
  p2o5: number | null;
  k2o: number | null;
  mgo: number | null;
  /** m³ per t (inverse density); null when unknown. */
  convTtoCbm: number | null;
  /** kg N per 100 l — liquid mineral products documented per hl (AHL). */
  kgNper100L: number | null;
};

export type ResolvedCarrier = {
  carrierUnit: CarrierUnit;
  carrierAmountPerHa: number;
  nPerCarrierUnit: number | null;
  nh4PerCarrierUnit: number | null;
  p2o5PerCarrierUnit: number | null;
  k2oPerCarrierUnit: number | null;
  mgoPerCarrierUnit: number | null;
  nKgPerHa: number;
  nh4KgPerHa: number | null;
  p2o5KgPerHa: number | null;
  k2oKgPerHa: number | null;
};

export class CarrierResolutionError extends Error {}

/** Litres per unit for volume rates, kilograms per unit for mass rates. */
const LITRES_PER_UNIT: Record<string, number> = {
  l_ha: 1,
  hl_ha: 100,
  cbm_ha: 1000,
};
const KILOGRAMS_PER_UNIT: Record<string, number> = {
  kg_ha: 1,
  dt_ha: 100,
  t_ha: 1000,
};
/** The import API stores rates with the unit as written ("kg/ha", "m³/ha"); the exports read the canonical form. */
const UNIT_ALIASES: Record<string, string> = {
  'kg/ha': 'kg_ha',
  'dt/ha': 'dt_ha',
  't/ha': 't_ha',
  'l/ha': 'l_ha',
  'hl/ha': 'hl_ha',
  'm³/ha': 'cbm_ha',
  'm3/ha': 'cbm_ha',
  'cbm/ha': 'cbm_ha',
};

type PerUnit = (value: number | null) => number | null;

const identity: PerUnit = (value) => value;

const build = (
  article: CarrierArticle,
  carrierUnit: CarrierUnit,
  carrierAmountPerHa: number,
  perUnit: PerUnit,
  nOverride?: number,
): ResolvedCarrier => {
  const nPerCarrierUnit = nOverride ?? perUnit(article.n);
  const nh4PerCarrierUnit = perUnit(article.nh4);
  const p2o5PerCarrierUnit = perUnit(article.p2o5);
  const k2oPerCarrierUnit = perUnit(article.k2o);
  const perHa = (value: number | null) =>
    value === null ? null : value * carrierAmountPerHa;
  return {
    carrierUnit,
    carrierAmountPerHa,
    nPerCarrierUnit,
    nh4PerCarrierUnit,
    p2o5PerCarrierUnit,
    k2oPerCarrierUnit,
    mgoPerCarrierUnit: perUnit(article.mgo),
    nKgPerHa: perHa(nPerCarrierUnit) ?? 0,
    nh4KgPerHa: perHa(nh4PerCarrierUnit),
    p2o5KgPerHa: perHa(p2o5PerCarrierUnit),
    k2oKgPerHa: perHa(k2oPerCarrierUnit),
  };
};

/**
 * @param isMist solid manure — documented per tonne (kg / t) instead of per m³
 * @throws CarrierResolutionError for a transaction unit no export can convert
 */
export function resolveCarrier(
  article: CarrierArticle,
  naehrstofftraegerart: NaehrstofftraegerartType,
  isMist: boolean,
  unit: string,
  quantity: number,
): ResolvedCarrier {
  const canonical = UNIT_ALIASES[unit.toLowerCase()] ?? unit;
  const litres = LITRES_PER_UNIT[canonical];
  const kilograms = KILOGRAMS_PER_UNIT[canonical];
  if (litres === undefined && kilograms === undefined) {
    throw new CarrierResolutionError(`unsupported application unit "${unit}"`);
  }
  const cbmPerT =
    article.convTtoCbm && article.convTtoCbm > 0 ? article.convTtoCbm : null;

  if (naehrstofftraegerart === 'WIRTSCHAFTSDUENGER') {
    // Contents are kg per m³ of product.
    const factor = cbmPerT ?? 1;
    const cbm =
      kilograms !== undefined
        ? ((quantity * kilograms) / 1000) * factor
        : (quantity * litres) / 1000;
    if (!isMist) return build(article, 'kg / cbm', cbm, identity);
    const tonnes = cbm / factor;
    const perTonne: PerUnit = (value) =>
      value === null ? null : value * factor;
    return build(article, 'kg / t', tonnes, perTonne);
  }

  // Mineral and other products: contents are mass percent (= kg per dt).
  if (kilograms !== undefined)
    return build(article, 'kg / dt', (quantity * kilograms) / 100, identity);

  // Volume-dosed liquid: documented per hl when the article carries kg N/100 l …
  if (article.kgNper100L && article.kgNper100L > 0) {
    const perHl: PerUnit = (value) =>
      value === null || cbmPerT === null ? null : value / cbmPerT;
    return build(
      article,
      'kg / hl',
      (quantity * litres) / 100,
      perHl,
      article.kgNper100L,
    );
  }
  // … otherwise converted to dt via its density (kg/l = t/m³ = 1 / convTtoCbm).
  if (cbmPerT === null) {
    throw new CarrierResolutionError(
      `density unknown — cannot convert "${unit}" to kg / dt`,
    );
  }
  return build(
    article,
    'kg / dt',
    (quantity * litres) / cbmPerT / 100,
    identity,
  );
}
