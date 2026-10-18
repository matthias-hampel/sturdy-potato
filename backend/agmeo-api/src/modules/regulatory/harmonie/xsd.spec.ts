/**
 * The generated ENNI / ENDO files must validate against the official XSDs —
 * the first stage of the authorities' import.
 */

import { buildEndoFromExportData, serializeEndoXml } from './endo/builder.js';
import { buildEnniFromExportData, serializeEnniXml } from './enni/builder.js';
import type { ExportData } from './types.js';

import {
  makeCultivation,
  makeExportData,
  makeField,
  makeHerbstansaat,
  makeMineralFertilization,
  makeOrganicFertilization,
  makeSoilSample,
} from './__fixtures__/exportData.js';
import {
  validateEndoXsd,
  validateEnniXsd,
} from './__fixtures__/validateXsd.js';

const fullData = (): ExportData =>
  makeExportData({
    integrations: {
      n170: {
        '2025': {
          hofeigeneBiogasanlage: true,
          tierhaltungen: [
            {
              tierBezeichnung: 'Milchkühe',
              anzahlTiere: 80,
              weidetage: 120,
              milchleistungKgEcm: 8500,
            },
          ],
          organischeDuengerAufnahmen: [
            {
              duengerBezeichnung: 'Gärrest flüssig',
              naehrstofftraegerart: 'WIRTSCHAFTSDUENGER',
              lieferdatum: '2025-04-26',
              beteiligterBetrieb: '276030000000002',
              menge: 260,
              gehaltNGesamt: 4.7,
              gehaltP2o5: 1.3,
            },
          ],
          organischeDuengerAbgaben: [],
        },
      },
    },
    fields: [
      makeField({
        soilTypeLufa: 'lS',
        nitrateSensitiveZone: true,
        soilSamples: [makeSoilSample()],
        cultivations: [
          makeCultivation({
            sowingDate: new Date('2024-10-05T00:00:00Z'),
            harvest: {
              date: new Date('2025-08-01T00:00:00Z'),
              yieldDtPerHa: 82.5,
              proteinPercent: 12.4,
            },
            previousCrop: 'canola',
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
            filmOrFleece: true,
            fertilizations: [
              makeMineralFertilization(),
              makeOrganicFertilization({
                isMistDuengung: true,
                carrierUnit: 'kg / t',
                articleFqn: 'ORGANIC__BARN_FRESH_MANURE_CATTLE__25',
                articleId: 'ORGANIC__BARN_FRESH_MANURE_CATTLE__25',
                unit: 't_ha',
                quantity: 20,
                carrierAmountPerHa: 20,
              }),
            ],
          }),
          makeCultivation({
            cultivationId: 'cult-2',
            cultivationGroupId: 'cg-2',
            crop: 'vetchIntercrop',
            areaInHa: 12.5,
            cropRole: 'INTERCROP',
            sowingDate: new Date('2025-08-20T00:00:00Z'),
            fertilizations: [],
          }),
        ],
      }),
      makeField({
        id: 'field-2',
        name: 'Grünland Süd',
        parcelId: '7',
        flik: 'DENILI0987654321',
        cultivations: [
          makeCultivation({
            cultivationId: 'cult-3',
            cultivationGroupId: 'cg-3',
            crop: 'permanentGrasslandWiltedSilage',
            fertilizations: [makeOrganicFertilization()],
          }),
        ],
      }),
    ],
  });

const enniMeta = {
  betriebsnummer: '276030000000001',
  bodenklimaraum: 'BKR_45' as const,
  ansprechpartner: {
    adresse: { vorname: 'Max', nachname: 'Muster', email: 'max@example.com' },
  },
  betriebsstaette: {
    adresse: { strasse: 'Dorfstraße 1', plz: '29308', ort: 'Winsen' },
  },
};
const endoMeta = {
  betriebsnummer: '276010000000001',
  naturraum: 'Geest' as const,
  betriebsstaette: { adresse: { ort: 'Kiel' } },
};

