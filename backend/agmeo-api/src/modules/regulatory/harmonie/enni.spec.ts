import { serializeEnniXml } from './enni/builder.js';
import {
  DEFAULT_BETRIEBSDATEN,
  DEFAULT_DUENGEJAHRBEGINN,
  DUENGEJAHRBEGINN_OPTIONS,
} from './enni/defaults.js';
import type { EnniExportModel } from './enni/types.js';
import {
  getFruchtart,
  searchFruchtartCatalogue,
} from './shared/fruchtartCodes.js';
import {
  formatExportDate,
  formatExportDecimal,
  getDuengejahrWindow,
  isDateInWindow,
} from './utils.js';

describe('ENNI Export Module', () => {
  describe('Düngejahr window', () => {
    test('JANUAR is the calendar year', () => {
      const window = getDuengejahrWindow(2025);
      expect(window.year).toBe(2025);
      expect(window.beginn).toBe('JANUAR');
      expect(formatExportDate(window.start)).toBe('2025-01-01');
      expect(formatExportDate(window.end)).toBe('2025-12-31');
    });

    test('JULI reproduces the former Jul–Jun farm year', () => {
      const window = getDuengejahrWindow(2025, 'JULI');
      expect(formatExportDate(window.start)).toBe('2024-07-01');
      expect(formatExportDate(window.end)).toBe('2025-06-30');
    });

    test('DEZEMBER runs from 1 Dec (year-1) to 30 Nov', () => {
      const window = getDuengejahrWindow(2025, 'DEZEMBER');
      expect(formatExportDate(window.start)).toBe('2024-12-01');
      expect(formatExportDate(window.end)).toBe('2025-11-30');
    });

    test('MAERZ ends on the last day of February (leap year)', () => {
      const window = getDuengejahrWindow(2024, 'MAERZ');
      expect(formatExportDate(window.start)).toBe('2023-03-01');
      expect(formatExportDate(window.end)).toBe('2024-02-29');
    });

    test('isDateInWindow respects Berlin day boundaries', () => {
      const window = getDuengejahrWindow(2025, 'JULI');
      expect(isDateInWindow(new Date('2025-03-15T12:00:00Z'), window)).toBe(
        true,
      );
      expect(isDateInWindow(new Date('2024-06-30T22:00:00Z'), window)).toBe(
        true,
      ); // 1 Jul 00:00 Berlin
      expect(isDateInWindow(new Date('2024-06-30T12:00:00Z'), window)).toBe(
        false,
      );
      expect(isDateInWindow(new Date('2025-07-01T12:00:00Z'), window)).toBe(
        false,
      );
    });
  });

  describe('Date and Number Formatting', () => {
    test('formatExportDate formats dates correctly', () => {
      const date = new Date('2025-04-15T10:30:00Z');
      const formatted = formatExportDate(date);
      expect(formatted).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(formatted).toBe('2025-04-15');
    });

    test('formatExportDecimal formats numbers correctly', () => {
      expect(formatExportDecimal(1.5)).toBe('1.500000');
      expect(formatExportDecimal(0)).toBe('0.000000');
      expect(formatExportDecimal(123.456789)).toBe('123.456789');
      expect(formatExportDecimal(null)).toBe('0.000000');
      expect(formatExportDecimal(undefined)).toBe('0.000000');
    });

    test('formatExportDecimal respects decimal places parameter', () => {
      expect(formatExportDecimal(1.5, 2)).toBe('1.50');
      expect(formatExportDecimal(1.5, 0)).toBe('2');
    });
  });

  describe('Crop Code Mapping', () => {
    test('getFruchtart returns mapping for known crops', () => {
      const winterWheat = getFruchtart('winterWheat');
      expect(winterWheat).toBeDefined();
      expect(winterWheat?.code).toBe('WGetreide001');

      const silageMaize = getFruchtart('silageMaize');
      expect(silageMaize).toBeDefined();
      expect(silageMaize?.code).toBe('Mais005');

      const canola = getFruchtart('canola');
      expect(canola).toBeDefined();
      expect(canola?.code).toBe('Oelsaat005');
    });

    test('getFruchtart returns undefined for unknown crops', () => {
      const unknown = getFruchtart('unknownCrop');
      expect(unknown).toBeUndefined();
    });

    test('getFruchtart uses overrides', () => {
      const overrides = { winterWheat: 'CustomCode001' };
      const result = getFruchtart('winterWheat', overrides);
      expect(result?.code).toBe('CustomCode001');
    });

    test('searchFruchtartCatalogue finds matching entries', () => {
      const results = searchFruchtartCatalogue('weizen');
      expect(results.length).toBeGreaterThan(0);
      expect(
        results.some((r) => r.bezeichnung.toLowerCase().includes('weizen')),
      ).toBe(true);

      const codeResults = searchFruchtartCatalogue('WGetreide');
      expect(codeResults.length).toBeGreaterThan(0);
      expect(codeResults.some((r) => r.code.includes('WGetreide'))).toBe(true);
    });
  });

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

    test('DUENGEJAHRBEGINN_OPTIONS has all 12 months', () => {
      expect(DUENGEJAHRBEGINN_OPTIONS).toHaveLength(12);
      const values = DUENGEJAHRBEGINN_OPTIONS.map((o) => o.value);
      expect(values).toContain('JANUAR');
      expect(values).toContain('JULI');
    });
  });

  describe('XML Serialization', () => {
    test('serializeEnniXml produces valid XML structure', () => {
      const model: EnniExportModel = {
        softwarehersteller: 'agmeo',
        datenherkunft: 'SL',
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
        betrieb: {
          betriebsnummer: '276030000000001',
        },
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
              schlagname: 'Test Field',
              bodenklimaraum: 'BKR_45',
              flaeche: '10.500000',
              nutzungsart: 'ACKER',
              'n-kulisse': false,
              'n-kulisse-alt': false,
              'p-kulisse': false,
              'p-kulisse-alt': false,
              anbauten: [
                {
                  fruchtklasse: 'HAUPTFRUCHT',
                  'lfd-nr': 1,
                  fruchtart: 'WGetreide001',
                  'fruchtart-bezeichnung': 'Winterweizen, A/B, 14% RP',
                  bezugszeitraum: '2025',
                  'anbau-im-fremdbetrieb': false,
                },
              ],
            },
          ],
        },
      };

      const xml = serializeEnniXml(model);

      expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
      expect(xml).toContain('<enni version="Dube2.5">');
      expect(xml).toContain('<softwarehersteller>agmeo</softwarehersteller>');
      expect(xml).toContain('<datenherkunft>SL</datenherkunft>');
      expect(xml).toContain('<betriebsnummer>276030000000001</betriebsnummer>');
      expect(xml).toContain('<bezugsjahr>2025</bezugsjahr>');
      expect(xml).toContain('<duengejahrbeginn>JANUAR</duengejahrbeginn>');
      expect(xml).toContain('<schlagnummer>1</schlagnummer>');
      expect(xml).toContain('<schlagname>Test Field</schlagname>');
      expect(xml).toContain('<fruchtart>WGetreide001</fruchtart>');
      expect(xml).toContain('</enni>');
    });

    test('serializeEnniXml escapes special characters', () => {
      const model: EnniExportModel = {
        softwarehersteller: 'Test & <Company>',
        datenherkunft: 'SL',
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
        betrieb: {
          betriebsnummer: '123',
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
      };

      const xml = serializeEnniXml(model);

      expect(xml).toContain('Test &amp; &lt;Company&gt;');
    });

    test('serializeEnniXml includes FLIK when present', () => {
      const model: EnniExportModel = {
        softwarehersteller: 'agmeo',
        datenherkunft: 'SL',
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
        betrieb: {
          betriebsnummer: '123',
        },
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
              flaeche: '10.000000',
              flik: 'DENILI1234567890',
              nutzungsart: 'ACKER',
              anbauten: [],
            },
          ],
        },
      };

      const xml = serializeEnniXml(model);

      expect(xml).toContain('<flik>DENILI1234567890</flik>');
    });

    // The root sections are not optional in practice: the builder always sets
    // both, and the previous truthiness checks were dead (review of #2535).
    test('serializeEnniXml omits the shared root sections when no Schlag is filed', () => {
      const model: EnniExportModel = {
        softwarehersteller: 'agmeo',
        datenherkunft: 'SL',
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
        betrieb: {
          betriebsnummer: '123',
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
      };

      const xml = serializeEnniXml(model);

      expect(xml).not.toContain('<n-170-begrenzung>');
      expect(xml).not.toContain('<dokumentation-der-duengung>');
      // The dairy yield block is the ENDO dialect's addition, never ENNI's.
      expect(xml).not.toContain('<milchleistung>');
    });
  });
});
