import { buildEndoFromExportData } from './endo/builder.js';
import { buildEnniFromExportData } from './enni/builder.js';
import {
  runBesydPreflightRules,
  runEndoPreflightRules,
  runEnniPreflightRules,
} from './shared/preflight/index.js';
import type { PreflightResult } from './types.js';

import {
  makeCultivation,
  makeExportData,
  makeField,
  makeHerbstansaat,
  makeMineralFertilization,
  makeOrganicFertilization,
} from './__fixtures__/exportData.js';

const codes = (result: PreflightResult, severity?: string) =>
  result.issues
    .filter((i) => !severity || i.severity === severity)
    .map((i) => i.code);

const completeEnni = {
  betriebsnummer: '276030000000001',
  bodenklimaraum: 'BKR_45' as const,
};
const completeEndo = {
  betriebsnummer: '276010000000001',
  naturraum: 'Geest' as const,
};
const completeBesyd = {
  betriebsnummer: '120000000001',
  berechnungsgrundlage: 'DV' as const,
  bodenklimaraum: '107',
};

const readyData = () =>
  makeExportData({
    fields: [
      makeField({
        cultivations: [
          makeCultivation({
            previousCrop: 'canola',
            sowingDate: new Date('2024-10-01'),
            nmin: { date: null, kgPerHa: 40, layers: [], source: 'planning' },
          }),
        ],
        soilSamples: [
          {
            date: new Date('2024-04-01T12:00:00Z'),
            layerFrom: 0,
            layerTo: 30,
            method: null,
            ph: 6,
            p2o5: 10,
            k2o: 10,
            mgo: 5,
            humus: 2,
            nt: null,
            soc: null,
          },
        ],
      }),
    ],
  });

describe('Preflight — metadata', () => {
  test('missing Betriebsnummer blocks and asks for the field', () => {
    const result = runEnniPreflightRules(makeExportData(), {});
    expect(result.isValid).toBe(false);
    expect(result.missingFields.map((f) => f.key)).toContain('betriebsnummer');
    expect(result.missingFields.map((f) => f.key)).toContain('bodenklimaraum');
  });

  test('complete metadata + complete data is valid', () => {
    const result = runEnniPreflightRules(readyData(), completeEnni);
    expect(result.missingFields).toEqual([]);
    expect(result.missingCropMappings).toEqual([]);
    expect(codes(result, 'blocking')).toEqual([]);
    expect(result.isValid).toBe(true);
  });

  test('unmapped crops are reported with their counts (incl. Vorfrucht)', () => {
    const data = makeExportData({
      fields: [
        makeField({
          cultivations: [
            makeCultivation({
              crop: 'notACrop' as never,
              previousCrop: 'canola',
            }),
          ],
        }),
      ],
    });
    const result = runEnniPreflightRules(data, completeEnni);
    expect(result.missingCropMappings).toEqual([
      { cropName: 'notACrop', cultivationCount: 1 },
    ]);
    expect(result.isValid).toBe(false);
  });

  test('Betriebsnummer format blocks for ENNI and ENDO', () => {
    expect(
      codes(
        runEnniPreflightRules(readyData(), {
          ...completeEnni,
          betriebsnummer: '12345',
        }),
        'blocking',
      ),
    ).toContain('betriebsnummer_format');
    const endo = runEndoPreflightRules(readyData(), {
      ...completeEndo,
      betriebsnummer: '12345',
    });
    expect(codes(endo, 'blocking')).toContain('betriebsnummer_format');
    expect(endo.isValid).toBe(false);
  });

  test('BESyD Betriebsnummer must be 12 digits with an eastern Land prefix', () => {
    const result = runBesydPreflightRules(readyData(), {
      ...completeBesyd,
      betriebsnummer: '276030000000001',
    });
    expect(codes(result, 'blocking')).toContain('betriebsnummer_format');
    expect(result.missingFields.map((f) => f.key)).toContain('betriebsnummer');
  });
});

