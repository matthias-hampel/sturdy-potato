/**
 * Sachsen-Anhalt Mitteilungspflicht — pure builder + serializer.
 *
 * ExportData + org metadata + stored DBE results → four TXT files. Farms
 * seated outside Sachsen-Anhalt deliver only the Schlag files (DBE,
 * Duengungen); Anl5 and Ertraege are then null.
 *
 * Ported from agmeo `src/lib/federalExport/harmonie-export/st/builder.ts`.
 */

import type { DuevDbeResult } from '../shared/dbeResult.js';
import { isGrasslandCrop } from '../shared/fruchtklasse.js';
import {
  buildJahressumme,
  legalNFertilizerNeed,
  nutzungOfField,
  verfuegbarerNAnteil,
} from '../shared/jahressumme.js';
import { stBodengruppeFromLufa } from '../shared/soil.js';
import type {
  ExportCultivation,
  ExportData,
  ExportField,
  ExportSoilSample,
} from '../types.js';
import { stZuordnung } from './codes/anlage2.js';
import { stKreisName } from './codes/kreise.js';
import { getStKultur } from './codes/kulturen.js';
import { serializeAnl5Row } from './serializers/anl5.js';
import { serializeDbeRow } from './serializers/dbe.js';
import { serializeDuengungRow } from './serializers/duengungen.js';
import { serializeErtragRow } from './serializers/ertraege.js';
import { serializeStTable } from './serializers/format.js';
import type {
  StAnl5Row,
  StBetrieb,
  StDbeRow,
  StDuengungRow,
  StErtragRow,
  StExportModel,
  StOrgMetadata,
  StSchlag,
} from './types.js';

export const ST_EXPORTQUELLE = 'agmeo (Agvolution GmbH)';

export function getEffectiveStMetadata(
  metadata?: StOrgMetadata,
): Required<StOrgMetadata> {
  return {
    betriebsname: metadata?.betriebsname ?? '',
    euBetriebsnummer: metadata?.euBetriebsnummer ?? '',
    sitzPlz: metadata?.sitzPlz ?? '',
    sitzOrt: metadata?.sitzOrt ?? '',
    sitzOrtsteil: metadata?.sitzOrtsteil ?? '',
    kreisNr: metadata?.kreisNr ?? 0,
    bewirtschaftung: metadata?.bewirtschaftung ?? 'k',
    sitzInSt: metadata?.sitzInSt ?? true,
    cropCodeOverrides: metadata?.cropCodeOverrides ?? {},
  };
}

const parzelle = (field: ExportField) => {
  const numeric = field.parcelId ? parseInt(field.parcelId, 10) : NaN;
  return isNaN(numeric) ? '' : String(numeric);
};

const pMethode = (
  sample: ExportSoilSample | undefined,
): StDbeRow['pMethode'] => {
  const method = sample?.method?.toLowerCase() ?? '';
  if (method.startsWith('cal')) return 'CAL';
  if (method.startsWith('dl')) return 'DL';
  if (method.startsWith('euf')) return 'EUF';
  return '';
};

const negative = (value: number | undefined) =>
  value === undefined ? null : -Math.abs(value);

/** Cultivations that are the Schlag's Hauptfrucht (DBE, Ertraege) — next year's Herbstansaat is not. */
const isHauptfrucht = (cult: ExportCultivation) =>
  cult.cropRole === 'MAIN' && !cult.herbstansaat;

