/**
 * Jahressumme — the DüV Anlage 5 nutrient balance of a Düngejahr, per Schlag
 * and for the whole farm: area, N need (from the stored DBEs), N and P2O5
 * applied by source class, the plant-available N (Anlage 3 Mindestwirksamkeit)
 * and the NH4-N actually documented. Formatting is left to the consumers.
 */

import type {
  ExportCultivation,
  ExportData,
  ExportFertilization,
  ExportField,
} from '../types.js';
import type { DuevDbeResult } from './dbeResult.js';
import { organicGroup } from './fertilizerGroup.js';
import { isGrasslandCrop } from './fruchtklasse.js';
import { mindestwirksamkeitPercent } from './mindestwirksamkeit.js';
import { assignSchlagnummern } from './xmlHelpers.js';

/** DüV Anlage 5 source classes. */
export type NutrientSource =
  'mineral' | 'tierisch' | 'sonstigeOrganisch' | 'weide';

export type NutrientSums = Record<
  NutrientSource,
  { n: number; nVerf: number; p2o5: number }
>;

/** Counters the record keeps next to the sums: coverage of the DBEs and of the article contents. */
export type JahressummeCounters = {
  /** Anbauten without a stored DBE (their need is missing from `nBedarfKg`). */
  anbautenWithoutDbe: number;
  /** kg NH4-N documented per application (§10 Abs. 2 "verfügbarer Stickstoff"); null contents excluded. */
  nh4Kg: number;
  /** Applications whose article has no NH4-N content. */
  nh4MissingCount: number;
  /** Applications whose article has no P2O5 content. */
  p2o5MissingCount: number;
};

export type SchlagSumme = JahressummeCounters & {
  fieldId: string;
  /** Same number the ENNI/ENDO XML uses (indexed over the unfiltered field list). */
  schlagnummer: string;
  name: string;
  areaInHa: number;
  nutzung: 'AL' | 'GL' | 'so';
  /** kg N need of all cultivations with a stored DBE (§3 need before §13a × cultivation area). */
  nBedarfKg: number;
  /** kg of nutrient applied on the Schlag (rate × cultivation area). */
  sums: NutrientSums;
};

export type Jahressumme = JahressummeCounters & {
  /** One entry per field with a cultivation; crop-less fields only count towards `ohneAnbauHa`. */
  schlaege: SchlagSumme[];
  ackerlandHa: number;
  gruenlandHa: number;
  sonstigeHa: number;
  /** Fields without cultivation in the Düngejahr — part of the Betriebsgröße, not of the fertilized area. */
  ohneAnbauHa: number;
  /** Fertilized area entering §6(4) — every field with a cultivation. */
  flaeche170Ha: number;
  nBedarfKg: number;
  sums: NutrientSums;
  nSummeKg: number;
  nSummeVerfKg: number;
  p2o5SummeKg: number;
  nSummeKgPerHa: number;
  /** Σ Weidetage of the Düngejahr's livestock entries; null when no livestock is recorded. */
  weidetage: number | null;
};

const SONSTIGE_ORGANISCH_GROUPS = new Set([
  'Gärrest',
  'Kompost',
  'Klärschlamm',
  'Sonstiger organischer Dünger',
]);

const emptySums = (): NutrientSums => ({
  mineral: { n: 0, nVerf: 0, p2o5: 0 },
  tierisch: { n: 0, nVerf: 0, p2o5: 0 },
  sonstigeOrganisch: { n: 0, nVerf: 0, p2o5: 0 },
  weide: { n: 0, nVerf: 0, p2o5: 0 },
});

const emptyCounters = (): JahressummeCounters => ({
  anbautenWithoutDbe: 0,
  nh4Kg: 0,
  nh4MissingCount: 0,
  p2o5MissingCount: 0,
});

/** Anlage 5 source class of an application: animal manure vs. other organic (digestate, compost, sludge) vs. mineral. */
function nutrientSource(fert: ExportFertilization): NutrientSource {
  if (fert.naehrstofftraegerart === 'MINERALDUENGER') return 'mineral';
  if (fert.naehrstofftraegerart === 'SONSTIGE') return 'sonstigeOrganisch';
  return SONSTIGE_ORGANISCH_GROUPS.has(organicGroup(fert.articleFqn))
    ? 'sonstigeOrganisch'
    : 'tierisch';
}

/** Share of the total N that counts as plant-available in the year of application (Anlage 3; mineral = 100 %). */
export function verfuegbarerNAnteil(
  fert: ExportFertilization,
  nutzung: 'AL' | 'GL' | 'so',
): number {
  if (fert.naehrstofftraegerart === 'MINERALDUENGER') return 1;
  const percent = mindestwirksamkeitPercent(
    organicGroup(fert.articleFqn),
    nutzung === 'GL' ? 'GRUENLAND' : 'ACKER',
  );
  return (percent ?? 100) / 100;
}

const SONSTIGE_NUTZUNG_CROPS = new Set([
  'landscapeFeature',
  'nonProductiveArea',
]);

/** Nutzung of the Schlag in the Düngejahr — next year's Herbstansaat does not change it. */
export function nutzungOfField(field: ExportField): 'AL' | 'GL' | 'so' {
  const thisYear = field.cultivations.filter((c) => !c.herbstansaat);
  if (thisYear.some((c) => isGrasslandCrop(c.crop))) return 'GL';
  if (
    thisYear.length > 0 &&
    thisYear.every((c) => SONSTIGE_NUTZUNG_CROPS.has(c.crop))
  )
    return 'so';
  return 'AL';
}

