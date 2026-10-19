/**
 * BESyD tables — units per the webBESyD import spec
 * (docs/sanity-check-prompt/besyd/Exportstruktur_BESyD2026_fuer_Import_webBESyD.pdf).
 */

import { buildBesydExportModel, serializeBesydModel } from './besyd/builder.js';

import {
  makeCultivation,
  makeExportData,
  makeField,
  makeHerbstansaat,
  makeMineralFertilization,
  makeOrganicFertilization,
  makeSoilSample,
} from './__fixtures__/exportData.js';

const meta = {
  betriebsnummer: '120000000001',
  berechnungsgrundlage: 'DV' as const,
  bodenklimaraum: '107',
};

const richData = () =>
  makeExportData({
    fields: [
      makeField({
        soilTypeLufa: 'sL',
        nitrateSensitiveZone: true,
        soilSamples: [
          makeSoilSample({
            p2o5: 10,
            k2o: 20,
            mgo: 10,
            humus: 3.1,
            ph: 6.4,
            method: 'cal',
          }),
        ],
        cultivations: [
          makeCultivation({
            crop: 'peasDry',
            sowingDate: new Date('2025-03-20T00:00:00Z'),
            previousCrop: 'winterWheat',
            previousCropSowingDate: new Date('2023-10-05T00:00:00Z'),
            previousCropYieldDtPerHa: 78,
            harvest: {
              date: new Date('2025-07-30T00:00:00Z'),
              yieldDtPerHa: 42,
              proteinPercent: 22,
            },
            nmin: {
              date: new Date('2025-03-01T12:00:00Z'),
              kgPerHa: 55,
              layers: [
                { from: 0, to: 30, value: 25 },
                { from: 30, to: 60, value: 20 },
                { from: 60, to: 90, value: 10 },
              ],
              source: 'lab',
            },
            fertilizations: [
              makeMineralFertilization({
                n: 12,
                p2o5: 12,
                k2o: 17,
                quantity: 200,
                unit: 'kg_ha',
                carrierAmountPerHa: 2,
              }),
              makeOrganicFertilization({
                density: 1.05,
                quantity: 20,
                unit: 'cbm_ha',
                carrierAmountPerHa: 20,
              }),
            ],
          }),
        ],
      }),
    ],
  });