export function buildStExportModel(
  data: ExportData,
  metadataOverrides: StOrgMetadata | undefined,
  dbeResults: Record<string, DuevDbeResult>,
): StExportModel {
  const meta = getEffectiveStMetadata({
    ...data.integrations.st,
    ...metadataOverrides,
  });
  const betrieb: StBetrieb = {
    betriebsname: meta.betriebsname,
    euNummer: meta.euBetriebsnummer,
    sitzPlz: meta.sitzPlz,
    sitzOrt: meta.sitzOrt,
    sitzOrtsteil: meta.sitzOrtsteil,
    kreisNr: meta.kreisNr,
    kreis: stKreisName(meta.kreisNr) ?? '',
    exportquelle: ST_EXPORTQUELLE,
    duengejahr: data.year,
  };
  const kultur = (crop: string) => getStKultur(crop, meta.cropCodeOverrides);

  const dbe: StDbeRow[] = [];
  const duengungen: StDuengungRow[] = [];
  const yields = new Map<
    string,
    {
      hf: string;
      fm: number[];
      tm: number[];
      actual: { dt: number; ha: number }[];
    }
  >();

  for (const field of data.fields) {
    if (field.cultivations.length === 0) continue;
    const nutzung = nutzungOfField(field);
    const latestSample = field.soilSamples[0];
    const zwischenfrucht = field.cultivations.find(
      (c) => c.cropRole === 'INTERCROP',
    );
    const zwfr = zwischenfrucht ? kultur(zwischenfrucht.crop) : undefined;
    // The Duengungen file is application-centric: a Herbstansaat's rows carry the
    // current Hauptfrucht (HF empty when the field has none this year).
    const hauptfrucht = field.cultivations.find(isHauptfrucht);
    const hauptfruchtKultur = hauptfrucht
      ? kultur(hauptfrucht.crop)
      : undefined;

    for (const cult of field.cultivations) {
      const hf = cult.herbstansaat ? hauptfruchtKultur : kultur(cult.crop);
      if (!hf && !cult.herbstansaat) continue;
      const schlag: StSchlag = {
        datum: null,
        feldblockId: field.flik ?? '',
        parzelle: parzelle(field),
        ng: field.nitrateSensitiveZone,
        // agmeo has no Phosphorgebiet layer for Sachsen-Anhalt yet.
        phosphorgebiet: false,
        groesseHa: cult.areaInHa,
        nutzung,
        bewirtschaftung: meta.bewirtschaftung,
        hf: hf?.bezeichnung ?? '',
        hfNr: hf?.code ?? '',
      };
      const result = dbeResults[cult.cultivationId];

      if (hf && isHauptfrucht(cult)) {
        const grassland = result?.isGrassland ?? isGrasslandCrop(cult.crop);
        const vf = cult.previousCrop ? kultur(cult.previousCrop) : undefined;
        const layer = (from: number, to: number) =>
          cult.nmin?.layers.find((l) => l.from === from && l.to === to)
            ?.value ?? null;
        const measured = cult.nmin?.source === 'lab';
        dbe.push({
          ...betrieb,
          ...schlag,
          datum: result?.snapshotAt ? new Date(result.snapshotAt) : null,
          bg: stBodengruppeFromLufa(field.soilTypeLufa),
          az: null,
          vf: vf?.bezeichnung ?? '',
          vfNr: vf?.code ?? '',
          zwfr: zwfr?.bezeichnung ?? '',
          zwfrNr: zwfr?.code ?? '',
          nBedarfswertDuev: result?.nRequirementValue ?? null,
          ertragFmDuev: grassland ? null : (result?.referenceYield ?? null),
          ertragFmBetrieb: grassland ? null : (result?.farmYield ?? null),
          ertragFmDiff: grassland ? null : (result?.yieldDifference ?? null),
          ertragTmDuev: grassland ? (result?.referenceYield ?? null) : null,
          ertragTmBetrieb: grassland ? (result?.farmYield ?? null) : null,
          ertragTmDiff: grassland ? (result?.yieldDifference ?? null) : null,
          rpDuev: null,
          rpBetrieb: grassland ? (cult.harvest?.proteinPercent ?? null) : null,
          rpDiff: null,
          nminGesamt: result?.nmin ?? cult.nmin?.kgPerHa ?? null,
          nmin030: layer(0, 30),
          nmin3060: layer(30, 60),
          nmin6090: layer(60, 90),
          datenherkunftNmin060: measured ? 'U' : 'RW',
          datenherkunftNmin6090:
            measured && layer(60, 90) !== null ? 'U' : 'RW',
          zuAbNErtragDiff: result?.yieldSurcharge ?? null,
          zuAbNRpDiff: null,
          abNNachlBoden: negative(result?.humusDeduction),
          abNNachlOd: negative(result?.orgPreviousYearDeduction),
          abNNachlLeg: null,
          abNVf: negative(result?.previousCropDeduction),
          abNZwfr: negative(result?.catchCropDeduction),
          zuNAbdeckung: result?.foilSurcharge ?? null,
          zuNNachtraeglich: null,
          bedarfNBerechnet: result
            ? (legalNFertilizerNeed(result) ?? null)
            : null,
          stickstoffnachlieferungWrwgh: null,
          p2o5Gehalt: latestSample?.p2o5 ?? null,
          pAnalyseDatum:
            latestSample?.p2o5 === null || latestSample?.p2o5 === undefined
              ? null
              : latestSample.date,
          pMethode: pMethode(latestSample),
        });

        const entry = yields.get(hf.code) ?? {
          hf: hf.bezeichnung,
          fm: [],
          tm: [],
          actual: [],
        };
        if (result?.farmYield !== undefined)
          (grassland ? entry.tm : entry.fm).push(result.farmYield);
        if (cult.harvest)
          entry.actual.push({
            dt: cult.harvest.yieldDtPerHa,
            ha: cult.areaInHa,
          });
        yields.set(hf.code, entry);
      }

      // A Herbstansaat application is by definition after this year's harvest.
      const harvestDate = cult.herbstansaat
        ? (hauptfrucht?.harvest?.date ?? null)
        : (cult.harvest?.date ?? null);
      for (const fert of cult.fertilizations) {
        const { zuordnung, kategorie } = stZuordnung(fert);
        const verf = verfuegbarerNAnteil(fert, nutzung);
        const mengeNPerHa = fert.nKgPerHa;
        const p2o5PerHa = fert.p2o5KgPerHa ?? 0;
        duengungen.push({
          ...betrieb,
          ...schlag,
          datum: fert.date,
          zuordnung,
          kategorie,
          bezeichnung: fert.fertilizerName,
          // t/m³ per ha: mineral products are documented per dt.
          menge:
            fert.carrierUnit === 'kg / dt'
              ? fert.carrierAmountPerHa / 10
              : fert.carrierAmountPerHa,
          mengeN: mengeNPerHa * cult.areaInHa,
          mengeNVerf: mengeNPerHa * verf * cult.areaInHa,
          p2o5Menge: p2o5PerHa * cult.areaInHa,
          mengeNPerHa,
          mengeNVerfPerHa: mengeNPerHa * verf,
          p2o5MengePerHa: p2o5PerHa,
          istHerbstDuengung:
            nutzung === 'AL'
              ? cult.herbstansaat === true ||
                (harvestDate !== null && fert.date > harvestDate)
              : null,
          weidetiere: 0,
          weidetage: 0,
        });
      }
      for (const grazing of cult.grazing ?? []) {
        const animalDays = grazing.animals * grazing.days;
        const n = (grazing.nKgPerAnimalDay ?? 0) * animalDays;
        const p2o5 = (grazing.p2o5KgPerAnimalDay ?? 0) * animalDays;
        duengungen.push({
          ...betrieb,
          ...schlag,
          datum: grazing.endDate,
          zuordnung: 'Weidehaltung',
          kategorie:
            grazing.animalGroup === '1'
              ? 'sonstige Rinder'
              : 'alle andere Tierarten',
          bezeichnung: grazing.animalName,
          menge: 0,
          mengeN: n,
          mengeNVerf: n,
          p2o5Menge: p2o5,
          mengeNPerHa: cult.areaInHa > 0 ? n / cult.areaInHa : 0,
          mengeNVerfPerHa: cult.areaInHa > 0 ? n / cult.areaInHa : 0,
          p2o5MengePerHa: cult.areaInHa > 0 ? p2o5 / cult.areaInHa : 0,
          istHerbstDuengung: null,
          weidetiere: grazing.animals,
          weidetage: grazing.days,
        });
      }
    }
  }

  if (!meta.sitzInSt)
    return { anl5: null, ertraege: null, dbe, duengungen, betrieb };

  const summe = buildJahressumme(data, dbeResults);
  const avg = (values: number[]) =>
    values.length > 0
      ? values.reduce((a, b) => a + b, 0) / values.length
      : null;
  const ertraege: StErtragRow[] = [...yields.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([hfNr, y]) => {
      const area = y.actual.reduce((s, a) => s + a.ha, 0);
      return {
        ...betrieb,
        bewirtschaftung: meta.bewirtschaftung,
        hf: y.hf,
        hfNr,
        ertragFmBetrieb: avg(y.fm),
        ertragTmBetriebGl: avg(y.tm),
        ertragFmBetriebNg: null,
        ertragTmGlNg: null,
        andererErtrag: false,
        tatsErtrag:
          area > 0
            ? y.actual.reduce((s, a) => s + a.dt * a.ha, 0) / area
            : null,
      };
    });

  const { mineral, tierisch, sonstigeOrganisch, weide } = summe.sums;
  const anl5: StAnl5Row = {
    ...betrieb,
    ackerlandHa: summe.ackerlandHa,
    gruenlandHa: summe.gruenlandHa,
    betriebsgroesseHa:
      summe.ackerlandHa +
      summe.gruenlandHa +
      summe.sonstigeHa +
      summe.ohneAnbauHa,
    flaeche170Ha: summe.flaeche170Ha,
    bewirtschaftung: meta.bewirtschaftung,
    nBedarf: summe.nBedarfKg,
    p2o5Bedarf: 0,
    nMinDung: mineral.n,
    nTierDung: tierisch.n,
    nVerfTierDung: tierisch.nVerf,
    nWeide: weide.n,
    nSonstDung: sonstigeOrganisch.n,
    nVerfSonstDung: sonstigeOrganisch.nVerf,
    nBodenHilf: 0,
    nKulturSubstrat: 0,
    nPflanzenHilf: 0,
    nAbfall: 0,
    nLegum: 0,
    nSumme: summe.nSummeKg,
    nSummePerHa: summe.nSummeKgPerHa,
    nSummeVerf: summe.nSummeVerfKg,
    p2o5MinDung: mineral.p2o5,
    p2o5TierDung: tierisch.p2o5,
    p2o5Weide: weide.p2o5,
    p2o5SonstDung: sonstigeOrganisch.p2o5,
    p2o5BodenHilf: 0,
    p2o5KulturSubstrat: 0,
    p2o5PflanzenHilf: 0,
    p2o5Abfall: 0,
    p2o5Summe: summe.p2o5SummeKg,
  };

  return { anl5, ertraege, dbe, duengungen, betrieb };
}

