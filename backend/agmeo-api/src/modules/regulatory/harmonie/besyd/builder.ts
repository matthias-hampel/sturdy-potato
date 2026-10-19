/**
 * BeSyD Export — pure builder + serializer
 *
 * Ported from agmeo `src/lib/federalExport/harmonie-export/besyd/builder.ts`.
 */

import {
  ORGANIC_GROUP_TO_BESYD,
  organicGroup,
} from '../shared/fertilizerGroup.js';
import { GRASSLAND_CROPS, LEGUME_CROPS } from '../shared/fruchtklasse.js';
import type { Nutzungsart } from '../shared/mindestwirksamkeit.js';
import { mindestwirksamkeitPercent } from '../shared/mindestwirksamkeit.js';
import {
  besydBodenartFromLufa,
  k2oToK,
  mgoToMg,
  p2o5ToP,
} from '../shared/soil.js';
import type {
  ExportCultivation,
  ExportData,
  ExportFertilization,
  ExportField,
  ExportGrazing,
} from '../types.js';
import {
  buildImpAnbau,
  buildImpBetr,
  buildImpErnte,
  buildImpMakro,
  buildImpMind,
  buildImpNlegum,
  buildImpNlegumBetrieb,
  buildImpNmin,
  buildImpOrg,
  buildImpWeide,
  buildImpWeideBetrieb,
  getFieldIdentifiers,
  getLegumeCode,
  serializeImpAnbauRow,
  serializeImpBetrRow,
  serializeImpErnteRow,
  serializeImpMakroRow,
  serializeImpMindRow,
  serializeImpNlegumBetriebRow,
  serializeImpNlegumRow,
  serializeImpNminRow,
  serializeImpOrgRow,
  serializeImpWeideBetriebRow,
  serializeImpWeideRow,
} from './builders/index.js';
import type {
  CropCodeInfo,
  CultivationData,
  FieldData,
  GrazingData,
  HarvestData,
  LegumeData,
  MacroNutrientData,
  MineralFertilizationData,
  NminData,
  OrganicFertilizationData,
} from './builders/types.js';
import { getEffectiveBesydMetadata } from './defaults.js';
import { formatBesydDateShort, serializeBesydTable } from './formatters.js';
import type { BesydFruchtartInfo } from './fruchtartCodes.js';
import { getBesydFruchtart } from './fruchtartCodes.js';
import type { BesydExportModel, BesydOrgMetadata } from './types.js';

/**
 * DATUMF / DATUMVF are Pflichtfelder. Without a recorded sowing date the
 * season is derived from the Fruchtart: winter crops 1 October of the
 * previous year, grassland / field grass the start of the harvest year,
 * everything else 1 April. The preflight reports the derivation
 * (`sowing_date_missing`).
 */
export function derivedSowingDate(
  cropInfo: BesydFruchtartInfo,
  harvestYear: number,
): Date {
  if (
    cropInfo.category === 'Wintergetreide' ||
    /^Winter/.test(cropInfo.bezeichnung)
  ) {
    return new Date(Date.UTC(harvestYear - 1, 9, 1));
  }
  if (cropInfo.category === 'Grünland' || cropInfo.category === 'Feldgras')
    return new Date(Date.UTC(harvestYear, 0, 1));
  return new Date(Date.UTC(harvestYear, 3, 1));
}