describe('XSD validation', () => {
  test('full ENNI export validates against the ENNI 2025 XSD', async () => {
    const xml = serializeEnniXml(buildEnniFromExportData(fullData(), enniMeta));
    const result = await validateEnniXsd(xml);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
    expect(xml).toContain('<vorfruchtart>Oelsaat005</vorfruchtart>');
    expect(xml).toContain('<n-min>45.000000</n-min>');
    expect(xml).toContain('<ertrag>82.500000</ertrag>');
    expect(xml).toContain('<fruchtklasse>HERBSTANSAAT</fruchtklasse>');
    expect(xml).toContain('<aussaattermin>15.08. bis 15.09.</aussaattermin>');
    expect(xml).toContain('<nmin-probenahmetiefe>90</nmin-probenahmetiefe>');
    expect(xml).toContain('<bodenuntersuchung>');
    expect(xml).toContain('<dokumentation-der-duengung>');
    expect(xml).toContain('<n-170-begrenzung>');
    // §13a is unenforced in 2026 — the Kulisse is only filed on opt-in
    expect(xml).toContain('<n-kulisse>false</n-kulisse>');
  });

  test('ENNI files the Nitratkulisse only when the farm opts in', async () => {
    const xml = serializeEnniXml(
      buildEnniFromExportData(fullData(), { ...enniMeta, nKulisse: true }),
    );
    expect((await validateEnniXsd(xml)).valid).toBe(true);
    expect(xml).toContain('<n-kulisse>true</n-kulisse>');
  });

  test('a crop-less field is a KEINE-AUFZEICHNUNGSPFLICHT Schlag without anbauten in both dialects', async () => {
    const data = makeExportData({
      fields: [
        makeField(),
        makeField({
          id: 'field-2',
          name: 'Bauland Brache',
          parcelId: '88',
          flik: 'DENILI2325060012',
          soilTypeLufa: 'lS',
          soilSamples: [makeSoilSample()],
          cultivations: [],
        }),
      ],
    });
    const enni = serializeEnniXml(buildEnniFromExportData(data, enniMeta));
    expect((await validateEnniXsd(enni)).errors).toEqual([]);
    const endo = serializeEndoXml(buildEndoFromExportData(data, endoMeta));
    expect((await validateEndoXsd(endo)).errors).toEqual([]);
    for (const xml of [enni, endo]) {
      const nameAt = xml.indexOf('<schlagname>Bauland Brache</schlagname>');
      const brache = xml.slice(
        xml.lastIndexOf('<schlag>', nameAt),
        xml.lastIndexOf('</schlag>'),
      );
      expect(brache).toContain('<schlagnummer>88</schlagnummer>');
      expect(brache).toContain('<flik>DENILI2325060012</flik>');
      expect(brache).toContain(
        '<nutzungsart>KEINE-AUFZEICHNUNGSPFLICHT</nutzungsart>',
      );
      expect(brache).toContain('<bodenuntersuchung>');
      expect(brache).not.toContain('<anbauten>');
      expect(xml.match(/<schlag>/g)).toHaveLength(2);
    }
  });

  test("autumn applications on next year's crop are a HERBSTANSAAT anbau of this year in both dialects", async () => {
    const data = makeExportData({
      fields: [
        makeField({
          cultivations: [
            makeCultivation({
              sowingDate: new Date('2024-10-05T00:00:00Z'),
              harvest: {
                date: new Date('2025-08-01T00:00:00Z'),
                yieldDtPerHa: 82.5,
                proteinPercent: null,
              },
              previousCrop: 'canola',
            }),
            makeHerbstansaat({ sowingDate: null }),
          ],
        }),
      ],
    });
    const enni = serializeEnniXml(buildEnniFromExportData(data, enniMeta));
    expect((await validateEnniXsd(enni)).errors).toEqual([]);
    const endo = serializeEndoXml(buildEndoFromExportData(data, endoMeta));
    expect((await validateEndoXsd(endo)).errors).toEqual([]);
    for (const xml of [enni, endo]) {
      const anbauten = xml.split('<anbau>').slice(1);
      expect(anbauten).toHaveLength(2);
      const herbst = anbauten[1];
      expect(herbst).toContain('<fruchtklasse>HERBSTANSAAT</fruchtklasse>');
      expect(herbst).toContain('<lfd-nr>2</lfd-nr>');
      expect(herbst).toContain('<bezugszeitraum>2025</bezugszeitraum>');
      expect(herbst).toContain('<fruchtart>Mais00');
      expect(herbst).toContain('<kulturfolge>2</kulturfolge>');
      expect(herbst).toContain('<aufbringdatum>2025-10-31</aufbringdatum>');
      expect(herbst).toContain(
        '<menge-in-einheit-naehrstofftraeger-pro-ha>5.0000</menge-in-einheit-naehrstofftraeger-pro-ha>',
      );
      expect(herbst).not.toContain('<ertrag>');
      expect(herbst).not.toContain('<n-min>');
      expect(herbst).not.toContain('<aussaattermin>');
      // the wheat keeps its own harvest and stays the Hauptfrucht
      expect(anbauten[0]).toContain('<ertrag>82.500000</ertrag>');
      expect(anbauten[0]).toMatch(
        /<fruchtklasse>(HAUPTFRUCHT|ERSTEFRUCHT)<\/fruchtklasse>/,
      );
      expect(xml).toContain('PK-Dünger 12+24');
    }
  });

  test('a P/K/Mg/pH lab sample without humus value is filed as HUMUSARM without humusgehalt', async () => {
    const data = makeExportData({
      fields: [
        makeField({
          soilTypeLufa: 'lS',
          soilSamples: [makeSoilSample({ humus: null })],
        }),
      ],
    });
    const xml = serializeEnniXml(buildEnniFromExportData(data, enniMeta));
    expect((await validateEnniXsd(xml)).errors).toEqual([]);
    expect(xml).toContain('<analysenr>field-1-2024-04-01</analysenr>');
    expect(xml).toContain(
      '<bodenartgruppe>schwach lehmiger Sand</bodenartgruppe>',
    );
    expect(xml).toContain('<humusklasse>HUMUSARM</humusklasse>');
    expect(xml).not.toContain('<humusgehalt>');
    // without a soil type the mandatory bodenartgruppe cannot be filled — the sample is skipped
    const noSoilType = makeExportData({
      fields: [makeField({ soilSamples: [makeSoilSample()] })],
    });
    expect(
      serializeEnniXml(buildEnniFromExportData(noSoilType, enniMeta)),
    ).not.toContain('<bodenuntersuchung>');
  });

  test('an export whose fields all lack a cultivation validates and omits the DdD / 170 N sections', async () => {
    const data = makeExportData({ fields: [makeField({ cultivations: [] })] });
    const enni = serializeEnniXml(buildEnniFromExportData(data, enniMeta));
    expect((await validateEnniXsd(enni)).errors).toEqual([]);
    expect(enni).toContain(
      '<nutzungsart>KEINE-AUFZEICHNUNGSPFLICHT</nutzungsart>',
    );
    expect(enni).not.toContain('<anbauten>');
    expect(enni).not.toContain('<dokumentation-der-duengung>');
    expect(enni).not.toContain('<n-170-begrenzung>');
    const endo = serializeEndoXml(buildEndoFromExportData(data, endoMeta));
    expect((await validateEndoXsd(endo)).errors).toEqual([]);
    expect(endo).not.toContain('<n-170-begrenzung>');
  });

  test('minimal ENNI export (no optional data) validates', async () => {
    const xml = serializeEnniXml(
      buildEnniFromExportData(makeExportData(), {
        betriebsnummer: '276030000000001',
      }),
    );
    const result = await validateEnniXsd(xml);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  test('full ENDO export validates against the Dube2.5 XSD', async () => {
    const xml = serializeEndoXml(buildEndoFromExportData(fullData(), endoMeta));
    const result = await validateEndoXsd(xml);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
    expect(xml).toContain('<fruchtklasse>ERSTEFRUCHT</fruchtklasse>');
    expect(xml).toContain(
      '<milchleistung-kg-ecm>8500.00</milchleistung-kg-ecm>',
    );
    expect(xml).toContain('<gehalt-p2o5>12.000000</gehalt-p2o5>');
    // SH Stammdaten codes, not the ENNI ones
    expect(xml).toContain('<fruchtart>WGetreide008</fruchtart>');
    expect(xml).toContain('<vorfruchtart>Oelsaat005</vorfruchtart>');
    expect(xml).toContain('<n-kulisse>true</n-kulisse>');
  });

  test('ENDO omits n-kulisse from Meldezeitraum 2026 on', async () => {
    const data = { ...fullData(), year: 2026 };
    const xml = serializeEndoXml(buildEndoFromExportData(data, endoMeta));
    expect((await validateEndoXsd(xml)).errors).toEqual([]);
    expect(xml).not.toContain('<n-kulisse>');
  });

  test('minimal ENDO export validates', async () => {
    const xml = serializeEndoXml(
      buildEndoFromExportData(makeExportData(), {
        betriebsnummer: '276010000000001',
      }),
    );
    const result = await validateEndoXsd(xml);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  test('the validator rejects a document with an element the XSD does not know', async () => {
    const xml = serializeEnniXml(
      buildEnniFromExportData(makeExportData(), {
        betriebsnummer: '276030000000001',
      }),
    );
    const invalid = xml.replace(
      '<betriebsnummer>',
      '<titel>Dr.</titel><betriebsnummer>',
    );
    const result = await validateEnniXsd(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.join('\n')).toMatch(/titel/);
  });

  test('ENNI never emits the ENDO-only milk yield element', () => {
    const xml = serializeEnniXml(buildEnniFromExportData(fullData(), enniMeta));
    expect(xml).not.toContain('milchleistung-kg-ecm');
  });
});
