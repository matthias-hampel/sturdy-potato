/**
 * Sachsen-Anhalt Mitteilungspflicht — golden output from the shared fixtures.
 */
import { buildJahressumme } from './shared/jahressumme.js';
import {
  buildStExportModel,
  generateStFilename,
  serializeStModel,
  type StOrgMetadata,
} from './st/index.js';

import {
  makeCultivation,
  makeExportData,
  makeField,
  makeHerbstansaat,
  makeMineralFertilization,
  makeOrganicFertilization,
  makeSoilSample,
} from './__fixtures__/exportData.js';

const meta: StOrgMetadata = {
  betriebsname: 'Agrar GmbH Börde',
  euBetriebsnummer: '151111111111',
  sitzPlz: '39387',
  sitzOrt: 'Oschersleben',
  sitzOrtsteil: 'Hornhausen',
  kreisNr: 83,
  bewirtschaftung: 'k',
  sitzInSt: true,
};

const dbe = {
  'cult-1': {
    nRequirementValue: 230,
    referenceYield: 80,
    farmYield: 85,
    yieldDifference: 5,
    yieldSurcharge: 5,
    nmin: 45,
    humusDeduction: 0,
    orgPreviousYearDeduction: 10,
    previousCropDeduction: 10,
    catchCropDeduction: 0,
    foilSurcharge: 0,
    nFertilizerNeed: 170,
    nitrateZoneReduction: 0,
    nFertilizerNeedFinal: 170,
    isGrassland: false,
    snapshotAt: '2025-02-10T09:30:00.000Z',
  },
};

const data = () =>
  makeExportData({
    federalState: 'ST',
    fields: [
      makeField({
        flik: 'DESTLI0512340001',
        parcelId: '7',
        soilTypeLufa: 'sL',
        nitrateSensitiveZone: true,
        soilSamples: [
          makeSoilSample({
            date: new Date('2023-03-10T12:00:00Z'),
            p2o5: 14,
            method: 'cal',
          }),
        ],
        areaInHa: 10,
        cultivations: [
          makeCultivation({
            areaInHa: 10,
            previousCrop: 'canola',
            harvest: {
              date: new Date('2025-07-28T00:00:00Z'),
              yieldDtPerHa: 86,
              proteinPercent: null,
            },
            nmin: {
              date: new Date('2025-02-20T12:00:00Z'),
              kgPerHa: 45,
              layers: [
                { from: 0, to: 30, value: 20 },
                { from: 30, to: 60, value: 15 },
                { from: 60, to: 90, value: 10 },
              ],
              source: 'lab',
            },
            fertilizations: [
              makeMineralFertilization(),
              makeOrganicFertilization({
                date: new Date('2025-08-15T08:00:00Z'),
              }),
            ],
          }),
          makeCultivation({
            cultivationId: 'cult-zf',
            cultivationGroupId: 'cg-zf',
            crop: 'mustardIntercrop',
            cropRole: 'INTERCROP',
            areaInHa: 10,
            fertilizations: [],
          }),
        ],
      }),
    ],
  });