export function buildBesydExportModel(
  data: ExportData,
  metadataOverrides?: BesydOrgMetadata,
): BesydExportModel {
  const effective = getEffectiveBesydMetadata({
    ...data.integrations.besyd,
    ...metadataOverrides,
  });
  const betriebsnummer = effective.betriebsnummer;

  const fields: FieldData[] = data.fields.map((f) => ({
    id: f.id,
    name: f.name,
    areaInHa: f.areaInHa,
    flik: f.flik || undefined,
    bodenart: besydBodenartFromLufa(f.soilTypeLufa) ?? undefined,
    nitrateSensitiveZone: f.nitrateSensitiveZone,
  }));

  const fieldIdentifiers = getFieldIdentifiers(fields);

  const cultivations: CultivationData[] = [];
  const cultivationCropCodes = new Map<string, CropCodeInfo>();
  const organicFertilizations: OrganicFertilizationData[] = [];
  const mineralFertilizations: MineralFertilizationData[] = [];
  const nminData: NminData[] = [];
  const harvestData: HarvestData[] = [];
  const legumeData: LegumeData[] = [];
  const macroNutrientData: MacroNutrientData[] = [];
  const grazingData: GrazingData[] = [];

  for (const field of data.fields) {
    macroNutrientData.push(...toMacroNutrientData(field));
    // IMPORG/IMPMIND rows need an IMPANBAU row of the Erntejahr: a Herbstansaat's
    // applications are booked on the field's Hauptfrucht; without one they are left out
    // (the preflight reports them as fertilization_reported_as_herbstansaat).
    const hauptfrucht = field.cultivations.find(
      (c) => c.cropRole === 'MAIN' && !c.herbstansaat,
    );

    for (const cult of field.cultivations) {
      if (cult.herbstansaat) {
        if (hauptfrucht)
          mapFertilizations(
            cult.fertilizations,
            hauptfrucht,
            field,
            effective,
            organicFertilizations,
            mineralFertilizations,
          );
        continue;
      }
      const isGrassland = GRASSLAND_CROPS.includes(cult.crop);
      const cropInfo = getBesydFruchtart(
        cult.crop,
        effective.cropCodeOverrides,
      );
      // Unmapped crops are reported by the preflight (missingCropMappings) and cannot be filed.
      if (!cropInfo) continue;
      const previousCropInfo = cult.previousCrop
        ? getBesydFruchtart(cult.previousCrop, effective.cropCodeOverrides)
        : undefined;
      const sowingDate =
        cult.sowingDate ?? derivedSowingDate(cropInfo, data.year);

      cultivations.push({
        id: cult.cultivationId,
        fieldId: field.id,
        crop: cult.crop,
        areaInHa: cult.areaInHa,
        sowingDate,
        previousCrop: cult.previousCrop ?? undefined,
        previousCropSowingDate: previousCropInfo
          ? (cult.previousCropSowingDate ??
            derivedSowingDate(previousCropInfo, data.year - 1))
          : undefined,
        previousCropYield: cult.previousCropYieldDtPerHa ?? undefined,
        isSecondCrop: cult.cropRole !== 'MAIN',
        filmOrFleece: cult.filmOrFleece,
        rawProteinPercent: isGrassland
          ? (cult.harvest?.proteinPercent ?? undefined)
          : undefined,
        cuts: cult.cuts,
        grazingSharePercent: cult.grazingSharePercent,
      });
      grazingData.push(
        ...(cult.grazing ?? []).map((g) => toGrazingData(g, cult, field)),
      );

      cultivationCropCodes.set(cult.cultivationId, {
        datumf: formatBesydDateShort(sowingDate),
        frucht: cropInfo.code,
      });

      mapFertilizations(
        cult.fertilizations,
        cult,
        field,
        effective,
        organicFertilizations,
        mineralFertilizations,
      );

      const nmin = toNminData(cult, field);
      if (nmin) nminData.push(nmin);

      if (cult.harvest) {
        harvestData.push({
          cultivationId: cult.cultivationId,
          fieldId: field.id,
          harvestDate: cult.harvest.date,
          cropName: cropInfo.bezeichnung,
          yieldMainProductDtPerHa: cult.harvest.yieldDtPerHa,
          rawProteinPercent: cult.harvest.proteinPercent ?? undefined,
        });

        const legumeCode = LEGUME_CROPS.includes(cult.crop)
          ? getLegumeCode(cult.crop)
          : undefined;
        if (legumeCode) {
          legumeData.push({
            cultivationId: cult.cultivationId,
            fieldId: field.id,
            harvestDate: cult.harvest.date,
            legumeCode,
            legumeName: cropInfo.bezeichnung,
            yieldDtPerHa: cult.harvest.yieldDtPerHa,
            totalYieldDt: cult.harvest.yieldDtPerHa * cult.areaInHa,
          });
        }
      }
    }
  }

  const impbetr = buildImpBetr({
    ...data.integrations.besyd,
    ...metadataOverrides,
  });

  const impanbau = buildImpAnbau({
    betriebsnummer,
    year: data.year,
    fields,
    fieldIdentifiers,
    cultivations,
    cropCodeOverrides: effective.cropCodeOverrides,
  });

  const base = {
    betriebsnummer,
    year: data.year,
    fieldIdentifiers,
    cultivationCropCodes,
  };

  const imporg = buildImpOrg({ ...base, organicFertilizations });
  const impmind = buildImpMind({ ...base, mineralFertilizations });
  const impnmin = buildImpNmin({ ...base, nminData });
  const impmakro = buildImpMakro({
    betriebsnummer,
    year: data.year,
    fieldIdentifiers,
    macroNutrientData,
  });
  const impnlegum = buildImpNlegum({ ...base, legumeData });
  const impnlegumbetrieb = buildImpNlegumBetrieb(
    betriebsnummer,
    data.year,
    impnlegum,
  );
  const impweide = buildImpWeide({ ...base, grazingData });
  const impweidebetrieb = buildImpWeideBetrieb(
    betriebsnummer,
    data.year,
    impweide,
  );
  const impernte = buildImpErnte({ ...base, harvestData });

  return {
    impbetr,
    impanbau,
    imporg,
    impmind,
    impnmin,
    impmakro,
    impnlegum,
    impnlegumbetrieb,
    impweide,
    impweidebetrieb,
    impernte,
  };
}