describe('Preflight — field data', () => {
  test('Vorfrucht missing: blocking for ENDO and BESyD (Pflichtfeld), warning for ENNI', () => {
    const data = makeExportData();
    expect(
      codes(runEndoPreflightRules(data, completeEndo), 'blocking'),
    ).toContain('vorfrucht_missing');
    expect(
      codes(runEnniPreflightRules(data, completeEnni), 'warning'),
    ).toContain('vorfrucht_missing');
    expect(
      codes(runBesydPreflightRules(data, completeBesyd), 'blocking'),
    ).toContain('vorfrucht_missing');
  });

  test('an export without any field blocks; crop-less fields are filed by ENNI/ENDO and skipped by BESyD', () => {
    const noFields = makeExportData({ fields: [] });
    expect(
      codes(runEnniPreflightRules(noFields, completeEnni), 'blocking'),
    ).toContain('export_empty');
    expect(
      codes(runEndoPreflightRules(noFields, completeEndo), 'blocking'),
    ).toContain('export_empty');
    expect(
      codes(runBesydPreflightRules(noFields, completeBesyd), 'blocking'),
    ).toContain('export_empty');

    const cropless = makeExportData({
      fields: [makeField({ cultivations: [] })],
    });
    const enni = runEnniPreflightRules(cropless, completeEnni);
    expect(codes(enni)).not.toContain('export_empty');
    expect(codes(enni, 'info')).toContain('field_without_cultivation');
    expect(codes(enni)).not.toContain('field_without_cultivation_skipped');
    const besyd = runBesydPreflightRules(cropless, completeBesyd);
    expect(codes(besyd)).not.toContain('export_empty');
    expect(codes(besyd)).not.toContain('field_without_cultivation');
    expect(
      besyd.issues.find((i) => i.code === 'field_without_cultivation_skipped'),
    ).toMatchObject({
      severity: 'info',
      params: { format: 'webBESyD' },
    });
  });

  test("a crop code override outside the dialect's Stammdaten blocks", () => {
    const enni = runEnniPreflightRules(readyData(), {
      ...completeEnni,
      cropCodeOverrides: { winterWheat: 'Nope001' },
    });
    expect(codes(enni, 'blocking')).toContain('fruchtart_not_in_stammdaten');
    // Winterweizen is WGetreide008 in SH; the ENNI code WGetreide001 means Dinkel there and passes the set check
    const shData = { ...readyData(), federalState: 'SH' };
    const endo = runEndoPreflightRules(shData, {
      ...completeEndo,
      cropCodeOverrides: { winterWheat: 'Mais001' },
    });
    expect(codes(endo, 'blocking')).toContain('fruchtart_not_in_stammdaten');
    expect(
      codes(runEndoPreflightRules(shData, completeEndo), 'blocking'),
    ).toEqual([]);
  });

  test('a failed nutrient calculation blocks with the product and unit', () => {
    const data = makeExportData({
      fields: [
        makeField({
          cultivations: [
            makeCultivation({
              previousCrop: 'canola',
              failedFertilizations: [
                {
                  articleFqn: 'MINERAL__X',
                  fertilizerName: 'X',
                  quantity: 2,
                  unit: 'pieces_ha',
                  reason: 'unsupported',
                },
              ],
            }),
          ],
        }),
      ],
    });
    const issue = runEnniPreflightRules(data, completeEnni).issues.find(
      (i) => i.code === 'nutrient_calculation_failed',
    );
    expect(issue?.severity).toBe('blocking');
    expect(issue?.params).toMatchObject({ fertilizer: 'X', unit: 'pieces_ha' });
  });

  test('FLIK missing blocks BESyD and warns for ENNI and ENDO', () => {
    const data = makeExportData({ fields: [makeField({ flik: null })] });
    expect(
      codes(runBesydPreflightRules(data, completeBesyd), 'blocking'),
    ).toContain('flik_missing');
    expect(
      codes(runEnniPreflightRules(data, completeEnni), 'warning'),
    ).toContain('flik_missing');
    expect(
      codes(runEndoPreflightRules(data, completeEndo), 'warning'),
    ).toContain('flik_missing');
  });

  test('duplicate Schlagnummer is renumbered and reported, fields without cultivation are info', () => {
    const data = makeExportData({
      fields: [
        makeField(),
        makeField({ id: 'f2', name: 'Zwilling' }),
        makeField({ id: 'f3', name: 'Leer', parcelId: '9', cultivations: [] }),
      ],
    });
    const result = runEnniPreflightRules(data, completeEnni);
    const duplicates = result.issues.filter(
      (i) => i.code === 'schlagnummer_duplicate',
    );
    expect(duplicates).toHaveLength(1);
    expect(duplicates[0]).toMatchObject({
      fieldId: 'f2',
      value: '42',
      params: { assigned: '1' },
    });
    expect(codes(result, 'info')).toContain('field_without_cultivation');
  });

  test('the preflight numbers the Schläge exactly like the ENNI and ENDO builders (crop-less fields included)', () => {
    const data = makeExportData({
      fields: [
        makeField({ id: 'f1', parcelId: '3' }),
        makeField({ id: 'f2', name: 'Leer', parcelId: '3', cultivations: [] }),
        makeField({ id: 'f3', name: 'Ohne Nummer', parcelId: null }),
      ],
    });
    const assigned = runEnniPreflightRules(data, completeEnni).issues.find(
      (i) => i.code === 'schlagnummer_duplicate',
    );
    expect(assigned).toMatchObject({
      fieldId: 'f2',
      params: { assigned: '1' },
    });
    const enni = buildEnniFromExportData(
      data,
      completeEnni,
    ).duengebedarf.schlaege.map((s) => s.schlagnummer);
    const endo = buildEndoFromExportData(
      data,
      completeEndo,
    ).duengebedarf.schlaege.map((s) => s.schlagnummer);
    expect(enni).toEqual(['3', '1', '2']);
    expect(endo).toEqual(enni);
  });

  test('two main crops without sowing dates block (one Hauptfrucht per Schlag)', () => {
    const data = makeExportData({
      fields: [
        makeField({
          cultivations: [
            makeCultivation(),
            makeCultivation({ cultivationId: 'c2', crop: 'silageMaize' }),
          ],
        }),
      ],
    });
    expect(
      codes(runEnniPreflightRules(data, completeEnni), 'blocking'),
    ).toContain('multiple_hauptfrucht');
  });

  test('Bundesland mismatch blocks the XML dialects and warns for BESyD', () => {
    const result = runEndoPreflightRules(
      makeExportData({ federalState: 'NI' }),
      completeEndo,
    );
    expect(codes(result, 'blocking')).toContain('bundesland_mismatch');
    expect(
      codes(
        runBesydPreflightRules(
          makeExportData({ federalState: 'NI' }),
          completeBesyd,
        ),
        'warning',
      ),
    ).toContain('bundesland_mismatch');
    expect(
      codes(
        runEnniPreflightRules(
          makeExportData({ federalState: 'NI' }),
          completeEnni,
        ),
      ).includes('bundesland_mismatch'),
    ).toBe(false);
  });

  test('fertilizations outside the Düngejahr: before the window → previous Düngejahr, after it → not reported', () => {
    const data = makeExportData({
      fields: [
        makeField({
          cultivations: [
            makeCultivation({
              droppedFertilizationCount: 3,
              droppedFertilizationDates: [
                new Date('2024-10-20T10:00:00Z'),
                new Date('2024-11-20T10:00:00Z'),
                new Date('2026-01-05T10:00:00Z'),
              ],
            }),
          ],
        }),
      ],
    });
    const { issues } = runEnniPreflightRules(data, completeEnni);
    expect(
      issues.find((i) => i.code === 'fertilization_previous_duengejahr'),
    ).toMatchObject({
      severity: 'info',
      value: '2024-10-20',
      params: {
        crop: 'winterWheat',
        count: 2,
        dates: '20.10.2024, 20.11.2024',
        year: 2024,
      },
    });
    expect(
      issues.find((i) => i.code === 'fertilization_outside_duengejahr'),
    ).toMatchObject({
      severity: 'info',
      params: { crop: 'winterWheat', count: 1, dates: '05.01.2026' },
    });
  });

  test('a Herbstansaat is reported as such and never triggers Hauptfrucht rules', () => {
    const data = makeExportData({
      fields: [
        makeField({
          cultivations: [
            makeCultivation({
              previousCrop: 'canola',
              sowingDate: new Date('2024-10-01'),
              nmin: null,
            }),
            makeHerbstansaat({ previousCrop: null, sowingDate: null }),
          ],
        }),
      ],
    });
    const { issues } = runEnniPreflightRules(data, completeEnni);
    expect(
      issues.find((i) => i.code === 'fertilization_reported_as_herbstansaat'),
    ).toMatchObject({
      severity: 'info',
      cultivationId: 'cult-next',
      params: {
        crop: 'silageMaize',
        year: 2026,
        count: 1,
        dates: '31.10.2025',
      },
    });
    const herbstIssues = issues
      .filter((i) => i.cultivationId === 'cult-next')
      .map((i) => i.code);
    expect(herbstIssues).not.toContain('multiple_hauptfrucht');
    expect(herbstIssues).not.toContain('vorfrucht_missing');
    expect(herbstIssues).not.toContain('sowing_date_missing');
    expect(herbstIssues).not.toContain('nmin_missing');
    expect(codes(runEnniPreflightRules(data, completeEnni))).not.toContain(
      'multiple_hauptfrucht',
    );
    // BESyD books the applications on the Hauptfrucht and needs no code for the next crop
    expect(
      runBesydPreflightRules(data, completeBesyd).missingCropMappings,
    ).toEqual([]);
  });
});

