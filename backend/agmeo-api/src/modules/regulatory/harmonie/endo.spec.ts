import { generateEndoFilename, serializeEndoXml } from './endo/builder.js';
import {
  DEFAULT_BETRIEBSDATEN,
  DEFAULT_DUENGEJAHRBEGINN,
  DEFAULT_NATURRAUM,
  DUENGEJAHRBEGINN_OPTIONS,
  getEffectiveEndoMetadata,
  NATURRAUM_OPTIONS,
} from './endo/defaults.js';
import type { EndoExportModel } from './endo/types.js';
import { ENNI_ENDO_VERSION } from './shared/defaults.js';
import {
  getFruchtart,
  searchFruchtartCatalogue,
} from './shared/fruchtartCodes.js';
import { assignSchlagnummern } from './shared/xmlHelpers.js';
import {
  formatExportDate,
  formatExportDecimal,
  getDuengejahrWindow,
} from './utils.js';

// Minimal model helper for XML tests
const minimalModel = (
  overrides?: Partial<EndoExportModel>,
): EndoExportModel => ({
  betrieb: {
    betriebsnummer: '276010000000001',
  },
  duengebedarf: {
    bezugsjahr: '2025',
    duengejahrbeginn: 'JANUAR',
    betriebsdaten: {
      'andere-duenger-ausgebracht': false,
      'kompost-ausgebracht': false,
      'duengungs-oder-beweidungseinschraenkungen': false,
    },
    schlaege: [],
  },
  dokumentationDerDuengung: [],
  n170: {
    flaechen: {
      'flaeche-ackerbau': '0.00',
      'flaeche-gruenland': '0.00',
      'flaeche-gartenbau': '0.00',
      'flaechensumme-n-170': '0.00',
    },
    tierhaltungen: [],
    organischeDuengerAufnahmen: [],
    organischeDuengerAbgaben: [],
    hofeigeneBiogasanlage: undefined,
  },
  ...overrides,
});