describe('Sachsen-Anhalt export', () => {
  test('file names follow Anl5_<KreisNr>_<EU-BNR>_<Jahr>.TXT', () => {
    const files = serializeStModel(buildStExportModel(data(), meta, dbe));
    expect(Object.keys(files).sort()).toEqual([
      'Anl5_083_151111111111_2025.TXT',
      'DBE_083_151111111111_2025.TXT',
      'Duengungen_083_151111111111_2025.TXT',
      'Ertraege_083_151111111111_2025.TXT',
    ]);
    expect(generateStFilename('151111111111', 2025)).toBe(
      'ST_151111111111_2025.zip',
    );
  });

  test('DBE row: Schlag, Vorfrucht / Zwischenfrucht codes, §3(2) breakdown, P soil value', () => {
    const files = serializeStModel(buildStExportModel(data(), meta, dbe));
    const [line, ...rest] =
      files['DBE_083_151111111111_2025.TXT'].split('\r\n');
    expect(rest).toEqual([]);
    expect(line.split('\t')).toEqual([
      'Agrar GmbH Börde',
      '151111111111',
      '39387',
      'Oschersleben',
      'Hornhausen',
      '83',
      'Börde',
      'agmeo (Agvolution GmbH)',
      '2025',
      '10.02.2025',
      'DESTLI0512340001',
      '7',
      'ja',
      'nein',
      '10.00',
      'AL',
      'k',
      '4',
      '',
      'Winterraps',
      '236101',
      'Nichtleguminose, abgefroren',
      '6',
      'Winterweizen A, B',
      '224101',
      '230.00',
      '80.00',
      '85.00',
      '5.00',
      '0.00',
      '0.00',
      '0.00',
      '0.00',
      '0.00',
      '0.00',
      '45.00',
      '20.00',
      '15.00',
      '10.00',
      'U',
      'U',
      '5.00',
      '0.00',
      '0.00',
      '-10.00',
      '0.00',
      '-10.00',
      '0.00',
      '0.00',
      '0.00',
      '170.00',
      '0.00',
      '14.00',
      '10.03.2023',
      'CAL',
    ]);
  });

  test('Duengungen rows: Anlage 2 classes, amounts per Schlag and per ha, Herbstdüngung flag', () => {
    const files = serializeStModel(buildStExportModel(data(), meta, dbe));
    const [can, slurry] = files['Duengungen_083_151111111111_2025.TXT']
      .split('\r\n')
      .map((l) => l.split('\t'));
    expect(can.slice(9)).toEqual([
      '15.03.2025',
      'DESTLI0512340001',
      '7',
      'ja',
      'nein',
      '10.00',
      'AL',
      'k',
      'Winterweizen A, B',
      '224101',
      'Mineralische Düngemittel',
      'N-Dünger',
      'Kalkammonsalpeter',
      '0.30',
      '810.00',
      '810.00',
      '0.00',
      '81.00',
      '81.00',
      '0.00',
      'nein',
      '0.00',
      '0.00',
    ]);
    // Rindergülle 25 m³/ha: 105 kg N/ha total, 60 % Mindestwirksamkeit, after the 28 July harvest
    expect(slurry.slice(19)).toEqual([
      'Wirtschaftsdünger tierischer Herkunft',
      'Gülle Rind',
      'Rindergülle',
      '25.00',
      '1050.00',
      '630.00',
      '450.00',
      '105.00',
      '63.00',
      '45.00',
      'ja',
      '0.00',
      '0.00',
    ]);
  });

  test('a Herbstansaat adds Duengungen rows under the current Hauptfrucht and no DBE row', () => {
    const withHerbst = data();
    withHerbst.fields[0].cultivations.push(makeHerbstansaat({ areaInHa: 10 }));
    const model = buildStExportModel(withHerbst, meta, dbe);
    expect(model.dbe).toHaveLength(1);
    const pk = model.duengungen.find(
      (r) => r.bezeichnung === 'PK-Dünger 12+24',
    );
    expect(pk).toMatchObject({
      hf: 'Winterweizen A, B',
      hfNr: '224101',
      istHerbstDuengung: true,
      p2o5Menge: 600,
    });
    expect(model.ertraege).toHaveLength(1);

    const noMain = makeExportData({
      federalState: 'ST',
      fields: [
        makeField({
          flik: 'DESTLI0512340001',
          parcelId: '7',
          cultivations: [makeHerbstansaat()],
        }),
      ],
    });
    const rows = buildStExportModel(noMain, meta, {}).duengungen;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      hf: '',
      hfNr: '',
      parzelle: '7',
      feldblockId: 'DESTLI0512340001',
    });
  });

  test('Ertraege and Anl5 aggregate per crop and farm', () => {
    const withBrache = data();
    withBrache.fields.push(
      makeField({
        id: 'brache',
        name: 'Brache',
        areaInHa: 2.5,
        cultivations: [],
      }),
    );
    const model = buildStExportModel(withBrache, meta, dbe);
    // The crop-less field has no DBE / Duengungen row but belongs to the Betriebsgröße.
    expect(model.dbe).toHaveLength(1);
    expect(model.ertraege).toEqual([
      expect.objectContaining({
        hfNr: '224101',
        ertragFmBetrieb: 85,
        ertragTmBetriebGl: null,
        tatsErtrag: 86,
      }),
    ]);
    expect(model.anl5).toMatchObject({
      ackerlandHa: 10,
      gruenlandHa: 0,
      betriebsgroesseHa: 12.5,
      flaeche170Ha: 10,
      nBedarf: 1700,
      nMinDung: 810,
      nTierDung: 1050,
      nVerfTierDung: 630,
      nSumme: 1860,
      nSummeVerf: 1440,
      p2o5TierDung: 450,
      p2o5Summe: 450,
    });
    expect(model.anl5?.nSummePerHa).toBeCloseTo(186);
    const anl5 = serializeStModel(model)['Anl5_083_151111111111_2025.TXT'];
    expect(anl5.split('\t')).toHaveLength(39);
    expect(anl5).not.toContain('\n');
  });

  test('a farm seated outside Sachsen-Anhalt delivers only DBE and Duengungen', () => {
    const files = serializeStModel(
      buildStExportModel(
        data(),
        { ...meta, sitzInSt: false, euBetriebsnummer: '120000000001' },
        dbe,
      ),
    );
    expect(Object.keys(files).sort()).toEqual([
      'DBE_083_120000000001_2025.TXT',
      'Duengungen_083_120000000001_2025.TXT',
    ]);
  });

  test('Jahressumme separates animal manure from other organic fertilizers', () => {
    const summe = buildJahressumme(
      makeExportData({
        fields: [
          makeField({
            areaInHa: 2,
            cultivations: [
              makeCultivation({
                areaInHa: 2,
                fertilizations: [
                  makeOrganicFertilization({
                    articleFqn: 'ORGANIC__FERMENTATION_RESIDUES_LIQUID__8',
                    nKgPerHa: 100,
                    p2o5KgPerHa: 20,
                  }),
                ],
              }),
            ],
          }),
        ],
      }),
      {},
    );
    expect(summe.sums.sonstigeOrganisch).toEqual({
      n: 200,
      nVerf: 120,
      p2o5: 40,
    });
    expect(summe.sums.tierisch.n).toBe(0);
    expect(summe.nBedarfKg).toBe(0);
  });
});