/** `Anl5_<KreisNr>_<EU-BNR>_<Jahr>.TXT` etc. — KreisNr zero-padded to three digits as in the LLG example (082). */
export function stFileName(prefix: string, betrieb: StBetrieb): string {
  const kreis = String(betrieb.kreisNr).padStart(3, '0');
  const bnr = betrieb.euNummer.replace(/[^0-9A-Za-z]/g, '_') || 'unknown';
  return `${prefix}_${kreis}_${bnr}_${betrieb.duengejahr}.TXT`;
}

export function serializeStModel(model: StExportModel): Record<string, string> {
  const files: Record<string, string> = {
    [stFileName('DBE', model.betrieb)]: serializeStTable(
      model.dbe,
      serializeDbeRow,
    ),
    [stFileName('Duengungen', model.betrieb)]: serializeStTable(
      model.duengungen,
      serializeDuengungRow,
    ),
  };
  if (model.anl5)
    files[stFileName('Anl5', model.betrieb)] = serializeAnl5Row(model.anl5);
  if (model.ertraege)
    files[stFileName('Ertraege', model.betrieb)] = serializeStTable(
      model.ertraege,
      serializeErtragRow,
    );
  return files;
}

export function generateStFilename(
  euBetriebsnummer: string,
  year: number,
): string {
  const sanitized = euBetriebsnummer.replace(/[^a-zA-Z0-9]/g, '_') || 'unknown';
  return `ST_${sanitized}_${year}.zip`;
}