function toGrazingData(
  grazing: ExportGrazing,
  cult: ExportCultivation,
  field: ExportField,
): GrazingData {
  return {
    cultivationId: cult.cultivationId,
    fieldId: field.id,
    endDate: grazing.endDate ?? undefined,
    animalGroup: grazing.animalGroup,
    animalCode: grazing.animalCode ?? undefined,
    animalName: grazing.animalName,
    animals: grazing.animals,
    days: grazing.days,
    nKgPerAnimalDay: grazing.nKgPerAnimalDay ?? undefined,
    p2o5KgPerAnimalDay: grazing.p2o5KgPerAnimalDay ?? undefined,
  };
}

/** `cult` is the Anbau row the applications are filed under (the Hauptfrucht for a Herbstansaat). */
function mapFertilizations(
  fertilizations: ExportFertilization[],
  cult: ExportCultivation,
  field: ExportField,
  overrides: Pick<
    BesydOrgMetadata,
    'organicFertilizerCodeOverrides' | 'mineralFertilizerCodeOverrides'
  >,
  organic: OrganicFertilizationData[],
  mineral: MineralFertilizationData[],
): void {
  const nutzungsart: Nutzungsart = GRASSLAND_CROPS.includes(cult.crop)
    ? 'GRUENLAND'
    : 'ACKER';
  for (const fert of fertilizations) {
    if (fert.fqnPrefix === 'ORGANIC') {
      organic.push(
        toOrganicData(
          fert,
          cult,
          field,
          nutzungsart,
          overrides.organicFertilizerCodeOverrides?.[fert.articleFqn],
        ),
      );
    } else if (fert.fqnPrefix === 'MINERAL') {
      mineral.push(
        toMineralData(
          fert,
          cult,
          field,
          overrides.mineralFertilizerCodeOverrides?.[fert.articleFqn],
        ),
      );
    }
  }
}

/**
 * Organic contents: agmeo stores kg/m³ of product, BESyD wants % of fresh
 * mass. convTtoCbm is m³ per t, so kg/m³ × (m³/t) = kg/t and kg/t ÷ 10 = %.
 * Unknown density falls back to 1 t/m³ (preflight `organic_density_unknown`).
 */
function kgPerCbmToPercentFm(
  value: number | null,
  convTtoCbm: number | null,
): number | undefined {
  if (value === null) return undefined;
  return (value * (convTtoCbm ?? 1)) / 10;
}

/** IMPMIND.MENGE is dt/ha; liquids documented per hl are converted via their density (kg/l = 1 / convTtoCbm). */
function mineralAmountDtPerHa(fert: ExportFertilization): number {
  if (fert.carrierUnit !== 'kg / hl') return fert.carrierAmountPerHa;
  return fert.carrierAmountPerHa / (fert.density ?? 1);
}

function toOrganicData(
  fert: ExportFertilization,
  cult: ExportCultivation,
  field: ExportField,
  nutzungsart: Nutzungsart,
  codeOverride: string | undefined,
): OrganicFertilizationData {
  const amountPerHa = fert.carrierAmountPerHa;
  const p2o5Percent = kgPerCbmToPercentFm(fert.p2o5, fert.density);
  const k2oPercent = kgPerCbmToPercentFm(fert.k2o, fert.density);
  const mgoPercent = kgPerCbmToPercentFm(fert.mgo, fert.density);
  const group = organicGroup(fert.articleFqn);
  return {
    cultivationId: cult.cultivationId,
    fieldId: field.id,
    applicationDate: fert.date,
    fertilizerCode: codeOverride ?? ORGANIC_GROUP_TO_BESYD[group],
    mindestwirksamkeitPercent: mindestwirksamkeitPercent(group, nutzungsart),
    fertilizerName: fert.fertilizerName,
    amountPerHa,
    totalAmount: amountPerHa * cult.areaInHa,
    dryMatterPercent: fert.dryMatterContent ?? undefined,
    nPercent: kgPerCbmToPercentFm(fert.n, fert.density),
    nh4Percent: kgPerCbmToPercentFm(fert.nh4, fert.density),
    pPercent: p2o5Percent === undefined ? undefined : p2o5ToP(p2o5Percent),
    p2o5Percent,
    kPercent: k2oPercent === undefined ? undefined : k2oToK(k2oPercent),
    mgPercent: mgoPercent === undefined ? undefined : mgoToMg(mgoPercent),
  };
}