describe('BESyD builder', () => {
  test('IMPANBAU carries real sowing / Vorfrucht data and the DüV flags', () => {
    const [row] = buildBesydExportModel(richData(), meta).impanbau;
    expect(row.DATUMF).toBe('20.03.2025');
    expect(row.DATUMVF).toBe('05.10.2023');
    expect(row.VFRUCHT).toBe('0102');
    expect(row.ERTRAGHP).toBe(78);
    expect(row.FELDBLOCK).toBe('DENILI1234567890');
    expect(row.BCODE).toBe('5');
    expect(row.NITRATGEB1).toBe('j');
    expect(row.ZWEITFRUCHT).toBe('n');
  });

  test('derives the sowing season from the Fruchtart and never substitutes the Vorfrucht', () => {
    const [row] = buildBesydExportModel(makeExportData(), meta).impanbau;
    // winterWheat without a recorded sowing date → 1 October of the previous year
    expect(row.DATUMF).toBe('01.10.2024');
    expect(row.VFRUCHT).toBe('');
    expect(row.DATUMVF).toBe('');
  });

  test('a Vorfrucht without recorded sowing date gets its own derived season', () => {
    const data = makeExportData({
      fields: [
        makeField({
          cultivations: [
            makeCultivation({
              crop: 'silageMaize',
              previousCrop: 'winterWheat',
            }),
          ],
        }),
      ],
    });
    const [row] = buildBesydExportModel(data, meta).impanbau;
    expect(row.DATUMF).toBe('01.04.2025');
    expect(row.VFRUCHT).toBe('0102');
    expect(row.DATUMVF).toBe('01.10.2023');
  });

  test('IMPORG converts kg/m³ to % FM and fills P, P2O5, K, Mg', () => {
    const [row] = buildBesydExportModel(richData(), meta).imporg;
    // 4.2 kg N/m³ × 1.05 m³/t (convTtoCbm) = 4.41 kg/t → 0.441 % FM
    expect(row.MI_N).toBeCloseTo(0.441, 3);
    expect(row.MI_NH4).toBeCloseTo(0.2625, 3);
    expect(row.MI_P2O5).toBeCloseTo(0.189, 3);
    expect(row.MI_P).toBeCloseTo(0.189 * 0.4364, 3);
    expect(row.MI_K).toBeCloseTo(0.546 * 0.8301, 3);
    expect(row.MENGE).toBe(20);
    expect(row.MENGEGESAMT).toBe(20 * 12.5);
    expect(row.MICODE).toBe('241');
  });

  test('IMPMIND reports dt/ha and element percentages', () => {
    const [row] = buildBesydExportModel(richData(), meta).impmind;
    expect(row.MENGE).toBe(2);
    expect(row.MENGEGESAMT).toBe(25);
    expect(row.MI_N).toBe(12);
    expect(row.MI_P2O5).toBe(12);
    expect(row.MI_P).toBeCloseTo(12 * 0.4364, 3);
    expect(row.MI_K).toBeCloseTo(17 * 0.8301, 3);
    expect(row.MICODE).toBe('140');
  });

  test("a Herbstansaat's applications are booked on the field's Hauptfrucht row; without one they are left out", () => {
    const withMain = makeExportData({
      fields: [
        makeField({
          cultivations: [
            makeCultivation({ sowingDate: new Date('2024-10-05T00:00:00Z') }),
            makeHerbstansaat(),
          ],
        }),
      ],
    });
    const model = buildBesydExportModel(withMain, meta);
    expect(model.impanbau).toHaveLength(1);
    const pk = model.impmind.find((r) => r.MIBEZ === 'PK-Dünger 12+24');
    expect(pk).toMatchObject({
      DATUMF: '05.10.2024',
      FRUCHT: model.impanbau[0].FRUCHT,
      AADATUM: '31.10.2025',
      MENGE: 5,
    });

    const withoutMain = makeExportData({
      fields: [makeField({ cultivations: [makeHerbstansaat()] })],
    });
    const empty = buildBesydExportModel(withoutMain, meta);
    expect(empty.impanbau).toEqual([]);
    expect(empty.impmind).toEqual([]);
  });

  test('mineral code override wins', () => {
    const model = buildBesydExportModel(richData(), {
      ...meta,
      mineralFertilizerCodeOverrides: { MINERAL__CAN: '110' },
    });
    expect(model.impmind[0].MICODE).toBe('110');
  });

  test('IMPNMIN, IMPMAKRO, IMPERNTE and IMPNLEGUM are filled from the export data', () => {
    const model = buildBesydExportModel(richData(), meta);
    expect(model.impnmin).toHaveLength(1);
    expect(model.impnmin[0]).toMatchObject({
      NMIN30: 25,
      NMIN60: 20,
      NMIN90: 10,
      AADATUM: '01.03.2025',
    });
    expect(model.impnmin[0].NMIN_RW).toBeUndefined();

    expect(model.impmakro).toHaveLength(1);
    expect(model.impmakro[0].P).toBeCloseTo(4.364, 3);
    expect(model.impmakro[0].K).toBeCloseTo(16.602, 3);
    expect(model.impmakro[0].METHODPK).toBe('C');
    expect(model.impmakro[0].HUMUS).toBe(3.1);

    expect(model.impernte).toHaveLength(1);
    expect(model.impernte[0]).toMatchObject({
      ERTRAGHP: 42,
      RP: 22,
      ERNTEDAT: '30.07.2025',
    });

    expect(model.impnlegum).toHaveLength(1);
    expect(model.impnlegum[0].MICODE).toBe('0301');
    expect(model.impnlegumbetrieb).toHaveLength(1);
  });

  test('a planning Nmin files the Richtwert flag alone', () => {
    const data = makeExportData({
      fields: [
        makeField({
          cultivations: [
            makeCultivation({
              nmin: { date: null, kgPerHa: 40, layers: [], source: 'planning' },
            }),
          ],
        }),
      ],
    });
    const [row] = buildBesydExportModel(data, meta).impnmin;
    expect(row.NMIN_RW).toBe('j');
    expect(row.NMIN30).toBeUndefined();
  });

  test('IMPORG carries the Anlage 3 Mindestwirksamkeit, codes are quoted, dates bare', () => {
    const model = buildBesydExportModel(richData(), meta);
    expect(model.imporg[0].MINDESTWIRKSAMKEIT).toBe(60);
    const line = serializeBesydModel(model)['IMPORG.TXT'];
    expect(line).toContain('„241„');
    expect(line).toContain(';20.03.2025;');
    expect(line.startsWith('„120000000001„;„001„;„001„;2025;')).toBe(true);
  });

  test('IMPMIND resolves the Tabelle 24 REFERENCE_ID from the product name', () => {
    const [row] = buildBesydExportModel(richData(), meta).impmind;
    expect(row.REFERENCE_ID).toBe(160);
  });

  test('IMPWEIDE tables exist and stay empty without grazing data', () => {
    const files = serializeBesydModel(buildBesydExportModel(richData(), meta));
    expect(Object.keys(files)).toHaveLength(11);
    expect(files['IMPWEIDE.TXT']).toBe('');
    expect(files['IMPWEIDEBETRIEB.TXT']).toBe('');
  });

  test('IMPWEIDE rows from grazing on a cultivation', () => {
    const data = richData();
    data.fields[0].cultivations[0].grazing = [
      {
        animalGroup: '1',
        animalCode: '1130',
        animalName: 'Weibliche Zuchtrinder',
        animals: 20,
        days: 120,
        nKgPerAnimalDay: 0.2,
        p2o5KgPerAnimalDay: 0.05,
        endDate: new Date('2025-10-15T00:00:00Z'),
      },
    ];
    const model = buildBesydExportModel(data, meta);
    expect(model.impweide[0]).toMatchObject({
      MIGRUPPE: '1',
      MICODE: '1130',
      TIERZAHL: 20,
      WEIDET: 120,
      AADATUM: '15.10.2025',
    });
    expect(model.impweidebetrieb).toHaveLength(1);
  });
});
