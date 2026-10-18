/**
 * Public entry points of the library (index.ts), end to end: system crop codes
 * → agmeo keys → ENNI / ENDO XML that passes the official XSDs.
 */

import {
  makeCultivation,
  makeExportData,
  makeField,
} from './__fixtures__/exportData.js';
import {
  validateEndoXsd,
  validateEnniXsd,
} from './__fixtures__/validateXsd.js';
import {
  buildEndoXml,
  buildEnniXml,
  CROP_KEY_BY_CODE,
  ENNI_BODENKLIMARAUM_CODES,
  generateEndoFilename,
  generateEnniFilename,
  generateExportFileName,
  INVEKOS_BETRIEBSNUMMER_PATTERN,
  NATURRAUM_OPTIONS,
  runPreflight,
} from './index.js';
import type { ExportData } from './index.js';

const INTERCROP_CODES = new Set([
  'cover_crop',
  'cc_mustard',
  'cc_phacelia',
  'cc_oil_radish',
  'cc_legume_mix',
  'cc_winter_rye',
]);

/** One field per system crop code, parcel numbers 1…n. */
const everyCropData = (federalState: string): ExportData =>
  makeExportData({
    federalState,
    fields: Object.entries(CROP_KEY_BY_CODE).map(([code, crop], idx) =>
      makeField({
        id: `field-${code}`,
        name: `Schlag ${code}`,
        parcelId: String(idx + 1),
        cultivations: [
          makeCultivation({
            cultivationId: `cult-${code}`,
            crop,
            previousCrop: 'winterWheat',
            cropRole: INTERCROP_CODES.has(code) ? 'INTERCROP' : 'MAIN',
            sowingDate: INTERCROP_CODES.has(code)
              ? new Date('2025-08-20T00:00:00Z')
              : new Date('2024-10-01T00:00:00Z'),
          }),
        ],
      }),
    ),
  });

const enniMeta = {
  betriebsnummer: '276030000000001',
  bodenklimaraum: 'BKR_45' as const,
};
const endoMeta = {
  betriebsnummer: '276010000000001',
  naturraum: 'Geest' as const,
};

describe('harmonie public API', () => {
  test('buildEnniXml: every mapped system crop validates against the ENNI XSD', async () => {
    const xml = buildEnniXml(everyCropData('NI'), enniMeta);
    const result = await validateEnniXsd(xml);
    expect(result.errors).toEqual([]);
    expect(xml).toContain('<fruchtart>WGetreide001</fruchtart>');
  });

  test('buildEndoXml: every mapped system crop validates against the Dube2.5 XSD', async () => {
    const xml = buildEndoXml(everyCropData('SH'), endoMeta);
    const result = await validateEndoXsd(xml);
    expect(result.errors).toEqual([]);
    expect(xml).toContain('<fruchtart>WGetreide008</fruchtart>');
  });

  test('runPreflight finds no missing crop mapping for mapped system crops', () => {
    for (const [format, meta, state] of [
      ['enni', enniMeta, 'NI'],
      ['endo', endoMeta, 'SH'],
    ] as const) {
      const result = runPreflight(format, everyCropData(state), meta);
      expect(result.missingCropMappings).toEqual([]);
      expect(result.missingFields).toEqual([]);
      expect(result.issues.filter((i) => i.severity === 'blocking')).toEqual(
        [],
      );
    }
  });

  test('runPreflight dispatches per format', () => {
    const data = makeExportData({ federalState: 'NI' });
    expect(
      runPreflight('enni', data, enniMeta).issues.map((i) => i.code),
    ).not.toContain('bundesland_mismatch');
    expect(
      runPreflight('endo', data, endoMeta).issues.map((i) => i.code),
    ).toContain('bundesland_mismatch');
    expect(runPreflight('enni', data).missingFields.map((f) => f.key)).toEqual([
      'betriebsnummer',
      'bodenklimaraum',
    ]);
  });

  test('file names and Stammdaten constants', () => {
    expect(generateEnniFilename('276030000000001', 2025)).toBe(
      'ENNI_276030000000001_2025.xml',
    );
    expect(generateEndoFilename('276010000000001', 2025)).toBe(
      'ENDO_276010000000001_2025.xml',
    );
    expect(generateExportFileName('endo', '27601/0', 2025)).toBe(
      'ENDO_27601_0_2025.xml',
    );
    expect(INVEKOS_BETRIEBSNUMMER_PATTERN.test('276030000000001')).toBe(true);
    expect(INVEKOS_BETRIEBSNUMMER_PATTERN.test('120000000001')).toBe(false);
    expect(ENNI_BODENKLIMARAUM_CODES).toContain('BKR_45');
    expect(NATURRAUM_OPTIONS.map((o) => o.value)).toEqual([
      'Marsch',
      'Geest',
      'Hügelland',
    ]);
  });
});