describe('ENDO Export Module', () => {
  describe('Default Values', () => {
    test('DEFAULT_BETRIEBSDATEN has correct structure', () => {
      expect(DEFAULT_BETRIEBSDATEN['andere-duenger-ausgebracht']).toBe(false);
      expect(DEFAULT_BETRIEBSDATEN['kompost-ausgebracht']).toBe(false);
      expect(
        DEFAULT_BETRIEBSDATEN['duengungs-oder-beweidungseinschraenkungen'],
      ).toBe(false);
    });

    test('DEFAULT_DUENGEJAHRBEGINN is JANUAR', () => {
      expect(DEFAULT_DUENGEJAHRBEGINN).toBe('JANUAR');
    });

    test('DEFAULT_NATURRAUM is Geest', () => {
      expect(DEFAULT_NATURRAUM).toBe('Geest');
    });

    test('ENNI_ENDO_VERSION is Dube2.5', () => {
      expect(ENNI_ENDO_VERSION).toBe('Dube2.5');
    });

    test('DUENGEJAHRBEGINN_OPTIONS has 12 months (all months)', () => {
      expect(DUENGEJAHRBEGINN_OPTIONS).toHaveLength(12);
      const values = DUENGEJAHRBEGINN_OPTIONS.map((o) => o.value);
      expect(values).toContain('JANUAR');
      expect(values).toContain('AUGUST');
      expect(values).toContain('DEZEMBER');
    });

    test('NATURRAUM_OPTIONS has 3 SH regions', () => {
      expect(NATURRAUM_OPTIONS).toHaveLength(3);
      const values = NATURRAUM_OPTIONS.map((o) => o.value);
      expect(values).toEqual(['Marsch', 'Geest', 'Hügelland']);
    });
  });

  describe('Shared Utilities', () => {
    test('getDuengejahrWindow defaults to the calendar year', () => {
      const window = getDuengejahrWindow(2025);
      expect(window.year).toBe(2025);
      expect(formatExportDate(window.start)).toBe('2025-01-01');
      expect(formatExportDate(window.end)).toBe('2025-12-31');
    });

    test('formatExportDecimal with 4dp for flaeche', () => {
      expect(formatExportDecimal(10.5, 4)).toBe('10.5000');
      expect(formatExportDecimal(0, 4)).toBe('0.0000');
    });

    test('formatExportDecimal with 6dp default for menge', () => {
      expect(formatExportDecimal(1.5)).toBe('1.500000');
      expect(formatExportDecimal(null)).toBe('0.000000');
      expect(formatExportDecimal(undefined)).toBe('0.000000');
    });

    test('getFruchtart uses overrides', () => {
      const overrides = { winterWheat: 'CustomCode001' };
      const result = getFruchtart('winterWheat', overrides);
      expect(result?.code).toBe('CustomCode001');
    });

    test('searchFruchtartCatalogue finds matching entries', () => {
      const results = searchFruchtartCatalogue('weizen');
      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe('ENNI + ENDO shared helpers', () => {
    test('assignSchlagnummern uses numeric Parzellennummern and fills the gaps deterministically', () => {
      const nummern = assignSchlagnummern([
        { id: 'a', parcelId: '42' },
        { id: 'b', parcelId: '007' },
        { id: 'c', parcelId: null },
        { id: 'd', parcelId: 'ABC-123' },
        { id: 'e', parcelId: '42' },
        { id: 'f', parcelId: '1' },
      ]);
      expect([...nummern.entries()]).toEqual([
        ['a', '42'],
        ['b', '7'],
        ['f', '1'],
        ['c', '2'],
        ['d', '3'],
        ['e', '4'],
      ]);
    });
  });

  describe('Effective Metadata', () => {
    test('getEffectiveEndoMetadata returns defaults when no metadata', () => {
      const result = getEffectiveEndoMetadata();
      expect(result.betriebsnummer).toBe('');
      expect(result.duengejahrbeginn).toBe('JANUAR');
      expect(result.naturraum).toBe('Geest');
      expect(result.betriebsdatenOverrides['andere-duenger-ausgebracht']).toBe(
        false,
      );
      expect(result.cropCodeOverrides).toEqual({});
    });

    test('getEffectiveEndoMetadata merges overrides', () => {
      const result = getEffectiveEndoMetadata({
        betriebsnummer: '123456789012345',
        naturraum: 'Marsch',
        betriebsdatenOverrides: { 'kompost-ausgebracht': true },
      });
      expect(result.betriebsnummer).toBe('123456789012345');
      expect(result.naturraum).toBe('Marsch');
      expect(result.betriebsdatenOverrides['kompost-ausgebracht']).toBe(true);
      expect(result.betriebsdatenOverrides['andere-duenger-ausgebracht']).toBe(
        false,
      );
    });
  });

  describe('XML Serialization — XSD Compliance', () => {
    test('serializeEndoXml produces valid ENDO root element', () => {
      const xmlStr = serializeEndoXml(minimalModel());

      expect(xmlStr).toContain('<?xml version="1.0" encoding="UTF-8"?>');
      expect(xmlStr).toContain(`<endo version="${ENNI_ENDO_VERSION}">`);
      expect(xmlStr).toContain('</endo>');
    });

    test('ENDO root has no softwarehersteller or datenherkunft', () => {
      const xmlStr = serializeEndoXml(minimalModel());

      expect(xmlStr).not.toContain('<softwarehersteller>');
      expect(xmlStr).not.toContain('<datenherkunft>');
    });

    test('betriebsstaette is always present (REQUIRED per XSD)', () => {
      const model = minimalModel({
        betrieb: { betriebsnummer: '123' },
      });
      const xmlStr = serializeEndoXml(model);

      // Even without address data, the element must be present
      expect(xmlStr).toContain('<betriebsstaette');
    });

    test('betriebsstaette includes address when provided', () => {
      const model = minimalModel({
        betrieb: {
          betriebsnummer: '123',
          betriebsstaette: {
            adresse: {
              firma: 'Test Farm',
              strasse: 'Hauptstr. 1',
              plz: '24103',
              ort: 'Kiel',
            },
          },
        },
      });
      const xmlStr = serializeEndoXml(model);

      expect(xmlStr).toContain('<firma>Test Farm</firma>');
      expect(xmlStr).toContain('<plz>24103</plz>');
      expect(xmlStr).toContain('<ort>Kiel</ort>');
    });

    test('schlag uses naturraum instead of bodenklimaraum', () => {
      const model = minimalModel({
        duengebedarf: {
          bezugsjahr: '2025',
          duengejahrbeginn: 'JANUAR',
          betriebsdaten: {
            'andere-duenger-ausgebracht': false,
            'kompost-ausgebracht': false,
            'duengungs-oder-beweidungseinschraenkungen': false,
          },
          schlaege: [
            {
              schlagnummer: '1',
              schlagname: 'Feld 1',
              naturraum: 'Hügelland',
              flaeche: '10.5000',
              nutzungsart: 'ACKER',
              anbauten: [],
            },
          ],
        },
      });
      const xmlStr = serializeEndoXml(model);

      expect(xmlStr).toContain('<naturraum>Hügelland</naturraum>');
      expect(xmlStr).not.toContain('<bodenklimaraum>');
    });

    test('schlag does not include kulisse-alt fields', () => {
      const model = minimalModel({
        duengebedarf: {
          bezugsjahr: '2025',
          duengejahrbeginn: 'JANUAR',
          betriebsdaten: {
            'andere-duenger-ausgebracht': false,
            'kompost-ausgebracht': false,
            'duengungs-oder-beweidungseinschraenkungen': false,
          },
          schlaege: [
            {
              schlagnummer: '1',
              schlagname: 'Test',
              flaeche: '5.0000',
              nutzungsart: 'ACKER',
              'n-kulisse': true,
              'p-kulisse': false,
              anbauten: [],
            },
          ],
        },
      });
      const xmlStr = serializeEndoXml(model);

      expect(xmlStr).toContain('<n-kulisse>true</n-kulisse>');
      expect(xmlStr).not.toContain('<n-kulisse-alt>');
      expect(xmlStr).not.toContain('<p-kulisse-alt>');
    });

    test('anbau uses ERSTEFRUCHT (not HAUPTFRUCHT)', () => {
      const model = minimalModel({
        duengebedarf: {
          bezugsjahr: '2025',
          duengejahrbeginn: 'JANUAR',
          betriebsdaten: {
            'andere-duenger-ausgebracht': false,
            'kompost-ausgebracht': false,
            'duengungs-oder-beweidungseinschraenkungen': false,
          },
          schlaege: [
            {
              schlagnummer: '1',
              schlagname: 'Test',
              flaeche: '5.0000',
              nutzungsart: 'ACKER',
              anbauten: [
                {
                  fruchtklasse: 'ERSTEFRUCHT',
                  'lfd-nr': 1,
                  fruchtart: 'WGetreide001',
                  'fruchtart-bezeichnung': 'Winterweizen',
                  bezugszeitraum: '2025',
                  'anbau-im-fremdbetrieb': false,
                },
              ],
            },
          ],
        },
      });
      const xmlStr = serializeEndoXml(model);

      expect(xmlStr).toContain('<fruchtklasse>ERSTEFRUCHT</fruchtklasse>');
      expect(xmlStr).not.toContain('HAUPTFRUCHT');
    });
  });

  describe('XML Serialization — Duengung Optionality', () => {
    test('duenger-bezeichnung is included when present', () => {
      const model = minimalModel({
        duengebedarf: {
          bezugsjahr: '2025',
          duengejahrbeginn: 'JANUAR',
          betriebsdaten: {
            'andere-duenger-ausgebracht': false,
            'kompost-ausgebracht': false,
            'duengungs-oder-beweidungseinschraenkungen': false,
          },
          schlaege: [
            {
              schlagnummer: '1',
              schlagname: 'Test',
              flaeche: '5.0000',
              nutzungsart: 'ACKER',
              anbauten: [
                {
                  fruchtklasse: 'ERSTEFRUCHT',
                  'lfd-nr': 1,
                  bezugszeitraum: '2025',
                  duengungen: [
                    {
                      aufbringdatum: '2025-03-15',
                      'duenger-bezeichnung': 'Kalkammonsalpeter',
                      'duenger-bezeichnung-betrieb': 'KAS',
                      naehrstofftraegerart: 'MINERALDUENGER',
                      'menge-in-einheit-naehrstofftraeger-pro-ha': '120.0000',
                    },
                  ],
                },
              ],
            },
          ],
        },
      });
      const xmlStr = serializeEndoXml(model);

      expect(xmlStr).toContain(
        '<duenger-bezeichnung>Kalkammonsalpeter</duenger-bezeichnung>',
      );
    });

    test('duenger-bezeichnung can be omitted (minOccurs=0 per XSD)', () => {
      const model = minimalModel({
        duengebedarf: {
          bezugsjahr: '2025',
          duengejahrbeginn: 'JANUAR',
          betriebsdaten: {
            'andere-duenger-ausgebracht': false,
            'kompost-ausgebracht': false,
            'duengungs-oder-beweidungseinschraenkungen': false,
          },
          schlaege: [
            {
              schlagnummer: '1',
              schlagname: 'Test',
              flaeche: '5.0000',
              nutzungsart: 'ACKER',
              anbauten: [
                {
                  fruchtklasse: 'ERSTEFRUCHT',
                  'lfd-nr': 1,
                  bezugszeitraum: '2025',
                  duengungen: [
                    {
                      aufbringdatum: '2025-03-15',
                      'duenger-bezeichnung-betrieb': 'My Custom Fertilizer',
                      naehrstofftraegerart: 'SONSTIGE',
                      'menge-in-einheit-naehrstofftraeger-pro-ha': '50.0000',
                    },
                  ],
                },
              ],
            },
          ],
        },
      });
      const xmlStr = serializeEndoXml(model);

      expect(xmlStr).not.toContain('<duenger-bezeichnung>');
      expect(xmlStr).toContain(
        '<duenger-bezeichnung-betrieb>My Custom Fertilizer</duenger-bezeichnung-betrieb>',
      );
    });

    test('mistduengung is included when present', () => {
      const model = minimalModel({
        duengebedarf: {
          bezugsjahr: '2025',
          duengejahrbeginn: 'JANUAR',
          betriebsdaten: {
            'andere-duenger-ausgebracht': false,
            'kompost-ausgebracht': false,
            'duengungs-oder-beweidungseinschraenkungen': false,
          },
          schlaege: [
            {
              schlagnummer: '1',
              schlagname: 'Test',
              flaeche: '5.0000',
              nutzungsart: 'ACKER',
              anbauten: [
                {
                  fruchtklasse: 'ERSTEFRUCHT',
                  'lfd-nr': 1,
                  bezugszeitraum: '2025',
                  duengungen: [
                    {
                      aufbringdatum: '2025-04-01',
                      'duenger-bezeichnung-betrieb': 'Stallmist',
                      naehrstofftraegerart: 'WIRTSCHAFTSDUENGER',
                      'menge-in-einheit-naehrstofftraeger-pro-ha': '80.0000',
                      mistduengung: true,
                    },
                  ],
                },
              ],
            },
          ],
        },
      });
      const xmlStr = serializeEndoXml(model);

      expect(xmlStr).toContain('<mistduengung>true</mistduengung>');
    });

    test('mistduengung can be omitted (minOccurs=0 per XSD)', () => {
      const model = minimalModel({
        duengebedarf: {
          bezugsjahr: '2025',
          duengejahrbeginn: 'JANUAR',
          betriebsdaten: {
            'andere-duenger-ausgebracht': false,
            'kompost-ausgebracht': false,
            'duengungs-oder-beweidungseinschraenkungen': false,
          },
          schlaege: [
            {
              schlagnummer: '1',
              schlagname: 'Test',
              flaeche: '5.0000',
              nutzungsart: 'ACKER',
              anbauten: [
                {
                  fruchtklasse: 'ERSTEFRUCHT',
                  'lfd-nr': 1,
                  bezugszeitraum: '2025',
                  duengungen: [
                    {
                      aufbringdatum: '2025-03-15',
                      'duenger-bezeichnung-betrieb': 'KAS',
                      naehrstofftraegerart: 'MINERALDUENGER',
                      'menge-in-einheit-naehrstofftraeger-pro-ha': '120.0000',
                    },
                  ],
                },
              ],
            },
          ],
        },
      });
      const xmlStr = serializeEndoXml(model);

      expect(xmlStr).not.toContain('<mistduengung>');
    });
  });

  describe('XML Serialization — General', () => {
    test('serializeEndoXml escapes special characters', () => {
      const model = minimalModel({
        betrieb: {
          betriebsnummer: '123',
          ansprechpartner: {
            adresse: { firma: 'Test & <Company>' },
          },
          betriebsstaette: {},
        },
      });
      const xmlStr = serializeEndoXml(model);

      expect(xmlStr).toContain('Test &amp; &lt;Company&gt;');
    });

    test('serializeEndoXml includes FLIK when present', () => {
      const model = minimalModel({
        duengebedarf: {
          bezugsjahr: '2025',
          duengejahrbeginn: 'JANUAR',
          betriebsdaten: {
            'andere-duenger-ausgebracht': false,
            'kompost-ausgebracht': false,
            'duengungs-oder-beweidungseinschraenkungen': false,
          },
          schlaege: [
            {
              schlagnummer: '1',
              schlagname: 'Test',
              flaeche: '10.0000',
              flik: 'DESHLI1234567890',
              nutzungsart: 'ACKER',
              anbauten: [],
            },
          ],
        },
      });
      const xmlStr = serializeEndoXml(model);

      expect(xmlStr).toContain('<flik>DESHLI1234567890</flik>');
    });

    test('serializeEndoXml handles all nutzungsart types', () => {
      const nutzungsartTypes = [
        'ACKER',
        'GRUENLAND',
        'GARTENBAU',
        'ACKER-GARTENBAU',
        'ACKER-GRUENLAND',
        'GRUENLAND-GARTENBAU',
        'KEINE-AUFZEICHNUNGSPFLICHT',
      ] as const;

      for (const nutzungsart of nutzungsartTypes) {
        const model = minimalModel({
          duengebedarf: {
            bezugsjahr: '2025',
            duengejahrbeginn: 'JANUAR',
            betriebsdaten: {
              'andere-duenger-ausgebracht': false,
              'kompost-ausgebracht': false,
              'duengungs-oder-beweidungseinschraenkungen': false,
            },
            schlaege: [
              {
                schlagnummer: '1',
                schlagname: 'Test',
                flaeche: '5.0000',
                nutzungsart,
                anbauten: [],
              },
            ],
          },
        });
        const xmlStr = serializeEndoXml(model);
        expect(xmlStr).toContain(`<nutzungsart>${nutzungsart}</nutzungsart>`);
      }
    });

    test('serializeEndoXml includes oekologisch-zertifiziert when set', () => {
      const model = minimalModel({
        duengebedarf: {
          bezugsjahr: '2025',
          duengejahrbeginn: 'JANUAR',
          betriebsdaten: {
            'andere-duenger-ausgebracht': false,
            'kompost-ausgebracht': false,
            'duengungs-oder-beweidungseinschraenkungen': false,
            'oekologisch-zertifiziert': true,
          },
          schlaege: [],
        },
      });
      const xmlStr = serializeEndoXml(model);

      expect(xmlStr).toContain(
        '<oekologisch-zertifiziert>true</oekologisch-zertifiziert>',
      );
    });
  });

  describe('Filename Generation', () => {
    test('generateEndoFilename creates correct filename', () => {
      expect(generateEndoFilename('276010000000001', 2025)).toBe(
        'ENDO_276010000000001_2025.xml',
      );
    });

    test('generateEndoFilename sanitizes special characters', () => {
      expect(generateEndoFilename('12/34-56', 2025)).toBe(
        'ENDO_12_34_56_2025.xml',
      );
    });
  });
});