/** The legal N need of a DBE (§3 DüV, before the §13a Landesvorgabe); undefined for empty snapshots. */
export function legalNFertilizerNeed(dbe: DuevDbeResult): number | undefined {
  if (dbe.nFertilizerNeed !== undefined) return dbe.nFertilizerNeed;
  if (dbe.nFertilizerNeedFinal === undefined) return undefined;
  return dbe.nFertilizerNeedFinal + (dbe.nitrateZoneReduction ?? 0);
}

/** Total of one nutrient over all source classes. */
export const sumOverSources = (
  sums: NutrientSums,
  key: 'n' | 'nVerf' | 'p2o5',
): number =>
  Object.values(sums).reduce((total, value) => total + value[key], 0);

function addCultivation(
  sums: NutrientSums,
  counters: JahressummeCounters,
  cult: ExportCultivation,
  nutzung: 'AL' | 'GL' | 'so',
): void {
  for (const fert of cult.fertilizations) {
    const source = nutrientSource(fert);
    const n = fert.nKgPerHa * cult.areaInHa;
    sums[source].n += n;
    sums[source].nVerf += n * verfuegbarerNAnteil(fert, nutzung);
    if (fert.p2o5KgPerHa === null) counters.p2o5MissingCount += 1;
    else sums[source].p2o5 += fert.p2o5KgPerHa * cult.areaInHa;
    if (fert.nh4KgPerHa === null) counters.nh4MissingCount += 1;
    else counters.nh4Kg += fert.nh4KgPerHa * cult.areaInHa;
  }
  for (const grazing of cult.grazing ?? []) {
    const animalDays = grazing.animals * grazing.days;
    const n = (grazing.nKgPerAnimalDay ?? 0) * animalDays;
    sums.weide.n += n;
    sums.weide.nVerf += n;
    sums.weide.p2o5 += (grazing.p2o5KgPerAnimalDay ?? 0) * animalDays;
  }
}

const addSums = (into: NutrientSums, from: NutrientSums) => {
  for (const key of Object.keys(into) as NutrientSource[]) {
    into[key].n += from[key].n;
    into[key].nVerf += from[key].nVerf;
    into[key].p2o5 += from[key].p2o5;
  }
};

const addCounters = (into: JahressummeCounters, from: JahressummeCounters) => {
  into.anbautenWithoutDbe += from.anbautenWithoutDbe;
  into.nh4Kg += from.nh4Kg;
  into.nh4MissingCount += from.nh4MissingCount;
  into.p2o5MissingCount += from.p2o5MissingCount;
};

/**
 * Anlage 5 sums over every field with cultivations. The Schlagnummern are
 * assigned exactly like the ENNI/ENDO XML builders do, so both documents agree.
 */
export function buildJahressumme(
  data: ExportData,
  dbeResults: Record<string, DuevDbeResult | null>,
): Jahressumme {
  const schlaege: SchlagSumme[] = [];
  const total = emptySums();
  const counters = emptyCounters();
  let ackerlandHa = 0;
  let gruenlandHa = 0;
  let sonstigeHa = 0;
  let ohneAnbauHa = 0;
  let nBedarfKg = 0;
  const schlagnummern = assignSchlagnummern(
    data.fields.filter((f) => f.cultivations.length > 0),
  );

  data.fields.forEach((field) => {
    if (field.cultivations.length === 0) {
      ohneAnbauHa += field.areaInHa;
      return;
    }
    const nutzung = nutzungOfField(field);
    if (nutzung === 'GL') gruenlandHa += field.areaInHa;
    else if (nutzung === 'so') sonstigeHa += field.areaInHa;
    else ackerlandHa += field.areaInHa;

    const sums = emptySums();
    const schlagCounters = emptyCounters();
    let schlagBedarf = 0;
    for (const cult of field.cultivations) {
      addCultivation(sums, schlagCounters, cult, nutzung);
      // A Herbstansaat carries next year's DBE — its need belongs to the next Düngejahr.
      if (cult.herbstansaat) continue;
      const dbe = dbeResults[cult.cultivationId];
      const need = dbe ? legalNFertilizerNeed(dbe) : undefined;
      if (need === undefined) schlagCounters.anbautenWithoutDbe += 1;
      else schlagBedarf += need * (cult.areaInHa || field.areaInHa);
    }
    addSums(total, sums);
    addCounters(counters, schlagCounters);
    nBedarfKg += schlagBedarf;
    schlaege.push({
      ...schlagCounters,
      fieldId: field.id,
      schlagnummer: schlagnummern.get(field.id) ?? '',
      name: field.name,
      areaInHa: field.areaInHa,
      nutzung,
      nBedarfKg: schlagBedarf,
      sums,
    });
  });

  const flaeche170Ha = ackerlandHa + gruenlandHa + sonstigeHa;
  const nSummeKg = sumOverSources(total, 'n');
  const tierhaltungen =
    data.integrations.n170?.[String(data.year)]?.tierhaltungen ?? [];
  const weidetage =
    tierhaltungen.length === 0
      ? null
      : tierhaltungen.reduce((sum, t) => sum + (t.weidetage ?? 0), 0);

  return {
    ...counters,
    schlaege,
    ackerlandHa,
    gruenlandHa,
    sonstigeHa,
    ohneAnbauHa,
    flaeche170Ha,
    nBedarfKg,
    sums: total,
    nSummeKg,
    nSummeVerfKg: sumOverSources(total, 'nVerf'),
    p2o5SummeKg: sumOverSources(total, 'p2o5'),
    nSummeKgPerHa: flaeche170Ha > 0 ? nSummeKg / flaeche170Ha : 0,
    weidetage,
  };
}