function toMineralData(
  fert: ExportFertilization,
  cult: ExportCultivation,
  field: ExportField,
  codeOverride: string | undefined,
): MineralFertilizationData {
  const amountPerHa = mineralAmountDtPerHa(fert);
  return {
    cultivationId: cult.cultivationId,
    fieldId: field.id,
    applicationDate: fert.date,
    fertilizerGroupCode: codeOverride,
    fertilizerName: fert.fertilizerName,
    amountPerHa,
    totalAmount: amountPerHa * cult.areaInHa,
    nPercent: fert.n ?? undefined,
    pPercent: fert.p2o5 === null ? undefined : p2o5ToP(fert.p2o5),
    p2o5Percent: fert.p2o5 ?? undefined,
    kPercent: fert.k2o === null ? undefined : k2oToK(fert.k2o),
    mgPercent: fert.mgo === null ? undefined : mgoToMg(fert.mgo),
  };
}

function toNminData(
  cult: ExportCultivation,
  field: ExportField,
): NminData | null {
  if (!cult.nmin) return null;
  const layer = (from: number, to: number) =>
    cult.nmin?.layers.find((l) => l.from === from && l.to === to)?.value;
  const nmin030 =
    layer(0, 30) ??
    (cult.nmin.layers.length === 0 ? cult.nmin.kgPerHa : undefined);
  return {
    cultivationId: cult.cultivationId,
    fieldId: field.id,
    sampleDate: cult.nmin.date ?? undefined,
    nmin015: layer(0, 15),
    nmin1530: layer(15, 30),
    nmin030,
    nmin3060: layer(30, 60),
    nmin6090: layer(60, 90),
    useReferenceValue: cult.nmin.source === 'planning',
  };
}

function methodPK(method: string | null): 'C' | 'D' | undefined {
  if (!method) return undefined;
  if (/^cal/i.test(method)) return 'C';
  if (/^dl/i.test(method)) return 'D';
  return undefined;
}

function toMacroNutrientData(field: ExportField): MacroNutrientData[] {
  return field.soilSamples.map((sample, index) => ({
    fieldId: field.id,
    sampleDate: sample.date,
    probeNr: `${field.id.slice(0, 6)}-${index + 1}`,
    humusPercent: sample.humus ?? undefined,
    ph: sample.ph ?? undefined,
    pMgPer100g: sample.p2o5 === null ? undefined : p2o5ToP(sample.p2o5),
    kMgPer100g: sample.k2o === null ? undefined : k2oToK(sample.k2o),
    mgMgPer100g: sample.mgo === null ? undefined : mgoToMg(sample.mgo),
    methodPK: methodPK(sample.method),
    corgPercent: sample.soc ?? undefined,
    ntPercent: sample.nt ?? undefined,
  }));
}

export function serializeBesydModel(
  model: BesydExportModel,
): Record<string, string> {
  return {
    'IMPBETR.TXT': serializeBesydTable(model.impbetr, serializeImpBetrRow),
    'IMPANBAU.TXT': serializeBesydTable(model.impanbau, serializeImpAnbauRow),
    'IMPORG.TXT': serializeBesydTable(model.imporg, serializeImpOrgRow),
    'IMPMIND.TXT': serializeBesydTable(model.impmind, serializeImpMindRow),
    'IMPNMIN.TXT': serializeBesydTable(model.impnmin, serializeImpNminRow),
    'IMPMAKRO.TXT': serializeBesydTable(model.impmakro, serializeImpMakroRow),
    'IMPNLEGUM.TXT': serializeBesydTable(
      model.impnlegum,
      serializeImpNlegumRow,
    ),
    'IMPNLEGUMBETRIEB.TXT': serializeBesydTable(
      model.impnlegumbetrieb,
      serializeImpNlegumBetriebRow,
    ),
    'IMPWEIDE.TXT': serializeBesydTable(model.impweide, serializeImpWeideRow),
    'IMPWEIDEBETRIEB.TXT': serializeBesydTable(
      model.impweidebetrieb,
      serializeImpWeideBetriebRow,
    ),
    'IMPERNTE.TXT': serializeBesydTable(model.impernte, serializeImpErnteRow),
  };
}

export function generateBesydFilename(
  betriebsnummer: string,
  year: number,
): string {
  const sanitized = betriebsnummer.replace(/[^a-zA-Z0-9]/g, '_');
  return `BESyD_${sanitized}_${year}.zip`;
}