describe('Preflight — soil samples', () => {
  test('a current analysis is filed with its DüV §4(4) validity, an old one warns', () => {
    const data = readyData();
    const current = runEnniPreflightRules(data, completeEnni).issues.find(
      (i) => i.code === 'soil_sample_valid_until',
    );
    expect(current).toMatchObject({
      severity: 'info',
      stage: 'stammdaten',
      value: '2024-04-01',
      params: { date: '01.04.2024', validUntil: '01.04.2030' },
    });
    data.fields[0].soilSamples[0].date = new Date('2018-04-01T12:00:00Z');
    const result = runEnniPreflightRules(data, completeEnni);
    expect(codes(result, 'warning')).toContain(
      'soil_sample_older_than_6_years',
    );
    expect(codes(result)).not.toContain('soil_sample_valid_until');
  });
});

describe('Preflight — plausibility', () => {
  test('nutrient contents above 100 kg per carrier unit block', () => {
    const data = makeExportData({
      fields: [
        makeField({
          cultivations: [
            makeCultivation({
              fertilizations: [
                makeMineralFertilization({ nPerCarrierUnit: 120 }),
              ],
            }),
          ],
        }),
      ],
    });
    expect(
      codes(runEnniPreflightRules(data, completeEnni), 'blocking'),
    ).toContain('mineral_nutrient_over_100_kg_per_dt');
  });

  test('crude protein over 100 % blocks', () => {
    const data = makeExportData({
      fields: [
        makeField({
          cultivations: [
            makeCultivation({
              harvest: {
                date: new Date('2025-08-01'),
                yieldDtPerHa: 80,
                proteinPercent: 140,
              },
            }),
          ],
        }),
      ],
    });
    expect(
      codes(runEnniPreflightRules(data, completeEnni), 'blocking'),
    ).toContain('rp_over_100');
  });

  test('high N sums and huge fields warn', () => {
    const data = makeExportData({
      fields: [
        makeField({
          areaInHa: 250,
          cultivations: [
            makeCultivation({
              fertilizations: [
                makeMineralFertilization({ nKgPerHa: 200 }),
                makeOrganicFertilization({ nKgPerHa: 200 }),
              ],
            }),
          ],
        }),
      ],
    });
    const warnings = codes(
      runEnniPreflightRules(data, completeEnni),
      'warning',
    );
    expect(warnings).toContain('sum_n_too_high');
    expect(warnings).toContain('field_area_too_large');
  });

  test('negative amounts block, zero amounts warn', () => {
    const data = makeExportData({
      fields: [
        makeField({
          cultivations: [
            makeCultivation({
              fertilizations: [
                makeMineralFertilization({ quantity: -1 }),
                makeOrganicFertilization({ quantity: 0 }),
              ],
            }),
          ],
        }),
      ],
    });
    const result = runEnniPreflightRules(data, completeEnni);
    expect(codes(result, 'blocking')).toContain('menge_negative');
    expect(codes(result, 'warning')).toContain('menge_zero');
  });

  test('organic contents are compared per tonne (kg/m³ × convTtoCbm)', () => {
    const data = makeExportData({
      fields: [
        makeField({
          cultivations: [
            makeCultivation({
              fertilizations: [
                makeOrganicFertilization({ nPerCarrierUnit: 95, density: 1.2 }),
              ],
            }),
          ],
        }),
      ],
    });
    expect(
      codes(runEnniPreflightRules(data, completeEnni), 'blocking'),
    ).toContain('organic_nutrient_over_100_kg_per_t');
  });

  test('DüV plausibility: P cap, 170 N farm average, wesentlich count, old soil sample', () => {
    const data = makeExportData({
      fields: [
        makeField({
          areaInHa: 1,
          soilSamples: [
            {
              date: new Date('2018-04-01T12:00:00Z'),
              layerFrom: 0,
              layerTo: 30,
              method: 'cal',
              ph: 6,
              p2o5: 26,
              k2o: 10,
              mgo: 5,
              humus: 2,
              nt: null,
              soc: null,
            },
          ],
          cultivations: [
            makeCultivation({
              areaInHa: 1,
              fertilizations: [
                makeOrganicFertilization({ nKgPerHa: 180, p2o5KgPerHa: 40 }),
              ],
            }),
          ],
        }),
      ],
    });
    const result = runEnniPreflightRules(data, completeEnni);
    expect(codes(result, 'warning')).toEqual(
      expect.arrayContaining([
        'p_cap_exceeded',
        'n170_farm_average_exceeded',
        'soil_sample_older_than_6_years',
      ]),
    );
    expect(
      result.issues.find((i) => i.code === 'wesentlich_threshold')?.params
        ?.count,
    ).toBe(1);
    expect(
      result.issues.find((i) => i.code === 'p_cap_exceeded')?.params,
    ).toMatchObject({ threshold: 20 });
  });

  test('issues are sorted blocking → warning → info', () => {
    const result = runEndoPreflightRules(
      makeExportData({ federalState: 'NI' }),
      completeEndo,
    );
    const order = result.issues.map((i) => i.severity);
    const firstWarning = order.indexOf('warning');
    const firstInfo = order.indexOf('info');
    expect(order.lastIndexOf('blocking')).toBeLessThan(firstWarning);
    expect(firstWarning).toBeLessThan(firstInfo);
  });
});
