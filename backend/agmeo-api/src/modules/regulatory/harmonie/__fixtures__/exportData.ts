/**
 * Shared ExportData factories for the federal export tests.
 */

import type {
  ExportCultivation,
  ExportData,
  ExportFertilization,
  ExportField,
  ExportSoilSample,
} from '../types.js';
import { getDuengejahrWindow } from '../utils.js';

export const makeMineralFertilization = (
  overrides?: Partial<ExportFertilization>,
): ExportFertilization => ({
  date: new Date('2025-03-15T10:00:00Z'),
  articleId: 'MINERAL__CAN',
  articleFqn: 'MINERAL__CAN',
  fertilizerName: 'Kalkammonsalpeter',
  quantity: 300,
  unit: 'kg_ha',
  fqnPrefix: 'MINERAL',
  articleCategory: null,
  isCustomArticle: false,
  naehrstofftraegerart: 'MINERALDUENGER',
  isMistDuengung: false,
  nKgPerHa: 81,
  nh4KgPerHa: null,
  p2o5KgPerHa: null,
  k2oKgPerHa: null,
  n: 27,
  nh4: null,
  p2o5: null,
  k: null,
  k2o: null,
  mgo: null,
  dryMatterContent: null,
  density: null,
  carrierUnit: 'kg / dt',
  carrierAmountPerHa: 3,
  nPerCarrierUnit: 27,
  nh4PerCarrierUnit: null,
  p2o5PerCarrierUnit: null,
  k2oPerCarrierUnit: null,
  mgoPerCarrierUnit: null,
  ...overrides,
});

export const makeOrganicFertilization = (
  overrides?: Partial<ExportFertilization>,
): ExportFertilization => ({
  date: new Date('2025-04-01T08:00:00Z'),
  articleId: 'ORGANIC__SLURRY_CATTLE',
  articleFqn: 'ORGANIC__SLURRY_CATTLE',
  fertilizerName: 'Rindergülle',
  quantity: 25,
  unit: 'cbm_ha',
  fqnPrefix: 'ORGANIC',
  articleCategory: null,
  isCustomArticle: false,
  naehrstofftraegerart: 'WIRTSCHAFTSDUENGER',
  isMistDuengung: false,
  nKgPerHa: 105,
  nh4KgPerHa: 62.5,
  p2o5KgPerHa: 45,
  k2oKgPerHa: 130,
  n: 4.2,
  nh4: 2.5,
  p2o5: 1.8,
  k: null,
  k2o: 5.2,
  mgo: 0.6,
  dryMatterContent: 8,
  density: 1,
  carrierUnit: 'kg / cbm',
  carrierAmountPerHa: 25,
  nPerCarrierUnit: 4.2,
  nh4PerCarrierUnit: 2.5,
  p2o5PerCarrierUnit: 1.8,
  k2oPerCarrierUnit: 5.2,
  mgoPerCarrierUnit: 0.6,
  ...overrides,
});

export const makeSoilSample = (
  overrides?: Partial<ExportSoilSample>,
): ExportSoilSample => ({
  date: new Date('2024-04-01T12:00:00Z'),
  layerFrom: 0,
  layerTo: 30,
  method: 'cal',
  ph: 6.2,
  p2o5: 12,
  k2o: 18,
  mgo: 8,
  humus: 2.4,
  nt: null,
  soc: null,
  ...overrides,
});

export const makeCultivation = (
  overrides?: Partial<ExportCultivation>,
): ExportCultivation => ({
  cultivationId: 'cult-1',
  cultivationGroupId: 'cg-1',
  crop: 'winterWheat',
  areaInHa: 12.5,
  cropRole: 'MAIN',
  sowingDate: null,
  harvest: null,
  previousCrop: null,
  previousCropSowingDate: null,
  previousCropYieldDtPerHa: null,
  nmin: null,
  filmOrFleece: false,
  droppedFertilizationCount: 0,
  droppedFertilizationDates: [],
  fertilizations: [makeMineralFertilization(), makeOrganicFertilization()],
  failedFertilizations: [],
  ...overrides,
});

/** Next year's maize carrying this year's autumn PK application (31 Oct) — filed as HERBSTANSAAT. */
export const makeHerbstansaat = (
  overrides?: Partial<ExportCultivation>,
): ExportCultivation =>
  makeCultivation({
    cultivationId: 'cult-next',
    cultivationGroupId: 'cg-next',
    crop: 'silageMaize',
    herbstansaat: true,
    previousCrop: 'winterWheat',
    fertilizations: [
      makeMineralFertilization({
        date: new Date('2025-10-31T10:00:00Z'),
        articleId: 'MINERAL__PKPLUS_12_p24_p2MGO_p7S',
        articleFqn: 'MINERAL__PKPLUS_12_p24_p2MGO_p7S',
        fertilizerName: 'PK-Dünger 12+24',
        quantity: 500,
        unit: 'kg_ha',
        nKgPerHa: 0,
        p2o5KgPerHa: 60,
        k2oKgPerHa: 120,
        n: 0,
        p2o5: 12,
        k2o: 24,
        carrierAmountPerHa: 5,
        nPerCarrierUnit: 0,
        p2o5PerCarrierUnit: 12,
        k2oPerCarrierUnit: 24,
      }),
    ],
    ...overrides,
  });

export const makeField = (overrides?: Partial<ExportField>): ExportField => ({
  id: 'field-1',
  name: 'Testfeld Nord',
  areaInHa: 12.5,
  parcelId: '42',
  flik: 'DENILI1234567890',
  soilTypeLufa: null,
  nitrateSensitiveZone: false,
  soilSamples: [],
  cultivations: [makeCultivation()],
  ...overrides,
});

export const makeExportData = (
  overrides?: Partial<ExportData>,
): ExportData => ({
  orgId: 'org_test123',
  year: 2025,
  duengejahr: getDuengejahrWindow(2025),
  federalState: 'NI',
  integrations: {},
  fields: [makeField()],
  ...overrides,
});
