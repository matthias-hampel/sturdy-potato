import { buildDuengerKatalog } from './shared/duengerKatalog.js';
import { mineralGroup, organicGroup } from './shared/fertilizerGroup.js';
import {
  aussaatterminPhrase,
  classifyCultivations,
  fruchtklasseName,
  kulturfolge,
} from './shared/fruchtklasse.js';
import { buildN170 } from './shared/n170Builder.js';
import {
  bodenartgruppeFromLufa,
  humusklasseFromPercent,
  p2o5ToP,
} from './shared/soil.js';

import {
  makeCultivation,
  makeExportData,
  makeField,
  makeHerbstansaat,
  makeMineralFertilization,
  makeOrganicFertilization,
} from './__fixtures__/exportData.js';

describe('Fruchtklasse', () => {
  test('single main crop is HAUPTFRUCHT / ERSTEFRUCHT', () => {
    const [klasse] = classifyCultivations([makeCultivation()]);
    expect(klasse).toBe('HAUPTFRUCHT');
    expect(fruchtklasseName(klasse, 'enni')).toBe('HAUPTFRUCHT');
    expect(fruchtklasseName(klasse, 'endo')).toBe('ERSTEFRUCHT');
  });

  test('grassland → GRUENLAND, intercrop → HERBSTANSAAT', () => {
    const klassen = classifyCultivations([
      makeCultivation({ crop: 'permanentGrasslandWiltedSilage' }),
      makeCultivation({
        cultivationId: 'c2',
        crop: 'mustardIntercrop',
        cropRole: 'INTERCROP',
      }),
    ]);
    expect(klassen).toEqual(['GRUENLAND', 'HERBSTANSAAT']);
  });

  test('two main crops: later sown becomes ZWEITFRUCHT (ZWEITEFRUCHT in ENDO)', () => {
    const klassen = classifyCultivations([
      makeCultivation({
        cultivationId: 'a',
        crop: 'silageMaize',
        sowingDate: new Date('2025-05-01'),
      }),
      makeCultivation({
        cultivationId: 'b',
        crop: 'winterBarleyFodder',
        sowingDate: new Date('2024-09-20'),
      }),
    ]);
    expect(klassen).toEqual(['ZWEITFRUCHT', 'HAUPTFRUCHT']);
    expect(fruchtklasseName('ZWEITFRUCHT', 'endo')).toBe('ZWEITEFRUCHT');
  });

  test("next year's crop with this year's autumn applications is HERBSTANSAAT and closes the Kulturfolge", () => {
    const cultivations = [
      makeHerbstansaat({ sowingDate: new Date('2024-03-01') }),
      makeCultivation({
        cultivationId: 'a',
        crop: 'silageMaize',
        sowingDate: new Date('2025-05-01'),
      }),
      makeCultivation({
        cultivationId: 'b',
        crop: 'winterBarleyFodder',
        sowingDate: new Date('2024-09-20'),
      }),
    ];
    // A Herbstansaat never competes for the HAUPTFRUCHT slot, whatever its sowing date says.
    expect(classifyCultivations(cultivations)).toEqual([
      'HERBSTANSAAT',
      'ZWEITFRUCHT',
      'HAUPTFRUCHT',
    ]);
    expect(kulturfolge(cultivations)).toEqual([3, 2, 1]);
  });

  test('kulturfolge numbers cultivations by sowing date', () => {
    const folge = kulturfolge([
      makeCultivation({
        cultivationId: 'a',
        sowingDate: new Date('2025-05-01'),
      }),
      makeCultivation({
        cultivationId: 'b',
        sowingDate: new Date('2024-09-20'),
      }),
    ]);
    expect(folge).toEqual([2, 1]);
  });

  test('aussaattermin buckets per dialect', () => {
    expect(aussaatterminPhrase(new Date('2025-08-30T00:00:00Z'), 'endo')).toBe(
      'bis 15.09.',
    );
    expect(aussaatterminPhrase(new Date('2025-09-15T00:00:00Z'), 'endo')).toBe(
      'bis 15.09.',
    );
    expect(aussaatterminPhrase(new Date('2025-09-25T00:00:00Z'), 'endo')).toBe(
      'bis 01.10.',
    );
    expect(aussaatterminPhrase(new Date('2025-10-12T00:00:00Z'), 'endo')).toBe(
      'nach 01.10.',
    );
    expect(aussaatterminPhrase(null, 'endo')).toBeNull();
    expect(aussaatterminPhrase(new Date('2025-08-10T00:00:00Z'), 'enni')).toBe(
      'bis 15.08., keine Ernte im Ansaatjahr',
    );
    expect(
      aussaatterminPhrase(new Date('2025-08-10T00:00:00Z'), 'enni', true),
    ).toBe('bis 15.08., Ernte im Ansaatjahr');
    expect(aussaatterminPhrase(new Date('2025-08-30T00:00:00Z'), 'enni')).toBe(
      '15.08. bis 15.09.',
    );
    expect(aussaatterminPhrase(new Date('2025-09-25T00:00:00Z'), 'enni')).toBe(
      'bis 01.10.',
    );
  });
});

describe('Dünger catalogue', () => {
  test('one entry per distinct article with contents per carrier unit', () => {
    const data = makeExportData({
      fields: [
        makeField({
          cultivations: [
            makeCultivation({
              fertilizations: [
                makeMineralFertilization(),
                makeOrganicFertilization(),
              ],
            }),
          ],
        }),
        makeField({
          id: 'f2',
          cultivations: [
            makeCultivation({
              cultivationId: 'c2',
              fertilizations: [makeMineralFertilization()],
            }),
          ],
        }),
      ],
    });
    const katalog = buildDuengerKatalog(data);
    expect(katalog).toHaveLength(2);
    const can = katalog.find(
      (d) => d['duenger-bezeichnung'] === 'Kalkammonsalpeter',
    )!;
    expect(can.einheit).toBe('kg / dt');
    expect(can['gehalt-N-gesamt']).toBe('27.000000');
    expect(can['gehalt-P2O5']).toBe('0.000000');
    expect(can.mineralduengergruppe).toBe('Stickstoffdünger');
    expect(can['art-der-werte']).toBe('STANDARD');
    const slurry = katalog.find(
      (d) => d['duenger-bezeichnung'] === 'Rindergülle',
    )!;
    expect(slurry.einheit).toBe('kg / cbm');
    expect(slurry.dunggruppe).toBe('Rindergülle');
    expect(slurry['gehalt-NH4']).toBe('2.500000');
    // Rindergülle: 60 % Mindestwirksamkeit of 4.2 kg N/m³
    expect(slurry['verfuegbar-N']).toBe('2.520000');
    expect(slurry['anteil-trockensubstanz']).toBe('8.000000');
  });

  test('custom articles are flagged ANALYSE', () => {
    const data = makeExportData({
      fields: [
        makeField({
          cultivations: [
            makeCultivation({
              fertilizations: [
                makeMineralFertilization({ isCustomArticle: true }),
              ],
            }),
          ],
        }),
      ],
    });
    expect(buildDuengerKatalog(data)[0]['art-der-werte']).toBe('ANALYSE');
  });
});

describe('Fertilizer groups', () => {
  test('mineral groups from nutrient presence', () => {
    expect(
      mineralGroup({
        n: 27,
        p2o5: null,
        k2o: null,
        mgo: null,
        articleFqn: 'MINERAL__CAN',
      }),
    ).toBe('N');
    expect(
      mineralGroup({
        n: 12,
        p2o5: 12,
        k2o: 17,
        mgo: null,
        articleFqn: 'MINERAL__NPK',
      }),
    ).toBe('NPK');
    expect(
      mineralGroup({
        n: null,
        p2o5: null,
        k2o: 40,
        mgo: 6,
        articleFqn: 'MINERAL__KORNKALI',
      }),
    ).toBe('K');
    expect(
      mineralGroup({
        n: null,
        p2o5: null,
        k2o: null,
        mgo: null,
        articleFqn: 'MINERAL__LIME_CARBONATE',
      }),
    ).toBe('Kalk');
  });

  test('organic groups from fqn', () => {
    expect(organicGroup('ORGANIC__SLURRY_CATTLE__5')).toBe('Rindergülle');
    expect(organicGroup('ORGANIC__SLURRY_PIG__3')).toBe('Schweinegülle');
    expect(organicGroup('ORGANIC__BARN_FRESH_MANURE_PIG__20')).toBe(
      'Schweinemist',
    );
    expect(organicGroup('ORGANIC__CHICKEN_DUNG__30')).toBe('Hähnchenmist');
    expect(organicGroup('ORGANIC__FERMENTATION_RESIDUES_LIQUID__8')).toBe(
      'Gärrest',
    );
    expect(organicGroup('ORGANIC__READY_COMPOST__40')).toBe('Kompost');
    expect(
      organicGroup('ORGANIC__SEWAGE_SLUDGE_LIMESTONE_STABILIZED__20'),
    ).toBe('Klärschlamm');
    expect(organicGroup('ORGANIC__STRAWS__86')).toBe(
      'Sonstiger organischer Dünger',
    );
  });
});

describe('Soil helpers', () => {
  test('humus classes per DüV', () => {
    expect(humusklasseFromPercent(2)).toBe('HUMUSARM');
    expect(humusklasseFromPercent(5)).toBe('STARK_HUMOS');
    expect(humusklasseFromPercent(10)).toBe('SEHR_STARK_HUMOS');
    expect(humusklasseFromPercent(20)).toBe('ANMOORIG');
    expect(humusklasseFromPercent(40)).toBe('NIEDERMOOR');
  });

  test('LUFA groups and oxide factors', () => {
    expect(bodenartgruppeFromLufa('lS')).toBe('schwach lehmiger Sand');
    expect(bodenartgruppeFromLufa(null)).toBeNull();
    expect(p2o5ToP(10)).toBeCloseTo(4.364);
  });
});

describe('170 N', () => {
  test('areas are summed per Nutzungsart from fields with cultivations', () => {
    const data = makeExportData({
      fields: [
        makeField({ areaInHa: 10 }),
        makeField({
          id: 'gl',
          areaInHa: 4,
          cultivations: [
            makeCultivation({ crop: 'permanentGrasslandWiltedSilage' }),
          ],
        }),
        makeField({ id: 'empty', areaInHa: 99, cultivations: [] }),
      ],
    });
    const n170 = buildN170(data, { hofeigeneBiogasanlage: false });
    expect(n170.flaechen['flaeche-ackerbau']).toBe('10.0000');
    expect(n170.flaechen['flaeche-gruenland']).toBe('4.0000');
    expect(n170.flaechen['flaeche-gartenbau']).toBe('0.0000');
    expect(n170.flaechen['flaechensumme-n-170']).toBe('14.0000');
    expect(n170.hofeigeneBiogasanlage).toBe(false);
    expect(n170.tierhaltungen).toEqual([]);
  });
});
